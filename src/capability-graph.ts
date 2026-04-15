import type { QueryPlan } from "./query-plan.js";
import type { HetangAnalysisJobType } from "./types.js";
import { listSupportedMetricDefinitions } from "./metric-query.js";

export const CAPABILITY_GRAPH_VERSION = "capability-graph-v1" as const;

export type CapabilityExecutionMode = "serving_sql" | "runtime_render" | "async_analysis";
export type CapabilityOutputKind = "answer" | "answer+action" | "action";

export type ServingSqlFamily =
  | "summary_by_pk"
  | "day_breakdown"
  | "window_summary"
  | "compare_lookup"
  | "ranking"
  | "day_ranking"
  | "window_ranking"
  | "profile_lookup"
  | "ranked_list_lookup";

type CapabilityNodeBase = {
  capability_id: string;
  entity: QueryPlan["entity"];
  actions: QueryPlan["action"][];
  execution_mode: CapabilityExecutionMode;
  output_kind: CapabilityOutputKind;
  supported_metrics: string[];
  supported_time_modes: QueryPlan["time"]["mode"][];
  supported_dimensions: string[];
  supported_response_shapes: QueryPlan["response_shape"][];
  max_org_count: number;
  downstream_capability_ids: string[];
  fallback_capability_ids: string[];
  description: string;
};

export type ServingCapabilityNode = CapabilityNodeBase & {
  execution_mode: "serving_sql";
  serving_surface: string;
  sql_family: ServingSqlFamily;
  cache_ttl_seconds: number;
};

export type CapabilityGraphNode = ServingCapabilityNode;
export type RuntimeRenderCapabilityNode = CapabilityNodeBase & {
  execution_mode: "runtime_render";
};
export type AsyncAnalysisCapabilityNode = CapabilityNodeBase & {
  execution_mode: "async_analysis";
  analysis_job_types: HetangAnalysisJobType[];
};
export type AnyCapabilityGraphNode =
  | ServingCapabilityNode
  | RuntimeRenderCapabilityNode
  | AsyncAnalysisCapabilityNode;

export type CapabilityGraphSelection = {
  node: AnyCapabilityGraphNode | null;
  unmet_requirements: string[];
  fallback_nodes: AnyCapabilityGraphNode[];
};

const ALL_STANDARD_METRICS = listSupportedMetricDefinitions().map((entry) => entry.key);

const CAPABILITY_GRAPH_NODES: AnyCapabilityGraphNode[] = [
  {
    capability_id: "store_day_summary_v1",
    entity: "store",
    actions: ["summary"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_store_day",
    sql_family: "summary_by_pk",
    supported_metrics: [
      "serviceRevenue",
      "serviceOrderCount",
      "customerCount",
      "totalClockCount",
      "averageTicket",
      "clockEffect",
      "pointClockRate",
      "addClockRate",
    ],
    supported_time_modes: ["day"],
    supported_dimensions: [],
    supported_response_shapes: ["scalar"],
    max_org_count: 1,
    downstream_capability_ids: ["store_day_clock_breakdown_v1", "store_window_summary_v1"],
    fallback_capability_ids: [],
    description: "单店单日确定性摘要查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "store_day_clock_breakdown_v1",
    entity: "store",
    actions: ["breakdown"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_store_day_breakdown",
    sql_family: "day_breakdown",
    supported_metrics: ["totalClockCount"],
    supported_time_modes: ["day"],
    supported_dimensions: ["clock_type"],
    supported_response_shapes: ["table"],
    max_org_count: 1,
    downstream_capability_ids: ["store_day_summary_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["store_day_summary_v1"],
    description: "单店单日钟数结构拆解",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "store_report_v1",
    entity: "store",
    actions: ["report"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ["serviceRevenue"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["narrative"],
    max_org_count: 1,
    downstream_capability_ids: ["store_day_summary_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["store_day_summary_v1"],
    description: "单店日报与复盘叙事输出",
  },
  {
    capability_id: "store_metric_summary_v1",
    entity: "store",
    actions: ["summary"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ALL_STANDARD_METRICS,
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["scalar"],
    max_org_count: 1,
    downstream_capability_ids: ["store_day_summary_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["store_day_summary_v1", "store_window_summary_v1"],
    description: "单店指标摘要在非 serving 环境下的运行时渲染",
  },
  {
    capability_id: "store_metric_breakdown_runtime_v1",
    entity: "store",
    actions: ["breakdown"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ["totalClockCount"],
    supported_time_modes: ["day"],
    supported_dimensions: ["clock_type"],
    supported_response_shapes: ["table"],
    max_org_count: 1,
    downstream_capability_ids: ["store_day_clock_breakdown_v1", "store_metric_summary_v1"],
    fallback_capability_ids: ["store_day_clock_breakdown_v1", "store_metric_summary_v1"],
    description: "单店钟数构成在非 serving 环境下的运行时渲染",
  },
  {
    capability_id: "store_compare_v1",
    entity: "store",
    actions: ["compare"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ALL_STANDARD_METRICS,
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["scalar"],
    max_org_count: 2,
    downstream_capability_ids: ["store_metric_summary_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["store_metric_summary_v1", "store_window_summary_v1"],
    description: "门店之间或门店跨期指标对比",
  },
  {
    capability_id: "store_compare_lookup_v1",
    entity: "store",
    actions: ["compare"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_store_compare_lookup",
    sql_family: "compare_lookup",
    supported_metrics: [
      "serviceRevenue",
      "serviceOrderCount",
      "totalClockCount",
      "averageTicket",
      "clockEffect",
      "pointClockRate",
      "addClockRate",
    ],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["scalar"],
    max_org_count: 2,
    downstream_capability_ids: ["store_day_summary_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["store_compare_v1", "store_metric_summary_v1", "store_window_summary_v1"],
    description: "门店跨店或跨期指标对比查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "store_trend_v1",
    entity: "store",
    actions: ["trend"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ["serviceRevenue", "averageTicket", "clockEffect", "riskScore"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["timeseries"],
    max_org_count: 1,
    downstream_capability_ids: ["store_window_summary_v1"],
    fallback_capability_ids: ["store_window_summary_v1"],
    description: "单店趋势解释输出",
  },
  {
    capability_id: "store_anomaly_v1",
    entity: "store",
    actions: ["anomaly"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ["serviceRevenue", "averageTicket", "clockEffect", "riskScore"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["narrative"],
    max_org_count: 1,
    downstream_capability_ids: ["store_day_summary_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["store_day_summary_v1"],
    description: "单店异常归因解释输出",
  },
  {
    capability_id: "store_risk_v1",
    entity: "store",
    actions: ["risk"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: ["riskScore"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["narrative"],
    max_org_count: 20,
    downstream_capability_ids: ["store_window_summary_v1", "hq_window_ranking_v1"],
    fallback_capability_ids: ["store_window_summary_v1"],
    description: "门店风险判断与动作建议",
  },
  {
    capability_id: "store_advice_v1",
    entity: "store",
    actions: ["advice"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: ["riskScore"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["narrative"],
    max_org_count: 20,
    downstream_capability_ids: ["store_risk_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["store_risk_v1"],
    description: "门店动作建议输出",
  },
  {
    capability_id: "store_review_async_v1",
    entity: "store",
    actions: ["report", "advice"],
    execution_mode: "async_analysis",
    output_kind: "answer+action",
    analysis_job_types: ["store_review"],
    supported_metrics: ["riskScore"],
    supported_time_modes: ["window"],
    supported_dimensions: [],
    supported_response_shapes: ["narrative"],
    max_org_count: 1,
    downstream_capability_ids: ["store_report_v1", "store_advice_v1"],
    fallback_capability_ids: ["store_report_v1"],
    description: "单店异步深度经营复盘",
  },
  {
    capability_id: "portfolio_store_review_async_v1",
    entity: "hq",
    actions: ["report", "advice"],
    execution_mode: "async_analysis",
    output_kind: "answer+action",
    analysis_job_types: ["store_review"],
    supported_metrics: ["riskScore"],
    supported_time_modes: ["window"],
    supported_dimensions: ["store"],
    supported_response_shapes: ["narrative"],
    max_org_count: 20,
    downstream_capability_ids: ["hq_window_ranking_v1", "store_risk_v1"],
    fallback_capability_ids: ["hq_window_ranking_v1"],
    description: "多店异步深度经营复盘",
  },
  {
    capability_id: "hq_portfolio_overview_v1",
    entity: "hq",
    actions: ["ranking"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: ["riskScore"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["store"],
    supported_response_shapes: ["ranking_list", "scalar"],
    max_org_count: 20,
    downstream_capability_ids: ["hq_window_ranking_v1", "store_risk_v1"],
    fallback_capability_ids: ["hq_window_ranking_v1"],
    description: "总部多店经营全景与风险总览",
  },
  {
    capability_id: "store_ranking_v1",
    entity: "store",
    actions: ["ranking"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ALL_STANDARD_METRICS,
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 20,
    downstream_capability_ids: ["store_window_ranking_v1", "store_metric_summary_v1"],
    fallback_capability_ids: ["store_window_ranking_v1", "store_metric_summary_v1"],
    description: "多店指标排名在非 serving 环境下的运行时渲染",
  },
  {
    capability_id: "store_window_summary_v1",
    entity: "store",
    actions: ["summary"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_store_window",
    sql_family: "window_summary",
    supported_metrics: [
      "serviceRevenue",
      "serviceOrderCount",
      "totalClockCount",
      "averageTicket",
      "clockEffect",
      "pointClockRate",
      "addClockRate",
      "riskScore",
    ],
    supported_time_modes: ["window"],
    supported_dimensions: [],
    supported_response_shapes: ["scalar"],
    max_org_count: 1,
    downstream_capability_ids: ["store_window_ranking_v1"],
    fallback_capability_ids: [],
    description: "单店时间窗摘要与对比查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "store_day_ranking_v1",
    entity: "store",
    actions: ["ranking"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_store_day",
    sql_family: "day_ranking",
    supported_metrics: [
      "serviceRevenue",
      "serviceOrderCount",
      "customerCount",
      "totalClockCount",
      "averageTicket",
      "clockEffect",
      "pointClockRate",
      "addClockRate",
    ],
    supported_time_modes: ["day"],
    supported_dimensions: [],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 20,
    downstream_capability_ids: ["store_day_summary_v1"],
    fallback_capability_ids: ["store_ranking_v1", "store_metric_summary_v1"],
    description: "多店单日指标排名查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "store_window_ranking_v1",
    entity: "store",
    actions: ["ranking"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_store_window",
    sql_family: "window_ranking",
    supported_metrics: [
      "riskScore",
      "serviceRevenue",
      "serviceOrderCount",
      "totalClockCount",
      "averageTicket",
      "clockEffect",
      "pointClockRate",
      "addClockRate",
    ],
    supported_time_modes: ["window"],
    supported_dimensions: ["store"],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 20,
    downstream_capability_ids: ["store_window_summary_v1"],
    fallback_capability_ids: [],
    description: "多店时间窗排名查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "hq_window_ranking_v1",
    entity: "hq",
    actions: ["ranking"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_hq_portfolio_window",
    sql_family: "ranking",
    supported_metrics: [
      "riskScore",
      "serviceRevenue",
      "serviceOrderCount",
      "totalClockCount",
      "averageTicket",
      "pointClockRate",
      "addClockRate",
    ],
    supported_time_modes: ["window"],
    supported_dimensions: ["store"],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 20,
    downstream_capability_ids: ["store_window_summary_v1"],
    fallback_capability_ids: [],
    description: "总部视角五店时间窗排名查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "customer_profile_runtime_lookup_v1",
    entity: "customer_profile",
    actions: ["profile"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: [],
    supported_time_modes: ["as_of"],
    supported_dimensions: [],
    supported_response_shapes: ["profile_card"],
    max_org_count: 1,
    downstream_capability_ids: ["customer_profile_lookup_v1"],
    fallback_capability_ids: ["customer_profile_lookup_v1"],
    description: "顾客画像在非 serving 环境下的运行时渲染",
  },
  {
    capability_id: "customer_profile_lookup_v1",
    entity: "customer_profile",
    actions: ["profile"],
    execution_mode: "serving_sql",
    output_kind: "answer",
    serving_surface: "serving_customer_profile_asof",
    sql_family: "profile_lookup",
    supported_metrics: [],
    supported_time_modes: ["as_of"],
    supported_dimensions: [],
    supported_response_shapes: ["profile_card"],
    max_org_count: 1,
    downstream_capability_ids: ["customer_ranked_list_lookup_v1"],
    fallback_capability_ids: [],
    description: "顾客画像单卡片查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "customer_ranked_list_lookup_v1",
    entity: "customer_profile",
    actions: ["list", "ranking"],
    execution_mode: "serving_sql",
    output_kind: "answer+action",
    serving_surface: "serving_customer_ranked_list_asof",
    sql_family: "ranked_list_lookup",
    supported_metrics: ["followupScore", "riskScore"],
    supported_time_modes: ["as_of"],
    supported_dimensions: ["segment", "tech"],
    supported_response_shapes: ["ranking_list", "scalar"],
    max_org_count: 1,
    downstream_capability_ids: ["customer_profile_lookup_v1"],
    fallback_capability_ids: [],
    description: "顾客分层与跟进名单查询",
    cache_ttl_seconds: 300,
  },
  {
    capability_id: "customer_segment_list_v1",
    entity: "customer_profile",
    actions: ["list"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ["followupScore", "riskScore"],
    supported_time_modes: ["as_of"],
    supported_dimensions: ["segment", "tech"],
    supported_response_shapes: ["ranking_list", "scalar"],
    max_org_count: 1,
    downstream_capability_ids: ["customer_ranked_list_lookup_v1"],
    fallback_capability_ids: ["customer_ranked_list_lookup_v1"],
    description: "顾客分层名单、跟进名单与数量诊断",
  },
  {
    capability_id: "customer_relation_lookup_v1",
    entity: "customer_profile",
    actions: ["profile"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: [],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["tech", "customer"],
    supported_response_shapes: ["narrative"],
    max_org_count: 1,
    downstream_capability_ids: ["customer_profile_lookup_v1"],
    fallback_capability_ids: ["customer_profile_lookup_v1"],
    description: "顾客与技师关系链查询",
  },
  {
    capability_id: "birthday_member_list_v1",
    entity: "customer_profile",
    actions: ["list"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: [],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 1,
    downstream_capability_ids: ["customer_segment_list_v1"],
    fallback_capability_ids: ["customer_segment_list_v1"],
    description: "生日会员关怀与唤回名单",
  },
  {
    capability_id: "member_marketing_analysis_v1",
    entity: "customer_profile",
    actions: ["ranking"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: [],
    supported_time_modes: ["as_of"],
    supported_dimensions: ["source", "marketer", "label"],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 1,
    downstream_capability_ids: ["customer_segment_list_v1"],
    fallback_capability_ids: ["customer_segment_list_v1"],
    description: "会员来源/营销归因分析",
  },
  {
    capability_id: "tech_leaderboard_ranking_v1",
    entity: "tech",
    actions: ["ranking"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: [
      "serviceRevenue",
      "clockEffect",
      "pointClockRate",
      "addClockRate",
      "totalClockCount",
      "techCommissionRate",
    ],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 1,
    downstream_capability_ids: [],
    fallback_capability_ids: [],
    description: "技师排行榜查询",
  },
  {
    capability_id: "tech_profile_lookup_v1",
    entity: "tech",
    actions: ["profile"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: [],
    supported_time_modes: ["day", "window"],
    supported_dimensions: [],
    supported_response_shapes: ["profile_card"],
    max_org_count: 1,
    downstream_capability_ids: [],
    fallback_capability_ids: [],
    description: "技师画像查询",
  },
  {
    capability_id: "arrival_profile_timeseries_v1",
    entity: "store",
    actions: ["trend"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: [],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["hour_bucket"],
    supported_response_shapes: ["timeseries"],
    max_org_count: 1,
    downstream_capability_ids: ["store_trend_v1"],
    fallback_capability_ids: ["store_trend_v1"],
    description: "门店到店时段分布画像",
  },
  {
    capability_id: "wait_experience_analysis_v1",
    entity: "store",
    actions: ["anomaly"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: [],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["time_bucket", "tech", "room", "clock_kind"],
    supported_response_shapes: ["narrative"],
    max_org_count: 1,
    downstream_capability_ids: ["store_anomaly_v1"],
    fallback_capability_ids: ["store_anomaly_v1"],
    description: "门店等待体验分析",
  },
  {
    capability_id: "recharge_attribution_analysis_v1",
    entity: "store",
    actions: ["ranking"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: [],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["card_type", "sales"],
    supported_response_shapes: ["ranking_list"],
    max_org_count: 1,
    downstream_capability_ids: [],
    fallback_capability_ids: [],
    description: "充值卡型与客服归因分析",
  },
];

function scoreNodeSpecificity(node: AnyCapabilityGraphNode): number {
  return (
    node.supported_metrics.length * 4 +
    node.supported_dimensions.length * 3 +
    node.supported_response_shapes.length * 2 +
    node.supported_time_modes.length
  );
}

function computeUnmetRequirements(node: AnyCapabilityGraphNode, plan: QueryPlan): string[] {
  const unmet: string[] = [];
  if (node.entity !== plan.entity) {
    unmet.push(`entity:${plan.entity}`);
  }
  if (!node.actions.includes(plan.action)) {
    unmet.push(`action:${plan.action}`);
  }
  if (!node.supported_time_modes.includes(plan.time.mode)) {
    unmet.push(`time_mode:${plan.time.mode}`);
  }
  if (plan.scope.org_ids.length > node.max_org_count) {
    unmet.push(`org_count>${node.max_org_count}`);
  }
  if (!node.supported_response_shapes.includes(plan.response_shape)) {
    unmet.push(`response_shape:${plan.response_shape}`);
  }
  for (const metric of plan.metrics) {
    if (!node.supported_metrics.includes(metric)) {
      unmet.push(`metric:${metric}`);
    }
  }
  for (const dimension of plan.dimensions) {
    if (!node.supported_dimensions.includes(dimension)) {
      unmet.push(`dimension:${dimension}`);
    }
  }
  return unmet;
}

export function isServingCapabilityNode(
  node: AnyCapabilityGraphNode,
): node is ServingCapabilityNode {
  return node.execution_mode === "serving_sql";
}

export function isRuntimeRenderCapabilityNode(
  node: AnyCapabilityGraphNode,
): node is RuntimeRenderCapabilityNode {
  return node.execution_mode === "runtime_render";
}

export function listCapabilityGraphNodes(): AnyCapabilityGraphNode[] {
  return CAPABILITY_GRAPH_NODES;
}

export function buildCapabilityGraphSnapshot(): {
  version: typeof CAPABILITY_GRAPH_VERSION;
  node_count: number;
  serving_node_count: number;
  runtime_render_node_count: number;
  async_analysis_node_count: number;
} {
  const nodes = listCapabilityGraphNodes();
  return {
    version: CAPABILITY_GRAPH_VERSION,
    node_count: nodes.length,
    serving_node_count: nodes.filter(isServingCapabilityNode).length,
    runtime_render_node_count: nodes.filter((node) => node.execution_mode === "runtime_render")
      .length,
    async_analysis_node_count: nodes.filter((node) => node.execution_mode === "async_analysis")
      .length,
  };
}

export function resolveCapabilityGraphSelection(params: {
  plan: QueryPlan;
  executionMode?: CapabilityExecutionMode;
}): CapabilityGraphSelection {
  const nodes = listCapabilityGraphNodes().filter((node) =>
    params.executionMode ? node.execution_mode === params.executionMode : true,
  );
  const nearbyNodes = nodes.filter(
    (node) => node.entity === params.plan.entity && node.actions.includes(params.plan.action),
  );
  const candidateNodes = nearbyNodes.length > 0 ? nearbyNodes : nodes;
  const evaluated = candidateNodes.map((node) => ({
    node,
    unmet: computeUnmetRequirements(node, params.plan),
  }));
  const exactMatches = evaluated
    .filter((entry) => entry.unmet.length === 0)
    .sort((left, right) => scoreNodeSpecificity(right.node) - scoreNodeSpecificity(left.node));

  if (exactMatches.length > 0) {
    const selected = exactMatches[0]!.node;
    return {
      node: selected,
      unmet_requirements: [],
      fallback_nodes: selected.fallback_capability_ids
        .map((capabilityId) =>
          listCapabilityGraphNodes().find((entry) => entry.capability_id === capabilityId),
        )
        .filter((entry): entry is AnyCapabilityGraphNode => Boolean(entry)),
    };
  }

  const closest = evaluated.sort(
    (left, right) =>
      left.unmet.length - right.unmet.length ||
      scoreNodeSpecificity(right.node) - scoreNodeSpecificity(left.node),
  )[0];

  return {
    node: null,
    unmet_requirements: closest?.unmet ?? [],
    fallback_nodes: [],
  };
}

export function resolveAsyncAnalysisCapability(params: {
  jobType: HetangAnalysisJobType;
  portfolioScope: boolean;
}): AsyncAnalysisCapabilityNode | null {
  const targetCapabilityId = params.portfolioScope
    ? "portfolio_store_review_async_v1"
    : "store_review_async_v1";
  const node = listCapabilityGraphNodes().find(
    (entry) =>
      entry.execution_mode === "async_analysis" &&
      entry.capability_id === targetCapabilityId &&
      entry.analysis_job_types.includes(params.jobType),
  );
  return node && node.execution_mode === "async_analysis" ? node : null;
}
