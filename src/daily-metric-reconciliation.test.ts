import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  parseDailyMetricReconciliationArgs,
  reconcileDailyStoreMetrics,
  renderDailyMetricReconciliationReport,
} from "./daily-metric-reconciliation.js";
import type {
  ConsumeBillRecord,
  DailyStoreMetrics,
  MemberCurrentRecord,
  RechargeBillRecord,
  TechUpClockRecord,
} from "./types.js";

const ORG_ID = "1001";
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
    stores: [
      {
        orgId: ORG_ID,
        storeName: "义乌店",
        roomCount: 4,
        operatingHoursPerDay: 10,
        fixedMonthlyCost: 3000,
        variableCostRate: 0.1,
        materialCostRate: 0.05,
      },
    ],
  });
}

function buildConfigWithoutOptionalMetrics() {
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
  consumeAmount?: number;
  discountAmount?: number;
  payments: Array<{ name: string; amount: number; paymentType: number }>;
  optTime?: string;
  bizDate?: string;
  rawExtras?: Record<string, unknown>;
}): ConsumeBillRecord {
  return {
    orgId: ORG_ID,
    settleId: params.settleId,
    settleNo: params.settleNo,
    payAmount: params.payAmount,
    consumeAmount: params.consumeAmount ?? params.payAmount,
    discountAmount: params.discountAmount ?? 0,
    antiFlag: false,
    optTime: params.optTime ?? `${BIZ_DATE} 13:20:00`,
    bizDate: params.bizDate ?? BIZ_DATE,
    rawJson: JSON.stringify({
      SettleId: params.settleId,
      SettleNo: params.settleNo,
      Payments: params.payments.map((payment) => ({
        Name: payment.name,
        Amount: payment.amount,
        PaymentType: payment.paymentType,
      })),
      ...(params.rawExtras ?? {}),
    }),
  };
}

function buildRecharge(params: {
  rechargeId: string;
  realityAmount: number;
  totalAmount: number;
  donateAmount: number;
  optTime?: string;
  bizDate?: string;
  rawExtras?: Record<string, unknown>;
}): RechargeBillRecord {
  return {
    orgId: ORG_ID,
    rechargeId: params.rechargeId,
    realityAmount: params.realityAmount,
    totalAmount: params.totalAmount,
    donateAmount: params.donateAmount,
    antiFlag: false,
    optTime: params.optTime ?? `${BIZ_DATE} 11:10:00`,
    bizDate: params.bizDate ?? BIZ_DATE,
    rawJson: JSON.stringify({
      Id: params.rechargeId,
      Reality: params.realityAmount,
      Total: params.totalAmount,
      Donate: params.donateAmount,
      ...(params.rawExtras ?? {}),
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
  phone?: string;
  name?: string;
}): MemberCurrentRecord {
  return {
    orgId: ORG_ID,
    memberId: params.memberId,
    name: params.name ?? `会员${params.memberId}`,
    phone: params.phone,
    storedAmount: params.storedAmount,
    consumeAmount: 0,
    createdTime: params.createdTime,
    lastConsumeTime: params.silentDays >= 90 ? "2026-01-01 10:00:00" : `${BIZ_DATE} 10:00:00`,
    silentDays: params.silentDays,
    rawJson: JSON.stringify({
      Id: params.memberId,
      Name: params.name ?? `会员${params.memberId}`,
      Phone: params.phone,
      StoredAmount: params.storedAmount,
      SilentDays: params.silentDays,
      CreateTime: params.createdTime,
    }),
  };
}

function buildStoredMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: ORG_ID,
    storeName: "义乌店",
    bizDate: BIZ_DATE,
    serviceRevenue: 490,
    rechargeCash: 300,
    rechargeStoredValue: 370,
    rechargeBonusValue: 70,
    antiServiceRevenue: 0,
    serviceOrderCount: 2,
    customerCount: 2,
    averageTicket: 245,
    totalClockCount: 10,
    upClockRecordCount: 2,
    pointClockRecordCount: 1,
    pointClockRate: 0.5,
    addClockRecordCount: 1,
    addClockRate: 0.5,
    clockRevenue: 450,
    clockEffect: 49,
    activeTechCount: 2,
    onDutyTechCount: 2,
    techCommission: 135,
    techCommissionRate: 0.3,
    marketRevenue: 60,
    marketCommission: 12,
    memberPaymentAmount: 120,
    memberPaymentShare: 120 / 490,
    cashPaymentAmount: 80,
    cashPaymentShare: 80 / 490,
    wechatPaymentAmount: 170,
    wechatPaymentShare: 170 / 490,
    alipayPaymentAmount: 130,
    alipayPaymentShare: 130 / 490,
    storedConsumeAmount: 120,
    storedConsumeRate: 0.4,
    groupbuyOrderCount: 0,
    groupbuyOrderShare: 0,
    groupbuyAmount: 0,
    groupbuyAmountShare: 0,
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
    effectiveMembers: 4,
    newMembers: 1,
    sleepingMembers: 2,
    sleepingMemberRate: 0.5,
    currentStoredBalance: 4200,
    roomOccupancyRate: 0.25,
    roomTurnoverRate: 0.5,
    grossMarginRate: 0.58,
    netMarginRate: 0.38,
    breakEvenRevenue: 3000 / 0.58,
    incompleteSync: false,
    staleSyncEndpoints: [],
    unavailableMetrics: ["CAC/活动ROI"],
    ...overrides,
  };
}

describe("daily metric reconciliation", () => {
  it("parses reconciliation CLI args", () => {
    expect(
      parseDailyMetricReconciliationArgs([
        "--org",
        "1001",
        "--date",
        "2026-04-11",
        "--config",
        "/tmp/htops.json",
        "--json",
        "--fail-on-diff",
        "--show-matches",
      ]),
    ).toEqual({
      orgId: "1001",
      bizDate: "2026-04-11",
      configPath: "/tmp/htops.json",
      json: true,
      failOnDiff: true,
      showMatches: true,
    });
  });

  it("reconciles fresh metrics against raw facts and flags stored mismatches", async () => {
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
      getDailyMetrics: async () => buildStoredMetrics(),
    };

    const report = await reconcileDailyStoreMetrics({
      config: buildConfigWithoutOptionalMetrics(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(report.storeName).toBe("义乌店");
    expect(report.summary.hasDiffs).toBe(true);
    expect(report.summary.storedMismatchCount).toBeGreaterThan(0);
    expect(report.summary.auditedMetricCount).toBeGreaterThan(20);
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: "serviceRevenue",
          expected: 500,
          fresh: 500,
          stored: 490,
          status: "stored_mismatch",
        }),
        expect.objectContaining({
          metricKey: "rechargeStoredValue",
          expected: 370,
          fresh: 370,
          status: "match",
        }),
        expect.objectContaining({
          metricKey: "currentStoredBalance",
          expected: 4200,
          fresh: 4200,
          status: "match",
        }),
      ]),
    );
    expect(report.summary.unauditedMetricKeys).not.toContain("groupbuy7dRevisitRate");
  });

  it("audits customer count with the same countable service-consume scope as daily metrics", async () => {
    const consume = [
      buildConsumeBill({
        settleId: "S-PAID",
        settleNo: "NO-PAID",
        payAmount: 198,
        payments: [{ name: "现金", amount: 198, paymentType: 1 }],
        rawExtras: { Infos: ["张先生 [13800000001],消费198.00元;"] },
      }),
      buildConsumeBill({
        settleId: "S-COUPON",
        settleNo: "NO-COUPON",
        payAmount: 0,
        consumeAmount: 229,
        payments: [{ name: "全免券", amount: 0, paymentType: -1 }],
      }),
      buildConsumeBill({
        settleId: "S-AUTO",
        settleNo: "Auto_XF639127205535078658",
        payAmount: 0,
        consumeAmount: 0,
        payments: [{ name: "现金", amount: 0, paymentType: 1 }],
      }),
    ];
    const store = {
      listConsumeBillsByDate: async () => consume,
      listConsumeBillsByDateRange: async () => consume,
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
      getDailyMetrics: async () =>
        buildStoredMetrics({
          serviceRevenue: 198,
          serviceOrderCount: 2,
          customerCount: 2,
          averageTicket: 99,
        }),
    };

    const report = await reconcileDailyStoreMetrics({
      config: buildConfigWithoutOptionalMetrics(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: "serviceOrderCount",
          expected: 2,
          fresh: 2,
          stored: 2,
          status: "match",
        }),
        expect.objectContaining({
          metricKey: "customerCount",
          expected: 2,
          fresh: 2,
          stored: 2,
          status: "match",
        }),
        expect.objectContaining({
          metricKey: "averageTicket",
          expected: 99,
          fresh: 99,
          stored: 99,
          status: "match",
        }),
      ]),
    );
  });

  it("renders a human-readable reconciliation report", () => {
    const text = renderDailyMetricReconciliationReport({
      orgId: ORG_ID,
      storeName: "义乌店",
      bizDate: BIZ_DATE,
      summary: {
        auditedMetricCount: 30,
        matchCount: 28,
        freshMismatchCount: 0,
        storedMismatchCount: 1,
        missingStoredCount: 1,
        hasDiffs: true,
        unauditedMetricKeys: ["groupbuy7dRevisitRate"],
      },
      items: [
        {
          metricKey: "serviceRevenue",
          label: "服务营收",
          category: "revenue",
          expected: 500,
          fresh: 500,
          stored: 490,
          source: "sum(consume.payAmount where antiFlag=false)",
          status: "stored_mismatch",
        },
        {
          metricKey: "rechargeCash",
          label: "充值现金",
          category: "recharge",
          expected: 300,
          fresh: 300,
          stored: 300,
          source: "sum(recharge.realityAmount where antiFlag=false)",
          status: "match",
        },
      ],
    });

    expect(text).toContain("义乌店 2026-04-11 日报指标对账");
    expect(text).toContain("stored mismatch 1");
    expect(text).toContain("服务营收");
    expect(text).toContain("expected=500");
    expect(text).toContain("unaudited metrics: groupbuy7dRevisitRate");
  });

  it("treats explicit stored null values as matches when the metric is intentionally unavailable", async () => {
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
      getDailyMetrics: async () =>
        ({
          ...buildStoredMetrics(),
          roomOccupancyRate: null,
          roomTurnoverRate: null,
          grossMarginRate: null,
          netMarginRate: null,
          breakEvenRevenue: null,
        }) as DailyStoreMetrics,
    };

    const report = await reconcileDailyStoreMetrics({
      config: buildConfigWithoutOptionalMetrics(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    const roomOccupancy = report.items.find((item) => item.metricKey === "roomOccupancyRate");
    expect(roomOccupancy?.status).toBe("match");
  });

  it("audits live window metrics that daily reports actually display", async () => {
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
        settleId: "S-GB-001",
        settleNo: "NO-GB-001",
        payAmount: 99,
        payments: [{ name: "美团", amount: 99, paymentType: 4 }],
        optTime: "2026-04-01 10:00:00",
        bizDate: "2026-04-01",
        rawExtras: { Phone: "13800000001", MemberName: "会员甲" },
      }),
      buildConsumeBill({
        settleId: "S-GB-002",
        settleNo: "NO-GB-002",
        payAmount: 300,
        payments: [{ name: "会员", amount: 300, paymentType: 3 }],
        optTime: "2026-04-03 12:00:00",
        bizDate: "2026-04-03",
        rawExtras: { Phone: "13800000001", MemberName: "会员甲" },
      }),
      buildConsumeBill({
        settleId: "S-GB-003",
        settleNo: "NO-GB-003",
        payAmount: 88,
        payments: [{ name: "抖音", amount: 88, paymentType: 4 }],
        optTime: "2026-04-04 15:00:00",
        bizDate: "2026-04-04",
        rawExtras: { Phone: "13800000002", MemberName: "会员乙" },
      }),
    ];
    const recharges = [
      buildRecharge({
        rechargeId: "R-GB-001",
        realityAmount: 200,
        totalAmount: 200,
        donateAmount: 0,
        optTime: "2026-04-02 09:00:00",
        bizDate: "2026-04-02",
        rawExtras: { Phone: "13800000001", MemberName: "会员甲" },
      }),
    ];
    const members = [
      buildMemberSnapshot({
        memberId: "M1",
        storedAmount: 1000,
        silentDays: 10,
        createdTime: "2026-04-02 08:00:00",
        phone: "13800000001",
        name: "会员甲",
      }),
      buildMemberSnapshot({
        memberId: "M2",
        storedAmount: 200,
        silentDays: 20,
        createdTime: "2026-03-20 10:00:00",
        phone: "13800000002",
        name: "会员乙",
      }),
    ];
    const store = {
      listConsumeBillsByDate: async () => consume.filter((row) => row.bizDate === BIZ_DATE),
      listConsumeBillsByDateRange: async () => consume,
      listRechargeBillsByDate: async () => [],
      listRechargeBillsByDateRange: async () => recharges,
      listUserTradesByDate: async () => [],
      listUserTradesByDateRange: async () => [],
      listTechUpClockByDate: async () => [],
      listTechMarketByDate: async () => [],
      listCurrentMembers: async () => members,
      listMemberDailySnapshotsByDateRange: async () => members,
      listCurrentMemberCards: async () => [],
      listMemberCardDailySnapshotsByDateRange: async () => [],
      listCurrentTech: async () => [],
      listStoreReview7dByDateRange: async () => [
        {
          orgId: ORG_ID,
          windowEndBizDate: BIZ_DATE,
          storeName: "义乌店",
          memberRepurchaseBaseCustomerCount7d: 6,
          memberRepurchaseReturnedCustomerCount7d: 2,
          memberRepurchaseRate7d: 2 / 6,
        },
      ],
      listStoreSummary30dByDateRange: async () => [],
      getEndpointWatermarksForOrg: async () => buildWatermarks(),
      getDailyMetrics: async () =>
        buildStoredMetrics({
          groupbuyCohortCustomerCount: 0,
          groupbuy7dRevisitCustomerCount: 0,
          groupbuy7dRevisitRate: 0,
          groupbuy7dCardOpenedCustomerCount: 0,
          groupbuy7dCardOpenedRate: 0,
          groupbuy7dStoredValueConvertedCustomerCount: 0,
          groupbuy7dStoredValueConversionRate: 0,
          groupbuy30dMemberPayConvertedCustomerCount: 0,
          groupbuy30dMemberPayConversionRate: 0,
          groupbuyFirstOrderCustomerCount: 0,
          groupbuyFirstOrderHighValueMemberCustomerCount: 0,
          groupbuyFirstOrderHighValueMemberRate: 0,
          memberRepurchaseBaseCustomerCount7d: 6,
          memberRepurchaseReturnedCustomerCount7d: 1,
          memberRepurchaseRate7d: 1 / 6,
        }),
    };

    const report = await reconcileDailyStoreMetrics({
      config: buildConfig(),
      store: store as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(report.summary.unauditedMetricKeys).not.toContain("groupbuy7dCardOpenedRate");
    expect(report.summary.unauditedMetricKeys).not.toContain("memberRepurchaseRate7d");
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricKey: "groupbuy7dCardOpenedRate",
          expected: 0.5,
          fresh: 0.5,
          stored: 0,
          status: "stored_mismatch",
        }),
        expect.objectContaining({
          metricKey: "memberRepurchaseRate7d",
          expected: 2 / 6,
          fresh: 2 / 6,
          stored: 1 / 6,
          status: "stored_mismatch",
        }),
      ]),
    );
  });
});
