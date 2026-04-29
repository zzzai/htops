import { DataType, newDb } from "pg-mem";
import { afterEach, describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { buildDailyStoreReport } from "./report.js";
import { HetangOpsStore } from "./store.js";
import { syncHetangStore } from "./sync.js";

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
        storeName: "一号店",
        notification: { channel: "wecom", target: "store-1001" },
      },
      {
        orgId: "1002",
        storeName: "二号店",
        notification: { channel: "wecom", target: "store-1002" },
      },
      {
        orgId: "1003",
        storeName: "三号店",
        notification: { channel: "wecom", target: "store-1003" },
      },
      {
        orgId: "1004",
        storeName: "四号店",
        notification: { channel: "wecom", target: "store-1004" },
      },
      {
        orgId: "1005",
        storeName: "五号店",
        notification: { channel: "wecom", target: "store-1005" },
      },
    ],
  });
}

function createTestDb() {
  const db = newDb();
  db.public.registerFunction({
    name: "right",
    args: [DataType.text, DataType.integer],
    returns: DataType.text,
    implementation: (value: string, count: number) =>
      typeof value === "string" ? value.slice(-Math.max(0, Number(count))) : "",
  });
  return db;
}

describe("syncHetangStore + buildDailyStoreReport", () => {
  it("syncs one store with vendor-safe retries, computes daily metrics, and renders actionable suggestions", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();
    let commissionAttempts = 0;

    const fakeClient = {
      fetchPaged: async (endpoint: string) => {
        switch (endpoint) {
          case "1.1":
            return [
              {
                Id: "M-001",
                Name: "会员甲",
                OrgId: "1001",
                StoredAmount: 500,
                ConsumeAmount: 1200,
                CTime: "2026-03-29 10:00:00",
                LastConsumeTime: "2026-03-29 13:20:00",
                SilentDays: 0,
                Storeds: [
                  {
                    Id: "CARD-001",
                    CardNo: "YW0001",
                    OrgId: "1001",
                    OrgName: "原始门店A",
                  },
                ],
                OrgName: "原始门店A",
              },
              {
                Id: "M-002",
                Name: "会员乙",
                OrgId: "1001",
                StoredAmount: 50,
                ConsumeAmount: 300,
                CTime: "2025-11-01 10:00:00",
                LastConsumeTime: "2025-12-01 13:20:00",
                SilentDays: 120,
                OrgName: "原始门店A",
              },
            ];
          case "1.2":
            return [
              {
                SettleId: "S-001",
                SettleNo: "NO-001",
                Pay: 200,
                Consume: 200,
                DiscountAmount: 0,
                OptTime: "2026-03-29 13:20:00",
                IsAnti: 0,
                Payments: [{ Name: "会员", Amount: 200, PaymentType: 3 }],
                Infos: ["会员甲 (金悦卡) [YW0001],消费200.00元(积分+0);"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-002",
                SettleNo: "NO-002",
                Pay: 50,
                Consume: 50,
                DiscountAmount: 0,
                OptTime: "2026-03-29 18:20:00",
                IsAnti: 1,
                OrgName: "原始门店A",
              },
            ];
          case "1.3":
            return [
              {
                Id: "R-001",
                Reality: 300,
                Total: 350,
                Donate: 50,
                OptTime: "2026-03-29 12:00:00",
                IsAnti: 0,
                OrgName: "原始门店A",
              },
            ];
          default:
            return [];
        }
      },
      fetchUserTrades: async (params: Record<string, unknown>) => {
        const type = Number(params.Type);
        if (type === 3 || type === 9) {
          throw new Error("The CommandText property has not been properly initialized.");
        }
        return type === 6
          ? [
              {
                OrgId: "1001",
                OrgName: "原始门店A",
                TradeNo: "T-001",
                OptTime: "2026-03-29 13:20:00",
                CardOptType: "consume",
                ChangeBalance: -200,
                ChangeReality: 0,
                ChangeDonate: 0,
                ChangeIntegral: 0,
                PaymentType: "balance",
                IsAnti: 0,
              },
              {
                OrgId: "1002",
                OrgName: "别的门店",
                TradeNo: "T-OTHER",
                OptTime: "2026-03-29 13:22:00",
                CardOptType: "consume",
                ChangeBalance: -300,
                ChangeReality: 0,
                ChangeDonate: 0,
                ChangeIntegral: 0,
                PaymentType: "balance",
                IsAnti: 0,
              },
            ]
          : [];
      },
      fetchTechList: async () => [
        {
          Code: "T001",
          Name: "技师甲",
          OrgId: "1001",
          OrgName: "原始门店A",
          IsWork: 1,
          IsJob: 1,
        },
        {
          Code: "T002",
          Name: "技师乙",
          OrgId: "1001",
          OrgName: "原始门店A",
          IsWork: 1,
          IsJob: 1,
        },
      ],
      fetchTechUpClockList: async (params: Record<string, unknown>) =>
        String(params.Code ?? "") === ""
          ? [
              {
                PersonCode: "T001",
                PersonName: "技师甲",
                SettleNo: "NO-001",
                HandCardCode: "HC-001",
                ItemName: "足疗",
                Count: 2,
                Turnover: 180,
                Comm: 70,
                ClockType: "point",
                AddClockType: 0,
                CTime: "2026-03-29 13:20:00",
                SettleTime: "2026-03-29 14:20:00",
              },
              {
                PersonCode: "T002",
                PersonName: "技师乙",
                SettleNo: "NO-003",
                HandCardCode: "HC-002",
                ItemName: "修脚",
                Count: 1,
                Turnover: 60,
                Comm: 20,
                ClockType: "wheel",
                AddClockType: 2,
                CTime: "2026-03-29 19:20:00",
                SettleTime: "2026-03-29 20:20:00",
              },
            ]
          : String(params.Code ?? "") === "T001"
            ? [
                {
                  PersonCode: "T001",
                  PersonName: "技师甲",
                  SettleNo: "NO-001",
                  HandCardCode: "HC-001",
                  ItemName: "足疗",
                  Count: 2,
                  Turnover: 180,
                  Comm: 70,
                  ClockType: "point",
                  AddClockType: 0,
                  CTime: "2026-03-29 13:20:00",
                  SettleTime: "2026-03-29 14:20:00",
                },
              ]
            : [
                {
                  PersonCode: "T002",
                  PersonName: "技师乙",
                  SettleNo: "NO-003",
                  HandCardCode: "HC-002",
                  ItemName: "修脚",
                  Count: 1,
                  Turnover: 60,
                  Comm: 20,
                  ClockType: "wheel",
                  AddClockType: 2,
                  CTime: "2026-03-29 19:20:00",
                  SettleTime: "2026-03-29 20:20:00",
                },
              ],
      fetchTechMarketList: async () => [
        {
          Id: "MK-001",
          PersonCode: "T001",
          PersonName: "技师甲",
          ItemId: "ITEM-001",
          ItemName: "精油",
          Count: 1,
          AfterDisc: 120,
          Commission: 20,
          SettleTime: "2026-03-29 14:20:00",
          OrgName: "原始门店A",
        },
      ],
      fetchTechCommissionSetList: async () => {
        commissionAttempts += 1;
        if (commissionAttempts < 3) {
          throw new Error("报表高频查询...请稍后再试");
        }
        return [
          {
            ItemId: "ITEM-001",
            ItemName: "足疗",
            PCBaseList: [{ rule: "default", ratio: 0.35 }],
          },
        ];
      },
    };

    await syncHetangStore({
      config,
      store,
      client: fakeClient,
      orgId: "1001",
      now: new Date("2026-03-30T05:10:00+08:00"),
      sleep: async () => {},
    });

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-03-29",
    });

    expect(report.metrics.serviceRevenue).toBe(200);
    expect(report.metrics.rechargeCash).toBe(300);
    expect(report.metrics.storedConsumeAmount).toBe(200);
    expect(report.metrics.totalClockCount).toBe(3);
    expect(report.metrics.activeTechCount).toBe(2);
    expect(report.metrics.pointClockRecordCount).toBe(1);
    expect(report.metrics.pointClockRate).toBe(0.5);
    expect(report.metrics.addClockRecordCount).toBe(1);
    expect(report.metrics.addClockRate).toBe(0.5);
    expect(report.metrics.newMembers).toBe(1);
    expect(report.metrics.sleepingMembers).toBe(1);
    expect(report.complete).toBe(true);
    expect(report.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(report.markdown).toContain("一号店");
    expect(report.markdown).toContain("【技师出勤】");
    expect(report.markdown).toContain("【核心经营】");
    expect(report.markdown).toContain("点钟率");
    expect(report.markdown).toContain("加钟率");
    expect(report.markdown).not.toContain("需补充房间/成本/营销配置");
    expect(commissionAttempts).toBe(3);
    expect(
      (await store.listUserTradesByDate("1001", "2026-03-29")).map((row) => row.tradeNo),
    ).toEqual(["T-001"]);
    expect(await store.listCustomerTechLinks("1001", "2026-03-29")).toEqual([
      expect.objectContaining({
        settleNo: "NO-001",
        customerIdentityKey: "member:M-001",
        customerIdentityType: "member",
        customerDisplayName: "会员甲",
        techCode: "T001",
        techName: "技师甲",
      }),
    ]);
    const rangeStore = store as HetangOpsStore & {
      listCustomerTechLinksByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<Array<{ settleNo?: string; techName: string }>>;
    };
    expect(
      await rangeStore.listCustomerTechLinksByDateRange("1001", "2026-03-29", "2026-03-29"),
    ).toEqual([
      expect.objectContaining({
        settleNo: "NO-001",
        techName: "技师甲",
      }),
    ]);
    expect(await store.listCustomerSegments("1001", "2026-03-29")).toEqual([
      expect.objectContaining({
        customerIdentityKey: "member:M-001",
        customerDisplayName: "会员甲",
        paymentSegment: "member-only",
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("attributes pre-03:00 rows to the prior operational day and keeps 03:10 snapshots on the current day", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();

    const fakeClient = {
      fetchPaged: async (endpoint: string) => {
        switch (endpoint) {
          case "1.1":
            return [
              {
                Id: "M-101",
                Name: "会员夜场",
                OrgId: "1001",
                StoredAmount: 200,
                ConsumeAmount: 600,
                CTime: "2026-03-30 02:10:00",
                LastConsumeTime: "2026-03-30 04:20:00",
                SilentDays: 0,
                Storeds: [{ Id: "CARD-101", CardNo: "YW0101", OrgId: "1001" }],
                OrgName: "原始门店A",
              },
            ];
          case "1.2":
            return [
              {
                SettleId: "S-101",
                SettleNo: "NO-101",
                Pay: 168,
                Consume: 168,
                DiscountAmount: 0,
                OptTime: "2026-03-30 02:30:00",
                IsAnti: 0,
                OrgName: "原始门店A",
              },
            ];
          case "1.3":
            return [
              {
                Id: "R-101",
                Reality: 500,
                Total: 580,
                Donate: 80,
                OptTime: "2026-03-30 01:50:00",
                IsAnti: 0,
                OrgName: "原始门店A",
              },
            ];
          default:
            return [];
        }
      },
      fetchUserTrades: async () => [
        {
          OrgId: "1001",
          OrgName: "原始门店A",
          TradeNo: "T-101",
          OptTime: "2026-03-30 03:20:00",
          CardOptType: "consume",
          ChangeBalance: -168,
          ChangeReality: 0,
          ChangeDonate: 0,
          ChangeIntegral: 0,
          PaymentType: "balance",
          IsAnti: 0,
        },
      ],
      fetchTechList: async () => [
        {
          Code: "T101",
          Name: "技师夜班",
          OrgId: "1001",
          OrgName: "原始门店A",
          IsWork: 1,
          IsJob: 1,
        },
      ],
      fetchTechUpClockList: async () => [
        {
          PersonCode: "T101",
          PersonName: "技师夜班",
          SettleNo: "NO-101",
          HandCardCode: "HC-101",
          ItemName: "足疗",
          Count: 1,
          Turnover: 168,
          Comm: 60,
          ClockType: "point",
          CTime: "2026-03-30 02:40:00",
          SettleTime: "2026-03-30 03:40:00",
        },
      ],
      fetchTechMarketList: async () => [
        {
          Id: "MK-101",
          SettleNo: "NO-101",
          HandCardCode: "HC-101",
          RoomCode: "V09",
          PersonCode: "T101",
          PersonName: "技师夜班",
          ItemId: "ITEM-101",
          ItemName: "精油",
          ItemTypeName: "商品",
          ItemCategory: 3,
          SalesCode: "S-001",
          SalesName: "前台甲",
          Count: 1,
          AfterDisc: 88,
          Commission: 18,
          SettleTime: "2026-03-30 04:10:00",
          OrgName: "原始门店A",
        },
      ],
      fetchTechCommissionSetList: async () => [
        {
          ItemId: "ITEM-101",
          ItemName: "足疗",
          PCBaseList: [{ rule: "night", ratio: 0.36 }],
        },
      ],
    };

    await syncHetangStore({
      config,
      store,
      client: fakeClient,
      orgId: "1001",
      now: new Date("2026-03-30T03:10:00+08:00"),
      sleep: async () => {},
    });

    expect(
      (await store.listConsumeBillsByDate("1001", "2026-03-29")).map((row) => row.settleId),
    ).toEqual(["S-101"]);
    expect(
      (await store.listRechargeBillsByDate("1001", "2026-03-29")).map((row) => row.rechargeId),
    ).toEqual(["R-101"]);
    expect(
      (await store.listUserTradesByDate("1001", "2026-03-30")).map((row) => row.tradeNo),
    ).toEqual(["T-101"]);
    expect(
      (await store.listTechUpClockByDate("1001", "2026-03-30")).map((row) => row.personCode),
    ).toEqual(["T101"]);
    expect(await store.listTechMarketByDate("1001", "2026-03-30")).toEqual([
      expect.objectContaining({
        recordKey: "MK-101",
        settleNo: "NO-101",
        handCardCode: "HC-101",
        roomCode: "V09",
        itemTypeName: "商品",
        itemCategory: 3,
        salesCode: "S-001",
        salesName: "前台甲",
      }),
    ]);

    const memberSnapshot = await pool.query(
      "select biz_date from fact_member_daily_snapshot where org_id = $1 and member_id = $2",
      ["1001", "M-101"],
    );
    expect(memberSnapshot.rows[0]?.biz_date).toBe("2026-03-30");

    const techSnapshot = await pool.query(
      "select biz_date from fact_tech_daily_snapshot where org_id = $1 and tech_code = $2",
      ["1001", "T101"],
    );
    expect(techSnapshot.rows[0]?.biz_date).toBe("2026-03-30");

    const commissionSnapshot = await pool.query(
      "select biz_date from fact_tech_commission_snapshot where org_id = $1 and item_id = $2",
      ["1001", "ITEM-101"],
    );
    expect(commissionSnapshot.rows[0]?.biz_date).toBe("2026-03-30");

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-03-29",
    });
    expect(report.metrics.newMembers).toBe(1);
    expect(report.metrics.serviceRevenue).toBe(168);

    await store.close();
    await pool.end();
  });

  it("derives stored consume from consume-bill member payments when user trades are missing", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();

    const fakeClient = {
      fetchPaged: async (endpoint: string) => {
        switch (endpoint) {
          case "1.1":
            return [
              {
                Id: "M-301",
                Name: "会员混合支付",
                OrgId: "1001",
                StoredAmount: 900,
                ConsumeAmount: 2100,
                CTime: "2026-03-29 10:00:00",
                LastConsumeTime: "2026-03-29 20:30:00",
                SilentDays: 0,
                OrgName: "原始门店A",
              },
            ];
          case "1.2":
            return [
              {
                SettleId: "S-301",
                SettleNo: "NO-301",
                Pay: 260,
                Consume: 260,
                DiscountAmount: 0,
                OptTime: "2026-03-29 18:20:00",
                IsAnti: 0,
                Payments: [
                  { Name: "会员", Amount: 180 },
                  { Name: "微信", Amount: 80 },
                ],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-302",
                SettleNo: "NO-302",
                Pay: 120,
                Consume: 120,
                DiscountAmount: 0,
                OptTime: "2026-03-29 20:10:00",
                IsAnti: 0,
                Payments: [{ Name: "现金", Amount: 120 }],
                OrgName: "原始门店A",
              },
            ];
          case "1.3":
            return [
              {
                Id: "R-301",
                Reality: 300,
                Total: 360,
                Donate: 60,
                OptTime: "2026-03-29 11:00:00",
                IsAnti: 0,
                OrgName: "原始门店A",
              },
            ];
          default:
            return [];
        }
      },
      fetchUserTrades: async () => [],
      fetchTechList: async () => [
        {
          Code: "T301",
          Name: "技师甲",
          OrgId: "1001",
          OrgName: "原始门店A",
          IsWork: 1,
          IsJob: 1,
        },
      ],
      fetchTechUpClockList: async () => [
        {
          PersonCode: "T301",
          PersonName: "技师甲",
          SettleNo: "NO-301",
          HandCardCode: "HC-301",
          ItemName: "足疗",
          Count: 2,
          Turnover: 260,
          Comm: 90,
          ClockType: "point",
          CTime: "2026-03-29 18:20:00",
          SettleTime: "2026-03-29 19:20:00",
        },
      ],
      fetchTechMarketList: async () => [],
      fetchTechCommissionSetList: async () => [
        {
          ItemId: "ITEM-301",
          ItemName: "足疗",
          PCBaseList: [{ rule: "default", ratio: 0.35 }],
        },
      ],
    };

    await syncHetangStore({
      config,
      store,
      client: fakeClient,
      orgId: "1001",
      now: new Date("2026-03-30T03:10:00+08:00"),
      sleep: async () => {},
    });

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-03-29",
    });

    expect(report.metrics.serviceRevenue).toBe(380);
    expect(report.metrics.rechargeCash).toBe(300);
    expect(report.metrics.storedConsumeAmount).toBe(180);
    expect(report.metrics.storedConsumeRate).toBe(0.6);
    expect(report.metrics.memberPaymentAmount).toBe(180);
    expect(report.metrics.memberPaymentShare).toBeCloseTo(180 / 380, 6);
    expect(report.metrics.cashPaymentAmount).toBe(120);
    expect(report.metrics.cashPaymentShare).toBeCloseTo(120 / 380, 6);
    expect(report.metrics.wechatPaymentAmount).toBe(80);
    expect(report.metrics.wechatPaymentShare).toBeCloseTo(80 / 380, 6);

    await store.close();
    await pool.end();
  });

  it("computes daily groupbuy metrics from consume payments and warns on high share", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();

    const fakeClient = {
      fetchPaged: async (endpoint: string) => {
        switch (endpoint) {
          case "1.1":
            return [
              {
                Id: "M-401",
                Name: "团购客",
                OrgId: "1001",
                StoredAmount: 0,
                ConsumeAmount: 300,
                CTime: "2026-03-29 10:00:00",
                LastConsumeTime: "2026-03-29 18:20:00",
                SilentDays: 0,
                OrgName: "原始门店A",
              },
            ];
          case "1.2":
            return [
              {
                SettleId: "S-401",
                SettleNo: "NO-401",
                Pay: 160,
                Consume: 160,
                DiscountAmount: 0,
                OptTime: "2026-03-29 18:20:00",
                IsAnti: 0,
                Payments: [{ Name: "美团", Amount: 160 }],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-402",
                SettleNo: "NO-402",
                Pay: 140,
                Consume: 140,
                DiscountAmount: 0,
                OptTime: "2026-03-29 20:10:00",
                IsAnti: 0,
                Payments: [{ Name: "抖音", Amount: 140 }],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-403",
                SettleNo: "NO-403",
                Pay: 100,
                Consume: 100,
                DiscountAmount: 0,
                OptTime: "2026-03-29 21:30:00",
                IsAnti: 0,
                Payments: [{ Name: "微信", Amount: 100 }],
                OrgName: "原始门店A",
              },
            ];
          case "1.3":
            return [];
          default:
            return [];
        }
      },
      fetchUserTrades: async () => [],
      fetchTechList: async () => [
        {
          Code: "T401",
          Name: "技师甲",
          OrgId: "1001",
          OrgName: "原始门店A",
          IsWork: 1,
          IsJob: 1,
        },
      ],
      fetchTechUpClockList: async () => [
        {
          PersonCode: "T401",
          PersonName: "技师甲",
          SettleNo: "NO-401",
          HandCardCode: "HC-401",
          ItemName: "足疗",
          Count: 3,
          Turnover: 400,
          Comm: 120,
          ClockType: "wheel",
          CTime: "2026-03-29 18:20:00",
          SettleTime: "2026-03-29 22:30:00",
        },
      ],
      fetchTechMarketList: async () => [],
      fetchTechCommissionSetList: async () => [
        {
          ItemId: "ITEM-401",
          ItemName: "足疗",
          PCBaseList: [{ rule: "default", ratio: 0.35 }],
        },
      ],
    };

    await syncHetangStore({
      config,
      store,
      client: fakeClient,
      orgId: "1001",
      now: new Date("2026-03-30T03:10:00+08:00"),
      sleep: async () => {},
    });

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-03-29",
    });

    expect(report.metrics.groupbuyOrderCount).toBe(2);
    expect(report.metrics.groupbuyOrderShare).toBeCloseTo(2 / 3, 6);
    expect(report.metrics.groupbuyAmount).toBe(300);
    expect(report.metrics.groupbuyAmountShare).toBe(0.75);
    expect(report.metrics.groupbuyPlatformBreakdown).toEqual([
      {
        platform: "美团",
        orderCount: 1,
        orderShare: 1 / 3,
        amount: 160,
        amountShare: 0.4,
      },
      {
        platform: "抖音",
        orderCount: 1,
        orderShare: 1 / 3,
        amount: 140,
        amountShare: 0.35,
      },
    ]);
    expect(report.alerts.some((entry) => entry.code === "groupbuy-share-high")).toBe(true);
    expect(report.markdown).toContain("团购订单");
    expect(report.markdown).toContain("团购占比");
    expect(report.markdown).toContain("美团 1 单 / 160.00 元");
    expect(report.markdown).toContain("抖音 1 单 / 140.00 元");

    await store.close();
    await pool.end();
  });

  it("computes business-facing groupbuy conversion funnel metrics from rolling customer history", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();

    const fakeClient = {
      fetchPaged: async (endpoint: string) => {
        switch (endpoint) {
          case "1.1":
            return [
              {
                Id: "MEM-G1",
                Name: "团购客一",
                Phone: "13800000001",
                StoredAmount: 680,
                ConsumeAmount: 1160,
                CTime: "2026-03-25 10:00:00",
                LastConsumeTime: "2026-03-30 20:00:00",
                SilentDays: 0,
                Storeds: [{ Id: "CARD-G1", CardNo: "JY1001", OrgId: "1001" }],
                OrgName: "原始门店A",
              },
            ];
          case "1.2":
            return [
              {
                SettleId: "S-501",
                SettleNo: "NO-501",
                Pay: 99,
                Consume: 99,
                DiscountAmount: 0,
                OptTime: "2026-03-24 12:00:00",
                IsAnti: 0,
                CCode: "G1",
                CName: "团购客一",
                Payments: [{ Name: "美团", Amount: 99 }],
                Infos: ["团购客一 [13800000001],消费99.00元;"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-502",
                SettleNo: "NO-502",
                Pay: 260,
                Consume: 260,
                DiscountAmount: 0,
                OptTime: "2026-03-25 13:00:00",
                IsAnti: 0,
                CCode: "G1",
                CName: "团购客一",
                Payments: [{ Name: "会员", Amount: 260 }],
                Infos: ["团购客一 (金悦卡) [JY1001],消费260.00元;"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-502-2",
                SettleNo: "NO-502-2",
                Pay: 300,
                Consume: 300,
                DiscountAmount: 0,
                OptTime: "2026-03-27 18:30:00",
                IsAnti: 0,
                CCode: "G1",
                CName: "团购客一",
                Payments: [{ Name: "会员", Amount: 300 }],
                Infos: ["团购客一 (金悦卡) [JY1001],消费300.00元;"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-502-3",
                SettleNo: "NO-502-3",
                Pay: 350,
                Consume: 350,
                DiscountAmount: 0,
                OptTime: "2026-03-29 19:30:00",
                IsAnti: 0,
                CCode: "G1",
                CName: "团购客一",
                Payments: [{ Name: "会员", Amount: 350 }],
                Infos: ["团购客一 (金悦卡) [JY1001],消费350.00元;"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-502-4",
                SettleNo: "NO-502-4",
                Pay: 250,
                Consume: 250,
                DiscountAmount: 0,
                OptTime: "2026-03-30 20:00:00",
                IsAnti: 0,
                CCode: "G1",
                CName: "团购客一",
                Payments: [{ Name: "会员", Amount: 250 }],
                Infos: ["团购客一 (金悦卡) [JY1001],消费250.00元;"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-503",
                SettleNo: "NO-503",
                Pay: 120,
                Consume: 120,
                DiscountAmount: 0,
                OptTime: "2026-03-26 14:00:00",
                IsAnti: 0,
                CCode: "G2",
                CName: "团购客二",
                Payments: [{ Name: "抖音", Amount: 120 }],
                Infos: ["团购客二 [13800000002],消费120.00元;"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-504",
                SettleNo: "NO-504",
                Pay: 180,
                Consume: 180,
                DiscountAmount: 0,
                OptTime: "2026-03-30 17:00:00",
                IsAnti: 0,
                CCode: "G2",
                CName: "团购客二",
                Payments: [{ Name: "微信", Amount: 180 }],
                Infos: ["团购客二 [13800000002],消费180.00元;"],
                OrgName: "原始门店A",
              },
              {
                SettleId: "S-505",
                SettleNo: "NO-505",
                Pay: 150,
                Consume: 150,
                DiscountAmount: 0,
                OptTime: "2026-03-30 18:00:00",
                IsAnti: 0,
                CCode: "G3",
                CName: "团购客三",
                Payments: [{ Name: "美团", Amount: 150 }],
                Infos: ["团购客三 [13800000003],消费150.00元;"],
                OrgName: "原始门店A",
              },
            ];
          case "1.3":
            return [
              {
                Id: "RECHARGE-G1",
                Reality: 1000,
                Total: 1000,
                Donate: 0,
                OptTime: "2026-03-25 10:30:00",
                IsAnti: 0,
                MemberName: "团购客一",
                MemberPhone: "13800000001",
                CardNo: "JY1001",
                CardId: "CARD-G1",
                CardTypeName: "金悦卡",
                Payments: [{ Name: "微信", Amount: 1000, PaymentType: 4 }],
              },
            ];
          default:
            return [];
        }
      },
      fetchUserTrades: async () => [],
      fetchTechList: async () => [
        {
          Code: "T501",
          Name: "技师甲",
          OrgId: "1001",
          OrgName: "原始门店A",
          IsWork: 1,
          IsJob: 1,
        },
      ],
      fetchTechUpClockList: async () => [
        {
          PersonCode: "T501",
          PersonName: "技师甲",
          SettleNo: "NO-504",
          HandCardCode: "HC-504",
          ItemName: "足疗",
          Count: 2,
          Turnover: 330,
          Comm: 100,
          ClockType: "wheel",
          CTime: "2026-03-30 17:00:00",
          SettleTime: "2026-03-30 19:00:00",
        },
      ],
      fetchTechMarketList: async () => [],
      fetchTechCommissionSetList: async () => [
        {
          ItemId: "ITEM-501",
          ItemName: "足疗",
          PCBaseList: [{ rule: "default", ratio: 0.35 }],
        },
      ],
    };

    await syncHetangStore({
      config,
      store,
      client: fakeClient,
      orgId: "1001",
      now: new Date("2026-03-31T03:10:00+08:00"),
      sleep: async () => {},
    });

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-03-30",
    });

    expect(report.metrics.groupbuyCohortCustomerCount).toBe(3);
    expect(report.metrics.groupbuyRevisitCustomerCount).toBe(2);
    expect(report.metrics.groupbuyRevisitRate).toBeCloseTo(2 / 3, 6);
    expect(report.metrics.groupbuyMemberPayConvertedCustomerCount).toBe(1);
    expect(report.metrics.groupbuyMemberPayConversionRate).toBeCloseTo(1 / 3, 6);
    expect(report.metrics.groupbuy7dRevisitCustomerCount).toBe(2);
    expect(report.metrics.groupbuy7dRevisitRate).toBeCloseTo(2 / 3, 6);
    expect(report.metrics.groupbuy7dCardOpenedCustomerCount).toBe(1);
    expect(report.metrics.groupbuy7dCardOpenedRate).toBeCloseTo(1 / 3, 6);
    expect(report.metrics.groupbuy7dStoredValueConvertedCustomerCount).toBe(1);
    expect(report.metrics.groupbuy7dStoredValueConversionRate).toBeCloseTo(1 / 3, 6);
    expect(report.metrics.groupbuy30dMemberPayConvertedCustomerCount).toBe(1);
    expect(report.metrics.groupbuy30dMemberPayConversionRate).toBeCloseTo(1 / 3, 6);
    expect(report.metrics.groupbuyFirstOrderCustomerCount).toBe(3);
    expect(report.metrics.groupbuyFirstOrderHighValueMemberCustomerCount).toBe(1);
    expect(report.metrics.groupbuyFirstOrderHighValueMemberRate).toBeCloseTo(1 / 3, 6);
    expect(report.markdown).toContain("7天复到店率");
    expect(report.markdown).toContain("7天开卡率");
    expect(report.markdown).toContain("7天储值转化率");
    expect(report.markdown).toContain("30天会员消费转化率");
    expect(report.markdown).toContain("团购首单客转高价值会员率");

    await store.close();
    await pool.end();
  });

  it("ignores staff CCode/CName fallbacks when groupbuy rows have no customer Infos", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();

    const fakeClient = {
      fetchPaged: async (endpoint: string) => {
        switch (endpoint) {
          case "1.1":
            return [];
          case "1.2":
            return [
              {
                SettleId: "S-601",
                SettleNo: "NO-601",
                Pay: 199,
                Consume: 199,
                DiscountAmount: 0,
                OptTime: "2026-03-30 18:00:00",
                IsAnti: 0,
                CCode: "608",
                CName: "赵敬敬",
                OptCode: "808",
                OptName: "宁宁",
                Payments: [{ Name: "美团", Amount: 199 }],
                Infos: [],
                OrgName: "原始门店A",
              },
            ];
          case "1.3":
            return [];
          default:
            return [];
        }
      },
      fetchUserTrades: async () => [],
      fetchTechList: async () => [],
      fetchTechUpClockList: async () => [],
      fetchTechMarketList: async () => [],
      fetchTechCommissionSetList: async () => [],
    };

    await syncHetangStore({
      config,
      store,
      client: fakeClient,
      orgId: "1001",
      now: new Date("2026-03-31T03:10:00+08:00"),
      sleep: async () => {},
    });

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-03-30",
    });

    expect(report.metrics.groupbuyOrderCount).toBe(1);
    expect(report.metrics.groupbuyCohortCustomerCount).toBe(0);
    expect(report.metrics.groupbuyRevisitCustomerCount).toBe(0);
    expect(report.metrics.groupbuy7dRevisitRate).toBeNull();
    expect(report.metrics.groupbuy7dStoredValueConversionRate).toBeNull();
    expect(report.metrics.groupbuy30dMemberPayConversionRate).toBeNull();

    await store.close();
    await pool.end();
  });

  it("marks a business day incomplete when endpoint watermarks do not cover that operational day", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();

    for (const endpoint of ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"]) {
      await store.setEndpointWatermark({
        orgId: "1001",
        endpoint,
        lastSuccessAt: "2026-03-31T02:24:19.768Z",
      });
    }

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-03-31",
    });

    expect(report.complete).toBe(false);
    expect(report.metrics.incompleteSync).toBe(true);
    expect(report.alerts.some((entry) => entry.code === "data-gap")).toBe(true);

    await store.close();
    await pool.end();
  });

  it("surfaces the real stale endpoint when only user trades 1.4 is behind", async () => {
    const config = buildConfig();
    const db = createTestDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
    });
    await store.initialize();

    for (const endpoint of ["1.1", "1.2", "1.3", "1.5", "1.6", "1.7", "1.8"]) {
      await store.setEndpointWatermark({
        orgId: "1001",
        endpoint,
        lastSuccessAt: "2026-04-13T03:00:34.728+08:00",
      });
    }
    await store.setEndpointWatermark({
      orgId: "1001",
      endpoint: "1.4",
      lastSuccessAt: "2026-04-06T03:10:08.962+08:00",
    });

    const report = await buildDailyStoreReport({
      config,
      store,
      orgId: "1001",
      bizDate: "2026-04-12",
    });

    expect(report.complete).toBe(false);
    expect(report.metrics.incompleteSync).toBe(true);
    expect(report.metrics.staleSyncEndpoints).toEqual(["1.4"]);
    expect(report.alerts).toContainEqual({
      code: "data-gap",
      severity: "critical",
      message: "账户流水 1.4 未更新，正式日报降级。",
    });

    await store.close();
    await pool.end();
  });
});
