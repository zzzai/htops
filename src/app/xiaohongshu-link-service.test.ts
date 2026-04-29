import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import {
  HetangXiaohongshuLinkService,
  extractFirstXiaohongshuUrl,
} from "./xiaohongshu-link-service.js";

function buildConfig(overrides: Record<string, unknown> = {}) {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      {
        orgId: "1001",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
        notification: { channel: "wecom", target: "room-yingbin" },
      },
    ],
    inboundLinkReaders: {
      xiaohongshu: {
        enabled: true,
      },
    },
    ...overrides,
  });
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractFirstXiaohongshuUrl", () => {
  it("extracts the first xiaohongshu.com note url from free text", () => {
    expect(
      extractFirstXiaohongshuUrl(
        "帮我看看这个 https://www.xiaohongshu.com/explore/67f123456789000000000001 和另一个链接",
      ),
    ).toBe("https://www.xiaohongshu.com/explore/67f123456789000000000001");
  });

  it("extracts xhslink short urls", () => {
    expect(extractFirstXiaohongshuUrl("https://xhslink.com/a/AbCdEfGhIjKl")).toBe(
      "https://xhslink.com/a/AbCdEfGhIjKl",
    );
  });
});

describe("HetangXiaohongshuLinkService", () => {
  it("uses the cheap-summary lane independently from customer growth ai", async () => {
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([
        {
          note_id: "67f123456789000000000001",
          resolved_url: "https://www.xiaohongshu.com/explore/67f123456789000000000001",
          title: "春季足疗放松体验",
          author: "小荷同学",
          published_at: "2026-04-19 09:20",
          content: "今天体验了一家店，环境安静，适合下班后放松。",
          tags: ["足疗", "放松", "探店"],
        },
      ]),
      stderr: "",
      killed: false,
      signal: null,
      termination: "exit",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: "这是一篇下班后放松向的探店笔记。",
                keyPoints: ["环境安静", "适合放松"],
                reply: "可以参考它的放松场景表达来做内容转述。",
              }),
            },
          },
        ],
      }),
    });
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    vi.stubGlobal("fetch", fetchMock);

    const service = new HetangXiaohongshuLinkService({
      config: buildConfig({
        aiLanes: {
          "cheap-summary": {
            baseUrl: "https://cheap-summary.example.com/v1",
            apiKey: "cheap-secret",
            model: "doubao-seed-2.0-lite-fast",
            timeoutMs: 2100,
            responseMode: "json",
            fallbackBehavior: "deterministic",
          },
        },
      }),
      runCommandWithTimeout,
      logger: buildLogger(),
    });

    const reply = await service.buildReplyForText({
      requestId: "req-xhs-ai-lane",
      text: "看下这个 https://www.xiaohongshu.com/explore/67f123456789000000000001",
    });

    expect(reply).toContain("AI摘要：这是一篇下班后放松向的探店笔记。");
    expect(reply).toContain("建议转述：可以参考它的放松场景表达来做内容转述。");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://cheap-summary.example.com/v1/chat/completions");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "doubao-seed-2.0-lite-fast",
    });
    expect(timeoutSpy.mock.calls.some((call) => call[1] === 2100)).toBe(true);
  });

  it("builds a deterministic summary from AutoCLI JSON output when AI is unavailable", async () => {
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: JSON.stringify([
        {
          note_id: "67f123456789000000000001",
          resolved_url: "https://www.xiaohongshu.com/explore/67f123456789000000000001",
          title: "春季足疗放松体验",
          author: "小荷同学",
          published_at: "2026-04-19 09:20",
          content:
            "今天体验了一家店，环境安静，90 分钟足疗配肩颈放松整体很舒服，适合下班后放松。",
          tags: ["足疗", "放松", "探店"],
          like_count: "128",
          collect_count: "64",
          comment_count: "12",
        },
      ]),
      stderr: "",
      killed: false,
      signal: null,
      termination: "exit",
    });
    const service = new HetangXiaohongshuLinkService({
      config: buildConfig({
        inboundLinkReaders: {
          xiaohongshu: {
            enabled: true,
            autocliBin: "/opt/autocli/bin/autocli",
          },
        },
      }),
      runCommandWithTimeout,
      logger: buildLogger(),
    });

    const reply = await service.buildReplyForText({
      requestId: "req-xhs-1",
      text: "看下这个 https://www.xiaohongshu.com/explore/67f123456789000000000001",
    });

    expect(reply).toContain("《春季足疗放松体验》");
    expect(reply).toContain("作者：小荷同学");
    expect(reply).toContain("足疗、放松、探店");
    expect(reply).toContain("90 分钟足疗配肩颈放松");
    expect(runCommandWithTimeout).toHaveBeenCalledWith(
      [
        "/opt/autocli/bin/autocli",
        "xiaohongshu",
        "read-note",
        "https://www.xiaohongshu.com/explore/67f123456789000000000001",
        "--format",
        "json",
      ],
      expect.objectContaining({
        timeoutMs: 45_000,
      }),
    );
  });

  it("returns a safe follow-up message when AutoCLI is missing", async () => {
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 127,
      stdout: "",
      stderr: "autocli: command not found",
      killed: false,
      signal: null,
      termination: "exit",
    });
    const service = new HetangXiaohongshuLinkService({
      config: buildConfig(),
      runCommandWithTimeout,
      logger: buildLogger(),
    });

    const reply = await service.buildReplyForText({
      requestId: "req-xhs-missing",
      text: "https://xhslink.com/a/AbCdEfGhIjKl",
    });

    expect(reply).toContain("小红书读取 sidecar 还没安装完成");
  });

  it("returns null for messages without xiaohongshu links", async () => {
    const service = new HetangXiaohongshuLinkService({
      config: buildConfig(),
      runCommandWithTimeout: vi.fn(),
      logger: buildLogger(),
    });

    await expect(
      service.buildReplyForText({
        requestId: "req-no-link",
        text: "帮我看看这段普通文本",
      }),
    ).resolves.toBeNull();
  });
});
