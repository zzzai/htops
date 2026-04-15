#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AiBot from "@wecom/aibot-node-sdk/dist/index.esm.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_HERMES_WECOM_BOT_ID_FILE = "/root/.hermes/credentials/wecom-hetang-bot-id.txt";
const DEFAULT_HERMES_WECOM_SECRET_FILE = "/root/.hermes/credentials/wecom-hetang-bot-secret.txt";

function normalizeCredential(value) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^replace-with-/iu.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function readTrimmedFile(filePath) {
  try {
    return normalizeCredential(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function loadRuntimeEnv() {
  const envPath =
    process.env.HETANG_RUNTIME_ENV_FILE?.trim() || path.join(PROJECT_ROOT, ".env.runtime");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const raw = fs.readFileSync(envPath, "utf8");
  for (const rawLine of raw.split(/\r?\n/gu)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadRuntimeEnv();

const botId =
  normalizeCredential(process.env.WECOM_BOT_ID) ??
  normalizeCredential(process.env.HETANG_WECOM_BOT_ID) ??
  readTrimmedFile(process.env.HERMES_WECOM_BOT_ID_FILE || DEFAULT_HERMES_WECOM_BOT_ID_FILE);
const secret =
  normalizeCredential(process.env.WECOM_SECRET) ??
  normalizeCredential(process.env.HETANG_WECOM_BOT_SECRET) ??
  readTrimmedFile(process.env.HERMES_WECOM_SECRET_FILE || DEFAULT_HERMES_WECOM_SECRET_FILE);
const groupChatId = process.argv[2];
const message = process.argv[3];

if (!botId || !secret) {
  console.error("Missing HETANG_WECOM_BOT_ID or HETANG_WECOM_BOT_SECRET");
  process.exit(1);
}

if (!groupChatId || !message) {
  console.error("Usage: wecom-send-group.mjs <chat_id> <message>");
  process.exit(1);
}

async function main() {
  const wsClient = new AiBot.WSClient({
    botId,
    secret,
  });

  wsClient.on("authenticated", async () => {
    try {
      await wsClient.sendMessage(groupChatId, {
        msgtype: "markdown",
        markdown: {
          content: message,
        },
      });
      wsClient.disconnect();
      process.exit(0);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(detail);
      wsClient.disconnect();
      process.exit(1);
    }
  });

  wsClient.on("error", (error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(detail);
    process.exit(1);
  });

  wsClient.connect();

  setTimeout(() => {
    console.error("WeCom sender connection timeout");
    wsClient.disconnect();
    process.exit(1);
  }, 15_000);
}

void main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(detail);
  process.exit(1);
});
