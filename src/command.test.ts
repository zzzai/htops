import { describe, expect, it, vi } from "vitest";
import { runHetangCommand, runHetangTypedQuery } from "./command.js";
import { resolveHetangOpsConfig } from "./config.js";

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
        storeName: "一号店",
        notification: { channel: "wecom", target: "store-1001" },
      },
      {
        orgId: "1002",
        storeName: "二号店",
        notification: { channel: "wecom", target: "store-1002" },
      },
      {
        orgId: "1003",
        storeName: "三号店",
        notification: { channel: "wecom", target: "store-1003" },
      },
      {
        orgId: "1004",
        storeName: "四号店",
        notification: { channel: "wecom", target: "store-1004" },
      },
      {
        orgId: "1005",
        storeName: "五号店",
        notification: { channel: "wecom", target: "store-1005" },
      },
    ],
    ...overrides,
  });
}

function buildRuntime() {
  return {
    doctor: vi.fn().mockResolvedValue("doctor ok"),
    syncStores: vi.fn().mockResolvedValue(["sync ok"]),
    buildReport: vi.fn().mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-03-29",
      metrics: {},
      alerts: [],
      suggestions: [],
      markdown: "一号店日报",
      complete: true,
    }),
    getEmployeeBinding: vi.fn(),
    getCommandUsage: vi.fn(),
    getActionItem: vi.fn(),
    createAction: vi.fn(),
    listActions: vi.fn(),
    updateActionStatus: vi.fn(),
    getLearningSummary: vi.fn(),
    listAnalysisJobs: vi.fn(),
    getAnalysisJob: vi.fn(),
    getQueueStatus: vi.fn(),
    listAnalysisDeadLetters: vi.fn(),
    replayAnalysisDeadLetter: vi.fn(),
    cleanupStaleInvalidChatidSubscriberResiduals: vi.fn(),
    enqueueAnalysisJob: vi.fn().mockResolvedValue({
      jobId: "JOB-ASYNC-1",
      status: "pending",
      queueDisposition: "created",
      storeName: "一号店",
      timeFrameLabel: "上周",
    }),
    retryAnalysisJob: vi.fn(),
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    getConversationReviewSummary: vi.fn(),
    getMemberReactivationExecutionSummary: vi.fn(),
    listMemberReactivationExecutionTasks: vi.fn(),
    listTechLeaderboard: vi.fn(),
    upsertMemberReactivationExecutionFeedback: vi.fn(),
    captureCustomerServiceObservation: vi.fn(),
    upsertControlTowerSetting: vi.fn(),
    recordCommandAudit: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runHetangCommand access control", () => {
  it("denies an unbound requester before returning store data", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(null);
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report",
      channel: "wecom",
      senderId: "user-unbound",
      commandBody: "/hetang report",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("未绑定");
    expect(runtime.buildReport).not.toHaveBeenCalled();
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "wecom",
        senderId: "user-unbound",
        action: "report",
        decision: "denied",
      }),
    );
  });

  it("lets a manager omit the store name and defaults the report to the bound store", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 1, dailyCount: 4 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toBe("一号店日报");
    expect(runtime.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
      }),
    );
  });

  it("defaults an early-morning report to the most recently completed operational day", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 1, dailyCount: 4 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report",
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(text).toBe("一号店日报");
    expect(runtime.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-03-30",
      }),
    );
  });

  it("denies a manager who asks for another store", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 1, dailyCount: 4 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report 二号店",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report 二号店",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("绑定门店");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("blocks a manager after the hourly quota is exhausted", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 6, dailyCount: 7 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("限额");
    expect(runtime.buildReport).not.toHaveBeenCalled();
  });

  it("applies control-tower quota overrides before denying a report request", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 6, dailyCount: 30 });
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "quota.hourlyLimit": 12,
      "quota.dailyLimit": 60,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toBe("一号店日报");
    expect(runtime.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
      }),
    );
  });

  it("allows an hq user to run the status command", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      orgId: undefined,
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "status",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang status",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toBe("doctor ok");
    expect(runtime.doctor).toHaveBeenCalled();
  });

  it("still allows an on-demand report when scheduled reporting is disabled for bootstrap", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
        stores: [
          {
            orgId: "1001",
            storeName: "一号店",
          },
        ],
      }),
      args: "report",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toBe("一号店日报");
    expect(runtime.buildReport).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
      }),
    );
  });

  it("does not render a formal daily report when the requested business day is not fully synced", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-03-31",
      metrics: {
        incompleteSync: true,
      },
      alerts: [
        {
          code: "data-gap",
          severity: "critical",
          message: "该营业日数据尚未完成同步。",
        },
      ],
      suggestions: [],
      markdown: "一号店日报",
      complete: false,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report 一号店 2026-03-31",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report 一号店 2026-03-31",
      now: new Date("2026-04-01T19:17:00+08:00"),
    });

    expect(text).toContain("2026-03-31");
    expect(text).toContain("尚未完成同步");
    expect(text).not.toBe("一号店日报");
  });

  it("blocks sync when sync is disabled for access-only bootstrap", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig({
        reporting: { enabled: false },
        sync: { enabled: false },
        stores: [
          {
            orgId: "1001",
            storeName: "一号店",
          },
        ],
      }),
      args: "sync",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang sync",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("未启用");
    expect(runtime.syncStores).not.toHaveBeenCalled();
  });

  it("blocks sync with a clear message when API credentials are missing", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig({
        api: {},
      }),
      args: "sync",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang sync",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("API 同步凭证");
    expect(runtime.syncStores).not.toHaveBeenCalled();
  });

  it("asks a multi-scope manager to specify a store for report", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ops-1",
      employeeName: "区域运营",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001", "1002"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report",
      channel: "wecom",
      senderId: "ops-1",
      commandBody: "/hetang report",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("指定门店");
    expect(runtime.buildReport).not.toHaveBeenCalled();
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "report",
        decision: "denied",
        effectiveOrgId: undefined,
        reason: "manager-multi-store-requires-org",
      }),
    );
  });

  it("renders Chinese name and store names in whoami", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "ops-1",
      employeeName: "李人培",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001", "1002"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 2, dailyCount: 5 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "whoami",
      channel: "wecom",
      senderId: "ops-1",
      commandBody: "/hetang whoami",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("身份：李人培");
    expect(text).toContain("门店：一号店、二号店");
    expect(text).toContain("小时用量：2/6");
    expect(text).toContain("今日用量：5/30");
  });

  it("renders headquarters access in whoami for an unscoped hq user", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "张震",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 1 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "whoami",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang whoami",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("身份：张震");
    expect(text).toContain("门店：总部（可查全部门店）");
  });

  it("returns a concise metric answer when report includes explicit metric intents", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
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
      markdown: "一号店日报",
      complete: true,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report 一号店 2026-03-29 点钟率 加钟率",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang report 一号店 2026-03-29 点钟率 加钟率",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("一号店 2026-03-29 指标查询");
    expect(text).toContain("点钟率");
    expect(text).toContain("40.0%");
    expect(text).toContain("加钟率");
    expect(text).toContain("20.0%");
    expect(text).toContain("按技师上钟明细条数口径");
  });

  it("explains why utilization rate cannot be quoted when the denominator is missing", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report 一号店 2026-03-29 上钟率",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang report 一号店 2026-03-29 上钟率",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("上钟率");
    expect(text).toContain("未接入排班可上钟总数");
  });

  it("answers store compare queries with concrete metric deltas", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockImplementation(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) => {
        if (orgId === "1001") {
          return {
            orgId,
            storeName: "一号店",
            bizDate,
            metrics: {
              serviceRevenue: 1200,
              totalClockCount: 30,
              clockEffect: 40,
            },
            alerts: [],
            suggestions: [],
            markdown: "一号店日报",
            complete: true,
          };
        }
        return {
          orgId,
          storeName: "二号店",
          bizDate,
          metrics: {
            serviceRevenue: 900,
            totalClockCount: 18,
            clockEffect: 50,
          },
          alerts: [],
          suggestions: [],
          markdown: "二号店日报",
          complete: true,
        };
      },
    );

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店和二号店昨天营收对比",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang query 一号店和二号店昨天营收对比",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("一号店 vs 二号店");
    expect(text).toContain("服务营收");
    expect(text).toContain("1200.00 元");
    expect(text).toContain("900.00 元");
    expect(text).toContain("差额");
  });

  it("returns store ranking queries in descending order", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockImplementation(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) => {
        const revenueMap: Record<string, number> = {
          "1001": 900,
          "1002": 1200,
          "1003": 1100,
          "1004": 500,
          "1005": 300,
        };
        const storeNameMap: Record<string, string> = {
          "1001": "一号店",
          "1002": "二号店",
          "1003": "三号店",
          "1004": "四号店",
          "1005": "五号店",
        };
        return {
          orgId,
          storeName: storeNameMap[orgId],
          bizDate,
          metrics: {
            serviceRevenue: revenueMap[orgId],
            totalClockCount: revenueMap[orgId] / 30,
            clockEffect: 30,
          },
          alerts: [],
          suggestions: [],
          markdown: `${storeNameMap[orgId]}日报`,
          complete: true,
        };
      },
    );

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 昨天五店营收排名",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang query 昨天五店营收排名",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("5店 服务营收排名");
    expect(text).toContain("1. 二号店");
    expect(text).toContain("2. 三号店");
    expect(text).toContain("5. 五号店");
  });

  it("returns trend queries as a daily series for the selected metric", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockImplementation(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) => {
        const revenueMap: Record<string, number> = {
          "2026-03-23": 600,
          "2026-03-24": 650,
          "2026-03-25": 700,
          "2026-03-26": 680,
          "2026-03-27": 720,
          "2026-03-28": 740,
          "2026-03-29": 780,
        };
        return {
          orgId,
          storeName: "一号店",
          bizDate,
          metrics: {
            serviceRevenue: revenueMap[bizDate],
            totalClockCount: revenueMap[bizDate] / 30,
            clockEffect: 30,
          },
          alerts: [],
          suggestions: [],
          markdown: "一号店日报",
          complete: true,
        };
      },
    );

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 近7天营收趋势",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang query 近7天营收趋势",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("一号店 近7天 服务营收趋势");
    expect(text).toContain("2026-03-23");
    expect(text).toContain("2026-03-29");
    expect(text).toContain("780.00 元");
  });

  it("routes weekly diagnostic query commands into async analysis instead of sync trend output", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店上周的经营数据，以及问题所在",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang query 一号店上周的经营数据，以及问题所在",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(runtime.enqueueAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "store_review_async_v1",
        orgId: "1001",
        rawText: "一号店上周的经营数据，以及问题所在",
        timeFrameLabel: "上周",
        startBizDate: "2026-03-16",
        endBizDate: "2026-03-22",
      }),
    );
    expect(text).toContain("正在生成一号店上周经营复盘");
    expect(text).toContain("阶段进度");
    expect(text).toContain("先看营收、团购转化、会员留存和技师表现");
    expect(text).toContain("预计需要");
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "query",
        decision: "allowed",
        responseExcerpt: expect.stringContaining("正在生成一号店上周经营复盘"),
      }),
    );
  });

  it("returns a queue-limit hint when async analysis queue is full", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.enqueueAnalysisJob.mockRejectedValue({
      code: "HETANG_ANALYSIS_QUEUE_LIMIT",
      orgId: "1001",
      pendingCount: 20,
      limit: 20,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店上周的经营数据，以及问题所在",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang query 一号店上周的经营数据，以及问题所在",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("深度复盘当前排队较满");
    expect(text).toContain("20/20");
    expect(text).toContain("先用快查问题拿到第一版经营判断");
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "query",
        decision: "allowed",
        responseExcerpt: expect.stringContaining("深度复盘当前排队较满"),
      }),
    );
  });

  it("keeps boss-style weekly review query commands on the fast sync path", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店上周经营怎么样",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang query 一号店上周经营怎么样",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(runtime.buildReport).toHaveBeenCalled();
    expect(text).not.toContain("正在生成");
    expect(text).not.toContain("阶段进度");
  });

  it("keeps HQ portfolio query commands on the fast sync path", async () => {
    const runtime = buildRuntime();
    runtime.enqueueAnalysisJob.mockResolvedValue({
      jobId: "JOB-HQ-ASYNC-1",
      status: "pending",
      queueDisposition: "created",
      storeName: "五店",
      timeFrameLabel: "近30天",
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
      scopeOrgIds: ["1001", "1002", "1003", "1004", "1005"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 近30天五店盘子稳不稳，哪家店最近最危险",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang query 近30天五店盘子稳不稳，哪家店最近最危险",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(text).toContain("总部经营全景");
    expect(text).toContain("最危险门店");
    expect(text).toContain("下周总部优先动作");
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "query",
        decision: "allowed",
        requestedOrgId: undefined,
        effectiveOrgId: "1001,1002,1003,1004,1005",
        reason: "hq-allowed",
      }),
    );
  });

  it("keeps boss-style monthly review query commands on the fast sync path", async () => {
    const runtime = buildRuntime();
    runtime.enqueueAnalysisJob.mockResolvedValue({
      jobId: "JOB-ASYNC-MONTH",
      status: "pending",
      queueDisposition: "created",
      storeName: "一号店",
      timeFrameLabel: "本月",
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 本月经营怎么样",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang query 本月经营怎么样",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(runtime.buildReport).toHaveBeenCalled();
    expect(text).not.toContain("正在生成");
  });

  it("interprets cross-store boss questions like 哪家店最近最危险 as a portfolio risk review", async () => {
    const runtime = buildRuntime();
    runtime.enqueueAnalysisJob.mockResolvedValue({
      jobId: "JOB-HQ-RISK",
      status: "pending",
      queueDisposition: "created",
      storeName: "五店",
      timeFrameLabel: "近7天",
    });
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockImplementation(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) => {
        const alertMap: Record<
          string,
          Array<{ code: string; severity: "info" | "warn" | "critical"; message: string }>
        > = {
          "1001": [],
          "1002": [{ code: "warn-low-revisit", severity: "warn", message: "团购复到店偏弱" }],
          "1003": [
            { code: "critical-revenue", severity: "critical", message: "服务营收连续下滑" },
            { code: "warn-members", severity: "warn", message: "沉默会员占比偏高" },
          ],
          "1004": [{ code: "info-watch", severity: "info", message: "需要关注晚场承接" }],
          "1005": [],
        };
        const metricsMap: Record<string, Record<string, number | null>> = {
          "1001": {
            serviceRevenue: bizDate === "2026-03-01" ? 1200 : 1180,
            totalClockCount: 38,
            clockEffect: bizDate === "2026-03-01" ? 34 : 33.8,
            addClockRate: 0.38,
            sleepingMemberRate: 0.1,
            groupbuy7dRevisitRate: 0.44,
            groupbuy7dStoredValueConversionRate: 0.24,
          },
          "1002": {
            serviceRevenue: bizDate === "2026-03-01" ? 1100 : 1010,
            totalClockCount: 34,
            clockEffect: bizDate === "2026-03-01" ? 33 : 31.2,
            addClockRate: 0.29,
            sleepingMemberRate: 0.13,
            groupbuy7dRevisitRate: 0.33,
            groupbuy7dStoredValueConversionRate: 0.18,
          },
          "1003": {
            serviceRevenue: bizDate === "2026-03-01" ? 1350 : 980,
            totalClockCount: 32,
            clockEffect: bizDate === "2026-03-01" ? 39 : 30.6,
            addClockRate: 0.22,
            sleepingMemberRate: 0.19,
            groupbuy7dRevisitRate: 0.25,
            groupbuy7dStoredValueConversionRate: 0.12,
          },
          "1004": {
            serviceRevenue: bizDate === "2026-03-01" ? 1080 : 1040,
            totalClockCount: 31,
            clockEffect: bizDate === "2026-03-01" ? 34.5 : 33.5,
            addClockRate: 0.31,
            sleepingMemberRate: 0.12,
            groupbuy7dRevisitRate: 0.39,
            groupbuy7dStoredValueConversionRate: 0.2,
          },
          "1005": {
            serviceRevenue: bizDate === "2026-03-01" ? 1250 : 1260,
            totalClockCount: 39,
            clockEffect: bizDate === "2026-03-01" ? 35.2 : 35.4,
            addClockRate: 0.41,
            sleepingMemberRate: 0.08,
            groupbuy7dRevisitRate: 0.48,
            groupbuy7dStoredValueConversionRate: 0.27,
          },
        };
        const storeName =
          buildConfig().stores.find((store) => store.orgId === orgId)?.storeName ?? orgId;
        return {
          orgId,
          storeName,
          bizDate,
          metrics: metricsMap[orgId] as never,
          alerts: alertMap[orgId] ?? [],
          suggestions: [],
          markdown: `${storeName}-${bizDate}`,
          complete: true,
        };
      },
    );

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 哪家店最近最危险",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang query 哪家店最近最危险",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(runtime.enqueueAnalysisJob).not.toHaveBeenCalled();
    expect(text).toContain("总部经营全景");
    expect(text).toContain("最危险门店");
    expect(text).toContain("下周总部优先动作");
  });

  it("explains anomaly queries with a driver breakdown grounded in available metrics", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockImplementation(
      async ({ orgId, bizDate }: { orgId: string; bizDate: string }) => {
        const metricsByDate: Record<string, Record<string, number>> = {
          "2026-03-23": { serviceRevenue: 1000, totalClockCount: 30, clockEffect: 33.33 },
          "2026-03-24": { serviceRevenue: 980, totalClockCount: 29, clockEffect: 33.79 },
          "2026-03-25": { serviceRevenue: 950, totalClockCount: 28, clockEffect: 33.93 },
          "2026-03-26": { serviceRevenue: 920, totalClockCount: 27, clockEffect: 34.07 },
          "2026-03-27": { serviceRevenue: 760, totalClockCount: 20, clockEffect: 38 },
          "2026-03-28": { serviceRevenue: 740, totalClockCount: 19, clockEffect: 38.95 },
          "2026-03-29": { serviceRevenue: 720, totalClockCount: 18, clockEffect: 40 },
          "2026-03-16": { serviceRevenue: 1020, totalClockCount: 31, clockEffect: 32.9 },
          "2026-03-17": { serviceRevenue: 1010, totalClockCount: 30, clockEffect: 33.67 },
          "2026-03-18": { serviceRevenue: 990, totalClockCount: 30, clockEffect: 33 },
          "2026-03-19": { serviceRevenue: 1000, totalClockCount: 31, clockEffect: 32.26 },
          "2026-03-20": { serviceRevenue: 980, totalClockCount: 30, clockEffect: 32.67 },
          "2026-03-21": { serviceRevenue: 1005, totalClockCount: 31, clockEffect: 32.42 },
          "2026-03-22": { serviceRevenue: 995, totalClockCount: 30, clockEffect: 33.17 },
        };
        return {
          orgId,
          storeName: "一号店",
          bizDate,
          metrics: {
            ...metricsByDate[bizDate],
            activeTechCount: bizDate >= "2026-03-23" ? 4 : 6,
            groupbuyOrderShare: bizDate >= "2026-03-23" ? 0.42 : 0.25,
            antiServiceRevenue: 0,
          },
          alerts: [],
          suggestions: [],
          markdown: "一号店日报",
          complete: true,
        };
      },
    );

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店近7天营收下滑原因",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang query 一号店近7天营收下滑原因",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("营收下滑");
    expect(text).toContain("总钟数");
    expect(text).toContain("钟效");
    expect(text).toContain("活跃技师");
  });

  it("returns risk and recommendation queries from the latest report context", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 850,
        totalClockCount: 20,
        clockEffect: 42.5,
      },
      alerts: [
        {
          code: "groupbuy-share-high",
          severity: "warn",
          message: "团购占比偏高，需盯留资和复到店。",
        },
      ],
      suggestions: ["先把团购客单独建回访名单，7 天内追二次到店。"],
      markdown: "一号店日报",
      complete: true,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店昨天风险和建议",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang query 一号店昨天风险和建议",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("风险");
    expect(text).toContain("建议");
    expect(text).toContain("团购占比偏高");
    expect(text).toContain("回访名单");
  });

  it("ranks technicians by field-backed metrics within the selected store", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.listTechLeaderboard = vi.fn().mockResolvedValue([
      {
        personCode: "t-1",
        personName: "技师甲",
        totalClockCount: 12,
        upClockRecordCount: 4,
        pointClockRecordCount: 3,
        pointClockRate: 0.75,
        addClockRecordCount: 2,
        addClockRate: 0.5,
        turnover: 960,
        commission: 360,
        marketRevenue: 120,
      },
      {
        personCode: "t-2",
        personName: "技师乙",
        totalClockCount: 10,
        upClockRecordCount: 5,
        pointClockRecordCount: 2,
        pointClockRate: 0.4,
        addClockRecordCount: 1,
        addClockRate: 0.2,
        turnover: 800,
        commission: 300,
        marketRevenue: 60,
      },
    ]);

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店昨天技师点钟率排名",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang query 一号店昨天技师点钟率排名",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("一号店 2026-03-29 技师点钟率排名");
    expect(text).toContain("1. 技师甲");
    expect(text).toContain("75.0%");
    expect(text).toContain("2. 技师乙");
  });

  it("answers member and payment-share queries from consume-detail payment splits", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 1000,
        memberPaymentAmount: 620,
        memberPaymentShare: 0.62,
        cashPaymentAmount: 80,
        cashPaymentShare: 0.08,
        wechatPaymentAmount: 100,
        wechatPaymentShare: 0.1,
        groupbuyAmount: 200,
        groupbuyAmountShare: 0.2,
      },
      alerts: [],
      suggestions: [],
      markdown: "一号店日报",
      complete: true,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店昨天会员消费占比 现金消费占比 微信支付占比 团购消费占比",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang query 一号店昨天会员消费占比 现金消费占比 微信支付占比 团购消费占比",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("会员消费占比: 62.0%");
    expect(text).toContain("现金消费占比: 8.0%");
    expect(text).toContain("微信支付占比: 10.0%");
    expect(text).toContain("团购消费占比: 20.0%");
  });

  it("treats generic payment-structure phrasing as a multi-metric payment breakdown query", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.buildReport.mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 1000,
        memberPaymentAmount: 620,
        memberPaymentShare: 0.62,
        cashPaymentAmount: 80,
        cashPaymentShare: 0.08,
        wechatPaymentAmount: 100,
        wechatPaymentShare: 0.1,
        alipayPaymentAmount: 0,
        alipayPaymentShare: 0,
        groupbuyAmount: 200,
        groupbuyAmountShare: 0.2,
      },
      alerts: [],
      suggestions: [],
      markdown: "一号店日报",
      complete: true,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "query 一号店昨天各种消费方式占比逐个列一下",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang query 一号店昨天各种消费方式占比逐个列一下",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("会员消费占比: 62.0%");
    expect(text).toContain("现金消费占比: 8.0%");
    expect(text).toContain("微信支付占比: 10.0%");
    expect(text).toContain("支付宝支付占比: 0.0%");
    expect(text).toContain("团购消费占比: 20.0%");
  });

  it("creates an action-center item for a manager's bound store", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 6, dailyCount: 30 });
    runtime.createAction.mockResolvedValue({
      actionId: "ACT-1001",
      orgId: "1001",
      storeName: "一号店",
      category: "会员召回",
      title: "回访近30天沉默会员",
      status: "proposed",
      priority: "high",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "action create 一号店 会员召回 high 回访近30天沉默会员",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang action create 一号店 会员召回 high 回访近30天沉默会员",
      now: new Date("2026-04-01T09:00:00+08:00"),
    });

    expect(text).toContain("已创建动作单");
    expect(text).toContain("ACT-1001");
    expect(runtime.createAction).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        category: "会员召回",
        priority: "high",
        title: "回访近30天沉默会员",
      }),
    );
  });

  it("returns a learning summary for the requested store", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 6, dailyCount: 30 });
    runtime.getLearningSummary.mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      totalActionCount: 4,
      decidedActionCount: 3,
      adoptedActionCount: 2,
      rejectedActionCount: 1,
      doneActionCount: 1,
      failedActionCount: 1,
      adoptionRate: 2 / 3,
      completionRate: 0.5,
      analysisJobCount: 3,
      analysisCompletedCount: 2,
      analysisFailedCount: 1,
      analysisRetriedJobCount: 1,
      analysisCompletionRate: 2 / 3,
      analysisRetryRate: 1 / 3,
      analysisAverageDurationMinutes: 11,
      analysisFallbackCount: 1,
      analysisFallbackRate: 0.5,
      analysisFallbackStageBreakdown: [
        {
          stage: "bounded_synthesis",
          count: 1,
        },
      ],
      analysisAutoActionItemCount: 3,
      analysisActionedJobCount: 1,
      analysisActionConversionRate: 0.5,
      analysisAverageActionsPerCompletedJob: 1.5,
      topEffectiveCategories: [
        {
          category: "会员召回",
          actionCount: 2,
          averageEffectScore: 3.5,
        },
      ],
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "learning 一号店",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang learning 一号店",
      now: new Date("2026-04-01T09:10:00+08:00"),
    });

    expect(text).toContain("一号店 学习摘要");
    expect(text).toContain("采纳率 66.7%");
    expect(text).toContain("完结率 50.0%");
    expect(text).toContain("分析任务 3 条");
    expect(text).toContain("分析重试率 33.3%");
    expect(text).toContain("分析退化率 50.0%");
    expect(text).toContain("退化分布：bounded_synthesis 1 条");
    expect(text).toContain("分析转动作 50.0%");
    expect(text).toContain("平均耗时 11.0 分钟");
    expect(text).toContain("单次完成分析平均落地 1.5 条动作");
    expect(text).toContain("会员召回");
  });

  it("lists analysis jobs for the requested store", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.listAnalysisJobs.mockResolvedValue([
      {
        jobId: "ANL-1001",
        jobType: "store_review",
        orgId: "1001",
        storeName: "一号店",
        rawText: "一号店近7天经营复盘",
        timeFrameLabel: "近7天",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
        channel: "wecom",
        target: "conversation-1",
        status: "pending",
        attemptCount: 0,
        createdAt: "2026-04-01T09:00:00.000Z",
        updatedAt: "2026-04-01T09:00:00.000Z",
      },
    ]);

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "analysis list 一号店 pending",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang analysis list 一号店 pending",
      now: new Date("2026-04-01T09:15:00+08:00"),
    });

    expect(text).toContain("一号店 分析任务");
    expect(text).toContain("ANL-1001");
    expect(text).toContain("[pending]");
    expect(runtime.listAnalysisJobs).toHaveBeenCalledWith({
      orgId: "1001",
      status: "pending",
    });
  });

  it("shows orchestration summaries and fallback totals in analysis job lists", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.listAnalysisJobs.mockResolvedValue([
      {
        jobId: "ANL-FALLBACK",
        jobType: "store_review",
        orgId: "1001",
        storeName: "一号店",
        rawText: "一号店近7天经营复盘",
        timeFrameLabel: "近7天",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
        channel: "wecom",
        target: "conversation-1",
        status: "completed",
        attemptCount: 1,
        resultText: JSON.stringify({
          summary: "近7天钟效走弱。",
          markdown: "结论摘要：近7天钟效走弱。",
          risks: [],
          suggestions: [],
          orchestration: {
            version: "v1",
            completedStages: ["evidence_pack", "diagnostic_signals", "action_items"],
            fallbackStage: "bounded_synthesis",
            stageTrace: [
              {
                stage: "evidence_pack",
                status: "completed",
                detail: "scope=single_store; orgs=1",
              },
              {
                stage: "diagnostic_signals",
                status: "completed",
                detail: "signals=2; ids=point_clock_risk,add_clock_weakness",
              },
              {
                stage: "bounded_synthesis",
                status: "fallback",
                detail: "mode=scoped_query_fallback; reason=sidecar_missing",
              },
              {
                stage: "action_items",
                status: "completed",
                detail: "derived_from_suggestions=2",
              },
            ],
          },
        }),
        createdAt: "2026-04-01T09:00:00.000Z",
        updatedAt: "2026-04-01T09:05:00.000Z",
        finishedAt: "2026-04-01T09:05:00.000Z",
      },
      {
        jobId: "ANL-DIRECT",
        jobType: "store_review",
        orgId: "1001",
        storeName: "一号店",
        rawText: "一号店近30天经营复盘",
        timeFrameLabel: "近30天",
        startBizDate: "2026-03-01",
        endBizDate: "2026-03-29",
        channel: "wecom",
        target: "conversation-1",
        status: "completed",
        attemptCount: 1,
        resultText: JSON.stringify({
          summary: "近30天营收基本盘稳定。",
          markdown: "结论摘要：近30天营收基本盘稳定。",
          risks: [],
          suggestions: [],
          orchestration: {
            version: "v1",
            completedStages: [
              "evidence_pack",
              "diagnostic_signals",
              "bounded_synthesis",
              "action_items",
            ],
            stageTrace: [
              {
                stage: "evidence_pack",
                status: "completed",
                detail: "scope=single_store; orgs=1",
              },
              {
                stage: "diagnostic_signals",
                status: "completed",
                detail: "signals=1; ids=member_silence_risk",
              },
              {
                stage: "bounded_synthesis",
                status: "completed",
                detail: "mode=crewai_sidecar; reason=sidecar_ok",
              },
              {
                stage: "action_items",
                status: "completed",
                detail: "structured=1",
              },
            ],
          },
        }),
        createdAt: "2026-04-01T08:00:00.000Z",
        updatedAt: "2026-04-01T08:05:00.000Z",
        finishedAt: "2026-04-01T08:05:00.000Z",
      },
    ]);

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "analysis list 一号店 completed",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang analysis list 一号店 completed",
      now: new Date("2026-04-01T09:15:00+08:00"),
    });

    expect(text).toContain("一号店 分析任务");
    expect(text).toContain("共 2 条，fallback 1 条");
    expect(text).toContain("退化分布：bounded_synthesis 1 条");
    expect(text).toContain("ANL-FALLBACK");
    expect(text).toContain(
      "evidence_pack -> diagnostic_signals -> bounded_synthesis(fallback: sidecar_missing) -> action_items",
    );
    expect(text).toContain("ANL-DIRECT");
    expect(text).toContain(
      "evidence_pack -> diagnostic_signals -> bounded_synthesis -> action_items",
    );
  });

  it("shows analysis job status details", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.getAnalysisJob.mockResolvedValue({
      jobId: "ANL-1001",
      jobType: "store_review",
      orgId: "1001",
      storeName: "一号店",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-01T09:05:00.000Z",
      finishedAt: "2026-04-01T09:05:00.000Z",
      deliveredAt: "2026-04-01T09:06:00.000Z",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "analysis status ANL-1001",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang analysis status ANL-1001",
      now: new Date("2026-04-01T09:16:00+08:00"),
    });

    expect(text).toContain("分析任务 ANL-1001");
    expect(text).toContain("状态：completed");
    expect(text).toContain("近7天");
    expect(text).toContain("七日复盘结论");
    expect(runtime.getAnalysisJob).toHaveBeenCalledWith("ANL-1001");
  });

  it("shows queue status across sync, delivery, and analysis", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.getQueueStatus.mockResolvedValue({
      sync: {
        pendingCount: 1,
        completedCount: 2,
        waitingCount: 0,
      },
      delivery: {
        pendingCount: 1,
        completedCount: 0,
        waitingCount: 1,
      },
      analysis: {
        pendingCount: 2,
        runningCount: 1,
        failedCount: 1,
        unresolvedDeadLetterCount: 3,
        jobDeliveryPendingCount: 1,
        subscriberDeliveryPendingCount: 2,
      },
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "queue status",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang queue status",
      now: new Date("2026-04-01T09:16:00+08:00"),
    });

    expect(text).toContain("队列状态");
    expect(text).toContain("同步队列：待处理 1");
    expect(text).toContain("投递队列：待处理 1");
    expect(text).toContain("分析队列：待处理 2｜运行中 1｜失败 1");
    expect(text).toContain("死信 3");
  });

  it("shows latest conversation review summary and top finding types", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部",
      role: "hq",
      isActive: true,
      hourlyQuota: 15,
      dailyQuota: 80,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.getConversationReviewSummary.mockResolvedValue({
      latestRun: {
        reviewRunId: "run-2",
        reviewDate: "2026-04-16",
        sourceWindowStart: "2026-04-15T00:00:00.000Z",
        sourceWindowEnd: "2026-04-16T00:00:00.000Z",
        status: "completed",
        inputConversationCount: 20,
        inputShadowSampleCount: 0,
        inputAnalysisJobCount: 3,
        findingCount: 5,
        createdAt: "2026-04-16T01:00:00.000Z",
        updatedAt: "2026-04-16T01:05:00.000Z",
      },
      summary: {
        reviewMode: "bounded-synthesis",
        reviewDate: "2026-04-16",
        sourceWindowStart: "2026-04-15T00:00:00.000Z",
        sourceWindowEnd: "2026-04-16T00:00:00.000Z",
        inputConversationCount: 20,
        inputShadowSampleCount: 0,
        inputAnalysisJobCount: 3,
        findingCount: 5,
        topFindingTypes: ["scope_gap", "analysis_gap"],
        severityBreakdown: { low: 0, medium: 1, high: 4 },
        reviewHeadline: "优先修时间窗缺口和 analysis fallback。",
        prioritizedFindingTypes: ["scope_gap", "analysis_gap"],
      },
      topFindingTypes: [
        { findingType: "scope_gap", count: 3 },
        { findingType: "analysis_gap", count: 2 },
      ],
      suggestedActionCounts: [
        { suggestedActionType: "add_eval_sample", count: 3 },
        { suggestedActionType: "add_diagnostic_signal", count: 2 },
      ],
      followupTargetCounts: [
        { followupTarget: "backlog_candidate", count: 5 },
        { followupTarget: "sample_candidate", count: 3 },
        { followupTarget: "deploy_followup_candidate", count: 2 },
      ],
      unresolvedHighSeverityFindings: [
        {
          findingId: "f-1",
          reviewRunId: "run-2",
          findingType: "scope_gap",
          severity: "high",
          title: "缺少默认时间窗",
          summary: "“这几天”没有走默认5天。",
          evidenceJson: "{}",
          status: "open",
          createdAt: "2026-04-16T01:01:00.000Z",
        },
      ],
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "review",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang review",
      now: new Date("2026-04-16T09:16:00+08:00"),
    });

    expect(text).toContain("对话复盘摘要");
    expect(text).toContain("run-2");
    expect(text).toContain("scope_gap 3");
    expect(text).toContain("add_eval_sample 3");
    expect(text).toContain("进入主链：backlog_candidate 5；sample_candidate 3；deploy_followup_candidate 2");
    expect(text).toContain("缺少默认时间窗");
    expect(runtime.getConversationReviewSummary).toHaveBeenCalled();
  });

  it("renders a reactivation execution summary for the requested store and day", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 6, dailyCount: 30 });
    runtime.getMemberReactivationExecutionSummary.mockResolvedValue({
      orgId: "1001",
      bizDate: "2026-04-18",
      totalTaskCount: 3,
      pendingCount: 2,
      contactedCount: 1,
      repliedCount: 1,
      bookedCount: 1,
      arrivedCount: 0,
      closedCount: 0,
      contactRate: 2 / 3,
      bookingRate: 1 / 3,
      arrivalRate: 0,
      priorityBandCounts: [
        { priorityBand: "P0", count: 1 },
        { priorityBand: "P1", count: 2 },
      ],
      followupBucketCounts: [
        { followupBucket: "high-value-reactivation", count: 1 },
        { followupBucket: "potential-growth", count: 2 },
      ],
      topPendingTasks: [
        {
          orgId: "1001",
          bizDate: "2026-04-18",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          reactivationPriorityScore: 760,
          strategyPriorityScore: 980,
          executionPriorityScore: 1040,
          priorityBand: "P0",
          priorityRank: 1,
          churnRiskLabel: "critical",
          churnRiskScore: 0.88,
          revisitWindowLabel: "due-now",
          recommendedActionLabel: "immediate-1to1",
          recommendedTouchWeekday: "friday",
          recommendedTouchDaypart: "after-work",
          touchWindowLabel: "best-today",
          reasonSummary: "已沉默36天，近90天消费4680元。",
          touchAdviceSummary: "今晚联系。",
          daysSinceLastVisit: 36,
          visitCount90d: 5,
          payAmount90d: 4680,
          currentStoredBalanceInferred: 680,
          projectedBalanceDaysLeft: 34,
          birthdayBoostScore: 0,
          queueJson: "{}",
          updatedAt: "2026-04-18T09:00:00+08:00",
          feedbackStatus: "pending",
          contacted: false,
          replied: false,
          booked: false,
          arrived: false,
        },
      ],
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "reactivation summary 一号店 2026-04-18",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang reactivation summary 一号店 2026-04-18",
      now: new Date("2026-04-18T18:30:00+08:00"),
    });

    expect(text).toContain("一号店 2026-04-18 召回执行摘要");
    expect(text).toContain("任务总数 3");
    expect(text).toContain("联系率 66.7%");
    expect(text).toContain("高优先待跟进：王女士");
    expect(runtime.getMemberReactivationExecutionSummary).toHaveBeenCalledWith({
      orgId: "1001",
      bizDate: "2026-04-18",
      pendingLimit: 5,
    });
  });

  it("lists filtered reactivation execution tasks for the requested store and day", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 6, dailyCount: 30 });
    runtime.listMemberReactivationExecutionTasks.mockResolvedValue([
      {
        orgId: "1001",
        bizDate: "2026-04-18",
        memberId: "M-001",
        customerIdentityKey: "member:M-001",
        customerDisplayName: "王女士",
        primarySegment: "important-reactivation-member",
        followupBucket: "high-value-reactivation",
        reactivationPriorityScore: 760,
        strategyPriorityScore: 980,
        executionPriorityScore: 1040,
        priorityBand: "P0",
        priorityRank: 1,
        churnRiskLabel: "critical",
        churnRiskScore: 0.88,
        revisitWindowLabel: "due-now",
        recommendedActionLabel: "immediate-1to1",
        recommendedTouchWeekday: "friday",
        recommendedTouchDaypart: "after-work",
        touchWindowLabel: "best-today",
        reasonSummary: "已沉默36天，近90天消费4680元。",
        touchAdviceSummary: "今晚联系。",
        daysSinceLastVisit: 36,
        visitCount90d: 5,
        payAmount90d: 4680,
        currentStoredBalanceInferred: 680,
        projectedBalanceDaysLeft: 34,
        birthdayBoostScore: 0,
        queueJson: "{}",
        updatedAt: "2026-04-18T09:00:00+08:00",
        feedbackStatus: "pending",
        contacted: false,
        replied: false,
        booked: false,
        arrived: false,
      },
    ]);

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "reactivation tasks 一号店 2026-04-18 pending",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang reactivation tasks 一号店 2026-04-18 pending",
      now: new Date("2026-04-18T18:30:00+08:00"),
    });

    expect(text).toContain("一号店 2026-04-18 召回任务");
    expect(text).toContain("pending 1 条");
    expect(text).toContain("王女士");
    expect(text).toContain("P0");
    expect(runtime.listMemberReactivationExecutionTasks).toHaveBeenCalledWith({
      orgId: "1001",
      bizDate: "2026-04-18",
      feedbackStatus: "pending",
      limit: 10,
    });
  });

  it("writes reactivation execution feedback through the command surface", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 6, dailyCount: 30 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "reactivation update 一号店 2026-04-18 M-001 booked 店长甲 已约周六下午",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang reactivation update 一号店 2026-04-18 M-001 booked 店长甲 已约周六下午",
      now: new Date("2026-04-18T18:32:00+08:00"),
    });

    expect(text).toContain("召回反馈已更新");
    expect(text).toContain("一号店");
    expect(text).toContain("M-001");
    expect(text).toContain("booked");
    expect(runtime.upsertMemberReactivationExecutionFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-04-18",
        memberId: "M-001",
        feedbackStatus: "booked",
        followedBy: "店长甲",
        contacted: true,
        replied: true,
        booked: true,
        arrived: false,
        note: "已约周六下午",
      }),
    );
  });

  it("writes customer service observations through the command surface", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.captureCustomerServiceObservation.mockResolvedValue({
      batchId: "batch-1",
      observationId: "obs-1",
      customerIdentityKey: "member:M-001",
      publishedSignalCount: 1,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "observation add 一号店 M-001 service_need primary_need 肩颈放松 今天重点放松肩颈",
      channel: "wecom",
      senderId: "manager-1",
      commandBody:
        "/hetang observation add 一号店 M-001 service_need primary_need 肩颈放松 今天重点放松肩颈",
      now: new Date("2026-04-21T12:00:00+08:00"),
    });

    expect(text).toContain("顾客观察已记录");
    expect(text).toContain("一号店");
    expect(text).toContain("M-001");
    expect(text).toContain("service_need.primary_need");
    expect(runtime.captureCustomerServiceObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        memberId: "M-001",
        signalDomain: "service_need",
        signalKey: "primary_need",
        valueText: "肩颈放松",
        rawNote: "今天重点放松肩颈",
        observerId: "manager-1",
        sourceRole: "store_manager",
      }),
    );
  });

  it("lists unresolved dead letters and supports replay", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.listAnalysisDeadLetters.mockResolvedValue([
      {
        deadLetterKey: "DLQ-1",
        jobId: "ANL-1001",
        orgId: "1001",
        deadLetterScope: "job",
        reason: "invalid chatid",
        createdAt: "2026-04-01T09:05:00.000Z",
      },
    ]);
    runtime.replayAnalysisDeadLetter.mockResolvedValue({
      deadLetterKey: "DLQ-1",
      jobId: "ANL-1001",
      orgId: "1001",
      deadLetterScope: "job",
      reason: "invalid chatid",
      createdAt: "2026-04-01T09:05:00.000Z",
      resolvedAt: "2026-04-01T09:20:00.000Z",
    });

    const listText = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "queue deadletters",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang queue deadletters",
      now: new Date("2026-04-01T09:16:00+08:00"),
    });
    const replayText = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "queue replay DLQ-1",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang queue replay DLQ-1",
      now: new Date("2026-04-01T09:20:00+08:00"),
    });

    expect(listText).toContain("分析死信");
    expect(listText).toContain("DLQ-1");
    expect(listText).toContain("invalid chatid");
    expect(replayText).toContain("已重放死信");
    expect(replayText).toContain("DLQ-1");
    expect(runtime.replayAnalysisDeadLetter).toHaveBeenCalledWith({
      deadLetterKey: "DLQ-1",
      replayedAt: "2026-04-01T01:20:00.000Z",
    });
  });

  it("cleans stale invalid-chatid subscriber residuals from the queue surface", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.cleanupStaleInvalidChatidSubscriberResiduals.mockResolvedValue({
      residualClass: "stale-invalid-chatid-subscriber",
      cleanedSubscriberCount: 4,
      cleanedJobCount: 4,
      resolvedDeadLetterCount: 8,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "queue cleanup stale-invalid-chatid-subscriber 10",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang queue cleanup stale-invalid-chatid-subscriber 10",
      now: new Date("2026-04-16T23:40:00+08:00"),
    });

    expect(text).toContain("已清理历史坏订阅残留");
    expect(text).toContain("subscriber 4");
    expect(text).toContain("job 4");
    expect(text).toContain("deadletter 8");
    expect(runtime.cleanupStaleInvalidChatidSubscriberResiduals).toHaveBeenCalledWith({
      resolvedAt: "2026-04-16T15:40:00.000Z",
      limit: 10,
    });
  });

  it("shows deferred or abandoned delivery state in analysis job status", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.getAnalysisJob.mockResolvedValue({
      jobId: "ANL-DEFER",
      jobType: "store_review",
      orgId: "1001",
      storeName: "一号店",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-01T09:05:00.000Z",
      finishedAt: "2026-04-01T09:05:00.000Z",
      deliveryAttemptCount: 3,
      lastDeliveryError: "invalid chatid",
      deliveryAbandonedAt: "2026-04-01T09:16:00.000Z",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "analysis status ANL-DEFER",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang analysis status ANL-DEFER",
      now: new Date("2026-04-01T09:20:00+08:00"),
    });

    expect(text).toContain("分析任务 ANL-DEFER");
    expect(text).toContain("投递状态：已终止");
    expect(text).toContain("投递尝试：3");
    expect(text).toContain("invalid chatid");
  });

  it("shows orchestration stage trace in analysis job status", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.getAnalysisJob.mockResolvedValue({
      jobId: "ANL-TRACE",
      jobType: "store_review",
      orgId: "1001",
      storeName: "一号店",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: JSON.stringify({
        summary: "近7天钟效走弱。",
        markdown: "结论摘要：近7天钟效走弱。",
        risks: [],
        suggestions: [],
        orchestration: {
          version: "v1",
          completedStages: ["evidence_pack", "diagnostic_signals", "action_items"],
          fallbackStage: "bounded_synthesis",
          stageTrace: [
            {
              stage: "evidence_pack",
              status: "completed",
              detail: "scope=single_store; orgs=1",
            },
            {
              stage: "diagnostic_signals",
              status: "completed",
              detail: "signals=2; ids=point_clock_risk,add_clock_weakness",
            },
            {
              stage: "bounded_synthesis",
              status: "fallback",
              detail: "mode=scoped_query_fallback; reason=sidecar_missing",
            },
            {
              stage: "action_items",
              status: "completed",
              detail: "derived_from_suggestions=2",
            },
          ],
        },
      }),
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-01T09:05:00.000Z",
      finishedAt: "2026-04-01T09:05:00.000Z",
      deliveredAt: "2026-04-01T09:06:00.000Z",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "analysis status ANL-TRACE",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang analysis status ANL-TRACE",
      now: new Date("2026-04-01T09:16:00+08:00"),
    });

    expect(text).toContain("分析任务 ANL-TRACE");
    expect(text).toContain(
      "分析链路：evidence_pack -> diagnostic_signals -> bounded_synthesis(fallback: sidecar_missing) -> action_items",
    );
  });

  it("retries a failed analysis job within the manager scope", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.getAnalysisJob.mockResolvedValue({
      jobId: "ANL-FAILED",
      jobType: "store_review",
      orgId: "1001",
      storeName: "一号店",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "failed",
      attemptCount: 1,
      errorMessage: "sidecar boom",
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-01T09:05:00.000Z",
      finishedAt: "2026-04-01T09:05:00.000Z",
      deliveredAt: "2026-04-01T09:06:00.000Z",
    });
    runtime.retryAnalysisJob.mockResolvedValue({
      jobId: "ANL-FAILED",
      jobType: "store_review",
      orgId: "1001",
      storeName: "一号店",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "pending",
      attemptCount: 1,
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-01T09:20:00.000Z",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "analysis retry ANL-FAILED",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang analysis retry ANL-FAILED",
      now: new Date("2026-04-01T09:20:00+08:00"),
    });

    expect(text).toContain("已重新入队");
    expect(text).toContain("ANL-FAILED");
    expect(runtime.retryAnalysisJob).toHaveBeenCalledWith({
      jobId: "ANL-FAILED",
      retriedAt: "2026-04-01T01:20:00.000Z",
    });
  });

  it("respects control-tower analysis.retryEnabled=false for analysis retries", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "analysis.retryEnabled": false,
    });
    runtime.getAnalysisJob.mockResolvedValue({
      jobId: "ANL-FAILED",
      jobType: "store_review",
      orgId: "1001",
      storeName: "一号店",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "failed",
      attemptCount: 1,
      errorMessage: "sidecar boom",
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-01T09:05:00.000Z",
      finishedAt: "2026-04-01T09:05:00.000Z",
      deliveredAt: "2026-04-01T09:06:00.000Z",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "analysis retry ANL-FAILED",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang analysis retry ANL-FAILED",
      now: new Date("2026-04-01T09:20:00+08:00"),
    });

    expect(text).toContain("当前已关闭分析任务重试");
    expect(runtime.retryAnalysisJob).not.toHaveBeenCalled();
  });

  it("lets hq update control-tower settings", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.upsertControlTowerSetting.mockResolvedValue({
      scopeType: "store",
      scopeKey: "1001",
      settingKey: "quota.hourlyLimit",
      value: 12,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "tower set 一号店 quota.hourlyLimit 12",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang tower set 一号店 quota.hourlyLimit 12",
      now: new Date("2026-04-01T09:20:00+08:00"),
    });

    expect(text).toContain("Control Tower 已更新");
    expect(text).toContain("quota.hourlyLimit");
    expect(runtime.upsertControlTowerSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "store",
        scopeKey: "1001",
        settingKey: "quota.hourlyLimit",
        value: 12,
      }),
    );
  });

  it("shows the control-tower analysis setting catalog alongside current values", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "analysis.reviewMode": "sequential",
      "analysis.maxActionItems": 3,
      "analysis.autoCreateActions": true,
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "tower show 一号店",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang tower show 一号店",
      now: new Date("2026-04-01T09:22:00+08:00"),
    });

    expect(text).toContain("Control Tower (一号店)");
    expect(text).toContain("analysis.reviewMode = sequential");
    expect(text).toContain("direct | single | sequential");
    expect(text).toContain("analysis.maxActionItems");
    expect(text).toContain("analysis.notifyOnFailure");
  });

  it("rejects invalid analysis.reviewMode updates", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "tower set 一号店 analysis.reviewMode freestyle",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang tower set 一号店 analysis.reviewMode freestyle",
      now: new Date("2026-04-01T09:25:00+08:00"),
    });

    expect(text).toContain("analysis.reviewMode");
    expect(text).toContain("direct");
    expect(text).toContain("sequential");
    expect(runtime.upsertControlTowerSetting).not.toHaveBeenCalled();
  });

  it("lets hq update routing.mode through control tower", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.upsertControlTowerSetting.mockResolvedValue({
      scopeType: "global",
      scopeKey: "global",
      settingKey: "routing.mode",
      value: "shadow",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "tower set global routing.mode shadow",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang tower set global routing.mode shadow",
      now: new Date("2026-04-01T09:30:00+08:00"),
    });

    expect(text).toContain("Control Tower 已更新");
    expect(text).toContain("routing.mode = shadow");
    expect(runtime.upsertControlTowerSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "global",
        scopeKey: "global",
        settingKey: "routing.mode",
        value: "shadow",
      }),
    );
  });

  it("shows routing.mode in the control-tower catalog", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
    });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "tower show",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang tower show",
      now: new Date("2026-04-01T09:31:00+08:00"),
    });

    expect(text).toContain("routing.mode = shadow");
    expect(text).toContain("legacy | shadow | semantic");
  });
});

describe("runHetangTypedQuery", () => {
  it("denies an unbound semantic direct query before touching query execution", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(null);
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangTypedQuery({
      runtime: runtime as never,
      config: buildConfig(),
      queryText: "一号店昨天营收多少",
      channel: "wecom",
      senderId: "user-unbound",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toContain("未绑定");
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "wecom",
        senderId: "user-unbound",
        action: "query",
        decision: "denied",
      }),
    );
  });

  it("executes a typed semantic query with the same audit contract as the command path", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 1, dailyCount: 4 });

    const text = await runHetangTypedQuery({
      runtime: runtime as never,
      config: buildConfig(),
      queryText: "一号店营收怎么样",
      channel: "wecom",
      senderId: "manager-1",
      now: new Date("2026-03-30T09:00:00+08:00"),
    });

    expect(text).toBe("你要看一号店昨天、近7天还是近30天？");
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "wecom",
        senderId: "manager-1",
        action: "query",
        decision: "allowed",
        queryEntrySource: "rule_clarifier",
        queryEntryReason: "missing-time",
      }),
    );
  });
});
