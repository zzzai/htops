import { DataType, newDb } from "pg-mem";
import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { HetangOpsStore } from "./store.js";
import { syncHetangStore } from "./sync.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "一号店" },
      { orgId: "1002", storeName: "二号店" },
      { orgId: "1003", storeName: "三号店" },
      { orgId: "1004", storeName: "四号店" },
      { orgId: "1005", storeName: "五号店" },
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

describe("syncHetangStore pacing", () => {
  it("fails fast with a clear error when API credentials are missing", async () => {
    const config = resolveHetangOpsConfig({
      api: {},
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
        { orgId: "1003", storeName: "三号店" },
        { orgId: "1004", storeName: "四号店" },
        { orgId: "1005", storeName: "五号店" },
      ],
    });
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

    await expect(
      syncHetangStore({
        config,
        store,
        orgId: "1001",
        now: new Date("2026-03-31T03:10:00+08:00"),
      }),
    ).rejects.toThrow("Hetang API credentials are not configured");

    await store.close();
    await pool.end();
  });

  it("adds a cool-down gap between heavy technician endpoints", async () => {
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

    const sleep = vi.fn().mockResolvedValue(undefined);
    const fakeClient = {
      fetchPaged: async () => [],
      fetchUserTrades: async () => [],
      fetchTechList: async () => [
        {
          Code: "T001",
          Name: "技师甲",
          OrgId: "1001",
          OrgName: "一号店",
          IsWork: 1,
          IsJob: 1,
        },
      ],
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
      sleep,
    });

    expect(sleep.mock.calls.filter(([ms]) => ms === 15_000)).toHaveLength(3);

    await store.close();
    await pool.end();
  });

  it("uses explicit backfill windows and skips current-state snapshot endpoints", async () => {
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

    const fetchPaged = vi.fn(async (endpoint: string, _request?: Record<string, unknown>) => {
      if (endpoint === "1.1") {
        return [
          {
            Id: "member-001",
            Name: "王先生",
            Phone: "13800000000",
            StoredAmount: 1000,
            ConsumeAmount: 238,
            CTime: "2026-03-01 12:00:00",
            LastConsumeTime: "2026-03-01 22:30:00",
            SilentDays: 0,
            Storeds: [{ Id: "card-001", CardNo: "YW001", OrgId: "1001", Balance: 762 }],
          },
        ];
      }
      return [];
    });
    const fetchUserTrades = vi.fn(async (_request: { Id?: string }) => []);
    const fetchTechList = vi.fn(async () => []);
    const fetchTechUpClockList = vi.fn(async () => []);
    const fetchTechMarketList = vi.fn(async () => []);
    const fetchTechCommissionSetList = vi.fn(async () => []);

    await syncHetangStore({
      config,
      store,
      client: {
        fetchPaged,
        fetchUserTrades,
        fetchTechList,
        fetchTechUpClockList,
        fetchTechMarketList,
        fetchTechCommissionSetList,
      },
      orgId: "1001",
      now: new Date("2026-03-31T09:05:00+08:00"),
      sleep: async () => {},
      syncPlan: {
        mode: "backfill",
        windowOverride: {
          startTime: "2026-03-01 03:00:00",
          endTime: "2026-03-02 02:59:59",
        },
        skipEndpoints: ["1.5", "1.8"],
      },
    });

    expect(fetchPaged.mock.calls.map((call) => call[0])).toEqual(["1.1", "1.2", "1.3"]);
    expect(fetchPaged.mock.calls[0]?.[1]).toMatchObject({
      OrgId: "1001",
      Stime: "2026-03-01 03:00:00",
      Etime: "2026-03-02 02:59:59",
    });
    expect(fetchPaged.mock.calls[1]?.[1]).toMatchObject({
      OrgId: "1001",
      Stime: "2026-03-01 03:00:00",
      Etime: "2026-03-02 02:59:59",
    });
    expect(fetchPaged.mock.calls[2]?.[1]).toMatchObject({
      OrgId: "1001",
      Stime: "2026-03-01 03:00:00",
      Etime: "2026-03-02 02:59:59",
    });
    expect(fetchUserTrades).toHaveBeenNthCalledWith(1, {
      OrgId: "1001",
      Stime: "2026-03-01 03:00:00",
      Etime: "2026-03-02 02:59:59",
      Id: "card-001",
      Type: 1,
    });
    expect(fetchUserTrades).toHaveBeenCalledTimes(11);
    expect(fetchTechList).not.toHaveBeenCalled();
    expect(fetchTechCommissionSetList).not.toHaveBeenCalled();
    expect(fetchTechUpClockList).toHaveBeenCalledWith({
      OrgId: "1001",
      Code: "",
      Stime: "2026-03-01 03:00:00",
      Etime: "2026-03-02 02:59:59",
    });
    expect(fetchTechMarketList).toHaveBeenCalledWith({
      OrgId: "1001",
      Code: "",
      Stime: "2026-03-01 03:00:00",
      Etime: "2026-03-02 02:59:59",
    });

    const syncRuns = await pool.query(
      "select mode from sync_runs where org_id = $1 order by started_at desc limit 1",
      ["1001"],
    );
    expect(syncRuns.rows[0]?.mode).toBe("backfill");

    const memberSnapshots = await pool.query(
      "select count(*)::int as count from fact_member_daily_snapshot where org_id = $1",
      ["1001"],
    );
    const currentMembers = await pool.query(
      "select count(*)::int as count from fact_member_current where org_id = $1",
      ["1001"],
    );
    const currentMemberCards = await pool.query(
      "select count(*)::int as count from fact_member_cards_current where org_id = $1",
      ["1001"],
    );
    const techSnapshots = await pool.query(
      "select count(*)::int as count from fact_tech_daily_snapshot where org_id = $1",
      ["1001"],
    );
    const commissionSnapshots = await pool.query(
      "select count(*)::int as count from fact_tech_commission_snapshot where org_id = $1",
      ["1001"],
    );
    expect(memberSnapshots.rows[0]?.count).toBe(0);
    expect(currentMembers.rows[0]?.count).toBe(1);
    expect(currentMemberCards.rows[0]?.count).toBe(1);
    expect(techSnapshots.rows[0]?.count).toBe(0);
    expect(commissionSnapshots.rows[0]?.count).toBe(0);

    await store.close();
    await pool.end();
  });

  it("defers analytics refresh during endpoint writes and publishes once after the sync batch", async () => {
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
    const upsertConsumeBills = vi.spyOn(store as any, "upsertConsumeBills");
    const upsertRechargeBills = vi.spyOn(store as any, "upsertRechargeBills");
    const upsertTechUpClockRows = vi.spyOn(store as any, "upsertTechUpClockRows");
    const upsertTechMarketRows = vi.spyOn(store as any, "upsertTechMarketRows");
    const publishAnalyticsViews = vi
      .spyOn(store as any, "publishAnalyticsViews")
      .mockResolvedValue("serving-sync-run-1");

    await syncHetangStore({
      config,
      store,
      orgId: "1001",
      now: new Date("2026-03-31T03:10:00+08:00"),
      client: {
        fetchPaged: async (endpoint: string) => {
          if (endpoint === "1.2") {
            return [
              {
                OrgId: "1001",
                SettleId: "SETTLE-001",
                SettleNo: "NO-001",
                Pay: 200,
                Consume: 200,
                DiscountAmount: 0,
                IsAnti: 0,
                OptTime: "2026-03-30 21:00:00",
              },
            ];
          }
          if (endpoint === "1.3") {
            return [
              {
                OrgId: "1001",
                Id: "RECHARGE-001",
                Reality: 300,
                Total: 300,
                Donate: 0,
                IsAnti: 0,
                OptTime: "2026-03-30 21:30:00",
              },
            ];
          }
          return [];
        },
        fetchUserTrades: async () => [],
        fetchTechList: async () => [],
        fetchTechUpClockList: async () => [
          {
            PersonCode: "T001",
            PersonName: "技师甲",
            SettleNo: "NO-001",
            HandCardCode: "CARD-001",
            ItemName: "足疗",
            ClockType: "点钟",
            Count: 1,
            Turnover: 200,
            Comm: 60,
            CTime: "2026-03-30 21:10:00",
            SettleTime: "2026-03-30 21:10:00",
          },
        ],
        fetchTechMarketList: async () => [
          {
            Id: "MARKET-001",
            PersonCode: "T001",
            PersonName: "技师甲",
            ItemId: "ITEM-001",
            ItemName: "精油",
            Count: 1,
            AfterDisc: 88,
            Commission: 20,
            SettleTime: "2026-03-30 21:12:00",
          },
        ],
        fetchTechCommissionSetList: async () => [],
      },
      sleep: async () => {},
      syncPlan: {
        mode: "daily",
        skipEndpoints: ["1.1", "1.4", "1.5", "1.8"],
      },
    });

    expect(upsertConsumeBills).toHaveBeenCalledWith(expect.any(Array), { refreshViews: false });
    expect(upsertRechargeBills).toHaveBeenCalledWith(expect.any(Array), { refreshViews: false });
    expect(upsertTechUpClockRows).toHaveBeenCalledWith(expect.any(Array), { refreshViews: false });
    expect(upsertTechMarketRows).toHaveBeenCalledWith(expect.any(Array), { refreshViews: false });
    expect(publishAnalyticsViews).toHaveBeenCalledTimes(1);
    expect(publishAnalyticsViews).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedAt: "2026-03-30T19:10:00.000Z",
        notes: expect.stringContaining("1001"),
      }),
    );

    await store.close();
    await pool.end();
  });

  it("uses selectedCardIds when provided instead of scanning all member cards", async () => {
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

    await store.upsertMemberCards([
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "NO-001",
        rawJson: JSON.stringify({ Id: "card-001", CardNo: "NO-001" }),
      },
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-002",
        cardNo: "NO-002",
        rawJson: JSON.stringify({ Id: "card-002", CardNo: "NO-002" }),
      },
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-003",
        cardNo: "NO-003",
        rawJson: JSON.stringify({ Id: "card-003", CardNo: "NO-003" }),
      },
    ]);

    const fetchUserTrades = vi.fn(async () => []);

    await syncHetangStore({
      config,
      store,
      client: {
        fetchPaged: vi.fn(async () => []),
        fetchUserTrades,
        fetchTechList: vi.fn(async () => []),
        fetchTechUpClockList: vi.fn(async () => []),
        fetchTechMarketList: vi.fn(async () => []),
        fetchTechCommissionSetList: vi.fn(async () => []),
      },
      orgId: "1001",
      now: new Date("2026-03-31T03:10:00+08:00"),
      sleep: async () => {},
      syncPlan: {
        mode: "daily",
        selectedCardIds: ["card-002"],
        skipEndpoints: ["1.5", "1.6", "1.7", "1.8"],
      },
    });

    expect(fetchUserTrades).toHaveBeenCalledTimes(11);
    expect(
      new Set(
        ((fetchUserTrades.mock.calls as unknown) as Array<[{ Id?: string }]>).map(
          (call) => call[0]?.Id,
        ),
      ),
    ).toEqual(
      new Set(["card-002"]),
    );

    await store.close();
    await pool.end();
  });

  it("skips outbound user-trade calls when selectedCardIds is empty", async () => {
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

    await store.upsertMemberCards([
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "NO-001",
        rawJson: JSON.stringify({ Id: "card-001", CardNo: "NO-001" }),
      },
    ]);

    const fetchUserTrades = vi.fn(async (_request: { Id?: string }) => []);

    await expect(
      syncHetangStore({
        config,
        store,
        client: {
          fetchPaged: vi.fn(async () => []),
          fetchUserTrades,
          fetchTechList: vi.fn(async () => []),
          fetchTechUpClockList: vi.fn(async () => []),
          fetchTechMarketList: vi.fn(async () => []),
          fetchTechCommissionSetList: vi.fn(async () => []),
        },
        orgId: "1001",
        now: new Date("2026-03-31T03:10:00+08:00"),
        sleep: async () => {},
        syncPlan: {
          mode: "daily",
          selectedCardIds: [],
          skipEndpoints: ["1.5", "1.6", "1.7", "1.8"],
        },
      }),
    ).resolves.toBeUndefined();

    expect(fetchUserTrades).not.toHaveBeenCalled();

    await store.close();
    await pool.end();
  });

  it("does not add technician cool-downs when only one technician endpoint is scheduled", async () => {
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

    const sleep = vi.fn().mockResolvedValue(undefined);

    await syncHetangStore({
      config,
      store,
      client: {
        fetchPaged: vi.fn(async () => []),
        fetchUserTrades: vi.fn(async () => []),
        fetchTechList: vi.fn(async () => []),
        fetchTechUpClockList: vi.fn(async () => []),
        fetchTechMarketList: vi.fn(async () => []),
        fetchTechCommissionSetList: vi.fn(async () => []),
      },
      orgId: "1001",
      now: new Date("2026-03-31T03:10:00+08:00"),
      sleep,
      syncPlan: {
        mode: "daily",
        skipEndpoints: ["1.1", "1.2", "1.3", "1.4", "1.5", "1.7", "1.8"],
      },
    });

    expect(sleep.mock.calls.filter(([ms]) => ms === 15_000)).toHaveLength(0);

    await store.close();
    await pool.end();
  });

  it("does not look up technician codes when all technician endpoints are skipped", async () => {
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

    const listActiveTechCodes = vi
      .spyOn(store, "listActiveTechCodes")
      .mockRejectedValue(new Error("technician lookup should be skipped"));
    const fetchPaged = vi.fn(async (_endpoint: string, _request?: Record<string, unknown>) => []);

    await expect(
      syncHetangStore({
        config,
        store,
        client: {
          fetchPaged,
          fetchUserTrades: vi.fn(async () => []),
          fetchTechList: vi.fn(async () => []),
          fetchTechUpClockList: vi.fn(async () => []),
          fetchTechMarketList: vi.fn(async () => []),
          fetchTechCommissionSetList: vi.fn(async () => []),
        },
        orgId: "1001",
        now: new Date("2026-03-31T03:10:00+08:00"),
        sleep: async () => {},
        syncPlan: {
          mode: "daily",
          skipEndpoints: ["1.4", "1.5", "1.6", "1.7", "1.8"],
        },
      }),
    ).resolves.toBeUndefined();

    expect((fetchPaged.mock.calls as Array<[string, Record<string, unknown>?]>).map((call) => call[0])).toEqual([
      "1.1",
      "1.2",
      "1.3",
    ]);
    expect(listActiveTechCodes).not.toHaveBeenCalled();

    const syncRuns = await pool.query(
      "select status, finished_at from sync_runs where org_id = $1 order by started_at desc limit 1",
      ["1001"],
    );
    expect(syncRuns.rows[0]?.status).toBe("success");
    expect(syncRuns.rows[0]?.finished_at).toBeTruthy();

    await store.close();
    await pool.end();
  });

  it("marks sync runs failed when an unexpected error happens between endpoint steps", async () => {
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

    const sleep = vi.fn().mockRejectedValue(new Error("pace boom"));

    await expect(
      syncHetangStore({
        config,
        store,
        client: {
          fetchPaged: vi.fn(async () => []),
          fetchUserTrades: vi.fn(async () => []),
          fetchTechList: vi.fn(async () => []),
          fetchTechUpClockList: vi.fn(async () => []),
          fetchTechMarketList: vi.fn(async () => []),
          fetchTechCommissionSetList: vi.fn(async () => []),
        },
        orgId: "1001",
        now: new Date("2026-03-31T03:10:00+08:00"),
        sleep,
        syncPlan: {
          mode: "daily",
          skipEndpoints: ["1.4"],
        },
      }),
    ).rejects.toThrow("pace boom");

    const syncRuns = await pool.query(
      "select status, finished_at, details_json from sync_runs where org_id = $1 order by started_at desc limit 1",
      ["1001"],
    );
    expect(syncRuns.rows[0]?.status).toBe("failed");
    expect(syncRuns.rows[0]?.finished_at).toBeTruthy();
    expect(syncRuns.rows[0]?.details_json).toBeTruthy();

    await store.close();
    await pool.end();
  });

  it("reclaims superseded running sync runs for the same store and mode before starting a replacement run", async () => {
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

    const originalSyncRunId = await store.beginSyncRun({
      orgId: "1001",
      mode: "daily",
      startedAt: "2026-03-30T18:58:35.583Z",
    });

    await syncHetangStore({
      config,
      store,
      client: {
        fetchPaged: vi.fn(async () => []),
        fetchUserTrades: vi.fn(async () => []),
        fetchTechList: vi.fn(async () => []),
        fetchTechUpClockList: vi.fn(async () => []),
        fetchTechMarketList: vi.fn(async () => []),
        fetchTechCommissionSetList: vi.fn(async () => []),
      },
      orgId: "1001",
      now: new Date("2026-03-31T03:10:00+08:00"),
      sleep: async () => {},
      syncPlan: {
        mode: "daily",
        skipEndpoints: ["1.4"],
      },
    });

    const syncRuns = await pool.query(
      `
        select sync_run_id, status, finished_at, details_json
        from sync_runs
        where org_id = $1
        order by started_at asc
      `,
      ["1001"],
    );
    expect(syncRuns.rows).toHaveLength(2);
    expect(syncRuns.rows[0]?.sync_run_id).toBe(originalSyncRunId);
    expect(syncRuns.rows[0]?.status).toBe("failed");
    expect(syncRuns.rows[0]?.finished_at).toBe("2026-03-30T19:10:00.000Z");
    expect(JSON.parse(String(syncRuns.rows[0]?.details_json ?? "{}"))).toMatchObject({
      reclaimedAsSuperseded: true,
      supersededByMode: "daily",
    });
    expect(syncRuns.rows[1]?.status).toBe("success");

    await store.close();
    await pool.end();
  });
});
