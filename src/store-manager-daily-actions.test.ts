import { describe, expect, it } from "vitest";
import { renderStoreManagerDailyReport } from "./store-manager-daily-detail.js";
import type { DailyStoreMetrics } from "./types.js";

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "一号店",
    bizDate: "2026-04-11",
    serviceRevenue: 20000,
    rechargeCash: 8000,
    rechargeStoredValue: 8000,
    rechargeBonusValue: 0,
    antiServiceRevenue: 0,
    serviceOrderCount: 60,
    customerCount: 60,
    averageTicket: 333.33,
    totalClockCount: 100,
    upClockRecordCount: 100,
    pointClockRecordCount: 20,
    pointClockRate: 0.2,
    addClockRecordCount: 8,
    addClockRate: 0.08,
    clockRevenue: 24000,
    clockEffect: 200,
    activeTechCount: 20,
    onDutyTechCount: 30,
    techCommission: 6000,
    techCommissionRate: 0.25,
    marketRevenue: 3000,
    marketCommission: 300,
    memberPaymentAmount: 12000,
    memberPaymentShare: 0.6,
    cashPaymentAmount: 1000,
    cashPaymentShare: 0.05,
    wechatPaymentAmount: 3000,
    wechatPaymentShare: 0.15,
    alipayPaymentAmount: 1000,
    alipayPaymentShare: 0.05,
    storedConsumeAmount: 12000,
    storedConsumeRate: 1.5,
    groupbuyOrderCount: 6,
    groupbuyOrderShare: 0.1,
    groupbuyAmount: 1800,
    groupbuyAmountShare: 0.09,
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
    effectiveMembers: 100,
    newMembers: 2,
    sleepingMembers: 10,
    sleepingMemberRate: 0.1,
    currentStoredBalance: 80000,
    roomOccupancyRate: null,
    roomTurnoverRate: null,
    grossMarginRate: null,
    netMarginRate: null,
    breakEvenRevenue: null,
    incompleteSync: false,
    unavailableMetrics: [],
    memberRepurchaseBaseCustomerCount7d: 10,
    memberRepurchaseReturnedCustomerCount7d: 3,
    memberRepurchaseRate7d: 0.3,
    ...overrides,
  };
}

function buildDetail() {
  return {
    attendance: {
      strength: 10,
      star: 5,
      spa: 0,
      ear: 0,
      small: 0,
      total: 15,
    },
    strengthMain: { queue: 10, selected: 2, point: 4, add: 1, subtotal: 17 },
    starMain: { queue: 4, selected: 0, point: 3, add: 1, subtotal: 8 },
    strengthSpa: { queue: 2, selected: 0, point: 1, add: 0, subtotal: 3 },
    starSpa: { queue: 1, selected: 0, point: 0, add: 0, subtotal: 1 },
    earClockCount: 2,
    smallClockCount: 1,
    mainClockCount: 25,
    totalRevenue: 22000,
    actualRevenue: 20000,
    cashPerformance: 13800,
  };
}

describe("renderStoreManagerDailyReport dynamic actions", () => {
  it("prioritizes high-balance sleeping member recovery when member risk is the core issue", () => {
    const text = renderStoreManagerDailyReport({
      storeName: "荷塘悦色测试店",
      bizDate: "2026-04-11",
      metrics: buildMetrics({
        groupbuyOrderCount: 0,
        groupbuyOrderShare: 0,
        groupbuyAmount: 0,
        groupbuyAmountShare: 0,
        pointClockRate: 0.48,
        addClockRate: 0.12,
        activeTechCount: 18,
        onDutyTechCount: 22,
        sleepingMembers: 58,
        sleepingMemberRate: 0.29,
        currentStoredBalance: 268000,
        memberRepurchaseBaseCustomerCount7d: 26,
        memberRepurchaseReturnedCustomerCount7d: 5,
        memberRepurchaseRate7d: 5 / 26,
        newMembers: 0,
      }),
      detail: buildDetail(),
      alerts: [],
      suggestions: [],
    });

    expect(text).toContain("1. 会员回流");
    expect(text).toContain("对象：高余额沉默会员");
    expect(text).toContain("动作：");
    expect(text).toContain("目标：");
    expect(text).not.toContain("1. 把近3天团购客做回访分层");
  });

  it("prioritizes staffing calibration when on-duty and active technician gap is abnormally large", () => {
    const text = renderStoreManagerDailyReport({
      storeName: "荷塘悦色测试店",
      bizDate: "2026-04-11",
      metrics: buildMetrics({
        groupbuyOrderCount: 10,
        groupbuyOrderShare: 0.24,
        groupbuyAmount: 3200,
        groupbuyAmountShare: 0.16,
        activeTechCount: 32,
        onDutyTechCount: 90,
        pointClockRate: 0.26,
        addClockRate: 0.03,
        sleepingMembers: 0,
        sleepingMemberRate: 0,
        memberRepurchaseBaseCustomerCount7d: 0,
        memberRepurchaseReturnedCustomerCount7d: 0,
        memberRepurchaseRate7d: null,
      }),
      detail: buildDetail(),
      alerts: [],
      suggestions: [],
    });

    expect(text).toContain("1. 排班校准");
    expect(text).toContain("对象：在岗与活跃技师名单");
    expect(text).toContain("2. 加钟收口");
    expect(text).not.toContain("1. 把会员按“近7天来过未再到店”");
  });

  it("renders other payment methods so actual revenue split is not hidden", () => {
    const text = renderStoreManagerDailyReport({
      storeName: "荷塘悦色义乌店",
      bizDate: "2026-04-25",
      metrics: buildMetrics({
        serviceRevenue: 24300,
        rechargeCash: 16000,
        storedConsumeAmount: 14383,
        memberPaymentAmount: 14383,
        cashPaymentAmount: 0,
        wechatPaymentAmount: 3238,
        alipayPaymentAmount: 0,
        groupbuyAmount: 6450,
        groupbuyPlatformBreakdown: [
          { platform: "美团", orderCount: 13, orderShare: 0.21, amount: 3868, amountShare: 0.1592 },
          { platform: "抖音", orderCount: 9, orderShare: 0.15, amount: 2582, amountShare: 0.1063 },
        ],
      }),
      detail: {
        ...buildDetail(),
        totalRevenue: 27000,
        actualRevenue: 24300,
        cashPerformance: 25688,
        otherPaymentBreakdown: [{ name: "全免券", amount: 229 }],
      },
      alerts: [],
      suggestions: [],
    });

    expect(text).toContain("其他支付：全免券229元");
    expect(text).toContain("营收：总27000元 / 实收24300元");
    expect(text).toContain("现金业绩：25688元");
  });

  it("clarifies that main clock count excludes spa ear and small-item clocks", () => {
    const text = renderStoreManagerDailyReport({
      storeName: "荷塘悦色义乌店",
      bizDate: "2026-04-25",
      metrics: buildMetrics(),
      detail: buildDetail(),
      alerts: [],
      suggestions: [],
    });

    expect(text).toContain("主项总钟数：25个");
    expect(text).toContain("口径：主项总钟数只含足道主项，不含SPA/采耳/小项");
  });
});
