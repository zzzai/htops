import { DataType, newDb as createBaseDb } from "pg-mem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCustomerConversionCohorts,
  buildCustomerSegments,
  buildCustomerTechServiceLinks,
} from "./customer-intelligence.js";
import { resolveServingCapability } from "./capability-registry.js";
import type { QueryPlan } from "./query-plan.js";
import { compileServingQuery } from "./sql-compiler.js";
import { HetangOpsStore } from "./store.js";
import { shiftBizDate } from "./time.js";
import type { StoreSummary30dRow } from "./types.js";

function newDb() {
  const db = createBaseDb();
  const heldLocks = new Set<number>();
  db.public.registerFunction({
    name: "pg_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      heldLocks.add(Number(lockKey));
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_try_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      const normalized = Number(lockKey);
      if (heldLocks.has(normalized)) {
        return false;
      }
      heldLocks.add(normalized);
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => heldLocks.delete(Number(lockKey)),
  });
  db.public.registerFunction({
    name: "nullif",
    args: [DataType.float, DataType.integer],
    returns: DataType.float,
    implementation: (left: number, right: number) => (left === right ? null : left),
  });
  db.public.registerFunction({
    name: "nullif",
    args: [DataType.integer, DataType.integer],
    returns: DataType.integer,
    implementation: (left: number, right: number) => (left === right ? null : left),
  });
  db.public.registerFunction({
    name: "round",
    args: [DataType.float, DataType.integer],
    returns: DataType.float,
    implementation: (value: number, precision: number) => {
      const scale = 10 ** precision;
      return Math.round(value * scale) / scale;
    },
  });
  db.public.registerFunction({
    name: "right",
    args: [DataType.text, DataType.integer],
    returns: DataType.text,
    implementation: (value: string, count: number) =>
      typeof value === "string" ? value.slice(-Math.max(0, Number(count))) : "",
  });
  return db;
}

describe("HetangOpsStore", () => {
  it("recomputes member repurchase rates from counts when view rows are truncated", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [
            {
              org_id: "1001",
              window_end_biz_date: "2026-04-04",
              store_name: "一号店",
              revenue_30d: 1000,
              order_count_30d: 20,
              customer_count_30d: 18,
              total_clocks_30d: 40,
              clock_effect_30d: 25,
              average_ticket_30d: 50,
              point_clock_rate_30d: 0.4,
              add_clock_rate_30d: 0.2,
              recharge_cash_30d: 500,
              stored_consume_amount_30d: 600,
              stored_consume_rate_30d: 1.2,
              on_duty_tech_count_30d: 4,
              groupbuy_order_share_30d: 0.3,
              groupbuy_cohort_customer_count: 10,
              groupbuy_7d_revisit_customer_count: 8,
              groupbuy_7d_revisit_rate: 0.8,
              groupbuy_7d_card_opened_customer_count: 0,
              groupbuy_7d_card_opened_rate: 0,
              groupbuy_7d_stored_value_converted_customer_count: 0,
              groupbuy_7d_stored_value_conversion_rate: 0,
              groupbuy_30d_member_pay_converted_customer_count: 0,
              groupbuy_30d_member_pay_conversion_rate: 0,
              groupbuy_first_order_customer_count: 5,
              groupbuy_first_order_high_value_member_customer_count: 1,
              groupbuy_first_order_high_value_member_rate: 0.2,
              effective_members: 30,
              sleeping_members: 3,
              sleeping_member_rate: 0.1,
              new_members_30d: 2,
              active_tech_count_30d: 3,
              current_stored_balance: 1200,
              stored_balance_life_months: 2,
              renewal_pressure_index_30d: 1.2,
              member_repurchase_base_customer_count_7d: 9,
              member_repurchase_returned_customer_count_7d: 2,
              member_repurchase_rate_7d: 0,
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              org_id: "1001",
              window_end_biz_date: "2026-04-04",
              store_name: "一号店",
              revenue_7d: 300,
              order_count_7d: 7,
              customer_count_7d: 6,
              total_clocks_7d: 11,
              clock_effect_7d: 27.2,
              average_ticket_7d: 42.8,
              point_clock_rate_7d: 0.36,
              add_clock_rate_7d: 0.18,
              recharge_cash_7d: 90,
              stored_consume_amount_7d: 120,
              stored_consume_rate_7d: 1.33,
              on_duty_tech_count_7d: 3,
              groupbuy_order_share_7d: 0.4,
              groupbuy_cohort_customer_count: 6,
              groupbuy_7d_revisit_customer_count: 4,
              groupbuy_7d_revisit_rate: 0.6667,
              groupbuy_7d_card_opened_customer_count: 0,
              groupbuy_7d_card_opened_rate: 0,
              groupbuy_7d_stored_value_converted_customer_count: 0,
              groupbuy_7d_stored_value_conversion_rate: 0,
              groupbuy_30d_member_pay_converted_customer_count: 0,
              groupbuy_30d_member_pay_conversion_rate: 0,
              groupbuy_first_order_customer_count: 4,
              groupbuy_first_order_high_value_member_customer_count: 1,
              groupbuy_first_order_high_value_member_rate: 0.25,
              effective_members: 30,
              sleeping_members: 3,
              sleeping_member_rate: 0.1,
              new_members_7d: 1,
              active_tech_count_7d: 3,
              current_stored_balance: 1200,
              stored_balance_life_months: 2,
              renewal_pressure_index_30d: 1.2,
              member_repurchase_base_customer_count_7d: 5,
              member_repurchase_returned_customer_count_7d: 3,
              member_repurchase_rate_7d: 0,
            },
          ],
        }),
    };
    const store = new HetangOpsStore({
      pool: pool as never,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await expect(
      store.listStoreSummary30dByDateRange("1001", "2026-04-04", "2026-04-04"),
    ).resolves.toEqual([
      expect.objectContaining({
        customerCount30d: 18,
        memberRepurchaseBaseCustomerCount7d: 9,
        memberRepurchaseReturnedCustomerCount7d: 2,
        memberRepurchaseRate7d: 2 / 9,
      } satisfies Partial<StoreSummary30dRow>),
    ]);

    await expect(
      store.listStoreReview7dByDateRange("1001", "2026-04-04", "2026-04-04"),
    ).resolves.toEqual([
      expect.objectContaining({
        customerCount7d: 6,
        memberRepurchaseBaseCustomerCount7d: 5,
        memberRepurchaseReturnedCustomerCount7d: 3,
        memberRepurchaseRate7d: 3 / 5,
      }),
    ]);
  });

  it("initializes PostgreSQL schema and keeps raw/fact writes idempotent", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();
    expect(await store.tableExists("dim_store")).toBe(true);

    await store.recordRawRows({
      endpoint: "1.2",
      orgId: "1001",
      batchId: "batch-1",
      fetchedAt: "2026-03-30T03:10:00+08:00",
      rows: [
        {
          SettleId: "S-001",
          SettleNo: "NO-001",
          Pay: 200,
          OptTime: "2026-03-29 13:20:00",
          OrgName: "原始门店名",
        },
        {
          SettleId: "S-001",
          SettleNo: "NO-001",
          Pay: 200,
          OptTime: "2026-03-29 13:20:00",
          OrgName: "原始门店名",
        },
      ],
    });

    await store.upsertConsumeBills([
      {
        orgId: "1001",
        settleId: "S-001",
        settleNo: "NO-001",
        payAmount: 200,
        consumeAmount: 200,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-29 13:20:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ SettleId: "S-001" }),
      },
      {
        orgId: "1001",
        settleId: "S-001",
        settleNo: "NO-001",
        payAmount: 200,
        consumeAmount: 200,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-29 13:20:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ SettleId: "S-001" }),
      },
    ]);

    expect(await store.countRows("raw_api_rows")).toBe(1);
    expect(await store.countRows("fact_consume_bills")).toBe(1);
    expect(await store.getRawRowSeenCount("1.2", "1001", "S-001")).toBe(2);

    await store.setEndpointWatermark({
      orgId: "1001",
      endpoint: "1.2",
      lastSuccessAt: "2026-03-30T03:10:00+08:00",
    });
    expect(await store.getEndpointWatermark("1001", "1.2")).toBe("2026-03-30T03:10:00+08:00");

    await store.close();
    await pool.end();
  });

  it("initializes without forcing analytics rebuild when readiness checks already pass", async () => {
    const poolQuery = vi.fn().mockResolvedValue({ rows: [] });
    const advisoryClientQuery = vi.fn(async (sql: string) => {
      const text = String(sql);
      if (text.includes("pg_advisory_lock") || text.includes("pg_advisory_unlock")) {
        return { rows: [{ locked: true }] };
      }
      return { rows: [] };
    });
    const advisoryClientRelease = vi.fn();
    const connect = vi.fn(async () => ({
      query: advisoryClientQuery,
      release: advisoryClientRelease,
    }));
    const store = new HetangOpsStore({
      pool: {
        query: poolQuery,
        connect,
      } as never,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const ensureAnalyticsViewsReady = vi
      .spyOn(store as any, "ensureAnalyticsViewsReady")
      .mockResolvedValue(undefined);
    const rebuildAnalyticsViews = vi
      .spyOn(store as any, "rebuildAnalyticsViews")
      .mockResolvedValue(undefined);

    await store.initialize();

    expect(ensureAnalyticsViewsReady).toHaveBeenCalledTimes(1);
    expect(rebuildAnalyticsViews).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(advisoryClientRelease).toHaveBeenCalledTimes(1);
  });

  it("persists environment memory holiday and snapshot records", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.upsertHolidayCalendarDay({
      bizDate: "2026-04-26",
      holidayTag: "adjusted_workday",
      holidayName: "劳动节调休上班",
      isAdjustedWorkday: true,
      sourceVersion: "state-council-2026-v1",
      sourceLabel: "state-council",
      rawJson: JSON.stringify({ notice: "劳动节调休" }),
      updatedAt: "2026-04-23T10:00:00.000Z",
    });

    await expect(store.getHolidayCalendarDay("2026-04-26")).resolves.toEqual(
      expect.objectContaining({
        bizDate: "2026-04-26",
        holidayTag: "adjusted_workday",
        holidayName: "劳动节调休上班",
        isAdjustedWorkday: true,
      }),
    );

    await store.upsertStoreEnvironmentDailySnapshot({
      orgId: "1001",
      bizDate: "2026-04-26",
      weekdayIndex: 0,
      weekdayLabel: "周日",
      isWeekend: true,
      holidayTag: "adjusted_workday",
      holidayName: "劳动节调休上班",
      isAdjustedWorkday: true,
      seasonTag: "spring",
      monthTag: "04",
      solarTerm: "guyu",
      weatherConditionRaw: "暴雨",
      temperatureC: 13,
      precipitationMm: 28,
      windLevel: 7,
      weatherTag: "storm",
      temperatureBand: "cool",
      precipitationTag: "heavy",
      windTag: "high",
      badWeatherTouchPenalty: "high",
      postDinnerLeisureBias: "medium",
      eveningOutingLikelihood: "low",
      environmentDisturbanceLevel: "high",
      narrativePolicy: "mention",
      snapshotJson: JSON.stringify({ source: "test" }),
      sourceJson: JSON.stringify({ weatherProvider: "mock" }),
      collectedAt: "2026-04-27T03:00:00.000Z",
      updatedAt: "2026-04-27T03:00:00.000Z",
    });

    await store.upsertStoreEnvironmentDailySnapshot({
      orgId: "1001",
      bizDate: "2026-04-26",
      weekdayIndex: 0,
      weekdayLabel: "周日",
      isWeekend: true,
      holidayTag: "holiday",
      holidayName: "劳动节假期",
      isAdjustedWorkday: false,
      seasonTag: "spring",
      monthTag: "04",
      solarTerm: "guyu",
      weatherConditionRaw: "大雨",
      temperatureC: 14,
      precipitationMm: 18,
      windLevel: 5,
      weatherTag: "rain",
      temperatureBand: "cool",
      precipitationTag: "heavy",
      windTag: "medium",
      badWeatherTouchPenalty: "high",
      postDinnerLeisureBias: "medium",
      eveningOutingLikelihood: "low",
      environmentDisturbanceLevel: "high",
      narrativePolicy: "mention",
      snapshotJson: JSON.stringify({ source: "overwrite" }),
      sourceJson: JSON.stringify({ weatherProvider: "mock-v2" }),
      collectedAt: "2026-04-27T04:00:00.000Z",
      updatedAt: "2026-04-27T04:00:00.000Z",
    });

    await store.upsertStoreEnvironmentDailySnapshot({
      orgId: "1001",
      bizDate: "2026-04-25",
      weekdayIndex: 6,
      weekdayLabel: "周六",
      isWeekend: true,
      holidayTag: "weekend",
      seasonTag: "spring",
      monthTag: "04",
      solarTerm: "guyu",
      weatherConditionRaw: "多云",
      temperatureC: 19,
      precipitationMm: 0,
      windLevel: 2,
      weatherTag: "cloudy",
      temperatureBand: "mild",
      precipitationTag: "none",
      windTag: "low",
      badWeatherTouchPenalty: "low",
      postDinnerLeisureBias: "medium",
      eveningOutingLikelihood: "medium",
      environmentDisturbanceLevel: "low",
      narrativePolicy: "suppress",
      snapshotJson: JSON.stringify({ source: "older" }),
      sourceJson: JSON.stringify({ weatherProvider: "mock" }),
      collectedAt: "2026-04-26T03:00:00.000Z",
      updatedAt: "2026-04-26T03:00:00.000Z",
    });

    await expect(store.getStoreEnvironmentDailySnapshot("1001", "2026-04-26")).resolves.toEqual(
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-04-26",
        holidayTag: "holiday",
        holidayName: "劳动节假期",
        weatherTag: "rain",
        narrativePolicy: "mention",
        sourceJson: JSON.stringify({ weatherProvider: "mock-v2" }),
      }),
    );

    await expect(store.listStoreEnvironmentDailySnapshots("1001", 2)).resolves.toEqual([
      expect.objectContaining({
        bizDate: "2026-04-26",
        holidayTag: "holiday",
      }),
      expect.objectContaining({
        bizDate: "2026-04-25",
        holidayTag: "weekend",
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("can skip analytics refresh for batched consume-bill imports", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      refreshAnalyticsViews: () => Promise<void>;
      upsertConsumeBills: (
        rows: Array<Record<string, unknown>>,
        options?: { refreshViews?: boolean },
      ) => Promise<void>;
    };
    const refreshSpy = vi.spyOn(analyticsStore as never, "refreshAnalyticsViews");

    await store.initialize();

    await analyticsStore.upsertConsumeBills(
      [
        {
          orgId: "1001",
          settleId: "SETTLE-BATCH-1",
          settleNo: "NO-BATCH-1",
          payAmount: 188,
          consumeAmount: 188,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-04-10 21:00:00",
          bizDate: "2026-04-10",
          rawJson: JSON.stringify({ SettleId: "SETTLE-BATCH-1" }),
        },
      ],
      { refreshViews: false },
    );

    expect(await store.countRows("fact_consume_bills")).toBe(1);
    expect(refreshSpy).not.toHaveBeenCalled();

    await store.close();
    await pool.end();
  });

  it("publishes deferred analytics writes in a single explicit batch", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      publishAnalyticsViews: (params?: {
        publishedAt?: string;
        notes?: string;
        servingVersion?: string;
      }) => Promise<string | null>;
      upsertConsumeBills: (
        rows: Array<Record<string, unknown>>,
        options?: { refreshViews?: boolean },
      ) => Promise<void>;
    };
    await store.initialize();
    await analyticsStore.upsertConsumeBills(
      [
        {
          orgId: "1001",
          settleId: "SETTLE-PUBLISH-1",
          settleNo: "NO-PUBLISH-1",
          payAmount: 268,
          consumeAmount: 268,
          discountAmount: 0,
          antiFlag: false,
          optTime: "2026-04-10 21:10:00",
          bizDate: "2026-04-10",
          rawJson: JSON.stringify({ SettleId: "SETTLE-PUBLISH-1" }),
        },
      ],
      { refreshViews: false },
    );
    const initialServingVersion = await store.getCurrentServingVersion();
    const publishedAt = new Date(Date.now() + 60_000).toISOString();

    const servingVersion = await analyticsStore.publishAnalyticsViews({
      publishedAt,
      notes: "nightly batch publish",
    });

    expect(typeof servingVersion).toBe("string");
    expect(servingVersion).not.toBe(initialServingVersion);
    await expect(store.getCurrentServingVersion()).resolves.toBe(servingVersion);

    await store.close();
    await pool.end();
  });

  it("publishes a serving version when an immediate analytics mutation refreshes views", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      upsertConsumeBills: (
        rows: Array<Record<string, unknown>>,
        options?: { refreshViews?: boolean },
      ) => Promise<void>;
    };
    await store.initialize();
    const initialServingVersion = await store.getCurrentServingVersion();

    await analyticsStore.upsertConsumeBills([
      {
        orgId: "1001",
        settleId: "SETTLE-AUTO-PUBLISH-1",
        settleNo: "NO-AUTO-PUBLISH-1",
        payAmount: 199,
        consumeAmount: 199,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-04-10 20:10:00",
        bizDate: "2026-04-10",
        rawJson: JSON.stringify({ SettleId: "SETTLE-AUTO-PUBLISH-1" }),
      },
    ]);

    const servingVersion = await store.getCurrentServingVersion();
    expect(servingVersion).not.toBe(initialServingVersion);
    expect(servingVersion).toMatch(/^serving-/u);

    await store.close();
    await pool.end();
  });

  it("creates serving manifest storage and can execute compiled serving queries", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();
    expect(await store.tableExists("serving_manifest")).toBe(true);
    const publishedAt = new Date(Date.now() + 60_000).toISOString();

    await pool.query(
      `
        INSERT INTO mart_daily_store_metrics (org_id, biz_date, metrics_json, updated_at)
        VALUES ($1, $2, $3, $4)
      `,
      [
        "1001",
        "2026-04-07",
        JSON.stringify({
          orgId: "1001",
          storeName: "一号店",
          bizDate: "2026-04-07",
          serviceRevenue: 3200,
          averageTicket: 200,
          clockEffect: 80,
          pointClockRate: 0.5,
        }),
        "2026-04-08T03:30:00.000Z",
      ],
    );

    await store.publishServingManifest("serving-v1", publishedAt, "nightly publish");
    await expect(store.getCurrentServingVersion()).resolves.toBe("serving-v1");

    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-day",
      entity: "store",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
        access_scope_kind: "manager",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
      action: "summary",
      metrics: ["serviceRevenue"],
      dimensions: [],
      filters: [],
      response_shape: "scalar",
      planner_meta: {
        confidence: 1,
        source: "rule",
        normalized_question: "一号店昨天营收多少",
        clarification_needed: false,
      },
    };
    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });
    const rows = await store.executeCompiledServingQuery(compiled.sql, compiled.params);

    expect(rows).toEqual([
      expect.objectContaining({
        org_id: "1001",
        biz_date: "2026-04-07",
        store_name: "一号店",
        service_revenue: 3200,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("serializes concurrent initialize callers behind one readiness check and a database advisory lock", async () => {
    let releaseReadinessCheck: (() => void) | undefined;
    const readinessGate = new Promise<void>((resolve) => {
      releaseReadinessCheck = resolve;
    });
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(async () => ({
        query: clientQuery,
        release: vi.fn(),
      })),
    };
    const store = new HetangOpsStore({
      pool: pool as never,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const readinessStore = store as unknown as {
      ensureAnalyticsViewsReady: () => Promise<void>;
    };
    const ensureAnalyticsViewsReady = vi.fn(async () => {
      await readinessGate;
    });
    readinessStore.ensureAnalyticsViewsReady = ensureAnalyticsViewsReady;

    const first = store.initialize();
    const second = store.initialize();
    await vi.waitFor(() => {
      expect(ensureAnalyticsViewsReady).toHaveBeenCalledTimes(1);
    });

    releaseReadinessCheck?.();
    await Promise.all([first, second]);

    expect(ensureAnalyticsViewsReady).toHaveBeenCalledTimes(1);
    const statements = pool.query.mock.calls.map((call) => String(call[0]));
    const lockStatements = clientQuery.mock.calls.map((call) => String(call[0]));
    expect(lockStatements.some((statement) => statement.includes("pg_advisory_lock"))).toBe(true);
    expect(lockStatements.some((statement) => statement.includes("pg_advisory_unlock"))).toBe(true);
    expect(statements.some((statement) => statement.includes("CREATE TABLE IF NOT EXISTS dim_store"))).toBe(true);
  });

  it("takes a dedicated advisory lock around analytics rebuilds", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn(async () => ({
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      })),
    };
    const store = new HetangOpsStore({
      pool: pool as never,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    }) as unknown as {
      initialized: boolean;
      analyticsViewMode: "materialized" | "plain";
      acquireAdvisoryLock: (lockKey: number) => Promise<boolean>;
      releaseAdvisoryLock: (lockKey: number) => Promise<void>;
      rebuildAnalyticsViews: () => Promise<void>;
      rebuildAnalyticsViewsForMode: (mode: "materialized" | "plain") => Promise<void>;
    };

    store.initialized = true;
    store.analyticsViewMode = "materialized";
    const acquireAdvisoryLock = vi
      .spyOn(store, "acquireAdvisoryLock")
      .mockResolvedValue(true);
    const releaseAdvisoryLock = vi
      .spyOn(store, "releaseAdvisoryLock")
      .mockResolvedValue(undefined);
    store.rebuildAnalyticsViewsForMode = vi.fn().mockResolvedValue(undefined);

    await store.rebuildAnalyticsViews();

    expect(acquireAdvisoryLock).toHaveBeenCalledTimes(1);
    expect(releaseAdvisoryLock).toHaveBeenCalledTimes(1);
  });

  it("persists current member card ids for account-flow sync", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const cardStore = store as unknown as {
      upsertMemberCards: (
        rows: Array<{
          orgId: string;
          memberId: string;
          cardId: string;
          cardNo?: string;
          rawJson: string;
        }>,
      ) => Promise<void>;
      listMemberCardIds: (orgId: string) => Promise<string[]>;
    };

    await store.initialize();
    await cardStore.upsertMemberCards([
      {
        orgId: "1001",
        memberId: "M-001",
        cardId: "CARD-001",
        cardNo: "YW0001",
        rawJson: JSON.stringify({ Id: "CARD-001" }),
      },
      {
        orgId: "1001",
        memberId: "M-001",
        cardId: "CARD-001",
        cardNo: "YW0001",
        rawJson: JSON.stringify({ Id: "CARD-001" }),
      },
      {
        orgId: "1001",
        memberId: "M-002",
        cardId: "CARD-002",
        cardNo: "YW0002",
        rawJson: JSON.stringify({ Id: "CARD-002" }),
      },
    ]);

    expect(await cardStore.listMemberCardIds("1001")).toEqual(["CARD-001", "CARD-002"]);

    await store.close();
    await pool.end();
  });

  it("stores daily member-card snapshots as first-class history rows", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const cardStore = store as unknown as {
      snapshotMemberCards: (
        bizDate: string,
        rows: Array<{
          orgId: string;
          memberId: string;
          cardId: string;
          cardNo?: string;
          rawJson: string;
        }>,
      ) => Promise<void>;
      listMemberCardDailySnapshotsByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<
        Array<{
          bizDate: string;
          memberId: string;
          cardId: string;
          cardNo?: string;
        }>
      >;
    };

    await store.initialize();
    await cardStore.snapshotMemberCards("2026-04-07", [
      {
        orgId: "1001",
        memberId: "M-001",
        cardId: "CARD-001",
        cardNo: "YW0001",
        rawJson: JSON.stringify({ Id: "CARD-001", CardNo: "YW0001" }),
      },
    ]);

    await expect(
      cardStore.listMemberCardDailySnapshotsByDateRange("1001", "2026-04-07", "2026-04-07"),
    ).resolves.toEqual([
      expect.objectContaining({
        bizDate: "2026-04-07",
        memberId: "M-001",
        cardId: "CARD-001",
        cardNo: "YW0001",
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("refreshes analytics views in place when the serving relations already exist", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ exists: true }] }),
    };
    const store = new HetangOpsStore({
      pool: pool as never,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    (store as unknown as { initialized: boolean }).initialized = true;
    (store as unknown as { analyticsViewMode: "materialized" | "plain" }).analyticsViewMode =
      "materialized";

    await store.forceRebuildAnalyticsViews();

    const statements = pool.query.mock.calls.map((call) => String(call[0]));
    expect(statements.some((statement) => statement.includes("REFRESH MATERIALIZED VIEW"))).toBe(true);
    expect(statements.some((statement) => statement.includes("DROP VIEW"))).toBe(false);
    expect(
      statements.some((statement) => statement.includes("DROP MATERIALIZED VIEW IF EXISTS mv_store_review_7d")),
    ).toBe(false);
  });

  it("publishes a serving version when analytics views are force rebuilt", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();
    const initialServingVersion = await store.getCurrentServingVersion();
    expect(initialServingVersion).toMatch(/^serving-/u);

    await store.forceRebuildAnalyticsViews();

    const servingVersion = await store.getCurrentServingVersion();
    expect(servingVersion).not.toBe(initialServingVersion);
    expect(servingVersion).toMatch(/^serving-/u);

    await store.close();
    await pool.end();
  });

  it("projects daily KPI rows from a stable SQL surface", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      upsertTechUpClockRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
      listStoreManagerDailyKpiByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<
        Array<{
          bizDate: string;
          orgId: string;
          storeName: string;
          dailyActualRevenue: number;
          dailyCardConsume: number;
          dailyOrderCount: number;
          totalClocks: number;
          assignClocks: number;
          queueClocks: number;
          pointClockRate: number | null;
          averageTicket?: number | null;
          clockEffect?: number | null;
        }>
      >;
    };

    await store.initialize();
    await store.upsertConsumeBills([
      {
        orgId: "1001",
        settleId: "SETTLE-1",
        settleNo: "NO-1",
        payAmount: 300,
        consumeAmount: 420,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-29 13:20:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ SettleId: "SETTLE-1" }),
      },
      {
        orgId: "1001",
        settleId: "SETTLE-2",
        settleNo: "NO-2",
        payAmount: 180,
        consumeAmount: 180,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-29 15:20:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ SettleId: "SETTLE-2" }),
      },
    ]);
    await analyticsStore.upsertTechUpClockRows([
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-1",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-1",
        itemName: "足疗",
        clockType: "点钟",
        count: 1,
        turnover: 300,
        comm: 80,
        settleTime: "2026-03-29 13:30:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ ClockType: "点钟" }),
      },
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-2",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-2",
        itemName: "推拿",
        clockType: "排钟",
        count: 1,
        turnover: 180,
        comm: 50,
        settleTime: "2026-03-29 15:30:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ ClockType: "排钟" }),
      },
    ]);

    await expect(
      analyticsStore.listStoreManagerDailyKpiByDateRange("1001", "2026-03-29", "2026-03-29"),
    ).resolves.toEqual([
      expect.objectContaining({
        bizDate: "2026-03-29",
        orgId: "1001",
        storeName: "一号店",
        dailyActualRevenue: 480,
        dailyCardConsume: 120,
        dailyOrderCount: 2,
        totalClocks: 2,
        assignClocks: 1,
        queueClocks: 1,
        pointClockRate: 0.5,
        averageTicket: 240,
        clockEffect: 240,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("projects 30-day tech profile rows from a stable SQL surface", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      upsertTechUpClockRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
      upsertTechMarketRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
      replaceCustomerTechLinks: (
        orgId: string,
        bizDate: string,
        rows: Array<Record<string, unknown>>,
        updatedAt: string,
      ) => Promise<void>;
      listTechProfile30dByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<
        Array<{
          orgId: string;
          windowEndBizDate: string;
          techCode: string;
          techName: string;
          servedCustomerCount30d: number;
          servedOrderCount30d: number;
          serviceDayCount30d: number;
          totalClockCount30d: number;
          pointClockCount30d: number;
          queueClockCount30d: number;
          pointClockRate30d: number | null;
          addClockRate30d: number | null;
          turnover30d: number;
          commission30d: number;
          marketRevenue30d: number;
          activeDays30d: number;
        }>
      >;
    };

    await store.initialize();
    await analyticsStore.upsertTechUpClockRows([
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-1",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-1",
        itemName: "足疗",
        clockType: "点钟",
        count: 1,
        turnover: 300,
        comm: 80,
        settleTime: "2026-03-29 13:30:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "1" }),
      },
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-2",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-2",
        itemName: "推拿",
        clockType: "排钟",
        count: 1,
        turnover: 180,
        comm: 50,
        settleTime: "2026-03-28 15:30:00",
        bizDate: "2026-03-28",
        rawJson: JSON.stringify({ ClockType: "排钟", AddClockType: "0" }),
      },
    ]);
    await analyticsStore.upsertTechMarketRows([
      {
        orgId: "1001",
        recordKey: "MARKET-1",
        personCode: "T-1",
        personName: "白慧慧",
        itemId: "ITEM-1",
        itemName: "精油",
        count: 1,
        afterDisc: 88,
        commission: 20,
        settleTime: "2026-03-29 13:40:00",
        bizDate: "2026-03-29",
        rawJson: JSON.stringify({ ItemId: "ITEM-1" }),
      },
    ]);
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-29",
      [
        {
          orgId: "1001",
          bizDate: "2026-03-29",
          settleId: "SETTLE-1",
          settleNo: "NO-1",
          customerIdentityKey: "member:M-1",
          customerIdentityType: "member",
          customerDisplayName: "顾客A",
          memberId: "M-1",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 300,
          techCommission: 80,
          orderPayAmount: 300,
          orderConsumeAmount: 420,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "SETTLE-1" }),
        },
        {
          orgId: "1001",
          bizDate: "2026-03-28",
          settleId: "SETTLE-2",
          settleNo: "NO-2",
          customerIdentityKey: "member:M-2",
          customerIdentityType: "member",
          customerDisplayName: "顾客B",
          memberId: "M-2",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 180,
          techCommission: 50,
          orderPayAmount: 180,
          orderConsumeAmount: 180,
          itemNames: ["推拿"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "SETTLE-2" }),
        },
      ],
      "2026-03-29T16:00:00.000Z",
    );

    await expect(
      analyticsStore.listTechProfile30dByDateRange("1001", "2026-03-29", "2026-03-29"),
    ).resolves.toEqual([
      expect.objectContaining({
        orgId: "1001",
        windowEndBizDate: "2026-03-29",
        techCode: "T-1",
        techName: "白慧慧",
        servedCustomerCount30d: 2,
        servedOrderCount30d: 2,
        serviceDayCount30d: 2,
        totalClockCount30d: 2,
        pointClockCount30d: 1,
        queueClockCount30d: 1,
        pointClockRate30d: 0.5,
        addClockRate30d: 0.5,
        turnover30d: 480,
        commission30d: 130,
        marketRevenue30d: 88,
        activeDays30d: 2,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("projects 7-day store review rows from a stable SQL surface", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      upsertTechUpClockRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
      replaceCustomerTechLinks: (
        orgId: string,
        bizDate: string,
        rows: Array<Record<string, unknown>>,
        updatedAt: string,
      ) => Promise<void>;
      refreshAnalyticsViews: () => Promise<void>;
      listStoreReview7dByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<
        Array<{
          orgId: string;
          windowEndBizDate: string;
          storeName: string;
          revenue7d: number;
          orderCount7d: number;
          totalClocks7d: number;
          clockEffect7d: number | null;
          averageTicket7d: number | null;
          pointClockRate7d: number | null;
          addClockRate7d: number | null;
          groupbuyOrderShare7d: number | null;
          groupbuyCohortCustomerCount: number;
          groupbuy7dRevisitCustomerCount: number;
          groupbuy7dRevisitRate: number | null;
          groupbuy7dCardOpenedCustomerCount: number;
          groupbuy7dCardOpenedRate: number | null;
          groupbuy7dStoredValueConvertedCustomerCount: number;
          groupbuy7dStoredValueConversionRate: number | null;
          groupbuy30dMemberPayConvertedCustomerCount: number;
          groupbuy30dMemberPayConversionRate: number | null;
          groupbuyFirstOrderCustomerCount: number;
          groupbuyFirstOrderHighValueMemberCustomerCount: number;
          groupbuyFirstOrderHighValueMemberRate: number | null;
          effectiveMembers: number;
          sleepingMembers: number;
          sleepingMemberRate: number | null;
          newMembers7d: number;
          activeTechCount7d: number | null;
          rechargeCash7d: number;
          storedConsumeAmount7d: number;
          storedConsumeRate7d: number | null;
          onDutyTechCount7d: number | null;
        }>
      >;
    };

    await store.initialize();

    const metricsBizDates = Array.from({ length: 30 }, (_, index) =>
      shiftBizDate("2026-03-29", -(29 - index)),
    );
    const bizDates = metricsBizDates.slice(-7);
    const previousWeekBizDates = metricsBizDates.slice(-14, -7);

    await store.upsertConsumeBills(
      bizDates.map((bizDate, index) => ({
        orgId: "1001",
        settleId: `SETTLE-${index + 1}`,
        settleNo: `NO-${index + 1}`,
        payAmount: 100 + index * 10,
        consumeAmount: 110 + index * 10,
        discountAmount: 0,
        antiFlag: false,
        optTime: `${bizDate} 13:20:00`,
        bizDate,
        rawJson: JSON.stringify({ SettleId: `SETTLE-${index + 1}` }),
      })),
    );
    await analyticsStore.upsertTechUpClockRows(
      bizDates.flatMap((bizDate, index) => [
        {
          orgId: "1001",
          rowFingerprint: `CLOCK-P-${index + 1}`,
          personCode: "T-1",
          personName: "白慧慧",
          settleNo: `NO-${index + 1}`,
          itemName: "足疗",
          clockType: "点钟",
          count: 1,
          turnover: 100 + index * 10,
          comm: 30,
          settleTime: `${bizDate} 13:30:00`,
          bizDate,
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "1" }),
        },
        {
          orgId: "1001",
          rowFingerprint: `CLOCK-Q-${index + 1}`,
          personCode: "T-2",
          personName: "小雨",
          settleNo: `NO-${index + 1}`,
          itemName: "推拿",
          clockType: "排钟",
          count: 1,
          turnover: 0,
          comm: 0,
          settleTime: `${bizDate} 14:00:00`,
          bizDate,
          rawJson: JSON.stringify({ ClockType: "排钟", AddClockType: "0" }),
        },
      ]),
    );

    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      previousWeekBizDates[0]!,
      [
        {
          orgId: "1001",
          bizDate: previousWeekBizDates[0],
          settleId: "PREV-1",
          settleNo: "PREV-1",
          customerIdentityKey: "member:M-1",
          customerIdentityType: "member",
          customerDisplayName: "会员A",
          memberId: "M-1",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 110,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "PREV-1" }),
        },
      ],
      `${previousWeekBizDates[0]}T18:00:00.000Z`,
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      previousWeekBizDates[1]!,
      [
        {
          orgId: "1001",
          bizDate: previousWeekBizDates[1],
          settleId: "PREV-2",
          settleNo: "PREV-2",
          customerIdentityKey: "member:M-2",
          customerIdentityType: "member",
          customerDisplayName: "会员B",
          memberId: "M-2",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 110,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "PREV-2" }),
        },
      ],
      `${previousWeekBizDates[1]}T18:00:00.000Z`,
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      previousWeekBizDates[2]!,
      [
        {
          orgId: "1001",
          bizDate: previousWeekBizDates[2],
          settleId: "PREV-3",
          settleNo: "PREV-3",
          customerIdentityKey: "member:M-3",
          customerIdentityType: "member",
          customerDisplayName: "会员C",
          memberId: "M-3",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 110,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "PREV-3" }),
        },
      ],
      `${previousWeekBizDates[2]}T18:00:00.000Z`,
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      previousWeekBizDates[3]!,
      [
        {
          orgId: "1001",
          bizDate: previousWeekBizDates[3],
          settleId: "PREV-4",
          settleNo: "PREV-4",
          customerIdentityKey: "member:M-4",
          customerIdentityType: "member",
          customerDisplayName: "会员D",
          memberId: "M-4",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 110,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "PREV-4" }),
        },
      ],
      `${previousWeekBizDates[3]}T18:00:00.000Z`,
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      bizDates[0]!,
      [
        {
          orgId: "1001",
          bizDate: bizDates[0],
          settleId: "CUR-1",
          settleNo: "CUR-1",
          customerIdentityKey: "member:M-1",
          customerIdentityType: "member",
          customerDisplayName: "会员A",
          memberId: "M-1",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 110,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "CUR-1" }),
        },
      ],
      `${bizDates[0]}T18:00:00.000Z`,
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      bizDates[1]!,
      [
        {
          orgId: "1001",
          bizDate: bizDates[1],
          settleId: "CUR-2",
          settleNo: "CUR-2",
          customerIdentityKey: "member:M-2",
          customerIdentityType: "member",
          customerDisplayName: "会员B",
          memberId: "M-2",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 110,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "CUR-2" }),
        },
      ],
      `${bizDates[1]}T18:00:00.000Z`,
    );

    for (const [index, bizDate] of metricsBizDates.entries()) {
      const inReviewWindow = bizDates.includes(bizDate);
      await pool.query(
        `
          INSERT INTO mart_daily_store_metrics (org_id, biz_date, metrics_json, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (org_id, biz_date) DO UPDATE SET
            metrics_json = EXCLUDED.metrics_json,
            updated_at = EXCLUDED.updated_at
        `,
        [
          "1001",
          bizDate,
          JSON.stringify({
            orgId: "1001",
            storeName: "一号店",
            bizDate,
            serviceOrderCount: inReviewWindow ? 1 : 0,
            groupbuyOrderCount: inReviewWindow ? 1 : 0,
            upClockRecordCount: inReviewWindow ? 2 : 0,
            pointClockRecordCount: inReviewWindow ? 1 : 0,
            addClockRecordCount: inReviewWindow ? 1 : 0,
            activeTechCount: inReviewWindow ? 3 : 0,
            onDutyTechCount: inReviewWindow ? 4 : 0,
            newMembers: inReviewWindow ? 4 : 0,
            rechargeCash: index >= 20 ? 20 : 10,
            storedConsumeAmount: 20,
            storedConsumeRate: index >= 20 ? 1 : 2,
            groupbuyCohortCustomerCount: index === metricsBizDates.length - 1 ? 10 : 0,
            groupbuy7dRevisitCustomerCount: index === metricsBizDates.length - 1 ? 4 : 0,
            groupbuy7dRevisitRate: index === metricsBizDates.length - 1 ? 0.4 : null,
            groupbuy7dCardOpenedCustomerCount: index === metricsBizDates.length - 1 ? 3 : 0,
            groupbuy7dCardOpenedRate: index === metricsBizDates.length - 1 ? 0.3 : null,
            groupbuy7dStoredValueConvertedCustomerCount: index === metricsBizDates.length - 1 ? 2 : 0,
            groupbuy7dStoredValueConversionRate: index === metricsBizDates.length - 1 ? 0.2 : null,
            groupbuy30dMemberPayConvertedCustomerCount: index === metricsBizDates.length - 1 ? 5 : 0,
            groupbuy30dMemberPayConversionRate: index === metricsBizDates.length - 1 ? 0.5 : null,
            groupbuyFirstOrderCustomerCount: index === metricsBizDates.length - 1 ? 6 : 0,
            groupbuyFirstOrderHighValueMemberCustomerCount: index === metricsBizDates.length - 1 ? 1 : 0,
            groupbuyFirstOrderHighValueMemberRate: index === metricsBizDates.length - 1 ? 1 / 6 : null,
            effectiveMembers: index === metricsBizDates.length - 1 ? 35 : 0,
            sleepingMembers: index === metricsBizDates.length - 1 ? 4 : 0,
            sleepingMemberRate: index === metricsBizDates.length - 1 ? 4 / 35 : null,
            currentStoredBalance: index === metricsBizDates.length - 1 ? 1200 : 0,
          }),
          `${bizDate}T18:00:00.000Z`,
        ],
      );
    }

    await analyticsStore.refreshAnalyticsViews();

    await expect(
      analyticsStore.listStoreReview7dByDateRange("1001", "2026-03-29", "2026-03-29"),
    ).resolves.toEqual([
      expect.objectContaining({
        orgId: "1001",
        windowEndBizDate: "2026-03-29",
        storeName: "一号店",
        revenue7d: 910,
        orderCount7d: 7,
        totalClocks7d: 14,
        clockEffect7d: 65,
        averageTicket7d: 130,
        pointClockRate7d: 0.5,
        addClockRate7d: 0.5,
        groupbuyOrderShare7d: 1,
        groupbuyCohortCustomerCount: 10,
        groupbuy7dRevisitCustomerCount: 4,
        groupbuy7dRevisitRate: 0.4,
        groupbuy7dCardOpenedCustomerCount: 3,
        groupbuy7dCardOpenedRate: 0.3,
        groupbuy7dStoredValueConvertedCustomerCount: 2,
        groupbuy7dStoredValueConversionRate: 0.2,
        groupbuy30dMemberPayConvertedCustomerCount: 5,
        groupbuy30dMemberPayConversionRate: 0.5,
        groupbuyFirstOrderCustomerCount: 6,
        groupbuyFirstOrderHighValueMemberCustomerCount: 1,
        groupbuyFirstOrderHighValueMemberRate: 1 / 6,
        effectiveMembers: 35,
        sleepingMembers: 4,
        sleepingMemberRate: 4 / 35,
        newMembers7d: 28,
        activeTechCount7d: 3,
        rechargeCash7d: 140,
        storedConsumeAmount7d: 140,
        storedConsumeRate7d: 1,
        onDutyTechCount7d: 4,
        currentStoredBalance: 1200,
        storedBalanceLifeMonths: 2,
        renewalPressureIndex30d: 1.5,
        memberRepurchaseBaseCustomerCount7d: 4,
        memberRepurchaseReturnedCustomerCount7d: 2,
        memberRepurchaseRate7d: 0.5,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("projects 30-day store summary rows from a stable SQL surface", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      upsertTechUpClockRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
      replaceCustomerTechLinks: (
        orgId: string,
        bizDate: string,
        rows: Array<Record<string, unknown>>,
        updatedAt: string,
      ) => Promise<void>;
      refreshAnalyticsViews: () => Promise<void>;
      listStoreSummary30dByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<StoreSummary30dRow[]>;
    };

    await store.initialize();

    const bizDates = Array.from({ length: 30 }, (_, index) =>
      shiftBizDate("2026-03-30", -(29 - index)),
    );

    await store.upsertConsumeBills(
      bizDates.map((bizDate, index) => ({
        orgId: "1001",
        settleId: `SUM30-${index + 1}`,
        settleNo: `SUM30-NO-${index + 1}`,
        payAmount: 100 + index,
        consumeAmount: 120 + index,
        discountAmount: 0,
        antiFlag: false,
        optTime: `${bizDate} 13:20:00`,
        bizDate,
        rawJson: JSON.stringify({ SettleId: `SUM30-${index + 1}` }),
      })),
    );

    await analyticsStore.upsertTechUpClockRows(
      bizDates.flatMap((bizDate, index) => [
        {
          orgId: "1001",
          rowFingerprint: `SUM30-P-${index + 1}`,
          personCode: "T-1",
          personName: "白慧慧",
          settleNo: `SUM30-NO-${index + 1}`,
          itemName: "足疗",
          clockType: "点钟",
          count: 1,
          turnover: 100 + index,
          comm: 30,
          settleTime: `${bizDate} 13:30:00`,
          bizDate,
          rawJson: JSON.stringify({ ClockType: "点钟", AddClockType: "1" }),
        },
        {
          orgId: "1001",
          rowFingerprint: `SUM30-Q-${index + 1}`,
          personCode: "T-2",
          personName: "小雨",
          settleNo: `SUM30-NO-${index + 1}`,
          itemName: "推拿",
          clockType: "排钟",
          count: 1,
          turnover: 0,
          comm: 0,
          settleTime: `${bizDate} 14:00:00`,
          bizDate,
          rawJson: JSON.stringify({ ClockType: "排钟", AddClockType: "0" }),
        },
      ]),
    );

    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-18",
      [
        {
          orgId: "1001",
          bizDate: "2026-03-18",
          settleId: "REP-1",
          settleNo: "REP-1",
          customerIdentityKey: "member:M-1",
          customerIdentityType: "member",
          customerDisplayName: "会员A",
          memberId: "M-1",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 120,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "REP-1" }),
        },
      ],
      "2026-03-18T18:00:00.000Z",
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-19",
      [
        {
          orgId: "1001",
          bizDate: "2026-03-19",
          settleId: "REP-2",
          settleNo: "REP-2",
          customerIdentityKey: "member:M-2",
          customerIdentityType: "member",
          customerDisplayName: "会员B",
          memberId: "M-2",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 120,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "REP-2" }),
        },
      ],
      "2026-03-19T18:00:00.000Z",
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-20",
      [
        {
          orgId: "1001",
          bizDate: "2026-03-20",
          settleId: "REP-3",
          settleNo: "REP-3",
          customerIdentityKey: "member:M-3",
          customerIdentityType: "member",
          customerDisplayName: "会员C",
          memberId: "M-3",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 120,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "REP-3" }),
        },
      ],
      "2026-03-20T18:00:00.000Z",
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-21",
      [
        {
          orgId: "1001",
          bizDate: "2026-03-21",
          settleId: "REP-4",
          settleNo: "REP-4",
          customerIdentityKey: "member:M-4",
          customerIdentityType: "member",
          customerDisplayName: "会员D",
          memberId: "M-4",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 120,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "REP-4" }),
        },
      ],
      "2026-03-21T18:00:00.000Z",
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-25",
      [
        {
          orgId: "1001",
          bizDate: "2026-03-25",
          settleId: "RET-1",
          settleNo: "RET-1",
          customerIdentityKey: "member:M-1",
          customerIdentityType: "member",
          customerDisplayName: "会员A",
          memberId: "M-1",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 120,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "RET-1" }),
        },
      ],
      "2026-03-25T18:00:00.000Z",
    );
    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-26",
      [
        {
          orgId: "1001",
          bizDate: "2026-03-26",
          settleId: "RET-2",
          settleNo: "RET-2",
          customerIdentityKey: "member:M-2",
          customerIdentityType: "member",
          customerDisplayName: "会员B",
          memberId: "M-2",
          identityStable: true,
          techCode: "T-1",
          techName: "白慧慧",
          customerCountInSettle: 1,
          techCountInSettle: 1,
          techTurnover: 100,
          techCommission: 30,
          orderPayAmount: 100,
          orderConsumeAmount: 120,
          itemNames: ["足疗"],
          linkConfidence: "high",
          rawJson: JSON.stringify({ settleId: "RET-2" }),
        },
      ],
      "2026-03-26T18:00:00.000Z",
    );

    for (const bizDate of bizDates) {
      await pool.query(
        `
          INSERT INTO mart_daily_store_metrics (org_id, biz_date, metrics_json, updated_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (org_id, biz_date) DO UPDATE SET
            metrics_json = EXCLUDED.metrics_json,
            updated_at = EXCLUDED.updated_at
        `,
        [
          "1001",
          bizDate,
          JSON.stringify({
            orgId: "1001",
            storeName: "一号店",
            bizDate,
            serviceOrderCount: 1,
            groupbuyOrderCount: 1,
            upClockRecordCount: 2,
            pointClockRecordCount: 1,
            addClockRecordCount: 1,
            activeTechCount: 3,
            onDutyTechCount: 4,
            newMembers: 1,
            rechargeCash: 20,
            storedConsumeAmount: 20,
            storedConsumeRate: 1,
            groupbuyCohortCustomerCount: bizDate === "2026-03-30" ? 10 : 0,
            groupbuy7dRevisitCustomerCount: bizDate === "2026-03-30" ? 4 : 0,
            groupbuy7dRevisitRate: bizDate === "2026-03-30" ? 0.4 : null,
            groupbuy7dCardOpenedCustomerCount: bizDate === "2026-03-30" ? 3 : 0,
            groupbuy7dCardOpenedRate: bizDate === "2026-03-30" ? 0.3 : null,
            groupbuy7dStoredValueConvertedCustomerCount: bizDate === "2026-03-30" ? 2 : 0,
            groupbuy7dStoredValueConversionRate: bizDate === "2026-03-30" ? 0.2 : null,
            groupbuy30dMemberPayConvertedCustomerCount: bizDate === "2026-03-30" ? 5 : 0,
            groupbuy30dMemberPayConversionRate: bizDate === "2026-03-30" ? 0.5 : null,
            groupbuyFirstOrderCustomerCount: bizDate === "2026-03-30" ? 6 : 0,
            groupbuyFirstOrderHighValueMemberCustomerCount: bizDate === "2026-03-30" ? 1 : 0,
            groupbuyFirstOrderHighValueMemberRate: bizDate === "2026-03-30" ? 1 / 6 : null,
            effectiveMembers: bizDate === "2026-03-30" ? 35 : 0,
            sleepingMembers: bizDate === "2026-03-30" ? 4 : 0,
            sleepingMemberRate: bizDate === "2026-03-30" ? 4 / 35 : null,
            currentStoredBalance: bizDate === "2026-03-30" ? 1200 : 0,
          }),
          `${bizDate}T18:00:00.000Z`,
        ],
      );
    }

    await analyticsStore.refreshAnalyticsViews();

    await expect(
      analyticsStore.listStoreSummary30dByDateRange("1001", "2026-03-30", "2026-03-30"),
    ).resolves.toEqual([
      expect.objectContaining({
        orgId: "1001",
        windowEndBizDate: "2026-03-30",
        storeName: "一号店",
        revenue30d: 3435,
        orderCount30d: 30,
        totalClocks30d: 60,
        averageTicket30d: 114.5,
        clockEffect30d: 57.25,
        pointClockRate30d: 0.5,
        addClockRate30d: 0.5,
        groupbuyOrderShare30d: 1,
        groupbuyCohortCustomerCount: 10,
        groupbuy7dRevisitCustomerCount: 4,
        groupbuy7dRevisitRate: 0.4,
        groupbuy7dCardOpenedCustomerCount: 3,
        groupbuy7dCardOpenedRate: 0.3,
        groupbuy7dStoredValueConvertedCustomerCount: 2,
        groupbuy7dStoredValueConversionRate: 0.2,
        groupbuy30dMemberPayConvertedCustomerCount: 5,
        groupbuy30dMemberPayConversionRate: 0.5,
        groupbuyFirstOrderCustomerCount: 6,
        groupbuyFirstOrderHighValueMemberCustomerCount: 1,
        groupbuyFirstOrderHighValueMemberRate: 1 / 6,
        effectiveMembers: 35,
        sleepingMembers: 4,
        sleepingMemberRate: 4 / 35,
        newMembers30d: 30,
        activeTechCount30d: 3,
        rechargeCash30d: 600,
        storedConsumeAmount30d: 600,
        storedConsumeRate30d: 1,
        onDutyTechCount30d: 4,
        currentStoredBalance: 1200,
        storedBalanceLifeMonths: 2,
        renewalPressureIndex30d: 1,
        memberRepurchaseBaseCustomerCount7d: 4,
        memberRepurchaseReturnedCustomerCount7d: 2,
        memberRepurchaseRate7d: 0.5,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("can rebuild missing analytics views without recreating the whole schema", async () => {
    const store = new HetangOpsStore({
      pool: {
        query: vi.fn(),
      } as never,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      initialized: boolean;
      ensureAnalyticsViewsReady: () => Promise<void>;
      relationExists: (name: string) => Promise<boolean>;
      rebuildAnalyticsViews: () => Promise<void>;
    };
    const relationExists = vi.spyOn(analyticsStore as any, "relationExists");
    const rebuildAnalyticsViews = vi.spyOn(analyticsStore as any, "rebuildAnalyticsViews");

    analyticsStore.initialized = true;
    relationExists.mockImplementation(
      async (...args: unknown[]) => args[0] !== "mv_store_summary_30d",
    );
    rebuildAnalyticsViews.mockResolvedValue(undefined);

    await analyticsStore.ensureAnalyticsViewsReady();

    expect(relationExists).toHaveBeenCalledWith("mv_store_summary_30d");
    expect(rebuildAnalyticsViews).toHaveBeenCalledTimes(1);
  });

  it("projects customer conversion cohorts and 90-day customer profiles from stable SQL surfaces", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analyticsStore = store as unknown as {
      upsertTechUpClockRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
      replaceCustomerTechLinks: (
        orgId: string,
        bizDate: string,
        rows: Array<Record<string, unknown>>,
        updatedAt: string,
      ) => Promise<void>;
      replaceCustomerSegments: (
        orgId: string,
        bizDate: string,
        rows: Array<Record<string, unknown>>,
        updatedAt: string,
      ) => Promise<void>;
      replaceCustomerConversionCohorts: (
        orgId: string,
        bizDate: string,
        rows: Array<Record<string, unknown>>,
        updatedAt: string,
      ) => Promise<void>;
      listCustomerConversionCohortsByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<
        Array<{
          orgId: string;
          bizDate: string;
          customerIdentityKey: string;
          customerIdentityType: string;
          customerDisplayName: string;
          memberId?: string;
          referenceCode?: string;
          firstGroupbuyBizDate?: string;
          firstObservedIsGroupbuy: boolean;
          revisitWithin7d: boolean;
          revisitWithin30d: boolean;
          cardOpenedWithin7d: boolean;
          storedValueConvertedWithin7d: boolean;
          memberPayConvertedWithin30d: boolean;
          visitCount30dAfterGroupbuy: number;
          payAmount30dAfterGroupbuy: number;
          memberPayAmount30dAfterGroupbuy: number;
          highValueMemberWithin30d: boolean;
        }>
      >;
      listCustomerProfile90dByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<
        Array<{
          orgId: string;
          windowEndBizDate: string;
          customerIdentityKey: string;
          customerDisplayName: string;
          memberId?: string;
          phone?: string;
          currentStoredAmount: number;
          currentSilentDays: number;
          visitCount90d: number;
          payAmount90d: number;
          topTechName?: string;
          primarySegment: string;
          firstGroupbuyBizDate?: string;
          revisitWithin7d: boolean;
          cardOpenedWithin7d: boolean;
          storedValueConvertedWithin7d: boolean;
          memberPayConvertedWithin30d: boolean;
          highValueMemberWithin30d: boolean;
        }>
      >;
    };

    await store.initialize();
    await store.upsertMemberCurrent([
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 1200,
        consumeAmount: 1800,
        createdTime: "2026-03-03 10:00:00",
        lastConsumeTime: "2026-03-20 21:00:00",
        silentDays: 10,
        rawJson: JSON.stringify({ Id: "member-001" }),
      },
    ]);
    await store.replaceMemberDailySnapshots("1001", "2026-03-30", [
      {
        orgId: "1001",
        memberId: "member-001",
        name: "王先生",
        phone: "13800000001",
        storedAmount: 680,
        consumeAmount: 980,
        createdTime: "2025-11-11 10:00:00",
        lastConsumeTime: "2026-02-21 19:40:00",
        silentDays: 37,
        rawJson: JSON.stringify({
          Id: "member-001",
          Phone: "13800000001",
          CTime: "2025-11-11 10:00:00",
          Storeds: [{ Id: "card-001", CardNo: "yw001", OrgId: "1001" }],
        }),
      },
    ]);
    await store.upsertMemberCards([
      {
        orgId: "1001",
        memberId: "member-001",
        cardId: "card-001",
        cardNo: "yw001",
        rawJson: JSON.stringify({ Id: "card-001" }),
      },
    ]);
    await store.upsertConsumeBills([
      {
        orgId: "1001",
        settleId: "S-001",
        settleNo: "NO-001",
        payAmount: 199,
        consumeAmount: 199,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-01 21:00:00",
        bizDate: "2026-03-01",
        rawJson: JSON.stringify({
          SettleId: "S-001",
          SettleNo: "NO-001",
          Infos: ["王先生 (金悦卡) [yw001],消费199.00元;"],
          Payments: [{ Name: "美团", Amount: 199, PaymentType: 8 }],
        }),
      },
      {
        orgId: "1001",
        settleId: "S-002",
        settleNo: "NO-002",
        payAmount: 260,
        consumeAmount: 260,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-03 21:00:00",
        bizDate: "2026-03-03",
        rawJson: JSON.stringify({
          SettleId: "S-002",
          SettleNo: "NO-002",
          Infos: ["王先生 (金悦卡) [yw001],消费260.00元;"],
          Payments: [{ Name: "会员", Amount: 260, PaymentType: 3 }],
        }),
      },
      {
        orgId: "1001",
        settleId: "S-003",
        settleNo: "NO-003",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-05 21:00:00",
        bizDate: "2026-03-05",
        rawJson: JSON.stringify({
          SettleId: "S-003",
          SettleNo: "NO-003",
          Infos: ["王先生 (金悦卡) [yw001],消费300.00元;"],
          Payments: [{ Name: "会员", Amount: 300, PaymentType: 3 }],
        }),
      },
      {
        orgId: "1001",
        settleId: "S-004",
        settleNo: "NO-004",
        payAmount: 320,
        consumeAmount: 320,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-10 21:00:00",
        bizDate: "2026-03-10",
        rawJson: JSON.stringify({
          SettleId: "S-004",
          SettleNo: "NO-004",
          Infos: ["王先生 (金悦卡) [yw001],消费320.00元;"],
          Payments: [{ Name: "会员", Amount: 320, PaymentType: 3 }],
        }),
      },
      {
        orgId: "1001",
        settleId: "S-005",
        settleNo: "NO-005",
        payAmount: 360,
        consumeAmount: 360,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-03-20 21:00:00",
        bizDate: "2026-03-20",
        rawJson: JSON.stringify({
          SettleId: "S-005",
          SettleNo: "NO-005",
          Infos: ["王先生 (金悦卡) [yw001],消费360.00元;"],
          Payments: [{ Name: "会员", Amount: 360, PaymentType: 3 }],
        }),
      },
    ]);
    await store.upsertRechargeBills([
      {
        orgId: "1001",
        rechargeId: "R-001",
        realityAmount: 500,
        totalAmount: 500,
        donateAmount: 0,
        antiFlag: false,
        optTime: "2026-03-04 10:00:00",
        bizDate: "2026-03-04",
        rawJson: JSON.stringify({
          CardNo: "yw001",
          MemberPhone: "13800000001",
          MemberName: "王先生",
        }),
      },
    ]);
    await analyticsStore.upsertTechUpClockRows([
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-1",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-001",
        itemName: "荷悦SPA",
        clockType: "点钟",
        count: 1,
        turnover: 199,
        comm: 50,
        settleTime: "2026-03-01 21:30:00",
        bizDate: "2026-03-01",
        rawJson: JSON.stringify({ ClockType: "点钟" }),
      },
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-2",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-002",
        itemName: "荷悦SPA",
        clockType: "点钟",
        count: 1,
        turnover: 260,
        comm: 60,
        settleTime: "2026-03-03 21:30:00",
        bizDate: "2026-03-03",
        rawJson: JSON.stringify({ ClockType: "点钟" }),
      },
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-3",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-003",
        itemName: "荷悦SPA",
        clockType: "点钟",
        count: 1,
        turnover: 300,
        comm: 70,
        settleTime: "2026-03-05 21:30:00",
        bizDate: "2026-03-05",
        rawJson: JSON.stringify({ ClockType: "点钟" }),
      },
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-4",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-004",
        itemName: "荷悦SPA",
        clockType: "点钟",
        count: 1,
        turnover: 320,
        comm: 80,
        settleTime: "2026-03-10 21:30:00",
        bizDate: "2026-03-10",
        rawJson: JSON.stringify({ ClockType: "点钟" }),
      },
      {
        orgId: "1001",
        rowFingerprint: "CLOCK-5",
        personCode: "T-1",
        personName: "白慧慧",
        settleNo: "NO-005",
        itemName: "荷悦SPA",
        clockType: "点钟",
        count: 1,
        turnover: 360,
        comm: 90,
        settleTime: "2026-03-20 21:30:00",
        bizDate: "2026-03-20",
        rawJson: JSON.stringify({ ClockType: "点钟" }),
      },
    ]);

    const currentMembers = await store.listCurrentMembers("1001");
    const currentCards = await store.listCurrentMemberCards("1001");
    const consumeHistory = await store.listConsumeBillsByDateRange("1001", "2026-03-01", "2026-03-30");
    const rechargeHistory = await store.listRechargeBillsByDateRange("1001", "2026-03-01", "2026-03-30");
    const techHistory = await store.listTechUpClockByDateRange("1001", "2026-03-01", "2026-03-30");

    const historyLinks = buildCustomerTechServiceLinks({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      techUpClockRows: techHistory,
      currentMembers,
      currentMemberCards: currentCards,
    });
    const segments = buildCustomerSegments({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      customerTechLinks: historyLinks,
      currentMembers,
      currentMemberCards: currentCards,
    });
    const cohorts = buildCustomerConversionCohorts({
      orgId: "1001",
      bizDate: "2026-03-30",
      consumeBills: consumeHistory,
      rechargeBills: rechargeHistory,
      currentMembers,
      currentMemberCards: currentCards,
    });

    await analyticsStore.replaceCustomerTechLinks(
      "1001",
      "2026-03-30",
      historyLinks.filter((row) => row.bizDate === "2026-03-30"),
      "2026-03-30T23:00:00.000Z",
    );
    await analyticsStore.replaceCustomerSegments(
      "1001",
      "2026-03-30",
      segments,
      "2026-03-30T23:00:00.000Z",
    );
    await analyticsStore.replaceCustomerConversionCohorts(
      "1001",
      "2026-03-30",
      cohorts,
      "2026-03-30T23:00:00.000Z",
    );

    await expect(
      analyticsStore.listCustomerConversionCohortsByDateRange(
        "1001",
        "2026-03-30",
        "2026-03-30",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-03-30",
        customerIdentityKey: "member:member-001",
        customerIdentityType: "member",
        customerDisplayName: "王先生",
        memberId: "member-001",
        referenceCode: "yw001",
        firstGroupbuyBizDate: "2026-03-01",
        firstObservedIsGroupbuy: true,
        revisitWithin7d: true,
        revisitWithin30d: true,
        cardOpenedWithin7d: true,
        storedValueConvertedWithin7d: true,
        memberPayConvertedWithin30d: true,
        visitCount30dAfterGroupbuy: 5,
        payAmount30dAfterGroupbuy: 1439,
        memberPayAmount30dAfterGroupbuy: 1240,
        highValueMemberWithin30d: true,
      }),
    ]);

    await expect(
      analyticsStore.listCustomerProfile90dByDateRange("1001", "2026-03-30", "2026-03-30"),
    ).resolves.toEqual([
      expect.objectContaining({
        orgId: "1001",
        windowEndBizDate: "2026-03-30",
        customerIdentityKey: "member:member-001",
        customerDisplayName: "王先生",
        memberId: "member-001",
        phone: "13800000001",
        currentStoredAmount: 680,
        currentCreatedTime: "2025-11-11 10:00:00",
        currentLastConsumeTime: "2026-02-21 19:40:00",
        currentSilentDays: 37,
        visitCount90d: 5,
        payAmount90d: 1439,
        topTechName: "白慧慧",
        primarySegment: "important-value-member",
        firstGroupbuyBizDate: "2026-03-01",
        revisitWithin7d: true,
        cardOpenedWithin7d: true,
        storedValueConvertedWithin7d: true,
        memberPayConvertedWithin30d: true,
        highValueMemberWithin30d: true,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("persists external intelligence documents, candidates, cards, and brief issues", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const externalStore = store as unknown as {
      insertExternalSourceDocument: (row: {
        documentId: string;
        sourceId: string;
        sourceTier: "s" | "a" | "b" | "blocked";
        sourceUrl: string;
        title: string;
        summary: string;
        contentText?: string;
        publishedAt: string;
        eventAt?: string;
        fetchedAt: string;
        theme?: string;
        blockedReason?: string;
        rawJson: string;
      }) => Promise<void>;
      listFreshExternalSourceDocuments: (params: {
        sincePublishedAt: string;
        theme?: string;
        limit?: number;
      }) => Promise<
        Array<{
          documentId: string;
          sourceTier: string;
          sourceUrl: string;
          title: string;
          theme?: string;
          publishedAt: string;
          blockedReason?: string;
        }>
      >;
      upsertExternalEventCandidate: (row: {
        candidateId: string;
        sourceDocumentId: string;
        sourceId: string;
        sourceTier: "s" | "a" | "b" | "blocked";
        sourceUrl?: string;
        title: string;
        summary: string;
        entity: string;
        action: string;
        object?: string;
        theme: string;
        normalizedKey: string;
        publishedAt: string;
        eventAt?: string;
        score: number;
        blockedReason?: string;
        rawJson: string;
      }) => Promise<void>;
      upsertExternalEventCard: (row: {
        cardId: string;
        theme: string;
        entity: string;
        action: string;
        object?: string;
        summary: string;
        publishedAt: string;
        eventAt?: string;
        score: number;
        sourceTier: "s" | "a" | "b" | "blocked";
        sourceUrls: string[];
        sourceDocumentIds: string[];
        candidateIds: string[];
      }) => Promise<void>;
      listExternalEventCards: (params: {
        issueDate?: string;
        theme?: string;
        publishedAtFrom?: string;
        publishedAtTo?: string;
        limit?: number;
      }) => Promise<
        Array<{
          cardId: string;
          theme: string;
          candidateIds: string[];
          sourceDocumentIds: string[];
          sourceUrls: string[];
        }>
      >;
      createExternalBriefIssue: (row: {
        issueId: string;
        issueDate: string;
        topic: string;
        createdAt: string;
      }) => Promise<void>;
      insertExternalBriefItems: (
        issueId: string,
        items: Array<{
          itemId: string;
          cardId: string;
          title: string;
          theme: string;
          summary: string;
          whyItMatters: string;
          score: number;
          rank: number;
        }>,
      ) => Promise<void>;
      listExternalBriefItems: (issueId: string) => Promise<
        Array<{
          itemId: string;
          cardId: string;
          title: string;
          rank: number;
        }>
      >;
    };

    await store.initialize();

    expect(await store.tableExists("external_source_documents")).toBe(true);
    expect(await store.tableExists("external_event_candidates")).toBe(true);
    expect(await store.tableExists("external_event_cards")).toBe(true);
    expect(await store.tableExists("external_brief_issues")).toBe(true);
    expect(await store.tableExists("external_brief_items")).toBe(true);

    await externalStore.insertExternalSourceDocument({
      documentId: "DOC-1",
      sourceId: "xinhua",
      sourceTier: "s",
      sourceUrl: "https://example.com/xinhua/1",
      title: "头部连锁在华东新增门店",
      summary: "区域门店扩张信号",
      contentText: "正文",
      publishedAt: "2026-04-02T08:10:00.000Z",
      eventAt: "2026-04-02T07:30:00.000Z",
      fetchedAt: "2026-04-02T08:12:00.000Z",
      theme: "chain-brand",
      rawJson: JSON.stringify({ id: "DOC-1" }),
    });
    await externalStore.insertExternalSourceDocument({
      documentId: "DOC-2",
      sourceId: "portal",
      sourceTier: "a",
      sourceUrl: "https://example.com/portal/2",
      title: "旧闻转载",
      summary: "无新增进展",
      publishedAt: "2026-03-20T08:10:00.000Z",
      fetchedAt: "2026-04-02T08:12:30.000Z",
      theme: "general-hot-topic",
      blockedReason: "stale-resurfaced",
      rawJson: JSON.stringify({ id: "DOC-2" }),
    });

    await expect(
      externalStore.listFreshExternalSourceDocuments({
        sincePublishedAt: "2026-04-01T00:00:00.000Z",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        documentId: "DOC-1",
        sourceTier: "s",
        sourceUrl: "https://example.com/xinhua/1",
        title: "头部连锁在华东新增门店",
      }),
    ]);

    await externalStore.upsertExternalEventCandidate({
      candidateId: "CAND-1",
      sourceDocumentId: "DOC-1",
      sourceId: "xinhua",
      sourceTier: "s",
      sourceUrl: "https://example.com/xinhua/1",
      title: "头部连锁在华东新增门店",
      summary: "区域门店扩张信号",
      entity: "某头部连锁",
      action: "开店",
      object: "华东",
      theme: "chain-brand",
      normalizedKey: "brand-open-huadong",
      publishedAt: "2026-04-02T08:10:00.000Z",
      eventAt: "2026-04-02T07:30:00.000Z",
      score: 8.6,
      rawJson: JSON.stringify({ id: "CAND-1" }),
    });
    await externalStore.upsertExternalEventCandidate({
      candidateId: "CAND-2",
      sourceDocumentId: "DOC-2",
      sourceId: "portal",
      sourceTier: "a",
      sourceUrl: "https://example.com/portal/2",
      title: "头部连锁在华东新增门店",
      summary: "多家媒体跟进",
      entity: "某头部连锁",
      action: "开店",
      object: "华东",
      theme: "chain-brand",
      normalizedKey: "brand-open-huadong",
      publishedAt: "2026-04-02T09:10:00.000Z",
      eventAt: "2026-04-02T07:30:00.000Z",
      score: 7.9,
      rawJson: JSON.stringify({ id: "CAND-2" }),
    });

    await externalStore.upsertExternalEventCard({
      cardId: "CARD-1",
      theme: "chain-brand",
      entity: "某头部连锁",
      action: "开店",
      object: "华东",
      summary: "同一事件聚类为一张卡片",
      publishedAt: "2026-04-02T09:10:00.000Z",
      eventAt: "2026-04-02T07:30:00.000Z",
      score: 8.8,
      sourceTier: "s",
      sourceUrls: ["https://example.com/xinhua/1", "https://example.com/portal/2"],
      sourceDocumentIds: ["DOC-1", "DOC-2"],
      candidateIds: ["CAND-1", "CAND-2"],
    });

    await expect(
      externalStore.listExternalEventCards({
        issueDate: "2026-04-02",
        theme: "chain-brand",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        cardId: "CARD-1",
        theme: "chain-brand",
        candidateIds: ["CAND-1", "CAND-2"],
      }),
    ]);

    await externalStore.createExternalBriefIssue({
      issueId: "ISSUE-2026-04-02",
      issueDate: "2026-04-02",
      topic: "全网热点+连锁+战略",
      createdAt: "2026-04-02T10:00:00.000Z",
    });
    await externalStore.insertExternalBriefItems("ISSUE-2026-04-02", [
      {
        itemId: "ITEM-2",
        cardId: "CARD-1",
        title: "第二条",
        theme: "chain-brand",
        summary: "摘要2",
        whyItMatters: "影响2",
        score: 8.2,
        rank: 2,
      },
      {
        itemId: "ITEM-1",
        cardId: "CARD-1",
        title: "第一条",
        theme: "chain-brand",
        summary: "摘要1",
        whyItMatters: "影响1",
        score: 9.1,
        rank: 1,
      },
    ]);

    await expect(externalStore.listExternalBriefItems("ISSUE-2026-04-02")).resolves.toEqual([
      expect.objectContaining({ itemId: "ITEM-1", rank: 1 }),
      expect.objectContaining({ itemId: "ITEM-2", rank: 2 }),
    ]);

    await externalStore.insertExternalBriefItems("ISSUE-2026-04-02", [
      {
        itemId: "ITEM-1",
        cardId: "CARD-1",
        title: "第一条-重排后",
        theme: "chain-brand",
        summary: "摘要1-重排后",
        whyItMatters: "影响1-重排后",
        score: 9.2,
        rank: 2,
      },
      {
        itemId: "ITEM-2",
        cardId: "CARD-1",
        title: "第二条-重排后",
        theme: "chain-brand",
        summary: "摘要2-重排后",
        whyItMatters: "影响2-重排后",
        score: 8.3,
        rank: 1,
      },
    ]);

    await expect(externalStore.listExternalBriefItems("ISSUE-2026-04-02")).resolves.toEqual([
      expect.objectContaining({ itemId: "ITEM-2", rank: 1, title: "第二条-重排后" }),
      expect.objectContaining({ itemId: "ITEM-1", rank: 2, title: "第一条-重排后" }),
    ]);

    expect(await store.countRows("external_source_documents")).toBe(2);
    expect(await store.countRows("external_event_candidates")).toBe(2);
    expect(await store.countRows("external_event_cards")).toBe(1);
    expect(await store.countRows("external_brief_issues")).toBe(1);
    expect(await store.countRows("external_brief_items")).toBe(2);

    await store.close();
    await pool.end();
  });

  it("stores and advances deep-analysis jobs through queue, completion, delivery, and failure states", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      listAnalysisJobs: (params?: { status?: string }) => Promise<Record<string, unknown>[]>;
      claimNextPendingAnalysisJob: (params: {
        startedAt: string;
      }) => Promise<Record<string, unknown> | null>;
      completeAnalysisJob: (params: {
        jobId: string;
        resultText: string;
        finishedAt: string;
      }) => Promise<void>;
      failAnalysisJob: (params: {
        jobId: string;
        errorMessage: string;
        finishedAt: string;
      }) => Promise<void>;
      markAnalysisJobDelivered: (params: { jobId: string; deliveredAt: string }) => Promise<void>;
    };

    await store.initialize();

    await analysisStore.createAnalysisJob({
      jobId: "JOB-1",
      capabilityId: "store_review_async_v1",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      accountId: "default",
      threadId: "thread-1",
      senderId: "zhangsan",
      status: "pending",
      attemptCount: 0,
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:00:00.000Z",
    });
    await analysisStore.createAnalysisJob({
      jobId: "JOB-2",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "pending",
      attemptCount: 0,
      createdAt: "2026-03-30T09:10:00.000Z",
      updatedAt: "2026-03-30T09:10:00.000Z",
    });

    expect(await analysisStore.listAnalysisJobs({ status: "pending" })).toHaveLength(2);

    await expect(
      analysisStore.claimNextPendingAnalysisJob({
        startedAt: "2026-03-30T09:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      capabilityId: "store_review_async_v1",
      jobId: "JOB-1",
      status: "running",
      attemptCount: 1,
    });

    await analysisStore.completeAnalysisJob({
      jobId: "JOB-1",
      resultText: "七日复盘结论",
      finishedAt: "2026-03-30T09:02:00.000Z",
    });
    await analysisStore.markAnalysisJobDelivered({
      jobId: "JOB-1",
      deliveredAt: "2026-03-30T09:03:00.000Z",
    });
    await analysisStore.claimNextPendingAnalysisJob({
      startedAt: "2026-03-30T09:11:00.000Z",
    });
    await analysisStore.failAnalysisJob({
      jobId: "JOB-2",
      errorMessage: "sidecar boom",
      finishedAt: "2026-03-30T09:12:00.000Z",
    });

    await expect(analysisStore.listAnalysisJobs({ status: "completed" })).resolves.toEqual([
      expect.objectContaining({
        capabilityId: "store_review_async_v1",
        jobId: "JOB-1",
        resultText: "七日复盘结论",
        deliveredAt: "2026-03-30T09:03:00.000Z",
      }),
    ]);
    await expect(analysisStore.listAnalysisJobs({ status: "failed" })).resolves.toEqual([
      expect.objectContaining({
        jobId: "JOB-2",
        errorMessage: "sidecar boom",
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("reclaims stale running analysis jobs after the stale cutoff", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      claimNextPendingAnalysisJob: (params: {
        startedAt: string;
        staleBefore?: string;
      }) => Promise<Record<string, unknown> | null>;
    };

    await store.initialize();

    await analysisStore.createAnalysisJob({
      jobId: "JOB-STALE",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "running",
      attemptCount: 1,
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      startedAt: "2026-03-30T09:05:00.000Z",
    });

    await expect(
      analysisStore.claimNextPendingAnalysisJob({
        startedAt: "2026-03-30T09:40:00.000Z",
        staleBefore: "2026-03-30T09:20:00.000Z",
      }),
    ).resolves.toMatchObject({
      jobId: "JOB-STALE",
      status: "running",
      attemptCount: 2,
      startedAt: "2026-03-30T09:40:00.000Z",
      updatedAt: "2026-03-30T09:40:00.000Z",
    });

    await store.close();
    await pool.end();
  });

  it("persists scheduled job state for resumable nightly backfill progress", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.setScheduledJobState(
      "nightly-history-backfill",
      "default",
      {
        anchorStartBizDate: "2025-10-01",
        anchorEndBizDate: "2026-03-29",
        stores: [{ orgId: "1001", nextStartBizDate: "2025-10-08" }],
      },
      "2026-03-31T03:12:00.000Z",
    );

    await expect(
      store.getScheduledJobState("nightly-history-backfill", "default"),
    ).resolves.toEqual({
      anchorStartBizDate: "2025-10-01",
      anchorEndBizDate: "2026-03-29",
      stores: [{ orgId: "1001", nextStartBizDate: "2025-10-08" }],
    });

    await store.close();
    await pool.end();
  });

  it("summarizes historical raw and derived coverage for a store", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.upsertMemberCurrent([
      {
        orgId: "1001",
        memberId: "M-1",
        name: "测试会员",
        phone: "13800000000",
        storedAmount: 500,
        consumeAmount: 1200,
        createdTime: "2026-03-01 10:00:00",
        lastConsumeTime: "2026-04-03 15:00:00",
        silentDays: 0,
        rawJson: "{}",
      },
    ]);
    await store.upsertConsumeBills([
      {
        orgId: "1001",
        settleId: "S-1",
        settleNo: "NO-1",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-04-01 12:00:00",
        bizDate: "2026-04-01",
        rawJson: "{}",
      },
      {
        orgId: "1001",
        settleId: "S-2",
        settleNo: "NO-2",
        payAmount: 280,
        consumeAmount: 280,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-04-02 12:00:00",
        bizDate: "2026-04-02",
        rawJson: "{}",
      },
    ]);
    await store.upsertRechargeBills([
      {
        orgId: "1001",
        rechargeId: "R-1",
        realityAmount: 1000,
        totalAmount: 1000,
        donateAmount: 0,
        antiFlag: false,
        optTime: "2026-04-01 13:00:00",
        bizDate: "2026-04-01",
        rawJson: "{}",
      },
    ]);
    await store.upsertTechUpClockRows([
      {
        orgId: "1001",
        rowFingerprint: "TU-1",
        personCode: "T-1",
        personName: "技师甲",
        settleNo: "NO-1",
        count: 1,
        turnover: 300,
        comm: 90,
        settleTime: "2026-04-03 14:00:00",
        bizDate: "2026-04-03",
        rawJson: "{}",
      },
    ]);
    await store.replaceMemberDailySnapshots("1001", "2026-04-01", [
      {
        orgId: "1001",
        memberId: "M-1",
        name: "测试会员",
        storedAmount: 600,
        consumeAmount: 900,
        lastConsumeTime: "2026-04-01 12:00:00",
        silentDays: 2,
        rawJson: "{}",
      },
    ]);
    await store.replaceMemberDailySnapshots("1001", "2026-04-03", [
      {
        orgId: "1001",
        memberId: "M-1",
        name: "测试会员",
        storedAmount: 500,
        consumeAmount: 1200,
        lastConsumeTime: "2026-04-03 15:00:00",
        silentDays: 0,
        rawJson: "{}",
      },
    ]);
    await store.replaceCustomerSegments(
      "1001",
      "2026-04-03",
      [
        {
          orgId: "1001",
          bizDate: "2026-04-03",
          customerIdentityKey: "member:M-1",
          customerIdentityType: "member",
          customerDisplayName: "测试会员",
          memberId: "M-1",
          identityStable: true,
          segmentEligible: true,
          firstBizDate: "2026-04-01",
          lastBizDate: "2026-04-03",
          daysSinceLastVisit: 0,
          visitCount30d: 2,
          visitCount90d: 2,
          payAmount30d: 580,
          payAmount90d: 580,
          memberPayAmount90d: 580,
          groupbuyAmount90d: 0,
          directPayAmount90d: 0,
          distinctTechCount90d: 1,
          topTechCode: "T-1",
          topTechName: "技师甲",
          topTechVisitCount90d: 2,
          topTechVisitShare90d: 1,
          recencySegment: "active-7d",
          frequencySegment: "medium-2-3",
          monetarySegment: "medium-300-999",
          paymentSegment: "member-only",
          techLoyaltySegment: "single-tech-loyal",
          primarySegment: "active-member",
          tagKeys: ["active-member"],
          rawJson: "{}",
        },
      ],
      "2026-04-04T00:00:00.000Z",
      { refreshViews: false },
    );
    await store.replaceCustomerConversionCohorts(
      "1001",
      "2026-04-03",
      [
        {
          orgId: "1001",
          bizDate: "2026-04-03",
          customerIdentityKey: "member:M-1",
          customerIdentityType: "member",
          customerDisplayName: "测试会员",
          memberId: "M-1",
          identityStable: true,
          firstGroupbuyAmount: 0,
          firstObservedBizDate: "2026-04-01",
          lastObservedBizDate: "2026-04-03",
          firstObservedIsGroupbuy: false,
          revisitWithin7d: true,
          revisitWithin30d: true,
          cardOpenedWithin7d: false,
          storedValueConvertedWithin7d: true,
          memberPayConvertedWithin30d: true,
          visitCount30dAfterGroupbuy: 2,
          payAmount30dAfterGroupbuy: 580,
          memberPayAmount30dAfterGroupbuy: 580,
          highValueMemberWithin30d: false,
          rawJson: "{}",
        },
      ],
      "2026-04-04T00:00:00.000Z",
      { refreshViews: false },
    );
    const coverageStore = store as unknown as {
      getHistoricalCoverageSnapshot: (params: {
        orgId: string;
        startBizDate: string;
        endBizDate: string;
      }) => Promise<Record<string, unknown>>;
    };

    await expect(
      coverageStore.getHistoricalCoverageSnapshot({
        orgId: "1001",
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-03",
      }),
    ).resolves.toEqual({
      orgId: "1001",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
      rawFacts: {
        "1.2": {
          rowCount: 2,
          dayCount: 2,
          minBizDate: "2026-04-01",
          maxBizDate: "2026-04-02",
          firstMissingBizDate: "2026-04-03",
        },
        "1.3": {
          rowCount: 1,
          dayCount: 1,
          minBizDate: "2026-04-01",
          maxBizDate: "2026-04-01",
          firstMissingBizDate: "2026-04-02",
        },
        "1.4": {
          rowCount: 0,
          dayCount: 0,
          minBizDate: undefined,
          maxBizDate: undefined,
          firstMissingBizDate: undefined,
        },
        "1.6": {
          rowCount: 1,
          dayCount: 1,
          minBizDate: "2026-04-03",
          maxBizDate: "2026-04-03",
          firstMissingBizDate: "2026-04-01",
        },
        "1.7": {
          rowCount: 0,
          dayCount: 0,
          minBizDate: undefined,
          maxBizDate: undefined,
          firstMissingBizDate: undefined,
        },
      },
      derivedLayers: {
        factMemberDailySnapshot: {
          rowCount: 2,
          dayCount: 2,
          minBizDate: "2026-04-01",
          maxBizDate: "2026-04-03",
          firstMissingBizDate: undefined,
        },
        martCustomerSegments: {
          rowCount: 1,
          dayCount: 1,
          minBizDate: "2026-04-03",
          maxBizDate: "2026-04-03",
          firstMissingBizDate: undefined,
        },
        martCustomerConversionCohorts: {
          rowCount: 1,
          dayCount: 1,
          minBizDate: "2026-04-03",
          maxBizDate: "2026-04-03",
          firstMissingBizDate: undefined,
        },
        mvCustomerProfile90d: {
          rowCount: 1,
          dayCount: 1,
          minBizDate: "2026-04-03",
          maxBizDate: "2026-04-03",
          firstMissingBizDate: undefined,
        },
      },
    });

    await store.close();
    await pool.end();
  });

  it("does not treat a single zero-row raw api backfill window as historical coverage", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.recordRawBatch({
      batchId: "batch-1",
      syncRunId: "sync-1",
      endpoint: "1.2",
      orgId: "1001",
      fetchedAt: "2026-04-08T03:00:00.000Z",
      requestJson: JSON.stringify({
        OrgId: "1001",
        Stime: "2025-10-06 03:00:00",
        Etime: "2025-10-13 02:59:59",
      }),
      responseJson: "[]",
      rowCount: 0,
    });
    await store.recordRawBatch({
      batchId: "batch-2",
      syncRunId: "sync-2",
      endpoint: "1.2",
      orgId: "1001",
      fetchedAt: "2026-04-08T03:15:00.000Z",
      requestJson: JSON.stringify({
        OrgId: "1001",
        Stime: "2025-10-13 03:00:00",
        Etime: "2025-10-20 02:59:59",
      }),
      responseJson: "[]",
      rowCount: 0,
    });

    const snapshot = await (
      store as unknown as {
        getHistoricalCoverageSnapshot: (params: {
          orgId: string;
          startBizDate: string;
          endBizDate: string;
        }) => Promise<{
          rawFacts: Partial<Record<string, { dayCount: number; minBizDate?: string; maxBizDate?: string }>>;
        }>;
      }
    ).getHistoricalCoverageSnapshot({
      orgId: "1001",
      startBizDate: "2025-10-06",
      endBizDate: "2025-10-20",
    });

    expect(snapshot.rawFacts["1.2"]).toMatchObject({
      dayCount: 0,
      minBizDate: undefined,
      maxBizDate: undefined,
    });

    await store.close();
    await pool.end();
  });

  it("does not treat a non-zero raw api backfill window as full daily coverage", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.recordRawBatch({
      batchId: "batch-1",
      syncRunId: "sync-1",
      endpoint: "1.2",
      orgId: "1001",
      fetchedAt: "2026-04-03T03:00:00.000Z",
      requestJson: JSON.stringify({
        OrgId: "1001",
        Stime: "2026-04-01 03:00:00",
        Etime: "2026-04-04 02:59:59",
      }),
      responseJson: '[{"SettleId":"S-1"}]',
      rowCount: 1,
    });
    await store.upsertConsumeBills([
      {
        orgId: "1001",
        settleId: "S-1",
        settleNo: "NO-1",
        payAmount: 300,
        consumeAmount: 300,
        discountAmount: 0,
        antiFlag: false,
        optTime: "2026-04-02 12:00:00",
        bizDate: "2026-04-02",
        rawJson: "{}",
      },
    ]);

    const snapshot = await (
      store as unknown as {
        getHistoricalCoverageSnapshot: (params: {
          orgId: string;
          startBizDate: string;
          endBizDate: string;
        }) => Promise<{
          rawFacts: Partial<
            Record<
              string,
              {
                dayCount: number;
                minBizDate?: string;
                maxBizDate?: string;
                firstMissingBizDate?: string;
              }
            >
          >;
        }>;
      }
    ).getHistoricalCoverageSnapshot({
      orgId: "1001",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-03",
    });

    expect(snapshot.rawFacts["1.2"]).toMatchObject({
      dayCount: 1,
      minBizDate: "2026-04-02",
      maxBizDate: "2026-04-02",
      firstMissingBizDate: "2026-04-01",
    });

    await store.close();
    await pool.end();
  });

  it("treats repeated zero-row raw api backfill windows as provisional historical coverage", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    for (const [index, fetchedAt] of [
      "2026-04-08T03:00:00.000Z",
      "2026-04-09T03:00:00.000Z",
    ].entries()) {
      await store.recordRawBatch({
        batchId: `batch-${index + 1}`,
        syncRunId: `sync-${index + 1}`,
        endpoint: "1.2",
        orgId: "1001",
        fetchedAt,
        requestJson: JSON.stringify({
          OrgId: "1001",
          Stime: "2025-10-06 03:00:00",
          Etime: "2025-10-13 02:59:59",
        }),
        responseJson: "[]",
        rowCount: 0,
      });
    }

    const snapshot = await (
      store as unknown as {
        getHistoricalCoverageSnapshot: (params: {
          orgId: string;
          startBizDate: string;
          endBizDate: string;
        }) => Promise<{
          rawFacts: Partial<Record<string, { dayCount: number; minBizDate?: string; maxBizDate?: string }>>;
        }>;
      }
    ).getHistoricalCoverageSnapshot({
      orgId: "1001",
      startBizDate: "2025-10-06",
      endBizDate: "2025-10-20",
    });

    expect(snapshot.rawFacts["1.2"]).toMatchObject({
      dayCount: 7,
      minBizDate: "2025-10-06",
      maxBizDate: "2025-10-12",
    });

    await store.close();
    await pool.end();
  });

  it("reuses matching analysis windows and lets failed jobs be retried", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      findReusableAnalysisJob: (params: {
        jobType: string;
        orgId: string;
        startBizDate: string;
        endBizDate: string;
      }) => Promise<Record<string, unknown> | null>;
      retryAnalysisJob: (params: {
        jobId: string;
        retriedAt: string;
      }) => Promise<Record<string, unknown> | null>;
      getAnalysisJob: (jobId: string) => Promise<Record<string, unknown> | null>;
    };

    await store.initialize();

    await analysisStore.createAnalysisJob({
      jobId: "JOB-COMPLETED",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "已完成复盘",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
      deliveredAt: "2026-03-30T09:06:00.000Z",
    });
    await analysisStore.createAnalysisJob({
      jobId: "JOB-RUNNING",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-2",
      status: "running",
      attemptCount: 1,
      createdAt: "2026-03-30T09:10:00.000Z",
      updatedAt: "2026-03-30T09:11:00.000Z",
      startedAt: "2026-03-30T09:11:00.000Z",
    });
    await analysisStore.createAnalysisJob({
      jobId: "JOB-FAILED",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近30天经营复盘",
      timeFrameLabel: "近30天",
      startBizDate: "2026-03-01",
      endBizDate: "2026-03-30",
      channel: "wecom",
      target: "conversation-3",
      status: "failed",
      attemptCount: 2,
      errorMessage: "sidecar boom",
      createdAt: "2026-03-30T09:20:00.000Z",
      updatedAt: "2026-03-30T09:21:00.000Z",
      finishedAt: "2026-03-30T09:21:00.000Z",
      deliveredAt: "2026-03-30T09:22:00.000Z",
    });

    await expect(
      analysisStore.findReusableAnalysisJob({
        jobType: "store_review",
        orgId: "1001",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
      }),
    ).resolves.toMatchObject({
      jobId: "JOB-RUNNING",
      status: "running",
    });

    await expect(
      analysisStore.findReusableAnalysisJob({
        jobType: "store_review",
        orgId: "1001",
        startBizDate: "2026-03-01",
        endBizDate: "2026-03-30",
      }),
    ).resolves.toBeNull();

    await expect(
      analysisStore.retryAnalysisJob({
        jobId: "JOB-FAILED",
        retriedAt: "2026-03-30T09:25:00.000Z",
      }),
    ).resolves.toMatchObject({
      jobId: "JOB-FAILED",
      status: "pending",
      attemptCount: 2,
      errorMessage: undefined,
      finishedAt: undefined,
      deliveredAt: undefined,
    });

    await expect(analysisStore.getAnalysisJob("JOB-FAILED")).resolves.toMatchObject({
      jobId: "JOB-FAILED",
      status: "pending",
      startedAt: undefined,
      finishedAt: undefined,
      deliveredAt: undefined,
    });

    await store.close();
    await pool.end();
  });

  it("tracks analysis subscribers and fan-out delivery state", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      upsertAnalysisSubscriber: (params: {
        jobId: string;
        channel: string;
        target: string;
        accountId?: string;
        threadId?: string;
        senderId?: string;
        createdAt: string;
      }) => Promise<Record<string, unknown>>;
      listAnalysisSubscribers: (jobId: string) => Promise<Record<string, unknown>[]>;
      getNextDeliverableAnalysisSubscription: (
        asOf?: string,
      ) => Promise<Record<string, unknown> | null>;
      markAnalysisSubscriberDelivered: (params: {
        subscriberKey: string;
        deliveredAt: string;
      }) => Promise<void>;
      markAnalysisSubscriberDeliveryAttempt: (params: {
        subscriberKey: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
      refreshAnalysisJobDeliveryState: (params: {
        jobId: string;
        deliveredAt: string;
      }) => Promise<void>;
      getAnalysisJob: (jobId: string) => Promise<Record<string, unknown> | null>;
    };

    await store.initialize();
    await analysisStore.createAnalysisJob({
      jobId: "JOB-SUB",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });

    const subscriberA = await analysisStore.upsertAnalysisSubscriber({
      jobId: "JOB-SUB",
      channel: "wecom",
      target: "conversation-a",
      createdAt: "2026-03-30T09:05:30.000Z",
    });
    await analysisStore.upsertAnalysisSubscriber({
      jobId: "JOB-SUB",
      channel: "wecom",
      target: "conversation-b",
      createdAt: "2026-03-30T09:05:40.000Z",
    });

    await expect(analysisStore.listAnalysisSubscribers("JOB-SUB")).resolves.toHaveLength(2);
    await expect(analysisStore.getNextDeliverableAnalysisSubscription()).resolves.toMatchObject({
      jobId: "JOB-SUB",
      deliveryTarget: "conversation-a",
    });

    await analysisStore.markAnalysisSubscriberDeliveryAttempt({
      subscriberKey: String(subscriberA.subscriberKey),
      attemptedAt: "2026-03-30T09:05:45.000Z",
      errorMessage: "invalid chatid",
      nextDeliveryAfter: "2026-03-30T09:06:15.000Z",
    });
    await expect(
      analysisStore.getNextDeliverableAnalysisSubscription("2026-03-30T09:06:00.000Z"),
    ).resolves.toMatchObject({
      jobId: "JOB-SUB",
      deliveryTarget: "conversation-b",
    });

    await analysisStore.markAnalysisSubscriberDelivered({
      subscriberKey: String(subscriberA.subscriberKey),
      deliveredAt: "2026-03-30T09:06:00.000Z",
    });
    await analysisStore.refreshAnalysisJobDeliveryState({
      jobId: "JOB-SUB",
      deliveredAt: "2026-03-30T09:06:00.000Z",
    });

    await expect(analysisStore.getAnalysisJob("JOB-SUB")).resolves.toMatchObject({
      jobId: "JOB-SUB",
      deliveredAt: undefined,
    });

    const nextSubscriber = await analysisStore.getNextDeliverableAnalysisSubscription();
    await analysisStore.markAnalysisSubscriberDelivered({
      subscriberKey: String(nextSubscriber?.subscriberKey),
      deliveredAt: "2026-03-30T09:06:30.000Z",
    });
    await analysisStore.refreshAnalysisJobDeliveryState({
      jobId: "JOB-SUB",
      deliveredAt: "2026-03-30T09:06:30.000Z",
    });

    await expect(analysisStore.getAnalysisJob("JOB-SUB")).resolves.toMatchObject({
      jobId: "JOB-SUB",
      deliveredAt: "2026-03-30T09:06:30.000Z",
    });

    await store.close();
    await pool.end();
  });

  it("skips deferred job-level analysis deliveries until their retry window opens", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      getNextDeliverableAnalysisJob: (asOf?: string) => Promise<Record<string, unknown> | null>;
      markAnalysisJobDeliveryAttempt: (params: {
        jobId: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
    };

    await store.initialize();
    await analysisStore.createAnalysisJob({
      jobId: "JOB-DELIVERY",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });

    await analysisStore.markAnalysisJobDeliveryAttempt({
      jobId: "JOB-DELIVERY",
      attemptedAt: "2026-03-30T09:05:30.000Z",
      errorMessage: "delivery endpoint down",
      nextDeliveryAfter: "2026-03-30T09:10:00.000Z",
    });

    await expect(
      analysisStore.getNextDeliverableAnalysisJob("2026-03-30T09:09:59.000Z"),
    ).resolves.toBeNull();
    await expect(
      analysisStore.getNextDeliverableAnalysisJob("2026-03-30T09:10:00.000Z"),
    ).resolves.toMatchObject({
      jobId: "JOB-DELIVERY",
    });

    await store.close();
    await pool.end();
  });

  it("dead-letters job-level analysis delivery after repeated failures", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      getNextDeliverableAnalysisJob: (asOf?: string) => Promise<Record<string, unknown> | null>;
      getAnalysisJob: (jobId: string) => Promise<Record<string, unknown> | null>;
      markAnalysisJobDeliveryAttempt: (params: {
        jobId: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
    };

    await store.initialize();
    await analysisStore.createAnalysisJob({
      jobId: "JOB-DEAD",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });

    for (const attemptedAt of [
      "2026-03-30T09:05:30.000Z",
      "2026-03-30T09:10:30.000Z",
      "2026-03-30T09:15:30.000Z",
    ]) {
      await analysisStore.markAnalysisJobDeliveryAttempt({
        jobId: "JOB-DEAD",
        attemptedAt,
        errorMessage: "invalid chatid",
        nextDeliveryAfter: "2026-03-30T09:20:00.000Z",
      });
    }

    await expect(
      analysisStore.getNextDeliverableAnalysisJob("2026-03-30T09:30:00.000Z"),
    ).resolves.toBeNull();
    await expect(analysisStore.getAnalysisJob("JOB-DEAD")).resolves.toMatchObject({
      jobId: "JOB-DEAD",
      deliveredAt: undefined,
      deliveryAbandonedAt: "2026-03-30T09:15:30.000Z",
      deliveryAttemptCount: 3,
      lastDeliveryError: "invalid chatid",
    });
    const deadLetters = await pool.query(
      `
        SELECT dead_letter_scope, reason
        FROM analysis_dead_letters
        WHERE job_id = $1
        ORDER BY created_at ASC
      `,
      ["JOB-DEAD"],
    );
    expect(deadLetters.rows).toEqual([
      {
        dead_letter_scope: "job",
        reason: "invalid chatid",
      },
    ]);

    await store.close();
    await pool.end();
  });

  it("dead-letters subscriber delivery after repeated failures and closes the fan-out job", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      upsertAnalysisSubscriber: (params: {
        jobId: string;
        channel: string;
        target: string;
        createdAt: string;
      }) => Promise<Record<string, unknown>>;
      getNextDeliverableAnalysisSubscription: (
        asOf?: string,
      ) => Promise<Record<string, unknown> | null>;
      listAnalysisSubscribers: (jobId: string) => Promise<Record<string, unknown>[]>;
      getAnalysisJob: (jobId: string) => Promise<Record<string, unknown> | null>;
      markAnalysisSubscriberDeliveryAttempt: (params: {
        subscriberKey: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
      getAnalysisDeadLetterSummary: () => Promise<Record<string, unknown> | null>;
    };

    await store.initialize();
    await analysisStore.createAnalysisJob({
      jobId: "JOB-SUB-DEAD",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });

    const subscriber = await analysisStore.upsertAnalysisSubscriber({
      jobId: "JOB-SUB-DEAD",
      channel: "wecom",
      target: "conversation-dead",
      createdAt: "2026-03-30T09:05:30.000Z",
    });

    for (const attemptedAt of [
      "2026-03-30T09:05:40.000Z",
      "2026-03-30T09:10:40.000Z",
      "2026-03-30T09:15:40.000Z",
    ]) {
      await analysisStore.markAnalysisSubscriberDeliveryAttempt({
        subscriberKey: String(subscriber.subscriberKey),
        attemptedAt,
        errorMessage: "invalid chatid",
        nextDeliveryAfter: "2026-03-30T09:20:00.000Z",
      });
    }

    await expect(
      analysisStore.getNextDeliverableAnalysisSubscription("2026-03-30T09:30:00.000Z"),
    ).resolves.toBeNull();
    await expect(analysisStore.listAnalysisSubscribers("JOB-SUB-DEAD")).resolves.toEqual([
      expect.objectContaining({
        subscriberKey: String(subscriber.subscriberKey),
        deliveryAbandonedAt: "2026-03-30T09:15:40.000Z",
        deliveryAttemptCount: 3,
        lastDeliveryError: "invalid chatid",
      }),
    ]);
    await expect(analysisStore.getAnalysisJob("JOB-SUB-DEAD")).resolves.toMatchObject({
      jobId: "JOB-SUB-DEAD",
      deliveryAbandonedAt: "2026-03-30T09:15:40.000Z",
    });
    const deadLetters = await pool.query(
      `
        SELECT dead_letter_scope, reason
        FROM analysis_dead_letters
        WHERE job_id = $1
        ORDER BY created_at ASC
      `,
      ["JOB-SUB-DEAD"],
    );
    expect(deadLetters.rows).toEqual([
      {
        dead_letter_scope: "subscriber",
        reason: "invalid chatid",
      },
      {
        dead_letter_scope: "job",
        reason: "delivery abandoned after subscriber fan-out exhaustion",
      },
    ]);
    await expect(analysisStore.getAnalysisDeadLetterSummary()).resolves.toMatchObject({
      unresolvedJobCount: 1,
      unresolvedSubscriberCount: 1,
      latestReason: "invalid chatid",
      invalidChatidSubscriberCount: 1,
      subscriberFanoutExhaustedJobCount: 1,
    });

    await store.close();
    await pool.end();
  });

  it("summarizes analysis delivery health across direct jobs and subscriber fan-out", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      upsertAnalysisSubscriber: (params: {
        jobId: string;
        channel: string;
        target: string;
        createdAt: string;
      }) => Promise<Record<string, unknown>>;
      markAnalysisJobDeliveryAttempt: (params: {
        jobId: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
      markAnalysisSubscriberDeliveryAttempt: (params: {
        subscriberKey: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
      getAnalysisDeliveryHealthSummary: () => Promise<Record<string, number>>;
    };

    await store.initialize();
    await analysisStore.createAnalysisJob({
      jobId: "JOB-PENDING",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-pending",
      status: "completed",
      attemptCount: 1,
      resultText: "pending delivery",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });
    await analysisStore.createAnalysisJob({
      jobId: "JOB-RETRY",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-retry",
      status: "completed",
      attemptCount: 1,
      resultText: "retry delivery",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });
    await analysisStore.markAnalysisJobDeliveryAttempt({
      jobId: "JOB-RETRY",
      attemptedAt: "2026-03-30T09:05:30.000Z",
      errorMessage: "timeout",
      nextDeliveryAfter: "2026-03-30T09:20:00.000Z",
    });

    await analysisStore.createAnalysisJob({
      jobId: "JOB-ABANDONED",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-abandoned",
      status: "completed",
      attemptCount: 1,
      resultText: "abandoned delivery",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });
    for (const attemptedAt of [
      "2026-03-30T09:05:40.000Z",
      "2026-03-30T09:10:40.000Z",
      "2026-03-30T09:15:40.000Z",
    ]) {
      await analysisStore.markAnalysisJobDeliveryAttempt({
        jobId: "JOB-ABANDONED",
        attemptedAt,
        errorMessage: "invalid chatid",
        nextDeliveryAfter: "2026-03-30T09:20:00.000Z",
      });
    }

    await analysisStore.createAnalysisJob({
      jobId: "JOB-SUB",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-sub",
      status: "completed",
      attemptCount: 1,
      resultText: "subscriber delivery",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });

    const pendingSubscriber = await analysisStore.upsertAnalysisSubscriber({
      jobId: "JOB-SUB",
      channel: "wecom",
      target: "conversation-sub-pending",
      createdAt: "2026-03-30T09:05:10.000Z",
    });
    const retryingSubscriber = await analysisStore.upsertAnalysisSubscriber({
      jobId: "JOB-SUB",
      channel: "wecom",
      target: "conversation-sub-retry",
      createdAt: "2026-03-30T09:05:20.000Z",
    });
    await analysisStore.markAnalysisSubscriberDeliveryAttempt({
      subscriberKey: String(retryingSubscriber.subscriberKey),
      attemptedAt: "2026-03-30T09:06:00.000Z",
      errorMessage: "temporary failure",
      nextDeliveryAfter: "2026-03-30T09:25:00.000Z",
    });
    const abandonedSubscriber = await analysisStore.upsertAnalysisSubscriber({
      jobId: "JOB-SUB",
      channel: "wecom",
      target: "conversation-sub-abandoned",
      createdAt: "2026-03-30T09:05:30.000Z",
    });
    for (const attemptedAt of [
      "2026-03-30T09:06:10.000Z",
      "2026-03-30T09:10:10.000Z",
      "2026-03-30T09:15:10.000Z",
    ]) {
      await analysisStore.markAnalysisSubscriberDeliveryAttempt({
        subscriberKey: String(abandonedSubscriber.subscriberKey),
        attemptedAt,
        errorMessage: "invalid chatid",
        nextDeliveryAfter: "2026-03-30T09:20:00.000Z",
      });
    }

    await expect(analysisStore.getAnalysisDeliveryHealthSummary()).resolves.toEqual({
      jobPendingCount: 1,
      jobRetryingCount: 1,
      jobAbandonedCount: 1,
      subscriberPendingCount: 1,
      subscriberRetryingCount: 1,
      subscriberAbandonedCount: 1,
    });
    expect(pendingSubscriber.subscriberKey).toBeTruthy();

    await store.close();
    await pool.end();
  });

  it("lists unresolved analysis dead letters and replays abandoned delivery", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      getAnalysisJob: (jobId: string) => Promise<Record<string, unknown> | null>;
      markAnalysisJobDeliveryAttempt: (params: {
        jobId: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
      listAnalysisDeadLetters: (params?: Record<string, unknown>) => Promise<
        Array<Record<string, unknown>>
      >;
      replayAnalysisDeadLetter: (params: {
        deadLetterKey: string;
        replayedAt: string;
      }) => Promise<Record<string, unknown> | null>;
      getNextDeliverableAnalysisJob: (asOf?: string) => Promise<Record<string, unknown> | null>;
    };

    await store.initialize();
    await analysisStore.createAnalysisJob({
      jobId: "JOB-REPLAY",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-replay",
      status: "completed",
      attemptCount: 1,
      resultText: "需要重放",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });

    for (const attemptedAt of [
      "2026-03-30T09:05:30.000Z",
      "2026-03-30T09:10:30.000Z",
      "2026-03-30T09:15:30.000Z",
    ]) {
      await analysisStore.markAnalysisJobDeliveryAttempt({
        jobId: "JOB-REPLAY",
        attemptedAt,
        errorMessage: "invalid chatid",
        nextDeliveryAfter: "2026-03-30T09:20:00.000Z",
      });
    }

    const deadLetters = await analysisStore.listAnalysisDeadLetters({ orgId: "1001" });
    expect(deadLetters).toEqual([
      expect.objectContaining({
        jobId: "JOB-REPLAY",
        deadLetterScope: "job",
        reason: "invalid chatid",
        resolvedAt: undefined,
      }),
    ]);

    const replayed = await analysisStore.replayAnalysisDeadLetter({
      deadLetterKey: String(deadLetters[0]?.deadLetterKey),
      replayedAt: "2026-03-30T09:40:00.000Z",
    });
    expect(replayed).toMatchObject({
      deadLetterKey: String(deadLetters[0]?.deadLetterKey),
      resolvedAt: "2026-03-30T09:40:00.000Z",
    });
    await expect(analysisStore.getAnalysisJob("JOB-REPLAY")).resolves.toMatchObject({
      jobId: "JOB-REPLAY",
      deliveryAbandonedAt: undefined,
      deliveryAttemptCount: 0,
      lastDeliveryError: undefined,
    });
    await expect(
      analysisStore.getNextDeliverableAnalysisJob("2026-03-30T09:45:00.000Z"),
    ).resolves.toMatchObject({
      jobId: "JOB-REPLAY",
    });

    await store.close();
    await pool.end();
  });

  it("cleans stale invalid-chatid subscriber residuals without reopening delivery", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const analysisStore = store as unknown as {
      createAnalysisJob: (row: Record<string, unknown>) => Promise<void>;
      upsertAnalysisSubscriber: (params: {
        jobId: string;
        channel: string;
        target: string;
        createdAt: string;
      }) => Promise<Record<string, unknown>>;
      markAnalysisSubscriberDeliveryAttempt: (params: {
        subscriberKey: string;
        attemptedAt: string;
        errorMessage: string;
        nextDeliveryAfter: string;
      }) => Promise<void>;
      listAnalysisSubscribers: (jobId: string) => Promise<Record<string, unknown>[]>;
      getAnalysisJob: (jobId: string) => Promise<Record<string, unknown> | null>;
      listAnalysisDeadLetters: (params?: Record<string, unknown>) => Promise<
        Array<Record<string, unknown>>
      >;
      cleanupStaleInvalidChatidSubscriberResiduals: (params: {
        resolvedAt: string;
        staleBefore: string;
        limit?: number;
      }) => Promise<Record<string, unknown>>;
      getAnalysisDeadLetterSummary: () => Promise<Record<string, unknown> | null>;
    };

    await store.initialize();
    await analysisStore.createAnalysisJob({
      jobId: "JOB-SUB-CLEAN",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-clean",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
    });

    const subscriber = await analysisStore.upsertAnalysisSubscriber({
      jobId: "JOB-SUB-CLEAN",
      channel: "wecom",
      target: "conversation-stale-invalid",
      createdAt: "2026-03-30T09:05:30.000Z",
    });

    for (const attemptedAt of [
      "2026-03-30T09:05:40.000Z",
      "2026-03-30T09:10:40.000Z",
      "2026-03-30T09:15:40.000Z",
    ]) {
      await analysisStore.markAnalysisSubscriberDeliveryAttempt({
        subscriberKey: String(subscriber.subscriberKey),
        attemptedAt,
        errorMessage: "invalid chatid",
        nextDeliveryAfter: "2026-03-30T09:20:00.000Z",
      });
    }

    await expect(
      analysisStore.cleanupStaleInvalidChatidSubscriberResiduals({
        resolvedAt: "2026-04-16T15:40:00.000Z",
        staleBefore: "2026-04-15T15:40:00.000Z",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      cleanedSubscriberCount: 1,
      cleanedJobCount: 1,
      resolvedDeadLetterCount: 2,
    });
    await expect(analysisStore.listAnalysisSubscribers("JOB-SUB-CLEAN")).resolves.toEqual([
      expect.objectContaining({
        subscriberKey: String(subscriber.subscriberKey),
        deliveredAt: "2026-04-16T15:40:00.000Z",
        deliveryAbandonedAt: undefined,
        lastDeliveryError: undefined,
      }),
    ]);
    await expect(analysisStore.getAnalysisJob("JOB-SUB-CLEAN")).resolves.toMatchObject({
      jobId: "JOB-SUB-CLEAN",
      deliveredAt: "2026-04-16T15:40:00.000Z",
      deliveryAbandonedAt: undefined,
    });
    await expect(
      analysisStore.listAnalysisDeadLetters({ orgId: "1001", unresolvedOnly: true }),
    ).resolves.toEqual([]);
    await expect(analysisStore.getAnalysisDeadLetterSummary()).resolves.toBeNull();

    await store.close();
    await pool.end();
  });

  it("persists employee bindings, audits command access, and counts allowed usage in rolling windows", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.upsertEmployeeBinding({
      channel: "wecom",
      senderId: "zhangsan",
      employeeName: "张三",
      role: "manager",
      isActive: true,
      hourlyQuota: 6,
      dailyQuota: 30,
      notes: "店长",
      scopeOrgIds: ["1001", "1002"],
      updatedAt: "2026-03-30T08:55:00+08:00",
    });

    expect(
      await store.getEmployeeBinding({
        channel: "wecom",
        senderId: "zhangsan",
      }),
    ).toMatchObject({
      channel: "wecom",
      senderId: "zhangsan",
      employeeName: "张三",
      role: "manager",
      hourlyQuota: 6,
      dailyQuota: 30,
      scopeOrgIds: ["1001", "1002"],
    });

    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:00:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "report",
      requestedOrgId: "1001",
      effectiveOrgId: "1001",
      decision: "allowed",
      reason: "manager-default-store",
      commandBody: "/hetang report",
      responseExcerpt: "一号店 2026-03-29 日报",
    });
    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:20:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "report",
      requestedOrgId: "1001",
      effectiveOrgId: "1001",
      decision: "allowed",
      reason: "manager-default-store",
      commandBody: "/hetang report 2026-03-29",
      responseExcerpt: "一号店 2026-03-29 日报",
    });
    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:30:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "report",
      requestedOrgId: "1002",
      effectiveOrgId: undefined,
      decision: "denied",
      reason: "manager-cross-store",
      commandBody: "/hetang report 二号店",
      responseExcerpt: "仅允许查看绑定门店",
    });

    expect(
      await store.countAllowedCommandAudits({
        channel: "wecom",
        senderId: "zhangsan",
        since: "2026-03-30T09:00:00+08:00",
      }),
    ).toBe(2);
    expect(
      await store.countAllowedCommandAudits({
        channel: "wecom",
        senderId: "zhangsan",
        since: "2026-03-30T00:00:00+08:00",
      }),
    ).toBe(2);

    await store.revokeEmployeeBinding({
      channel: "wecom",
      senderId: "zhangsan",
      updatedAt: "2026-03-30T10:00:00+08:00",
    });

    expect(
      await store.getEmployeeBinding({
        channel: "wecom",
        senderId: "zhangsan",
      }),
    ).toBeNull();
    expect(await store.countRows("command_audit_logs")).toBe(3);

    await store.close();
    await pool.end();
  });

  it("derives single-store scopes from the legacy org_id field for backward compatibility", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.upsertEmployeeBinding({
      channel: "wecom",
      senderId: "lisi",
      employeeName: "李四",
      role: "manager",
      orgId: "1001",
      isActive: true,
      updatedAt: "2026-03-30T08:55:00+08:00",
    });

    expect(
      await store.getEmployeeBinding({
        channel: "wecom",
        senderId: "lisi",
      }),
    ).toMatchObject({
      senderId: "lisi",
      orgId: "1001",
      scopeOrgIds: ["1001"],
    });

    await store.close();
    await pool.end();
  });

  it("summarizes recent query entry decisions from command audits for doctor visibility", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:00:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "query",
      decision: "allowed",
      reason: "manager-own-store",
      commandBody: "/hetang query 一号店昨天营收多少",
      responseExcerpt: "服务营收 3200 元",
      queryEntrySource: "rule",
      queryEntryReason: "high-confidence-rule-intent",
    });
    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:05:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "query",
      decision: "allowed",
      reason: "manager-own-store",
      commandBody: "/hetang query 一号店营收怎么样",
      responseExcerpt: "你要看一号店昨天、近7天还是近30天？",
      queryEntrySource: "rule_clarifier",
      queryEntryReason: "missing-time",
    });
    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:10:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "query",
      decision: "allowed",
      reason: "manager-own-store",
      commandBody: "/hetang query 一号店昨天盘里收了多少",
      responseExcerpt: "服务营收 3200 元",
      queryEntrySource: "ai_fallback",
      queryEntryReason: "supported-unresolved-query",
    });
    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:12:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "query",
      decision: "allowed",
      reason: "manager-own-store",
      commandBody: "/hetang query 今天天气怎么样",
      responseExcerpt: "未识别为可执行的门店数据问题，请补充门店、时间或指标。",
      queryEntrySource: "none",
      queryEntryReason: "non-business-or-unsupported",
    });
    await store.recordCommandAudit({
      occurredAt: "2026-03-30T09:15:00+08:00",
      channel: "wecom",
      senderId: "zhangsan",
      commandName: "hetang",
      action: "status",
      decision: "allowed",
      reason: "hq-allowed",
      commandBody: "/hetang status",
      responseExcerpt: "ok",
    });

    expect(
      await store.getRecentCommandAuditSummary({
        channel: "wecom",
        windowHours: 24,
        now: new Date("2026-03-30T10:00:00+08:00"),
      }),
    ).toMatchObject({
      recentAllowedCount: 5,
      latestAction: "status",
      recentQueryCount: 4,
      recentQueryRuleCount: 1,
      recentQueryClarifyCount: 1,
      recentQueryAiFallbackCount: 1,
      recentQueryUnresolvedCount: 1,
      latestQueryOccurredAt: "2026-03-30T09:12:00+08:00",
      latestQueryEntrySource: "none",
      latestQueryEntryReason: "non-business-or-unsupported",
    });

    await store.close();
    await pool.end();
  });

  it("persists inbound message audits and lets operators query them back by content", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.recordInboundMessageAudit({
      requestId: "req-audit-1",
      channel: "wecom",
      senderId: "wecom-user-42",
      senderName: "李人培-安阳市区运营总",
      conversationId: "chat-yiwu",
      isGroup: true,
      wasMentioned: true,
      platformMessageId: "msg-42",
      content: "这几天义乌店的点钟率多少？加钟多少？",
      effectiveContent: "这几天义乌店的点钟率多少？加钟多少？",
      receivedAt: "2026-04-14T00:30:00+08:00",
      recordedAt: "2026-04-14T00:30:01+08:00",
    });
    await store.recordInboundMessageAudit({
      requestId: "req-audit-2",
      channel: "wecom",
      senderId: "other-user",
      senderName: "张三",
      conversationId: "chat-other",
      isGroup: true,
      content: "昨天营收多少",
      effectiveContent: "昨天营收多少",
      receivedAt: "2026-04-14T00:31:00+08:00",
      recordedAt: "2026-04-14T00:31:01+08:00",
    });

    const rows = await store.listInboundMessageAudits({
      channel: "wecom",
      contains: "义乌店",
      limit: 5,
    });

    expect(rows).toEqual([
      expect.objectContaining({
        requestId: "req-audit-1",
        senderId: "wecom-user-42",
        senderName: "李人培-安阳市区运营总",
        conversationId: "chat-yiwu",
        platformMessageId: "msg-42",
        content: "这几天义乌店的点钟率多少？加钟多少？",
      }),
    ]);
    expect(await store.countRows("inbound_message_audit_logs")).toBe(2);

    await store.close();
    await pool.end();
  });

  it("upserts duplicate daily alert codes without throwing and keeps one row per code", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    await store.replaceDailyAlerts("1001", "2026-03-29", [
      {
        code: "groupbuy-share-high",
        severity: "warn",
        message: "旧消息",
      },
      {
        code: "groupbuy-share-high",
        severity: "critical",
        message: "新消息",
      },
      {
        code: "stored-consume-low",
        severity: "warn",
        message: "储值偏低",
      },
    ]);

    await expect(store.getDailyAlerts("1001", "2026-03-29")).resolves.toEqual([
      {
        code: "groupbuy-share-high",
        severity: "critical",
        message: "新消息",
      },
      {
        code: "stored-consume-low",
        severity: "warn",
        message: "储值偏低",
      },
    ]);

    await store.close();
    await pool.end();
  });

  it("persists action-center items and resolves control-tower overrides with store precedence", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [
        { orgId: "1001", storeName: "一号店", rawAliases: [] },
        { orgId: "1002", storeName: "二号店", rawAliases: [] },
      ],
    });

    await store.initialize();

    await store.createActionItem({
      actionId: "ACT-1001",
      orgId: "1001",
      bizDate: "2026-03-31",
      category: "会员召回",
      title: "回访近 30 天沉默会员",
      priority: "high",
      status: "proposed",
      sourceKind: "manual",
      ownerName: "店长甲",
      createdByName: "总部甲",
      createdAt: "2026-04-01T09:00:00+08:00",
      updatedAt: "2026-04-01T09:00:00+08:00",
    });
    await store.createActionItem({
      actionId: "ACT-1002",
      orgId: "1001",
      bizDate: "2026-03-31",
      category: "排班优化",
      title: "晚场补 1 名可承接点钟技师",
      priority: "medium",
      status: "approved",
      sourceKind: "report",
      sourceRef: "daily-report:1001:2026-03-31",
      createdAt: "2026-04-01T09:05:00+08:00",
      updatedAt: "2026-04-01T09:05:00+08:00",
    });
    await store.updateActionItemStatus({
      actionId: "ACT-1002",
      status: "done",
      resultNote: "晚场总钟数回升",
      effectScore: 5,
      updatedAt: "2026-04-01T18:00:00+08:00",
      completedAt: "2026-04-01T18:00:00+08:00",
    });
    await store.createActionItem({
      actionId: "ACT-2001",
      orgId: "1002",
      category: "营销投放",
      title: "压缩低效团购预算",
      priority: "medium",
      status: "rejected",
      sourceKind: "manual",
      resultNote: "本周暂不执行",
      createdAt: "2026-04-01T09:10:00+08:00",
      updatedAt: "2026-04-01T09:10:00+08:00",
    });

    await store.upsertControlTowerSetting({
      scopeType: "global",
      scopeKey: "global",
      settingKey: "quota.hourlyLimit",
      value: 18,
      updatedAt: "2026-04-01T09:30:00+08:00",
      updatedBy: "hq-1",
    });
    await store.upsertControlTowerSetting({
      scopeType: "store",
      scopeKey: "1001",
      settingKey: "quota.hourlyLimit",
      value: 12,
      updatedAt: "2026-04-01T09:31:00+08:00",
      updatedBy: "hq-1",
    });
    await store.upsertControlTowerSetting({
      scopeType: "store",
      scopeKey: "1001",
      settingKey: "notification.enabled",
      value: false,
      updatedAt: "2026-04-01T09:32:00+08:00",
      updatedBy: "hq-1",
    });

    await expect(
      store.listActionItems({
        orgId: "1001",
      }),
    ).resolves.toMatchObject([
      {
        actionId: "ACT-1001",
        status: "proposed",
        category: "会员召回",
      },
      {
        actionId: "ACT-1002",
        status: "done",
        effectScore: 5,
        resultNote: "晚场总钟数回升",
      },
    ]);
    await expect(store.getActionItem("ACT-1002")).resolves.toMatchObject({
      actionId: "ACT-1002",
      status: "done",
      completedAt: "2026-04-01T18:00:00+08:00",
      effectScore: 5,
    });
    await expect(store.resolveControlTowerSettings("1001")).resolves.toEqual({
      "notification.enabled": false,
      "quota.hourlyLimit": 12,
    });
    await expect(store.resolveControlTowerSettings("1002")).resolves.toEqual({
      "quota.hourlyLimit": 18,
    });

    await store.close();
    await pool.end();
  });

  it("persists external intelligence source documents and freshness-filtered candidates", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const externalStore = store as unknown as {
      insertExternalSourceDocument: (document: {
        documentId: string;
        sourceId: string;
        sourceTier: "s" | "a" | "b" | "blocked";
        sourceUrl?: string;
        title: string;
        summary?: string;
        publishedAt: string;
        fetchedAt: string;
        eventAt?: string;
        entity?: string;
        action?: string;
        object?: string;
        theme?: string;
        score?: number;
        blockedReason?: string;
        rawJson: string;
      }) => Promise<void>;
      listExternalSourceDocuments: (params?: {
        sourceId?: string;
        publishedSince?: string;
        limit?: number;
      }) => Promise<Array<Record<string, unknown>>>;
      upsertExternalEventCandidate: (candidate: {
        candidateId: string;
        documentId: string;
        sourceId: string;
        sourceUrl?: string;
        title: string;
        summary: string;
        entity: string;
        action: string;
        object?: string;
        theme: string;
        publishedAt: string;
        eventAt?: string;
        tier: "s" | "a" | "b" | "blocked";
        score: number;
        blockedReason?: string;
        normalizedKey: string;
        rawJson?: string;
        createdAt?: string;
        updatedAt?: string;
      }) => Promise<void>;
      listExternalEventCandidates: (params?: {
        theme?: string;
        publishedSince?: string;
        includeBlocked?: boolean;
        limit?: number;
      }) => Promise<Array<Record<string, unknown>>>;
    };

    await store.initialize();

    expect(await store.tableExists("external_source_documents")).toBe(true);
    expect(await store.tableExists("external_event_candidates")).toBe(true);
    expect(await store.tableExists("external_event_cards")).toBe(true);
    expect(await store.tableExists("external_brief_issues")).toBe(true);
    expect(await store.tableExists("external_brief_items")).toBe(true);

    await externalStore.insertExternalSourceDocument({
      documentId: "doc-luckin-1",
      sourceId: "luckin-ir",
      sourceTier: "s",
      sourceUrl: "https://example.com/luckin-price-cut",
      title: "瑞幸回应部分饮品价格调整",
      summary: "首版摘要",
      publishedAt: "2026-04-02T09:00:00+08:00",
      fetchedAt: "2026-04-02T09:05:00+08:00",
      eventAt: "2026-04-02T08:30:00+08:00",
      entity: "瑞幸",
      action: "调价",
      object: "部分饮品",
      theme: "pricing-competition",
      score: 86,
      rawJson: JSON.stringify({ title: "瑞幸回应部分饮品价格调整" }),
    });
    await externalStore.insertExternalSourceDocument({
      documentId: "doc-luckin-1",
      sourceId: "luckin-ir",
      sourceTier: "s",
      sourceUrl: "https://example.com/luckin-price-cut",
      title: "瑞幸回应部分饮品价格调整",
      summary: "更新后摘要",
      publishedAt: "2026-04-02T09:00:00+08:00",
      fetchedAt: "2026-04-02T09:10:00+08:00",
      eventAt: "2026-04-02T08:30:00+08:00",
      entity: "瑞幸",
      action: "调价",
      object: "部分饮品",
      theme: "pricing-competition",
      score: 88,
      rawJson: JSON.stringify({ title: "瑞幸回应部分饮品价格调整", updated: true }),
    });
    await externalStore.insertExternalSourceDocument({
      documentId: "doc-course-1",
      sourceId: "soft-article-feed",
      sourceTier: "blocked",
      sourceUrl: "https://example.com/course",
      title: "战略赋能大课开班",
      summary: "明显软文",
      publishedAt: "2026-04-02T07:00:00+08:00",
      fetchedAt: "2026-04-02T07:10:00+08:00",
      entity: "培训机构",
      action: "开班",
      theme: "strategy-platform",
      blockedReason: "blocked-course-promo",
      score: 5,
      rawJson: JSON.stringify({ title: "战略赋能大课开班" }),
    });

    await externalStore.upsertExternalEventCandidate({
      candidateId: "candidate-luckin-1",
      documentId: "doc-luckin-1",
      sourceId: "luckin-ir",
      sourceUrl: "https://example.com/luckin-price-cut",
      title: "瑞幸回应部分饮品价格调整",
      summary: "瑞幸确认部分饮品价格进入新价格带。",
      entity: "瑞幸",
      action: "调价",
      object: "部分饮品",
      theme: "pricing-competition",
      publishedAt: "2026-04-02T09:00:00+08:00",
      eventAt: "2026-04-02T08:30:00+08:00",
      tier: "s",
      score: 88,
      normalizedKey: "luckin|adjust-price|drinks|2026-04-02",
      updatedAt: "2026-04-02T09:12:00+08:00",
    });
    await externalStore.upsertExternalEventCandidate({
      candidateId: "candidate-soft-1",
      documentId: "doc-course-1",
      sourceId: "soft-article-feed",
      sourceUrl: "https://example.com/course",
      title: "战略赋能大课开班",
      summary: "课程宣传内容，不应进入最终简报。",
      entity: "培训机构",
      action: "开班",
      theme: "strategy-platform",
      publishedAt: "2026-04-02T07:00:00+08:00",
      tier: "blocked",
      score: 5,
      blockedReason: "blocked-course-promo",
      normalizedKey: "training|course-launch|2026-04-02",
      updatedAt: "2026-04-02T07:15:00+08:00",
    });

    expect(await store.countRows("external_source_documents")).toBe(2);
    expect(await store.countRows("external_event_candidates")).toBe(2);

    await expect(
      externalStore.listExternalSourceDocuments({
        publishedSince: "2026-04-02T00:00:00+08:00",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        documentId: "doc-luckin-1",
        sourceId: "luckin-ir",
        sourceTier: "s",
        summary: "更新后摘要",
        score: 88,
      }),
      expect.objectContaining({
        documentId: "doc-course-1",
        sourceTier: "blocked",
        blockedReason: "blocked-course-promo",
      }),
    ]);

    await expect(
      externalStore.listExternalEventCandidates({
        theme: "pricing-competition",
        publishedSince: "2026-04-02T00:00:00+08:00",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        candidateId: "candidate-luckin-1",
        documentId: "doc-luckin-1",
        theme: "pricing-competition",
        blockedReason: undefined,
      }),
    ]);

    await expect(
      externalStore.listExternalEventCandidates({
        includeBlocked: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        candidateId: "candidate-luckin-1",
      }),
      expect.objectContaining({
        candidateId: "candidate-soft-1",
        blockedReason: "blocked-course-promo",
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("persists inferred member reactivation features by day", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });

    await store.initialize();

    const featureStore = store as unknown as {
      replaceMemberReactivationFeatures: (
        orgId: string,
        bizDate: string,
        rows: Array<{
          orgId: string;
          bizDate: string;
          memberId: string;
          customerIdentityKey: string;
          customerDisplayName: string;
          primarySegment: string;
          daysSinceLastVisit: number;
          visitCount30d: number;
          visitCount90d: number;
          payAmount30d: number;
          payAmount90d: number;
          memberPayAmount30d: number;
          memberPayAmount90d: number;
          rechargeTotal30d: number;
          rechargeTotal90d: number;
          rechargeCount30d: number;
          rechargeCount90d: number;
          daysSinceLastRecharge: number | null;
          currentStoredBalanceInferred: number;
          storedBalance7dAgo: number | null;
          storedBalance30dAgo: number | null;
          storedBalance90dAgo: number | null;
          storedBalanceDelta7d: number | null;
          storedBalanceDelta30d: number | null;
          storedBalanceDelta90d: number | null;
          depletionVelocity30d: number | null;
          projectedBalanceDaysLeft: number | null;
          rechargeToMemberPayRatio90d: number | null;
          dominantVisitDaypart: string | null;
          preferredDaypartShare90d: number | null;
          dominantVisitWeekday: string | null;
          preferredWeekdayShare90d: number | null;
          dominantVisitMonthPhase: string | null;
          preferredMonthPhaseShare90d: number | null;
          weekendVisitShare90d: number | null;
          lateNightVisitShare90d: number | null;
          overnightVisitShare90d: number | null;
          averageVisitGapDays90d: number | null;
          visitGapStddevDays90d: number | null;
          cycleDeviationScore: number | null;
          timePreferenceConfidenceScore: number;
          trajectoryConfidenceScore: number;
          reactivationPriorityScore: number;
          featureJson: string;
          memberCardNo?: string;
          referenceCode?: string;
        }>,
        updatedAt: string,
      ) => Promise<void>;
      listMemberReactivationFeatures: (
        orgId: string,
        bizDate: string,
      ) => Promise<Array<{ memberId: string; reactivationPriorityScore: number }>>;
    };

    await featureStore.replaceMemberReactivationFeatures(
      "1001",
      "2026-04-08",
      [
        {
          orgId: "1001",
          bizDate: "2026-04-08",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          memberCardNo: "YB001",
          referenceCode: "YB001",
          primarySegment: "important-value-member",
          daysSinceLastVisit: 18,
          visitCount30d: 1,
          visitCount90d: 4,
          payAmount30d: 360,
          payAmount90d: 1400,
          memberPayAmount30d: 360,
          memberPayAmount90d: 1200,
          rechargeTotal30d: 0,
          rechargeTotal90d: 600,
          rechargeCount30d: 0,
          rechargeCount90d: 1,
          daysSinceLastRecharge: 19,
          currentStoredBalanceInferred: 980,
          storedBalance7dAgo: 1410,
          storedBalance30dAgo: 1680,
          storedBalance90dAgo: 2120,
          storedBalanceDelta7d: -430,
          storedBalanceDelta30d: -700,
          storedBalanceDelta90d: -1140,
          depletionVelocity30d: 23.33,
          projectedBalanceDaysLeft: 42,
          rechargeToMemberPayRatio90d: 0.5,
          dominantVisitDaypart: "after-work",
          preferredDaypartShare90d: 0.8,
          dominantVisitWeekday: "friday",
          preferredWeekdayShare90d: 0.6,
          dominantVisitMonthPhase: "early",
          preferredMonthPhaseShare90d: 0.5,
          weekendVisitShare90d: 0.25,
          lateNightVisitShare90d: 0.1,
          overnightVisitShare90d: 0,
          averageVisitGapDays90d: 9,
          visitGapStddevDays90d: 2.5,
          cycleDeviationScore: 1.2,
          timePreferenceConfidenceScore: 0.72,
          trajectoryConfidenceScore: 0.9,
          reactivationPriorityScore: 742.5,
          featureJson: "{}",
        },
      ],
      "2026-04-09T09:00:00+08:00",
    );

    await expect(featureStore.listMemberReactivationFeatures("1001", "2026-04-08")).resolves.toEqual([
      expect.objectContaining({
        memberId: "M-001",
        dominantVisitDaypart: "after-work",
        dominantVisitWeekday: "friday",
        cycleDeviationScore: 1.2,
        reactivationPriorityScore: 742.5,
      }),
    ]);
    expect(await store.tableExists("mart_member_reactivation_features_daily")).toBe(true);

    await store.close();
    await pool.end();
  });

  it("persists member reactivation queue rows and lightweight feedback", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1005", storeName: "迎宾店", rawAliases: [] }],
    });

    await store.initialize();

    const queueStore = store as unknown as {
      replaceMemberReactivationQueue: (
        orgId: string,
        bizDate: string,
        rows: Array<{
          orgId: string;
          bizDate: string;
          memberId: string;
          customerIdentityKey: string;
          customerDisplayName: string;
          memberCardNo?: string;
          referenceCode?: string;
          primarySegment: string;
          followupBucket: string;
          reactivationPriorityScore: number;
          strategyPriorityScore: number;
          executionPriorityScore: number;
          priorityBand: string;
          priorityRank: number;
          churnRiskLabel: string;
          churnRiskScore: number;
          revisitWindowLabel: string;
          recommendedActionLabel: string;
          recommendedTouchWeekday?: string | null;
          recommendedTouchDaypart?: string | null;
          touchWindowLabel: string;
          reasonSummary: string;
          touchAdviceSummary: string;
          daysSinceLastVisit: number;
          visitCount90d: number;
          payAmount90d: number;
          currentStoredBalanceInferred: number;
          projectedBalanceDaysLeft?: number | null;
          birthdayMonthDay?: string | null;
          nextBirthdayBizDate?: string | null;
          birthdayWindowDays?: number | null;
          birthdayBoostScore: number;
          topTechName?: string | null;
          queueJson: string;
        }>,
        updatedAt: string,
      ) => Promise<void>;
      listMemberReactivationQueue: (
        orgId: string,
        bizDate: string,
      ) => Promise<
        Array<{
          memberId: string;
          priorityBand: string;
          reasonSummary: string;
          executionPriorityScore: number;
          birthdayMonthDay?: string | null;
          nextBirthdayBizDate?: string | null;
          birthdayWindowDays?: number | null;
          birthdayBoostScore: number;
        }>
      >;
      upsertMemberReactivationFeedback: (row: {
        orgId: string;
        bizDate: string;
        memberId: string;
        feedbackStatus: string;
        followedBy?: string;
        followedAt?: string;
        contacted: boolean;
        replied: boolean;
        booked: boolean;
        arrived: boolean;
        note?: string;
        updatedAt: string;
      }) => Promise<void>;
      listMemberReactivationFeedback: (
        orgId: string,
        bizDate: string,
      ) => Promise<Array<{ memberId: string; feedbackStatus: string; arrived: boolean }>>;
    };

    await queueStore.replaceMemberReactivationQueue(
      "1005",
      "2026-04-09",
      [
        {
          orgId: "1005",
          bizDate: "2026-04-09",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          memberCardNo: "YB001",
          referenceCode: "YB001",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          reactivationPriorityScore: 760,
          strategyPriorityScore: 980,
          executionPriorityScore: 1040,
          priorityBand: "P0",
          priorityRank: 1,
          churnRiskLabel: "critical",
          churnRiskScore: 0.88,
          revisitWindowLabel: "due-now",
          recommendedActionLabel: "immediate-1to1",
          recommendedTouchWeekday: "thursday",
          recommendedTouchDaypart: "after-work",
          touchWindowLabel: "best-today",
          reasonSummary: "已沉默36天，近90天消费4680.00元，优先一对一召回。",
          touchAdviceSummary: "建议周四 after-work 联系。",
          daysSinceLastVisit: 36,
          visitCount90d: 5,
          payAmount90d: 4680,
          currentStoredBalanceInferred: 680,
          projectedBalanceDaysLeft: 34,
          birthdayMonthDay: "04-10",
          nextBirthdayBizDate: "2026-04-10",
          birthdayWindowDays: 1,
          birthdayBoostScore: 60,
          topTechName: "安老师",
          queueJson: "{}",
        },
      ],
      "2026-04-09T09:00:00+08:00",
    );

    await queueStore.upsertMemberReactivationFeedback({
      orgId: "1005",
      bizDate: "2026-04-09",
      memberId: "M-001",
      feedbackStatus: "booked",
      followedBy: "店长A",
      followedAt: "2026-04-09T15:20:00+08:00",
      contacted: true,
      replied: true,
      booked: true,
      arrived: false,
      note: "已约周六下午",
      updatedAt: "2026-04-09T15:21:00+08:00",
    });

    await expect(queueStore.listMemberReactivationQueue("1005", "2026-04-09")).resolves.toEqual([
      expect.objectContaining({
        memberId: "M-001",
        priorityBand: "P0",
        executionPriorityScore: 1040,
        birthdayMonthDay: "04-10",
        nextBirthdayBizDate: "2026-04-10",
        birthdayWindowDays: 1,
        birthdayBoostScore: 60,
      }),
    ]);
    await expect(
      queueStore.listMemberReactivationFeedback("1005", "2026-04-09"),
    ).resolves.toEqual([
      expect.objectContaining({
        memberId: "M-001",
        feedbackStatus: "booked",
        arrived: false,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("persists clustered external event cards and ordered brief issues", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const externalStore = store as unknown as {
      upsertExternalEventCandidate: (candidate: {
        candidateId: string;
        documentId: string;
        sourceId: string;
        sourceUrl?: string;
        title: string;
        summary: string;
        entity: string;
        action: string;
        object?: string;
        theme: string;
        publishedAt: string;
        eventAt?: string;
        tier: "s" | "a" | "b" | "blocked";
        score: number;
        blockedReason?: string;
        normalizedKey: string;
        rawJson?: string;
        createdAt?: string;
        updatedAt?: string;
      }) => Promise<void>;
      upsertExternalEventCard: (card: {
        cardId: string;
        entity: string;
        action: string;
        object?: string;
        theme: string;
        eventAt?: string;
        publishedAt: string;
        sources: Array<{
          sourceId: string;
          displayName?: string;
          tier: "s" | "a" | "b" | "blocked";
          url?: string;
          notes?: string;
        }>;
        candidateIds: string[];
        summary: string;
        score: number;
        createdAt?: string;
        updatedAt?: string;
      }) => Promise<void>;
      listExternalEventCards: (params?: {
        theme?: string;
        publishedSince?: string;
        publishedBefore?: string;
        limit?: number;
      }) => Promise<Array<Record<string, unknown>>>;
      createExternalBriefIssue: (issue: {
        issueId: string;
        issueDate: string;
        createdAt: string;
        topic: string;
        items: Array<{
          itemId: string;
          cardId: string;
          title: string;
          theme: string;
          summary: string;
          whyItMatters: string;
          score: number;
          rank: number;
        }>;
      }) => Promise<void>;
      listExternalBriefItems: (issueId: string) => Promise<Array<Record<string, unknown>>>;
      getExternalBriefIssue: (issueId: string) => Promise<Record<string, unknown> | null>;
    };

    await store.initialize();

    await externalStore.upsertExternalEventCandidate({
      candidateId: "candidate-luckin-official",
      documentId: "doc-luckin-official",
      sourceId: "luckin-ir",
      sourceUrl: "https://example.com/luckin-ir",
      title: "瑞幸回应部分饮品价格调整",
      summary: "官方回应价格策略变化。",
      entity: "瑞幸",
      action: "调价",
      object: "部分饮品",
      theme: "chain-brand",
      publishedAt: "2026-04-02T09:00:00+08:00",
      eventAt: "2026-04-02T08:30:00+08:00",
      tier: "s",
      score: 90,
      normalizedKey: "luckin|adjust-price|drinks|2026-04-02",
    });
    await externalStore.upsertExternalEventCandidate({
      candidateId: "candidate-luckin-media",
      documentId: "doc-luckin-media",
      sourceId: "jiemian",
      sourceUrl: "https://example.com/jiemian-luckin",
      title: "界面：瑞幸部分饮品进入新价格带",
      summary: "媒体跟进价格带变化。",
      entity: "瑞幸",
      action: "调价",
      object: "部分饮品",
      theme: "chain-brand",
      publishedAt: "2026-04-02T09:20:00+08:00",
      eventAt: "2026-04-02T08:30:00+08:00",
      tier: "a",
      score: 84,
      normalizedKey: "luckin|adjust-price|drinks|2026-04-02",
    });

    await externalStore.upsertExternalEventCard({
      cardId: "card-luckin-price",
      entity: "瑞幸",
      action: "调价",
      object: "部分饮品",
      theme: "chain-brand",
      eventAt: "2026-04-02T08:30:00+08:00",
      publishedAt: "2026-04-02T09:20:00+08:00",
      sources: [
        {
          sourceId: "luckin-ir",
          displayName: "瑞幸官方",
          tier: "s",
          url: "https://example.com/luckin-ir",
        },
        {
          sourceId: "jiemian",
          displayName: "界面新闻",
          tier: "a",
          url: "https://example.com/jiemian-luckin",
        },
      ],
      candidateIds: ["candidate-luckin-official", "candidate-luckin-media"],
      summary: "两家来源均指向同一轮瑞幸饮品调价动作。",
      score: 91,
      updatedAt: "2026-04-02T09:30:00+08:00",
    });
    await externalStore.upsertExternalEventCard({
      cardId: "card-hot-topic",
      entity: "即时零售平台",
      action: "调整补贴",
      theme: "general-hot-topic",
      publishedAt: "2026-03-31T19:00:00+08:00",
      sources: [
        {
          sourceId: "platform-feed",
          displayName: "平台快讯",
          tier: "a",
          url: "https://example.com/platform",
        },
      ],
      candidateIds: [],
      summary: "另一个不属于连锁品牌主题的事件。",
      score: 70,
      updatedAt: "2026-03-31T19:20:00+08:00",
    });

    await expect(
      externalStore.listExternalEventCards({
        theme: "chain-brand",
        publishedSince: "2026-04-02T00:00:00+08:00",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        cardId: "card-luckin-price",
        entity: "瑞幸",
        theme: "chain-brand",
        candidateIds: ["candidate-luckin-official", "candidate-luckin-media"],
        sources: [
          expect.objectContaining({ sourceId: "luckin-ir", tier: "s" }),
          expect.objectContaining({ sourceId: "jiemian", tier: "a" }),
        ],
      }),
    ]);

    await externalStore.createExternalBriefIssue({
      issueId: "issue-2026-04-02",
      issueDate: "2026-04-02",
      createdAt: "2026-04-02T10:00:00+08:00",
      topic: "今日双层外部情报",
      items: [
        {
          itemId: "brief-2",
          cardId: "card-hot-topic",
          title: "平台补贴策略有新变化",
          theme: "general-hot-topic",
          summary: "平台补贴调整影响引流成本。",
          whyItMatters: "若竞争对手顺势放量，今天到店转化会被干扰。",
          score: 74,
          rank: 2,
        },
        {
          itemId: "brief-1",
          cardId: "card-luckin-price",
          title: "瑞幸价格带调整进入执行期",
          theme: "chain-brand",
          summary: "多个来源确认瑞幸启动新一轮饮品调价。",
          whyItMatters: "本地门店需要盯紧团购价格带和到店转化波动。",
          score: 91,
          rank: 1,
        },
      ],
    });

    await expect(externalStore.listExternalBriefItems("issue-2026-04-02")).resolves.toEqual([
      expect.objectContaining({
        itemId: "brief-1",
        rank: 1,
        cardId: "card-luckin-price",
      }),
      expect.objectContaining({
        itemId: "brief-2",
        rank: 2,
        cardId: "card-hot-topic",
      }),
    ]);

    await expect(externalStore.getExternalBriefIssue("issue-2026-04-02")).resolves.toEqual(
      expect.objectContaining({
        issueId: "issue-2026-04-02",
        issueDate: "2026-04-02",
        topic: "今日双层外部情报",
        items: [
          expect.objectContaining({ itemId: "brief-1", rank: 1 }),
          expect.objectContaining({ itemId: "brief-2", rank: 2 }),
        ],
      }),
    );

    await store.close();
    await pool.end();
  });

  it("stores conversation review runs and findings", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "一号店", rawAliases: [] }],
    });
    const reviewStore = store as unknown as {
      createConversationReviewRun: (run: Record<string, unknown>) => Promise<void>;
      createConversationReviewFinding: (finding: Record<string, unknown>) => Promise<void>;
      listConversationReviewRuns: (params?: {
        status?: string;
        limit?: number;
      }) => Promise<Record<string, unknown>[]>;
      listConversationReviewFindings: (params?: {
        reviewRunId?: string;
        findingType?: string;
      }) => Promise<Record<string, unknown>[]>;
    };

    await store.initialize();

    await reviewStore.createConversationReviewRun({
      reviewRunId: "run-1",
      reviewDate: "2026-04-16",
      sourceWindowStart: "2026-04-15T00:00:00.000Z",
      sourceWindowEnd: "2026-04-16T00:00:00.000Z",
      status: "completed",
      inputConversationCount: 12,
      inputShadowSampleCount: 4,
      inputAnalysisJobCount: 2,
      findingCount: 1,
      summaryJson: JSON.stringify({
        topFindingTypes: [{ findingType: "scope_gap", count: 1 }],
      }),
      createdAt: "2026-04-16T04:20:00.000Z",
      updatedAt: "2026-04-16T04:20:00.000Z",
      startedAt: "2026-04-16T04:20:00.000Z",
      completedAt: "2026-04-16T04:20:10.000Z",
    });

    await reviewStore.createConversationReviewFinding({
      findingId: "finding-1",
      reviewRunId: "run-1",
      conversationId: "chat-1",
      messageId: "msg-1",
      channel: "wecom",
      chatId: "chat-1",
      senderId: "u-1",
      orgId: "1001",
      storeName: "一号店",
      findingType: "scope_gap",
      severity: "high",
      confidence: 0.96,
      title: "缺少时间范围",
      summary: "用户问这几天但系统没有按默认5天解释。",
      evidenceJson: JSON.stringify({ rawText: "这几天义乌店加钟率多少" }),
      suggestedActionType: "add_eval_sample",
      suggestedActionPayloadJson: JSON.stringify({ sampleKind: "scope_gap" }),
      followupTargets: ["sample_candidate", "backlog_candidate"],
      status: "open",
      createdAt: "2026-04-16T04:20:11.000Z",
    });

    await expect(reviewStore.listConversationReviewRuns({ limit: 5 })).resolves.toMatchObject([
      {
        reviewRunId: "run-1",
        status: "completed",
        findingCount: 1,
      },
    ]);
    await expect(
      reviewStore.listConversationReviewFindings({
        reviewRunId: "run-1",
      }),
    ).resolves.toMatchObject([
      {
        findingId: "finding-1",
        findingType: "scope_gap",
        severity: "high",
        suggestedActionType: "add_eval_sample",
        followupTargets: ["sample_candidate", "backlog_candidate"],
      },
    ]);

    await store.close();
    await pool.end();
  });

  it("persists store external context entries and lists the latest snapshot", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1001", storeName: "迎宾店", rawAliases: [] }],
    });
    const externalContextStore = store as unknown as {
      upsertStoreExternalContextEntry: (row: {
        orgId: string;
        snapshotDate: string;
        contextKind: "store_business_profile" | "estimated_market_context" | "research_note";
        metricKey: string;
        valueText?: string;
        valueNum?: number;
        valueJson?: unknown;
        unit?: string;
        truthLevel: "confirmed" | "estimated" | "research_note";
        confidence: "high" | "medium" | "low";
        sourceType: string;
        sourceLabel?: string;
        sourceUri?: string;
        applicableModules?: string[];
        notForScoring?: boolean;
        note?: string;
        rawJson?: string;
        updatedAt: string;
      }) => Promise<void>;
      listStoreExternalContextEntries: (params: {
        orgId: string;
        snapshotDate?: string;
      }) => Promise<
        Array<{
          orgId: string;
          snapshotDate: string;
          contextKind: string;
          metricKey: string;
          valueText?: string;
          valueNum?: number;
          truthLevel: string;
          confidence: string;
          sourceType: string;
          sourceUri?: string;
          applicableModules: string[];
          notForScoring: boolean;
        }>
      >;
    };

    await store.initialize();

    expect(await store.tableExists("store_external_context_entries")).toBe(true);

    await externalContextStore.upsertStoreExternalContextEntry({
      orgId: "1001",
      snapshotDate: "2026-04-17",
      contextKind: "estimated_market_context",
      metricKey: "market_population_scale_3km",
      valueText: "44.96 万人",
      valueNum: 449600,
      unit: "person",
      truthLevel: "estimated",
      confidence: "medium",
      sourceType: "third_party_pdf",
      sourceLabel: "查周边.pdf",
      sourceUri:
        "mdshuju/荷塘悦色影院式沐足(迎宾公园店)周边3.0km的周边调研-查周边.pdf",
      applicableModules: ["store_advice"],
      notForScoring: true,
      updatedAt: "2026-04-17T10:00:00.000Z",
    });
    await externalContextStore.upsertStoreExternalContextEntry({
      orgId: "1001",
      snapshotDate: "2026-04-18",
      contextKind: "store_business_profile",
      metricKey: "store_format",
      valueText: "cinema_foot_bath",
      truthLevel: "confirmed",
      confidence: "high",
      sourceType: "store_page_screenshot",
      applicableModules: ["store_advice", "customer_growth_ai"],
      notForScoring: false,
      updatedAt: "2026-04-18T10:00:00.000Z",
    });
    await externalContextStore.upsertStoreExternalContextEntry({
      orgId: "1001",
      snapshotDate: "2026-04-18",
      contextKind: "estimated_market_context",
      metricKey: "delivery_store_count_3km",
      valueText: "662",
      valueNum: 662,
      unit: "count",
      truthLevel: "estimated",
      confidence: "medium",
      sourceType: "third_party_pdf",
      sourceLabel: "查外卖.pdf",
      sourceUri:
        "mdshuju/荷塘悦色影院式沐足(迎宾公园店)周边3.0km的周边调研-查外卖.pdf",
      applicableModules: ["store_advice", "customer_growth_ai"],
      notForScoring: true,
      updatedAt: "2026-04-18T10:01:00.000Z",
    });
    await externalContextStore.upsertStoreExternalContextEntry({
      orgId: "1001",
      snapshotDate: "2026-04-18",
      contextKind: "research_note",
      metricKey: "seasonal_nightlife_pattern",
      valueText: "安阳属中国北方城市，当前季节夜晚撸串、喝酒、饭后休闲需求偏强",
      truthLevel: "research_note",
      confidence: "medium",
      sourceType: "operator_research_note",
      applicableModules: ["store_advice", "customer_growth_ai"],
      notForScoring: true,
      note: "用于晚间承接解释，不直接进入精确算分",
      updatedAt: "2026-04-18T10:02:00.000Z",
    });

    await expect(
      externalContextStore.listStoreExternalContextEntries({
        orgId: "1001",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        orgId: "1001",
        snapshotDate: "2026-04-18",
        contextKind: "estimated_market_context",
        metricKey: "delivery_store_count_3km",
        valueNum: 662,
      }),
      expect.objectContaining({
        orgId: "1001",
        snapshotDate: "2026-04-18",
        contextKind: "research_note",
        metricKey: "seasonal_nightlife_pattern",
      }),
      expect.objectContaining({
        orgId: "1001",
        snapshotDate: "2026-04-18",
        contextKind: "store_business_profile",
        metricKey: "store_format",
        truthLevel: "confirmed",
      }),
    ]);

    await expect(
      externalContextStore.listStoreExternalContextEntries({
        orgId: "1001",
        snapshotDate: "2026-04-17",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        orgId: "1001",
        snapshotDate: "2026-04-17",
        metricKey: "market_population_scale_3km",
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("persists store master profiles and profile snapshots", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] }],
    });
    const masterStore = store as unknown as {
      upsertStoreMasterProfile: (row: {
        orgId: string;
        storeName: string;
        brandName?: string;
        cityName?: string;
        districtName?: string;
        addressText?: string;
        longitude?: number;
        latitude?: number;
        openingDate?: string;
        renovationDate?: string;
        areaM2?: number;
        roomCountTotal?: number;
        roomMixJson?: Record<string, unknown>;
        serviceHoursJson?: Record<string, unknown>;
        storeFormat?: string;
        businessScene?: string;
        parkingAvailable?: boolean;
        parkingConvenienceLevel?: string;
        operatingStatus?: string;
        sourceLabel?: string;
        verifiedAt?: string;
        rawJson?: string;
        updatedAt: string;
      }) => Promise<void>;
      getStoreMasterProfile: (orgId: string) => Promise<Record<string, unknown> | null>;
      insertStoreMasterProfileSnapshot: (row: {
        orgId: string;
        snapshotDate: string;
        snapshotCapturedAt: string;
        storeName: string;
        brandName?: string;
        cityName?: string;
        districtName?: string;
        addressText?: string;
        longitude?: number;
        latitude?: number;
        openingDate?: string;
        renovationDate?: string;
        areaM2?: number;
        roomCountTotal?: number;
        roomMixJson?: Record<string, unknown>;
        serviceHoursJson?: Record<string, unknown>;
        storeFormat?: string;
        businessScene?: string;
        parkingAvailable?: boolean;
        parkingConvenienceLevel?: string;
        operatingStatus?: string;
        sourceLabel?: string;
        verifiedAt?: string;
        rawJson?: string;
        updatedAt: string;
      }) => Promise<void>;
      listStoreMasterProfileSnapshots: (orgId: string) => Promise<Array<Record<string, unknown>>>;
    };

    await store.initialize();

    expect(await store.tableExists("store_master_profiles")).toBe(true);
    expect(await store.tableExists("store_master_profile_snapshots")).toBe(true);

    await masterStore.upsertStoreMasterProfile({
      orgId: "627149864218629",
      storeName: "荷塘悦色迎宾店",
      brandName: "荷塘悦色",
      cityName: "安阳",
      districtName: "文峰区",
      addressText: "迎宾公园商圈",
      longitude: 114.3921,
      latitude: 36.0972,
      openingDate: "2018-07-18",
      areaM2: 2000,
      roomCountTotal: 33,
      roomMixJson: {
        singleRoomCount: 5,
        doubleRoomCount: 8,
        multiRoomCount: 20,
      },
      serviceHoursJson: {
        windows: [
          {
            start: "11:30",
            end: "02:00",
            overnight: true,
          },
        ],
      },
      storeFormat: "cinema_foot_bath",
      businessScene: "residential_office_hotel_mixed",
      parkingAvailable: true,
      parkingConvenienceLevel: "high",
      operatingStatus: "operating",
      sourceLabel: "initial_seed",
      verifiedAt: "2026-04-21T10:00:00.000Z",
      rawJson: "{\"source\":\"seed\"}",
      updatedAt: "2026-04-21T10:00:00.000Z",
    });

    await expect(masterStore.getStoreMasterProfile("627149864218629")).resolves.toEqual(
      expect.objectContaining({
        orgId: "627149864218629",
        storeName: "荷塘悦色迎宾店",
        cityName: "安阳",
        openingDate: "2018-07-18",
        areaM2: 2000,
        roomCountTotal: 33,
        parkingConvenienceLevel: "high",
        serviceHoursJson: {
          windows: [
            {
              start: "11:30",
              end: "02:00",
              overnight: true,
            },
          ],
        },
      }),
    );

    await masterStore.insertStoreMasterProfileSnapshot({
      orgId: "627149864218629",
      snapshotDate: "2026-04-21",
      snapshotCapturedAt: "2026-04-21T10:00:00.000Z",
      storeName: "荷塘悦色迎宾店",
      cityName: "安阳",
      openingDate: "2018-07-18",
      areaM2: 2000,
      roomCountTotal: 33,
      serviceHoursJson: {
        windows: [
          {
            start: "11:30",
            end: "02:00",
            overnight: true,
          },
        ],
      },
      storeFormat: "cinema_foot_bath",
      operatingStatus: "operating",
      sourceLabel: "initial_seed",
      verifiedAt: "2026-04-21T10:00:00.000Z",
      rawJson: "{\"source\":\"seed\"}",
      updatedAt: "2026-04-21T10:00:00.000Z",
    });
    await masterStore.insertStoreMasterProfileSnapshot({
      orgId: "627149864218629",
      snapshotDate: "2026-04-22",
      snapshotCapturedAt: "2026-04-22T10:00:00.000Z",
      storeName: "荷塘悦色迎宾店",
      cityName: "安阳",
      openingDate: "2018-07-18",
      areaM2: 2100,
      roomCountTotal: 34,
      serviceHoursJson: {
        windows: [
          {
            start: "11:00",
            end: "02:00",
            overnight: true,
          },
        ],
      },
      storeFormat: "cinema_foot_bath",
      operatingStatus: "operating",
      sourceLabel: "manual_update",
      verifiedAt: "2026-04-22T10:00:00.000Z",
      rawJson: "{\"source\":\"manual_update\"}",
      updatedAt: "2026-04-22T10:00:00.000Z",
    });

    await expect(masterStore.listStoreMasterProfileSnapshots("627149864218629")).resolves.toEqual([
      expect.objectContaining({
        orgId: "627149864218629",
        snapshotDate: "2026-04-22",
        areaM2: 2100,
        roomCountTotal: 34,
      }),
      expect.objectContaining({
        orgId: "627149864218629",
        snapshotDate: "2026-04-21",
        areaM2: 2000,
        roomCountTotal: 33,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("persists store external observations with capture batches", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] }],
    });
    const observationStore = store as unknown as {
      createStoreExternalObservationBatch: (row: {
        batchId: string;
        orgId: string;
        sourcePlatform: string;
        captureScope: string;
        captureMode: string;
        capturedAt: string;
        operatorId?: string;
        browserProfileId?: string;
        status: string;
        rawManifestJson: string;
      }) => Promise<void>;
      insertStoreExternalObservation: (row: {
        observationId: string;
        orgId: string;
        snapshotDate: string;
        sourcePlatform: string;
        metricDomain: string;
        metricKey: string;
        valueNum?: number;
        valueText?: string;
        valueJson?: unknown;
        unit?: string;
        truthLevel: "confirmed" | "estimated" | "research_note";
        confidence: "high" | "medium" | "low";
        sourceLabel?: string;
        sourceUri?: string;
        batchId?: string;
        evidenceDocumentId?: string;
        applicableModules?: string[];
        notForScoring?: boolean;
        validFrom?: string;
        validTo?: string;
        rawJson?: string;
        updatedAt: string;
      }) => Promise<void>;
      listStoreExternalObservations: (params: {
        orgId: string;
        snapshotDate?: string;
        sourcePlatform?: string;
        metricDomain?: string;
        limit?: number;
      }) => Promise<Array<Record<string, unknown>>>;
    };

    await store.initialize();

    expect(await store.tableExists("store_external_observation_batches")).toBe(true);
    expect(await store.tableExists("store_external_observations")).toBe(true);

    await observationStore.createStoreExternalObservationBatch({
      batchId: "batch-obs-1",
      orgId: "627149864218629",
      sourcePlatform: "meituan",
      captureScope: "store-page",
      captureMode: "manual-import",
      capturedAt: "2026-04-21T15:00:00.000Z",
      operatorId: "codex",
      browserProfileId: "desktop-chrome-a",
      status: "captured",
      rawManifestJson: "{\"files\":[\"store-page.png\"]}",
    });

    await observationStore.insertStoreExternalObservation({
      observationId: "obs-1",
      orgId: "627149864218629",
      snapshotDate: "2026-04-21",
      sourcePlatform: "meituan",
      metricDomain: "store_profile",
      metricKey: "service_hours",
      valueText: "11:30-次日02:00",
      truthLevel: "confirmed",
      confidence: "high",
      sourceLabel: "门店页截图",
      sourceUri: "file://store-page.png",
      batchId: "batch-obs-1",
      evidenceDocumentId: "doc-store-page-1",
      applicableModules: ["store_advice", "customer_growth_ai"],
      notForScoring: false,
      validFrom: "2026-04-21",
      rawJson: "{\"service_hours\":\"11:30-次日02:00\"}",
      updatedAt: "2026-04-21T15:05:00.000Z",
    });
    await observationStore.insertStoreExternalObservation({
      observationId: "obs-2",
      orgId: "627149864218629",
      snapshotDate: "2026-04-21",
      sourcePlatform: "xiaohongshu",
      metricDomain: "market_context",
      metricKey: "nightlife_comment_theme",
      valueText: "夜场、聚会、停车方便",
      valueJson: {
        tags: ["夜场", "聚会", "停车方便"],
      },
      truthLevel: "research_note",
      confidence: "medium",
      batchId: "batch-obs-1",
      evidenceDocumentId: "doc-xhs-1",
      applicableModules: ["analysis_explanation"],
      notForScoring: true,
      updatedAt: "2026-04-21T15:08:00.000Z",
    });

    expect(await store.countRows("store_external_observation_batches")).toBe(1);
    expect(await store.countRows("store_external_observations")).toBe(2);

    await expect(
      observationStore.listStoreExternalObservations({
        orgId: "627149864218629",
        snapshotDate: "2026-04-21",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: "obs-2",
        sourcePlatform: "xiaohongshu",
        truthLevel: "research_note",
        confidence: "medium",
        evidenceDocumentId: "doc-xhs-1",
        notForScoring: true,
        valueJson: {
          tags: ["夜场", "聚会", "停车方便"],
        },
      }),
      expect.objectContaining({
        observationId: "obs-1",
        sourcePlatform: "meituan",
        truthLevel: "confirmed",
        confidence: "high",
        evidenceDocumentId: "doc-store-page-1",
        notForScoring: false,
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("persists industry context snapshots", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] }],
    });
    const industryStore = store as unknown as {
      upsertIndustryContextSnapshot: (row: {
        snapshotDate: string;
        signalKind: "industry_climate" | "platform_rule" | "city_consumption_trend" | "capital_market_note";
        signalKey: string;
        title: string;
        summary: string;
        detailJson?: unknown;
        truthBoundary?: "hard_fact" | "soft_fact" | "weak_signal";
        confidence: "high" | "medium" | "low";
        sourceType: string;
        sourceLabel?: string;
        sourceUri?: string;
        applicableModules?: string[];
        note?: string;
        rawJson?: string;
        updatedAt: string;
      }) => Promise<void>;
      listIndustryContextSnapshots: (params?: {
        snapshotDate?: string;
        signalKinds?: Array<
          "industry_climate" | "platform_rule" | "city_consumption_trend" | "capital_market_note"
        >;
        limit?: number;
      }) => Promise<Array<Record<string, unknown>>>;
    };

    await store.initialize();

    expect(await store.tableExists("industry_context_snapshots")).toBe(true);

    await industryStore.upsertIndustryContextSnapshot({
      snapshotDate: "2026-04-23",
      signalKind: "industry_climate",
      signalKey: "demand_resilient",
      title: "行业需求仍有韧性",
      summary: "高频刚需客群保持基本盘，波动主要来自转化和承接差异。",
      confidence: "medium",
      sourceType: "manual_research",
      sourceLabel: "行业周观察",
      applicableModules: ["hq_narrative", "world_model"],
      updatedAt: "2026-04-23T09:00:00.000Z",
    });
    await industryStore.upsertIndustryContextSnapshot({
      snapshotDate: "2026-04-24",
      signalKind: "platform_rule",
      signalKey: "meituan_price_mindshare",
      title: "平台价格心智抬升",
      summary: "低价导向会先影响价格敏感客和临时决策客。",
      confidence: "high",
      sourceType: "manual_research",
      sourceLabel: "平台观察",
      applicableModules: ["hq_narrative", "world_model", "store_diagnosis"],
      updatedAt: "2026-04-24T09:00:00.000Z",
    });
    await industryStore.upsertIndustryContextSnapshot({
      snapshotDate: "2026-04-24",
      signalKind: "city_consumption_trend",
      signalKey: "anyang_weekday_night_soft",
      title: "安阳工作日夜场偏软",
      summary: "工作日夜间消费意愿较上周略弱。",
      confidence: "medium",
      sourceType: "manual_research",
      applicableModules: ["hq_narrative"],
      updatedAt: "2026-04-24T09:05:00.000Z",
    });

    await expect(industryStore.listIndustryContextSnapshots()).resolves.toEqual([
      expect.objectContaining({
        snapshotDate: "2026-04-24",
        signalKind: "city_consumption_trend",
        signalKey: "anyang_weekday_night_soft",
      }),
      expect.objectContaining({
        snapshotDate: "2026-04-24",
        signalKind: "platform_rule",
        signalKey: "meituan_price_mindshare",
        confidence: "high",
      }),
    ]);

    await expect(
      industryStore.listIndustryContextSnapshots({
        snapshotDate: "2026-04-23",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        snapshotDate: "2026-04-23",
        signalKind: "industry_climate",
        signalKey: "demand_resilient",
      }),
    ]);

    await expect(
      industryStore.listIndustryContextSnapshots({
        snapshotDate: "2026-04-24",
        signalKinds: ["platform_rule"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        snapshotDate: "2026-04-24",
        signalKind: "platform_rule",
        signalKey: "meituan_price_mindshare",
      }),
    ]);

    await store.close();
    await pool.end();
  });


  it("persists customer service observations with capture batches", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] }],
    });
    const observationStore = store as unknown as {
      createCustomerServiceObservationBatch: (row: {
        batchId: string;
        orgId: string;
        sourceRole: "technician" | "front_desk" | "customer_service" | "store_manager" | "system";
        collectionSurface: string;
        captureMode: string;
        capturedAt: string;
        operatorId?: string;
        status: "captured" | "normalized" | "published" | "failed";
        rawManifestJson: string;
      }) => Promise<void>;
      insertCustomerServiceObservation: (row: {
        observationId: string;
        orgId: string;
        memberId?: string;
        customerIdentityKey: string;
        sourceRole: "technician" | "front_desk" | "customer_service" | "store_manager" | "system";
        sourceType: "self_reported" | "staff_observed" | "system_fact" | "system_inferred";
        observerId?: string;
        batchId?: string;
        signalDomain: string;
        signalKey: string;
        valueNum?: number;
        valueText?: string;
        valueJson?: unknown;
        confidence: "high" | "medium" | "low";
        truthBoundary: "hard_fact" | "observed_fact" | "inferred_label" | "predicted_signal";
        observedAt: string;
        validTo?: string;
        rawNote?: string;
        rawJson?: string;
        updatedAt: string;
      }) => Promise<void>;
      listCustomerServiceObservations: (params: {
        orgId: string;
        memberId?: string;
        customerIdentityKey?: string;
        signalDomain?: string;
        limit?: number;
      }) => Promise<Array<Record<string, unknown>>>;
    };

    await store.initialize();

    expect(await store.tableExists("customer_service_observation_batches")).toBe(true);
    expect(await store.tableExists("customer_service_observations")).toBe(true);

    await observationStore.createCustomerServiceObservationBatch({
      batchId: "cs-batch-1",
      orgId: "627149864218629",
      sourceRole: "technician",
      collectionSurface: "service-wrapup-form",
      captureMode: "manual-form",
      capturedAt: "2026-04-21T14:00:00.000Z",
      operatorId: "T-008",
      status: "captured",
      rawManifestJson: "{\"form\":\"service-wrapup-form\"}",
    });

    await observationStore.insertCustomerServiceObservation({
      observationId: "cso-1",
      orgId: "627149864218629",
      memberId: "M-001",
      customerIdentityKey: "member:M-001",
      sourceRole: "technician",
      sourceType: "self_reported",
      observerId: "T-008",
      batchId: "cs-batch-1",
      signalDomain: "service_need",
      signalKey: "primary_need",
      valueText: "肩颈",
      confidence: "high",
      truthBoundary: "hard_fact",
      observedAt: "2026-04-21T14:08:00.000Z",
      validTo: "2026-07-20",
      rawNote: "客户明确说最近肩颈很紧",
      updatedAt: "2026-04-21T14:09:00.000Z",
    });
    await observationStore.insertCustomerServiceObservation({
      observationId: "cso-2",
      orgId: "627149864218629",
      memberId: "M-001",
      customerIdentityKey: "member:M-001",
      sourceRole: "front_desk",
      sourceType: "staff_observed",
      observerId: "FD-003",
      batchId: "cs-batch-1",
      signalDomain: "interaction_style",
      signalKey: "wait_sensitivity",
      valueText: "high",
      valueJson: { reason: "等待超过10分钟后明显催问" },
      confidence: "medium",
      truthBoundary: "observed_fact",
      observedAt: "2026-04-21T14:11:00.000Z",
      rawNote: "客户对排房等待比较敏感",
      updatedAt: "2026-04-21T14:12:00.000Z",
    });

    expect(await store.countRows("customer_service_observation_batches")).toBe(1);
    expect(await store.countRows("customer_service_observations")).toBe(2);

    await expect(
      observationStore.listCustomerServiceObservations({
        orgId: "627149864218629",
        memberId: "M-001",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: "cso-2",
        sourceRole: "front_desk",
        sourceType: "staff_observed",
        signalDomain: "interaction_style",
        signalKey: "wait_sensitivity",
        truthBoundary: "observed_fact",
        confidence: "medium",
        valueJson: { reason: "等待超过10分钟后明显催问" },
      }),
      expect.objectContaining({
        observationId: "cso-1",
        sourceRole: "technician",
        sourceType: "self_reported",
        signalDomain: "service_need",
        signalKey: "primary_need",
        truthBoundary: "hard_fact",
        confidence: "high",
        valueText: "肩颈",
      }),
    ]);

    await store.close();
    await pool.end();
  });

  it("stores scoped external source documents for store intelligence", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] }],
    });
    const externalStore = store as unknown as {
      insertExternalSourceDocument: (row: {
        documentId: string;
        sourceId: string;
        sourceTier: "s" | "a" | "b" | "blocked";
        sourceUrl?: string;
        title: string;
        summary?: string;
        contentText?: string;
        entity?: string;
        action?: string;
        object?: string;
        score?: number;
        publishedAt: string;
        eventAt?: string;
        fetchedAt: string;
        theme?: string;
        blockedReason?: string;
        scopeType?: "hq" | "store";
        orgId?: string;
        platformStoreId?: string;
        rawJson?: string;
      }) => Promise<void>;
      listExternalSourceDocuments: (params?: {
        sourceId?: string;
        publishedSince?: string;
        scopeType?: "hq" | "store";
        orgId?: string;
        platformStoreId?: string;
        limit?: number;
      }) => Promise<Array<Record<string, unknown>>>;
    };

    await store.initialize();

    await externalStore.insertExternalSourceDocument({
      documentId: "doc-hq-1",
      sourceId: "gaode-poi",
      sourceTier: "a",
      sourceUrl: "https://example.com/gaode/hq",
      title: "安阳市夜生活商圈变化",
      summary: "总部全局观察",
      publishedAt: "2026-04-21T09:00:00.000Z",
      fetchedAt: "2026-04-21T09:10:00.000Z",
      theme: "general-hot-topic",
      scopeType: "hq",
      rawJson: "{\"scope\":\"hq\"}",
    });
    await externalStore.insertExternalSourceDocument({
      documentId: "doc-store-1",
      sourceId: "meituan-store-page",
      sourceTier: "s",
      sourceUrl: "https://example.com/meituan/store/yingbin",
      title: "迎宾店美团门店页截图",
      summary: "迎宾店营业时段和门店标签",
      publishedAt: "2026-04-21T10:00:00.000Z",
      fetchedAt: "2026-04-21T10:05:00.000Z",
      theme: "store-profile",
      scopeType: "store",
      orgId: "627149864218629",
      platformStoreId: "meituan:yingbin-001",
      rawJson: "{\"scope\":\"store\"}",
    });

    await expect(
      externalStore.listExternalSourceDocuments({
        scopeType: "store",
        orgId: "627149864218629",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        documentId: "doc-store-1",
        scopeType: "store",
        orgId: "627149864218629",
        platformStoreId: "meituan:yingbin-001",
      }),
    ]);

    await expect(
      externalStore.listExternalSourceDocuments({
        publishedSince: "2026-04-21T00:00:00.000Z",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        documentId: "doc-store-1",
        scopeType: "store",
      }),
      expect.objectContaining({
        documentId: "doc-hq-1",
        scopeType: "hq",
      }),
    ]);

    await store.close();
    await pool.end();
  });
});
