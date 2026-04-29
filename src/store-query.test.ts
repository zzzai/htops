import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import type { QueryAnalysisLens } from "./analysis-lens.js";
import {
  collectStoreWindowSummary,
  executeStoreRuntimeQuery,
  lookupStructuredStoreDailySummary,
  lookupStructuredStoreRiskScan,
  renderStoreClockBreakdownRuntimeText,
  renderStoreReportRuntimeText,
} from "./store-query.js";
import { resolveHetangQueryIntent } from "./query-intent.js";
import type {
  CustomerOperatingProfileDailyRecord,
  DailyStoreMetrics,
  DailyStoreReport,
  StoreSummary30dRow,
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
      {
        orgId: "1001",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
      },
      {
        orgId: "1002",
        storeName: "华美店",
        rawAliases: ["华美"],
      },
    ],
  });
}

function buildGrowthAnalysis(): QueryAnalysisLens {
  return {
    mode: "executive_analysis",
    persona_id: "growth_exec_cgo_cmo_v1",
    persona_label: "测试角色",
    role_mission: "测试使命",
    framework_id: "store_growth_diagnosis_v1",
    output_contract_id: "store_growth_brief_v2",
    audience: "store",
    priority_dimensions: ["retention", "member_asset_health", "unit_economics", "conversion"],
    signal_order: [],
    section_labels: {
      summary: "增长结论",
      signals: "这家店先看什么",
      actions: "店长今天先做什么",
      ranking: "结论",
    },
    reasoning_principles: [],
    forbidden_claims: [],
  };
}

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "迎宾店",
    bizDate: "2026-04-10",
    serviceRevenue: 16888,
    rechargeCash: 8000,
    rechargeStoredValue: 9600,
    rechargeBonusValue: 1600,
    antiServiceRevenue: 0,
    serviceOrderCount: 48,
    customerCount: 48,
    averageTicket: 351.8,
    totalClockCount: 67,
    upClockRecordCount: 50,
    pointClockRecordCount: 8,
    pointClockRate: 0.16,
    addClockRecordCount: 17,
    addClockRate: 0.34,
    clockRevenue: 16888,
    clockEffect: 252.1,
    activeTechCount: 7,
    onDutyTechCount: 8,
    techCommission: 5200,
    techCommissionRate: 0.31,
    marketRevenue: 0,
    marketCommission: 0,
    memberPaymentAmount: 10500,
    memberPaymentShare: 0.62,
    cashPaymentAmount: 2200,
    cashPaymentShare: 0.13,
    wechatPaymentAmount: 2500,
    wechatPaymentShare: 0.15,
    alipayPaymentAmount: 1688,
    alipayPaymentShare: 0.1,
    storedConsumeAmount: 9000,
    storedConsumeRate: 1.12,
    groupbuyOrderCount: 5,
    groupbuyOrderShare: 0.1,
    groupbuyAmount: 1200,
    groupbuyAmountShare: 0.07,
    groupbuyPlatformBreakdown: [],
    groupbuyCohortCustomerCount: 40,
    groupbuyRevisitCustomerCount: 18,
    groupbuyRevisitRate: 0.45,
    groupbuyMemberPayConvertedCustomerCount: 12,
    groupbuyMemberPayConversionRate: 0.3,
    groupbuy7dRevisitCustomerCount: 18,
    groupbuy7dRevisitRate: 0.45,
    groupbuy7dCardOpenedCustomerCount: 8,
    groupbuy7dCardOpenedRate: 0.2,
    groupbuy7dStoredValueConvertedCustomerCount: 7,
    groupbuy7dStoredValueConversionRate: 0.175,
    groupbuy30dMemberPayConvertedCustomerCount: 15,
    groupbuy30dMemberPayConversionRate: 0.375,
    groupbuyFirstOrderCustomerCount: 18,
    groupbuyFirstOrderHighValueMemberCustomerCount: 4,
    groupbuyFirstOrderHighValueMemberRate: 4 / 18,
    effectiveMembers: 180,
    newMembers: 12,
    sleepingMembers: 30,
    sleepingMemberRate: 30 / 180,
    currentStoredBalance: 52000,
    roomOccupancyRate: 0.8,
    roomTurnoverRate: 3.1,
    grossMarginRate: 0.58,
    netMarginRate: 0.22,
    breakEvenRevenue: 12000,
    incompleteSync: false,
    unavailableMetrics: [],
    storedBalanceLifeMonths: 3.8,
    renewalPressureIndex30d: 0.92,
    memberRepurchaseBaseCustomerCount7d: 42,
    memberRepurchaseReturnedCustomerCount7d: 14,
    memberRepurchaseRate7d: 14 / 42,
    ...overrides,
  };
}

function buildReport(params: {
  orgId: string;
  storeName: string;
  bizDate: string;
  metrics?: Partial<DailyStoreMetrics>;
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
    alerts: [],
    suggestions: [],
    markdown: `${params.storeName} ${params.bizDate} 日报`,
    complete: params.complete ?? true,
  };
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
    revenue30d: 320000,
    orderCount30d: 2200,
    customerCount30d: 2200,
    totalClocks30d: 2800,
    clockEffect30d: 114.3,
    averageTicket30d: 145.4,
    pointClockRate30d: 0.41,
    addClockRate30d: 0.18,
    rechargeCash30d: 98000,
    storedConsumeAmount30d: 72000,
    storedConsumeRate30d: 0.73,
    onDutyTechCount30d: 16,
    groupbuyOrderShare30d: 0.22,
    groupbuyCohortCustomerCount: 180,
    groupbuy7dRevisitCustomerCount: 78,
    groupbuy7dRevisitRate: 0.43,
    groupbuy7dCardOpenedCustomerCount: 24,
    groupbuy7dCardOpenedRate: 0.13,
    groupbuy7dStoredValueConvertedCustomerCount: 21,
    groupbuy7dStoredValueConversionRate: 0.12,
    groupbuy30dMemberPayConvertedCustomerCount: 62,
    groupbuy30dMemberPayConversionRate: 0.34,
    groupbuyFirstOrderCustomerCount: 70,
    groupbuyFirstOrderHighValueMemberCustomerCount: 19,
    groupbuyFirstOrderHighValueMemberRate: 19 / 70,
    effectiveMembers: 420,
    sleepingMembers: 110,
    sleepingMemberRate: 110 / 420,
    newMembers30d: 55,
    activeTechCount30d: 14,
    currentStoredBalance: 360000,
    storedBalanceLifeMonths: 3.6,
    renewalPressureIndex30d: 0.84,
    memberRepurchaseBaseCustomerCount7d: 48,
    memberRepurchaseReturnedCustomerCount7d: 21,
    memberRepurchaseRate7d: 21 / 48,
    ...rest,
  };
}

describe("lookupStructuredStoreDailySummary", () => {
  it("builds a structured payload for tool-facing daily summary lookup", async () => {
    const config = buildConfig();

    const result = await lookupStructuredStoreDailySummary({
      runtime: {
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
              dailyActualRevenue: 12345,
              dailyCardConsume: 4567,
              dailyOrderCount: 89,
              totalClocks: 110,
              assignClocks: 48,
              queueClocks: 62,
              pointClockRate: 0.436,
              averageTicket: 138.7,
              clockEffect: 112.2,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      bizDate: "2026-04-10",
    });

    expect(result).toEqual({
      org_id: "1001",
      store_name: "迎宾店",
      biz_date: "2026-04-10",
      metrics: {
        revenue: 12345,
        card_consume: 4567,
        order_count: 89,
        total_clocks: 110,
        assign_clocks: 48,
        queue_clocks: 62,
        point_clock_rate: 0.436,
        average_ticket: 138.7,
        clock_effect: 112.2,
      },
    });
  });
});

describe("lookupStructuredStoreRiskScan", () => {
  it("builds structured risk signals from 7d and 30d windows", async () => {
    const config = buildConfig();

    const result = await lookupStructuredStoreRiskScan({
      runtime: {
        listStoreReview7dByDateRange: async () =>
          [
            {
              orgId: "1001",
              windowEndBizDate: "2026-04-10",
              storeName: "迎宾店",
              revenue7d: 70000,
              orderCount7d: 520,
              totalClocks7d: 620,
              clockEffect7d: 112.9,
              averageTicket7d: 134.6,
              pointClockRate7d: 0.31,
              addClockRate7d: 0.09,
              rechargeCash7d: 18000,
              storedConsumeAmount7d: 25000,
              storedConsumeRate7d: 0.28,
              onDutyTechCount7d: 16,
              groupbuyOrderShare7d: 0.41,
              groupbuyCohortCustomerCount: 120,
              groupbuy7dRevisitCustomerCount: 19,
              groupbuy7dRevisitRate: 0.16,
              groupbuy7dCardOpenedCustomerCount: 9,
              groupbuy7dCardOpenedRate: 0.075,
              groupbuy7dStoredValueConvertedCustomerCount: 4,
              groupbuy7dStoredValueConversionRate: 0.033,
              groupbuy30dMemberPayConvertedCustomerCount: 11,
              groupbuy30dMemberPayConversionRate: 0.092,
              groupbuyFirstOrderCustomerCount: 36,
              groupbuyFirstOrderHighValueMemberCustomerCount: 5,
              groupbuyFirstOrderHighValueMemberRate: 0.139,
              effectiveMembers: 880,
              sleepingMembers: 402,
              sleepingMemberRate: 0.457,
              newMembers7d: 28,
              activeTechCount7d: 13,
              currentStoredBalance: 356000,
              storedBalanceLifeMonths: 2.4,
              renewalPressureIndex30d: 0.68,
              memberRepurchaseBaseCustomerCount7d: 132,
              memberRepurchaseReturnedCustomerCount7d: 36,
              memberRepurchaseRate7d: 0.273,
            },
          ] as never,
        listStoreSummary30dByDateRange: async () =>
          [
            {
              orgId: "1001",
              windowEndBizDate: "2026-04-10",
              storeName: "迎宾店",
              revenue30d: 298000,
              orderCount30d: 2150,
              totalClocks30d: 2640,
              clockEffect30d: 112.9,
              averageTicket30d: 138.6,
              pointClockRate30d: 0.33,
              addClockRate30d: 0.08,
              rechargeCash30d: 82000,
              storedConsumeAmount30d: 103000,
              storedConsumeRate30d: 0.31,
              onDutyTechCount30d: 17,
              groupbuyOrderShare30d: 0.39,
              groupbuyCohortCustomerCount: 420,
              groupbuy7dRevisitCustomerCount: 58,
              groupbuy7dRevisitRate: 0.138,
              groupbuy7dCardOpenedCustomerCount: 31,
              groupbuy7dCardOpenedRate: 0.074,
              groupbuy7dStoredValueConvertedCustomerCount: 12,
              groupbuy7dStoredValueConversionRate: 0.029,
              groupbuy30dMemberPayConvertedCustomerCount: 35,
              groupbuy30dMemberPayConversionRate: 0.083,
              groupbuyFirstOrderCustomerCount: 121,
              groupbuyFirstOrderHighValueMemberCustomerCount: 16,
              groupbuyFirstOrderHighValueMemberRate: 0.132,
              effectiveMembers: 880,
              sleepingMembers: 402,
              sleepingMemberRate: 0.457,
              newMembers30d: 103,
              activeTechCount30d: 14,
              currentStoredBalance: 356000,
              storedBalanceLifeMonths: 2.4,
              renewalPressureIndex30d: 0.68,
              memberRepurchaseBaseCustomerCount7d: 132,
              memberRepurchaseReturnedCustomerCount7d: 36,
              memberRepurchaseRate7d: 0.273,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      bizDate: "2026-04-10",
    });

    expect(result).toMatchObject({
      org_id: "1001",
      store_name: "迎宾店",
      window_end_biz_date: "2026-04-10",
      review_7d: {
        revenue_7d: 70000,
        point_clock_rate_7d: 0.31,
        add_clock_rate_7d: 0.09,
      },
      summary_30d: {
        revenue_30d: 298000,
        point_clock_rate_30d: 0.33,
        stored_consume_rate_30d: 0.31,
      },
      signals: expect.arrayContaining([
        expect.objectContaining({
          key: "low_member_store_consume_rate",
          severity: "high",
        }),
        expect.objectContaining({
          key: "weak_addon_rate",
          severity: "high",
        }),
      ]),
    });
  });
});

describe("collectStoreWindowSummary", () => {
  it("uses stable 30d summary rows as the authoritative window overlay", async () => {
    const summary = await collectStoreWindowSummary({
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-10",
            metrics: {
              serviceRevenue: bizDate === "2026-04-10" ? 16000 : 15000,
              totalClockCount: bizDate === "2026-04-10" ? 64 : 60,
              clockEffect: bizDate === "2026-04-10" ? 250 : 250,
              activeTechCount: 6,
            },
          }),
        listStoreSummary30dByDateRange: async () =>
          [
            buildStoreSummary30dRow({
              orgId: "1001",
              storeName: "迎宾店",
              windowEndBizDate: "2026-04-10",
              revenue30d: 320000,
              totalClocks30d: 2800,
              clockEffect30d: 114.3,
              pointClockRate30d: 0.41,
              addClockRate30d: 0.18,
            }),
          ] as never,
      },
      orgId: "1001",
      frame: {
        kind: "range",
        startBizDate: "2026-04-09",
        endBizDate: "2026-04-10",
        label: "近2天",
        days: 30,
      },
      now: new Date("2026-04-11T10:00:00+08:00"),
      requestedMetrics: ["serviceRevenue"],
    });

    expect(summary.storeName).toBe("迎宾店");
    expect(summary.metrics.serviceRevenue).toBe(320000);
    expect(summary.metrics.totalClockCount).toBe(2800);
    expect(summary.metrics.pointClockRate).toBe(0.41);
    expect(summary.metrics.addClockRate).toBe(0.18);
  });
});

describe("executeStoreRuntimeQuery", () => {
  it("exposes owner clock-breakdown renderer for executor delegation", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天总钟数构成",
      now,
    });

    expect(intent?.kind).toBe("metric");

    const result = await renderStoreClockBreakdownRuntimeText({
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-10",
            metrics: {
              totalClockCount: 67,
              upClockRecordCount: 50,
              pointClockRecordCount: 8,
              addClockRecordCount: 17,
            },
          }),
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
              dailyActualRevenue: 16888,
              dailyCardConsume: 3200,
              dailyOrderCount: 48,
              totalClocks: 67,
              assignClocks: 8,
              queueClocks: 42,
              pointClockRate: 0.16,
              averageTicket: 351.8,
              clockEffect: 252.1,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 2026-04-10 钟数构成");
    expect(result).toContain("点钟: 8.0 个");
    expect(result).toContain("排钟: 42.0 个");
    expect(result).toContain("加钟: 17.0 个");
  });

  it("exposes owner single-day report renderer for executor delegation", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天经营复盘",
      now,
    });

    expect(intent?.kind).toBe("report");

    const result = await renderStoreReportRuntimeText({
      runtime: {
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
              dailyActualRevenue: 16888,
              dailyCardConsume: 3200,
              dailyOrderCount: 48,
              totalClocks: 67,
              assignClocks: 8,
              queueClocks: 42,
              pointClockRate: 8 / 50,
              averageTicket: 351.8,
              clockEffect: 252.1,
            },
          ] as never,
      },
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 2026-04-10 经营复盘");
    expect(result).toContain("实收流水：16888.00 元");
    expect(result).toContain("点钟/排钟：8.0 / 42.0");
  });

  it("owns the single-day metric summary fast path for store metric capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天营收多少",
      now,
    });

    expect(intent?.kind).toBe("metric");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_metric_summary_v1" as never,
      runtime: {
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
              dailyActualRevenue: 16888,
              dailyCardConsume: 3200,
              dailyOrderCount: 48,
              totalClocks: 67,
              assignClocks: 8,
              queueClocks: 42,
              pointClockRate: 8 / 50,
              averageTicket: 351.8,
              clockEffect: 252.1,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 2026-04-10 指标查询");
    expect(result).toContain("服务营收: 16888.00 元");
  });

  it("does not answer single-day 客单价 asks from the lightweight daily-kpi fast path", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天客单价",
      now,
    });

    expect(intent?.kind).toBe("metric");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_metric_summary_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-10",
            metrics: {
              serviceRevenue: 566,
              serviceOrderCount: 2,
              customerCount: 3,
              averageTicket: 188.67,
            },
          }),
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
              dailyActualRevenue: 566,
              dailyCardConsume: 0,
              dailyOrderCount: 2,
              totalClocks: 3,
              assignClocks: 1,
              queueClocks: 1,
              pointClockRate: 0.5,
              averageTicket: 283,
              clockEffect: 188.67,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("客单价: 188.67 元");
  });

  it("summarizes window 客单价 from customerCount instead of serviceOrderCount", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");

    const summary = await collectStoreWindowSummary({
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) => {
          if (bizDate === "2026-04-09") {
            return buildReport({
              orgId,
              storeName: "迎宾店",
              bizDate,
              metrics: {
                serviceRevenue: 400,
                serviceOrderCount: 2,
                customerCount: 3,
                averageTicket: 133.33,
              },
            });
          }
          return buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-10",
            metrics: {
              serviceRevenue: 200,
              serviceOrderCount: 1,
              customerCount: 2,
              averageTicket: 100,
            },
          });
        },
      },
      orgId: "1001",
      frame: {
        kind: "range",
        startBizDate: "2026-04-09",
        endBizDate: "2026-04-10",
        label: "近2天",
        days: 2,
      },
      now,
      requestedMetrics: ["averageTicket"],
    });

    expect(summary.metrics.serviceOrderCount).toBe(3);
    expect(summary.metrics.customerCount).toBe(5);
    expect(summary.metrics.averageTicket).toBe(120);
    expect(config.stores[0]?.storeName).toBe("迎宾店");
  });

  it("owns the lightweight window metric summary path for store metric capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近3天加钟数和加钟率",
      now,
    });

    expect(intent?.kind).toBe("metric");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_metric_summary_v1" as never,
      runtime: {
        buildReport: async () => {
          throw new Error("should use daily kpi window summary path");
        },
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
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
              storeName: "迎宾店",
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
              storeName: "迎宾店",
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
          ] as never,
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 近3天 指标查询");
    expect(result).toContain("加钟数量: 45 个");
    expect(result).toContain("加钟率: 31.3%");
    expect(result).toContain("2026-04-10");
    expect(result).toContain("2026-04-12");
  });

  it("owns the single-day cross-store compare fast path for store compare capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店和华美店昨天营收对比",
      now,
    });

    expect(intent?.kind).toBe("compare");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_compare_v1" as never,
      runtime: {
        listStoreManagerDailyKpiByDateRange: async ({ orgId }) =>
          [
            {
              bizDate: "2026-04-10",
              orgId,
              storeName: orgId === "1001" ? "迎宾店" : "华美店",
              dailyActualRevenue: orgId === "1001" ? 16888 : 15200,
              dailyCardConsume: orgId === "1001" ? 3200 : 2800,
              dailyOrderCount: orgId === "1001" ? 48 : 45,
              totalClocks: orgId === "1001" ? 67 : 61,
              assignClocks: orgId === "1001" ? 8 : 11,
              queueClocks: orgId === "1001" ? 42 : 36,
              pointClockRate: orgId === "1001" ? 8 / 50 : 11 / 47,
              averageTicket: orgId === "1001" ? 351.8 : 337.8,
              clockEffect: orgId === "1001" ? 252.1 : 249.2,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 vs 华美店");
    expect(result).toContain("服务营收");
    expect(result).toContain("差额 +1688.00 元");
  });

  it("owns the window compare path for store compare capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近7天营收对比",
      now,
    });

    expect(intent?.kind).toBe("compare");

    const revenueByDate: Record<string, number> = {
      "2026-03-30": 1100,
      "2026-03-31": 1150,
      "2026-04-01": 1200,
      "2026-04-02": 1250,
      "2026-04-03": 1300,
      "2026-04-04": 1350,
      "2026-04-05": 1400,
      "2026-04-06": 1500,
      "2026-04-07": 1550,
      "2026-04-08": 1600,
      "2026-04-09": 1650,
      "2026-04-10": 1700,
      "2026-04-11": 1750,
      "2026-04-12": 1800,
    };

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_compare_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              serviceRevenue: revenueByDate[bizDate ?? "2026-04-12"] ?? 0,
            },
          }),
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 近7天 vs 前7天");
    expect(result).toContain("服务营收");
    expect(result).toContain("11550.00 元");
    expect(result).toContain("8750.00 元");
    expect(result).toContain("差额 +2800.00 元");
  });

  it("owns the single-day report fast path for store report capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天经营复盘",
      now,
    });

    expect(intent?.kind).toBe("report");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_report_v1",
      runtime: {
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
              dailyActualRevenue: 16888,
              dailyCardConsume: 3200,
              dailyOrderCount: 48,
              totalClocks: 67,
              assignClocks: 8,
              queueClocks: 42,
              pointClockRate: 8 / 50,
              averageTicket: 351.8,
              clockEffect: 252.1,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 2026-04-10 经营复盘");
    expect(result).toContain("实收流水：16888.00 元");
    expect(result).toContain("点钟/排钟：8.0 / 42.0");
  });

  it("owns the window report path for store report capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近7天经营复盘",
      now,
    });

    expect(intent?.kind).toBe("report");

    const revenueByDate: Record<string, number> = {
      "2026-04-06": 2800,
      "2026-04-07": 3000,
      "2026-04-08": 3200,
      "2026-04-09": 3400,
      "2026-04-10": 3600,
      "2026-04-11": 3800,
      "2026-04-12": 4000,
      "2026-03-30": 2400,
      "2026-03-31": 2500,
      "2026-04-01": 2600,
      "2026-04-02": 2700,
      "2026-04-03": 2800,
      "2026-04-04": 2900,
      "2026-04-05": 3000,
    };

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_report_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              serviceRevenue: revenueByDate[bizDate ?? "2026-04-12"] ?? 0,
              totalClockCount: 40,
              activeTechCount: 6,
              newMembers: 5,
            },
          }),
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("迎宾店 近7天 经营复盘");
    expect(result).toContain("结论摘要");
    expect(result).toContain("上周对比");
  });

  it("owns lightweight trend rendering for store trend capability", async () => {
    const config = buildConfig();
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

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_trend_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
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
      orgId: "1002",
      intent: intent!,
      now,
    });

    expect(result).toContain("华美店 近7天 服务营收趋势");
    expect(result).toContain("2026-04-06");
    expect(result).toContain("2026-04-12");
  });

  it("owns non-lightweight trend rendering via report truth source", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店近7天新增会员趋势",
      now,
    });

    expect(intent?.kind).toBe("trend");

    const newMembersByDate: Record<string, number> = {
      "2026-04-06": 2,
      "2026-04-07": 3,
      "2026-04-08": 4,
      "2026-04-09": 5,
      "2026-04-10": 6,
      "2026-04-11": 7,
      "2026-04-12": 8,
    };

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_trend_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              newMembers: newMembersByDate[bizDate ?? "2026-04-12"] ?? 0,
            },
          }),
      },
      config,
      orgId: "1002",
      intent: intent!,
      now,
    });

    expect(result).toContain("华美店 近7天 新增会员趋势");
    expect(result).toContain("2026-04-06");
    expect(result).toContain("2026-04-12");
  });

  it("owns lightweight anomaly rendering for store anomaly capability", async () => {
    const config = buildConfig();
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

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_anomaly_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) => {
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
      orgId: "1002",
      intent: intent!,
      now,
    });

    expect(result).toContain("华美店 近7天 营收异常归因");
    expect(result).toContain("主因是总钟数变化");
  });

  it("owns non-lightweight anomaly rendering via report truth source", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店近7天新增会员下滑原因",
      now,
    });

    expect(intent?.kind).toBe("anomaly");

    const currentValues: Record<string, number> = {
      "2026-04-06": 4,
      "2026-04-07": 4,
      "2026-04-08": 3,
      "2026-04-09": 3,
      "2026-04-10": 2,
      "2026-04-11": 2,
      "2026-04-12": 1,
      "2026-03-30": 8,
      "2026-03-31": 8,
      "2026-04-01": 7,
      "2026-04-02": 7,
      "2026-04-03": 6,
      "2026-04-04": 6,
      "2026-04-05": 5,
    };

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_anomaly_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: {
              newMembers: currentValues[bizDate ?? "2026-04-12"] ?? 0,
            },
          }),
      },
      config,
      orgId: "1002",
      intent: intent!,
      now,
    });

    expect(result).toContain("华美店 近7天 新增会员异常归因");
    expect(result).toContain("结论:");
  });

  it("owns lightweight ranking rendering for store ranking capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "昨天各店营收排名",
      now,
    });

    expect(intent?.kind).toBe("ranking");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_ranking_v1" as never,
      runtime: {
        listStoreManagerDailyKpiByDateRange: async ({ orgId }) =>
          [
            {
              bizDate: "2026-04-10",
              orgId,
              storeName: orgId === "1001" ? "迎宾店" : "华美店",
              dailyActualRevenue: orgId === "1001" ? 16888 : 15200,
              dailyCardConsume: orgId === "1001" ? 3200 : 2800,
              dailyOrderCount: orgId === "1001" ? 48 : 45,
              totalClocks: orgId === "1001" ? 67 : 61,
              assignClocks: orgId === "1001" ? 8 : 11,
              queueClocks: orgId === "1001" ? 42 : 36,
              pointClockRate: orgId === "1001" ? 8 / 50 : 11 / 47,
              averageTicket: orgId === "1001" ? 351.8 : 337.8,
              clockEffect: orgId === "1001" ? 252.1 : 249.2,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      orgIds: ["1001", "1002"],
      intent: intent!,
      now,
    });

    expect(result).toContain("2店 服务营收排名");
    expect(result).toContain("1. 迎宾店 服务营收: 16888.00 元");
    expect(result).toContain("2. 华美店 服务营收: 15200.00 元");
  });

  it("owns non-lightweight ranking rendering via report truth source", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-11T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "昨天各店新增会员排名",
      now,
    });

    expect(intent?.kind).toBe("ranking");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_ranking_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: orgId === "1001" ? "迎宾店" : "华美店",
            bizDate: bizDate ?? "2026-04-10",
            metrics: {
              newMembers: orgId === "1001" ? 9 : 6,
            },
          }),
      },
      config,
      orgId: "1001",
      orgIds: ["1001", "1002"],
      intent: intent!,
      now,
    });

    expect(result).toContain("2店 新增会员排名");
    expect(result).toContain("1. 迎宾店 新增会员: 9 人");
    expect(result).toContain("2. 华美店 新增会员: 6 人");
  });

  it("owns runtime clock-breakdown rendering for store capabilities", async () => {
    const config = buildConfig();
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店昨天总钟数构成",
      now: new Date("2026-04-11T10:00:00+08:00"),
    });

    expect(intent?.kind).toBe("metric");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_metric_breakdown_runtime_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-10",
            metrics: {
              totalClockCount: 67,
              upClockRecordCount: 50,
              pointClockRecordCount: 8,
              addClockRecordCount: 17,
            },
          }),
        listStoreManagerDailyKpiByDateRange: async () =>
          [
            {
              bizDate: "2026-04-10",
              orgId: "1001",
              storeName: "迎宾店",
              dailyActualRevenue: 16888,
              dailyCardConsume: 3200,
              dailyOrderCount: 48,
              totalClocks: 67,
              assignClocks: 8,
              queueClocks: 42,
              pointClockRate: 0.16,
              averageTicket: 351.8,
              clockEffect: 252.1,
            },
          ] as never,
      },
      config,
      orgId: "1001",
      intent: intent!,
      now: new Date("2026-04-11T10:00:00+08:00"),
    });

    expect(result).toContain("迎宾店 2026-04-10 钟数构成");
    expect(result).toContain("点钟: 8.0 个");
    expect(result).toContain("排钟: 42.0 个");
    expect(result).toContain("加钟: 17.0 个");
  });

  it("owns tradeoff advice rendering for store advice capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-16T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店最近该先抓复购还是储值",
      now,
    });

    expect(intent?.kind).toBe("advice");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_advice_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-15",
            metrics: {
              sleepingMemberRate: 0.19,
              currentStoredBalance: 88000,
              storedBalanceLifeMonths: 4.1,
              renewalPressureIndex30d: 1.08,
              memberRepurchaseBaseCustomerCount7d: 48,
              memberRepurchaseReturnedCustomerCount7d: 16,
              memberRepurchaseRate7d: 16 / 48,
            },
          }),
        listStoreSummary30dByDateRange: async ({ endBizDate }) =>
          [
            buildStoreSummary30dRow({
              orgId: "1001",
              storeName: "迎宾店",
              windowEndBizDate: endBizDate,
              sleepingMemberRate: endBizDate === "2026-04-15" ? 0.19 : 0.14,
              currentStoredBalance: endBizDate === "2026-04-15" ? 88000 : 86000,
              storedBalanceLifeMonths: endBizDate === "2026-04-15" ? 4.1 : 4.3,
              renewalPressureIndex30d: endBizDate === "2026-04-15" ? 1.08 : 0.96,
              memberRepurchaseBaseCustomerCount7d: endBizDate === "2026-04-15" ? 48 : 42,
              memberRepurchaseReturnedCustomerCount7d: endBizDate === "2026-04-15" ? 16 : 18,
              memberRepurchaseRate7d: endBizDate === "2026-04-15" ? 16 / 48 : 18 / 42,
            }),
          ],
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
    });

    expect(result).toContain("结论: 先抓复购和老客回流");
    expect(result).toContain("会员7日复购率 33.3%（16/48）");
    expect(result).toContain("储值寿命 4.1 个月");
  });

  it("owns generic risk-and-advice rendering for store risk capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "华美店昨天风险和建议",
      now,
    });

    expect(intent?.kind).toBe("risk");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_risk_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          ({
            orgId,
            storeName: "华美店",
            bizDate: bizDate ?? "2026-04-12",
            metrics: buildMetrics({
              orgId,
              storeName: "华美店",
              bizDate: bizDate ?? "2026-04-12",
            }),
            alerts: [{ code: "groupbuy-high", severity: "warn", message: "团购占比偏高" }],
            suggestions: ["今天先把近7天未复到店团购客拉名单。"],
            markdown: "",
            complete: true,
          }) as never,
      },
      config,
      orgId: "1002",
      intent: intent!,
      now,
    });

    expect(result).toContain("华美店 昨天 风险与建议");
    expect(result).toContain("风险");
    expect(result).toContain("团购占比偏高");
  });

  it("threads inferred environment context into store advice runtime rendering", async () => {
    const config = resolveHetangOpsConfig({
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
          roomCount: 24,
          operatingHoursPerDay: 15,
        },
      ],
    });
    const now = new Date("2026-04-20T20:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近7天重点看什么",
      now,
    });

    expect(intent?.kind).toBe("advice");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_advice_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-18",
            metrics: {
              memberRepurchaseBaseCustomerCount7d: 42,
              memberRepurchaseReturnedCustomerCount7d: 10,
              memberRepurchaseRate7d: 10 / 42,
              sleepingMemberRate: 0.19,
              renewalPressureIndex30d: 1.32,
              storedBalanceLifeMonths: 2.4,
              addClockRate: 0.18,
              averageTicket: 180,
            },
          }),
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
      analysis: buildGrowthAnalysis(),
    });

    expect(result).toContain("春季晚间出行偏活跃");
    expect(result).toContain("清明");
  });

  it("prefers persisted environment memory over inferred fallback for store advice rendering", async () => {
    const config = resolveHetangOpsConfig({
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
          roomCount: 24,
          operatingHoursPerDay: 15,
        },
      ],
    });
    const now = new Date("2026-04-20T20:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近7天重点看什么",
      now,
    });

    expect(intent?.kind).toBe("advice");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_advice_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-18",
            metrics: {
              memberRepurchaseBaseCustomerCount7d: 42,
              memberRepurchaseReturnedCustomerCount7d: 10,
              memberRepurchaseRate7d: 10 / 42,
              sleepingMemberRate: 0.19,
              renewalPressureIndex30d: 1.32,
              storedBalanceLifeMonths: 2.4,
              addClockRate: 0.18,
              averageTicket: 180,
            },
          }),
        getStoreEnvironmentMemory: async () => ({
          orgId: "1001",
          bizDate: "2026-04-05",
          holidayTag: "holiday",
          holidayName: "清明节",
          solarTerm: "qingming",
          weatherTag: "storm",
          badWeatherTouchPenalty: "high",
          eveningOutingLikelihood: "low",
          postDinnerLeisureBias: "low",
          narrativePolicy: "mention",
          snapshotJson: "{}",
          collectedAt: "2026-04-06T03:00:00.000Z",
          updatedAt: "2026-04-06T03:00:00.000Z",
        }),
      },
      config,
      orgId: "1001",
      intent: intent!,
      now,
      analysis: buildGrowthAnalysis(),
    });

    expect(result).toContain("今天天气偏弱");
    expect(result).not.toContain("春季晚间出行偏活跃");
  });

  it("loads latest store external context into store advice runtime rendering", async () => {
    const config = resolveHetangOpsConfig({
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
          roomCount: 24,
          operatingHoursPerDay: 15,
        },
      ],
    });
    const now = new Date("2026-04-20T20:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近7天重点看什么",
      now,
    });

    expect(intent?.kind).toBe("advice");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_advice_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-18",
            metrics: {
              memberRepurchaseBaseCustomerCount7d: 42,
              memberRepurchaseReturnedCustomerCount7d: 10,
              memberRepurchaseRate7d: 10 / 42,
              sleepingMemberRate: 0.19,
              renewalPressureIndex30d: 1.32,
              storedBalanceLifeMonths: 2.4,
              addClockRate: 0.18,
              averageTicket: 180,
            },
          }),
        listStoreExternalContextEntries: async () => [
          {
            orgId: "1001",
            snapshotDate: "2026-04-18",
            contextKind: "store_business_profile",
            metricKey: "service_hours",
            valueText: "11:30-次日02:00",
            truthLevel: "confirmed",
            confidence: "high",
            sourceType: "store_page_screenshot",
            sourceLabel: "门店页截图",
            applicableModules: ["store_advice"],
            notForScoring: false,
            rawJson: "{}",
            updatedAt: "2026-04-18T10:00:00.000Z",
          },
          {
            orgId: "1001",
            snapshotDate: "2026-04-18",
            contextKind: "estimated_market_context",
            metricKey: "market_population_scale_3km",
            valueText: "44.96 万人",
            valueNum: 449600,
            truthLevel: "estimated",
            confidence: "medium",
            sourceType: "third_party_pdf",
            sourceLabel: "查周边.pdf",
            applicableModules: ["store_advice"],
            notForScoring: true,
            rawJson: "{}",
            updatedAt: "2026-04-18T10:01:00.000Z",
          },
          {
            orgId: "1001",
            snapshotDate: "2026-04-18",
            contextKind: "research_note",
            metricKey: "store_business_scene_inference",
            valueText: "大店 + 晚场 + 多人局 + 商务/社区混合型",
            truthLevel: "research_note",
            confidence: "medium",
            sourceType: "composite_research_judgement",
            sourceLabel: "综合研判",
            applicableModules: ["store_advice"],
            notForScoring: true,
            note: "仅用于经营解释",
            rawJson: "{}",
            updatedAt: "2026-04-18T10:04:00.000Z",
          },
        ],
      } as never,
      config,
      orgId: "1001",
      intent: intent!,
      now,
      analysis: buildGrowthAnalysis(),
    });

    expect(result).toContain("外部情报补充");
    expect(result).toContain("11:30-次日02:00");
    expect(result).toContain("大店 + 晚场");
    expect(result).toContain("世界模型补充判断");
    expect(result).toContain("后续会继续补数完善");
  });

  it("threads operating profile coverage into store advice world-model supplement", async () => {
    const config = resolveHetangOpsConfig({
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
          roomCount: 24,
          operatingHoursPerDay: 15,
        },
      ],
    });
    const now = new Date("2026-04-20T20:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "迎宾店近7天重点看什么",
      now,
    });

    expect(intent?.kind).toBe("advice");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "store_advice_v1",
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) =>
          buildReport({
            orgId,
            storeName: "迎宾店",
            bizDate: bizDate ?? "2026-04-18",
            metrics: {
              memberRepurchaseBaseCustomerCount7d: 42,
              memberRepurchaseReturnedCustomerCount7d: 10,
              memberRepurchaseRate7d: 10 / 42,
              sleepingMemberRate: 0.19,
              renewalPressureIndex30d: 1.32,
              storedBalanceLifeMonths: 2.4,
              addClockRate: 0.18,
              averageTicket: 180,
            },
          }),
        listCustomerOperatingProfilesDaily: async () => [
          {
            orgId: "1001",
            bizDate: "2026-04-18",
            memberId: "M-001",
            customerIdentityKey: "member:M-001",
            customerDisplayName: "王女士",
            identityProfileJson: {},
            spendingProfileJson: {},
            serviceNeedProfileJson: {
              primary_need: "肩颈放松",
              signal_confidence: "high",
              truth_boundary: "hard_fact",
              confidence_discount: 0.05,
            },
            interactionProfileJson: {},
            preferenceProfileJson: { preferred_daypart: "夜场" },
            scenarioProfileJson: {},
            relationshipProfileJson: {},
            opportunityProfileJson: {},
            sourceSignalIds: ["sig-1"],
            updatedAt: "2026-04-18T12:00:00.000Z",
          } as CustomerOperatingProfileDailyRecord,
        ],
      } as never,
      config,
      orgId: "1001",
      intent: intent!,
      now,
      analysis: buildGrowthAnalysis(),
    });

    expect(result).toContain("当前世界模型主要依据：环境上下文、会员/反馈样本");
    expect(result).toContain("仍待补齐：门店经营事实、外部情报、行业观察");
  });

  it("owns HQ portfolio rendering for fleet overview capability", async () => {
    const config = buildConfig();
    const now = new Date("2026-04-13T10:00:00+08:00");
    const intent = resolveHetangQueryIntent({
      config,
      text: "这周两个店整体怎么样，哪家最危险，下周总部先抓什么",
      now,
    });

    expect(intent?.kind).toBe("hq_portfolio");

    const result = await executeStoreRuntimeQuery({
      capabilityId: "hq_portfolio_overview_v1" as never,
      runtime: {
        buildReport: async ({ orgId, bizDate }: { orgId: string; bizDate?: string }) => {
          const currentPeriod = (bizDate ?? "2026-04-12") >= "2026-04-07";
          const storeName = orgId === "1001" ? "迎宾店" : "华美店";
          if (orgId === "1001") {
            return buildReport({
              orgId,
              storeName,
              bizDate: bizDate ?? "2026-04-12",
              metrics: currentPeriod
                ? {
                    serviceRevenue: 3600,
                    serviceOrderCount: 20,
                    totalClockCount: 45,
                    averageTicket: 180,
                    sleepingMemberRate: 0.12,
                    newMembers: 5,
                    currentStoredBalance: 40000,
                    storedBalanceLifeMonths: 3.5,
                    renewalPressureIndex30d: 0.9,
                    groupbuy7dRevisitRate: 0.42,
                    addClockRate: 0.3,
                  }
                : {
                    serviceRevenue: 3400,
                    serviceOrderCount: 19,
                    totalClockCount: 44,
                    averageTicket: 179,
                    sleepingMemberRate: 0.11,
                    newMembers: 4,
                    currentStoredBalance: 39000,
                    storedBalanceLifeMonths: 3.7,
                    renewalPressureIndex30d: 0.82,
                    groupbuy7dRevisitRate: 0.4,
                    addClockRate: 0.29,
                  },
            });
          }

          return buildReport({
            orgId,
            storeName,
            bizDate: bizDate ?? "2026-04-12",
            metrics: currentPeriod
              ? {
                  serviceRevenue: 2900,
                  serviceOrderCount: 18,
                  totalClockCount: 38,
                  averageTicket: 161,
                  sleepingMemberRate: 0.2,
                  newMembers: 3,
                  currentStoredBalance: 38000,
                  storedBalanceLifeMonths: 2.4,
                  renewalPressureIndex30d: 1.6,
                  groupbuy7dRevisitRate: 0.28,
                  addClockRate: 0.18,
                }
              : {
                  serviceRevenue: 3300,
                  serviceOrderCount: 19,
                  totalClockCount: 42,
                  averageTicket: 174,
                  sleepingMemberRate: 0.17,
                  newMembers: 4,
                  currentStoredBalance: 40000,
                  storedBalanceLifeMonths: 2.9,
                  renewalPressureIndex30d: 1.28,
                  groupbuy7dRevisitRate: 0.34,
                  addClockRate: 0.22,
                },
          });
        },
      },
      config,
      orgId: "1001",
      orgIds: ["1001", "1002"],
      intent: intent!,
      now,
    });

    expect(result).toContain("已授权门店 近15天 总部经营全景");
    expect(result).toContain("最危险门店");
    expect(result).toContain("华美店");
    expect(result).toContain("下周总部优先动作");
  });
});
