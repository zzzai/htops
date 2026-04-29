import { describe, expect, it, vi } from "vitest";
import { HetangOpsStore } from "./store.js";

function buildStoreWithRelationKinds(relationKinds: Record<string, "v" | "m" | undefined>) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
      return { rows: [] };
    }
    if (text.includes("SELECT relation.relkind AS relkind")) {
      const name = String(params?.[0] ?? "");
      const relkind = relationKinds[name];
      return { rows: relkind ? [{ relkind }] : [] };
    }
    if (text.includes("SELECT EXISTS (")) {
      const name = String(params?.[0] ?? "");
      return { rows: [{ exists: Boolean(relationKinds[name]) }] };
    }
    if (text.startsWith("DROP VIEW ")) {
      const name = text.replace("DROP VIEW ", "").trim();
      const relkind = relationKinds[name];
      if (relkind === "m") {
        const error = new Error(`"${name}" is not a view`) as Error & { code?: string };
        error.code = "42809";
        throw error;
      }
      if (relkind === "v") {
        delete relationKinds[name];
      }
      return { rows: [] };
    }
    if (text.startsWith("DROP MATERIALIZED VIEW ")) {
      const name = text.replace("DROP MATERIALIZED VIEW ", "").trim();
      const relkind = relationKinds[name];
      if (relkind === "v") {
        const error = new Error(`"${name}" is not a materialized view`) as Error & {
          code?: string;
        };
        error.code = "42809";
        throw error;
      }
      if (relkind === "m") {
        delete relationKinds[name];
      }
      return { rows: [] };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({
    query,
    release,
  }));
  const store = new HetangOpsStore({
    pool: { query, connect } as never,
    stores: [],
  });
  return {
    store,
    query,
    connect,
    release,
  };
}

describe("HetangOpsStore analytics view rebuild", () => {
  it("rebuilds materialized analytics views inside a single transaction", async () => {
    const { store, query, connect, release } = buildStoreWithRelationKinds({
      serving_hq_portfolio_window: "v",
      serving_tech_profile_window: "v",
      serving_customer_ranked_list_asof: "v",
      serving_customer_profile_asof: "v",
      serving_store_window: "v",
      serving_store_day: "v",
      serving_store_day_breakdown: "v",
      mv_store_review_7d: "m",
      mv_store_summary_30d: "m",
      mv_customer_profile_90d: "m",
      mv_tech_profile_30d: "m",
      mv_store_manager_daily_kpi: "m",
    });

    await (store as never as { rebuildAnalyticsViewsForMode: (mode: "materialized") => Promise<void> })
      .rebuildAnalyticsViewsForMode("materialized");

    const statements = query.mock.calls.map(([sql]) => String(sql).trim());
    expect(connect).toHaveBeenCalledTimes(1);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("drops materialized relations without first issuing a wrong DROP VIEW inside the transaction", async () => {
    const { store, query } = buildStoreWithRelationKinds({
      mv_store_review_7d: "m",
    });

    await (store as never as { rebuildAnalyticsViewsForMode: (mode: "materialized") => Promise<void> })
      .rebuildAnalyticsViewsForMode("materialized");

    const statements = query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements).not.toContain("DROP VIEW mv_store_review_7d");
    expect(statements).toContain("DROP MATERIALIZED VIEW mv_store_review_7d");
  });

  it("drops serving_store_day_breakdown before rebuilding materialized analytics views", async () => {
    const { store, query } = buildStoreWithRelationKinds({
      serving_hq_portfolio_window: "v",
      serving_tech_profile_window: "v",
      serving_customer_ranked_list_asof: "v",
      serving_customer_profile_asof: "v",
      serving_store_window: "v",
      serving_store_day: "v",
      serving_store_day_breakdown: "v",
      mv_store_review_7d: "m",
      mv_store_summary_30d: "m",
      mv_customer_profile_90d: "m",
      mv_tech_profile_30d: "m",
      mv_store_manager_daily_kpi: "m",
    });

    await (store as never as { rebuildAnalyticsViewsForMode: (mode: "materialized") => Promise<void> })
      .rebuildAnalyticsViewsForMode("materialized");

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("DROP VIEW serving_store_day_breakdown"),
      ),
    ).toBe(true);
  });

  it("rebuilds serving window views with customer_count columns for window summaries and HQ ranking", async () => {
    const { store, query } = buildStoreWithRelationKinds({
      serving_hq_portfolio_window: "v",
      serving_tech_profile_window: "v",
      serving_customer_ranked_list_asof: "v",
      serving_customer_profile_asof: "v",
      serving_store_window: "v",
      serving_store_day: "v",
      serving_store_day_breakdown: "v",
      mv_store_review_7d: "m",
      mv_store_summary_30d: "m",
      mv_customer_profile_90d: "m",
      mv_tech_profile_30d: "m",
      mv_store_manager_daily_kpi: "m",
    });

    await (store as never as { rebuildAnalyticsViewsForMode: (mode: "materialized") => Promise<void> })
      .rebuildAnalyticsViewsForMode("materialized");

    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(
      statements.some(
        (sql) =>
          sql.includes("CREATE OR REPLACE VIEW serving_store_window AS") &&
          sql.includes("customer_count"),
      ),
    ).toBe(true);
    expect(
      statements.some(
        (sql) =>
          sql.includes("CREATE OR REPLACE VIEW serving_hq_portfolio_window AS") &&
          sql.includes("customer_count"),
      ),
    ).toBe(true);
  });

  it("drops materialized analytics relations before rebuilding plain fallback views", async () => {
    const { store, query } = buildStoreWithRelationKinds({
      mv_store_review_7d: "m",
      mv_store_summary_30d: "m",
      mv_customer_profile_90d: "m",
      mv_tech_profile_30d: "m",
      mv_store_manager_daily_kpi: "m",
      serving_store_day_breakdown: "v",
    });

    await (store as never as { rebuildAnalyticsViewsForMode: (mode: "plain") => Promise<void> })
      .rebuildAnalyticsViewsForMode("plain");

    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("DROP MATERIALIZED VIEW mv_store_manager_daily_kpi"),
      ),
    ).toBe(true);
  });
});
