import type { QueryPlan } from "./query-plan.js";
import type { HetangAnalysisJobType } from "./types.js";
import { listSupportedMetricDefinitions } from "./metric-query.js";

export const CAPABILITY_GRAPH_VERSION = "capability-graph-v1" as const;

export type CapabilityExecutionMode = "serving_sql" | "runtime_render" | "async_analysis";
export type CapabilityOutputKind = "answer" | "answer+action" | "action";
export type CapabilityOwnerSurface =
  | "store_query"
  | "hq_query"
  | "customer_query"
  | "tech_query";
export type CapabilitySemanticSlot = "store" | "time" | "metric" | "dimension" | "compare";
export type CapabilityClarificationResolution = "clarify" | "allow-default" | "not-applicable";
export type CapabilityFailureHint =
  | "clarify_missing_store"
  | "clarify_missing_time"
  | "clarify_missing_metric"
  | "capability_gap"
  | "generic_unmatched";

export type CapabilityClarificationPolicy = {
  missing_store: CapabilityClarificationResolution;
  missing_time: CapabilityClarificationResolution;
  missing_metric: CapabilityClarificationResolution;
};

export type CapabilitySemanticContract = {
  owner_surface: CapabilityOwnerSurface;
  required_slots: CapabilitySemanticSlot[];
  optional_slots: CapabilitySemanticSlot[];
  clarification_policy: CapabilityClarificationPolicy;
  failure_hints: CapabilityFailureHint[];
  sample_tags: string[];
};

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
} & CapabilitySemanticContract;

type CapabilityNodeSeedBase = Omit<
  CapabilityNodeBase,
  | "owner_surface"
  | "required_slots"
  | "optional_slots"
  | "clarification_policy"
  | "failure_hints"
  | "sample_tags"
>;

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
type ServingCapabilityNodeSeed = CapabilityNodeSeedBase & {
  execution_mode: "serving_sql";
  serving_surface: string;
  sql_family: ServingSqlFamily;
  cache_ttl_seconds: number;
};
type RuntimeRenderCapabilityNodeSeed = CapabilityNodeSeedBase & {
  execution_mode: "runtime_render";
};
type AsyncAnalysisCapabilityNodeSeed = CapabilityNodeSeedBase & {
  execution_mode: "async_analysis";
  analysis_job_types: HetangAnalysisJobType[];
};
type AnyCapabilityGraphNodeSeed =
  | ServingCapabilityNodeSeed
  | RuntimeRenderCapabilityNodeSeed
  | AsyncAnalysisCapabilityNodeSeed;

export type CapabilityGraphSelection = {
  node: AnyCapabilityGraphNode | null;
  unmet_requirements: string[];
  fallback_nodes: AnyCapabilityGraphNode[];
};

const ALL_STANDARD_METRICS = listSupportedMetricDefinitions().map((entry) => entry.key);

const CAPABILITY_GRAPH_NODE_SEEDS: AnyCapabilityGraphNodeSeed[] = [
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
      "orderAverageAmount",
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
    capability_id: "store_market_breakdown_v1",
    entity: "store",
    actions: ["breakdown"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: ["marketRevenue"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["item_type", "item_name", "tech"],
    supported_response_shapes: ["table"],
    max_org_count: 1,
    downstream_capability_ids: ["store_metric_summary_v1"],
    fallback_capability_ids: ["store_metric_summary_v1"],
    description: "单店副项/饮品/精油等销售明细在非 serving 环境下的运行时渲染",
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
      "orderAverageAmount",
      "customerCount",
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
    supported_metrics: [...ALL_STANDARD_METRICS, "riskScore"],
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
    supported_metrics: [...ALL_STANDARD_METRICS, "riskScore"],
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
    capability_id: "hq_portfolio_focus_v1",
    entity: "hq",
    actions: ["advice", "report"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: ["riskScore"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["store"],
    supported_response_shapes: ["narrative"],
    max_org_count: 20,
    downstream_capability_ids: ["hq_portfolio_overview_v1", "store_risk_v1", "store_advice_v1"],
    fallback_capability_ids: ["hq_portfolio_overview_v1", "hq_window_ranking_v1"],
    description: "总部多店重点盯防与优先动作",
  },
  {
    capability_id: "hq_portfolio_risk_v1",
    entity: "hq",
    actions: ["risk"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: ["riskScore"],
    supported_time_modes: ["day", "window"],
    supported_dimensions: ["store"],
    supported_response_shapes: ["narrative"],
    max_org_count: 20,
    downstream_capability_ids: ["hq_window_ranking_v1", "store_risk_v1"],
    fallback_capability_ids: ["hq_window_ranking_v1", "hq_portfolio_overview_v1"],
    description: "总部多店风险雷达与优先修复动作",
  },
  {
    capability_id: "hq_monthly_trend_report_v1",
    entity: "hq",
    actions: ["report", "trend"],
    execution_mode: "runtime_render",
    output_kind: "answer+action",
    supported_metrics: [
      "serviceRevenue",
      "customerCount",
      "orderAverageAmount",
      "pointClockRate",
      "addClockRate",
      "clockEffect",
      "newMembers",
      "rechargeCash",
      "riskScore",
    ],
    supported_time_modes: ["window", "timeseries"],
    supported_dimensions: ["store"],
    supported_response_shapes: ["narrative"],
    max_org_count: 20,
    downstream_capability_ids: ["hq_window_ranking_v1", "store_window_summary_v1"],
    fallback_capability_ids: ["hq_portfolio_overview_v1", "hq_window_ranking_v1"],
    description: "总部视角月度经营趋势总结",
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
      "orderAverageAmount",
      "customerCount",
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
      "orderAverageAmount",
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
      "orderAverageAmount",
      "customerCount",
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
      "orderAverageAmount",
      "customerCount",
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
      "marketRevenue",
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
    capability_id: "tech_current_runtime_v1",
    entity: "tech",
    actions: ["summary", "list"],
    execution_mode: "runtime_render",
    output_kind: "answer",
    supported_metrics: [],
    supported_time_modes: ["as_of"],
    supported_dimensions: ["tech_state"],
    supported_response_shapes: ["scalar", "ranking_list"],
    max_org_count: 1,
    downstream_capability_ids: ["tech_profile_lookup_v1"],
    fallback_capability_ids: [],
    description: "技师当前楼面状态查询",
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

type CapabilitySemanticContractOverride = Partial<
  Omit<CapabilitySemanticContract, "clarification_policy">
> & {
  clarification_policy?: Partial<CapabilityClarificationPolicy>;
};

const CAPABILITY_GRAPH_CONTRACT_OVERRIDES: Partial<
  Record<string, CapabilitySemanticContractOverride>
> = {
  store_day_summary_v1: {
    sample_tags: ["metric_summary", "store_day"],
  },
  store_day_clock_breakdown_v1: {
    owner_surface: "store_query",
    required_slots: ["store", "time", "metric"],
    optional_slots: ["dimension"],
    clarification_policy: {
      missing_store: "clarify",
      missing_time: "clarify",
      missing_metric: "clarify",
    },
    failure_hints: ["clarify_missing_metric", "capability_gap"],
    sample_tags: ["clock_breakdown", "store_day"],
  },
  store_window_summary_v1: {
    sample_tags: ["metric_summary", "store_window"],
  },
  store_risk_v1: {
    owner_surface: "store_query",
    required_slots: ["store", "time"],
    optional_slots: ["metric", "compare"],
    clarification_policy: {
      missing_store: "clarify",
      missing_time: "clarify",
      missing_metric: "allow-default",
    },
    failure_hints: ["clarify_missing_time", "generic_unmatched"],
    sample_tags: ["risk_scan", "boss_guidance"],
  },
  store_advice_v1: {
    required_slots: ["store", "time"],
    optional_slots: ["metric", "compare"],
    clarification_policy: {
      missing_store: "clarify",
      missing_time: "clarify",
      missing_metric: "allow-default",
    },
    sample_tags: ["boss_guidance", "action_advice"],
  },
  hq_portfolio_overview_v1: {
    owner_surface: "hq_query",
    required_slots: ["time"],
    optional_slots: ["metric", "compare"],
    clarification_policy: {
      missing_store: "not-applicable",
      missing_time: "clarify",
      missing_metric: "allow-default",
    },
    sample_tags: ["boss_guidance", "hq_overview"],
  },
  hq_portfolio_focus_v1: {
    owner_surface: "hq_query",
    required_slots: ["time"],
    optional_slots: ["metric", "compare"],
    clarification_policy: {
      missing_store: "not-applicable",
      missing_time: "clarify",
      missing_metric: "allow-default",
    },
    sample_tags: ["boss_guidance", "hq_overview", "action_advice"],
  },
  hq_portfolio_risk_v1: {
    owner_surface: "hq_query",
    required_slots: ["time"],
    optional_slots: ["metric", "compare"],
    clarification_policy: {
      missing_store: "not-applicable",
      missing_time: "clarify",
      missing_metric: "allow-default",
    },
    sample_tags: ["boss_guidance", "hq_overview", "risk_scan"],
  },
  hq_monthly_trend_report_v1: {
    owner_surface: "hq_query",
    required_slots: ["time"],
    optional_slots: ["metric", "dimension", "compare"],
    clarification_policy: {
      missing_store: "not-applicable",
      missing_time: "clarify",
      missing_metric: "allow-default",
    },
    sample_tags: ["monthly_trend", "hq_overview", "boss_guidance"],
  },
  customer_profile_lookup_v1: {
    owner_surface: "customer_query",
    required_slots: ["store"],
    optional_slots: [],
    clarification_policy: {
      missing_store: "clarify",
      missing_time: "not-applicable",
      missing_metric: "not-applicable",
    },
    sample_tags: ["customer_profile", "lookup"],
  },
};

function pushUnique<T extends string>(target: T[], value: T): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function resolveCapabilityOwnerSurface(
  entity: QueryPlan["entity"],
): CapabilitySemanticContract["owner_surface"] {
  switch (entity) {
    case "hq":
      return "hq_query";
    case "customer_profile":
      return "customer_query";
    case "tech":
      return "tech_query";
    default:
      return "store_query";
  }
}

function resolveDefaultRequiredSlots(node: AnyCapabilityGraphNodeSeed): CapabilitySemanticSlot[] {
  const requiredSlots: CapabilitySemanticSlot[] = [];
  if (node.entity === "store" || node.entity === "customer_profile" || node.entity === "tech") {
    pushUnique(requiredSlots, "store");
  }
  if (node.supported_time_modes.some((mode) => mode !== "as_of")) {
    pushUnique(requiredSlots, "time");
  }
  if (node.supported_metrics.length > 0) {
    pushUnique(requiredSlots, "metric");
  }
  return requiredSlots;
}

function resolveDefaultOptionalSlots(node: AnyCapabilityGraphNodeSeed): CapabilitySemanticSlot[] {
  const optionalSlots: CapabilitySemanticSlot[] = [];
  if (node.supported_dimensions.length > 0) {
    pushUnique(optionalSlots, "dimension");
  }
  if (
    node.actions.some((action) =>
      ["compare", "trend", "anomaly", "risk", "advice", "ranking"].includes(action),
    )
  ) {
    pushUnique(optionalSlots, "compare");
  }
  return optionalSlots;
}

function resolveDefaultClarificationPolicy(params: {
  requiredSlots: CapabilitySemanticSlot[];
  node: AnyCapabilityGraphNodeSeed;
}): CapabilityClarificationPolicy {
  const { node, requiredSlots } = params;
  return {
    missing_store: requiredSlots.includes("store") ? "clarify" : "not-applicable",
    missing_time: requiredSlots.includes("time") ? "clarify" : "not-applicable",
    missing_metric: requiredSlots.includes("metric")
      ? "clarify"
      : node.supported_metrics.length > 0
        ? "allow-default"
        : "not-applicable",
  };
}

function resolveDefaultFailureHints(params: {
  clarificationPolicy: CapabilityClarificationPolicy;
  node: AnyCapabilityGraphNodeSeed;
}): CapabilityFailureHint[] {
  const { clarificationPolicy, node } = params;
  const failureHints: CapabilityFailureHint[] = [];
  if (clarificationPolicy.missing_store === "clarify") {
    pushUnique(failureHints, "clarify_missing_store");
  }
  if (clarificationPolicy.missing_time === "clarify") {
    pushUnique(failureHints, "clarify_missing_time");
  }
  if (clarificationPolicy.missing_metric === "clarify") {
    pushUnique(failureHints, "clarify_missing_metric");
  }
  pushUnique(
    failureHints,
    node.output_kind === "answer+action" ? "generic_unmatched" : "capability_gap",
  );
  return failureHints;
}

function resolveDefaultSampleTags(node: AnyCapabilityGraphNodeSeed): string[] {
  const sampleTags: string[] = [];
  if (node.entity === "store" && node.supported_time_modes.includes("day")) {
    pushUnique(sampleTags, "store_day");
  }
  if (node.entity === "store" && node.supported_time_modes.includes("window")) {
    pushUnique(sampleTags, "store_window");
  }
  if (node.actions.includes("summary")) {
    pushUnique(sampleTags, "metric_summary");
  }
  if (node.actions.includes("breakdown")) {
    pushUnique(sampleTags, "metric_breakdown");
  }
  if (node.actions.includes("risk")) {
    pushUnique(sampleTags, "risk_scan");
  }
  if (node.actions.includes("ranking") && node.max_org_count > 1) {
    pushUnique(sampleTags, "portfolio_view");
  }
  return sampleTags;
}

function buildCapabilitySemanticContract(
  node: AnyCapabilityGraphNodeSeed,
): CapabilitySemanticContract {
  const requiredSlots = resolveDefaultRequiredSlots(node);
  const optionalSlots = resolveDefaultOptionalSlots(node);
  const clarificationPolicy = resolveDefaultClarificationPolicy({
    requiredSlots,
    node,
  });
  const override = CAPABILITY_GRAPH_CONTRACT_OVERRIDES[node.capability_id];

  return {
    owner_surface: override?.owner_surface ?? resolveCapabilityOwnerSurface(node.entity),
    required_slots: override?.required_slots ?? requiredSlots,
    optional_slots: override?.optional_slots ?? optionalSlots,
    clarification_policy: {
      ...clarificationPolicy,
      ...override?.clarification_policy,
    },
    failure_hints:
      override?.failure_hints ??
      resolveDefaultFailureHints({
        clarificationPolicy: {
          ...clarificationPolicy,
          ...override?.clarification_policy,
        },
        node,
      }),
    sample_tags: override?.sample_tags ?? resolveDefaultSampleTags(node),
  };
}

function attachCapabilitySemanticContract(
  node: AnyCapabilityGraphNodeSeed,
): AnyCapabilityGraphNode {
  return {
    ...node,
    ...buildCapabilitySemanticContract(node),
  };
}

const CAPABILITY_GRAPH_NODES: AnyCapabilityGraphNode[] = CAPABILITY_GRAPH_NODE_SEEDS.map((node) =>
  attachCapabilitySemanticContract(node),
);

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
