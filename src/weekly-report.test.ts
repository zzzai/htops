import { describe, expect, it } from "vitest";

import { renderFiveStoreWeeklyReport } from "./weekly-report.js";
import type { DailyStoreMetrics, DailyStoreReport } from "./types.js";
import type { OperatingWorldIndustryObservation } from "./world-model/types.js";

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "迎宾店",
    bizDate: "2026-04-19",
    serviceRevenue: 10000,
    rechargeCash: 0,
    rechargeStoredValue: 0,
    rechargeBonusValue: 0,
    antiServiceRevenue: 0,
    serviceOrderCount: 80,
    customerCount: 70,
    averageTicket: 125,
    totalClockCount: 110,
    upClockRecordCount: 100,
    pointClockRecordCount: 20,
    pointClockRate: 0.2,
    addClockRecordCount: 22,
    addClockRate: 0.22,
    clockRevenue: 10000,
    clockEffect: 90.9,
    activeTechCount: 12,
    onDutyTechCount: 14,
    techCommission: 0,
    techCommissionRate: 0,
    marketRevenue: 800,
    marketCommission: 0,
    memberPaymentAmount: 0,
    memberPaymentShare: null,
    cashPaymentAmount: 0,
    cashPaymentShare: null,
    wechatPaymentAmount: 0,
    wechatPaymentShare: null,
    alipayPaymentAmount: 0,
    alipayPaymentShare: null,
    storedConsumeAmount: 0,
    storedConsumeRate: null,
    groupbuyOrderCount: 0,
    groupbuyOrderShare: null,
    groupbuyAmount: 0,
    groupbuyAmountShare: null,
    groupbuyPlatformBreakdown: [],
    groupbuyCohortCustomerCount: 0,
    groupbuyRevisitCustomerCount: 0,
    groupbuyRevisitRate: null,
    groupbuyMemberPayConvertedCustomerCount: 0,
    groupbuyMemberPayConversionRate: null,
    groupbuy7dRevisitCustomerCount: 20,
    groupbuy7dRevisitRate: 0.36,
    groupbuy7dCardOpenedCustomerCount: 0,
    groupbuy7dCardOpenedRate: null,
    groupbuy7dStoredValueConvertedCustomerCount: 0,
    groupbuy7dStoredValueConversionRate: 0.09,
    groupbuy30dMemberPayConvertedCustomerCount: 0,
    groupbuy30dMemberPayConversionRate: null,
    groupbuyFirstOrderCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberRate: null,
    effectiveMembers: 180,
    newMembers: 8,
    sleepingMembers: 20,
    sleepingMemberRate: 0.11,
    currentStoredBalance: 0,
    highBalanceSleepingMemberCount: 0,
    highBalanceSleepingMemberAmount: 0,
    firstChargeUnconsumedMemberCount: 0,
    firstChargeUnconsumedMemberAmount: 0,
    storedBalanceLifeMonths: null,
    renewalPressureIndex30d: null,
    memberRepurchaseBaseCustomerCount7d: 0,
    memberRepurchaseReturnedCustomerCount7d: 0,
    memberRepurchaseRate7d: null,
    roomOccupancyRate: null,
    roomTurnoverRate: null,
    grossMarginRate: 0.46,
    netMarginRate: 0.18,
    breakEvenRevenue: null,
    incompleteSync: false,
    staleSyncEndpoints: [],
    unavailableMetrics: [],
    ...overrides,
  };
}

function buildDailyReport(params: {
  orgId: string;
  storeName: string;
  bizDate: string;
  revenue: number;
  customers: number;
  addClockRate: number;
  pointClockRate: number;
  newMembers?: number;
  rechargeCash?: number;
  groupbuy7dRevisitRate: number;
  sleepingMemberRate: number;
  netMarginRate?: number;
}): DailyStoreReport {
  return {
    orgId: params.orgId,
    storeName: params.storeName,
    bizDate: params.bizDate,
    metrics: buildMetrics({
      orgId: params.orgId,
      storeName: params.storeName,
      bizDate: params.bizDate,
      serviceRevenue: params.revenue,
      customerCount: params.customers,
      addClockRate: params.addClockRate,
      addClockRecordCount: Math.round(params.addClockRate * 100),
      pointClockRate: params.pointClockRate,
      pointClockRecordCount: Math.round(params.pointClockRate * 100),
      newMembers: params.newMembers ?? 8,
      rechargeCash: params.rechargeCash ?? 0,
      groupbuy7dRevisitRate: params.groupbuy7dRevisitRate,
      sleepingMemberRate: params.sleepingMemberRate,
      netMarginRate: params.netMarginRate ?? 0.18,
    }),
    alerts: [],
    suggestions: [],
    markdown: "",
    complete: true,
  };
}

describe("renderFiveStoreWeeklyReport", () => {
  it("renders a mobile-friendly weekly action report with differentiated store cards", () => {
    const text = renderFiveStoreWeeklyReport({
      weekEndBizDate: "2026-04-19",
      stores: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          currentReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-04-19",
              revenue: 12000,
              customers: 82,
              addClockRate: 0.26,
              pointClockRate: 0.24,
              newMembers: 12,
              rechargeCash: 8800,
              groupbuy7dRevisitRate: 0.38,
              sleepingMemberRate: 0.1,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-04-12",
              revenue: 10000,
              customers: 74,
              addClockRate: 0.2,
              pointClockRate: 0.19,
              newMembers: 8,
              rechargeCash: 5200,
              groupbuy7dRevisitRate: 0.34,
              sleepingMemberRate: 0.11,
            }),
          ],
        },
        {
          orgId: "1002",
          storeName: "滨江店",
          currentReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "滨江店",
              bizDate: "2026-04-19",
              revenue: 8800,
              customers: 76,
              addClockRate: 0.15,
              pointClockRate: 0.12,
              newMembers: 6,
              rechargeCash: 2600,
              groupbuy7dRevisitRate: 0.28,
              sleepingMemberRate: 0.18,
              netMarginRate: 0.11,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "滨江店",
              bizDate: "2026-04-12",
              revenue: 9600,
              customers: 78,
              addClockRate: 0.2,
              pointClockRate: 0.16,
              newMembers: 7,
              rechargeCash: 3000,
              groupbuy7dRevisitRate: 0.31,
              sleepingMemberRate: 0.15,
              netMarginRate: 0.14,
            }),
          ],
        },
        {
          orgId: "1003",
          storeName: "城西店",
          currentReports: [
            buildDailyReport({
              orgId: "1003",
              storeName: "城西店",
              bizDate: "2026-04-19",
              revenue: 9100,
              customers: 90,
              addClockRate: 0.2,
              pointClockRate: 0.22,
              newMembers: 10,
              rechargeCash: 5400,
              groupbuy7dRevisitRate: 0.33,
              sleepingMemberRate: 0.12,
              netMarginRate: 0.23,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1003",
              storeName: "城西店",
              bizDate: "2026-04-12",
              revenue: 8600,
              customers: 79,
              addClockRate: 0.18,
              pointClockRate: 0.18,
              newMembers: 8,
              rechargeCash: 3600,
              groupbuy7dRevisitRate: 0.29,
              sleepingMemberRate: 0.14,
              netMarginRate: 0.17,
            }),
          ],
        },
      ],
    });

    expect(text).toContain("荷塘悦色5店经营周报");
    expect(text).toContain("## 一、经营总览");
    expect(text).toContain("## 二、下周动作");
    expect(text).toContain("## 三、门店动作");
    expect(text).toContain("客流");
    expect(text).toContain("加钟率");
    expect(text).toContain("点钟率");
    expect(text).toContain("新增会员");
    expect(text).toContain("本周新增储值");
    expect(text).not.toContain("团购7天复到店");
    expect(text).not.toContain("门店分层判断");
    expect(text).not.toContain("营收排名");
    expect(text).not.toContain("总部支持事项");
    expect(text).not.toContain("逐店作战卡");
    expect(text).toContain("### 迎宾");
    expect(text).toContain("### 滨江");
    expect(text).toContain("### 城西");
    expect(text).toContain("- 角色：");
    expect(text).toContain("- 贡献：");
    expect(text).toContain("- 问题：");
    expect(text).toContain("- 动作：");

    const roleLines = text.split("\n").filter((line) => line.startsWith("- 角色："));
    const actionLines = text.split("\n").filter((line) => line.startsWith("- 动作："));
    expect(new Set(roleLines).size).toBe(roleLines.length);
    expect(new Set(actionLines).size).toBe(actionLines.length);
  });

  it("adds a cautious world-model note when customer traffic stays stable but recharge weakens", () => {
    const text = renderFiveStoreWeeklyReport({
      weekEndBizDate: "2026-04-19",
      stores: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          currentReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-04-19",
              revenue: 12000,
              customers: 82,
              addClockRate: 0.22,
              pointClockRate: 0.24,
              newMembers: 12,
              rechargeCash: 1800,
              groupbuy7dRevisitRate: 0.38,
              sleepingMemberRate: 0.1,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-04-12",
              revenue: 11800,
              customers: 81,
              addClockRate: 0.22,
              pointClockRate: 0.23,
              newMembers: 11,
              rechargeCash: 6200,
              groupbuy7dRevisitRate: 0.35,
              sleepingMemberRate: 0.11,
            }),
          ],
        },
        {
          orgId: "1002",
          storeName: "华美店",
          currentReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "华美店",
              bizDate: "2026-04-19",
              revenue: 9800,
              customers: 79,
              addClockRate: 0.18,
              pointClockRate: 0.17,
              newMembers: 8,
              rechargeCash: 1200,
              groupbuy7dRevisitRate: 0.31,
              sleepingMemberRate: 0.17,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "华美店",
              bizDate: "2026-04-12",
              revenue: 9700,
              customers: 77,
              addClockRate: 0.18,
              pointClockRate: 0.17,
              newMembers: 8,
              rechargeCash: 5800,
              groupbuy7dRevisitRate: 0.29,
              sleepingMemberRate: 0.18,
            }),
          ],
        },
      ],
    });

    expect(text).toContain("世界模型补充");
    expect(text).toContain("客流未必先掉");
    expect(text).toContain("后续会继续补数完善");
  });

  it("absorbs industry observations into the weekly world-model supplement without changing the fact layer", () => {
    const industryObservations: OperatingWorldIndustryObservation[] = [
      {
        key: "platform_rule:meituan_price_mindshare",
        summary: "平台价格心智抬升：低价敏感客决策更快，门店更需要差异化承接。",
        sourceCategory: "industry_signal",
        truthBoundary: "weak_signal",
        updatedAt: "2026-04-24T09:00:00.000Z",
      },
    ];

    const text = renderFiveStoreWeeklyReport({
      weekEndBizDate: "2026-04-19",
      stores: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          currentReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-04-19",
              revenue: 12000,
              customers: 82,
              addClockRate: 0.22,
              pointClockRate: 0.24,
              newMembers: 12,
              rechargeCash: 1800,
              groupbuy7dRevisitRate: 0.38,
              sleepingMemberRate: 0.1,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-04-12",
              revenue: 11800,
              customers: 81,
              addClockRate: 0.22,
              pointClockRate: 0.23,
              newMembers: 11,
              rechargeCash: 6200,
              groupbuy7dRevisitRate: 0.35,
              sleepingMemberRate: 0.11,
            }),
          ],
        },
        {
          orgId: "1002",
          storeName: "华美店",
          currentReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "华美店",
              bizDate: "2026-04-19",
              revenue: 9800,
              customers: 79,
              addClockRate: 0.18,
              pointClockRate: 0.17,
              newMembers: 8,
              rechargeCash: 1200,
              groupbuy7dRevisitRate: 0.31,
              sleepingMemberRate: 0.17,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "华美店",
              bizDate: "2026-04-12",
              revenue: 9700,
              customers: 77,
              addClockRate: 0.18,
              pointClockRate: 0.17,
              newMembers: 8,
              rechargeCash: 5800,
              groupbuy7dRevisitRate: 0.29,
              sleepingMemberRate: 0.18,
            }),
          ],
        },
      ],
      industryObservations,
    });

    expect(text).toContain("世界模型补充");
    expect(text).toContain("平台价格心智抬升");
    expect(text).toContain("经营总览");
  });
});
