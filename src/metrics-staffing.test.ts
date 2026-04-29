import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { computeDailyStoreMetrics } from "./metrics.js";
import { renderStoreManagerDailyReport } from "./store-manager-daily-detail.js";
import type {
  DailyStoreAlert,
  DailyStoreMetrics,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
  TechCurrentRecord,
  TechUpClockRecord,
  UserTradeRecord,
} from "./types.js";

const ORG_ID = "1003";
const BIZ_DATE = "2026-04-11";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: ORG_ID, storeName: "华美店" }],
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

function buildTechCurrent(params: {
  techCode: string;
  techName: string;
  personStateName?: string;
}): TechCurrentRecord {
  return {
    orgId: ORG_ID,
    techCode: params.techCode,
    techName: params.techName,
    isWork: true,
    isJob: true,
    pointClockNum: 0,
    wheelClockNum: 0,
    baseWages: 0,
    rawStoreName: "华美店",
    rawJson: JSON.stringify({
      PersonStateName: params.personStateName,
    }),
  };
}

function buildTechUpClock(personCode: string): TechUpClockRecord {
  return {
    orgId: ORG_ID,
    rowFingerprint: `${personCode}-${BIZ_DATE}`,
    personCode,
    personName: `技师${personCode}`,
    settleNo: `NO-${personCode}`,
    handCardCode: `HC-${personCode}`,
    itemName: "足疗",
    clockType: "排钟",
    count: 1,
    turnover: 100,
    comm: 30,
    ctime: `${BIZ_DATE} 13:00:00`,
    settleTime: `${BIZ_DATE} 14:10:00`,
    bizDate: BIZ_DATE,
    rawJson: JSON.stringify({
      ClockType: "排钟",
      ItemName: "足疗",
    }),
  };
}

function buildDetail() {
  return {
    attendance: {
      strength: 20,
      star: 8,
      spa: 0,
      ear: 0,
      small: 0,
      total: 28,
    },
    strengthMain: { queue: 40, selected: 0, point: 10, add: 2, subtotal: 52 },
    starMain: { queue: 12, selected: 0, point: 6, add: 2, subtotal: 20 },
    strengthSpa: { queue: 0, selected: 0, point: 0, add: 0, subtotal: 0 },
    starSpa: { queue: 0, selected: 0, point: 0, add: 0, subtotal: 0 },
    earClockCount: 0,
    smallClockCount: 0,
    mainClockCount: 72,
    totalRevenue: 32000,
    actualRevenue: 32000,
    cashPerformance: 28000,
  };
}

function buildMemberSnapshot(params: {
  memberId: string;
  storedAmount: number;
  silentDays: number;
}): MemberCurrentRecord {
  return {
    orgId: ORG_ID,
    memberId: params.memberId,
    name: `会员${params.memberId}`,
    storedAmount: params.storedAmount,
    consumeAmount: 0,
    createdTime: "2026-03-01 10:00:00",
    lastConsumeTime: params.silentDays >= 90 ? "2025-12-31 10:00:00" : "2026-04-10 10:00:00",
    silentDays: params.silentDays,
    rawJson: JSON.stringify({
      Id: params.memberId,
      Name: `会员${params.memberId}`,
      StoredAmount: params.storedAmount,
      SilentDays: params.silentDays,
      CreateTime: "2026-03-01 10:00:00",
    }),
  };
}

function buildMemberCard(params: { memberId: string; cardId: string }): MemberCardCurrentRecord {
  return {
    orgId: ORG_ID,
    memberId: params.memberId,
    cardId: params.cardId,
    cardNo: params.cardId,
    rawJson: JSON.stringify({
      MemberId: params.memberId,
      CardId: params.cardId,
      CardNo: params.cardId,
    }),
  };
}

function buildRecharge(params: {
  rechargeId: string;
  cardId: string;
  optTime: string;
  totalAmount: number;
}): RechargeBillRecord {
  return {
    orgId: ORG_ID,
    rechargeId: params.rechargeId,
    realityAmount: params.totalAmount,
    totalAmount: params.totalAmount,
    donateAmount: 0,
    antiFlag: false,
    optTime: params.optTime,
    bizDate: params.optTime.slice(0, 10),
    rawJson: JSON.stringify({
      Id: params.rechargeId,
      CardId: params.cardId,
      CardNo: params.cardId,
      OptTime: params.optTime,
      Total: params.totalAmount,
      Reality: params.totalAmount,
    }),
  };
}

function buildTrade(params: {
  tradeNo: string;
  cardId: string;
  optTime: string;
  changeBalance: number;
}): UserTradeRecord {
  return {
    orgId: ORG_ID,
    rowFingerprint: `${params.tradeNo}-${params.cardId}-${params.optTime}`,
    tradeNo: params.tradeNo,
    optTime: params.optTime,
    bizDate: params.optTime.slice(0, 10),
    cardOptType: params.changeBalance < 0 ? "consume" : "recharge",
    changeBalance: params.changeBalance,
    changeReality: 0,
    changeDonate: 0,
    changeIntegral: 0,
    paymentType: params.changeBalance < 0 ? "balance" : "cash",
    antiFlag: false,
    rawJson: JSON.stringify({
      TradeNo: params.tradeNo,
      CardId: params.cardId,
      CardNo: params.cardId,
      OptTime: params.optTime,
      ChangeBalance: params.changeBalance,
      CardOptType: params.changeBalance < 0 ? "consume" : "recharge",
    }),
  };
}

describe("computeDailyStoreMetrics staffing calibration", () => {
  it("excludes 下班 and 休假 technicians from on-duty headcount", async () => {
    const activeTech = ["T01", "T02", "T03"].map((code) =>
      buildTechCurrent({
        techCode: code,
        techName: `技师${code}`,
        personStateName: code === "T01" ? "上钟" : code === "T02" ? "空闲" : "待钟",
      }),
    );
    const inactiveTech = ["T04", "T05"].map((code, index) =>
      buildTechCurrent({
        techCode: code,
        techName: `技师${code}`,
        personStateName: index === 0 ? "下班" : "休假",
      }),
    );
    const techClock = ["T01", "T02", "T03"].map((code) => buildTechUpClock(code));
    const store = {
      listConsumeBillsByDate: async () => [],
      listConsumeBillsByDateRange: async () => [],
      listRechargeBillsByDate: async () => [],
      listRechargeBillsByDateRange: async () => [],
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => [],
      listTechUpClockByDate: async () => techClock,
      listTechMarketByDate: async () => [],
      listCurrentMembers: async () => [],
      listMemberDailySnapshotsByDateRange: async () => [],
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => [],
      listCurrentTech: async () => [...activeTech, ...inactiveTech],
      getEndpointWatermarksForOrg: async () => buildWatermarks(),
      getDailyMetrics: async () => null,
    };

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(metrics.activeTechCount).toBe(3);
    expect(metrics.onDutyTechCount).toBe(3);
  });

  it("does not prioritize staffing calibration when the gap is only caused by off-duty snapshots", async () => {
    const activeTechCodes = Array.from({ length: 32 }, (_, index) =>
      `A${String(index + 1).padStart(2, "0")}`,
    );
    const offDutyTechCodes = Array.from({ length: 45 }, (_, index) =>
      `O${String(index + 1).padStart(2, "0")}`,
    );
    const vacationTechCodes = Array.from({ length: 13 }, (_, index) =>
      `V${String(index + 1).padStart(2, "0")}`,
    );
    const currentTech = [
      ...activeTechCodes.map((code, index) =>
        buildTechCurrent({
          techCode: code,
          techName: `技师${code}`,
          personStateName: index < 16 ? "空闲" : "上钟",
        }),
      ),
      ...offDutyTechCodes.map((code) =>
        buildTechCurrent({
          techCode: code,
          techName: `技师${code}`,
          personStateName: "下班",
        }),
      ),
      ...vacationTechCodes.map((code) =>
        buildTechCurrent({
          techCode: code,
          techName: `技师${code}`,
          personStateName: "休假",
        }),
      ),
    ];
    const techClock = activeTechCodes.map((code) => buildTechUpClock(code));
    const store = {
      listConsumeBillsByDate: async () => [],
      listConsumeBillsByDateRange: async () => [],
      listRechargeBillsByDate: async () => [],
      listRechargeBillsByDateRange: async () => [],
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => [],
      listTechUpClockByDate: async () => techClock,
      listTechMarketByDate: async () => [],
      listCurrentMembers: async () => [],
      listMemberDailySnapshotsByDateRange: async () => [],
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => [],
      listCurrentTech: async () => currentTech,
      getEndpointWatermarksForOrg: async () => buildWatermarks(),
      getDailyMetrics: async () => null,
    };

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });
    const text = renderStoreManagerDailyReport({
      storeName: "荷塘悦色华美店",
      bizDate: BIZ_DATE,
      metrics,
      detail: buildDetail(),
      alerts: [] as DailyStoreAlert[],
      suggestions: [],
    });

    expect(metrics.activeTechCount).toBe(32);
    expect(metrics.onDutyTechCount).toBe(32);
    expect(text).not.toContain("先校准排班和在岗产能");
  });

  it("floors on-duty headcount to active technicians when the current snapshot undercounts the day", async () => {
    const activeTechCodes = Array.from({ length: 14 }, (_, index) =>
      `R${String(index + 1).padStart(2, "0")}`,
    );
    const currentTech = [
      ...activeTechCodes.slice(0, 4).map((code, index) =>
        buildTechCurrent({
          techCode: code,
          techName: `技师${code}`,
          personStateName: index < 2 ? "上钟" : "空闲",
        }),
      ),
      ...activeTechCodes.slice(4).map((code) =>
        buildTechCurrent({
          techCode: code,
          techName: `技师${code}`,
          personStateName: "下班",
        }),
      ),
    ];
    const techClock = activeTechCodes.map((code) => buildTechUpClock(code));
    const store = {
      listConsumeBillsByDate: async () => [],
      listConsumeBillsByDateRange: async () => [],
      listRechargeBillsByDate: async () => [],
      listRechargeBillsByDateRange: async () => [],
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => [],
      listTechUpClockByDate: async () => techClock,
      listTechMarketByDate: async () => [],
      listCurrentMembers: async () => [],
      listMemberDailySnapshotsByDateRange: async () => [],
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => [],
      listCurrentTech: async () => currentTech,
      getEndpointWatermarksForOrg: async () => buildWatermarks(),
      getDailyMetrics: async () => null,
    };

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(metrics.activeTechCount).toBe(14);
    expect(metrics.onDutyTechCount).toBe(14);
  });

  it("computes high-balance sleeping members and first-charge-unconsumed members from the business-day snapshot", async () => {
    const memberSnapshots = [
      buildMemberSnapshot({ memberId: "M1", storedAmount: 5000, silentDays: 120 }),
      buildMemberSnapshot({ memberId: "M2", storedAmount: 800, silentDays: 95 }),
      buildMemberSnapshot({ memberId: "M3", storedAmount: 400, silentDays: 100 }),
      buildMemberSnapshot({ memberId: "M4", storedAmount: 300, silentDays: 20 }),
    ];
    const memberCards = [
      buildMemberCard({ memberId: "M1", cardId: "C1" }),
      buildMemberCard({ memberId: "M2", cardId: "C2" }),
      buildMemberCard({ memberId: "M3", cardId: "C3" }),
      buildMemberCard({ memberId: "M4", cardId: "C4" }),
    ];
    const recharges = [
      buildRecharge({
        rechargeId: "R1",
        cardId: "C1",
        optTime: "2026-04-01 10:00:00",
        totalAmount: 5000,
      }),
      buildRecharge({
        rechargeId: "R2",
        cardId: "C2",
        optTime: "2026-04-05 09:00:00",
        totalAmount: 800,
      }),
      buildRecharge({
        rechargeId: "R3",
        cardId: "C3",
        optTime: "2026-04-10 09:00:00",
        totalAmount: 400,
      }),
    ];
    const trades = [
      buildTrade({
        tradeNo: "T1",
        cardId: "C1",
        optTime: "2026-04-03 12:00:00",
        changeBalance: -200,
      }),
    ];
    const store = {
      listConsumeBillsByDate: async () => [],
      listConsumeBillsByDateRange: async () => [],
      listRechargeBillsByDate: async () => [],
      listRechargeBillsByDateRange: async () => recharges,
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => trades,
      listTechUpClockByDate: async () => [],
      listTechMarketByDate: async () => [],
      listCurrentMembers: async () => [],
      listMemberDailySnapshotsByDateRange: async () => memberSnapshots,
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => memberCards,
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

    const extendedMetrics = metrics as DailyStoreMetrics & {
      highBalanceSleepingMemberCount?: number;
      highBalanceSleepingMemberAmount?: number;
      firstChargeUnconsumedMemberCount?: number;
      firstChargeUnconsumedMemberAmount?: number;
    };

    expect(extendedMetrics.highBalanceSleepingMemberCount).toBe(1);
    expect(extendedMetrics.highBalanceSleepingMemberAmount).toBe(5000);
    expect(extendedMetrics.firstChargeUnconsumedMemberCount).toBe(2);
    expect(extendedMetrics.firstChargeUnconsumedMemberAmount).toBe(1200);
  });
});
