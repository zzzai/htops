import { describe, expect, it } from "vitest";

import { renderFiveStoreMonthlyTrendReport } from "./monthly-report.js";
import type { DailyStoreMetrics, DailyStoreReport } from "./types.js";

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "迎宾店",
    bizDate: "2026-03-31",
    serviceRevenue: 10000,
    rechargeCash: 3000,
    rechargeStoredValue: 0,
    rechargeBonusValue: 0,
    antiServiceRevenue: 0,
    serviceOrderCount: 80,
    customerCount: 70,
    averageTicket: 142.86,
    totalClockCount: 100,
    upClockRecordCount: 100,
    pointClockRecordCount: 24,
    pointClockRate: 0.24,
    addClockRecordCount: 22,
    addClockRate: 0.22,
    clockRevenue: 10000,
    clockEffect: 100,
    activeTechCount: 12,
    onDutyTechCount: 14,
    techCommission: 0,
    techCommissionRate: 0,
    marketRevenue: 0,
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
    groupbuy7dRevisitCustomerCount: 0,
    groupbuy7dRevisitRate: null,
    groupbuy7dCardOpenedCustomerCount: 0,
    groupbuy7dCardOpenedRate: null,
    groupbuy7dStoredValueConvertedCustomerCount: 0,
    groupbuy7dStoredValueConversionRate: null,
    groupbuy30dMemberPayConvertedCustomerCount: 0,
    groupbuy30dMemberPayConversionRate: null,
    groupbuyFirstOrderCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberRate: null,
    effectiveMembers: 0,
    newMembers: 8,
    sleepingMembers: 0,
    sleepingMemberRate: null,
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
    grossMarginRate: null,
    netMarginRate: null,
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
  pointClockRate: number;
  addClockRate: number;
  newMembers: number;
  rechargeCash: number;
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
      serviceRevenue: params.revenue,
      customerCount: params.customers,
      serviceOrderCount: Math.round(params.customers * 1.1),
      averageTicket: params.customers > 0 ? params.revenue / params.customers : 0,
      totalClockCount: params.revenue / 100,
      clockEffect: 100,
      pointClockRate: params.pointClockRate,
      pointClockRecordCount: Math.round(params.pointClockRate * 100),
      addClockRate: params.addClockRate,
      addClockRecordCount: Math.round(params.addClockRate * 100),
      newMembers: params.newMembers,
      rechargeCash: params.rechargeCash,
    }),
    alerts: [],
    suggestions: [],
    markdown: "",
    complete: params.complete ?? true,
  };
}

describe("renderFiveStoreMonthlyTrendReport", () => {
  it("renders an HQ-facing monthly summary with named lift and pressure stores when the baseline is valid", () => {
    const text = renderFiveStoreMonthlyTrendReport({
      month: "2026-03",
      stores: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          currentReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-03-30",
              revenue: 12000,
              customers: 80,
              pointClockRate: 0.26,
              addClockRate: 0.24,
              newMembers: 12,
              rechargeCash: 6000,
            }),
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-03-31",
              revenue: 13000,
              customers: 82,
              pointClockRate: 0.27,
              addClockRate: 0.25,
              newMembers: 13,
              rechargeCash: 6200,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-02-27",
              revenue: 9000,
              customers: 70,
              pointClockRate: 0.21,
              addClockRate: 0.19,
              newMembers: 8,
              rechargeCash: 4200,
            }),
          ],
        },
        {
          orgId: "1002",
          storeName: "义乌店",
          currentReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "义乌店",
              bizDate: "2026-03-30",
              revenue: 8000,
              customers: 78,
              pointClockRate: 0.18,
              addClockRate: 0.15,
              newMembers: 5,
              rechargeCash: 1800,
              complete: false,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "义乌店",
              bizDate: "2026-02-27",
              revenue: 11000,
              customers: 80,
              pointClockRate: 0.25,
              addClockRate: 0.23,
              newMembers: 9,
              rechargeCash: 4600,
            }),
          ],
        },
      ],
    });

    expect(text).toContain("# 荷塘悦色 2026年3月 月度经营趋势总结");
    expect(text).toContain("## 一、总部结论");
    expect(text).toContain("本月五店总营收");
    expect(text).toContain("拉升店：迎宾店");
    expect(text).toContain("承压店：义乌店");
    expect(text).toContain("义乌店：营收");
    expect(text).toContain("下月总部只盯三件事");
    expect(text).not.toContain("五店共性承接");
    expect(text).toContain("数据完整度：迎宾店 2/2 天；义乌店 0/1 天");
  });

  it("explicitly calls out an unusable previous-month baseline instead of faking a rebound story", () => {
    const text = renderFiveStoreMonthlyTrendReport({
      month: "2026-03",
      stores: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          currentReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-03-31",
              revenue: 13000,
              customers: 82,
              pointClockRate: 0.27,
              addClockRate: 0.25,
              newMembers: 13,
              rechargeCash: 6200,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-02-28",
              revenue: 0,
              customers: 0,
              pointClockRate: 0,
              addClockRate: 0,
              newMembers: 0,
              rechargeCash: 0,
            }),
          ],
        },
        {
          orgId: "1002",
          storeName: "义乌店",
          currentReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "义乌店",
              bizDate: "2026-03-31",
              revenue: 8000,
              customers: 78,
              pointClockRate: 0.18,
              addClockRate: 0.15,
              newMembers: 5,
              rechargeCash: 1800,
            }),
          ],
          previousReports: [
            buildDailyReport({
              orgId: "1002",
              storeName: "义乌店",
              bizDate: "2026-02-28",
              revenue: 0,
              customers: 0,
              pointClockRate: 0,
              addClockRate: 0,
              newMembers: 0,
              rechargeCash: 0,
            }),
          ],
        },
      ],
    });

    expect(text).toContain("上月基线不足");
    expect(text).toContain("本月先看规模和店间分化");
    expect(text).toContain("主力店：迎宾店");
    expect(text).toContain("承压店：义乌店");
    expect(text).not.toContain("整体回升");
  });
});
