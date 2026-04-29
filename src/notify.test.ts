import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSendMessageArgv,
  sendHetangImage,
  sendHetangMessage,
  splitHetangOutboundMessage,
} from "./notify.js";

const originalArgv = [...process.argv];
const originalSendEntry = process.env.HETANG_MESSAGE_SEND_ENTRY;
const originalSendBinary = process.env.HETANG_MESSAGE_SEND_BIN;
const originalWeComSender = process.env.HETANG_WECOM_GROUP_SENDER;
const originalWeComBotId = process.env.HETANG_WECOM_BOT_ID;
const originalWeComBotSecret = process.env.HETANG_WECOM_BOT_SECRET;
const originalWeComBotIdFile = process.env.HERMES_WECOM_BOT_ID_FILE;
const originalWeComBotSecretFile = process.env.HERMES_WECOM_SECRET_FILE;
const originalOpenClawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const originalHtopsRootDir = process.env.HTOPS_ROOT_DIR;
const originalHetangRootDir = process.env.HETANG_ROOT_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.resetModules();
  if (originalSendEntry == null) {
    delete process.env.HETANG_MESSAGE_SEND_ENTRY;
  } else {
    process.env.HETANG_MESSAGE_SEND_ENTRY = originalSendEntry;
  }
  if (originalSendBinary == null) {
    delete process.env.HETANG_MESSAGE_SEND_BIN;
  } else {
    process.env.HETANG_MESSAGE_SEND_BIN = originalSendBinary;
  }
  if (originalWeComSender == null) {
    delete process.env.HETANG_WECOM_GROUP_SENDER;
  } else {
    process.env.HETANG_WECOM_GROUP_SENDER = originalWeComSender;
  }
  if (originalWeComBotId == null) {
    delete process.env.HETANG_WECOM_BOT_ID;
  } else {
    process.env.HETANG_WECOM_BOT_ID = originalWeComBotId;
  }
  if (originalWeComBotSecret == null) {
    delete process.env.HETANG_WECOM_BOT_SECRET;
  } else {
    process.env.HETANG_WECOM_BOT_SECRET = originalWeComBotSecret;
  }
  if (originalWeComBotIdFile == null) {
    delete process.env.HERMES_WECOM_BOT_ID_FILE;
  } else {
    process.env.HERMES_WECOM_BOT_ID_FILE = originalWeComBotIdFile;
  }
  if (originalWeComBotSecretFile == null) {
    delete process.env.HERMES_WECOM_SECRET_FILE;
  } else {
    process.env.HERMES_WECOM_SECRET_FILE = originalWeComBotSecretFile;
  }
  if (originalOpenClawConfigPath == null) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = originalOpenClawConfigPath;
  }
  if (originalHtopsRootDir == null) {
    delete process.env.HTOPS_ROOT_DIR;
  } else {
    process.env.HTOPS_ROOT_DIR = originalHtopsRootDir;
  }
  if (originalHetangRootDir == null) {
    delete process.env.HETANG_ROOT_DIR;
  } else {
    process.env.HETANG_ROOT_DIR = originalHetangRootDir;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildSendMessageArgv", () => {
  it("uses the current CLI account flag when an entry script is present", () => {
    process.argv = ["/usr/bin/node", "/root/openclaw/dist/index.js"];

    const argv = buildSendMessageArgv({
      notification: {
        channel: "wecom",
        target: "conversation-yiwu",
        accountId: "default",
        threadId: "thread-1",
        enabled: true,
      },
      message: "当前环境仅启用身份与权限校验，经营日报尚未启用。",
    });

    expect(argv).toContain("--account");
    expect(argv).not.toContain("--account-id");
    expect(argv).toContain("--thread-id");
  });

  it("uses the current CLI account flag for openclaw fallback invocations too", () => {
    process.argv = ["/usr/bin/node"];
    process.env.HETANG_MESSAGE_SEND_BIN = "openclaw";

    const argv = buildSendMessageArgv({
      notification: {
        channel: "wecom",
        target: "conversation-yiwu",
        accountId: "default",
        enabled: true,
      },
      message: "当前环境仅启用身份与权限校验，经营日报尚未启用。",
    });

    expect(argv).toContain("--account");
    expect(argv).not.toContain("--account-id");
  });

  it("falls back to the openclaw binary when running from a standalone helper script", () => {
    process.argv = ["/usr/bin/node", "/root/openclaw/extensions/hetang-ops/scripts/send-midday-briefs.ts"];
    process.env.HETANG_MESSAGE_SEND_BIN = "openclaw";

    const argv = buildSendMessageArgv({
      notification: {
        channel: "wecom",
        target: "龙虾测试群",
        enabled: true,
      },
      message: "午报发送测试",
    });

    expect(argv[0]).toBe("openclaw");
    expect(argv).not.toContain("/root/openclaw/extensions/hetang-ops/scripts/send-midday-briefs.ts");
    expect(argv).toContain("message");
    expect(argv).toContain("send");
  });

  it("prefers a configured gateway entry when one is provided", () => {
    process.argv = ["/usr/bin/node", "/root/htops/scripts/send-midday-briefs.ts"];
    process.env.HETANG_MESSAGE_SEND_ENTRY = "/root/gateway/dist/index.js";

    const argv = buildSendMessageArgv({
      notification: {
        channel: "wecom",
        target: "龙虾测试群",
        enabled: true,
      },
      message: "午报发送测试",
    });

    expect(argv[0]).toBe(process.execPath);
    expect(argv[1]).toBe("/root/gateway/dist/index.js");
    expect(argv).toContain("message");
    expect(argv).toContain("send");
  });

  it("resolves known wecom group aliases from the local public-safe directory before dispatch", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-wecom-targets-"));
    tempDirs.push(tempDir);
    fs.mkdirSync(path.join(tempDir, "ops"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "ops", "wecom-target-directory.v1.example.json"),
      JSON.stringify({
        entries: [
          {
            target: "EXAMPLE_SHARED_DELIVERY_CHAT",
            aliases: ["示例共享群", "shared-delivery"],
          },
        ],
      }),
      "utf8",
    );
    process.env.HTOPS_ROOT_DIR = tempDir;
    vi.resetModules();
    process.argv = ["/usr/bin/node", "/root/openclaw/dist/index.js"];

    const { buildSendMessageArgv: buildSendMessageArgvFromTempRoot } = await import("./notify.js");

    const argv = buildSendMessageArgvFromTempRoot({
      notification: {
        channel: "wecom",
        target: "示例共享群",
        enabled: true,
      },
      message: "午报发送测试",
    });

    expect(argv).toContain("--target");
    expect(argv).toContain("EXAMPLE_SHARED_DELIVERY_CHAT");
    expect(argv).not.toContain("示例共享群");
  });

  it("prefers a configured gateway binary name for standalone fallback invocations", () => {
    process.argv = ["/usr/bin/node"];
    process.env.HETANG_MESSAGE_SEND_BIN = "htops-gateway";

    const argv = buildSendMessageArgv({
      notification: {
        channel: "wecom",
        target: "龙虾测试群",
        enabled: true,
      },
      message: "午报发送测试",
    });

    expect(argv[0]).toBe("htops-gateway");
    expect(argv).toContain("message");
    expect(argv).toContain("send");
  });

  it("throws when no send adapter is configured for standalone fallback", () => {
    process.argv = ["/usr/bin/node"];

    expect(() =>
      buildSendMessageArgv({
        notification: {
          channel: "wecom",
          target: "龙虾测试群",
          enabled: true,
        },
        message: "午报发送测试",
      }),
    ).toThrow(/No message send adapter configured/u);
  });
});

describe("splitHetangOutboundMessage", () => {
  it("splits long wecom review text into section-preserving batches", () => {
    const message = [
      "荷塘悦色华美店 近7天 经营复盘",
      "结论摘要",
      "- 基本盘还在，但转化承接和人员产能需要一起盯。",
      "- 近7天服务营收 10176.90 元，日均 24306.70 元。",
      "上周对比",
      "- 服务营收 17046.90 元，较上周 +3.2%。",
      "- 总钟数 810 钟，较上周 +2.4%。",
      "工作日 vs 周末",
      "- 工作日 5 天，营收 119476.00 元，日均 23895.20 元。",
      "- 周末 2 天，营收 53199.90 元，日均 26599.95 元。",
      "转化漏斗",
      "- 7天复到店率 90.9%。",
      "- 7天开卡率 0.0%。",
      "会员经营",
      "- 近7天新增会员 28 人。",
      "技师经营",
      "- 近7天总钟数 801 钟，点钟率 33.4%，加钟率 7.4%。",
      "本周3个必须动作",
      "1. 先补齐 8 个接口同步，再发布正式经营结论。",
      "2. 围绕“时间售卖 + 服务交付”继续盯钟效。",
      "3. 安排店长和技师联合做二次邀约。",
    ].join("\n");

    const chunks = splitHetangOutboundMessage({
      channel: "wecom",
      message,
      maxChars: 120,
    });

    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[0]).toContain("荷塘悦色华美店 近7天 经营复盘");
    expect(chunks.join("\n")).toContain("结论摘要");
    expect(chunks.join("\n")).toContain("上周对比");
    expect(chunks.join("\n")).toContain("工作日 vs 周末");
    expect(chunks.join("\n")).toContain("本周3个必须动作");
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
    expect(chunks.some((chunk) => chunk.includes("\n\n"))).toBe(true);
  });

  it("keeps non-wecom outbound text as a single message", () => {
    expect(
      splitHetangOutboundMessage({
        channel: "feishu",
        message: "一条普通消息\n第二行",
        maxChars: 10,
      }),
    ).toEqual(["一条普通消息\n第二行"]);
  });

  it("keeps a medium-length wecom outbound message in one chunk under the default threshold", () => {
    const message = `结论：${"经营日报内容".repeat(180)}`;

    const chunks = splitHetangOutboundMessage({
      channel: "wecom",
      message,
    });

    expect(message.length).toBeGreaterThan(900);
    expect(message.length).toBeLessThan(4000);
    expect(chunks).toEqual([message]);
  });

  it("treats inline summaries and risk headings as stable wecom section anchors", () => {
    const message = [
      "荷塘悦色华美店 近7天经营复盘已完成。",
      "完成摘要：本周最大问题不在引流，而在团购首单后的承接。",
      "正式回复",
      "结论摘要：客人愿意回来，但开卡和储值承接还不够。",
      "风险",
      "- [warn] 团购订单占比过高，需要盯7天复到店率和储值转化。",
      "建议",
      "1. 今天先拉出近7天未复到店团购客名单。",
      "2. 前台和技师统一储值收口话术。",
    ].join("\n");

    const chunks = splitHetangOutboundMessage({
      channel: "wecom",
      message,
      maxChars: 70,
    });

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.some((chunk) => chunk.includes("完成摘要：本周最大问题不在引流"))).toBe(true);
    expect(
      chunks.some((chunk) =>
        chunk.includes(
          "结论摘要：客人愿意回来，但开卡和储值承接还不够。\n\n风险\n- [warn] 团购订单占比过高，需要盯7天复到店率和储值转化。",
        ),
      ),
    ).toBe(true);
    expect(
      chunks.some(
        (chunk) =>
          chunk === "建议\n1. 今天先拉出近7天未复到店团购客名单。\n2. 前台和技师统一储值收口话术。",
      ),
    ).toBe(true);
  });
});

describe("sendHetangMessage", () => {
  it("sends wecom report batches one by one", async () => {
    process.argv = ["/usr/bin/node", "/root/openclaw/dist/index.js"];
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await sendHetangMessage({
      notification: {
        channel: "wecom",
        target: "conversation-yiwu",
        accountId: "default",
      },
      message: [
        "荷塘悦色华美店 近7天 经营复盘",
        "结论摘要",
        "- 基本盘还在，但转化承接和人员产能需要一起盯。",
        "上周对比",
        "- 服务营收 17046.90 元，较上周 +3.2%。",
        "本周3个必须动作",
        "1. 先补齐 8 个接口同步，再发布正式经营结论。",
      ].join("\n"),
      runCommandWithTimeout,
      maxChars: 60,
    });

    expect(runCommandWithTimeout.mock.calls.length).toBeGreaterThan(1);
    for (const [argv] of runCommandWithTimeout.mock.calls) {
      expect(argv).toContain("message");
      expect(argv).toContain("send");
      expect(argv).toContain("--message");
    }
  });

  it("falls back to the dedicated wecom sender when gateway reply transport is disconnected", async () => {
    process.argv = ["/usr/bin/node", "/root/openclaw/dist/index.js"];
    process.env.HETANG_WECOM_GROUP_SENDER = "/root/htops/ops/wecom-send-group.mjs";
    process.env.HETANG_WECOM_BOT_ID = "bot-direct";
    process.env.HETANG_WECOM_BOT_SECRET = "secret-direct";
    const runCommandWithTimeout = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "WebSocket not connected, unable to send data",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await sendHetangMessage({
      notification: {
        channel: "wecom",
        target: "conversation-yiwu",
        accountId: "default",
      },
      message: "午报发送测试",
      runCommandWithTimeout,
    });

    expect(runCommandWithTimeout).toHaveBeenCalledTimes(2);
    expect(runCommandWithTimeout.mock.calls[0]?.[0]).toContain("message");
    expect(runCommandWithTimeout.mock.calls[0]?.[0]).toContain("send");
    expect(runCommandWithTimeout.mock.calls[1]?.[0]).toEqual([
      process.execPath,
      "/root/htops/ops/wecom-send-group.mjs",
      "conversation-yiwu",
      "午报发送测试",
    ]);
    expect(runCommandWithTimeout.mock.calls[1]?.[1]?.env).toMatchObject({
      HETANG_WECOM_BOT_ID: "bot-direct",
      HETANG_WECOM_BOT_SECRET: "secret-direct",
    });
  });

  it("reads wecom fallback credentials from the OpenClaw channel config when env vars are absent", async () => {
    process.argv = ["/usr/bin/node", "/root/openclaw/dist/index.js"];
    delete process.env.HETANG_WECOM_BOT_ID;
    delete process.env.HETANG_WECOM_BOT_SECRET;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-wecom-"));
    const botIdFile = path.join(tempDir, "bot-id.txt");
    const botSecretFile = path.join(tempDir, "bot-secret.txt");
    const openClawConfigPath = path.join(tempDir, "openclaw.json");
    const senderScriptPath = path.join(tempDir, "wecom-send-group.mjs");

    fs.writeFileSync(botIdFile, "bot-from-config\n", "utf8");
    fs.writeFileSync(botSecretFile, "secret-from-config\n", "utf8");
    fs.writeFileSync(senderScriptPath, "#!/usr/bin/env node\n", "utf8");
    fs.writeFileSync(
      openClawConfigPath,
      JSON.stringify(
        {
          channels: {
            wecom: {
              botIdFile,
              secretFile: botSecretFile,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    process.env.HETANG_WECOM_GROUP_SENDER = senderScriptPath;
    process.env.OPENCLAW_CONFIG_PATH = openClawConfigPath;
    process.env.HERMES_WECOM_BOT_ID_FILE = path.join(tempDir, "missing-bot-id.txt");
    process.env.HERMES_WECOM_SECRET_FILE = path.join(tempDir, "missing-bot-secret.txt");

    const runCommandWithTimeout = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "WebSocket not connected, unable to send data",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await sendHetangMessage({
      notification: {
        channel: "wecom",
        target: "conversation-yiwu",
      },
      message: "企微兜底发送测试",
      runCommandWithTimeout,
    });

    expect(runCommandWithTimeout).toHaveBeenCalledTimes(2);
    expect(runCommandWithTimeout.mock.calls[1]?.[1]?.env).toMatchObject({
      HETANG_WECOM_BOT_ID: "bot-from-config",
      HETANG_WECOM_BOT_SECRET: "secret-from-config",
    });
  });

  it("prefers dedicated hetang wecom credential files over placeholder env vars", async () => {
    process.argv = ["/usr/bin/node", "/root/openclaw/dist/index.js"];
    process.env.HETANG_WECOM_GROUP_SENDER = "/root/htops/ops/wecom-send-group.mjs";
    process.env.HETANG_WECOM_BOT_ID = "replace-with-bot-id";
    process.env.HETANG_WECOM_BOT_SECRET = "replace-with-bot-secret";
    delete process.env.OPENCLAW_CONFIG_PATH;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "notify-wecom-dedicated-"));
    const botIdFile = path.join(tempDir, "hetang-bot-id.txt");
    const botSecretFile = path.join(tempDir, "hetang-bot-secret.txt");
    fs.writeFileSync(botIdFile, "bot-from-dedicated-file\n", "utf8");
    fs.writeFileSync(botSecretFile, "secret-from-dedicated-file\n", "utf8");
    process.env.HERMES_WECOM_BOT_ID_FILE = botIdFile;
    process.env.HERMES_WECOM_SECRET_FILE = botSecretFile;

    const runCommandWithTimeout = vi
      .fn()
      .mockResolvedValueOnce({
        code: 1,
        stdout: "",
        stderr: "WebSocket not connected, unable to send data",
      })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    await sendHetangMessage({
      notification: {
        channel: "wecom",
        target: "conversation-yiwu",
      },
      message: "企微专用 bot 凭据兜底发送测试",
      runCommandWithTimeout,
    });

    expect(runCommandWithTimeout).toHaveBeenCalledTimes(2);
    expect(runCommandWithTimeout.mock.calls[1]?.[1]?.env).toMatchObject({
      HETANG_WECOM_BOT_ID: "bot-from-dedicated-file",
      HETANG_WECOM_BOT_SECRET: "secret-from-dedicated-file",
    });
  });
});

describe("sendHetangImage", () => {
  it("sends a local png through the dedicated wecom sender", async () => {
    process.env.HETANG_WECOM_GROUP_SENDER = "/root/htops/ops/wecom-send-group.mjs";
    process.env.HETANG_WECOM_BOT_ID = "bot-direct";
    process.env.HETANG_WECOM_BOT_SECRET = "secret-direct";

    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await sendHetangImage({
      notification: {
        channel: "wecom",
        target: "conversation-yiwu",
      },
      filePath: "/tmp/weekly-chart.png",
      runCommandWithTimeout,
    });

    expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    expect(runCommandWithTimeout.mock.calls[0]?.[0]).toEqual([
      process.execPath,
      "/root/htops/ops/wecom-send-group.mjs",
      "image",
      "conversation-yiwu",
      "/tmp/weekly-chart.png",
    ]);
    expect(runCommandWithTimeout.mock.calls[0]?.[1]?.env).toMatchObject({
      HETANG_WECOM_BOT_ID: "bot-direct",
      HETANG_WECOM_BOT_SECRET: "secret-direct",
    });
  });

  it("fails fast for non-wecom image sends", async () => {
    const runCommandWithTimeout = vi.fn();

    await expect(
      sendHetangImage({
        notification: {
          channel: "feishu",
          target: "group-001",
        },
        filePath: "/tmp/weekly-chart.png",
        runCommandWithTimeout,
      }),
    ).rejects.toThrow(/only supports wecom/u);
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });
});
