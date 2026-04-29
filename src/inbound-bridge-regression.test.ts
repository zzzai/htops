import { afterEach, describe, expect, it, vi } from "vitest";

const { runHetangTypedQueryMock } = vi.hoisted(() => ({
  runHetangTypedQueryMock: vi.fn(),
}));

vi.mock("./command.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./command.js")>();
  return {
    ...actual,
    runHetangTypedQuery: runHetangTypedQueryMock,
  };
});

import { resolveHetangOpsConfig } from "./config.js";
import { createHetangInboundClaimHandler } from "./inbound.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    sync: { enabled: false },
    reporting: { enabled: false },
    stores: [
      { orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] },
      { orgId: "627150985244677", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
      { orgId: "627152412155909", storeName: "荷塘悦色华美店", rawAliases: ["华美店"] },
      { orgId: "627152677269509", storeName: "荷塘悦色锦苑店", rawAliases: ["锦苑店"] },
      { orgId: "627153074147333", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
    ],
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("createHetangInboundClaimHandler regression", () => {
  it("replies with the direct HQ query answer for 哪个门店须重点关注 instead of generic unmatched guidance", async () => {
    runHetangTypedQueryMock.mockResolvedValue("5店 近15天 总部经营全景\n最危险门店：荷塘悦色华美店");
    const runtime = {
      getEmployeeBinding: vi.fn().mockResolvedValue({
        channel: "wecom",
        senderId: "ZhangZhen",
        employeeName: "张震",
        role: "hq",
        isActive: true,
        scopeOrgIds: [
          "627149864218629",
          "627150985244677",
          "627152412155909",
          "627152677269509",
          "627153074147333",
        ],
      }),
      grantEmployeeBinding: vi.fn().mockResolvedValue(undefined),
    };
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      sendReply,
      now: () => new Date("2026-04-17T10:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
        senderId: "ZhangZhen",
        content: "哪个门店须重点关注",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runHetangTypedQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "哪个门店须重点关注",
        commandBody: "/hetang query 哪个门店须重点关注",
      }),
    );
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-hq",
      accountId: "default",
      threadId: undefined,
      message: "5店 近15天 总部经营全景\n最危险门店：荷塘悦色华美店",
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("我当前主要处理荷塘门店经营数据问题");
  });

  it("replies with the direct store report answer for 这几天义乌店怎么样 instead of asking for more slots", async () => {
    runHetangTypedQueryMock.mockResolvedValue("荷塘悦色义乌店 近5天 经营复盘\n结论摘要：整体盘子基本稳住。");
    const runtime = {
      getEmployeeBinding: vi.fn().mockResolvedValue({
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["627150985244677"],
      }),
      grantEmployeeBinding: vi.fn().mockResolvedValue(undefined),
    };
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      sendReply,
      now: () => new Date("2026-04-17T18:20:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-yiwu",
        content: "这几天义乌店怎么样",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runHetangTypedQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "这几天义乌店怎么样",
        commandBody: "/hetang query 这几天义乌店怎么样",
      }),
    );
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: "荷塘悦色义乌店 近5天 经营复盘\n结论摘要：整体盘子基本稳住。",
    });
  });

  it("replies with the direct store advice answer for 义乌店近7天重点看什么 instead of missing-metric clarification", async () => {
    runHetangTypedQueryMock.mockResolvedValue("荷塘悦色义乌店 当前更该先抓什么\n结论: 先抓团购复到店和储值转化。");
    const runtime = {
      getEmployeeBinding: vi.fn().mockResolvedValue({
        channel: "wecom",
        senderId: "manager-yiwu",
        employeeName: "义乌店长",
        role: "manager",
        isActive: true,
        scopeOrgIds: ["627150985244677"],
      }),
      grantEmployeeBinding: vi.fn().mockResolvedValue(undefined),
    };
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      sendReply,
      now: () => new Date("2026-04-17T18:20:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-yiwu",
        content: "义乌店近7天重点看什么",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runHetangTypedQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "义乌店近7天重点看什么",
        commandBody: "/hetang query 义乌店近7天重点看什么",
      }),
    );
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: "荷塘悦色义乌店 当前更该先抓什么\n结论: 先抓团购复到店和储值转化。",
    });
  });

  it("replies with the direct HQ portfolio answer for 这几天五店怎么样 instead of missing-metric clarification", async () => {
    runHetangTypedQueryMock.mockResolvedValue("5店 近5天 总部经营全景\n最危险门店：荷塘悦色华美店");
    const runtime = {
      getEmployeeBinding: vi.fn().mockResolvedValue({
        channel: "wecom",
        senderId: "ZhangZhen",
        employeeName: "张震",
        role: "hq",
        isActive: true,
        scopeOrgIds: [
          "627149864218629",
          "627150985244677",
          "627152412155909",
          "627152677269509",
          "627153074147333",
        ],
      }),
      grantEmployeeBinding: vi.fn().mockResolvedValue(undefined),
    };
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      sendReply,
      now: () => new Date("2026-04-17T18:35:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
        senderId: "ZhangZhen",
        content: "这几天五店怎么样",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runHetangTypedQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "这几天五店怎么样",
        commandBody: "/hetang query 这几天五店怎么样",
      }),
    );
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-hq",
      accountId: "default",
      threadId: undefined,
      message: "5店 近5天 总部经营全景\n最危险门店：荷塘悦色华美店",
    });
  });

  it("replies with the direct HQ portfolio answer for 五店近7天重点看什么 instead of missing-metric clarification", async () => {
    runHetangTypedQueryMock.mockResolvedValue("5店 近7天 总部经营全景\n最危险门店：荷塘悦色华美店");
    const runtime = {
      getEmployeeBinding: vi.fn().mockResolvedValue({
        channel: "wecom",
        senderId: "ZhangZhen",
        employeeName: "张震",
        role: "hq",
        isActive: true,
        scopeOrgIds: [
          "627149864218629",
          "627150985244677",
          "627152412155909",
          "627152677269509",
          "627153074147333",
        ],
      }),
      grantEmployeeBinding: vi.fn().mockResolvedValue(undefined),
    };
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      sendReply,
      now: () => new Date("2026-04-17T18:35:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
        senderId: "ZhangZhen",
        content: "五店近7天重点看什么",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runHetangTypedQueryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        queryText: "五店近7天重点看什么",
        commandBody: "/hetang query 五店近7天重点看什么",
      }),
    );
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-hq",
      accountId: "default",
      threadId: undefined,
      message: "5店 近7天 总部经营全景\n最危险门店：荷塘悦色华美店",
    });
  });
});
