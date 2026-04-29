import { resolveStoreOrgId } from "./config.js";
import { resolveMetricIntent } from "./metric-query.js";
import { resolveAiLaneConfig } from "./ai-lanes/resolver.js";
import type {
  HetangQueryIntent,
  HetangQueryIntentKind,
  HetangQueryTimeFrame,
} from "./query-intent.js";
import type { HetangSemanticAction, HetangSemanticObject } from "./query-semantics.js";
import {
  resolveLocalDate,
  resolveOperationalBizDate,
  resolveReportBizDate,
  shiftBizDate,
} from "./time.js";
import type { HetangLogger, HetangOpsConfig } from "./types.js";

const SUPPORTED_INTENT_KINDS = new Set<HetangQueryIntentKind>([
  "metric",
  "report",
  "compare",
  "ranking",
  "trend",
  "anomaly",
  "risk",
  "advice",
  "hq_portfolio",
  "customer_segment",
  "customer_relation",
  "customer_profile",
  "tech_profile",
  "birthday_members",
  "wait_experience",
  "member_marketing",
  "recharge_attribution",
]);

const METRIC_DEPENDENT_FALLBACK_INTENT_KINDS = new Set<HetangQueryIntentKind>([
  "metric",
  "compare",
  "ranking",
  "trend",
  "anomaly",
]);

type HetangAiSemanticTimeMode =
  | "report_default"
  | "today"
  | "yesterday"
  | "day_before_yesterday"
  | "tomorrow"
  | "this_week"
  | "current_month"
  | "recent_7d"
  | "recent_30d"
  | "recent_90d"
  | "next_7d"
  | "explicit_date"
  | "explicit_range";

const SUPPORTED_TIME_MODES = new Set<HetangAiSemanticTimeMode>([
  "report_default",
  "today",
  "yesterday",
  "day_before_yesterday",
  "tomorrow",
  "this_week",
  "current_month",
  "recent_7d",
  "recent_30d",
  "recent_90d",
  "next_7d",
  "explicit_date",
  "explicit_range",
]);

const AMBIGUOUS_METRIC_PHRASE_PATTERNS = [
  /盘里收/iu,
  /盘收/iu,
  /收了多少/iu,
  /搞了多少/iu,
  /做了多少/iu,
];

const EXPLICIT_METRIC_TOKENS_PATTERN =
  /营收|业绩|流水|收入|储值|充值|现金|实收|耗卡|客单价|钟数|钟效|点钟|加钟|复购|到店|会员/iu;

type HetangAiSemanticFallbackPayload = {
  intent_kind?: string;
  confidence?: number;
  needs_clarification?: boolean;
  clarification_reason?: string;
  store_names?: unknown;
  all_stores_requested?: boolean;
  time_mode?: string;
  time_start?: string;
  time_end?: string;
  object?: string;
  secondary_object?: string;
  action?: string;
  secondary_action?: string;
  metric_hints?: unknown;
  phone_suffix?: string;
  ranking_target?: string;
  ranking_order?: string;
};

export type HetangSemanticFallbackResolution = {
  intent?: HetangQueryIntent;
  clarificationText?: string;
  clarificationReason?: string;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function extractMessageText(payload: Record<string, unknown>): string | null {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice =
    choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
      ? (choices[0] as Record<string, unknown>)
      : null;
  const message =
    firstChoice && typeof firstChoice.message === "object" && firstChoice.message !== null
      ? (firstChoice.message as Record<string, unknown>)
      : null;
  const content = message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const textValue = (entry as { text?: unknown }).text;
        return typeof textValue === "string" ? textValue : "";
      })
      .join("")
      .trim();
    return text || null;
  }
  const outputText = payload.output_text;
  return typeof outputText === "string" && outputText.trim().length > 0 ? outputText.trim() : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const direct = tryParseObject(trimmed);
  if (direct) {
    return direct;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return tryParseObject(trimmed.slice(start, end + 1));
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeIntentKind(value: unknown): HetangQueryIntentKind | null {
  if (typeof value !== "string") {
    return null;
  }
  return SUPPORTED_INTENT_KINDS.has(value as HetangQueryIntentKind)
    ? (value as HetangQueryIntentKind)
    : null;
}

function normalizeTimeMode(value: unknown): HetangAiSemanticTimeMode {
  if (typeof value !== "string") {
    return "report_default";
  }
  return SUPPORTED_TIME_MODES.has(value as HetangAiSemanticTimeMode)
    ? (value as HetangAiSemanticTimeMode)
    : "report_default";
}

function resolveConfidence(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function requiresMetricClarification(text: string): boolean {
  const normalized = text.replace(/\s+/gu, "");
  return (
    AMBIGUOUS_METRIC_PHRASE_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    !EXPLICIT_METRIC_TOKENS_PATTERN.test(normalized)
  );
}

function normalizePhoneSuffix(value: unknown, fallbackText: string): string | undefined {
  const direct =
    typeof value === "string" && /^\d{4}$/u.test(value.trim()) ? value.trim() : undefined;
  if (direct) {
    return direct;
  }
  const leading = fallbackText.match(/(?:尾号|后四位|手机后四位|手机号后四位)\D*(\d{4})/u)?.[1];
  if (leading) {
    return leading;
  }
  return fallbackText.match(/(\d{4})\D*(?:尾号|后四位)/u)?.[1];
}

function daysBetweenInclusive(startBizDate: string, endBizDate: string): number {
  return (
    Math.round(
      (new Date(`${endBizDate}T00:00:00Z`).getTime() -
        new Date(`${startBizDate}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1
  );
}

function resolveMondayOfWeek(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function resolvePreviousComparableTimeFrame(frame: HetangQueryTimeFrame): HetangQueryTimeFrame {
  if (frame.kind === "single") {
    const previous = shiftBizDate(frame.bizDate, -1);
    return {
      kind: "single",
      bizDate: previous,
      label: previous,
      days: 1,
    };
  }

  return {
    kind: "range",
    startBizDate: shiftBizDate(frame.startBizDate, -frame.days),
    endBizDate: shiftBizDate(frame.endBizDate, -frame.days),
    label: `前${frame.days}天`,
    days: frame.days,
  };
}

function resolveCurrentMonthFrame(reportBizDate: string): HetangQueryTimeFrame {
  const startBizDate = `${reportBizDate.slice(0, 8)}01`;
  return {
    kind: "range",
    startBizDate,
    endBizDate: reportBizDate,
    label: "本月",
    days: daysBetweenInclusive(startBizDate, reportBizDate),
  };
}

function resolveRecentRange(
  reportBizDate: string,
  days: number,
  label: string,
): HetangQueryTimeFrame {
  return {
    kind: "range",
    startBizDate: shiftBizDate(reportBizDate, -(days - 1)),
    endBizDate: reportBizDate,
    label,
    days,
  };
}

function resolveFallbackTimeFrames(params: {
  config: HetangOpsConfig;
  kind: HetangQueryIntentKind;
  mode: HetangAiSemanticTimeMode;
  start?: string;
  end?: string;
  now: Date;
}): {
  timeFrame: HetangQueryTimeFrame;
  comparisonTimeFrame?: HetangQueryTimeFrame;
} {
  const localToday = resolveLocalDate(params.now, params.config.timeZone);
  const reportBizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const operationalBizDate = resolveOperationalBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const naturalDateMode = params.kind === "birthday_members";

  let timeFrame: HetangQueryTimeFrame;
  switch (params.mode) {
    case "today":
      timeFrame = {
        kind: "single",
        bizDate: naturalDateMode ? localToday : operationalBizDate,
        label: naturalDateMode ? "今天" : "今日",
        days: 1,
      };
      break;
    case "yesterday":
      timeFrame = {
        kind: "single",
        bizDate: naturalDateMode ? shiftBizDate(localToday, -1) : reportBizDate,
        label: "昨天",
        days: 1,
      };
      break;
    case "day_before_yesterday":
      timeFrame = {
        kind: "single",
        bizDate: naturalDateMode ? shiftBizDate(localToday, -2) : shiftBizDate(reportBizDate, -1),
        label: "前天",
        days: 1,
      };
      break;
    case "tomorrow":
      timeFrame = {
        kind: "single",
        bizDate: naturalDateMode
          ? shiftBizDate(localToday, 1)
          : shiftBizDate(operationalBizDate, 1),
        label: "明天",
        days: 1,
      };
      break;
    case "this_week": {
      const endBizDate = naturalDateMode
        ? shiftBizDate(resolveMondayOfWeek(localToday), 6)
        : reportBizDate;
      const startBizDate = resolveMondayOfWeek(naturalDateMode ? localToday : reportBizDate);
      timeFrame = {
        kind: "range",
        startBizDate,
        endBizDate,
        label: "本周",
        days: daysBetweenInclusive(startBizDate, endBizDate),
      };
      break;
    }
    case "current_month":
      timeFrame = resolveCurrentMonthFrame(reportBizDate);
      break;
    case "recent_7d":
      timeFrame = resolveRecentRange(reportBizDate, 7, "近7天");
      break;
    case "recent_30d":
      timeFrame = resolveRecentRange(reportBizDate, 30, "近30天");
      break;
    case "recent_90d":
      timeFrame = resolveRecentRange(reportBizDate, 90, "近90天");
      break;
    case "next_7d":
      timeFrame = {
        kind: "range",
        startBizDate: localToday,
        endBizDate: shiftBizDate(localToday, 6),
        label: "未来7天",
        days: 7,
      };
      break;
    case "explicit_date":
      timeFrame = {
        kind: "single",
        bizDate: params.start ?? reportBizDate,
        label: params.start ?? reportBizDate,
        days: 1,
      };
      break;
    case "explicit_range": {
      const startBizDate = params.start ?? reportBizDate;
      const endBizDate = params.end ?? startBizDate;
      timeFrame = {
        kind: "range",
        startBizDate,
        endBizDate,
        label: `${startBizDate}~${endBizDate}`,
        days: daysBetweenInclusive(startBizDate, endBizDate),
      };
      break;
    }
    case "report_default":
    default:
      if (params.kind === "birthday_members") {
        timeFrame = {
          kind: "single",
          bizDate: localToday,
          label: "今天",
          days: 1,
        };
      } else if (params.kind === "customer_profile") {
        timeFrame = resolveRecentRange(reportBizDate, 90, "近90天");
      } else if (params.kind === "tech_profile") {
        timeFrame = resolveRecentRange(reportBizDate, 30, "近30天");
      } else if (params.kind === "hq_portfolio" || params.kind === "trend") {
        timeFrame = resolveRecentRange(reportBizDate, 7, "近7天");
      } else {
        timeFrame = {
          kind: "single",
          bizDate: reportBizDate,
          label: reportBizDate,
          days: 1,
        };
      }
      break;
  }

  return {
    timeFrame,
    comparisonTimeFrame:
      params.kind === "compare" || params.kind === "anomaly"
        ? resolvePreviousComparableTimeFrame(timeFrame)
        : undefined,
  };
}

function resolveSemanticObject(
  kind: HetangQueryIntentKind,
  override: unknown,
  allStoresRequested: boolean,
  explicitOrgIds: string[],
): HetangSemanticObject {
  if (typeof override === "string") {
    return override as HetangSemanticObject;
  }
  if (kind === "customer_segment" || kind === "customer_relation" || kind === "customer_profile") {
    return "customer";
  }
  if (kind === "tech_profile") {
    return "tech";
  }
  if (kind === "recharge_attribution") {
    return "recharge";
  }
  if (kind === "wait_experience") {
    return "wait_experience";
  }
  if (kind === "hq_portfolio" || allStoresRequested || explicitOrgIds.length > 1) {
    return "hq";
  }
  return "store";
}

function resolveSemanticAction(
  kind: HetangQueryIntentKind,
  override: unknown,
): HetangSemanticAction {
  if (typeof override === "string") {
    return override as HetangSemanticAction;
  }
  switch (kind) {
    case "customer_profile":
    case "tech_profile":
      return "profile";
    case "customer_segment":
    case "birthday_members":
      return "followup";
    case "customer_relation":
      return "followup";
    case "hq_portfolio":
      return "portfolio";
    case "member_marketing":
      return "followup";
    case "recharge_attribution":
    case "wait_experience":
      return "metric";
    default:
      return kind as HetangSemanticAction;
  }
}

export function renderSemanticClarificationText(params: {
  reason?: string;
  storeName?: string;
}): string {
  switch (params.reason) {
    case "missing_store_scope":
      return "这句话里的门店范围还不够清楚，请先说具体门店，或直接问五店全景。";
    case "missing_time_scope":
      return "这句话里的时间范围还不够清楚，请补一句昨天、近7天、近30天或本月。";
    case "missing_metric":
      return "这句话里的经营指标还不够清楚，请补一句想看营收、复购、储值、点钟率还是加钟率。";
    case "mixed-hq-and-single-store":
    case "mixed_scope":
      return [
        "这句话里同时包含五店全景和单店诊断，我先不硬猜，避免把问题路由错。",
        "你可以拆成两句直接问：",
        "- 哪家店最危险",
        `- ${params.storeName ?? "这家店"}近7天具体哪里有问题`,
      ].join("\n");
    default:
      return "这句话还差关键槽位，我先不硬猜。请补一句门店、时间或指标，我再给你稳答。";
  }
}

function normalizeRankingTarget(value: unknown): "store" | "tech" | undefined {
  return value === "store" || value === "tech" ? value : undefined;
}

function normalizeRankingOrder(value: unknown): "asc" | "desc" | undefined {
  return value === "asc" || value === "desc" ? value : undefined;
}

export async function resolveAiSemanticFallback(params: {
  config: HetangOpsConfig;
  text: string;
  now: Date;
  logger?: HetangLogger;
}): Promise<HetangSemanticFallbackResolution | null> {
  const fallbackConfig = params.config.semanticFallback;
  const semanticFallbackLane = params.config.aiLanes["semantic-fallback"]
    ? resolveAiLaneConfig(params.config, "semantic-fallback")
    : null;
  const requestBaseUrl = semanticFallbackLane?.baseUrl ?? fallbackConfig.baseUrl;
  const requestApiKey = semanticFallbackLane?.apiKey ?? fallbackConfig.apiKey;
  const requestModel = semanticFallbackLane?.model ?? fallbackConfig.model;
  const requestTimeoutMs = semanticFallbackLane?.timeoutMs ?? fallbackConfig.timeoutMs;
  if (
    !fallbackConfig.enabled ||
    !requestBaseUrl ||
    !requestApiKey ||
    !requestModel
  ) {
    return null;
  }

  const roster = params.config.stores
    .map(
      (store) =>
        `${store.storeName}${store.rawAliases.length > 0 ? `（别名：${store.rawAliases.join("、")}）` : ""}`,
    )
    .join("\n");
  const reportBizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const body = {
    model: requestModel,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: [
          "你是荷塘门店经营问答的语义补槽器，只负责把用户问题转成结构化 JSON。",
          "禁止直接回答业务问题，禁止输出任何解释文字，只能输出一个 JSON 对象。",
          `intent_kind 只能是: ${Array.from(SUPPORTED_INTENT_KINDS).join(", ")}, unknown`,
          `time_mode 只能是: ${Array.from(SUPPORTED_TIME_MODES).join(", ")}`,
          "当门店范围、时间范围或关键指标不清楚时，设置 needs_clarification=true，不要猜。",
          "像“盘里收了多少”“收了多少”“搞了多少”这类金额口语，如果不能明确对应到营收、储值、充值现金等标准指标，必须 needs_clarification=true。",
          "store_names 只能从已知门店中选；all_stores_requested=true 表示总部/五店全景。",
          "metric_hints 只放中文经营指标短语，比如 营收、储值、7天复到店率、加钟率。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `当前本地日期: ${resolveLocalDate(params.now, params.config.timeZone)}`,
          `当前默认经营查询基准日: ${reportBizDate}`,
          `门店清单:\n${roster}`,
          `用户问题: ${params.text.trim()}`,
          "",
          "输出 JSON schema:",
          JSON.stringify(
            {
              intent_kind: "metric",
              confidence: 0.91,
              needs_clarification: false,
              clarification_reason: "missing_store_scope",
              store_names: ["义乌店"],
              all_stores_requested: false,
              time_mode: "yesterday",
              time_start: "2026-04-04",
              time_end: "2026-04-04",
              object: "store",
              secondary_object: "customer",
              action: "metric",
              secondary_action: "followup",
              metric_hints: ["营收"],
              phone_suffix: "7500",
              ranking_target: "store",
              ranking_order: "desc",
            },
            null,
            2,
          ),
        ].join("\n"),
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${requestBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${requestApiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    params.logger?.warn?.(
      `hetang-ops: semantic fallback request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    params.logger?.warn?.(
      `hetang-ops: semantic fallback upstream returned ${response.status} ${response.statusText}`,
    );
    return null;
  }

  let payloadJson: Record<string, unknown> | null = null;
  try {
    payloadJson = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    params.logger?.warn?.(
      `hetang-ops: semantic fallback response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  const content = extractMessageText(payloadJson);
  if (!content) {
    return null;
  }
  const structured = parseJsonObject(content) as HetangAiSemanticFallbackPayload | null;
  if (!structured) {
    return null;
  }

  const confidence = resolveConfidence(structured.confidence);
  const resolvedStoreNames = asStringArray(structured.store_names);
  const explicitOrgIds = Array.from(
    new Set(
      resolvedStoreNames
        .map((storeName) => resolveStoreOrgId(params.config, storeName))
        .filter((orgId): orgId is string => Boolean(orgId)),
    ),
  );
  const representativeStoreName = resolvedStoreNames[0];

  if (requiresMetricClarification(params.text)) {
    return {
      clarificationText: renderSemanticClarificationText({
        reason: "missing_metric",
        storeName: representativeStoreName,
      }),
      clarificationReason: "missing-metric",
    };
  }

  if (structured.needs_clarification === true && confidence >= fallbackConfig.clarifyConfidence) {
    return {
      clarificationText: renderSemanticClarificationText({
        reason: structured.clarification_reason,
        storeName: representativeStoreName,
      }),
      clarificationReason:
        typeof structured.clarification_reason === "string"
          ? structured.clarification_reason.replace(/_/gu, "-")
          : undefined,
    };
  }

  if (confidence < fallbackConfig.autoAcceptConfidence) {
    return null;
  }

  const kind = normalizeIntentKind(structured.intent_kind);
  if (!kind) {
    return null;
  }

  const metricHints = asStringArray(structured.metric_hints);
  const metrics = resolveMetricIntent(
    [params.text, ...metricHints].join(" ").trim(),
  );
  if (
    METRIC_DEPENDENT_FALLBACK_INTENT_KINDS.has(kind) &&
    metrics.supported.length === 0 &&
    metrics.unsupported.length === 0 &&
    (metricHints.length > 0 || EXPLICIT_METRIC_TOKENS_PATTERN.test(params.text))
  ) {
    return {
      clarificationText: renderSemanticClarificationText({
        reason: "missing_metric",
        storeName: representativeStoreName,
      }),
      clarificationReason: "missing-metric",
    };
  }
  const { timeFrame, comparisonTimeFrame } = resolveFallbackTimeFrames({
    config: params.config,
    kind,
    mode: normalizeTimeMode(structured.time_mode),
    start: structured.time_start,
    end: structured.time_end,
    now: params.now,
  });
  const allStoresRequested = structured.all_stores_requested === true;
  const object = resolveSemanticObject(kind, structured.object, allStoresRequested, explicitOrgIds);
  const action = resolveSemanticAction(kind, structured.action);

  return {
    intent: {
      rawText: params.text.trim(),
      kind,
      explicitOrgIds,
      allStoresRequested,
      timeFrame,
      comparisonTimeFrame,
      phoneSuffix: normalizePhoneSuffix(structured.phone_suffix, params.text),
      metrics: metrics.supported,
      unsupportedMetrics: metrics.unsupported,
      rankingTarget: normalizeRankingTarget(structured.ranking_target),
      rankingOrder: normalizeRankingOrder(structured.ranking_order),
      mentionsCompareKeyword: kind === "compare",
      mentionsRankingKeyword: kind === "ranking",
      mentionsTrendKeyword: kind === "trend",
      mentionsAnomalyKeyword: kind === "anomaly",
      mentionsRiskKeyword: kind === "risk",
      mentionsAdviceKeyword: kind === "advice",
      mentionsReportKeyword: kind === "report" || kind === "hq_portfolio",
      routeConfidence: confidence >= 0.92 ? "high" : "medium",
      semanticSlots: {
        store: {
          scope: allStoresRequested
            ? "all"
            : explicitOrgIds.length > 1
              ? "multi"
              : explicitOrgIds.length === 1
                ? "single"
                : "implicit",
          orgIds: explicitOrgIds,
        },
        object,
        secondaryObject:
          typeof structured.secondary_object === "string"
            ? (structured.secondary_object as HetangSemanticObject)
            : undefined,
        action,
        secondaryAction:
          typeof structured.secondary_action === "string"
            ? (structured.secondary_action as HetangSemanticAction)
            : undefined,
        metricKeys: metrics.supported.map((metric) => metric.key),
        time:
          timeFrame.kind === "single"
            ? {
                kind: "single" as const,
                startBizDate: timeFrame.bizDate,
                endBizDate: timeFrame.bizDate,
                label: timeFrame.label,
                days: timeFrame.days,
              }
            : {
                kind: "range" as const,
                startBizDate: timeFrame.startBizDate,
                endBizDate: timeFrame.endBizDate,
                label: timeFrame.label,
                days: timeFrame.days,
              },
      },
    },
  };
}
