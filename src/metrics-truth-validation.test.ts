import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { computeDailyStoreMetrics } from "./metrics.js";
import type {
  ConsumeBillRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
  TechUpClockRecord,
} from "./types.js";

const ORG_ID = "1001";
const BIZ_DATE = "2026-04-11";

function buildConfig(overrides: {
  roomCount?: number;
  operatingHoursPerDay?: number;
  fixedMonthlyCost?: number;
  variableCostRate?: number;
  materialCostRate?: number;
} = {}) {
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
        orgId: ORG_ID,
        storeName: "义乌店",
        roomCount: overrides.roomCount,
        operatingHoursPerDay: overrides.operatingHoursPerDay,
        fixedMonthlyCost: overrides.fixedMonthlyCost,
        variableCostRate: overrides.variableCostRate,
        materialCostRate: overrides.materialCostRate,
      },
    ],
  });
}

function buildWatermarks() {
  return Object.fromEntries(
    ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"].map((endpoint) => [
      endpoint,
      "2026-04-11T20:05:00.000Z",
    ]),
  );
}

function buildConsumeBill(params: {
  settleId: string;
  settleNo: string;
  payAmount: number;
  payments: Array<{ name: string; amount: number; paymentType: number }>;
  optTime?: string;
}): ConsumeBillRecord {
  return {
    orgId: ORG_ID,
    settleId: params.settleId,
    settleNo: params.settleNo,
    payAmount: params.payAmount,
    consumeAmount: params.payAmount,
    discountAmount: 0,
    antiFlag: false,
    optTime: params.optTime ?? `${BIZ_DATE} 13:20:00`,
    bizDate: BIZ_DATE,
    rawJson: JSON.stringify({
      SettleId: params.settleId,
      SettleNo: params.settleNo,
      Payments: params.payments.map((payment) => ({
        Name: payment.name,
        Amount: payment.amount,
        PaymentType: payment.paymentType,
      })),
    }),
  };
}

function buildRecharge(params: {
  rechargeId: string;
  realityAmount: number;
  totalAmount: number;
  donateAmount: number;
}): RechargeBillRecord {
  return {
    orgId: ORG_ID,
    rechargeId: params.rechargeId,
    realityAmount: params.realityAmount,
    totalAmount: params.totalAmount,
    donateAmount: params.donateAmount,
    antiFlag: false,
    optTime: `${BIZ_DATE} 11:10:00`,
    bizDate: BIZ_DATE,
    rawJson: JSON.stringify({
      Id: params.rechargeId,
      Reality: params.realityAmount,
      Total: params.totalAmount,
      Donate: params.donateAmount,
    }),
  };
}

function buildTechUpClock(params: {
  rowFingerprint: string;
  personCode: string;
  count: number;
  turnover: number;
  comm: number;
  clockType: string;
  addClockType?: number;
}): TechUpClockRecord {
  return {
    orgId: ORG_ID,
    rowFingerprint: params.rowFingerprint,
    personCode: params.personCode,
    personName: `技师${params.personCode}`,
    settleNo: `NO-${params.personCode}`,
    handCardCode: `HC-${params.personCode}`,
    itemName: "足疗",
    clockType: params.clockType,
    count: params.count,
    turnover: params.turnover,
    comm: params.comm,
    ctime: `${BIZ_DATE} 14:00:00`,
    settleTime: `${BIZ_DATE} 15:00:00`,
    bizDate: BIZ_DATE,
    rawJson: JSON.stringify({
      ClockType: params.clockType,
      AddClockType: params.addClockType ?? 0,
      ItemName: "足疗",
    }),
  };
}

function buildMemberSnapshot(params: {
  memberId: string;
  storedAmount: number;
  silentDays: number;
  createdTime: string;
}): MemberCurrentRecord {
  return {
    orgId: ORG_ID,
    memberId: params.memberId,
    name: `会员${params.memberId}`,
    storedAmount: params.storedAmount,
    consumeAmount: 0,
    createdTime: params.createdTime,
    lastConsumeTime: params.silentDays >= 90 ? "2026-01-01 10:00:00" : `${BIZ_DATE} 10:00:00`,
    silentDays: params.silentDays,
    rawJson: JSON.stringify({
      Id: params.memberId,
      Name: `会员${params.memberId}`,
      StoredAmount: params.storedAmount,
      SilentDays: params.silentDays,
      CreateTime: params.createdTime,
    }),
  };
}

describe("computeDailyStoreMetrics truth validation", () => {
  it("computes financial, member, room, and cost metrics from raw business facts", async () => {
    const consume = [
      buildConsumeBill({
        settleId: "S-001",
        settleNo: "NO-001",
        payAmount: 200,
        payments: [
          { name: "会员", amount: 120, paymentType: 3 },
          { name: "现金", amount: 80, paymentType: 1 },
        ],
      }),
      buildConsumeBill({
        settleId: "S-002",
        settleNo: "NO-002",
        payAmount: 300,
        payments: [
          { name: "微信", amount: 170, paymentType: 4 },
          { name: "支付宝", amount: 130, paymentType: 11 },
        ],
      }),
    ];
    const recharges = [
      buildRecharge({
        rechargeId: "R-001",
        realityAmount: 100,
        totalAmount: 120,
        donateAmount: 20,
      }),
      buildRecharge({
        rechargeId: "R-002",
        realityAmount: 200,
        totalAmount: 250,
        donateAmount: 50,
      }),
    ];
    const techClock = [
      buildTechUpClock({
        rowFingerprint: "T-001",
        personCode: "T01",
        count: 4,
        turnover: 180,
        comm: 54,
        clockType: "point",
      }),
      buildTechUpClock({
        rowFingerprint: "T-002",
        personCode: "T02",
        count: 6,
        turnover: 270,
        comm: 81,
        clockType: "wheel",
        addClockType: 1,
      }),
    ];
    const members = [
      buildMemberSnapshot({
        memberId: "M1",
        storedAmount: 1000,
        silentDays: 0,
        createdTime: `${BIZ_DATE} 10:00:00`,
      }),
      buildMemberSnapshot({
        memberId: "M2",
        storedAmount: 2000,
        silentDays: 100,
        createdTime: "2026-04-05 10:00:00",
      }),
      buildMemberSnapshot({
        memberId: "M3",
        storedAmount: 500,
        silentDays: 170,
        createdTime: "2026-03-20 10:00:00",
      }),
      buildMemberSnapshot({
        memberId: "M4",
        storedAmount: 700,
        silentDays: 40,
        createdTime: "2026-03-25 10:00:00",
      }),
    ];
    const store = {
      listConsumeBillsByDate: async () => consume,
      listConsumeBillsByDateRange: async () => consume,
      listRechargeBillsByDate: async () => recharges,
      listRechargeBillsByDateRange: async () => recharges,
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => [],
      listTechUpClockByDate: async () => techClock,
      listTechMarketByDate: async () => [{ afterDisc: 60, commission: 12 }],
      listCurrentMembers: async () => [],
      listMemberDailySnapshotsByDateRange: async () => members,
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => [],
      listCurrentTech: async () => [
        { isJob: true, isWork: true, rawJson: JSON.stringify({ PersonStateName: "上钟" }) },
        { isJob: true, isWork: true, rawJson: JSON.stringify({ PersonStateName: "空闲" }) },
      ],
      getEndpointWatermarksForOrg: async () => buildWatermarks(),
      getDailyMetrics: async () => null,
    };

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig({
        roomCount: 4,
        operatingHoursPerDay: 10,
        fixedMonthlyCost: 3000,
        variableCostRate: 0.1,
        materialCostRate: 0.05,
      }),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(metrics.serviceRevenue).toBe(500);
    expect(metrics.rechargeCash).toBe(300);
    expect(metrics.rechargeStoredValue).toBe(370);
    expect(metrics.rechargeBonusValue).toBe(70);
    expect(metrics.memberPaymentAmount).toBe(120);
    expect(metrics.memberPaymentShare).toBeCloseTo(0.24, 6);
    expect(metrics.cashPaymentAmount).toBe(80);
    expect(metrics.cashPaymentShare).toBeCloseTo(0.16, 6);
    expect(metrics.wechatPaymentAmount).toBe(170);
    expect(metrics.wechatPaymentShare).toBeCloseTo(0.34, 6);
    expect(metrics.alipayPaymentAmount).toBe(130);
    expect(metrics.alipayPaymentShare).toBeCloseTo(0.26, 6);
    expect(metrics.storedConsumeAmount).toBe(120);
    expect(metrics.storedConsumeRate).toBeCloseTo(0.4, 6);
    expect(metrics.totalClockCount).toBe(10);
    expect(metrics.clockRevenue).toBe(450);
    expect(metrics.clockEffect).toBe(50);
    expect(metrics.techCommission).toBe(135);
    expect(metrics.techCommissionRate).toBeCloseTo(0.3, 6);
    expect(metrics.marketRevenue).toBe(60);
    expect(metrics.marketCommission).toBe(12);
    expect(metrics.activeTechCount).toBe(2);
    expect(metrics.onDutyTechCount).toBe(2);
    expect(metrics.effectiveMembers).toBe(4);
    expect(metrics.newMembers).toBe(1);
    expect(metrics.sleepingMembers).toBe(2);
    expect(metrics.sleepingMemberRate).toBeCloseTo(0.5, 6);
    expect(metrics.currentStoredBalance).toBe(4200);
    expect(metrics.roomOccupancyRate).toBeCloseTo(0.25, 6);
    expect(metrics.roomTurnoverRate).toBeCloseTo(0.5, 6);
    expect(metrics.grossMarginRate).toBeCloseTo(0.58, 6);
    expect(metrics.netMarginRate).toBeCloseTo(0.38, 6);
    expect(metrics.breakEvenRevenue).toBeCloseTo(3000 / 0.58, 6);
  });

  it("counts new members by business-day cutoff instead of natural calendar day", async () => {
    const store = {
      listConsumeBillsByDate: async () => [],
      listConsumeBillsByDateRange: async () => [],
      listRechargeBillsByDate: async () => [],
      listRechargeBillsByDateRange: async () => [],
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => [],
      listTechUpClockByDate: async () => [],
      listTechMarketByDate: async () => [],
      listCurrentMembers: async () => [],
      listMemberDailySnapshotsByDateRange: async () => [
        buildMemberSnapshot({
          memberId: "M1",
          storedAmount: 100,
          silentDays: 0,
          createdTime: "2026-04-11 02:59:00",
        }),
        buildMemberSnapshot({
          memberId: "M2",
          storedAmount: 100,
          silentDays: 0,
          createdTime: "2026-04-11 03:00:00",
        }),
        buildMemberSnapshot({
          memberId: "M3",
          storedAmount: 100,
          silentDays: 0,
          createdTime: "2026-04-10 23:00:00",
        }),
      ],
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => [],
      listCurrentTech: async () => [],
      getEndpointWatermarksForOrg: async () => buildWatermarks(),
      getDailyMetrics: async () => null,
    };

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(metrics.newMembers).toBe(1);
  });

  it("returns null room and cost metrics when no room or cost config is available", async () => {
    const store = {
      listConsumeBillsByDate: async () => [],
      listConsumeBillsByDateRange: async () => [],
      listRechargeBillsByDate: async () => [],
      listRechargeBillsByDateRange: async () => [],
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => [],
      listTechUpClockByDate: async () => [],
      listTechMarketByDate: async () => [],
      listCurrentMembers: async () => [],
      listMemberDailySnapshotsByDateRange: async () => [],
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => [],
      listCurrentTech: async () => [],
      getEndpointWatermarksForOrg: async () => buildWatermarks(),
      getDailyMetrics: async () => null,
    };

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(metrics.roomOccupancyRate).toBeNull();
    expect(metrics.roomTurnoverRate).toBeNull();
    expect(metrics.grossMarginRate).toBeNull();
    expect(metrics.netMarginRate).toBeNull();
    expect(metrics.breakEvenRevenue).toBeNull();
    expect(metrics.unavailableMetrics).toContain("包间上座率/翻房率");
    expect(metrics.unavailableMetrics).toContain("毛利/净利/保本点");
    expect(metrics.unavailableMetrics).toContain("CAC/活动ROI");
  });
});
