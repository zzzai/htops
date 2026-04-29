import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  createHetangInboundClaimHandler,
  resolveHetangNaturalLanguageCommand,
  resolveLegacyInboundRouteSnapshot,
} from "./inbound.js";

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
        orgId: "627150985244677",
        storeName: "荷塘悦色义乌店",
        rawAliases: ["义乌店"],
        notification: { channel: "wecom", target: "store-yiwu" },
      },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
    ...overrides,
  });
}

function buildRuntime() {
  return {
    doctor: vi.fn().mockResolvedValue("doctor ok"),
    syncStores: vi.fn().mockResolvedValue(["sync ok"]),
    buildReport: vi.fn().mockResolvedValue({
      orgId: "627150985244677",
      storeName: "荷塘悦色义乌店",
      bizDate: "2026-03-29",
      metrics: {},
      alerts: [],
      suggestions: [],
      markdown: "义乌店日报",
      complete: true,
    }),
    getEmployeeBinding: vi.fn(),
    grantEmployeeBinding: vi.fn().mockResolvedValue(undefined),
    getCommandUsage: vi.fn(),
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    recordCommandAudit: vi.fn().mockResolvedValue(undefined),
    listCurrentMembers: vi.fn().mockResolvedValue([]),
    listCustomerProfile90dByDateRange: vi.fn().mockResolvedValue([]),
    listTechUpClockByDateRange: vi.fn().mockResolvedValue([]),
    enqueueAnalysisJob: vi.fn().mockResolvedValue({
      jobId: "JOB-1",
      status: "pending",
      queueDisposition: "created",
      storeName: "荷塘悦色义乌店",
    }),
  };
}

describe("resolveHetangNaturalLanguageCommand", () => {
  it("maps a yesterday revenue query into the canonical /hetang query command", () => {
    const match = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "查一下义乌店昨天的营收",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(match).toEqual({
      action: "query",
      args: "query 查一下义乌店昨天的营收",
      commandBody: "/hetang query 查一下义乌店昨天的营收",
    });
  });

  it("maps direct metric questions into a canonical query command", () => {
    const match = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店昨日的加钟率 点钟率如何",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(match).toEqual({
      action: "query",
      args: "query 义乌店昨日的加钟率 点钟率如何",
      commandBody: "/hetang query 义乌店昨日的加钟率 点钟率如何",
    });
  });

  it("maps generic payment-structure questions into the canonical query command", () => {
    const match = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店昨日各种消费方式占比逐个列一下",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(match).toEqual({
      action: "query",
      args: "query 义乌店昨日各种消费方式占比逐个列一下",
      commandBody: "/hetang query 义乌店昨日各种消费方式占比逐个列一下",
    });
  });

  it("maps customer-tech relationship questions into the canonical query command", () => {
    const match = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "王先生最近30天被哪些技师服务过",
      now: new Date("2026-03-31T09:00:00+08:00"),
    });

    expect(match).toEqual({
      action: "query",
      args: "query 王先生最近30天被哪些技师服务过",
      commandBody: "/hetang query 王先生最近30天被哪些技师服务过",
    });
  });

  it("maps phone-suffix customer profile questions into the canonical query command", () => {
    const match = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店尾号7500客户画像",
      now: new Date("2026-03-31T09:00:00+08:00"),
    });

    expect(match).toEqual({
      action: "query",
      args: "query 义乌店尾号7500客户画像",
      commandBody: "/hetang query 义乌店尾号7500客户画像",
    });
  });

  it("maps birthday and wait-experience questions into canonical query commands", () => {
    const birthdayMatch = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店明天过生日的高价值会员有哪些",
      now: new Date("2026-04-05T01:00:08+08:00"),
    });
    const waitMatch = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店昨天平均等待时长多少分钟",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(birthdayMatch).toEqual({
      action: "query",
      args: "query 义乌店明天过生日的高价值会员有哪些",
      commandBody: "/hetang query 义乌店明天过生日的高价值会员有哪些",
    });
    expect(waitMatch).toEqual({
      action: "query",
      args: "query 义乌店昨天平均等待时长多少分钟",
      commandBody: "/hetang query 义乌店昨天平均等待时长多少分钟",
    });
  });

  it("maps semantically normalized store-health and handoff slang into canonical query commands", () => {
    const storeHealthMatch = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店近7天盘子稳不稳",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });
    const handoffMatch = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店团购客接没接住",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(storeHealthMatch).toEqual({
      action: "query",
      args: "query 义乌店近7天盘子稳不稳",
      commandBody: "/hetang query 义乌店近7天盘子稳不稳",
    });
    expect(handoffMatch).toEqual({
      action: "query",
      args: "query 义乌店团购客接没接住",
      commandBody: "/hetang query 义乌店团购客接没接住",
    });
  });

  it("maps longest-wait time-bucket questions into canonical query commands", () => {
    const match = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "迎宾店昨天哪个时段等待最长",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(match).toEqual({
      action: "query",
      args: "query 迎宾店昨天哪个时段等待最长",
      commandBody: "/hetang query 迎宾店昨天哪个时段等待最长",
    });
  });

  it("maps member-marketing and recharge-attribution questions into canonical query commands", () => {
    const memberMarketingMatch = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店哪种来源的会员更容易沉默",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });
    const rechargeAttributionMatch = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "义乌店近30天哪种卡型充值最好",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(memberMarketingMatch).toEqual({
      action: "query",
      args: "query 义乌店哪种来源的会员更容易沉默",
      commandBody: "/hetang query 义乌店哪种来源的会员更容易沉默",
    });
    expect(rechargeAttributionMatch).toEqual({
      action: "query",
      args: "query 义乌店近30天哪种卡型充值最好",
      commandBody: "/hetang query 义乌店近30天哪种卡型充值最好",
    });
  });

  it("keeps today queries query-shaped before the 03:00 cutoff", () => {
    const match = resolveHetangNaturalLanguageCommand({
      config: buildConfig(),
      content: "查一下义乌店今天的营收",
      now: new Date("2026-03-31T02:30:00+08:00"),
    });

    expect(match).toEqual({
      action: "query",
      args: "query 查一下义乌店今天的营收",
      commandBody: "/hetang query 查一下义乌店今天的营收",
    });
  });

  it("recognizes compare and ranking queries", () => {
    const config = buildConfig({
      stores: [
        {
          orgId: "627150985244677",
          storeName: "荷塘悦色义乌店",
          rawAliases: ["义乌店"],
          notification: { channel: "wecom", target: "store-yiwu" },
        },
        {
          orgId: "627150985244678",
          storeName: "荷塘悦色园中园店",
          rawAliases: ["园中园店"],
          notification: { channel: "wecom", target: "store-yzy" },
        },
      ],
    });
    const now = new Date("2026-03-30T09:00:00+08:00");

    expect(
      resolveHetangNaturalLanguageCommand({
        config,
        content: "义乌店和园中园店昨天营收对比",
        now,
      }),
    ).toEqual({
      action: "query",
      args: "query 义乌店和园中园店昨天营收对比",
      commandBody: "/hetang query 义乌店和园中园店昨天营收对比",
    });

    expect(
      resolveHetangNaturalLanguageCommand({
        config,
        content: "昨天五店营收排名",
        now,
      }),
    ).toEqual({
      action: "query",
      args: "query 昨天五店营收排名",
      commandBody: "/hetang query 昨天五店营收排名",
    });
  });

  it("recognizes safe shortened store aliases in natural language queries", () => {
    const config = buildConfig({
      stores: [
        {
          orgId: "627150985244677",
          storeName: "荷塘悦色义乌店",
          rawAliases: ["义乌店"],
          notification: { channel: "wecom", target: "store-yiwu" },
        },
        {
          orgId: "627150985244678",
          storeName: "荷塘悦色园中园店",
          rawAliases: ["园中园店"],
          notification: { channel: "wecom", target: "store-yzy" },
        },
      ],
    });
    const now = new Date("2026-03-30T09:00:00+08:00");

    expect(
      resolveHetangNaturalLanguageCommand({
        config,
        content: "园中园昨天客流量多少",
        now,
      }),
    ).toEqual({
      action: "query",
      args: "query 园中园昨天客流量多少",
      commandBody: "/hetang query 园中园昨天客流量多少",
    });
  });

  it("ignores ordinary chat and explicit slash commands", () => {
    const config = buildConfig();
    const now = new Date("2026-03-30T09:00:00+08:00");

    expect(
      resolveHetangNaturalLanguageCommand({
        config,
        content: "今天天气怎么样",
        now,
      }),
    ).toBeNull();
    expect(
      resolveHetangNaturalLanguageCommand({
        config,
        content: "/hetang report 义乌店",
        now,
      }),
    ).toBeNull();
  });
});

describe("resolveLegacyInboundRouteSnapshot", () => {
  const config = buildConfig();
  const now = new Date("2026-03-30T09:00:00+08:00");

  it("attaches a serving capability id to direct metric queries", () => {
    const snapshot = resolveLegacyInboundRouteSnapshot({
      config,
      text: "义乌店昨天营收多少",
      now,
      binding: null,
    });

    expect(snapshot).toEqual({
      lane: "query",
      kind: "query",
      action: "summary",
      capabilityId: "store_day_summary_v1",
    });
  });

  it("attaches the customer profile capability to customer profile lookups", () => {
    const snapshot = resolveLegacyInboundRouteSnapshot({
      config,
      text: "义乌店近30天尾号7500客户画像",
      now,
      binding: null,
    });

    expect(snapshot).toEqual({
      lane: "query",
      kind: "query",
      action: "profile",
      capabilityId: "customer_profile_lookup_v1",
    });
  });

  it("treats 哪个门店须重点关注 as an HQ portfolio ranking instead of missing-time guidance", () => {
    const snapshot = resolveLegacyInboundRouteSnapshot({
      config: buildConfig({
        stores: [
          {
            orgId: "627150985244677",
            storeName: "荷塘悦色义乌店",
            rawAliases: ["义乌店"],
            notification: { channel: "wecom", target: "store-yiwu" },
          },
          {
            orgId: "627150985244678",
            storeName: "荷塘悦色华美店",
            rawAliases: ["华美店"],
            notification: { channel: "wecom", target: "store-huamei" },
          },
          {
            orgId: "627150985244679",
            storeName: "荷塘悦色园中园店",
            rawAliases: ["园中园店"],
            notification: { channel: "wecom", target: "store-yuanzhongyuan" },
          },
          {
            orgId: "627150985244680",
            storeName: "荷塘悦色迎宾店",
            rawAliases: ["迎宾店"],
            notification: { channel: "wecom", target: "store-yingbin" },
          },
          {
            orgId: "627150985244681",
            storeName: "荷塘悦色锦苑店",
            rawAliases: ["锦苑店"],
            notification: { channel: "wecom", target: "store-jinyuan" },
          },
        ],
      }),
      text: "哪个门店须重点关注",
      now,
      binding: {
        channel: "wecom",
        senderId: "hq-1",
        employeeName: "总部甲",
        role: "hq",
        isActive: true,
        scopeOrgIds: [
          "627150985244677",
          "627150985244678",
          "627150985244679",
          "627150985244680",
          "627150985244681",
        ],
      },
    });

    expect(snapshot).toEqual({
      lane: "query",
      kind: "query",
      action: "ranking",
      capabilityId: "hq_window_ranking_v1",
    });
  });
});

describe("createHetangInboundClaimHandler", () => {
  it("claims a matched report request and replies with the built report even when scheduled reporting is disabled", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "hq",
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "查一下义乌店昨天日报",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "627150985244677",
        bizDate: "2026-03-29",
      }),
    );
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: "义乌店日报",
    });
  });

  it("replies with concrete metric values for direct metric questions", async () => {
    const runtime = buildRuntime();
    runtime.buildReport.mockResolvedValue({
      orgId: "627150985244677",
      storeName: "荷塘悦色义乌店",
      bizDate: "2026-03-29",
      metrics: {
        upClockRecordCount: 10,
        pointClockRecordCount: 4,
        pointClockRate: 0.4,
        addClockRecordCount: 2,
        addClockRate: 0.2,
      },
      alerts: [],
      suggestions: [],
      markdown: "义乌店日报",
      complete: true,
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "hq",
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店昨日的加钟率 点钟率如何",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("点钟率"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("40.0%");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("20.0%");
  });

  it("lets a bound single-store manager ask without naming the store", async () => {
    const runtime = buildRuntime();
    runtime.buildReport.mockResolvedValue({
      orgId: "627150985244677",
      storeName: "荷塘悦色义乌店",
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 1280,
      },
      alerts: [],
      suggestions: [],
      markdown: "义乌店日报",
      complete: true,
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "zhangxiaobing",
      employeeName: "张晓冰",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "zhangxiaobing",
        content: "昨天营收",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(runtime.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "627150985244677",
        bizDate: "2026-03-29",
      }),
    );
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("服务营收");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("1280.00 元");
  });

  it("claims who-are-you asks for headquarters users with an hq persona reply", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "hq",
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
        senderId: "ZhangZhen",
        content: "你是谁",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.buildReport).not.toHaveBeenCalled();
    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-hq",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("连锁经营参谋"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("张震");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("荷塘AI小助手");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("五店经营");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("AI 总经办");
  });

  it("claims who-are-you asks for store managers with a store persona reply", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "zhangxiaobing",
      employeeName: "张晓冰",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-store",
        senderId: "zhangxiaobing",
        content: "你是谁",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-store",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.buildReport).not.toHaveBeenCalled();
    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-store",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("门店经营参谋"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("张晓冰");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("荷塘AI小助手");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("荷塘悦色义乌店");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("日报、周度复盘");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("AI 总经办");
  });

  it("auto-provisions a roster-matched manager on first contact using senderName", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(null);
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-auto-manager",
        senderId: "shen-zhihao-userid",
        senderName: "申志豪-义乌店-经理-A6",
        content: "你是谁",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-auto-manager",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.grantEmployeeBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "wecom",
        senderId: "shen-zhihao-userid",
        employeeName: "申志豪",
        role: "manager",
        scopeOrgIds: ["627150985244677"],
        isActive: true,
      }),
    );
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("门店经营参谋");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("申志豪");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("荷塘AI小助手");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("荷塘悦色义乌店");
  });

  it("auto-provisions a roster-matched staff user for ordinary QA-only access", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(null);
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-auto-staff",
        senderId: "li-xiaofei-userid",
        senderName: "李小飞-郑州区运营总",
        content: "你是谁",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-auto-staff",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.grantEmployeeBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "wecom",
        senderId: "li-xiaofei-userid",
        employeeName: "李小飞",
        role: "staff",
        scopeOrgIds: [],
        isActive: true,
      }),
    );
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("荷塘AI小助手");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("李小飞");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("普通问答权限");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("还没绑定经营权限");
  });

  it("queues deep-analysis reviews and immediately replies with progress copy", async () => {
    const runtime = buildRuntime();
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店近7天经营复盘",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "store_review_async_v1",
        orgId: "627150985244677",
        rawText: "义乌店近7天经营复盘",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
        subscribeToCompletion: true,
        notification: {
          channel: "wecom",
          target: "conversation-yiwu",
          accountId: "default",
          threadId: undefined,
        },
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("正在生成荷塘悦色义乌店近7天经营复盘"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("阶段进度");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain(
      "先看营收、团购转化、会员留存和技师表现",
    );
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("完成后会先回一条摘要");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("预计需要");
  });

  it("returns a business-friendly queue-limit hint when deep-analysis queue is saturated", async () => {
    const runtime = buildRuntime();
    runtime.enqueueAnalysisJob.mockRejectedValue({
      code: "HETANG_ANALYSIS_QUEUE_LIMIT",
      orgId: "627150985244677",
      pendingCount: 20,
      limit: 20,
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店近7天经营复盘",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("深度复盘当前排队较满");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("20/20");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("先用快查问题拿到第一版经营判断");
  });

  it("keeps boss-style monthly review asks on the fast sync path", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "manager",
      orgId: "627150985244677",
      scopeOrgIds: ["627150985244677"],
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "本月经营怎么样",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("正在生成");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("阶段进度");
  });

  it("keeps 近30天盘子稳不稳 style asks on the fast sync path", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "manager",
      orgId: "627150985244677",
      scopeOrgIds: ["627150985244677"],
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "近30天盘子稳不稳",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("我先去看");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("阶段进度");
  });

  it("routes weekly problem-diagnosis asks into the async deep-analysis path", async () => {
    const runtime = buildRuntime();
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店上周的经营数据，以及问题所在",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "store_review_async_v1",
        orgId: "627150985244677",
        rawText: "义乌店上周的经营数据，以及问题所在",
        timeFrameLabel: "上周",
        startBizDate: "2026-03-16",
        endBizDate: "2026-03-22",
      }),
    );
    expect(runtime.buildReport).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("正在生成荷塘悦色义乌店上周经营复盘");
  });

  it("keeps boss-style weekly review asks on the fast sync path", async () => {
    const runtime = buildRuntime();
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店上周经营怎么样",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("正在生成");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("阶段进度");
  });

  it("keeps HQ portfolio asks on the fast sync path", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "hq",
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
      scopeOrgIds: [
        "627150985244677",
        "627150985244678",
        "627150985244679",
        "627150985244680",
        "627150985244681",
      ],
    });
    runtime.enqueueAnalysisJob.mockResolvedValue({
      jobId: "JOB-HQ-1",
      status: "pending",
      queueDisposition: "created",
      storeName: "五店",
      timeFrameLabel: "近30天",
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        stores: [
          {
            orgId: "627150985244677",
            storeName: "荷塘悦色义乌店",
            rawAliases: ["义乌店"],
            notification: { channel: "wecom", target: "store-yiwu" },
          },
          {
            orgId: "627150985244678",
            storeName: "荷塘悦色华美店",
            rawAliases: ["华美店"],
            notification: { channel: "wecom", target: "store-huamei" },
          },
          {
            orgId: "627150985244679",
            storeName: "荷塘悦色园中园店",
            rawAliases: ["园中园店"],
            notification: { channel: "wecom", target: "store-yuanzhongyuan" },
          },
          {
            orgId: "627150985244680",
            storeName: "荷塘悦色迎宾店",
            rawAliases: ["迎宾店"],
            notification: { channel: "wecom", target: "store-yingbin" },
          },
          {
            orgId: "627150985244681",
            storeName: "荷塘悦色锦苑店",
            rawAliases: ["锦苑店"],
            notification: { channel: "wecom", target: "store-jinyuan" },
          },
        ],
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
        senderId: "ZhangZhen",
        content: "近30天五店盘子稳不稳，哪家店最近最危险",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("阶段进度");
  });

  it("asks for a split follow-up when one sentence mixes HQ portfolio and single-store diagnosis", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "hq",
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
      scopeOrgIds: [
        "627150985244677",
        "627150985244678",
        "627150985244679",
        "627150985244680",
        "627150985244681",
      ],
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        stores: [
          {
            orgId: "627150985244677",
            storeName: "荷塘悦色义乌店",
            rawAliases: ["义乌店"],
            notification: { channel: "wecom", target: "store-yiwu" },
          },
          {
            orgId: "627150985244678",
            storeName: "荷塘悦色华美店",
            rawAliases: ["华美店"],
            notification: { channel: "wecom", target: "store-huamei" },
          },
          {
            orgId: "627150985244679",
            storeName: "荷塘悦色园中园店",
            rawAliases: ["园中园店"],
            notification: { channel: "wecom", target: "store-yuanzhongyuan" },
          },
          {
            orgId: "627150985244680",
            storeName: "荷塘悦色迎宾店",
            rawAliases: ["迎宾店"],
            notification: { channel: "wecom", target: "store-yingbin" },
          },
          {
            orgId: "627150985244681",
            storeName: "荷塘悦色锦苑店",
            rawAliases: ["锦苑店"],
            notification: { channel: "wecom", target: "store-jinyuan" },
          },
        ],
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
        senderId: "ZhangZhen",
        content: "哪家店最危险，华美店具体哪里有问题",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-hq",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(runtime.buildReport).not.toHaveBeenCalled();
    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("同时包含五店全景和单店诊断");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("哪家店最危险");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("华美店近7天具体哪里有问题");
  });

  it("reuses completed deep-analysis results and replies immediately", async () => {
    const runtime = buildRuntime();
    runtime.enqueueAnalysisJob.mockResolvedValue({
      jobId: "JOB-1",
      status: "completed",
      queueDisposition: "reused-completed",
      storeName: "荷塘悦色义乌店",
      timeFrameLabel: "近7天",
      resultText: "七日复盘结论",
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店近7天经营复盘",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: "七日复盘结论",
    });
  });

  it("renders structured completed deep-analysis payloads before replying", async () => {
    const runtime = buildRuntime();
    runtime.enqueueAnalysisJob.mockResolvedValue({
      jobId: "JOB-STRUCT",
      status: "completed",
      queueDisposition: "reused-completed",
      storeName: "荷塘悦色义乌店",
      timeFrameLabel: "近7天",
      resultText: JSON.stringify({
        summary: "近7天钟效走弱，晚场接待能力不足。",
        suggestions: ["面向近7天未复购会员，今天完成 20 人回访，目标把复购率提升 5 个点。"],
        markdown: [
          "结论摘要：近7天钟效走弱，晚场接待能力不足。",
          "",
          "店长动作建议：",
          "1. 面向近7天未复购会员，今天完成 20 人回访，目标把复购率提升 5 个点。",
        ].join("\n"),
      }),
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店近7天经营复盘",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("结论摘要：近7天钟效走弱"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain('{"summary"');
  });

  it("reuses running deep-analysis jobs and replies with a status-check hint", async () => {
    const runtime = buildRuntime();
    runtime.enqueueAnalysisJob.mockResolvedValue({
      jobId: "JOB-9",
      status: "running",
      queueDisposition: "reused-running",
      storeName: "荷塘悦色义乌店",
      timeFrameLabel: "近7天",
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店近7天经营复盘",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("JOB-9");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("回推队列");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("阶段进度");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("/hetang analysis status JOB-9");
  });

  it("routes birthday-member lookups into the query path and replies with the birthday list", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "hq",
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.listCurrentMembers.mockResolvedValue([
      {
        orgId: "627150985244677",
        memberId: "M-001",
        name: "王女士",
        phone: "13800001111",
        storedAmount: 2680,
        consumeAmount: 5420,
        createdTime: "2025-11-01 10:00:00",
        lastConsumeTime: "2026-01-03 18:10:00",
        silentDays: 91,
        rawStoreName: "荷塘悦色义乌店",
        rawJson: JSON.stringify({
          Birthday: "1990-04-06",
        }),
      },
    ]);
    runtime.listCustomerProfile90dByDateRange.mockResolvedValue([
      {
        orgId: "627150985244677",
        windowEndBizDate: "2026-04-04",
        customerIdentityKey: "member:M-001",
        customerIdentityType: "member",
        customerDisplayName: "王女士",
        memberId: "M-001",
        memberCardNo: "yw001",
        referenceCode: "yw001",
        memberLabel: "钻卡",
        phone: "13800001111",
        identityStable: true,
        segmentEligible: true,
        firstBizDate: "2025-11-01",
        lastBizDate: "2026-01-03",
        daysSinceLastVisit: 91,
        visitCount30d: 0,
        visitCount90d: 4,
        payAmount30d: 0,
        payAmount90d: 1260,
        memberPayAmount90d: 1260,
        groupbuyAmount90d: 0,
        directPayAmount90d: 0,
        distinctTechCount90d: 1,
        topTechCode: "T008",
        topTechName: "白慧慧",
        topTechVisitCount90d: 4,
        topTechVisitShare90d: 1,
        recencySegment: "sleeping-91-180d",
        frequencySegment: "high-4-plus",
        monetarySegment: "high-1000-plus",
        paymentSegment: "member-only",
        techLoyaltySegment: "single-tech-loyal",
        primarySegment: "important-reactivation-member",
        tagKeys: ["important-reactivation-member"],
        currentStoredAmount: 2680,
        currentConsumeAmount: 5420,
        currentCreatedTime: "2025-11-01 10:00:00",
        currentLastConsumeTime: "2026-01-03 18:10:00",
        currentSilentDays: 91,
        firstGroupbuyBizDate: undefined,
        revisitWithin7d: false,
        revisitWithin30d: false,
        cardOpenedWithin7d: false,
        storedValueConvertedWithin7d: false,
        memberPayConvertedWithin30d: false,
        highValueMemberWithin30d: false,
      },
    ]);
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-05T01:00:08+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "义乌店 明天 过生日的 顾客 有哪些?",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("生日会员名单"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("王女士");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("沉默 91 天");
  });

  it("claims unsupported customer-satisfaction asks with a fast deterministic reply", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-05T01:00:08+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "义乌店近30天顾客满意度怎么样?",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("还没接入顾客评价"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("满意度");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("当前已支持");
  });

  it("answers capability-surface asks with a deterministic supported/unsupported capability list", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-05T01:00:08+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "你现在支持哪些能力",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("当前已支持");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("暂未接入");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("昨天营收");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("生日会员名单");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("会员来源沉默");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("卡型充值");
  });

  it("claims unmatched business asks with a deterministic rephrase guide instead of falling through", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-05T01:00:08+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "帮我总结一下这个月经营策略",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message: expect.stringContaining("先别空讲策略"),
    });
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("当前已支持");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("暂未接入");
  });

  it("claims store-scoped but metric-missing business asks with the unified deterministic clarification", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-05T01:00:08+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "义乌店昨天怎么样",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply).toHaveBeenCalledWith({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
      message:
        "这句话里的经营指标还不够清楚，请补一句想看营收、复购、储值、点钟率还是加钟率。",
    });
  });

  it("classifies customer-operation asks into a customer-specific missing-time guidance route", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const observedRoutes: Array<{ lane: string; kind: string }> = [];
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      observeRoute: (route) => {
        observedRoutes.push(route);
      },
      now: () => new Date("2026-04-05T01:00:08+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "义乌店顾客跟进重点",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(observedRoutes).toContainEqual(
      expect.objectContaining({
        lane: "meta",
        kind: "guidance_customer_missing_time_range",
        action: "clarify",
      }),
    );
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("召回/跟进口径");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("当前已支持");
  });

  it("keeps unmatched-but-business-like asks out of the generic unmatched fallback", async () => {
    const runtime = buildRuntime();
    runtime.buildReport.mockResolvedValue({
      orgId: "627150985244677",
      storeName: "荷塘悦色义乌店",
      bizDate: "2026-04-04",
      metrics: {
        serviceRevenue: 2680,
      },
      alerts: [],
      suggestions: [],
      markdown: "义乌店日报",
      complete: true,
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    (
      runtime as {
        resolveSemanticFallbackIntent?: ReturnType<typeof vi.fn>;
      }
    ).resolveSemanticFallbackIntent = vi.fn().mockResolvedValue({
      intent: {
        rawText: "这个月门店盘里收了多少",
        kind: "metric",
        explicitOrgIds: [],
        allStoresRequested: false,
        timeFrame: {
          kind: "single",
          bizDate: "2026-04-04",
          label: "昨天",
          days: 1,
        },
        metrics: [{ key: "serviceRevenue", label: "服务营收" }],
        unsupportedMetrics: [],
        mentionsCompareKeyword: false,
        mentionsRankingKeyword: false,
        mentionsTrendKeyword: false,
        mentionsAnomalyKeyword: false,
        mentionsRiskKeyword: false,
        mentionsAdviceKeyword: false,
        mentionsReportKeyword: false,
        routeConfidence: "medium",
        semanticSlots: {
          store: {
            scope: "implicit",
            orgIds: [],
          },
          object: "store",
          action: "metric",
          metricKeys: ["serviceRevenue"],
          time: {
            kind: "single",
            startBizDate: "2026-04-04",
            endBizDate: "2026-04-04",
            label: "昨天",
            days: 1,
          },
        },
      },
    });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-05T01:00:08+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "这个月门店盘里收了多少",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("还差时间范围");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("我当前主要处理荷塘门店经营数据问题");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("当前已支持");
  });

  it("formats pasted raw daily-report facts into a structured daily report instead of routing them into a month review", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-12T10:36:04+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: [
          "我需要一份，下面的日报，",
          "2026年4月11日义乌店经营数据报告",
          "技师出勤：没有专职SPA师",
          "实力23位/明星9位/SPA0位/采耳3位/小项0位/共计35位",
          "实力钟数：排44个/选0个/点18个/加2个/小计64个",
          "线上：美团1414元+抖音192元，小计1606元",
          "总营业额:32043元",
        ].join("\n"),
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("2026年4月11日义乌店经营数据报告");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("- 技师出勤：");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("- 技师出勤：没有专职SPA师");
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("- 总营业额：32043元");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("经营复盘");
  });

  it("answers negative no-review constraints with a tight clarification instead of falling back to capability help", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-12T10:36:21+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "不要给义乌店经营复盘",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("不按经营复盘");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("当前已支持");
  });

  it("answers correction chatter with a short repair reply instead of a capability template", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-13T20:10:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "又乱回了，别套模板",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply.mock.calls[0]?.[0]?.message).toContain("不再回能力清单");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("当前已支持");
  });

  it("replies with a shared clarification when a store question is missing the time scope", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["627150985244677"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-04-13T21:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "manager-1",
        content: "义乌店营收怎么样",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply.mock.calls[0]?.[0]?.message).toBe("你要看荷塘悦色义乌店昨天、近7天还是近30天？");
    expect(sendReply.mock.calls[0]?.[0]?.message).not.toContain("当前已支持");
  });

  it("replies with a clear fallback instead of staying silent for unmatched wecom chatter", async () => {
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig(),
      runtime: buildRuntime() as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
        senderId: "ZhangZhen",
        content: "帮我总结一下今天会上的发言",
        isGroup: false,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(sendReply.mock.calls[0]?.[0]).toMatchObject({
      channel: "wecom",
      target: "conversation-yiwu",
      accountId: "default",
      threadId: undefined,
    });
    expect(String(sendReply.mock.calls[0]?.[0]?.message ?? "")).toContain(
      "我当前主要处理荷塘门店经营数据问题",
    );
  });

  it("does not silently drop a group business query when wasMentioned is absent", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ZhangZhen",
      employeeName: "张震",
      role: "manager",
      orgId: "627150985244677",
      scopeOrgIds: ["627150985244677"],
      isActive: true,
      hourlyQuota: 20,
      dailyQuota: 100,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const handler = createHetangInboundClaimHandler({
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
      }),
      runtime: runtime as never,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sendReply,
      now: () => new Date("2026-03-30T09:00:00+08:00"),
    });

    const result = await handler(
      {
        channel: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu-group",
        senderId: "ZhangZhen",
        content: "义乌店哪种来源的会员更容易沉默",
        isGroup: true,
      },
      {
        channelId: "wecom",
        accountId: "default",
        conversationId: "conversation-yiwu-group",
      },
    );

    expect(result).toEqual({ handled: true });
    expect(sendReply).toHaveBeenCalledTimes(1);
    expect(String(sendReply.mock.calls[0]?.[0]?.message ?? "")).toContain("来源");
  });
});
