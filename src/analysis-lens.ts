import type { HetangQueryIntent } from "./query-intent.js";

export type AnalysisPersonaId =
  | "growth_exec_cgo_cmo_v1"
  | "operations_exec_coo_v1"
  | "profit_exec_cfo_v1";
export type AnalysisFrameworkId =
  | "hq_growth_priority_v1"
  | "store_growth_diagnosis_v1"
  | "store_operations_diagnosis_v1"
  | "store_profit_diagnosis_v1";
export type AnalysisAudience = "hq" | "store";
export type AnalysisOutputContractId =
  | "hq_growth_brief_v2"
  | "store_growth_brief_v2"
  | "store_operations_brief_v1"
  | "store_profit_brief_v1";
export type AnalysisPriorityDimension =
  | "retention"
  | "conversion"
  | "unit_economics"
  | "member_asset_health"
  | "execution_efficiency"
  | "service_conversion"
  | "capacity_utilization"
  | "staffing_health"
  | "profitability"
  | "break_even_safety"
  | "cashflow_quality";

export type AnalysisSignalPrompt = {
  dimension: AnalysisPriorityDimension;
  label: string;
};

export type QueryAnalysisLens = {
  mode: "fact_only" | "executive_analysis";
  persona_id: AnalysisPersonaId;
  persona_label: string;
  role_mission: string;
  framework_id: AnalysisFrameworkId;
  output_contract_id: AnalysisOutputContractId;
  audience: AnalysisAudience;
  priority_dimensions: AnalysisPriorityDimension[];
  signal_order: AnalysisSignalPrompt[];
  section_labels: {
    summary: string;
    signals: string;
    actions: string;
    ranking: string;
  };
  reasoning_principles: string[];
  forbidden_claims: string[];
};

type AnalysisLensTemplate = Omit<QueryAnalysisLens, "mode">;

const GROWTH_EXEC_PERSONA_LABEL = "CGO/CMO 增长经营视角";
const GROWTH_EXEC_ROLE_MISSION =
  "用总部增长负责人的口径，先识别留存和会员资产问题，再给出可执行的增长动作。";
const OPERATIONS_EXEC_PERSONA_LABEL = "COO 运营履约视角";
const OPERATIONS_EXEC_ROLE_MISSION =
  "用运营负责人的口径，先识别承接、产能和排班短板，再给出当天可执行的履约动作。";
const PROFIT_EXEC_PERSONA_LABEL = "CFO 利润经营视角";
const PROFIT_EXEC_ROLE_MISSION =
  "用利润负责人的口径，先识别利润空间、保本安全垫和会员资产压力，再给出可执行的收口动作。";

const EXECUTIVE_PRIORITY_DIMENSIONS: AnalysisPriorityDimension[] = [
  "retention",
  "member_asset_health",
  "unit_economics",
  "conversion",
];

const EXECUTIVE_SIGNAL_ORDER: AnalysisSignalPrompt[] = [
  { dimension: "retention", label: "先看留存" },
  { dimension: "member_asset_health", label: "再看会员资产" },
  { dimension: "unit_economics", label: "再看单客价值" },
  { dimension: "conversion", label: "最后看拉新质量" },
];

const OPERATIONS_PRIORITY_DIMENSIONS: AnalysisPriorityDimension[] = [
  "execution_efficiency",
  "service_conversion",
  "capacity_utilization",
  "staffing_health",
];

const OPERATIONS_SIGNAL_ORDER: AnalysisSignalPrompt[] = [
  { dimension: "execution_efficiency", label: "先看承接效率" },
  { dimension: "service_conversion", label: "再看二次成交" },
  { dimension: "capacity_utilization", label: "再看产能利用" },
  { dimension: "staffing_health", label: "最后看排班负荷" },
];

const PROFIT_PRIORITY_DIMENSIONS: AnalysisPriorityDimension[] = [
  "profitability",
  "break_even_safety",
  "cashflow_quality",
  "member_asset_health",
];

const PROFIT_SIGNAL_ORDER: AnalysisSignalPrompt[] = [
  { dimension: "profitability", label: "先看利润空间" },
  { dimension: "break_even_safety", label: "再看保本安全垫" },
  { dimension: "cashflow_quality", label: "再看储值现金流" },
  { dimension: "member_asset_health", label: "最后看会员资产寿命" },
];

const HQ_GROWTH_PRIORITY_LENS: AnalysisLensTemplate = {
  persona_id: "growth_exec_cgo_cmo_v1",
  persona_label: GROWTH_EXEC_PERSONA_LABEL,
  role_mission: GROWTH_EXEC_ROLE_MISSION,
  framework_id: "hq_growth_priority_v1",
  output_contract_id: "hq_growth_brief_v2",
  audience: "hq",
  priority_dimensions: EXECUTIVE_PRIORITY_DIMENSIONS,
  signal_order: EXECUTIVE_SIGNAL_ORDER,
  section_labels: {
    summary: "增长结论",
    signals: "总部先盯的增长信号",
    actions: "总部优先动作",
    ranking: "门店风险排序",
  },
  reasoning_principles: [
    "先保留存，再判断拉新质量",
    "先看会员资产健康，再看单客价值能否支撑增长",
    "动作建议必须落到名单、节奏或责任动作，不能只给抽象管理话术",
  ],
  forbidden_claims: [
    "没有新客或渠道证据时，不下拉新质量结论",
    "没有毛利或成本证据时，不下利润结论",
    "数据不完整时，不把短期波动写成长期趋势",
  ],
};

const STORE_GROWTH_DIAGNOSIS_LENS: AnalysisLensTemplate = {
  persona_id: "growth_exec_cgo_cmo_v1",
  persona_label: GROWTH_EXEC_PERSONA_LABEL,
  role_mission: "用店长可执行的经营视角，指出这家店当下最该先修的增长短板和动作。",
  framework_id: "store_growth_diagnosis_v1",
  output_contract_id: "store_growth_brief_v2",
  audience: "store",
  priority_dimensions: EXECUTIVE_PRIORITY_DIMENSIONS,
  signal_order: EXECUTIVE_SIGNAL_ORDER,
  section_labels: {
    summary: "增长结论",
    signals: "这家店先看什么",
    actions: "店长今天先做什么",
    ranking: "结论",
  },
  reasoning_principles: [
    "先识别当前最伤增长的一条短板，再展开支持证据",
    "单店建议必须能被当天执行，而不是总部级泛建议",
    "没有证据时，只提示需要继续下钻，不伪造原因链路",
  ],
  forbidden_claims: [
    "没有新客或渠道证据时，不下拉新质量结论",
    "没有毛利或成本证据时，不下利润结论",
    "没有技师或排班证据时，不下执行效率结论",
  ],
};

const STORE_OPERATIONS_DIAGNOSIS_LENS: AnalysisLensTemplate = {
  persona_id: "operations_exec_coo_v1",
  persona_label: OPERATIONS_EXEC_PERSONA_LABEL,
  role_mission: OPERATIONS_EXEC_ROLE_MISSION,
  framework_id: "store_operations_diagnosis_v1",
  output_contract_id: "store_operations_brief_v1",
  audience: "store",
  priority_dimensions: OPERATIONS_PRIORITY_DIMENSIONS,
  signal_order: OPERATIONS_SIGNAL_ORDER,
  section_labels: {
    summary: "运营结论",
    signals: "这家店先盯的履约信号",
    actions: "店长今天先调整什么",
    ranking: "结论",
  },
  reasoning_principles: [
    "先看承接和履约，再看结果数据，不把结果问题直接归因成执行问题。",
    "建议必须落到班次、排班或现场动作，不能只给抽象管理话术。",
    "没有等待、产能或班次证据时，只提示需要继续排查，不虚构现场原因。",
  ],
  forbidden_claims: [
    "没有排班、候钟或产能证据时，不下履约结论",
    "没有技师活跃或在岗证据时，不下排班负荷结论",
    "数据不完整时，不把短期拥堵写成长期产能问题",
  ],
};

const STORE_PROFIT_DIAGNOSIS_LENS: AnalysisLensTemplate = {
  persona_id: "profit_exec_cfo_v1",
  persona_label: PROFIT_EXEC_PERSONA_LABEL,
  role_mission: PROFIT_EXEC_ROLE_MISSION,
  framework_id: "store_profit_diagnosis_v1",
  output_contract_id: "store_profit_brief_v1",
  audience: "store",
  priority_dimensions: PROFIT_PRIORITY_DIMENSIONS,
  signal_order: PROFIT_SIGNAL_ORDER,
  section_labels: {
    summary: "利润结论",
    signals: "这家店先盯的利润信号",
    actions: "店长今天先收哪一口利润",
    ranking: "结论",
  },
  reasoning_principles: [
    "先看利润空间，再看保本安全垫，不把流水增长直接等同于利润改善。",
    "先看现金回流和会员资产寿命，再决定储值和续费动作。",
    "没有毛利、净利或成本证据时，不给利润结论。",
  ],
  forbidden_claims: [
    "没有毛利、净利或成本证据时，不下利润结论",
    "没有储值寿命或续费压力证据时，不下会员资产寿命结论",
    "数据不完整时，不把短期活动波动写成长期利润改善",
  ],
};

function buildExecutiveLens(template: AnalysisLensTemplate): QueryAnalysisLens {
  return {
    mode: "executive_analysis",
    ...template,
  };
}

export function isExecutiveAnalysisLens(
  lens: QueryAnalysisLens | undefined | null,
): lens is QueryAnalysisLens {
  return lens?.mode === "executive_analysis";
}

export function resolveAnalysisSignalLabel(
  lens: QueryAnalysisLens,
  dimension: AnalysisPriorityDimension,
  fallback: string,
): string {
  return lens.signal_order.find((entry) => entry.dimension === dimension)?.label ?? fallback;
}

const OPERATIONS_METRIC_KEYS = new Set([
  "pointClockRate",
  "addClockRate",
  "clockEffect",
  "totalClockCount",
  "activeTechCount",
  "onDutyTechCount",
  "roomOccupancyRate",
  "roomTurnoverRate",
]);

const PROFIT_METRIC_KEYS = new Set([
  "grossMarginRate",
  "netMarginRate",
  "breakEvenRevenue",
  "rechargeCash",
  "rechargeStoredValue",
  "storedConsumeAmount",
  "currentStoredBalance",
]);

function countMetricHits(intent: HetangQueryIntent, supportedMetricKeys: Set<string>): number {
  return intent.metrics.reduce(
    (count, metric) => count + (supportedMetricKeys.has(metric.key) ? 1 : 0),
    0,
  );
}

function isOpenExecutiveAnalysisAsk(intent: HetangQueryIntent): boolean {
  return /(重点看什么|该看什么|看什么指标|重点抓什么|该抓什么|先看什么|先抓什么|先盯什么|当前重点看什么|更该先抓什么)/u.test(
    intent.rawText,
  );
}

function resolveStoreAnalysisTrack(
  intent: HetangQueryIntent,
): "growth" | "operations" | "profit" {
  if (intent.kind === "wait_experience") {
    return "operations";
  }

  let operationsScore = countMetricHits(intent, OPERATIONS_METRIC_KEYS);
  let profitScore = countMetricHits(intent, PROFIT_METRIC_KEYS);
  const text = intent.rawText;

  if (
    /(点钟|加钟|翻房|上座|排班|在岗|活跃技师|承接|晚场|午场|等位|候钟|等待|钟效|人效)/u.test(
      text,
    )
  ) {
    operationsScore += 2;
  }
  if (/(毛利|净利|利润|成本|保本|储值寿命|续费压力|低毛利|现金流|耗卡)/u.test(text)) {
    profitScore += 2;
  }

  if (profitScore > operationsScore && profitScore > 0) {
    return "profit";
  }
  if (operationsScore > profitScore && operationsScore > 0) {
    return "operations";
  }
  return "growth";
}

export function resolveQueryAnalysisLens(params: {
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
  accessScopeKind: "manager" | "hq" | "regional";
  entity?: "store" | "hq" | "customer_profile" | "tech";
  action?:
    | "summary"
    | "ranking"
    | "compare"
    | "profile"
    | "list"
    | "breakdown"
    | "report"
    | "trend"
    | "anomaly"
    | "risk"
    | "advice";
}): QueryAnalysisLens | undefined {
  const isHqAudience =
    params.intent.kind === "hq_portfolio" ||
    params.entity === "hq" ||
    params.effectiveOrgIds.length > 1 ||
    params.intent.allStoresRequested;

  if (params.intent.kind === "hq_portfolio") {
    return buildExecutiveLens(HQ_GROWTH_PRIORITY_LENS);
  }
  if (!isOpenExecutiveAnalysisAsk(params.intent)) {
    return undefined;
  }
  if (
    params.action === "advice" ||
    params.action === "risk" ||
    params.action === "anomaly" ||
    params.intent.kind === "advice" ||
    params.intent.kind === "risk" ||
    params.intent.kind === "anomaly"
  ) {
    if (isHqAudience) {
      return buildExecutiveLens(HQ_GROWTH_PRIORITY_LENS);
    }
    const track = resolveStoreAnalysisTrack(params.intent);
    if (track === "operations") {
      return buildExecutiveLens(STORE_OPERATIONS_DIAGNOSIS_LENS);
    }
    if (track === "profit") {
      return buildExecutiveLens(STORE_PROFIT_DIAGNOSIS_LENS);
    }
    return buildExecutiveLens(STORE_GROWTH_DIAGNOSIS_LENS);
  }
  return undefined;
}
