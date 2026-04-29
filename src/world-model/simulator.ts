import { resolveOperatingWorldMechanisms } from "./mechanisms.js";
import type { OperatingWorldMechanismKey } from "./mechanisms.js";
import type { OperatingWorldStateSnapshot } from "./types.js";

export type OperatingWorldSimulationKind =
  | "explain_current_state"
  | "counterfactual"
  | "action_preview";

export type OperatingWorldSimulationConfidenceBand = "low" | "medium" | "high";

export type OperatingWorldSimulationResult = {
  kind: OperatingWorldSimulationKind;
  actionLabel?: string;
  summary: string;
  likelyUpside: string[];
  likelyRisk: string[];
  requiredConditions: string[];
  confidenceBand: OperatingWorldSimulationConfidenceBand;
  matchedMechanismKeys: OperatingWorldMechanismKey[];
};

function resolveConfidenceBand(
  snapshot: OperatingWorldStateSnapshot,
): OperatingWorldSimulationConfidenceBand {
  if (snapshot.industryState.observations.length > 0) {
    return "high";
  }
  if (
    snapshot.customerState.evidence.length > 0 ||
    snapshot.customerState.latestSegment ||
    snapshot.customerState.recentOutcome ||
    snapshot.storeState.evidence.length > 0 ||
    snapshot.storeState.environmentContext ||
    Object.keys(snapshot.storeState.confirmedContext).length > 0 ||
    snapshot.marketState.evidence.length > 0 ||
    Object.keys(snapshot.marketState.estimatedContext).length > 0 ||
    snapshot.marketState.researchNotes.length > 0
  ) {
    return "medium";
  }
  return "low";
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function resolveCurrentStateSummary(
  matchedMechanismKeys: OperatingWorldMechanismKey[],
): string {
  if (
    matchedMechanismKeys.includes("late-night-opportunity") &&
    matchedMechanismKeys.includes("capacity-bottleneck")
  ) {
    return "当前更像是晚场机会存在，但同时被承接瓶颈限制，先把晚饭后与夜场承接接稳更关键。";
  }
  if (matchedMechanismKeys.includes("traffic-recharge-split")) {
    return "当前更像是客流未必先掉，但储值和会员沉淀链路已经先走弱，需要把动作从单纯拉客切到沉淀与复购。";
  }
  if (matchedMechanismKeys.includes("competitor-pressure")) {
    return "当前更像是外部分流压力在抬升，门店要用差异化承接而不是单纯价格去守盘。";
  }
  if (matchedMechanismKeys.includes("late-night-opportunity")) {
    return "当前更像是晚饭后与夜场机会已经出现，先把高峰承接接稳比盲目放量更重要。";
  }
  if (matchedMechanismKeys.includes("high-value-reactivation-window")) {
    return "当前更像是高价值沉默客存在可跟进窗口，先做一对一跟进比泛触达更有效。";
  }
  return "当前世界状态信号还不够完整，先把门店事实、外部样本和反馈回写补齐，再做更强判断。";
}

export function simulateOperatingWorldScenario(params: {
  snapshot: OperatingWorldStateSnapshot;
  kind: OperatingWorldSimulationKind;
  actionLabel?: string;
}): OperatingWorldSimulationResult {
  const mechanisms = resolveOperatingWorldMechanisms(params.snapshot);
  const matchedMechanismKeys = mechanisms.map((entry) => entry.key);
  const confidenceBand = resolveConfidenceBand(params.snapshot);

  if (params.kind === "counterfactual" && params.actionLabel === "increase-night-shift-capacity") {
    return {
      kind: params.kind,
      actionLabel: params.actionLabel,
      summary: "如果补上晚场承接，当前晚场机会更可能转成预约和稳定到店，而不是先卡在供给瓶颈。",
      likelyUpside: [
        "高价值老客的预约承接空间会更大。",
        "晚饭后和夜场的机会更容易转化成实际业绩。",
      ],
      likelyRisk: [
        "如果竞对同时加大价格动作，单纯补容量不一定转成稳定储值。",
        "如果门店继续只拉客不做会员沉淀，长期价值改善会有限。",
      ],
      requiredConditions: [
        "必须先补晚场技师排班或房态容量，否则动作会卡在承接侧。",
        "需要同时盯储值转化和熟客沉淀，不能只看客流。",
      ],
      confidenceBand,
      matchedMechanismKeys,
    };
  }

  if (params.kind === "action_preview" && params.actionLabel === "scale-night-shift-reactivation") {
    return {
      kind: params.kind,
      actionLabel: params.actionLabel,
      summary: "当前适合放大晚场召回，但前提是把熟悉技师、可承接时段和会员沉淀动作同时锁住。",
      likelyUpside: [
        "高价值沉默客更容易形成预约反馈。",
        "晚场和饭后需求强时，熟客回流更容易被接住。",
      ],
      likelyRisk: [
        "如果不先确认承接，动作会先放大排队和体验风险。",
        "如果只做短促召回，不补储值与复购承接，价值回补会偏短。",
      ],
      requiredConditions: [
        "先锁定熟悉技师和可承接时段，再扩大触达。",
        "同步安排储值或会员沉淀话术，不要只做即时拉回。",
      ],
      confidenceBand,
      matchedMechanismKeys,
    };
  }

  if (params.kind === "action_preview" && params.actionLabel === "prioritize-evening-intake") {
    return {
      kind: params.kind,
      actionLabel: params.actionLabel,
      summary: "当前更适合优先补晚饭后与夜场承接，把已有需求先接稳，再决定是否继续放量。",
      likelyUpside: [
        "晚饭后和夜场的自然需求更容易被稳定接住。",
        "先接稳高峰承接后，再做后续会员沉淀会更顺。",
      ],
      likelyRisk: [
        "如果晚场供给没补齐，放量会先变成排队和体验损耗。",
        "如果只看即时客流，不补复购和储值承接，长期价值仍会偏弱。",
      ],
      requiredConditions: [
        "先确认晚场重点时段、值班技师和房态承接，再扩大动作。",
        "高峰承接稳定后，再把会员沉淀和复购动作接上。",
      ],
      confidenceBand,
      matchedMechanismKeys,
    };
  }

  const likelyUpside = dedupe(
    mechanisms.flatMap((entry) => {
      switch (entry.key) {
        case "late-night-opportunity":
          return ["晚场承接和饭后回流有放大空间。"];
        case "high-value-reactivation-window":
          return ["高价值客户的一对一跟进更可能形成预约或复到店。"];
        default:
          return [];
      }
    }),
  );
  const likelyRisk = dedupe(
    mechanisms.flatMap((entry) => {
      switch (entry.key) {
        case "capacity-bottleneck":
          return ["承接不足会把机会先变成排队、等房和体验损耗。"];
        case "competitor-pressure":
          return ["外部竞对会优先分流价格敏感和即时决策客群。"];
        case "traffic-recharge-split":
          return ["客流表面稳定时，会员沉淀和储值链路可能已经先走弱。"];
        default:
          return [];
      }
    }),
  );
  const requiredConditions = dedupe(
    mechanisms.flatMap((entry) => entry.suggestedActions),
  );

  return {
    kind: params.kind,
    actionLabel: params.actionLabel,
    summary: resolveCurrentStateSummary(matchedMechanismKeys),
    likelyUpside,
    likelyRisk,
    requiredConditions,
    confidenceBand,
    matchedMechanismKeys,
  };
}
