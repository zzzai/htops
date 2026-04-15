import type {
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
} from "../types.js";

export type HetangAnalysisOrchestrationPlan = {
  version: "v1";
  focusAreas: string[];
  priorityActions: string[];
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

  return {
    version: "v1",
    focusAreas,
    priorityActions,
    outputContract: ["结论摘要", "风险与建议", "店长动作建议"],
  };
}
