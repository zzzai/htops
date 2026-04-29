import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildHermesSendDispatch,
  formatHermesSendHelp,
  parseHermesSendArgs,
} from "./hermes-send.js";

const originalHtopsRootDir = process.env.HTOPS_ROOT_DIR;
const originalHetangRootDir = process.env.HETANG_ROOT_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
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

describe("parseHermesSendArgs", () => {
  it("parses the htops outbound message contract", () => {
    expect(
      parseHermesSendArgs([
        "message",
        "send",
        "--channel",
        "wecom",
        "--target",
        "group-001",
        "--message",
        "hello",
        "--account",
        "acct-default",
        "--thread-id",
        "thread-9",
      ]),
    ).toEqual({
      help: false,
      channel: "wecom",
      target: "group-001",
      message: "hello",
      accountId: "acct-default",
      threadId: "thread-9",
    });
  });

  it("supports help output without requiring other flags", () => {
    expect(parseHermesSendArgs(["--help"])).toEqual({
      help: true,
      channel: undefined,
      target: undefined,
      message: undefined,
      accountId: undefined,
      threadId: undefined,
    });
  });

  it("rejects unsupported verbs", () => {
    expect(() => parseHermesSendArgs(["send"])).toThrow(/Usage/u);
  });
});

describe("buildHermesSendDispatch", () => {
  it("routes wecom sends through the local wecom sender script", () => {
    const dispatch = buildHermesSendDispatch(
      {
        help: false,
        channel: "wecom",
        target: "group-001",
        message: "hello",
        accountId: "acct-default",
        threadId: "thread-9",
      },
      {
        projectRoot: "/root/htops",
      },
    );

    expect(dispatch).toEqual({
      argv: [process.execPath, "/root/htops/ops/wecom-send-group.mjs", "group-001", "hello"],
      env: {
        HETANG_OUTBOUND_ACCOUNT_ID: "acct-default",
        HETANG_OUTBOUND_THREAD_ID: "thread-9",
      },
    });
  });

  it("resolves a local public-safe wecom alias before building a direct dispatch", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-send-targets-"));
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

    const { buildHermesSendDispatch: buildHermesSendDispatchFromTempRoot } = await import(
      "./hermes-send.js"
    );

    const dispatch = buildHermesSendDispatchFromTempRoot(
      {
        help: false,
        channel: "wecom",
        target: "示例共享群",
        message: "hello",
      },
      {
        projectRoot: tempDir,
      },
    );

    expect(dispatch).toEqual({
      argv: [
        process.execPath,
        path.join(tempDir, "ops", "wecom-send-group.mjs"),
        "EXAMPLE_SHARED_DELIVERY_CHAT",
        "hello",
      ],
      env: {},
    });
  });

  it("fails fast for unsupported outbound channels", () => {
    expect(() =>
      buildHermesSendDispatch(
        {
          help: false,
          channel: "feishu",
          target: "oc_xxx",
          message: "hello",
        },
        {
          projectRoot: "/root/htops",
        },
      ),
    ).toThrow(/Unsupported outbound channel/u);
  });
});

describe("formatHermesSendHelp", () => {
  it("mentions the stable message send contract", () => {
    expect(formatHermesSendHelp()).toContain("message send");
    expect(formatHermesSendHelp()).toContain("--channel");
    expect(formatHermesSendHelp()).toContain("--target");
  });
});
