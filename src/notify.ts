import fs from "node:fs";
import path from "node:path";
import { resolveStandaloneRootDir } from "./standalone-env.js";
import type { HetangNotificationTarget } from "./types.js";
import { resolveWeComTargetAlias } from "./wecom-target-directory.js";

const DEFAULT_SEND_TIMEOUT_MS = 60_000;
const WECOM_STABLE_MESSAGE_MAX_CHARS = 4000;
const DEFAULT_HETANG_WECOM_BOT_ID_FILE = "/root/.hermes/credentials/wecom-hetang-bot-id.txt";
const DEFAULT_HETANG_WECOM_SECRET_FILE = "/root/.hermes/credentials/wecom-hetang-bot-secret.txt";
const WECOM_SECTION_HEADING_RE =
  /^(?:结论摘要|上周对比|工作日 vs 周末|转化漏斗|会员经营|会员侧问题|技师经营|技师侧问题|风险与建议|风险预警|风险|建议|店长动作建议|本周3个必须动作|整体概览|营收排名|拉升门店|增长质量|最危险门店|各店风险排序|下周总部优先动作|总部动作建议|风险排序|完成摘要|正式回复|思路摘要)$/u;
const WECOM_INLINE_SECTION_PREFIX_RE =
  /^(?:结论摘要|风险预警|店长动作建议|完成摘要|正式回复|思路摘要)[:：]\s*/u;

type CommandRunnerResult = {
  pid?: number;
  code: number | null;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals | null;
  killed?: boolean;
  termination?: "exit" | "timeout" | "no-output-timeout" | "signal";
  noOutputTimedOut?: boolean;
};

export type CommandRunner = (
  argv: string[],
  options: {
    timeoutMs: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
) => Promise<CommandRunnerResult>;

type HetangMessageTarget = {
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
};

type WeComDirectCredentials = {
  botId: string;
  secret: string;
};

type WeComDirectSenderMode = "markdown" | "image";

function normalizeCredential(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^replace-with-/iu.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function shouldReuseCurrentCliEntry(entry: string): boolean {
  const normalized = entry.replace(/\\/gu, "/").toLowerCase();
  return normalized.endsWith("/dist/index.js");
}

function resolveConfiguredSendEntry(): string | undefined {
  const configuredEntry = process.env.HETANG_MESSAGE_SEND_ENTRY?.trim();
  if (!configuredEntry) {
    return undefined;
  }
  return path.resolve(configuredEntry);
}

function resolveConfiguredSendBinary(): string | undefined {
  const configuredBinary = process.env.HETANG_MESSAGE_SEND_BIN?.trim();
  return configuredBinary || undefined;
}

function resolveHetangProjectRoot(): string {
  const configuredRoot = process.env.HTOPS_ROOT_DIR?.trim() || process.env.HETANG_ROOT_DIR?.trim();
  if (configuredRoot) {
    return configuredRoot;
  }
  return resolveStandaloneRootDir();
}

function resolveConfiguredWeComSenderScript(): string {
  const configuredScript = process.env.HETANG_WECOM_GROUP_SENDER?.trim();
  return path.resolve(
    configuredScript || path.join(resolveHetangProjectRoot(), "ops", "wecom-send-group.mjs"),
  );
}

function readTrimmedFile(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  try {
    const value = fs.readFileSync(filePath, "utf8");
    return normalizeCredential(value);
  } catch {
    return undefined;
  }
}

function resolveDedicatedWeComCredentialFiles(): { botIdFile: string; secretFile: string } {
  return {
    botIdFile:
      process.env.HERMES_WECOM_BOT_ID_FILE?.trim() ||
      process.env.HETANG_WECOM_BOT_ID_FILE?.trim() ||
      DEFAULT_HETANG_WECOM_BOT_ID_FILE,
    secretFile:
      process.env.HERMES_WECOM_SECRET_FILE?.trim() ||
      process.env.HETANG_WECOM_SECRET_FILE?.trim() ||
      DEFAULT_HETANG_WECOM_SECRET_FILE,
  };
}

function resolveWeComDirectCredentials(): WeComDirectCredentials | null {
  const envBotId = normalizeCredential(process.env.HETANG_WECOM_BOT_ID);
  const envSecret = normalizeCredential(process.env.HETANG_WECOM_BOT_SECRET);
  if (envBotId && envSecret) {
    return {
      botId: envBotId,
      secret: envSecret,
    };
  }

  const dedicatedFiles = resolveDedicatedWeComCredentialFiles();
  const dedicatedBotId = readTrimmedFile(dedicatedFiles.botIdFile);
  const dedicatedSecret = readTrimmedFile(dedicatedFiles.secretFile);
  if (dedicatedBotId && dedicatedSecret) {
    return {
      botId: dedicatedBotId,
      secret: dedicatedSecret,
    };
  }

  const openClawConfigPath = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (!openClawConfigPath) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(openClawConfigPath, "utf8")) as {
      channels?: {
        wecom?: {
          botIdFile?: string;
          secretFile?: string;
        };
      };
    };
    const botId = readTrimmedFile(parsed.channels?.wecom?.botIdFile);
    const secret = readTrimmedFile(parsed.channels?.wecom?.secretFile);
    if (!botId || !secret) {
      return null;
    }
    return { botId, secret };
  } catch {
    return null;
  }
}

function isWeComGatewayUnavailable(message: string): boolean {
  return /websocket not connected|unable to send data|errorcode=unavailable/iu.test(message);
}

async function sendWeComMessageViaDirectSender(params: {
  target: string;
  message: string;
  runCommandWithTimeout: CommandRunner;
}): Promise<boolean> {
  return await sendWeComPayloadViaDirectSender({
    target: params.target,
    mode: "markdown",
    payload: params.message,
    runCommandWithTimeout: params.runCommandWithTimeout,
  });
}

async function sendWeComPayloadViaDirectSender(params: {
  target: string;
  mode: WeComDirectSenderMode;
  payload: string;
  runCommandWithTimeout: CommandRunner;
}): Promise<boolean> {
  const senderScript = resolveConfiguredWeComSenderScript();
  if (!fs.existsSync(senderScript)) {
    return false;
  }
  const credentials = resolveWeComDirectCredentials();
  if (!credentials) {
    return false;
  }

  const result = await params.runCommandWithTimeout(
    params.mode === "image"
      ? [process.execPath, senderScript, "image", params.target, params.payload]
      : [process.execPath, senderScript, params.target, params.payload],
    {
      timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
      cwd: process.cwd(),
      env: {
        ...process.env,
        HETANG_WECOM_BOT_ID: credentials.botId,
        HETANG_WECOM_BOT_SECRET: credentials.secret,
      },
    },
  );

  if (result.code !== 0) {
    throw new Error(
      result.stderr || result.stdout || `direct wecom send failed with code ${result.code}`,
    );
  }

  return true;
}

function normalizeOutboundMessage(message: string): string {
  return message.replace(/\r\n?/gu, "\n").trim();
}

function isListLine(line: string): boolean {
  return /^(?:[-*•]|\d+[.)、:：])\s*/u.test(line.trim());
}

function isSectionHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || isListLine(trimmed)) {
    return false;
  }
  if (WECOM_SECTION_HEADING_RE.test(trimmed)) {
    return true;
  }
  if (WECOM_INLINE_SECTION_PREFIX_RE.test(trimmed)) {
    return true;
  }
  return /(?:经营复盘|经营全景|风险雷达|同步异常告警)$/u.test(trimmed);
}

function splitLongLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) {
    return [line];
  }
  const chunks: string[] = [];
  let remaining = line;
  while (remaining.length > maxChars) {
    const whitespaceBreak = remaining.lastIndexOf(" ", maxChars);
    const breakIndex = whitespaceBreak > Math.floor(maxChars / 2) ? whitespaceBreak : maxChars;
    const chunk = remaining.slice(0, breakIndex).trimEnd();
    if (chunk) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(breakIndex).trimStart();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function splitLongBlock(block: string, maxChars: number): string[] {
  if (block.length <= maxChars) {
    return [block];
  }
  const lines = block.split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) {
      return;
    }
    chunks.push(current.join("\n"));
    current = [];
    currentLength = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const lineChunks = splitLongLine(line, maxChars);
    for (const lineChunk of lineChunks) {
      const nextLength =
        currentLength === 0 ? lineChunk.length : currentLength + 1 + lineChunk.length;
      if (nextLength > maxChars && current.length > 0) {
        flush();
      }
      current.push(lineChunk);
      currentLength = currentLength === 0 ? lineChunk.length : currentLength + 1 + lineChunk.length;
    }
  }

  flush();
  return chunks;
}

function splitWeComSections(message: string): string[] {
  const lines = message.split("\n");
  const sections: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const block = current.join("\n").trim();
    if (block) {
      sections.push(block);
    }
    current = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (isSectionHeadingLine(line) && current.length > 0) {
      flush();
    }
    current.push(line);
  }

  flush();
  return sections;
}

export function splitHetangOutboundMessage(params: {
  channel: string;
  message: string;
  maxChars?: number;
}): string[] {
  const normalized = normalizeOutboundMessage(params.message);
  if (!normalized) {
    return [];
  }
  if (params.channel !== "wecom") {
    return [normalized];
  }

  const maxChars =
    typeof params.maxChars === "number" && Number.isFinite(params.maxChars) && params.maxChars > 0
      ? Math.floor(params.maxChars)
      : WECOM_STABLE_MESSAGE_MAX_CHARS;
  if (normalized.length <= maxChars) {
    return [normalized];
  }

  const sections = splitWeComSections(normalized).flatMap((section) =>
    splitLongBlock(section, maxChars),
  );
  const chunks: string[] = [];
  let current = "";

  for (const section of sections) {
    const next = current ? `${current}\n\n${section}` : section;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    current = section;
  }

  if (current) {
    chunks.push(current);
  }
  return chunks.length > 0 ? chunks : [normalized];
}

export function buildSendMessageArgv(params: {
  notification: HetangNotificationTarget;
  message: string;
}): string[] {
  const resolvedTarget =
    params.notification.channel === "wecom"
      ? resolveWeComTargetAlias(params.notification.target)
      : params.notification.target;
  const configuredEntry = resolveConfiguredSendEntry();
  if (configuredEntry) {
    const argv = [process.execPath, configuredEntry, "message", "send"];
    argv.push("--channel", params.notification.channel);
    argv.push("--target", resolvedTarget);
    argv.push("--message", params.message);
    if (params.notification.accountId) {
      argv.push("--account", params.notification.accountId);
    }
    if (params.notification.threadId) {
      argv.push("--thread-id", params.notification.threadId);
    }
    return argv;
  }

  const entry = process.argv[1];
  if (entry && shouldReuseCurrentCliEntry(entry)) {
    const argv = [process.execPath, path.resolve(entry), "message", "send"];
    argv.push("--channel", params.notification.channel);
    argv.push("--target", resolvedTarget);
    argv.push("--message", params.message);
    if (params.notification.accountId) {
      argv.push("--account", params.notification.accountId);
    }
    if (params.notification.threadId) {
      argv.push("--thread-id", params.notification.threadId);
    }
    return argv;
  }

  const configuredBinary = resolveConfiguredSendBinary();
  if (!configuredBinary) {
    throw new Error(
      "No message send adapter configured. Set HETANG_MESSAGE_SEND_ENTRY or HETANG_MESSAGE_SEND_BIN.",
    );
  }

  const argv = [configuredBinary, "message", "send"];
  argv.push("--channel", params.notification.channel);
  argv.push("--target", resolvedTarget);
  argv.push("--message", params.message);
  if (params.notification.accountId) {
    argv.push("--account", params.notification.accountId);
  }
  if (params.notification.threadId) {
    argv.push("--thread-id", params.notification.threadId);
  }
  return argv;
}

export async function sendHetangMessage(params: {
  notification: HetangMessageTarget;
  message: string;
  runCommandWithTimeout: CommandRunner;
  maxChars?: number;
}): Promise<void> {
  const resolvedNotification = {
    ...params.notification,
    target:
      params.notification.channel === "wecom"
        ? resolveWeComTargetAlias(params.notification.target)
        : params.notification.target,
  };
  // The current WeCom plugin actively sends markdown. Long weekly reviews render
  // more reliably when we keep each outbound batch short and section-aligned.
  const messages = splitHetangOutboundMessage({
    channel: resolvedNotification.channel,
    message: params.message,
    maxChars: params.maxChars,
  });

  for (const message of messages) {
    const argv = buildSendMessageArgv({
      notification: {
        ...resolvedNotification,
        enabled: true,
      },
      message,
    });
    const result = await params.runCommandWithTimeout(argv, {
      timeoutMs: DEFAULT_SEND_TIMEOUT_MS,
      cwd: process.cwd(),
    });
    if (result.code !== 0) {
      const failureMessage =
        result.stderr || result.stdout || `message send failed with code ${result.code}`;
      if (
        resolvedNotification.channel === "wecom" &&
        isWeComGatewayUnavailable(failureMessage) &&
        (await sendWeComMessageViaDirectSender({
          target: resolvedNotification.target,
          message,
          runCommandWithTimeout: params.runCommandWithTimeout,
        }))
      ) {
        continue;
      }
      throw new Error(failureMessage);
    }
  }
}

export async function sendReportMessage(params: {
  notification: HetangNotificationTarget;
  message: string;
  runCommandWithTimeout: CommandRunner;
}): Promise<void> {
  await sendHetangMessage({
    notification: {
      channel: params.notification.channel,
      target: params.notification.target,
      accountId: params.notification.accountId,
      threadId: params.notification.threadId,
    },
    message: params.message,
    runCommandWithTimeout: params.runCommandWithTimeout,
  });
}

export async function sendHetangImage(params: {
  notification: HetangMessageTarget;
  filePath: string;
  runCommandWithTimeout: CommandRunner;
}): Promise<void> {
  if (params.notification.channel !== "wecom") {
    throw new Error("sendHetangImage currently only supports wecom notifications.");
  }

  const resolvedTarget = resolveWeComTargetAlias(params.notification.target);
  const sent = await sendWeComPayloadViaDirectSender({
    target: resolvedTarget,
    mode: "image",
    payload: params.filePath,
    runCommandWithTimeout: params.runCommandWithTimeout,
  });

  if (!sent) {
    throw new Error("WeCom image sender is unavailable.");
  }
}

export async function sendReportImage(params: {
  notification: HetangNotificationTarget;
  filePath: string;
  runCommandWithTimeout: CommandRunner;
}): Promise<void> {
  await sendHetangImage({
    notification: {
      channel: params.notification.channel,
      target: params.notification.target,
      accountId: params.notification.accountId,
      threadId: params.notification.threadId,
    },
    filePath: params.filePath,
    runCommandWithTimeout: params.runCommandWithTimeout,
  });
}
