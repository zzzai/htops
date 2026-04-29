import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangQueryIntent } from "./query-intent.js";
import {
  tryExecuteRuntimeRenderQueryPlane,
  tryExecuteServingQueryPlane,
} from "./query-engine-executor.js";
import { renderSingleDayDailyKpiText } from "./query-engine-renderer.js";
import { resolveEffectiveOrgIds } from "./query-engine-router.js";
import { enumerateBizDates } from "./store-query.js";
import type {
  DailyStoreAlert,
  DailyStoreMetrics,
  DailyStoreReport,
  HetangEmployeeBinding,
  RechargeBillRecord,
  StoreManagerDailyKpiRow,
  StoreSummary30dRow,
  TechUpClockRecord,
} from "./types.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "义乌店" },
      { orgId: "1002", storeName: "华美店" },
    ],
  });
}

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "义乌店",
    bizDate: "2026-04-12",
    serviceRevenue: 3200,
    totalClockCount: 40,
    clockEffect: 80,
    averageTicket: 200,
    activeTechCount: 6,
    groupbuy7dRevisitRate: 0.4,
    groupbuy7dStoredValueConversionRate: 0.2,
    sleepingMemberRate: 0.1,
    currentStoredBalance: 12000,
    storedBalanceLifeMonths: 4,
    renewalPressureIndex30d: 1.0,
    memberRepurchaseBaseCustomerCount7d: 10,
    memberRepurchaseReturnedCustomerCount7d: 5,
    memberRepurchaseRate7d: 0.5,
    addClockRate: 0.3,
    storedConsumeRate: 0.7,
    rechargeCash: 1000,
    incompleteSync: false,
    unavailableMetrics: [],
    ...overrides,
  } as DailyStoreMetrics;
}

function buildReport(params: {
  orgId: string;
  storeName: string;
  bizDate: string;
  metrics?: Partial<DailyStoreMetrics>;
  alerts?: DailyStoreAlert[];
  suggestions?: string[];
  complete?: boolean;
}): DailyStoreReport {
  return {
    orgId: params.orgId,
    storeName: params.storeName,
    bizDate: params.bizDate,
    metrics: buildMetrics({
      orgId: params.orgId,
      storeName: params.storeName,
      bizDate: params.bizDate,
      ...params.metrics,
    }),
    alerts: params.alerts ?? [],
    suggestions: params.suggestions ?? [],
    markdown: `${params.storeName} ${params.bizDate} 日报`,
    complete: params.complete ?? true,
  } as DailyStoreReport;
}

function buildStoreSummary30dRow(
  overrides: Partial<StoreSummary30dRow> & {
    orgId: string;
    storeName: string;
    windowEndBizDate: string;
  },
): StoreSummary30dRow {
  const { orgId, storeName, windowEndBizDate, ...rest } = overrides;
  return {
    orgId,
    windowEndBizDate,
    storeName,
    revenue30d: 50000,
    orderCount30d: 320,
    customerCount30d: 320,
    totalClocks30d: 420,
    clockEffect30d: 120,
    averageTicket30d: 220,
    pointClockRate30d: 0.35,
    addClockRate30d: 0.3,
    rechargeCash30d: 24000,
    storedConsumeAmount30d: 18000,
    storedConsumeRate30d: 0.75,
    onDutyTechCount30d: 8,
    groupbuyOrderShare30d: 0.2,
    groupbuyCohortCustomerCount: 30,
    groupbuy7dRevisitCustomerCount: 12,
    groupbuy7dRevisitRate: 0.4,
    groupbuy7dCardOpenedCustomerCount: 5,
    groupbuy7dCardOpenedRate: 5 / 30,
    groupbuy7dStoredValueConvertedCustomerCount: 6,
    groupbuy7dStoredValueConversionRate: 0.2,
    groupbuy30dMemberPayConvertedCustomerCount: 10,
    groupbuy30dMemberPayConversionRate: 10 / 30,
    groupbuyFirstOrderCustomerCount: 18,
    groupbuyFirstOrderHighValueMemberCustomerCount: 3,
    groupbuyFirstOrderHighValueMemberRate: 3 / 18,
    effectiveMembers: 180,
    sleepingMembers: 28,
    sleepingMemberRate: 28 / 180,
    newMembers30d: 22,
    activeTechCount30d: 7,
    currentStoredBalance: 88000,
    storedBalanceLifeMonths: 4.1,
    renewalPressureIndex30d: 1.08,
    memberRepurchaseBaseCustomerCount7d: 42,
    memberRepurchaseReturnedCustomerCount7d: 14,
    memberRepurchaseRate7d: 14 / 42,
    ...rest,
  };
}

describe("query-engine owner modules", () => {
  it("asks for store clarification when a multi-store manager omits the store", () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-1",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001", "1002"],
      isActive: true,
    };
    const intent = resolveHetangQueryIntent({
      config,
      text: "昨天营收多少",
      now: new Date("2026-04-13T04:00:00+08:00"),
    });

    expect(intent).not.toBeNull();
    const result = resolveEffectiveOrgIds({
      config,
      binding,
      intent: intent!,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected clarification result");
    }
    expect(result.text).toContain("当前账号已绑定多个门店");
    expect(result.text).toContain("义乌店、华美店");
  });

  it("enumerates inclusive biz dates for a range frame", () => {
    expect(
      enumerateBizDates({
        kind: "range",
        startBizDate: "2026-04-07",
        endBizDate: "2026-04-09",
        label: "近3天",
        days: 3,
      }),
    ).toEqual(["2026-04-07", "2026-04-08", "2026-04-09"]);
  });

  it("renders the single-day daily kpi summary with the expected insight", () => {
    const row: StoreManagerDailyKpiRow = {
      bizDate: "2026-04-12",
      orgId: "1001",
      storeName: "义乌店",
      dailyActualRevenue: 16888,
      dailyCardConsume: 3200,
      dailyOrderCount: 48,
      totalClocks: 67,
      assignClocks: 8,
      queueClocks: 42,
      pointClockRate: 0.15,
      averageTicket: 351.8,
      clockEffect: 252.1,
    };

    expect(renderSingleDayDailyKpiText(row)).toBe(
      [
        "义乌店 2026-04-12 经营复盘",
        "- 实收流水：16888.00 元",
        "- 耗卡金额：3200.00 元",
        "- 进店单数：48 单",
        "- 总上钟数：67.0 个",
        "- 点钟/排钟：8.0 / 42.0",
        "- 门店点钟率：15.0%",
        "- 参谋洞察：点钟承接偏弱，今天先盯前台分单和技师指定承接，别让高意向客人默认滑进排钟。",
      ].join("\n"),
    );
  });

  it("treats an empty serving customer-profile lookup as a fallback miss instead of a final answer", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-yiwu",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店 手机尾号 7500 的 顾客画像",
      now: new Date("2026-04-14T18:04:55+08:00"),
    });

    expect(intent?.kind).toBe("customer_profile");

    const result = await tryExecuteServingQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        getCurrentServingVersion: async () => "serving-v1",
        executeCompiledServingQuery: async () => [],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001"],
    });

    expect(result).toBeNull();
  });

  it("trusts capability-graph serving selection even when the old serving heuristic would say no", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-yiwu",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const syntheticIntent = {
      rawText: "义乌店自定义客群清单",
      kind: "customer_segment",
      explicitOrgIds: ["1001"],
      allStoresRequested: false,
      timeFrame: {
        kind: "single",
        bizDate: "2026-04-14",
        label: "今天",
        days: 1,
      },
      comparisonTimeFrame: undefined,
      phoneSuffix: undefined,
      metrics: [],
      unsupportedMetrics: [],
      rankingTarget: "store",
      rankingOrder: "desc",
      mentionsCompareKeyword: false,
      mentionsRankingKeyword: false,
      mentionsTrendKeyword: false,
      mentionsAnomalyKeyword: false,
      mentionsRiskKeyword: false,
      mentionsAdviceKeyword: false,
      mentionsReportKeyword: false,
      routeConfidence: "high",
      requiresClarification: false,
      clarificationReason: undefined,
      semanticSlots: {
        domain: "customer",
        entity: "customer",
        action: "inspect",
        metric: "none",
        time: {
          kind: "single",
          startBizDate: "2026-04-14",
          endBizDate: "2026-04-14",
          label: "今天",
          days: 1,
        },
      },
    } as const;

    const result = await tryExecuteServingQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        getCurrentServingVersion: async () => "serving-v1",
        executeCompiledServingQuery: async () => [
          {
            org_id: "1001",
            as_of_biz_date: "2026-04-14",
            customer_display_name: "王女士",
            primary_segment: "important-value-member",
            pay_amount_90d: 3280,
            current_stored_amount: 1880,
            current_silent_days: 1,
            top_tech_name: "白慧慧",
            followup_score: 86,
            risk_score: 18,
          },
        ],
      },
      config,
      binding,
      intent: syntheticIntent as never,
      effectiveOrgIds: ["1001"],
    });

    expect(result).toContain("义乌店 2026-04-14 跟进名单");
    expect(result).toContain("王女士");
  });

  it("serves window total-clock compare asks directly from the capability-graph serving path", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-yiwu",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const syntheticIntent = {
      rawText: "义乌店近7天总钟数对比",
      kind: "compare",
      explicitOrgIds: ["1001"],
      allStoresRequested: false,
      timeFrame: {
        kind: "range",
        startBizDate: "2026-04-08",
        endBizDate: "2026-04-14",
        label: "近7天",
        days: 7,
      },
      comparisonTimeFrame: {
        kind: "range",
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-07",
        label: "前7天",
        days: 7,
      },
      phoneSuffix: undefined,
      metrics: [{ key: "totalClockCount", label: "总钟数" }],
      unsupportedMetrics: [],
      rankingTarget: "store",
      rankingOrder: "desc",
      mentionsCompareKeyword: true,
      mentionsRankingKeyword: false,
      mentionsTrendKeyword: false,
      mentionsAnomalyKeyword: false,
      mentionsRiskKeyword: false,
      mentionsAdviceKeyword: false,
      mentionsReportKeyword: false,
      routeConfidence: "high",
      requiresClarification: false,
      clarificationReason: undefined,
    } as const;

    const result = await tryExecuteServingQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        getCurrentServingVersion: async () => "serving-v1",
        executeCompiledServingQuery: async () => [
          {
            org_id: "1001",
            store_name: "义乌店",
            window_end_biz_date: "2026-04-14",
            window_days: 7,
            metric_value: 158,
            baseline_window_end_biz_date: "2026-04-07",
            baseline_window_days: 7,
            baseline_metric_value: 132,
          },
        ],
      },
      config,
      binding,
      intent: syntheticIntent as never,
      effectiveOrgIds: ["1001"],
    });

    expect(result).toContain("义乌店 近7天 vs 前7天");
    expect(result).toContain("总钟数");
    expect(result).toContain("158 钟");
    expect(result).toContain("132 钟");
  });

  it("dispatches birthday-member asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-12T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店今天过生日的高价值会员有哪些",
      now,
    });

    expect(intent?.kind).toBe("birthday_members");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        listCurrentMembers: async () => [
          {
            orgId: "1002",
            memberId: "vip-1",
            name: "王女士",
            phone: "13800001111",
            storedAmount: 1800,
            consumeAmount: 2600,
            createdTime: "2025-01-01 10:00:00",
            lastConsumeTime: "2026-04-01 18:00:00",
            silentDays: 11,
            rawStoreName: "华美店",
            rawJson: JSON.stringify({ Birthday: "1990-04-12" }),
          },
        ],
        listCustomerProfile90dByDateRange: async () => [],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店今天生日会员名单");
    expect(result).toContain("王女士");
  });

  it("dispatches wait-experience asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店昨天哪个时段等待最长",
      now,
    });

    expect(intent?.kind).toBe("wait_experience");

    const rows: TechUpClockRecord[] = [
      {
        orgId: "1002",
        rowFingerprint: "wait-1",
        personCode: "T001",
        personName: "技师甲",
        settleNo: "NO-1",
        handCardCode: "A08",
        itemName: "足疗",
        clockType: "2",
        count: 1,
        turnover: 298,
        comm: 88,
        ctime: "2026-04-12 13:05:00",
        settleTime: "2026-04-12 13:40:00",
        bizDate: "2026-04-12",
        rawJson: JSON.stringify({ WaitTime: 18, RoomCode: "A08", ClockType: 2 }),
      },
      {
        orgId: "1002",
        rowFingerprint: "wait-2",
        personCode: "T002",
        personName: "技师乙",
        settleNo: "NO-2",
        handCardCode: "B02",
        itemName: "SPA",
        clockType: "1",
        count: 1,
        turnover: 338,
        comm: 98,
        ctime: "2026-04-12 20:15:00",
        settleTime: "2026-04-12 20:40:00",
        bizDate: "2026-04-12",
        rawJson: JSON.stringify({ WaitTime: 42, RoomCode: "B02", ClockType: 1 }),
      },
    ];

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        listTechUpClockByDateRange: async () => rows,
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店昨天等待体验");
    expect(result).toContain("最长等待时段: 晚场");
  });

  it("dispatches recharge-attribution asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店近30天哪种卡型充值最好",
      now,
    });

    expect(intent?.kind).toBe("recharge_attribution");

    const rows: RechargeBillRecord[] = [
      {
        orgId: "1002",
        rechargeId: "R-001",
        realityAmount: 1800,
        totalAmount: 2100,
        donateAmount: 300,
        antiFlag: false,
        optTime: "2026-03-12 12:00:00",
        bizDate: "2026-03-12",
        rawJson: JSON.stringify({ CardTypeName: "金悦卡", Sales: "前台甲" }),
      },
      {
        orgId: "1002",
        rechargeId: "R-002",
        realityAmount: 900,
        totalAmount: 1000,
        donateAmount: 100,
        antiFlag: false,
        optTime: "2026-03-21 18:00:00",
        bizDate: "2026-03-21",
        rawJson: JSON.stringify({ CardTypeName: "银悦卡", Sales: "前台乙" }),
      },
    ];

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        listRechargeBillsByDateRange: async () => rows,
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店近30天充值卡型结构");
    expect(result).toContain("金悦卡");
  });

  it("dispatches report asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店昨天经营复盘",
      now,
    });

    expect(intent?.kind).toBe("report");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should use daily kpi fast path");
        },
        listStoreManagerDailyKpiByDateRange: async () => [
          {
            bizDate: "2026-04-12",
            orgId: "1002",
            storeName: "华美店",
            dailyActualRevenue: 15600,
            dailyCardConsume: 2600,
            dailyOrderCount: 42,
            totalClocks: 58,
            assignClocks: 12,
            queueClocks: 31,
            pointClockRate: 12 / 58,
            averageTicket: 371.4,
            clockEffect: 268.9,
          },
        ],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店 2026-04-12 经营复盘");
    expect(result).toContain("实收流水：15600.00 元");
  });

  it("dispatches trend asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const revenueByDate: Record<string, number> = {
      "2026-04-06": 2800,
      "2026-04-07": 3000,
      "2026-04-08": 3200,
      "2026-04-09": 3400,
      "2026-04-10": 3600,
      "2026-04-11": 3800,
      "2026-04-12": 4000,
    };
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店近7天营收趋势",
      now,
    });

    expect(intent?.kind).toBe("trend");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) =>
          buildReport({
            orgId,
            storeName: "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              serviceRevenue: revenueByDate[bizDate ?? "2026-04-12"] ?? 0,
            },
          }),
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店 近7天 服务营收趋势");
    expect(result).toContain("2026-04-06");
    expect(result).toContain("2026-04-12");
  });

  it("dispatches anomaly asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const currentValues: Record<string, { revenue: number; clocks: number; effect: number }> = {
      "2026-04-06": { revenue: 4200, clocks: 54, effect: 77.8 },
      "2026-04-07": { revenue: 4100, clocks: 53, effect: 77.4 },
      "2026-04-08": { revenue: 3900, clocks: 50, effect: 78.0 },
      "2026-04-09": { revenue: 3800, clocks: 49, effect: 77.6 },
      "2026-04-10": { revenue: 3600, clocks: 46, effect: 78.3 },
      "2026-04-11": { revenue: 3400, clocks: 44, effect: 77.3 },
      "2026-04-12": { revenue: 3200, clocks: 40, effect: 80.0 },
      "2026-03-30": { revenue: 5200, clocks: 66, effect: 78.8 },
      "2026-03-31": { revenue: 5100, clocks: 65, effect: 78.5 },
      "2026-04-01": { revenue: 5000, clocks: 63, effect: 79.4 },
      "2026-04-02": { revenue: 4900, clocks: 61, effect: 80.3 },
      "2026-04-03": { revenue: 4800, clocks: 60, effect: 80.0 },
      "2026-04-04": { revenue: 4700, clocks: 58, effect: 81.0 },
      "2026-04-05": { revenue: 4600, clocks: 57, effect: 80.7 },
    };
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店近7天营收下滑原因",
      now,
    });

    expect(intent?.kind).toBe("anomaly");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) => {
          const value = currentValues[bizDate ?? "2026-04-12"]!;
          return buildReport({
            orgId,
            storeName: "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              serviceRevenue: value.revenue,
              totalClockCount: value.clocks,
              clockEffect: value.effect,
              activeTechCount: 6,
            },
          });
        },
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店 近7天 营收异常归因");
    expect(result).toContain("主因是总钟数变化");
  });

  it("dispatches compare asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "hq-compare",
      role: "hq",
      scopeOrgIds: ["1001", "1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店和华美店昨天营收对比",
      now,
    });

    expect(intent?.kind).toBe("compare");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) =>
          buildReport({
            orgId,
            storeName: orgId === "1001" ? "义乌店" : "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              serviceRevenue: orgId === "1001" ? 3200 : 2900,
            },
          }),
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001", "1002"],
      now,
    });

    expect(result).toContain("义乌店 vs 华美店");
    expect(result).toContain("服务营收");
    expect(result).toContain("差额 +300.00 元");
  });

  it("uses daily-kpi rows for compare asks before falling back to buildReport", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "hq-compare-fast",
      role: "hq",
      scopeOrgIds: ["1001", "1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店和华美店昨天营收对比",
      now,
    });

    expect(intent?.kind).toBe("compare");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should use daily kpi compare fast path");
        },
        listStoreManagerDailyKpiByDateRange: async ({ orgId }) => [
          {
            bizDate: "2026-04-12",
            orgId,
            storeName: orgId === "1001" ? "义乌店" : "华美店",
            dailyActualRevenue: orgId === "1001" ? 3600 : 2900,
            dailyCardConsume: orgId === "1001" ? 600 : 500,
            dailyOrderCount: orgId === "1001" ? 18 : 16,
            totalClocks: orgId === "1001" ? 42 : 38,
            assignClocks: orgId === "1001" ? 9 : 7,
            queueClocks: orgId === "1001" ? 24 : 23,
            pointClockRate: orgId === "1001" ? 9 / 33 : 7 / 30,
            averageTicket: orgId === "1001" ? 200 : 181.25,
            clockEffect: orgId === "1001" ? 85.7 : 76.3,
          },
        ],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001", "1002"],
      now,
    });

    expect(result).toContain("义乌店 vs 华美店");
    expect(result).toContain("服务营收");
    expect(result).toContain("差额 +700.00 元");
  });

  it("dispatches store ranking asks through the runtime-render capability plane when serving is absent", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "hq-ranking",
      role: "hq",
      scopeOrgIds: ["1001", "1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "昨天两个店营收排名",
      now,
    });

    expect(intent?.kind).toBe("ranking");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) =>
          buildReport({
            orgId,
            storeName: orgId === "1001" ? "义乌店" : "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              serviceRevenue: orgId === "1001" ? 3600 : 2900,
            },
          }),
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001", "1002"],
      now,
    });

    expect(result).toContain("已授权门店 服务营收排名");
    expect(result).toContain("1. 义乌店 服务营收: 3600.00 元");
    expect(result).toContain("2. 华美店 服务营收: 2900.00 元");
  });

  it("dispatches technician ranking asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-tech-ranking",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天技师点钟率排名",
      now,
    });

    expect(intent?.kind).toBe("ranking");
    expect(intent?.rankingTarget).toBe("tech");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        listTechLeaderboard: async () => [
          {
            personCode: "tech-1",
            personName: "技师甲",
            totalClockCount: 12,
            upClockRecordCount: 16,
            pointClockRecordCount: 12,
            pointClockRate: 0.75,
            addClockRecordCount: 4,
            addClockRate: 0.25,
            turnover: 3200,
            commission: 1200,
            commissionRate: 0.375,
            clockEffect: 266.7,
            marketRevenue: 0,
            marketCommission: 0,
          },
          {
            personCode: "tech-2",
            personName: "技师乙",
            totalClockCount: 10,
            upClockRecordCount: 25,
            pointClockRecordCount: 10,
            pointClockRate: 0.4,
            addClockRecordCount: 5,
            addClockRate: 0.2,
            turnover: 2800,
            commission: 980,
            commissionRate: 0.35,
            clockEffect: 280,
            marketRevenue: 0,
            marketCommission: 0,
          },
        ],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001"],
      now,
    });

    expect(result).toContain("义乌店 2026-04-12 技师点钟率排名");
    expect(result).toContain("1. 技师甲 75.0%");
    expect(result).toContain("2. 技师乙 40.0%");
  });

  it("dispatches store metric asks through the runtime-render capability plane when serving is absent", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-metric",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天点钟率多少",
      now,
    });

    expect(intent?.kind).toBe("metric");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) =>
          buildReport({
            orgId,
            storeName: "义乌店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              upClockRecordCount: 40,
              pointClockRecordCount: 18,
              pointClockRate: 0.45,
            },
          }),
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001"],
      now,
    });

    expect(result).toContain("义乌店 2026-04-12 指标查询");
    expect(result).toContain("点钟数量: 18 个");
    expect(result).toContain("点钟率: 45.0%");
  });

  it("uses daily-kpi window aggregation for multi-day clock metrics before falling back to buildReport", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-metric-window",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近3天加钟数和加钟率",
      now,
    });

    expect(intent?.kind).toBe("metric");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should use daily kpi window fast path");
        },
        listStoreManagerDailyKpiByDateRange: async () => [
          {
            bizDate: "2026-04-10",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 12000,
            dailyCardConsume: 2200,
            dailyOrderCount: 40,
            totalClocks: 60,
            assignClocks: 12,
            queueClocks: 33,
            pointClockRate: 12 / 45,
            averageTicket: 300,
            clockEffect: 200,
          },
          {
            bizDate: "2026-04-11",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 12600,
            dailyCardConsume: 2400,
            dailyOrderCount: 42,
            totalClocks: 63,
            assignClocks: 15,
            queueClocks: 33,
            pointClockRate: 15 / 48,
            averageTicket: 300,
            clockEffect: 200,
          },
          {
            bizDate: "2026-04-12",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 13200,
            dailyCardConsume: 2600,
            dailyOrderCount: 44,
            totalClocks: 66,
            assignClocks: 18,
            queueClocks: 33,
            pointClockRate: 18 / 51,
            averageTicket: 300,
            clockEffect: 200,
          },
        ],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001"],
      now,
    });

    expect(result).toContain("义乌店 近3天 指标查询");
    expect(result).toContain("加钟数量: 45 个");
    expect(result).toContain("加钟率: 31.3%");
    expect(result).toContain("2026-04-10");
    expect(result).toContain("2026-04-12");
  });

  it("falls back to daily report snapshots when daily-kpi rows lack reliable clock breakdowns", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-metric-window-quality",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const now = new Date("2026-04-16T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近3天加钟数和加钟率",
      now,
    });

    expect(intent?.kind).toBe("metric");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build full legacy report");
        },
        listStoreManagerDailyKpiByDateRange: async () => [
          {
            bizDate: "2026-04-13",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 23043.8,
            dailyCardConsume: 5841.2,
            dailyOrderCount: 54,
            totalClocks: 105,
            assignClocks: 0,
            queueClocks: 0,
            pointClockRate: 0,
            averageTicket: 426.73,
            clockEffect: 219.46,
          },
          {
            bizDate: "2026-04-14",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 16747.9,
            dailyCardConsume: 3012.1,
            dailyOrderCount: 37,
            totalClocks: 72,
            assignClocks: 0,
            queueClocks: 0,
            pointClockRate: 0,
            averageTicket: 452.64,
            clockEffect: 232.61,
          },
          {
            bizDate: "2026-04-15",
            orgId: "1001",
            storeName: "义乌店",
            dailyActualRevenue: 22615,
            dailyCardConsume: 4626,
            dailyOrderCount: 49,
            totalClocks: 95,
            assignClocks: 0,
            queueClocks: 0,
            pointClockRate: 0,
            averageTicket: 461.53,
            clockEffect: 238.05,
          },
        ],
        getDailyReportSnapshot: async ({ bizDate }: { orgId: string; bizDate: string }) => {
          if (bizDate === "2026-04-13") {
            return buildReport({
              orgId: "1001",
              storeName: "义乌店",
              bizDate,
              metrics: {
                totalClockCount: 105,
                upClockRecordCount: 104,
                pointClockRecordCount: 29,
                pointClockRate: 29 / 104,
                addClockRecordCount: 9,
                addClockRate: 9 / 104,
              },
            });
          }
          if (bizDate === "2026-04-14") {
            return buildReport({
              orgId: "1001",
              storeName: "义乌店",
              bizDate,
              metrics: {
                totalClockCount: 72,
                upClockRecordCount: 71,
                pointClockRecordCount: 19,
                pointClockRate: 19 / 71,
                addClockRecordCount: 14,
                addClockRate: 14 / 71,
              },
            });
          }
          return null;
        },
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001"],
      now,
    });

    expect(result).toContain("义乌店 近3天 指标查询");
    expect(result).toContain("注意：当前营业日同步尚未完全收口");
    expect(result).toContain("2026-04-13：加钟数量 9 个，加钟率 8.7%（9/104）");
    expect(result).toContain("2026-04-14：加钟数量 14 个，加钟率 19.7%（14/71）");
    expect(result).toContain("2026-04-15：加钟明细待补齐，暂不输出当日加钟数量/加钟率");
    expect(result).toContain("加钟数量(已收口天数): 23 个");
    expect(result).toContain("加钟率(已收口天数): 13.1%（23/175）");
  });

  it("dispatches customer profile asks through the runtime-render capability plane when serving is absent", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-customer-profile",
      role: "manager",
      orgId: "1001",
      scopeOrgIds: ["1001"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店尾号7500客户画像",
      now,
    });

    expect(intent?.kind).toBe("customer_profile");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async () => {
          throw new Error("should not build report");
        },
        findCurrentMembersByPhoneSuffix: async () => [
          {
            orgId: "1001",
            memberId: "member-1",
            name: "王小明",
            phone: "13800007500",
            storedAmount: 888,
            consumeAmount: 999,
            createdTime: "2026-01-01 10:00:00",
            lastConsumeTime: "2026-04-10 20:00:00",
            silentDays: 2,
            rawJson: "{}",
          },
        ],
        listCurrentMembers: async () => [
          {
            orgId: "1001",
            memberId: "member-1",
            name: "王小明",
            phone: "13800007500",
            storedAmount: 888,
            consumeAmount: 999,
            createdTime: "2026-01-01 10:00:00",
            lastConsumeTime: "2026-04-10 20:00:00",
            silentDays: 2,
            rawJson: "{}",
          },
        ],
        listCurrentMemberCards: async () => [],
        listConsumeBillsByDateRange: async () => [],
        listTechMarketByDateRange: async () => [],
        listCustomerSegments: async () => [],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001"],
      now,
    });

    expect(result).toContain("义乌店 尾号7500");
    expect(result).toContain("当前状态");
  });

  it("dispatches risk asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店昨天风险和建议",
      now,
    });

    expect(intent?.kind).toBe("risk");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) =>
          buildReport({
            orgId,
            storeName: "华美店",
            bizDate: bizDate ?? "2026-04-12",
            alerts: [{ code: "groupbuy-high", severity: "warn", message: "团购占比偏高" }],
            suggestions: ["今天先把近7天未复到店团购客拉名单。"],
          }),
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店 昨天 风险与建议");
    expect(result).toContain("风险");
    expect(result).toContain("团购占比偏高");
  });

  it("dispatches advice tradeoff asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "manager-2",
      role: "manager",
      orgId: "1002",
      scopeOrgIds: ["1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店最近该先抓复购还是储值",
      now,
    });

    expect(intent?.kind).toBe("advice");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) =>
          buildReport({
            orgId,
            storeName: "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              memberRepurchaseBaseCustomerCount7d: 42,
              memberRepurchaseReturnedCustomerCount7d: 14,
              memberRepurchaseRate7d: 14 / 42,
              sleepingMemberRate: 0.19,
              currentStoredBalance: 88000,
              renewalPressureIndex30d: 1.08,
              storedBalanceLifeMonths: 4.1,
            },
          }),
        listStoreSummary30dByDateRange: async ({ startBizDate }) =>
          startBizDate === "2026-03-30"
            ? [
                buildStoreSummary30dRow({
                  orgId: "1002",
                  storeName: "华美店",
                  windowEndBizDate: "2026-03-30",
                  memberRepurchaseBaseCustomerCount7d: 42,
                  memberRepurchaseReturnedCustomerCount7d: 14,
                  memberRepurchaseRate7d: 14 / 42,
                  sleepingMemberRate: 0.19,
                  currentStoredBalance: 88000,
                  storedBalanceLifeMonths: 4.1,
                  renewalPressureIndex30d: 1.08,
                }),
              ]
            : [
                buildStoreSummary30dRow({
                  orgId: "1002",
                  storeName: "华美店",
                  windowEndBizDate: "2026-02-28",
                  memberRepurchaseBaseCustomerCount7d: 38,
                  memberRepurchaseReturnedCustomerCount7d: 18,
                  memberRepurchaseRate7d: 18 / 38,
                  sleepingMemberRate: 0.14,
                  currentStoredBalance: 86000,
                  storedBalanceLifeMonths: 4.3,
                  renewalPressureIndex30d: 0.96,
                }),
              ],
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1002"],
      now,
    });

    expect(result).toContain("华美店 当前更该先抓什么");
    expect(result).toContain("结论: 先抓复购和老客回流");
  });

  it("dispatches HQ portfolio asks through the runtime-render capability plane", async () => {
    const config = buildConfig();
    const binding: HetangEmployeeBinding = {
      channel: "wecom",
      senderId: "hq-1",
      role: "hq",
      scopeOrgIds: ["1001", "1002"],
      isActive: true,
    };
    const now = new Date("2026-04-13T10:00:00+08:00");
    const reports: Record<string, DailyStoreReport> = {
      "1001:2026-04-12": buildReport({
        orgId: "1001",
        storeName: "义乌店",
        bizDate: "2026-04-12",
        metrics: { serviceRevenue: 3600, sleepingMemberRate: 0.12 },
      }),
      "1002:2026-04-12": buildReport({
        orgId: "1002",
        storeName: "华美店",
        bizDate: "2026-04-12",
        metrics: { serviceRevenue: 2900, sleepingMemberRate: 0.2 },
        alerts: [{ code: "sleeping-high", severity: "warn", message: "沉默会员偏高" }],
      }),
      "1001:2026-04-05": buildReport({
        orgId: "1001",
        storeName: "义乌店",
        bizDate: "2026-04-05",
        metrics: { serviceRevenue: 3400, sleepingMemberRate: 0.11 },
      }),
      "1002:2026-04-05": buildReport({
        orgId: "1002",
        storeName: "华美店",
        bizDate: "2026-04-05",
        metrics: { serviceRevenue: 3300, sleepingMemberRate: 0.17 },
      }),
    };
    const intent = resolveHetangQueryIntent({
      config,
      text: "这周两个店整体怎么样，哪家最危险，下周总部先抓什么",
      now,
    });

    expect(intent?.kind).toBe("hq_portfolio");

    const result = await tryExecuteRuntimeRenderQueryPlane({
      runtime: {
        buildReport: async ({ orgId, bizDate }) =>
          reports[`${orgId}:${bizDate}`] ??
          buildReport({
            orgId,
            storeName: orgId === "1001" ? "义乌店" : "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics:
              orgId === "1001"
                ? { serviceRevenue: 3500, sleepingMemberRate: 0.12 }
                : { serviceRevenue: 3000, sleepingMemberRate: 0.18 },
          }),
      },
      config,
      binding,
      intent: intent!,
      effectiveOrgIds: ["1001", "1002"],
      now,
    });

    expect(result).toContain("总部经营全景");
    expect(result).toContain("最危险门店");
    expect(result).toContain("下周总部优先动作");
  });
});
