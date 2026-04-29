import { describe, expect, it } from "vitest";
import { resolveServingCapability } from "./capability-registry.js";
import type { QueryPlan } from "./query-plan.js";
import { compileServingQuery } from "./sql-compiler.js";

describe("compileServingQuery", () => {
  it("compiles a store day summary plan into parameterized SQL", () => {
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
        normalized_question: "义乌店昨天营收多少",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_day_summary_v1");
    expect(compiled.sql).toContain("FROM serving_store_day");
    expect(compiled.sql).toContain("org_id = $1");
    expect(compiled.sql).toContain("biz_date = $2");
    expect(compiled.params).toEqual(["1001", "2026-04-07"]);
    expect(compiled.cache_key).toContain("serving-v1");
  });

  it("compiles a derived order-average metric from revenue and order count", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-day-order-average",
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
      metrics: ["orderAverageAmount"],
      dimensions: [],
      filters: [],
      response_shape: "scalar",
      planner_meta: {
        confidence: 1,
        source: "rule",
        normalized_question: "义乌店昨天单均金额多少",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_day_summary_v1");
    expect(compiled.sql).toContain("order_average_amount");
    expect(compiled.sql).toContain("service_revenue / NULLIF(service_order_count, 0)");
    expect(compiled.params).toEqual(["1001", "2026-04-07"]);
  });

  it("compiles a store day breakdown plan into parameterized SQL", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-breakdown",
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
      action: "breakdown",
      metrics: ["totalClockCount"],
      dimensions: ["clock_type"],
      filters: [],
      response_shape: "table",
      planner_meta: {
        confidence: 1,
        source: "rule",
        normalized_question: "义乌店昨天136个钟怎么构成",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_day_clock_breakdown_v1");
    expect(compiled.sql).toContain("FROM serving_store_day_breakdown");
    expect(compiled.sql).toContain("org_id = $1");
    expect(compiled.sql).toContain("biz_date = $2");
    expect(compiled.params).toEqual(["1001", "2026-04-07"]);
  });

  it("compiles an hq ranking plan against the serving portfolio surface", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-hq-ranking",
      entity: "hq",
      scope: {
        org_ids: ["1001", "1005"],
        scope_kind: "multi",
        access_scope_kind: "hq",
      },
      time: {
        mode: "window",
        end_biz_date: "2026-04-07",
        window_days: 7,
      },
      action: "ranking",
      metrics: ["riskScore"],
      dimensions: ["store"],
      filters: [],
      sort: {
        metric: "riskScore",
        order: "desc",
      },
      limit: 5,
      response_shape: "ranking_list",
      planner_meta: {
        confidence: 0.96,
        source: "rule",
        normalized_question: "五店近7天哪家店最危险",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("hq_window_ranking_v1");
    expect(compiled.sql).toContain("FROM serving_hq_portfolio_window");
    expect(compiled.sql).toContain("ORDER BY risk_score DESC");
    expect(compiled.sql).toContain("ROUND((service_revenue / NULLIF(service_order_count, 0))::numeric, 2)");
    expect(compiled.params).toEqual([["1001", "1005"], "2026-04-07", 7, 5]);
  });

  it("returns null when no capability can serve the plan", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-unsupported",
      entity: "customer_profile",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
        access_scope_kind: "manager",
      },
      time: {
        mode: "timeseries",
        start_biz_date: "2026-04-01",
        end_biz_date: "2026-04-07",
        grain: "day",
      },
      action: "trend",
      metrics: ["serviceRevenue"],
      dimensions: [],
      filters: [],
      response_shape: "timeseries",
      planner_meta: {
        confidence: 0.5,
        source: "rule+ai",
        normalized_question: "这个客户最近每天什么情况",
        clarification_needed: false,
      },
    };

    expect(resolveServingCapability(plan)).toBeNull();
  });

  it("compiles a customer ranked-list plan with segment filtering", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-customer-list",
      entity: "customer_profile",
      scope: {
        org_ids: ["1005"],
        scope_kind: "single",
        access_scope_kind: "manager",
      },
      time: {
        mode: "as_of",
        as_of_biz_date: "2026-04-07",
      },
      action: "list",
      metrics: ["riskScore"],
      dimensions: [],
      filters: [
        {
          field: "followup_bucket",
          op: "=",
          value: "high-value-reactivation",
        },
      ],
      sort: {
        metric: "riskScore",
        order: "desc",
      },
      limit: 12,
      response_shape: "ranking_list",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "迎宾店高价值待唤回名单",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("customer_ranked_list_lookup_v1");
    expect(compiled.sql).toContain("FROM serving_customer_ranked_list_asof");
    expect(compiled.sql).toContain("followup_bucket = $3");
    expect(compiled.sql).toContain("ORDER BY risk_score DESC");
    expect(compiled.params).toEqual([
      "1005",
      "2026-04-07",
      "high-value-reactivation",
      12,
    ]);
  });

  it("compiles a segment tech-binding ranking plan into grouped serving SQL", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-segment-tech-binding",
      entity: "customer_profile",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
        access_scope_kind: "manager",
      },
      time: {
        mode: "as_of",
        as_of_biz_date: "2026-03-30",
      },
      action: "list",
      metrics: [],
      dimensions: ["segment", "tech"],
      filters: [
        {
          field: "primary_segment",
          op: "=",
          value: "important-value-member",
        },
      ],
      response_shape: "ranking_list",
      planner_meta: {
        confidence: 0.98,
        source: "rule",
        normalized_question: "义乌店哪个技师绑定的高价值会员最多",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("customer_ranked_list_lookup_v1");
    expect(compiled.sql).toContain("FROM serving_customer_ranked_list_asof");
    expect(compiled.sql).toContain("identity_stable = TRUE");
    expect(compiled.sql).toContain("top_tech_name IS NOT NULL");
    expect(compiled.sql).toContain("GROUP BY org_id, as_of_biz_date, primary_segment, top_tech_name");
    expect(compiled.sql).toContain("ORDER BY customer_count DESC, tech_name ASC");
    expect(compiled.params).toEqual(["1001", "2026-03-30", "important-value-member", 20]);
  });

  it("compiles a store ranking plan against the serving store window surface", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-ranking",
      entity: "store",
      scope: {
        org_ids: ["1001", "1005"],
        scope_kind: "multi",
        access_scope_kind: "hq",
      },
      time: {
        mode: "window",
        end_biz_date: "2026-04-07",
        window_days: 7,
      },
      action: "ranking",
      metrics: ["serviceRevenue"],
      dimensions: [],
      filters: [],
      sort: {
        metric: "serviceRevenue",
        order: "desc",
      },
      limit: 5,
      response_shape: "ranking_list",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "近7天五店营收排名",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_window_ranking_v1");
    expect(compiled.sql).toContain("FROM serving_store_window");
    expect(compiled.sql).toContain("ORDER BY service_revenue DESC");
    expect(compiled.sql).toContain("ROUND((service_revenue / NULLIF(service_order_count, 0))::numeric, 2)");
    expect(compiled.params).toEqual([["1001", "1005"], "2026-04-07", 7, 5]);
  });

  it("compiles a single-store window customer-count summary plan with customer_count selected", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-window-customer-count-summary",
      entity: "store",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
        access_scope_kind: "manager",
      },
      time: {
        mode: "window",
        end_biz_date: "2026-04-07",
        window_days: 7,
      },
      action: "summary",
      metrics: ["customerCount"],
      dimensions: [],
      filters: [],
      response_shape: "scalar",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "义乌店近7天客流多少",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_window_summary_v1");
    expect(compiled.sql).toContain("FROM serving_store_window");
    expect(compiled.sql).toContain("customer_count");
    expect(compiled.params).toEqual(["1001", "2026-04-07", 7]);
  });

  it("compiles a total-clock store ranking plan against the serving store window surface", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-total-clock-ranking",
      entity: "store",
      scope: {
        org_ids: ["1001", "1005"],
        scope_kind: "multi",
        access_scope_kind: "hq",
      },
      time: {
        mode: "window",
        end_biz_date: "2026-04-07",
        window_days: 7,
      },
      action: "ranking",
      metrics: ["totalClockCount"],
      dimensions: [],
      filters: [],
      sort: {
        metric: "totalClockCount",
        order: "desc",
      },
      limit: 5,
      response_shape: "ranking_list",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "近7天五店总钟数排名",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_window_ranking_v1");
    expect(compiled.sql).toContain("FROM serving_store_window");
    expect(compiled.sql).toContain("total_clocks");
    expect(compiled.sql).toContain("ORDER BY total_clocks DESC");
    expect(compiled.params).toEqual([["1001", "1005"], "2026-04-07", 7, 5]);
  });

  it("compiles a customer-count store ranking plan with customer_count selected", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-customer-count-ranking",
      entity: "store",
      scope: {
        org_ids: ["1001", "1005"],
        scope_kind: "multi",
        access_scope_kind: "hq",
      },
      time: {
        mode: "window",
        end_biz_date: "2026-04-07",
        window_days: 7,
      },
      action: "ranking",
      metrics: ["customerCount"],
      dimensions: [],
      filters: [],
      sort: {
        metric: "customerCount",
        order: "desc",
      },
      limit: 5,
      response_shape: "ranking_list",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "近7天五店客流排名",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_window_ranking_v1");
    expect(compiled.sql).toContain("FROM serving_store_window");
    expect(compiled.sql).toContain("customer_count");
    expect(compiled.sql).toContain("ORDER BY customer_count DESC");
    expect(compiled.params).toEqual([["1001", "1005"], "2026-04-07", 7, 5]);
  });

  it("compiles a peer store compare plan against serving day surfaces", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-peer-compare-day",
      entity: "store",
      scope: {
        org_ids: ["1001", "1002"],
        scope_kind: "multi",
        access_scope_kind: "hq",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
      action: "compare",
      metrics: ["serviceRevenue"],
      dimensions: [],
      filters: [],
      compare: {
        baseline: "peer_group",
        label: "同口径门店",
      },
      response_shape: "scalar",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "义乌店和园中园店昨天营收对比",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_compare_lookup_v1");
    expect(compiled.sql).toContain("FROM serving_store_day");
    expect(compiled.sql).toContain("metric_value");
    expect(compiled.sql).toContain("baseline_metric_value");
    expect(compiled.sql).toContain("baseline_store_name");
    expect(compiled.params).toEqual(["1001", "2026-04-07", "1002", "2026-04-07"]);
  });

  it("compiles a window total-clock compare plan against serving window surfaces", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-window-total-clock-compare",
      entity: "store",
      scope: {
        org_ids: ["1001"],
        scope_kind: "single",
        access_scope_kind: "manager",
      },
      time: {
        mode: "window",
        end_biz_date: "2026-04-07",
        window_days: 7,
      },
      action: "compare",
      metrics: ["totalClockCount"],
      dimensions: [],
      filters: [],
      compare: {
        baseline: "previous_window",
        label: "前7天",
        end_biz_date: "2026-03-31",
        window_days: 7,
      },
      response_shape: "scalar",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "义乌店近7天总钟数对比",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_compare_lookup_v1");
    expect(compiled.sql).toContain("FROM serving_store_window");
    expect(compiled.sql).toContain("total_clocks AS metric_value");
    expect(compiled.sql).toContain("total_clocks AS baseline_metric_value");
    expect(compiled.params).toEqual(["1001", "2026-04-07", 7, "2026-03-31", 7]);
  });

  it("compiles a day store ranking plan against serving day surfaces", () => {
    const plan: QueryPlan = {
      plan_version: "v1",
      request_id: "req-store-day-ranking",
      entity: "store",
      scope: {
        org_ids: ["1001", "1005"],
        scope_kind: "multi",
        access_scope_kind: "hq",
      },
      time: {
        mode: "day",
        biz_date: "2026-04-07",
      },
      action: "ranking",
      metrics: ["serviceRevenue"],
      dimensions: [],
      filters: [],
      sort: {
        metric: "serviceRevenue",
        order: "desc",
      },
      limit: 5,
      response_shape: "ranking_list",
      planner_meta: {
        confidence: 0.95,
        source: "rule",
        normalized_question: "昨天各店营收排名",
        clarification_needed: false,
      },
    };

    const capability = resolveServingCapability(plan);
    const compiled = compileServingQuery({
      plan,
      capability: capability!,
      servingVersion: "serving-v1",
    });

    expect(compiled.capability_id).toBe("store_day_ranking_v1");
    expect(compiled.sql).toContain("FROM serving_store_day");
    expect(compiled.sql).toContain("ORDER BY service_revenue DESC");
    expect(compiled.params).toEqual([["1001", "1005"], "2026-04-07", 5]);
  });
});
