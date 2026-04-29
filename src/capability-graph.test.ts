import { describe, expect, it } from "vitest";
import {
  buildCapabilityGraphSnapshot,
  listCapabilityGraphNodes,
  resolveAsyncAnalysisCapability,
  resolveCapabilityGraphSelection,
} from "./capability-graph.js";
import type { QueryPlan } from "./query-plan.js";

function buildStoreDayBreakdownPlan(): QueryPlan {
  return {
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
      normalized_question: "义乌店昨日136个钟，是怎么构成的？",
      clarification_needed: false,
    },
  };
}

describe("capability-graph", () => {
  it("exposes a graph snapshot for bridge and runtime introspection", () => {
    const snapshot = buildCapabilityGraphSnapshot();

    expect(snapshot).toMatchObject({
      version: "capability-graph-v1",
    });
    expect(snapshot.node_count).toBeGreaterThan(0);
    expect(snapshot.serving_node_count).toBeGreaterThan(0);
    expect(snapshot.runtime_render_node_count).toBeGreaterThan(0);
    expect(snapshot.async_analysis_node_count).toBeGreaterThan(0);
  });

  it("declares downstream and fallback relations for the clock breakdown capability", () => {
    const node = listCapabilityGraphNodes().find(
      (entry) => entry.capability_id === "store_day_clock_breakdown_v1",
    );

    expect(node).toMatchObject({
      capability_id: "store_day_clock_breakdown_v1",
      execution_mode: "serving_sql",
      output_kind: "answer",
      owner_surface: "store_query",
      required_slots: expect.arrayContaining(["store", "time", "metric"]),
      optional_slots: expect.arrayContaining(["dimension"]),
      clarification_policy: {
        missing_store: "clarify",
        missing_time: "clarify",
        missing_metric: "clarify",
      },
      sample_tags: expect.arrayContaining(["clock_breakdown", "store_day"]),
      failure_hints: expect.arrayContaining(["clarify_missing_metric", "capability_gap"]),
      downstream_capability_ids: ["store_day_summary_v1", "store_window_summary_v1"],
      fallback_capability_ids: ["store_day_summary_v1"],
    });
  });

  it("exposes semantic contract metadata on capability graph nodes for owner-bound optimization", () => {
    const node = listCapabilityGraphNodes().find(
      (entry) => entry.capability_id === "store_risk_v1",
    );

    expect(node).toMatchObject({
      capability_id: "store_risk_v1",
      owner_surface: "store_query",
      required_slots: expect.arrayContaining(["store", "time"]),
      optional_slots: expect.arrayContaining(["metric", "compare"]),
      clarification_policy: {
        missing_store: "clarify",
        missing_time: "clarify",
        missing_metric: "allow-default",
      },
      sample_tags: expect.arrayContaining(["risk_scan", "boss_guidance"]),
      failure_hints: expect.arrayContaining(["clarify_missing_time", "generic_unmatched"]),
    });
  });

  it("resolves an exact graph match for store day clock breakdown asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: buildStoreDayBreakdownPlan(),
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_day_clock_breakdown_v1");
    expect(selection.unmet_requirements).toEqual([]);
    expect(selection.fallback_nodes.map((entry) => entry.capability_id)).toEqual([
      "store_day_summary_v1",
    ]);
  });

  it("rejects nodes whose dimensions do not satisfy the plan", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        ...buildStoreDayBreakdownPlan(),
        dimensions: ["payment_channel"],
      },
      executionMode: "serving_sql",
    });

    expect(selection.node).toBeNull();
    expect(selection.unmet_requirements).toContain("dimension:payment_channel");
  });

  it("declares runtime-render report and advice nodes for store narrative answers", () => {
    const reportNode = listCapabilityGraphNodes().find(
      (entry) => entry.capability_id === "store_report_v1",
    );
    const adviceNode = listCapabilityGraphNodes().find(
      (entry) => entry.capability_id === "store_advice_v1",
    );

    expect(reportNode).toMatchObject({
      execution_mode: "runtime_render",
      output_kind: "answer",
    });
    expect(adviceNode).toMatchObject({
      execution_mode: "runtime_render",
      output_kind: "answer+action",
    });
  });

  it("resolves a runtime-render report capability for store report plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        ...buildStoreDayBreakdownPlan(),
        action: "report",
        metrics: ["serviceRevenue"],
        dimensions: [],
        response_shape: "narrative",
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("store_report_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render compare capability for store compare plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-compare",
        entity: "store",
        scope: {
          org_ids: ["1001", "1002"],
          scope_kind: "multi",
          access_scope_kind: "hq",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
        },
        action: "compare",
        metrics: ["serviceRevenue"],
        dimensions: [],
        filters: [],
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店和华美店昨天营收对比",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("store_compare_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves the store trend capability for non-lightweight but supported business metrics", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-trend-recharge",
        entity: "store",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-03-01",
          end_biz_date: "2026-03-30",
          window_days: 30,
        },
        action: "trend",
        metrics: ["rechargeStoredValue"],
        dimensions: [],
        filters: [],
        response_shape: "timeseries",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店近30天储值是涨还是掉",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("store_trend_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving compare capability for peer store compare plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-peer-compare-serving",
        entity: "store",
        scope: {
          org_ids: ["1001", "1002"],
          scope_kind: "multi",
          access_scope_kind: "hq",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
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
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店和华美店昨天营收对比",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_compare_lookup_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving compare capability for window total-clock compare plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-window-total-clock-compare-serving",
        entity: "store",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
          window_days: 7,
        },
        action: "compare",
        metrics: ["totalClockCount"],
        dimensions: [],
        filters: [],
        compare: {
          baseline: "previous_window",
          label: "前7天",
          start_biz_date: "2026-03-30",
          end_biz_date: "2026-04-05",
          window_days: 7,
        },
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店近7天总钟数对比",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_compare_lookup_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving compare capability for peer day customer-count compare plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-day-customer-count-compare-serving",
        entity: "store",
        scope: {
          org_ids: ["1001", "1002"],
          scope_kind: "multi",
          access_scope_kind: "hq",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
        },
        action: "compare",
        metrics: ["customerCount"],
        dimensions: [],
        filters: [],
        compare: {
          baseline: "peer_group",
          label: "同口径门店",
        },
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店和华美店昨天客流对比",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_compare_lookup_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving day summary capability for single-store day customer-count asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-day-customer-count",
        entity: "store",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
        },
        action: "summary",
        metrics: ["customerCount"],
        dimensions: [],
        filters: [],
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店昨天客流量多少",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_day_summary_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving day summary capability for single-store day order-count asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-day-order-count",
        entity: "store",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
        },
        action: "summary",
        metrics: ["serviceOrderCount"],
        dimensions: [],
        filters: [],
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店昨天订单数多少",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_day_summary_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving day summary capability for single-store day total-clock asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-day-total-clocks",
        entity: "store",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
        },
        action: "summary",
        metrics: ["totalClockCount"],
        dimensions: [],
        filters: [],
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店昨天总钟数",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_day_summary_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render metric summary capability for store metric plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-metric",
        entity: "store",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
        },
        action: "summary",
        metrics: ["addClockRate"],
        dimensions: [],
        filters: [],
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店昨天加钟率多少",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("store_metric_summary_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render store ranking capability for multi-store ranking plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-ranking",
        entity: "store",
        scope: {
          org_ids: ["1001", "1002", "1003"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
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
          confidence: 1,
          source: "rule",
          normalized_question: "近7天各店营收排名",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("store_ranking_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving day ranking capability for day multi-store ranking plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-day-ranking-serving",
        entity: "store",
        scope: {
          org_ids: ["1001", "1002", "1003"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
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
          confidence: 1,
          source: "rule",
          normalized_question: "昨天各店营收排名",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_day_ranking_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving window ranking capability for total-clock ranking plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-window-total-clock-ranking-serving",
        entity: "store",
        scope: {
          org_ids: ["1001", "1002", "1003"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
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
          confidence: 1,
          source: "rule",
          normalized_question: "近7天各店总钟数排名",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_window_ranking_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving window ranking capability for customer-count ranking plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-window-customer-count-ranking-serving",
        entity: "store",
        scope: {
          org_ids: ["1001", "1002", "1003"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
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
          confidence: 1,
          source: "rule",
          normalized_question: "近7天各店客流排名",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_window_ranking_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving window summary capability for single-store customer-count window asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-store-window-customer-count-summary-serving",
        entity: "store",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
          window_days: 7,
        },
        action: "summary",
        metrics: ["customerCount"],
        dimensions: [],
        filters: [],
        response_shape: "scalar",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店近7天客流多少",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("store_window_summary_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render tech ranking capability for technician leaderboard plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-tech-ranking",
        entity: "tech",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "day",
          biz_date: "2026-04-12",
        },
        action: "ranking",
        metrics: ["pointClockRate"],
        dimensions: [],
        filters: [],
        sort: {
          metric: "pointClockRate",
          order: "desc",
        },
        limit: 5,
        response_shape: "ranking_list",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店昨天技师点钟率排名",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("tech_leaderboard_ranking_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("also resolves tech leaderboard ranking for clock-effect asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-tech-ranking-clock-effect",
        entity: "tech",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-01",
          end_biz_date: "2026-04-30",
          window_days: 30,
        },
        action: "ranking",
        metrics: ["clockEffect"],
        dimensions: [],
        filters: [],
        sort: {
          metric: "clockEffect",
          order: "desc",
        },
        limit: 5,
        response_shape: "ranking_list",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店近30天技师钟效排名",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("tech_leaderboard_ranking_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render customer profile capability when serving is unavailable", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-customer-profile-runtime",
        entity: "customer_profile",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "as_of",
          as_of_biz_date: "2026-04-12",
        },
        action: "profile",
        metrics: [],
        dimensions: [],
        filters: [
          {
            field: "phone_suffix",
            op: "=",
            value: "7500",
          },
        ],
        response_shape: "profile_card",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店尾号7500客户画像",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("customer_profile_runtime_lookup_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render customer-segment capability for follow-up list plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-followup-list",
        entity: "customer_profile",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "as_of",
          as_of_biz_date: "2026-04-12",
        },
        action: "list",
        metrics: ["followupScore"],
        dimensions: [],
        filters: [],
        sort: {
          metric: "followupScore",
          order: "desc",
        },
        limit: 12,
        response_shape: "ranking_list",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "迎宾店过去30天哪10个顾客最需要跟进",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("customer_segment_list_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving ranked-list capability for explicit primary-segment list plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-segment-serving-list",
        entity: "customer_profile",
        scope: {
          org_ids: ["1005"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "as_of",
          as_of_biz_date: "2026-04-12",
        },
        action: "list",
        metrics: [],
        dimensions: ["segment"],
        filters: [
          {
            field: "primary_segment",
            op: "=",
            value: "sleeping-customer",
          },
        ],
        sort: {
          metric: "payAmount90d",
          order: "desc",
        },
        limit: 20,
        response_shape: "ranking_list",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "迎宾店沉睡会员名单",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("customer_ranked_list_lookup_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("prefers the serving ranked-list capability for segment tech-binding ranking plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-segment-tech-binding-serving",
        entity: "customer_profile",
        scope: {
          org_ids: ["1001"],
          scope_kind: "single",
          access_scope_kind: "manager",
        },
        time: {
          mode: "as_of",
          as_of_biz_date: "2026-04-12",
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
          confidence: 1,
          source: "rule",
          normalized_question: "义乌店哪个技师绑定的高价值会员最多",
          clarification_needed: false,
        },
      },
      executionMode: "serving_sql",
    });

    expect(selection.node?.capability_id).toBe("customer_ranked_list_lookup_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render HQ portfolio capability for fleet-overview plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-hq-portfolio",
        entity: "hq",
        scope: {
          org_ids: ["1001", "1002", "1003"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
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
          confidence: 1,
          source: "rule",
          normalized_question: "这周五个店整体怎么样，哪家在拉升，哪家最危险，下周总部先抓什么",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("hq_portfolio_overview_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render HQ focus capability for priority asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-hq-portfolio-focus",
        entity: "hq",
        scope: {
          org_ids: ["1001", "1002", "1003"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
          window_days: 7,
        },
        action: "advice",
        metrics: ["riskScore"],
        dimensions: ["store"],
        filters: [],
        response_shape: "narrative",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "五店近30天整体哪里不对",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("hq_portfolio_focus_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render HQ risk capability for explicit danger asks", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-hq-portfolio-risk",
        entity: "hq",
        scope: {
          org_ids: ["1001", "1002", "1003"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-04-06",
          end_biz_date: "2026-04-12",
          window_days: 7,
        },
        action: "risk",
        metrics: ["riskScore"],
        dimensions: ["store"],
        filters: [],
        response_shape: "narrative",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "五店近7天风险在哪",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("hq_portfolio_risk_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves a runtime-render HQ monthly trend report capability for monthly report plans", () => {
    const selection = resolveCapabilityGraphSelection({
      plan: {
        plan_version: "v1",
        request_id: "req-hq-monthly-trend",
        entity: "hq",
        scope: {
          org_ids: ["1001", "1002", "1003", "1004", "1005"],
          scope_kind: "all",
          access_scope_kind: "hq",
        },
        time: {
          mode: "window",
          start_biz_date: "2026-03-01",
          end_biz_date: "2026-03-31",
          window_days: 31,
          grain: "month",
        },
        action: "report",
        metrics: ["serviceRevenue", "customerCount", "pointClockRate", "addClockRate"],
        dimensions: ["store"],
        filters: [],
        response_shape: "narrative",
        planner_meta: {
          confidence: 1,
          source: "rule",
          normalized_question: "3月五店月度经营趋势总结",
          clarification_needed: false,
        },
      },
      executionMode: "runtime_render",
    });

    expect(selection.node?.capability_id).toBe("hq_monthly_trend_report_v1");
    expect(selection.unmet_requirements).toEqual([]);
  });

  it("resolves async-analysis capabilities for single-store and portfolio deep reviews", () => {
    expect(
      resolveAsyncAnalysisCapability({
        jobType: "store_review",
        portfolioScope: false,
      })?.capability_id,
    ).toBe("store_review_async_v1");
    expect(
      resolveAsyncAnalysisCapability({
        jobType: "store_review",
        portfolioScope: true,
      })?.capability_id,
    ).toBe("portfolio_store_review_async_v1");
  });
});
