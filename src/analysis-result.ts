import type {
  HetangAnalysisOrchestrationMetadata,
  HetangAnalysisOrchestrationStageStatus,
  HetangAnalysisOrchestrationStageTrace,
  HetangBoundedAnalysisStage,
} from "./types.js";

type JsonObject = Record<string, unknown>;

const BOUNDED_ANALYSIS_STAGES: readonly HetangBoundedAnalysisStage[] = [
  "evidence_pack",
  "diagnostic_signals",
  "bounded_synthesis",
  "action_items",
];

const BOUNDED_ANALYSIS_STAGE_STATUSES: readonly HetangAnalysisOrchestrationStageStatus[] = [
  "completed",
  "fallback",
];

export type ParsedHetangAnalysisResult = {
  rawText: string;
  summary?: string;
  markdown?: string;
  suggestions: string[];
  risks: string[];
  actionItems?: {
    title: string;
    category?: string;
    priority?: string;
  }[];
  orchestration?: HetangAnalysisOrchestrationMetadata;
  reviewMode?: string;
  isStructured: boolean;
};

function isBoundedAnalysisStage(value: unknown): value is HetangBoundedAnalysisStage {
  return (
    typeof value === "string" &&
    (BOUNDED_ANALYSIS_STAGES as readonly string[]).includes(value)
  );
}

function isBoundedAnalysisStageStatus(value: unknown): value is HetangAnalysisOrchestrationStageStatus {
  return (
    typeof value === "string" &&
    (BOUNDED_ANALYSIS_STAGE_STATUSES as readonly string[]).includes(value)
  );
}

function normalizeLine(value: string): string {
  return value.trim();
}

function stripListMarker(value: string): string {
  return value
    .replace(/^\d+[.)、]\s*/u, "")
    .replace(/^[-*]\s*/u, "")
    .trim();
}

function normalizeSuggestions(values: unknown): string[] {
  if (typeof values === "string") {
    return normalizeSuggestions(values.split(/\r?\n/u).map(stripListMarker).filter(Boolean));
  }
  if (!Array.isArray(values)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = stripListMarker(String(value ?? ""));
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

function normalizeStringArray(values: unknown): string[] {
  if (typeof values === "string") {
    return normalizeStringArray(
      values
        .split(/[\r\n]+|[；;]/u)
        .map(normalizeLine)
        .filter(Boolean),
    );
  }
  if (!Array.isArray(values)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = normalizeLine(String(value ?? ""));
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped);
}

function normalizeActionItems(values: unknown): {
  title: string;
  category?: string;
  priority?: string;
}[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const normalized: {
    title: string;
    category?: string;
    priority?: string;
  }[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value === "string") {
      const title = stripListMarker(value);
      if (!title || seen.has(title)) {
        continue;
      }
      seen.add(title);
      normalized.push({ title });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const title = stripListMarker(String((value as { title?: unknown }).title ?? ""));
    if (!title || seen.has(title)) {
      continue;
    }
    seen.add(title);
    const category =
      typeof (value as { category?: unknown }).category === "string" &&
      (value as { category: string }).category.trim().length > 0
        ? (value as { category: string }).category.trim()
        : undefined;
    const priority =
      typeof (value as { priority?: unknown }).priority === "string" &&
      (value as { priority: string }).priority.trim().length > 0
        ? (value as { priority: string }).priority.trim()
        : undefined;
    normalized.push({
      title,
      ...(category ? { category } : {}),
      ...(priority ? { priority } : {}),
    });
  }
  return normalized;
}

function normalizeTextBlock(value: unknown, separator = " "): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  const deduped = new Set<string>();
  for (const item of value) {
    const normalized = normalizeLine(String(item ?? ""));
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return deduped.size > 0 ? Array.from(deduped).join(separator) : undefined;
}

function normalizeOrchestrationMetadata(
  value: unknown,
): HetangAnalysisOrchestrationMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const metadata = value as {
    version?: unknown;
    completedStages?: unknown;
    fallbackStage?: unknown;
    signalCount?: unknown;
    stageTrace?: unknown;
  };
  const completedStages = Array.isArray(metadata.completedStages)
    ? Array.from(
        new Set(
          metadata.completedStages.filter((stage): stage is HetangBoundedAnalysisStage =>
            isBoundedAnalysisStage(stage),
          ),
        ),
      )
    : [];
  const fallbackStage = isBoundedAnalysisStage(metadata.fallbackStage)
    ? metadata.fallbackStage
    : undefined;
  const signalCount =
    typeof metadata.signalCount === "number" && Number.isFinite(metadata.signalCount)
      ? metadata.signalCount
      : undefined;
  const stageTrace = Array.isArray(metadata.stageTrace)
    ? metadata.stageTrace
        .map((entry): HetangAnalysisOrchestrationStageTrace | null => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }
          const trace = entry as {
            stage?: unknown;
            status?: unknown;
            detail?: unknown;
          };
          if (
            !isBoundedAnalysisStage(trace.stage) ||
            !isBoundedAnalysisStageStatus(trace.status)
          ) {
            return null;
          }
          const detail = normalizeTextBlock(trace.detail);
          if (!detail) {
            return null;
          }
          return {
            stage: trace.stage,
            status: trace.status,
            detail,
          };
        })
        .filter((entry): entry is HetangAnalysisOrchestrationStageTrace => entry !== null)
    : [];

  if (
    metadata.version !== "v1" &&
    completedStages.length === 0 &&
    !fallbackStage &&
    signalCount == null &&
    stageTrace.length === 0
  ) {
    return undefined;
  }

  return {
    version: "v1",
    completedStages,
    ...(fallbackStage ? { fallbackStage } : {}),
    ...(signalCount != null ? { signalCount } : {}),
    ...(stageTrace.length > 0 ? { stageTrace } : {}),
  };
}

function buildMarkdownFromSections(params: {
  summary?: string;
  risks: string[];
  suggestions: string[];
}): string | undefined {
  const lines: string[] = [];
  if (params.summary) {
    lines.push(`结论摘要：${params.summary}`);
  }
  if (params.risks.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("风险预警：");
    for (const risk of params.risks) {
      lines.push(`- ${risk}`);
    }
  }
  if (params.suggestions.length > 0) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("店长动作建议：");
    for (const [index, suggestion] of params.suggestions.entries()) {
      lines.push(`${index + 1}. ${suggestion}`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : undefined;
}

function tryParseAnalysisJson(text: string): JsonObject | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const attempts = [trimmed];
  if (trimmed.startsWith("```")) {
    const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/u);
    if (codeFenceMatch?.[1]) {
      attempts.push(codeFenceMatch[1].trim());
    }
  }

  const firstBraceIndex = trimmed.indexOf("{");
  const lastBraceIndex = trimmed.lastIndexOf("}");
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    attempts.push(trimmed.slice(firstBraceIndex, lastBraceIndex + 1));
  }

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function isOperatingSummaryLine(line: string): boolean {
  return /^(?:[-*]\s*)?(?:门店经营判断|当前经营优先级|经营分层|经营标签|经营等级|当前带教优先级|经营状态)[:：]/u.test(
    line,
  );
}

function collectOperatingSummaryTail(lines: string[], startIndex: number): string[] {
  const tail: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (!isOperatingSummaryLine(line)) {
      break;
    }
    tail.push(stripListMarker(line));
  }
  return tail;
}

function extractSectionLeadLine(lines: string[], headingPattern: RegExp): string | undefined {
  const headingIndex = lines.findIndex((line) => headingPattern.test(line));
  if (headingIndex < 0) {
    return undefined;
  }
  return lines
    .slice(headingIndex + 1)
    .map(normalizeLine)
    .find((line) => line.length > 0 && !/^#+\s/u.test(line) && !/^[^\s].*经营全景$/u.test(line));
}

function buildPortfolioBossSummary(lines: string[]): string | undefined {
  const titleLine = lines.find((line) => /总部经营全景/u.test(line));
  if (!titleLine) {
    return undefined;
  }

  const overview = extractSectionLeadLine(lines, /^整体概览$/u);
  const danger = extractSectionLeadLine(lines, /^最危险门店$/u);
  const priority = extractSectionLeadLine(lines, /^下周总部优先动作$/u);
  if (!overview && !danger && !priority) {
    return undefined;
  }

  const label = titleLine.split(/\s+/u)[0]?.trim();
  const parts: string[] = [];
  if (overview) {
    parts.push(`${label ? `${label}整体看，` : ""}${stripListMarker(overview)}`);
  }
  if (danger) {
    parts.push(`当前最危险的是${stripListMarker(danger)}`);
  }
  if (priority) {
    parts.push(`下周总部先抓：${stripListMarker(priority)}`);
  }
  return parts.join("");
}

function extractPlainTextSummary(lines: string[]): string | undefined {
  const portfolioSummary = buildPortfolioBossSummary(lines);
  if (portfolioSummary) {
    return portfolioSummary;
  }

  for (const [index, line] of lines.entries()) {
    const sameLine = line.match(/^(?:#+\s*)?(?:结论摘要|核心结论|摘要)[:：]\s*(.+)$/u)?.[1];
    if (sameLine?.trim()) {
      return [sameLine.trim(), ...collectOperatingSummaryTail(lines, index)].join(" ").trim();
    }
  }

  const headingIndex = lines.findIndex((line) =>
    /^(?:#+\s*)?(?:结论摘要|核心结论|摘要)[:：]?$/u.test(line),
  );
  if (headingIndex >= 0) {
    const nextLineIndex = lines.findIndex(
      (line, index) => index > headingIndex && line.length > 0 && !/^#+\s/u.test(line),
    );
    const nextLine = nextLineIndex >= 0 ? stripListMarker(lines[nextLineIndex] ?? "") : undefined;
    if (nextLine) {
      return [nextLine, ...collectOperatingSummaryTail(lines, nextLineIndex)].join(" ").trim();
    }
  }

  const fallback = lines.find(
    (line) =>
      line.length > 0 &&
      !/^(?:店长动作建议|风险预警|交接摘要)[:：]?$/u.test(line) &&
      !/^(?:\d+[.)、]|[-*])\s*/u.test(line),
  );
  return fallback ? stripListMarker(fallback) : undefined;
}

function extractPlainTextSuggestions(lines: string[]): string[] {
  const suggestionHeadingIndex = lines.findLastIndex((line) =>
    /店长动作建议|建议|交接摘要/u.test(line),
  );
  if (suggestionHeadingIndex < 0) {
    const fallbackSuggestions = lines
      .filter((line) => /^(?:[-*]\s*)?(?:当前经营优先级|当前带教优先级)[:：]/u.test(line))
      .map((line) => stripListMarker(line).replace(/^(?:当前经营优先级|当前带教优先级)[:：]\s*/u, ""))
      .filter(Boolean);
    return normalizeSuggestions(fallbackSuggestions);
  }

  const suggestions: string[] = [];
  for (const line of lines.slice(suggestionHeadingIndex + 1)) {
    if (/^(?:#+\s*)?(?:风险预警|结论摘要|核心结论|摘要)[:：]?$/u.test(line)) {
      break;
    }
    if (!line) {
      continue;
    }
    if (/^(?:\d+[.)、]|[-*])\s*/u.test(line)) {
      suggestions.push(stripListMarker(line));
      continue;
    }
    if (suggestions.length === 0) {
      suggestions.push(stripListMarker(line));
    } else {
      break;
    }
  }
  return normalizeSuggestions(suggestions);
}

export function parseHetangAnalysisResult(
  resultText: string | undefined,
): ParsedHetangAnalysisResult {
  const rawText = resultText?.trim() ?? "";
  if (!rawText) {
    return {
      rawText: "",
      suggestions: [],
      risks: [],
      isStructured: false,
    };
  }

  const parsedJson = tryParseAnalysisJson(rawText);
  if (parsedJson) {
    const summary = normalizeTextBlock(parsedJson.summary);
    const suggestions = normalizeSuggestions(parsedJson.suggestions);
    const risks = normalizeStringArray(parsedJson.risks);
    const actionItems = normalizeActionItems(parsedJson.actionItems ?? parsedJson.action_items);
    const orchestration = normalizeOrchestrationMetadata(parsedJson.orchestration);
    const markdown =
      normalizeTextBlock(parsedJson.markdown, "\n") ??
      buildMarkdownFromSections({ summary, risks, suggestions });
    const reviewMode =
      typeof parsedJson.reviewMode === "string" && parsedJson.reviewMode.trim().length > 0
        ? parsedJson.reviewMode.trim()
        : typeof parsedJson.review_mode === "string" && parsedJson.review_mode.trim().length > 0
          ? parsedJson.review_mode.trim()
          : undefined;
    return {
      rawText,
      summary,
      markdown,
      suggestions,
      risks,
      ...(actionItems.length > 0 ? { actionItems } : {}),
      ...(orchestration ? { orchestration } : {}),
      reviewMode,
      isStructured: true,
    };
  }

  const lines = rawText.split(/\r?\n/u).map(normalizeLine).filter(Boolean);
  return {
    rawText,
    summary: extractPlainTextSummary(lines),
    markdown: rawText,
    suggestions: extractPlainTextSuggestions(lines),
    risks: [],
    isStructured: false,
  };
}

export function renderHetangAnalysisResult(resultText: string | undefined): string | undefined {
  const parsed = parseHetangAnalysisResult(resultText);
  return parsed.markdown ?? parsed.summary ?? (parsed.rawText || undefined);
}

export function summarizeHetangAnalysisResult(resultText: string | undefined): string | undefined {
  const parsed = parseHetangAnalysisResult(resultText);
  return parsed.summary ?? parsed.markdown ?? (parsed.rawText || undefined);
}

export function extractHetangAnalysisSuggestions(resultText: string | undefined): string[] {
  return parseHetangAnalysisResult(resultText).suggestions;
}

export function extractHetangAnalysisActionItems(
  resultText: string | undefined,
): {
  title: string;
  category?: string;
  priority?: string;
}[] {
  return parseHetangAnalysisResult(resultText).actionItems ?? [];
}

export function extractHetangAnalysisOrchestrationMetadata(
  resultText: string | undefined,
): HetangAnalysisOrchestrationMetadata | undefined {
  return parseHetangAnalysisResult(resultText).orchestration;
}

function summarizeStageTraceEntry(entry: HetangAnalysisOrchestrationStageTrace): string {
  if (entry.status !== "fallback") {
    return entry.stage;
  }
  const reasonMatch = entry.detail.match(/\breason=([^;\s]+)/u);
  const reason = reasonMatch?.[1]?.trim();
  return reason ? `${entry.stage}(fallback: ${reason})` : `${entry.stage}(fallback)`;
}

export function summarizeHetangAnalysisOrchestration(
  resultText: string | undefined,
): string | undefined {
  const orchestration = extractHetangAnalysisOrchestrationMetadata(resultText);
  if (!orchestration) {
    return undefined;
  }
  if (orchestration.stageTrace && orchestration.stageTrace.length > 0) {
    return orchestration.stageTrace.map(summarizeStageTraceEntry).join(" -> ");
  }
  const stages = [...orchestration.completedStages];
  if (orchestration.fallbackStage && !stages.includes(orchestration.fallbackStage)) {
    stages.push(orchestration.fallbackStage);
  }
  return stages.length > 0 ? stages.join(" -> ") : undefined;
}
