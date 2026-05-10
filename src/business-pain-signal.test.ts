import { describe, expect, it } from "vitest";
import {
  BUSINESS_PAIN_SIGNAL_CONTRACTS,
  evaluateBusinessPainSignals,
  renderBusinessPainSignalSuggestion,
} from "./business-pain-signal.js";
import type { DailyStoreMetrics } from "./types.js";

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "义乌店",
    bizDate: "2026-05-06",
    serviceRevenue: 20_000,
    rechargeCash: 12_000,
    rechargeStoredValue: 13_500,
    rechargeBonusValue: 1_500,
    antiServiceRevenue: 0,
    serviceOrderCount: 100,
    customerCount: 92,
    averageTicket: 217.39,
    totalClockCount: 110,
    upClockRecordCount: 110,
    pointClockRecordCount: 55,
    pointClockRate: 0.5,
    addClockRecordCount: 32,
    addClockRate: 0.29,
    clockRevenue: 18_000,
    clockEffect: 163.64,
    activeTechCount: 10,
    onDutyTechCount: 9,
    techCommission: 4_600,
    techCommissionRate: 0.23,
    marketRevenue: 1_800,
    marketCommission: 360,
    memberPaymentAmount: 8_000,
    memberPaymentShare: 0.4,
    cashPaymentAmount: 2_000,
    cashPaymentShare: 0.1,
    wechatPaymentAmount: 5_000,
    wechatPaymentShare: 0.25,
    alipayPaymentAmount: 2_000,
    alipayPaymentShare: 0.1,
    storedConsumeAmount: 8_000,
    storedConsumeRate: 0.67,
    groupbuyOrderCount: 20,
    groupbuyOrderShare: 0.2,
    groupbuyAmount: 3_500,
    groupbuyAmountShare: 0.18,
    groupbuyPlatformBreakdown: [],
    groupbuyCohortCustomerCount: 18,
    groupbuyRevisitCustomerCount: 12,
    groupbuyRevisitRate: 12 / 18,
    groupbuyMemberPayConvertedCustomerCount: 7,
    groupbuyMemberPayConversionRate: 7 / 18,
    groupbuy7dRevisitCustomerCount: 12,
    groupbuy7dRevisitRate: 12 / 18,
    groupbuy7dCardOpenedCustomerCount: 5,
    groupbuy7dCardOpenedRate: 5 / 18,
    groupbuy7dStoredValueConvertedCustomerCount: 4,
    groupbuy7dStoredValueConversionRate: 4 / 18,
    groupbuy30dMemberPayConvertedCustomerCount: 7,
    groupbuy30dMemberPayConversionRate: 7 / 18,
    groupbuyFirstOrderCustomerCount: 10,
    groupbuyFirstOrderHighValueMemberCustomerCount: 2,
    groupbuyFirstOrderHighValueMemberRate: 0.2,
    effectiveMembers: 300,
    newMembers: 12,
    sleepingMembers: 26,
    sleepingMemberRate: 26 / 300,
    currentStoredBalance: 240_000,
    highBalanceSleepingMemberCount: 0,
    highBalanceSleepingMemberAmount: 0,
    firstChargeUnconsumedMemberCount: 0,
    firstChargeUnconsumedMemberAmount: 0,
    storedBalanceLifeMonths: 4.5,
    renewalPressureIndex30d: 1.0,
    memberRepurchaseBaseCustomerCount7d: 40,
    memberRepurchaseReturnedCustomerCount7d: 22,
    memberRepurchaseRate7d: 22 / 40,
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

describe("business pain signal contracts", () => {
  it("declares the approved 12 pain signal ids", () => {
    expect(BUSINESS_PAIN_SIGNAL_CONTRACTS.map((entry) => entry.id)).toEqual([
      "pain:revenue_drop",
      "pain:traffic_drop",
      "pain:recharge_weakening",
      "pain:stored_value_pressure",
      "pain:new_customer_waste",
      "pain:tech_dependency",
      "pain:tech_productivity_anomaly",
      "pain:point_clock_drop",
      "pain:attendance_anomaly",
      "pain:anti_settle_anomaly",
      "pain:discount_anomaly",
      "pain:data_risk",
    ]);
  });
});

describe("evaluateBusinessPainSignals", () => {
  it("detects revenue drop when traffic is stable", () => {
    const signals = evaluateBusinessPainSignals({
      current: buildMetrics({ serviceRevenue: 15_000, customerCount: 91, averageTicket: 164.84 }),
      baseline: buildMetrics({ serviceRevenue: 20_000, customerCount: 92, averageTicket: 217.39 }),
    });

    expect(signals[0]).toMatchObject({
      id: "pain:revenue_drop",
      category: "营收下滑",
      businessMeaning: expect.stringContaining("客单价"),
    });
  });

  it("detects traffic drop when staffing is stable", () => {
    const signals = evaluateBusinessPainSignals({
      current: buildMetrics({ customerCount: 68, serviceRevenue: 18_500, onDutyTechCount: 9 }),
      baseline: buildMetrics({ customerCount: 92, serviceRevenue: 20_000, onDutyTechCount: 9 }),
    });

    expect(signals.map((signal) => signal.id)).toContain("pain:traffic_drop");
    expect(signals.find((signal) => signal.id === "pain:traffic_drop")?.businessMeaning).toContain(
      "获客",
    );
  });

  it("detects recharge weakening when consumption remains stable", () => {
    const signals = evaluateBusinessPainSignals({
      current: buildMetrics({ rechargeCash: 7_000, serviceRevenue: 19_500 }),
      baseline: buildMetrics({ rechargeCash: 12_000, serviceRevenue: 20_000 }),
    });

    expect(signals.map((signal) => signal.id)).toContain("pain:recharge_weakening");
    expect(
      signals.find((signal) => signal.id === "pain:recharge_weakening")?.businessMeaning,
    ).toContain("续费意愿");
  });

  it("detects stored value pressure and new-customer waste from current metrics", () => {
    const signals = evaluateBusinessPainSignals({
      current: buildMetrics({
        highBalanceSleepingMemberCount: 7,
        highBalanceSleepingMemberAmount: 9200,
        groupbuyCohortCustomerCount: 20,
        groupbuy7dRevisitCustomerCount: 4,
        groupbuy7dRevisitRate: 0.2,
      }),
    });

    expect(signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(["pain:stored_value_pressure", "pain:new_customer_waste"]),
    );
  });

  it("detects technician conversion, point-clock, attendance, anti-settle, discount, and data risks", () => {
    const signals = evaluateBusinessPainSignals({
      current: buildMetrics({
        totalClockCount: 130,
        addClockRate: 0.07,
        marketRevenue: 200,
        pointClockRate: 0.18,
        activeTechCount: 15,
        onDutyTechCount: 8,
        antiServiceRevenue: 900,
        incompleteSync: true,
        unavailableMetrics: ["1.4", "1.7"],
      }),
      financial: {
        discountAmount: 4_200,
        originalAmount: 24_200,
      },
      techDependency: {
        topTechName: "小李",
        topTechVisitShare90d: 0.42,
        boundStoredBalanceAmount: 36_000,
      },
    });

    expect(signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining([
        "pain:tech_dependency",
        "pain:tech_productivity_anomaly",
        "pain:point_clock_drop",
        "pain:attendance_anomaly",
        "pain:anti_settle_anomaly",
        "pain:discount_anomaly",
        "pain:data_risk",
      ]),
    );
  });

  it("renders manager-readable action suggestions", () => {
    const [signal] = evaluateBusinessPainSignals({
      current: buildMetrics({ rechargeCash: 7_000, serviceRevenue: 19_500 }),
      baseline: buildMetrics({ rechargeCash: 12_000, serviceRevenue: 20_000 }),
    });

    expect(renderBusinessPainSignalSuggestion(signal)).toContain("痛点雷达");
    expect(renderBusinessPainSignalSuggestion(signal)).toContain("充值变弱");
  });
});
