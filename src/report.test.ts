import { describe, expect, it } from "vitest";
import { renderStoreMiddayBrief } from "./report.js";
import type {
  DailyStoreMetrics,
  DailyStoreReport,
  StoreReview7dRow,
  StoreSummary30dRow,
} from "./types.js";

function buildMetrics(
  overrides: Partial<DailyStoreMetrics> = {},
): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "一号店",
    bizDate: "2026-03-29",
    serviceRevenue: 12_800,
    rechargeCash: 4_200,
    rechargeStoredValue: 4_800,
    rechargeBonusValue: 600,
    antiServiceRevenue: 0,
    serviceOrderCount: 86,
    customerCount: 78,
    averageTicket: 148.8,
    totalClockCount: 92,
    upClockRecordCount: 92,
    pointClockRecordCount: 39,
    pointClockRate: 0.42,
    addClockRecordCount: 25,
    addClockRate: 0.27,
    clockRevenue: 12_800,
    clockEffect: 139.1,
    activeTechCount: 7,
    onDutyTechCount: 9,
    techCommission: 3_200,
    techCommissionRate: 0.25,
    marketRevenue: 1_500,
    marketCommission: 360,
    memberPaymentAmount: 3_800,
    memberPaymentShare: 0.3,
    cashPaymentAmount: 2_000,
    cashPaymentShare: 0.16,
    wechatPaymentAmount: 4_000,
    wechatPaymentShare: 0.31,
    alipayPaymentAmount: 3_000,
    alipayPaymentShare: 0.23,
    storedConsumeAmount: 4_600,
    storedConsumeRate: 0.36,
    groupbuyOrderCount: 22,
    groupbuyOrderShare: 0.26,
    groupbuyAmount: 2_860,
    groupbuyAmountShare: 0.22,
    groupbuyPlatformBreakdown: [],
    groupbuyCohortCustomerCount: 18,
    groupbuyRevisitCustomerCount: 7,
    groupbuyRevisitRate: 7 / 18,
    groupbuyMemberPayConvertedCustomerCount: 6,
    groupbuyMemberPayConversionRate: 6 / 18,
    groupbuy7dRevisitCustomerCount: 7,
    groupbuy7dRevisitRate: 7 / 18,
    groupbuy7dCardOpenedCustomerCount: 4,
    groupbuy7dCardOpenedRate: 4 / 18,
    groupbuy7dStoredValueConvertedCustomerCount: 3,
    groupbuy7dStoredValueConversionRate: 3 / 18,
    groupbuy30dMemberPayConvertedCustomerCount: 6,
    groupbuy30dMemberPayConversionRate: 6 / 18,
    groupbuyFirstOrderCustomerCount: 10,
    groupbuyFirstOrderHighValueMemberCustomerCount: 1,
    groupbuyFirstOrderHighValueMemberRate: 0.1,
    effectiveMembers: 96,
    newMembers: 5,
    sleepingMembers: 16,
    sleepingMemberRate: 16 / 96,
    currentStoredBalance: 120_000,
    storedBalanceLifeMonths: 2.4,
    renewalPressureIndex30d: 1.63,
    memberRepurchaseBaseCustomerCount7d: 18,
    memberRepurchaseReturnedCustomerCount7d: 8,
    memberRepurchaseRate7d: 8 / 18,
    roomOccupancyRate: null,
    roomTurnoverRate: null,
    grossMarginRate: null,
    netMarginRate: null,
    breakEvenRevenue: null,
    incompleteSync: false,
    unavailableMetrics: [],
    ...overrides,
  };
}

function buildReport(overrides: Partial<DailyStoreReport> = {}): DailyStoreReport {
  return {
    orgId: "1001",
    storeName: "一号店",
    bizDate: "2026-03-29",
    metrics: buildMetrics(),
    alerts: [],
    suggestions: [],
    markdown: "",
    complete: true,
    ...overrides,
  };
}

function buildReview7d(
  overrides: Partial<StoreReview7dRow> = {},
): StoreReview7dRow {
  return {
    orgId: "1001",
    windowEndBizDate: "2026-03-29",
    storeName: "一号店",
    revenue7d: 86_000,
    orderCount7d: 510,
    customerCount7d: 510,
    totalClocks7d: 620,
    clockEffect7d: 138.7,
    averageTicket7d: 168.6,
    pointClockRate7d: 0.41,
    addClockRate7d: 0.24,
    rechargeCash7d: 12_000,
    storedConsumeAmount7d: 14_800,
    storedConsumeRate7d: 0.34,
    onDutyTechCount7d: 9,
    groupbuyOrderShare7d: 0.24,
    groupbuyCohortCustomerCount: 42,
    groupbuy7dRevisitCustomerCount: 34,
    groupbuy7dRevisitRate: 34 / 42,
    groupbuy7dCardOpenedCustomerCount: 11,
    groupbuy7dCardOpenedRate: 11 / 42,
    groupbuy7dStoredValueConvertedCustomerCount: 3,
    groupbuy7dStoredValueConversionRate: 3 / 42,
    groupbuy30dMemberPayConvertedCustomerCount: 13,
    groupbuy30dMemberPayConversionRate: 13 / 42,
    groupbuyFirstOrderCustomerCount: 23,
    groupbuyFirstOrderHighValueMemberCustomerCount: 4,
    groupbuyFirstOrderHighValueMemberRate: 4 / 23,
    effectiveMembers: 96,
    sleepingMembers: 16,
    sleepingMemberRate: 16 / 96,
    newMembers7d: 8,
    activeTechCount7d: 8,
    currentStoredBalance: 120_000,
    storedBalanceLifeMonths: 2.4,
    renewalPressureIndex30d: 1.63,
    memberRepurchaseBaseCustomerCount7d: 18,
    memberRepurchaseReturnedCustomerCount7d: 8,
    memberRepurchaseRate7d: 8 / 18,
    ...overrides,
  };
}

function buildSummary30d(
  overrides: Partial<StoreSummary30dRow> = {},
): StoreSummary30dRow {
  return {
    orgId: "1001",
    windowEndBizDate: "2026-03-29",
    storeName: "一号店",
    revenue30d: 368_000,
    orderCount30d: 2_210,
    customerCount30d: 2_210,
    totalClocks30d: 2_580,
    clockEffect30d: 142.6,
    averageTicket30d: 166.5,
    pointClockRate30d: 0.41,
    addClockRate30d: 0.24,
    rechargeCash30d: 50_000,
    storedConsumeAmount30d: 64_000,
    storedConsumeRate30d: 0.35,
    onDutyTechCount30d: 9,
    groupbuyOrderShare30d: 0.24,
    groupbuyCohortCustomerCount: 92,
    groupbuy7dRevisitCustomerCount: 76,
    groupbuy7dRevisitRate: 76 / 92,
    groupbuy7dCardOpenedCustomerCount: 21,
    groupbuy7dCardOpenedRate: 21 / 92,
    groupbuy7dStoredValueConvertedCustomerCount: 8,
    groupbuy7dStoredValueConversionRate: 8 / 92,
    groupbuy30dMemberPayConvertedCustomerCount: 29,
    groupbuy30dMemberPayConversionRate: 29 / 92,
    groupbuyFirstOrderCustomerCount: 51,
    groupbuyFirstOrderHighValueMemberCustomerCount: 10,
    groupbuyFirstOrderHighValueMemberRate: 10 / 51,
    effectiveMembers: 96,
    sleepingMembers: 16,
    sleepingMemberRate: 16 / 96,
    newMembers30d: 30,
    activeTechCount30d: 8,
    currentStoredBalance: 120_000,
    storedBalanceLifeMonths: 2.4,
    renewalPressureIndex30d: 1.63,
    memberRepurchaseBaseCustomerCount7d: 18,
    memberRepurchaseReturnedCustomerCount7d: 8,
    memberRepurchaseRate7d: 8 / 18,
    ...overrides,
  };
}

function extractActions(text: string): string[] {
  const marker = "今日先抓\n";
  const start = text.indexOf(marker);
  if (start < 0) {
    return [];
  }
  return text
    .slice(start + marker.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^\d+\./u.test(line));
}

describe("renderStoreMiddayBrief", () => {
  it("renders the redesigned manager brief without N/A placeholders", () => {
    const text = renderStoreMiddayBrief(buildReport());

    expect(text).toContain("一句话判断");
    expect(text).toContain("昨日收盘");
    expect(text).toContain("近7天变化");
    expect(text).toContain("近30天会员与储值风险");
    expect(text).toContain("今日先抓");
    expect(text).not.toContain("现金池");
    expect(text).not.toContain("N/A");
  });

  it("uses the shared store business judgment for the midday headline", () => {
    const text = renderStoreMiddayBrief(
      buildReport({
        metrics: buildMetrics({
          pointClockRate: 0.56,
          addClockRate: 0.34,
          groupbuy7dRevisitRate: 0.72,
          groupbuy7dStoredValueConversionRate: 0.23,
          groupbuyFirstOrderHighValueMemberRate: 0.28,
          sleepingMemberRate: 0.08,
          storedBalanceLifeMonths: 4.1,
          renewalPressureIndex30d: 1.04,
        }),
      }),
      {
        review7d: {
          current: buildReview7d({
            revenue7d: 126_000,
            clockEffect7d: 152.2,
            pointClockRate7d: 0.56,
            addClockRate7d: 0.34,
            groupbuy7dRevisitRate: 0.72,
            groupbuy7dStoredValueConversionRate: 0.23,
          }),
          previous: buildReview7d({
            revenue7d: 108_000,
            clockEffect7d: 141.8,
            pointClockRate7d: 0.49,
            addClockRate7d: 0.27,
            groupbuy7dRevisitRate: 0.64,
            groupbuy7dStoredValueConversionRate: 0.18,
          }),
        },
        summary30d: {
          current: buildSummary30d({
            sleepingMemberRate: 0.08,
            groupbuyFirstOrderHighValueMemberRate: 0.28,
            pointClockRate30d: 0.56,
            addClockRate30d: 0.34,
          }),
          previous: buildSummary30d({
            sleepingMemberRate: 0.11,
            groupbuyFirstOrderHighValueMemberRate: 0.22,
            pointClockRate30d: 0.48,
            addClockRate30d: 0.28,
          }),
        },
      },
    );

    expect(text).toContain("一句话判断\n- 增长健康，高价值沉淀好");
    expect(text).not.toContain("一句话判断\n- 盘子稳");
  });

  it("hides the 30-day member and stored-value block when reliable signals are unavailable", () => {
    const text = renderStoreMiddayBrief(
      buildReport({
        metrics: buildMetrics({
          storedBalanceLifeMonths: undefined,
          renewalPressureIndex30d: undefined,
          memberRepurchaseBaseCustomerCount7d: undefined,
          memberRepurchaseReturnedCustomerCount7d: undefined,
          memberRepurchaseRate7d: undefined,
        }),
      }),
    );

    expect(text).not.toContain("现金池");
    expect(text).not.toContain("N/A");
    expect(text).not.toContain("近30天会员与储值风险");
  });

  it("does not let suspicious zeroed member signals dominate midday actions", () => {
    const text = renderStoreMiddayBrief(
      buildReport({
        metrics: buildMetrics({
          pointClockRate: 0.125,
          addClockRate: 0.135,
          renewalPressureIndex30d: 1.45,
          memberRepurchaseBaseCustomerCount7d: 0,
          memberRepurchaseReturnedCustomerCount7d: 0,
          memberRepurchaseRate7d: 0,
          sleepingMembers: 0,
          sleepingMemberRate: 0,
        }),
      }),
      {
        review7d: {
          current: buildReview7d({
            revenue7d: 190_100,
            groupbuy7dRevisitRate: 0.909,
            groupbuy7dStoredValueConversionRate: 0,
          }),
          previous: buildReview7d({
            revenue7d: 189_300,
            groupbuy7dRevisitRate: 0.909,
            groupbuy7dStoredValueConversionRate: 0,
          }),
        },
        summary30d: {
          current: buildSummary30d({
            renewalPressureIndex30d: 1.45,
            memberRepurchaseBaseCustomerCount7d: 0,
            memberRepurchaseReturnedCustomerCount7d: 0,
            memberRepurchaseRate7d: 0,
            sleepingMembers: 0,
            sleepingMemberRate: 0,
          }),
          previous: buildSummary30d({
            renewalPressureIndex30d: 1.36,
            memberRepurchaseBaseCustomerCount7d: 0,
            memberRepurchaseReturnedCustomerCount7d: 0,
            memberRepurchaseRate7d: 0,
            sleepingMembers: 0,
            sleepingMemberRate: 0,
          }),
        },
      },
    );

    const actions = extractActions(text);
    expect(actions[0]).toContain("点钟率只有 12.5%");
    expect(actions.join("\n")).toContain("续费压力 1.45");
    expect(actions.join("\n")).not.toContain("高储值但近7天没回流的老会员");
  });

  it("tailors midday actions to each store's dominant operating problem", () => {
    const revenueDropBrief = renderStoreMiddayBrief(
      buildReport({
        metrics: buildMetrics({
          pointClockRate: 0.253,
          addClockRate: 0.139,
          renewalPressureIndex30d: 1.36,
        }),
      }),
      {
        review7d: {
          current: buildReview7d({
            revenue7d: 128_600,
            groupbuy7dRevisitRate: 0.9,
            groupbuy7dStoredValueConversionRate: 0,
            addClockRate7d: 0.115,
          }),
          previous: buildReview7d({
            revenue7d: 152_400,
            groupbuy7dRevisitRate: 0.889,
            groupbuy7dStoredValueConversionRate: 0,
            addClockRate7d: 0.117,
          }),
        },
        summary30d: {
          current: buildSummary30d({
            renewalPressureIndex30d: 1.36,
            memberRepurchaseBaseCustomerCount7d: 0,
            memberRepurchaseReturnedCustomerCount7d: 0,
            memberRepurchaseRate7d: 0,
            sleepingMembers: 0,
            sleepingMemberRate: 0,
          }),
          previous: buildSummary30d({
            renewalPressureIndex30d: 1.3,
            memberRepurchaseBaseCustomerCount7d: 0,
            memberRepurchaseReturnedCustomerCount7d: 0,
            memberRepurchaseRate7d: 0,
            sleepingMembers: 0,
            sleepingMemberRate: 0,
          }),
        },
      },
    );
    const addClockBrief = renderStoreMiddayBrief(
      buildReport({
        metrics: buildMetrics({
          pointClockRate: 0.13,
          addClockRate: 0.037,
          renewalPressureIndex30d: 1.06,
        }),
      }),
      {
        review7d: {
          current: buildReview7d({
            revenue7d: 89_700,
            groupbuy7dRevisitRate: 1,
            groupbuy7dStoredValueConversionRate: 0,
            addClockRate7d: 0.138,
          }),
          previous: buildReview7d({
            revenue7d: 84_700,
            groupbuy7dRevisitRate: 1,
            groupbuy7dStoredValueConversionRate: 0,
            addClockRate7d: 0.118,
          }),
        },
        summary30d: {
          current: buildSummary30d({
            renewalPressureIndex30d: 1.06,
            memberRepurchaseBaseCustomerCount7d: 0,
            memberRepurchaseReturnedCustomerCount7d: 0,
            memberRepurchaseRate7d: 0,
            sleepingMembers: 0,
            sleepingMemberRate: 0,
          }),
          previous: buildSummary30d({
            renewalPressureIndex30d: 1.01,
            memberRepurchaseBaseCustomerCount7d: 0,
            memberRepurchaseReturnedCustomerCount7d: 0,
            memberRepurchaseRate7d: 0,
            sleepingMembers: 0,
            sleepingMemberRate: 0,
          }),
        },
      },
    );

    const revenueActions = extractActions(revenueDropBrief);
    const addClockActions = extractActions(addClockBrief);

    expect(revenueActions[0]).toContain("营收较前7天 -15.6%");
    expect(addClockActions[0]).toContain("加钟率只有 3.7%");
    expect(revenueActions.join("\n")).not.toEqual(addClockActions.join("\n"));
  });

  it("turns midday actions into owner-based operating moves instead of generic slogans", () => {
    const text = renderStoreMiddayBrief(
      buildReport({
        metrics: buildMetrics({
          pointClockRate: 0.22,
          addClockRate: 0.11,
          renewalPressureIndex30d: 1.34,
          sleepingMemberRate: 0.18,
          memberRepurchaseBaseCustomerCount7d: 24,
          memberRepurchaseReturnedCustomerCount7d: 9,
          memberRepurchaseRate7d: 9 / 24,
        }),
      }),
      {
        review7d: {
          current: buildReview7d({
            revenue7d: 136_000,
            groupbuy7dRevisitRate: 0.38,
            groupbuy7dStoredValueConversionRate: 0.12,
            addClockRate7d: 0.11,
          }),
          previous: buildReview7d({
            revenue7d: 148_000,
            groupbuy7dRevisitRate: 0.49,
            groupbuy7dStoredValueConversionRate: 0.18,
            addClockRate7d: 0.16,
          }),
        },
        summary30d: {
          current: buildSummary30d({
            renewalPressureIndex30d: 1.34,
            sleepingMemberRate: 0.18,
            memberRepurchaseBaseCustomerCount7d: 24,
            memberRepurchaseReturnedCustomerCount7d: 9,
            memberRepurchaseRate7d: 9 / 24,
          }),
          previous: buildSummary30d({
            renewalPressureIndex30d: 1.22,
            sleepingMemberRate: 0.14,
            memberRepurchaseBaseCustomerCount7d: 22,
            memberRepurchaseReturnedCustomerCount7d: 11,
            memberRepurchaseRate7d: 11 / 22,
          }),
        },
      },
    );

    const actions = extractActions(text).join("\n");
    expect(actions).toContain("店长");
    expect(actions).toContain("客服");
    expect(actions).toContain("前台");
  });
});
