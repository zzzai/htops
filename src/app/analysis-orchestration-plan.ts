import type {
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
} from "../types.js";

export type HetangAnalysisOrchestrationPlan = {
  version: "v1";
  focusAreas: string[];
  priorityActions: string[];
  decisionSteps: string[];
  outputContract: string[];
};

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

export function buildHetangAnalysisOrchestrationPlan(params: {
  job: HetangAnalysisJob;
  evidencePack: HetangAnalysisEvidencePack;
  diagnosticBundle?: HetangAnalysisDiagnosticBundle | null;
}): HetangAnalysisOrchestrationPlan {
  const signals = params.diagnosticBundle?.signals ?? [];
  const isPortfolio = params.evidencePack.scopeType === "portfolio";
  const focusAreas = dedupe([
    ...signals.slice(0, 3).map((signal) => signal.title),
    signals.length === 0
      ? `${params.evidencePack.storeName || params.job.storeName || "当前门店"}${params.job.timeFrameLabel}关键指标复核`
      : "",
  ]).slice(0, 3);
  const priorityActions = dedupe([
    ...signals
      .slice(0, 3)
      .map((signal) => signal.recommendedFocus?.trim() || signal.finding.trim()),
    signals.length === 0 ? "先核对证据包中的营收、钟效和会员留存三项关键指标，再决定复盘动作。" : "",
  ]).slice(0, 3);
  const decisionSteps = dedupe(
    isPortfolio
      ? [
          "先确定最危险门店和相对最强门店，形成总部优先级分层，不改写证据包事实。",
          "再解释最危险门店的续费压力、沉默会员、钟效和营收承接问题，说明为什么先抓它。",
          "最后输出总部动作建议，明确下周先抓哪家店、复制哪家店的动作。",
        ]
      : [
          "先确认营收、客数、钟数、钟效等事实，不改写证据包。",
          "再按诊断信号判断问题优先级，优先解释点钟、加钟和会员承接。",
          "最后输出店长动作建议，动作必须带目标对象、动作和目标变化。",
        ],
  ).slice(0, 3);

  return {
    version: "v1",
    focusAreas,
    priorityActions,
    decisionSteps,
    outputContract: isPortfolio
      ? ["结论摘要", "风险与建议", "总部动作建议"]
      : ["结论摘要", "风险与建议", "店长动作建议"],
  };
}
