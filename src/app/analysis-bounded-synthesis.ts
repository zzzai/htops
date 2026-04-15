import type {
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisDiagnosticSignal,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
} from "../types.js";

type BoundedAnalysisActionItem = {
  title: string;
  category?: string;
  priority?: string;
};

type DeterministicBoundedAnalysisResult = {
  summary: string;
  markdown: string;
  risks: string[];
  suggestions: string[];
  actionItems?: BoundedAnalysisActionItem[];
};

function severityLabel(severity: HetangAnalysisDiagnosticSignal["severity"]): string {
  switch (severity) {
    case "high":
      return "高";
    case "low":
      return "低";
    default:
      return "中";
  }
}

function actionPriority(severity: HetangAnalysisDiagnosticSignal["severity"]): string {
  switch (severity) {
    case "high":
      return "high";
    case "low":
      return "low";
    default:
      return "medium";
  }
}

function actionCategory(signalId: string): string {
  if (signalId.includes("member")) {
    return "会员运营";
  }
  return "技师运营";
}

function actionTitle(signal: HetangAnalysisDiagnosticSignal): string {
  switch (signal.signalId) {
    case "point_clock_risk":
      return "今天复盘点钟集中与分单策略，高意向客优先交给强承接技师，目标把点钟结构拉回健康区间。";
    case "add_clock_weakness":
      return "今天统一加钟话术和离店前延钟收口，班次负责人盯加钟承接，目标把加钟率拉回健康区间。";
    case "member_silence_risk":
      return "今天拉出沉默会员名单并完成分层回访，先抢高价值沉默客回流，目标把沉默率压下来。";
    default:
      return signal.recommendedFocus?.trim() || signal.finding.trim();
  }
}

function renderSignalLines(signal: HetangAnalysisDiagnosticSignal): string[] {
  const evidenceText =
    signal.evidence.length > 0 ? `；证据：${signal.evidence.join("；")}` : "";
  return [`- [${severityLabel(signal.severity)}] ${signal.title}: ${signal.finding}${evidenceText}`];
}

function buildGenericSuggestions(params: {
  evidencePack: HetangAnalysisEvidencePack;
  job: HetangAnalysisJob;
}): string[] {
  if (params.evidencePack.scopeType === "portfolio") {
    return [
      "先把样本门店按营收、钟效和沉默率重新排序，优先盯波动最大的门店。",
      "先核对证据包里的最新日报样本，再决定跨店动作优先级。",
    ];
  }
  return [
    "先核对最新日报、7日复盘和30日摘要的口径一致性，再决定今天的经营动作。",
    `先围绕 ${params.job.timeFrameLabel} 的营收、钟效和会员留存三项指标复盘，再补下一层诊断。`,
  ];
}

export function buildDeterministicBoundedAnalysisResult(params: {
  job: HetangAnalysisJob;
  evidencePack: HetangAnalysisEvidencePack;
  diagnosticBundle?: HetangAnalysisDiagnosticBundle | null;
}): DeterministicBoundedAnalysisResult {
  const signals = params.diagnosticBundle?.signals ?? [];
  const storeLabel =
    params.evidencePack.storeName || params.job.storeName || params.job.orgId || "当前门店";
  const summary =
    signals.length > 0
      ? `${storeLabel}${params.job.timeFrameLabel}当前更值得优先盯 ${signals
          .slice(0, 2)
          .map((signal) => signal.title)
          .join("、")}。`
      : params.evidencePack.scopeType === "portfolio"
        ? `${storeLabel}${params.job.timeFrameLabel}已基于证据包完成本地复盘，建议先从波动最大的门店开始排查。`
        : `${storeLabel}${params.job.timeFrameLabel}已基于证据包完成本地复盘，当前没有触发明确诊断信号，建议先核对关键指标再细化动作。`;

  const risks = signals.map((signal) => `${signal.title}：${signal.finding}`);
  const actionItems = signals.slice(0, 3).map((signal) => ({
    title: actionTitle(signal),
    category: actionCategory(signal.signalId),
    priority: actionPriority(signal.severity),
  }));
  const suggestions =
    actionItems.length > 0
      ? actionItems.map((item) => item.title)
      : buildGenericSuggestions({
          evidencePack: params.evidencePack,
          job: params.job,
        });

  const lines = [`结论摘要：${summary}`, "", params.evidencePack.markdown];
  if (signals.length > 0) {
    lines.push("", "诊断信号", ...signals.flatMap((signal) => renderSignalLines(signal)));
  }
  if (suggestions.length > 0) {
    lines.push("", "建议动作", ...suggestions.map((item, index) => `${index + 1}. ${item}`));
  }

  return {
    summary,
    markdown: lines.join("\n"),
    risks,
    suggestions,
    ...(actionItems.length > 0 ? { actionItems } : {}),
  };
}
