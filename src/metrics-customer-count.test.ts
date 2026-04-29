import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { computeDailyStoreMetrics } from "./metrics.js";
import type { ConsumeBillRecord } from "./types.js";

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
    stores: [{ orgId: ORG_ID, storeName: "义乌店" }],
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
  infos: string[];
  payments?: Array<{ Name: string; Amount: number; PaymentType: number }>;
}): ConsumeBillRecord {
  return {
    orgId: ORG_ID,
    settleId: params.settleId,
    settleNo: params.settleNo,
    payAmount: params.payAmount,
    consumeAmount: params.consumeAmount ?? params.payAmount,
    discountAmount: params.discountAmount ?? 0,
    antiFlag: false,
    optTime: `${BIZ_DATE} 13:20:00`,
    bizDate: BIZ_DATE,
    rawJson: JSON.stringify({
      SettleId: params.settleId,
      SettleNo: params.settleNo,
      Infos: params.infos,
      Payments: params.payments ?? [{ Name: "现金", Amount: params.payAmount, PaymentType: 1 }],
    }),
  };
}

function buildStore(consume: ConsumeBillRecord[]) {
  return {
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
    getDailyMetrics: async () => null,
  };
}

describe("computeDailyStoreMetrics customerCount", () => {
  it("counts same-settlement同行顾客 as daily arrivals instead of raw order count", async () => {
    const consume = [
      buildConsumeBill({
        settleId: "S-001",
        settleNo: "NO-001",
        payAmount: 398,
        infos: [
          "张先生 [13800000001],消费199.00元;",
          "李先生 [13800000002],消费199.00元;",
        ],
      }),
      buildConsumeBill({
        settleId: "S-002",
        settleNo: "NO-002",
        payAmount: 168,
        infos: ["王女士 [13800000003],消费168.00元;"],
      }),
    ];

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig(),
      store: buildStore(consume) as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(metrics.serviceOrderCount).toBe(2);
    expect(metrics.customerCount).toBe(3);
    expect(metrics.averageTicket).toBe(188.67);
  });

  it("excludes zero-value auto settlements while still counting couponed service arrivals", async () => {
    const consume = [
      buildConsumeBill({
        settleId: "S-001",
        settleNo: "NO-001",
        payAmount: 198,
        infos: ["张先生 [13800000001],消费198.00元;"],
      }),
      buildConsumeBill({
        settleId: "S-COUPON",
        settleNo: "NO-COUPON",
        payAmount: 0,
        consumeAmount: 229,
        infos: [],
        payments: [{ Name: "全免券", Amount: 0, PaymentType: -1 }],
      }),
      buildConsumeBill({
        settleId: "S-AUTO",
        settleNo: "Auto_XF639127205535078658",
        payAmount: 0,
        consumeAmount: 0,
        infos: [],
        payments: [{ Name: "现金", Amount: 0, PaymentType: 1 }],
      }),
    ];

    const { metrics } = await computeDailyStoreMetrics({
      config: buildConfig(),
      store: buildStore(consume) as never,
      orgId: ORG_ID,
      bizDate: BIZ_DATE,
    });

    expect(metrics.serviceOrderCount).toBe(2);
    expect(metrics.customerCount).toBe(2);
  });
});
