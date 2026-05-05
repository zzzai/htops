import {
  listCapabilityGraphNodes,
  resolveCapabilityGraphSelection,
  type AnyCapabilityGraphNode,
} from "./capability-graph.js";
import type {
  HetangDataCoverageAssessment,
  HetangDataCoverageAssessor,
  HetangDataCoverageRequest,
} from "./data-coverage.js";
import { listSupportedMetricDefinitions } from "./metric-query.js";
import {
  buildQueryPlanFromIntent,
  type QueryPlan,
} from "./query-plan.js";
import { resolveEffectiveOrgIds, resolveAccessScopeKind } from "./query-engine-router.js";
import { resolveHetangQueryIntent, type HetangQueryIntent } from "./query-intent.js";
import {
  findOperatingDependencyContractById,
  hasOperatingMetricContract,
} from "./semantic-operating-contract.js";
import type { HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

export type HetangSemanticAnswerabilityDecision =
  | "answer"
  | "clarify"
  | "data_gap"
  | "contract_gap"
  | "capability_gap"
  | "unsupported";

export type {
  HetangDataCoverageAssessment,
  HetangDataCoverageAssessor,
  HetangDataCoverageRequest,
} from "./data-coverage.js";

export type HetangSemanticAnswerability = {
  decision: HetangSemanticAnswerabilityDecision;
  reason: string;
  capabilityId?: string;
  missingSlots?: string[];
  missingContracts?: string[];
  missingData?: string[];
  unmetRequirements?: string[];
  plan?: QueryPlan;
  capability?: AnyCapabilityGraphNode;
  coverage?: HetangDataCoverageAssessment;
};

const SYNTHETIC_METRIC_CONTRACTS = new Set(["riskScore", "followupScore"]);
const STRICT_OPERATING_METRIC_CONTRACT_KEYS = new Set([
  "cashPerformance",
  "totalLaborPerformance",
  "receivedLaborPerformance",
  "fullAttendancePeople",
  "attendanceRate",
  "memberDiscountAmount",
  "memberDiscountRate",
]);

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function resolveMissingSlots(reason?: string): string[] {
  const slots: string[] = [];
  if (!reason) {
    return slots;
  }
  if (/store|scope|门店/u.test(reason)) {
    pushUnique(slots, "store");
  }
  if (/time|date|window|时间/u.test(reason)) {
    pushUnique(slots, "time");
  }
  if (/metric|指标/u.test(reason)) {
    pushUnique(slots, "metric");
  }
  return slots;
}

function requiresCostModelContract(text: string): boolean {
  return /(可分配现金利润|劳动业绩利润|门店利润|净利润|运营成本|成本利润)/u.test(text);
}

function resolveMetricContractGaps(intent: HetangQueryIntent, plan: QueryPlan): string[] {
  const gaps: string[] = [];
  const supportedMetricKeys = new Set(
    listSupportedMetricDefinitions().map((definition) => definition.key),
  );

  for (const metric of intent.unsupportedMetrics) {
    pushUnique(gaps, metric.key);
  }
  for (const metric of plan.metrics) {
    if (!supportedMetricKeys.has(metric as never) && !SYNTHETIC_METRIC_CONTRACTS.has(metric)) {
      pushUnique(gaps, metric);
      continue;
    }
    if (
      STRICT_OPERATING_METRIC_CONTRACT_KEYS.has(metric) &&
      !hasOperatingMetricContract(metric)
    ) {
      pushUnique(gaps, metric);
    }
  }
  return gaps;
}

function resolvePlanCoverageRequest(params: {
  plan: QueryPlan;
  capabilityId?: string;
}): HetangDataCoverageRequest | null {
  const { plan } = params;
  if (
    plan.entity === "tech" &&
    plan.time.mode === "as_of" &&
    params.capabilityId === "tech_current_runtime_v1"
  ) {
    if (!plan.time.as_of_biz_date) {
      return null;
    }
    return {
      orgIds: plan.scope.org_ids,
      startBizDate: plan.time.as_of_biz_date,
      endBizDate: plan.time.as_of_biz_date,
      metrics: plan.metrics,
      capabilityId: params.capabilityId,
      requiredFacts: ["current_tech_status"],
    };
  }

  if (plan.time.mode !== "day" && plan.time.mode !== "window" && plan.time.mode !== "timeseries") {
    return null;
  }

  const startBizDate =
    plan.time.mode === "day"
      ? plan.time.biz_date
      : plan.time.start_biz_date ?? plan.time.biz_date;
  const endBizDate =
    plan.time.mode === "day"
      ? plan.time.biz_date
      : plan.time.end_biz_date ?? plan.time.biz_date;
  if (!startBizDate || !endBizDate) {
    return null;
  }

  return {
    orgIds: plan.scope.org_ids,
    startBizDate,
    endBizDate,
    metrics: plan.metrics,
    capabilityId: params.capabilityId,
    requiredFacts: ["daily_store_metrics"],
  };
}

function resolveCapabilityById(capabilityId: string): AnyCapabilityGraphNode | undefined {
  return listCapabilityGraphNodes().find((node) => node.capability_id === capabilityId);
}

export async function resolveSemanticAnswerability(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  text: string;
  now: Date;
  intent?: HetangQueryIntent | null;
  assessDataCoverage?: HetangDataCoverageAssessor;
}): Promise<HetangSemanticAnswerability> {
  const intent =
    params.intent ??
    resolveHetangQueryIntent({
      config: params.config,
      text: params.text,
      now: params.now,
    });
  if (!intent) {
    return {
      decision: "unsupported",
      reason: "no_query_intent",
    };
  }

  if (intent.requiresClarification) {
    return {
      decision: "clarify",
      reason: intent.clarificationReason ?? "intent_requires_clarification",
      missingSlots: resolveMissingSlots(intent.clarificationReason),
    };
  }

  const effectiveOrgIds = resolveEffectiveOrgIds({
    config: params.config,
    binding: params.binding,
    intent,
  });
  if (!effectiveOrgIds.ok) {
    return {
      decision: "clarify",
      reason:
        intent.explicitOrgIds.length > 0 ? "access_scope_not_allowed" : "missing_store",
      missingSlots: intent.explicitOrgIds.length > 0 ? ["access"] : ["store"],
    };
  }

  const plan = buildQueryPlanFromIntent({
    intent,
    effectiveOrgIds: effectiveOrgIds.orgIds,
    accessScopeKind: resolveAccessScopeKind(params.binding),
  });

  if (requiresCostModelContract(intent.rawText)) {
    const costModelContract = findOperatingDependencyContractById("store_cost_model");
    return {
      decision: "contract_gap",
      reason: "missing_cost_model_contract",
      missingContracts: [costModelContract?.id ?? "store_cost_model"],
      plan,
    };
  }

  const missingContracts = resolveMetricContractGaps(intent, plan);
  if (missingContracts.length > 0) {
    return {
      decision: "contract_gap",
      reason:
        intent.unsupportedMetrics.length > 0
          ? "unsupported_metric_contract"
          : "missing_operating_metric_contract",
      missingContracts,
      plan,
    };
  }

  const servingSelection = resolveCapabilityGraphSelection({ plan, executionMode: "serving_sql" });
  const selection = servingSelection.node ? servingSelection : resolveCapabilityGraphSelection({ plan });
  if (!selection.node) {
    return {
      decision: "capability_gap",
      reason: "no_capability_graph_match",
      unmetRequirements: selection.unmet_requirements,
      plan,
    };
  }

  const capability = resolveCapabilityById(selection.node.capability_id) ?? selection.node;
  const coverageRequest = resolvePlanCoverageRequest({
    plan,
    capabilityId: capability.capability_id,
  });
  if (coverageRequest && params.assessDataCoverage) {
    const coverage = await params.assessDataCoverage(coverageRequest);
    if (!coverage.complete) {
      return {
        decision: "data_gap",
        reason: coverage.reason ?? "data_coverage_incomplete",
        capabilityId: capability.capability_id,
        missingData: coverage.missingFacts ?? coverageRequest.requiredFacts,
        plan,
        capability,
        coverage,
      };
    }
  }

  return {
    decision: "answer",
    reason: "answerable",
    capabilityId: capability.capability_id,
    plan,
    capability,
  };
}

export function renderSemanticAnswerabilityText(
  answerability: HetangSemanticAnswerability,
): string | null {
  switch (answerability.decision) {
    case "contract_gap": {
      if (answerability.reason === "missing_cost_model_contract") {
        return "当前还没接入门店运营成本口径，暂时不能严肃计算利润 / 可分配现金利润。现在可以先问现金业绩、劳动业绩、实收劳动业绩。";
      }
      if (answerability.missingContracts?.includes("utilizationRate")) {
        return "上钟率 暂不能严肃回答，因为库里还没接入排班可上钟总数。\n可先查询：点钟率、加钟率、钟效、总钟数、服务营收。";
      }
      const missing = answerability.missingContracts?.join("、") || "该指标";
      return `当前还没有定义「${missing}」的稳定指标口径，暂时不能严肃回答。可以先问已注册的经营指标，比如营收、客流、现金业绩、劳动业绩、点钟率、加钟率。`;
    }
    case "data_gap": {
      const missingData = answerability.missingData?.join("、") || "必要经营数据";
      const missingRanges =
        answerability.coverage?.missingRanges
          ?.map((range) => `${range.orgId} ${range.startBizDate} 至 ${range.endBizDate}`)
          .join("、") ?? "";
      return `当前数据覆盖不完整，暂时不能严肃回答这个时间范围的问题。缺失数据：${missingData}${
        missingRanges ? `；缺口范围：${missingRanges}` : ""
      }。`;
    }
    case "capability_gap":
      return "这个问题已经识别到经营查询意图，但当前能力图谱还没有对应的稳定 capability，先不乱答。";
    case "clarify":
      return "这个问题还缺少必要条件，请补充门店、时间或指标后再查。";
    default:
      return null;
  }
}
