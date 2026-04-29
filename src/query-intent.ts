import {
  resolveMetricIntent,
  type HetangMetricIntentResolution,
} from "./metric-query.js";
import {
  resolveHetangIntentRoute,
  type HetangIntentRouteResolution,
} from "./query-route-registry.js";
import {
  resolveHetangQuerySemanticContext,
  type HetangQuerySemanticContext,
} from "./query-semantics.js";
import {
  resolveLocalDate,
  resolveOperationalBizDate,
  resolveReportBizDate,
  shiftBizDate,
} from "./time.js";
import type {
  HetangConversationSemanticStateSnapshot,
  HetangOpsConfig,
} from "./types.js";

export type HetangQueryTimeFrame =
  | {
      kind: "single";
      bizDate: string;
      label: string;
      days: 1;
    }
  | {
      kind: "range";
      startBizDate: string;
      endBizDate: string;
      label: string;
      days: number;
    };

export type HetangQueryIntentKind =
  | "metric"
  | "report"
  | "compare"
  | "ranking"
  | "trend"
  | "anomaly"
  | "risk"
  | "advice"
  | "hq_portfolio"
  | "customer_segment"
  | "customer_relation"
  | "customer_profile"
  | "tech_profile"
  | "tech_current"
  | "birthday_members"
  | "arrival_profile"
  | "wait_experience"
  | "member_marketing"
  | "recharge_attribution";

export type HetangQueryIntent = {
  rawText: string;
  kind: HetangQueryIntentKind;
  explicitOrgIds: string[];
  allStoresRequested: boolean;
  timeFrame: HetangQueryTimeFrame;
  comparisonTimeFrame?: HetangQueryTimeFrame;
  phoneSuffix?: string;
  metrics: HetangMetricIntentResolution["supported"];
  unsupportedMetrics: HetangMetricIntentResolution["unsupported"];
  rankingTarget?: "store" | "tech";
  rankingOrder?: "asc" | "desc";
  mentionsCompareKeyword: boolean;
  mentionsRankingKeyword: boolean;
  mentionsTrendKeyword: boolean;
  mentionsAnomalyKeyword: boolean;
  mentionsRiskKeyword: boolean;
  mentionsAdviceKeyword: boolean;
  mentionsReportKeyword: boolean;
  routeConfidence?: "high" | "medium" | "low";
  requiresClarification?: boolean;
  clarificationReason?: string;
  semanticSlots: HetangQuerySemanticContext["semanticSlots"] & {
    time: {
      kind: HetangQueryTimeFrame["kind"];
      startBizDate: string;
      endBizDate: string;
      label: string;
      days: number;
    };
  };
};

const EXPLICIT_TIME_SCOPE_KEYWORDS =
  /(今天|今日|昨天|昨日|明天|前天|前日|前一日|前一天|上一日|上一天|本周|本月|上周|上月|下周|下月|最近|近期|这几天|近几天|最近这几天|前几天|未来\d+[天周月年]|近\d+[天周月年]|最近\d+[天周月年]|过去\d+[天周月年]|未来[一二两三四五六七八九十百零]+[天周月年]|近[一二两三四五六七八九十百零]+[天周月年]|最近[一二两三四五六七八九十百零]+[天周月年]|过去[一二两三四五六七八九十百零]+[天周月年]|\d{4}-\d{2}-\d{2}|\d{4}年\s*\d{1,2}月(?:份)?|\d{4}年\s*\d{1,2}月\s*\d{1,2}日|\d{1,2}月(?:份)?|\d{1,2}月\s*\d{1,2}日)/u;
const WINDOW_TIME_SCOPE_KEYWORDS =
  /(最近|近期|这几天|近几天|最近这几天|前几天|本周|本月|上周|上月|下周|下月|近\d+[天周月年]|最近\d+[天周月年]|过去\d+[天周月年]|近[一二两三四五六七八九十百零]+[天周月年]|最近[一二两三四五六七八九十百零]+[天周月年]|过去[一二两三四五六七八九十百零]+[天周月年]|近一周|最近一周|过去一周)/u;
const COLLOQUIAL_METRIC_SUPPLEMENT_KEYWORDS =
  /(营收|业绩|储值|复购|客流|客单价|点钟率|加钟率|点钟|加钟|钟效|人效|卡里还有多少|盘里收了多少|收了多少)/u;
const SAFE_OPEN_STORE_REPORT_KEYWORDS = /(怎么样|如何|咋样|什么情况)/u;
const SAFE_OPEN_STORE_ADVICE_KEYWORDS =
  /(重点看什么|该看什么|看什么指标|重点抓什么|该抓什么)/u;
const AMBIGUOUS_COLLOQUIAL_AMOUNT_KEYWORDS =
  /(盘里收了多少|盘里收|收了多少|搞了多少|做了多少)/u;

type ConversationSemanticTurnResolution = {
  effectiveText: string;
  stateCarriedForward: boolean;
  topicSwitchDetected: boolean;
};

function normalizeCarryText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function resolvePendingConversationText(
  semanticState?: HetangConversationSemanticStateSnapshot | null,
): string | null {
  const pendingText = semanticState?.beliefState.pendingText;
  return typeof pendingText === "string" && pendingText.trim().length > 0
    ? pendingText.trim()
    : null;
}

function buildCombinedCarryText(pendingText: string, text: string): string {
  const normalizedPendingText = normalizeCarryText(pendingText);
  const normalizedText = normalizeCarryText(text);
  if (!normalizedText) {
    return pendingText.trim();
  }
  if (normalizedPendingText.includes(normalizedText)) {
    return pendingText.trim();
  }
  if (normalizedText.includes(normalizedPendingText)) {
    return text.trim();
  }
  return `${pendingText.trim()} ${text.trim()}`.trim();
}

function resolveLastEffectiveConversationText(
  semanticState?: HetangConversationSemanticStateSnapshot | null,
): string | null {
  const lastEffectiveText = semanticState?.beliefState.lastEffectiveText;
  return typeof lastEffectiveText === "string" && lastEffectiveText.trim().length > 0
    ? lastEffectiveText.trim()
    : null;
}

function isObjectSwitchContinuation(params: { text: string }): boolean {
  const normalized = normalizeCarryText(params.text);
  return /^(那|那么)?(顾客|客人|客户|会员|技师|老师|风险|建议|排行|排名|复盘)(呢|怎么样|情况|状态|如何)?$/u.test(normalized);
}

function isExplicitTopicSwitchPhrase(text: string): boolean {
  return /(换个话题|换一个话题|不说这个了|说别的)/u.test(text);
}

function isSlotOnlyTimeSupplement(params: {
  config: HetangOpsConfig;
  text: string;
}): boolean {
  if (!EXPLICIT_TIME_SCOPE_KEYWORDS.test(params.text)) {
    return false;
  }
  const semanticContext = resolveHetangQuerySemanticContext(params);
  return (
    semanticContext.explicitOrgIds.length === 0 &&
    !semanticContext.allStoresRequested &&
    semanticContext.metrics.supported.length === 0 &&
    semanticContext.metrics.unsupported.length === 0 &&
    !semanticContext.hasDataKeyword &&
    semanticContext.semanticSlots.object === "unknown"
  );
}

function isSlotOnlyStoreSupplement(params: {
  config: HetangOpsConfig;
  text: string;
}): boolean {
  const semanticContext = resolveHetangQuerySemanticContext(params);
  return (
    semanticContext.explicitOrgIds.length === 1 &&
    !semanticContext.allStoresRequested &&
    !EXPLICIT_TIME_SCOPE_KEYWORDS.test(params.text) &&
    semanticContext.metrics.supported.length === 0 &&
    semanticContext.metrics.unsupported.length === 0 &&
    (semanticContext.semanticSlots.object === "unknown" ||
      semanticContext.semanticSlots.object === "store")
  );
}

function isSlotOnlyMetricSupplement(params: {
  config: HetangOpsConfig;
  text: string;
}): boolean {
  const semanticContext = resolveHetangQuerySemanticContext(params);
  const metricIntent = resolveMetricIntent(params.text);
  const normalizedText = normalizeCarryText(params.text);
  const hasMetricSignal =
    metricIntent.supported.length > 0 ||
    metricIntent.unsupported.length > 0 ||
    COLLOQUIAL_METRIC_SUPPLEMENT_KEYWORDS.test(normalizedText);
  return (
    hasMetricSignal &&
    semanticContext.explicitOrgIds.length === 0 &&
    !semanticContext.allStoresRequested &&
    !EXPLICIT_TIME_SCOPE_KEYWORDS.test(params.text) &&
    (semanticContext.semanticSlots.object === "unknown" ||
      semanticContext.semanticSlots.object === "store")
  );
}

function looksLikeStandaloneTopic(params: {
  config: HetangOpsConfig;
  text: string;
  now: Date;
}): boolean {
  if (isExplicitTopicSwitchPhrase(params.text)) {
    return true;
  }
  if (
    resolveHetangQueryIntent({
      config: params.config,
      text: params.text,
      now: params.now,
    })
  ) {
    return true;
  }
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text: params.text,
  });
  return (
    (semanticContext.hasStoreContext || semanticContext.allStoresRequested) &&
    (EXPLICIT_TIME_SCOPE_KEYWORDS.test(params.text) ||
      semanticContext.hasDataKeyword ||
      semanticContext.metrics.supported.length > 0 ||
      semanticContext.metrics.unsupported.length > 0 ||
      semanticContext.semanticSlots.object !== "unknown" ||
      semanticContext.mentionsTrendKeyword ||
      semanticContext.mentionsAnomalyKeyword ||
      semanticContext.mentionsRiskKeyword ||
      semanticContext.mentionsAdviceKeyword ||
      semanticContext.mentionsReportKeyword)
  );
}

export function resolveConversationSemanticEffectiveText(params: {
  config: HetangOpsConfig;
  text: string;
  now: Date;
  semanticState?: HetangConversationSemanticStateSnapshot | null;
}): ConversationSemanticTurnResolution {
  const rawText = params.text.trim();
  const pendingText = resolvePendingConversationText(params.semanticState);
  const lastEffectiveText = resolveLastEffectiveConversationText(params.semanticState);
  const lastIntentKind = params.semanticState?.lastIntentKind;
  if (
    rawText &&
    !params.semanticState?.clarificationPending &&
    lastIntentKind === "query" &&
    lastEffectiveText &&
    isObjectSwitchContinuation({ text: rawText })
  ) {
    return {
      effectiveText: buildCombinedCarryText(lastEffectiveText, rawText),
      stateCarriedForward: true,
      topicSwitchDetected: false,
    };
  }
  if (rawText && isExplicitTopicSwitchPhrase(rawText)) {
    return {
      effectiveText: rawText,
      stateCarriedForward: false,
      topicSwitchDetected: true,
    };
  }
  if (!rawText || !params.semanticState?.clarificationPending || !pendingText) {
    return {
      effectiveText: rawText,
      stateCarriedForward: false,
      topicSwitchDetected: false,
    };
  }

  const reason = params.semanticState.clarificationReason;
  if (reason === "missing-time" && isSlotOnlyTimeSupplement(params)) {
    return {
      effectiveText: buildCombinedCarryText(pendingText, rawText),
      stateCarriedForward: true,
      topicSwitchDetected: false,
    };
  }
  if (reason === "missing-store" && isSlotOnlyStoreSupplement(params)) {
    return {
      effectiveText: buildCombinedCarryText(pendingText, rawText),
      stateCarriedForward: true,
      topicSwitchDetected: false,
    };
  }
  if (reason === "missing-metric" && isSlotOnlyMetricSupplement(params)) {
    return {
      effectiveText: buildCombinedCarryText(pendingText, rawText),
      stateCarriedForward: true,
      topicSwitchDetected: false,
    };
  }

  const normalizedPendingText = normalizeCarryText(pendingText);
  const normalizedRawText = normalizeCarryText(rawText);
  return {
    effectiveText: rawText,
    stateCarriedForward: false,
    topicSwitchDetected:
      looksLikeStandaloneTopic(params) &&
      !normalizedPendingText.includes(normalizedRawText) &&
      !normalizedRawText.includes(normalizedPendingText),
  };
}

type PositionedTimeFrame = {
  frame: HetangQueryTimeFrame;
  position: number;
};

function parseRelativeTimeNumberToken(token: string): number | null {
  if (/^\d+$/u.test(token)) {
    const numeric = Number(token);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  const digitMap: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  const unitMap: Record<string, number> = {
    十: 10,
    百: 100,
  };

  let total = 0;
  let current = 0;
  for (const char of token) {
    if (char in digitMap) {
      current = digitMap[char] ?? 0;
      continue;
    }
    if (char in unitMap) {
      const unit = unitMap[char] ?? 0;
      total += (current === 0 ? 1 : current) * unit;
      current = 0;
      continue;
    }
    return null;
  }

  const resolved = total + current;
  return resolved > 0 ? resolved : null;
}

function resolveChineseCalendarDate(params: {
  year?: number;
  month: number;
  day: number;
  reportBizDate: string;
}): string {
  const reportYear = Number(params.reportBizDate.slice(0, 4));
  const reportMonth = Number(params.reportBizDate.slice(5, 7));
  const reportDay = Number(params.reportBizDate.slice(8, 10));
  const inferredYear =
    params.year ??
    (params.month > reportMonth || (params.month === reportMonth && params.day > reportDay)
      ? reportYear - 1
      : reportYear);
  return `${inferredYear}-${String(params.month).padStart(2, "0")}-${String(params.day).padStart(2, "0")}`;
}

function isExplicitCalendarSingle(frame: HetangQueryTimeFrame): boolean {
  return (
    frame.kind === "single" &&
    (/^\d{4}-\d{2}-\d{2}$/u.test(frame.label) || /(?:年|月).+日/u.test(frame.label))
  );
}

function resolveExplicitSingleDateMatches(params: {
  text: string;
  now: Date;
  timeZone: string;
  cutoffLocalTime: string;
}): PositionedTimeFrame[] {
  const matches: PositionedTimeFrame[] = [];
  const reportBizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.timeZone,
    cutoffLocalTime: params.cutoffLocalTime,
  });
  for (const match of params.text.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/gu)) {
    matches.push({
      position: match.index ?? 0,
      frame: {
        kind: "single",
        bizDate: match[1],
        label: match[1],
        days: 1,
      },
    });
  }

  for (const match of params.text.matchAll(/(\d{4})年\s*(1[0-2]|0?[1-9])月\s*([0-3]?\d)日/gu)) {
    matches.push({
      position: match.index ?? 0,
      frame: {
        kind: "single",
        bizDate: resolveChineseCalendarDate({
          year: Number(match[1]),
          month: Number(match[2]),
          day: Number(match[3]),
          reportBizDate,
        }),
        label: match[0].replace(/\s+/gu, ""),
        days: 1,
      },
    });
  }

  for (const match of params.text.matchAll(/(?<!\d)(1[0-2]|0?[1-9])月\s*([0-3]?\d)日/gu)) {
    matches.push({
      position: match.index ?? 0,
      frame: {
        kind: "single",
        bizDate: resolveChineseCalendarDate({
          month: Number(match[1]),
          day: Number(match[2]),
          reportBizDate,
        }),
        label: match[0].replace(/\s+/gu, ""),
        days: 1,
      },
    });
  }

  const dayResolvers: Array<{
    pattern: RegExp;
    resolve: () => string;
  }> = [
    {
      pattern: /(前天|前日|前一日|前一天|上一日|上一天)/gu,
      resolve: () =>
        shiftBizDate(
          resolveReportBizDate({
            now: params.now,
            timeZone: params.timeZone,
            cutoffLocalTime: params.cutoffLocalTime,
          }),
          -1,
        ),
    },
    {
      pattern: /(昨天|昨日)/gu,
      resolve: () =>
        resolveReportBizDate({
          now: params.now,
          timeZone: params.timeZone,
          cutoffLocalTime: params.cutoffLocalTime,
        }),
    },
    {
      pattern: /(今天|今日)/gu,
      resolve: () =>
        resolveOperationalBizDate({
          now: params.now,
          timeZone: params.timeZone,
          cutoffLocalTime: params.cutoffLocalTime,
        }),
    },
  ];

  for (const entry of dayResolvers) {
    for (const match of params.text.matchAll(entry.pattern)) {
      matches.push({
        position: match.index ?? 0,
        frame: {
          kind: "single",
          bizDate: entry.resolve(),
          label: match[0],
          days: 1,
        },
      });
    }
  }

  return matches.sort((left, right) => left.position - right.position);
}

function resolveMondayOfWeek(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function resolveLastBizDateOfMonth(year: number, month: number): string {
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

function resolveAbsoluteMonthRange(params: {
  text: string;
  reportBizDate: string;
}): PositionedTimeFrame | null {
  const match = params.text.match(/(?:(\d{4})年)?\s*(1[0-2]|0?[1-9])月(?:份)?/u);
  if (!match) {
    return null;
  }

  const explicitYear = match[1] ? Number(match[1]) : undefined;
  const month = Number(match[2]);
  const reportYear = Number(params.reportBizDate.slice(0, 4));
  const reportMonth = Number(params.reportBizDate.slice(5, 7));
  const year = explicitYear ?? (month > reportMonth ? reportYear - 1 : reportYear);
  const startBizDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const monthEndBizDate = resolveLastBizDateOfMonth(year, month);
  const endBizDate =
    year === reportYear && month === reportMonth && params.reportBizDate < monthEndBizDate
      ? params.reportBizDate
      : monthEndBizDate;
  const days =
    Math.round(
      (new Date(`${endBizDate}T00:00:00Z`).getTime() -
        new Date(`${startBizDate}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;

  return {
    position: match.index ?? 0,
    frame: {
      kind: "range",
      startBizDate,
      endBizDate,
      label: match[0].replace(/\s+/gu, ""),
      days,
    },
  };
}

function resolveRangeMatch(params: {
  text: string;
  now: Date;
  timeZone: string;
  cutoffLocalTime: string;
}): PositionedTimeFrame | null {
  const reportBizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.timeZone,
    cutoffLocalTime: params.cutoffLocalTime,
  });

  const absoluteMonthRange = resolveAbsoluteMonthRange({
    text: params.text,
    reportBizDate,
  });
  if (absoluteMonthRange) {
    return absoluteMonthRange;
  }

  const text = params.text;
  const fixedRanges: Array<{
    pattern: RegExp;
    build: () => HetangQueryTimeFrame;
  }> = [
    {
      pattern: /(这几天|近几天|最近这几天|前几天)/u,
      build: () => ({
        kind: "range",
        startBizDate: shiftBizDate(reportBizDate, -4),
        endBizDate: reportBizDate,
        label: "近5天",
        days: 5,
      }),
    },
    {
      pattern: /(近一周|最近一周|过去一周)/u,
      build: () => ({
        kind: "range",
        startBizDate: shiftBizDate(reportBizDate, -6),
        endBizDate: reportBizDate,
        label: "近7天",
        days: 7,
      }),
    },
    {
      pattern: /本周/u,
      build: () => ({
        kind: "range",
        startBizDate: resolveMondayOfWeek(reportBizDate),
        endBizDate: reportBizDate,
        label: "本周",
        days:
          Math.round(
            (new Date(`${reportBizDate}T00:00:00Z`).getTime() -
              new Date(`${resolveMondayOfWeek(reportBizDate)}T00:00:00Z`).getTime()) /
              86_400_000,
          ) + 1,
      }),
    },
    {
      pattern: /上周/u,
      build: () => {
        const currentWeekStart = resolveMondayOfWeek(reportBizDate);
        const previousWeekEnd = shiftBizDate(currentWeekStart, -1);
        const previousWeekStart = resolveMondayOfWeek(previousWeekEnd);
        return {
          kind: "range",
          startBizDate: previousWeekStart,
          endBizDate: previousWeekEnd,
          label: "上周",
          days: 7,
        };
      },
    },
    {
      pattern: /本月/u,
      build: () => ({
        kind: "range",
        startBizDate: `${reportBizDate.slice(0, 8)}01`,
        endBizDate: reportBizDate,
        label: "本月",
        days:
          Math.round(
            (new Date(`${reportBizDate}T00:00:00Z`).getTime() -
              new Date(`${reportBizDate.slice(0, 8)}01T00:00:00Z`).getTime()) /
              86_400_000,
          ) + 1,
      }),
    },
  ];

  for (const entry of fixedRanges) {
    const match = text.match(entry.pattern);
    if (!match) {
      continue;
    }
    return {
      position: match.index ?? 0,
      frame: entry.build(),
    };
  }

  const relativeRange = params.text.match(
    /(近|最近|过去)(\d+|[一二两三四五六七八九十百零]+)(天|日|周|月)/u,
  );
  if (relativeRange) {
    const unit = relativeRange[3];
    const value = parseRelativeTimeNumberToken(relativeRange[2]);
    if (!value) {
      return null;
    }
    const days = unit === "周" ? value * 7 : unit === "月" ? value * 30 : value;
    return {
      position: relativeRange.index ?? 0,
      frame: {
        kind: "range",
        startBizDate: shiftBizDate(reportBizDate, -(days - 1)),
        endBizDate: reportBizDate,
        label: relativeRange[0],
        days,
      },
    };
  }

  return null;
}

function resolveDefaultSingleDate(params: {
  text: string;
  now: Date;
  timeZone: string;
  cutoffLocalTime: string;
}): HetangQueryTimeFrame {
  if (/(今天|今日)/u.test(params.text)) {
    return {
      kind: "single",
      bizDate: resolveOperationalBizDate({
        now: params.now,
        timeZone: params.timeZone,
        cutoffLocalTime: params.cutoffLocalTime,
      }),
      label: "今日",
      days: 1,
    };
  }
  const bizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.timeZone,
    cutoffLocalTime: params.cutoffLocalTime,
  });
  return {
    kind: "single",
    bizDate,
    label: bizDate,
    days: 1,
  };
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

function resolveTimeFrames(params: {
  text: string;
  now: Date;
  timeZone: string;
  cutoffLocalTime: string;
  kind: HetangQueryIntentKind;
  compareLike: boolean;
}): {
  timeFrame: HetangQueryTimeFrame;
  comparisonTimeFrame?: HetangQueryTimeFrame;
} {
  if (params.kind === "birthday_members") {
    return {
      timeFrame: resolveBirthdayTimeFrame({
        text: params.text,
        now: params.now,
        timeZone: params.timeZone,
      }),
    };
  }

  const singles = resolveExplicitSingleDateMatches(params);
  const range = resolveRangeMatch(params);

  if (params.compareLike && singles.length >= 2) {
    return {
      timeFrame: singles[0].frame,
      comparisonTimeFrame: singles[1].frame,
    };
  }

  const explicitCalendarSingle = singles.find((entry) => isExplicitCalendarSingle(entry.frame));
  if (explicitCalendarSingle) {
    return {
      timeFrame: explicitCalendarSingle.frame,
      comparisonTimeFrame:
        params.compareLike && singles.length === 1
          ? resolvePreviousComparableTimeFrame(explicitCalendarSingle.frame)
          : undefined,
    };
  }

  if (range) {
    return {
      timeFrame: range.frame,
      comparisonTimeFrame: params.compareLike
        ? resolvePreviousComparableTimeFrame(range.frame)
        : undefined,
    };
  }

  if (singles.length > 0) {
    return {
      timeFrame: singles[0].frame,
      comparisonTimeFrame:
        params.compareLike && singles.length === 1
          ? resolvePreviousComparableTimeFrame(singles[0].frame)
          : undefined,
    };
  }

  if (params.kind === "trend") {
    const reportBizDate = resolveReportBizDate({
      now: params.now,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime,
    });
    const frame: HetangQueryTimeFrame = {
      kind: "range",
      startBizDate: shiftBizDate(reportBizDate, -6),
      endBizDate: reportBizDate,
      label: "近7天",
      days: 7,
    };
    return { timeFrame: frame };
  }

  if (params.kind === "customer_profile") {
    const reportBizDate = resolveReportBizDate({
      now: params.now,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime,
    });
    const days = /最近/u.test(params.text) ? 30 : 90;
    return {
      timeFrame: {
        kind: "range",
        startBizDate: shiftBizDate(reportBizDate, -(days - 1)),
        endBizDate: reportBizDate,
        label: `近${days}天`,
        days,
      },
    };
  }

  if (params.kind === "tech_profile") {
    const reportBizDate = resolveReportBizDate({
      now: params.now,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime,
    });
    return {
      timeFrame: {
        kind: "range",
        startBizDate: shiftBizDate(reportBizDate, -29),
        endBizDate: reportBizDate,
        label: "近30天",
        days: 30,
      },
    };
  }

  if (params.kind === "hq_portfolio") {
    const reportBizDate = resolveReportBizDate({
      now: params.now,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime,
    });
    const frame: HetangQueryTimeFrame = {
      kind: "range",
      startBizDate: shiftBizDate(reportBizDate, -14),
      endBizDate: reportBizDate,
      label: "近15天",
      days: 15,
    };
    return { timeFrame: frame };
  }

  if (
    /(最近|近期)/u.test(params.text) &&
    ["risk", "advice", "ranking", "report", "trend", "compare", "anomaly"].includes(params.kind)
  ) {
    const reportBizDate = resolveReportBizDate({
      now: params.now,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime,
    });
    const frame: HetangQueryTimeFrame = {
      kind: "range",
      startBizDate: shiftBizDate(reportBizDate, -29),
      endBizDate: reportBizDate,
      label: "近30天",
      days: 30,
    };
    return {
      timeFrame: frame,
      comparisonTimeFrame: params.compareLike
        ? resolvePreviousComparableTimeFrame(frame)
        : undefined,
    };
  }

  const timeFrame = resolveDefaultSingleDate(params);
  return {
    timeFrame,
    comparisonTimeFrame: params.compareLike
      ? resolvePreviousComparableTimeFrame(timeFrame)
      : undefined,
  };
}

function resolveBirthdayTimeFrame(params: {
  text: string;
  now: Date;
  timeZone: string;
}): HetangQueryTimeFrame {
  const localToday = resolveLocalDate(params.now, params.timeZone);
  const explicitDate = params.text.match(/\b(\d{4}-\d{2}-\d{2})\b/u)?.[1];
  if (explicitDate) {
    return {
      kind: "single",
      bizDate: explicitDate,
      label: explicitDate,
      days: 1,
    };
  }

  if (/(明天|翌日)/u.test(params.text)) {
    return {
      kind: "single",
      bizDate: shiftBizDate(localToday, 1),
      label: "明天",
      days: 1,
    };
  }

  if (/(今天|今日)/u.test(params.text)) {
    return {
      kind: "single",
      bizDate: localToday,
      label: "今天",
      days: 1,
    };
  }

  if (/(未来7天|未来一周|接下来7天|接下来一周|未来七天)/u.test(params.text)) {
    return {
      kind: "range",
      startBizDate: localToday,
      endBizDate: shiftBizDate(localToday, 6),
      label: "未来7天",
      days: 7,
    };
  }

  if (/本周/u.test(params.text)) {
    const startBizDate = resolveMondayOfWeek(localToday);
    return {
      kind: "range",
      startBizDate,
      endBizDate: shiftBizDate(startBizDate, 6),
      label: "本周",
      days: 7,
    };
  }

  if (/本月/u.test(params.text)) {
    const year = Number(localToday.slice(0, 4));
    const month = Number(localToday.slice(5, 7));
    const startBizDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endBizDate = resolveLastBizDateOfMonth(year, month);
    const days =
      Math.round(
        (new Date(`${endBizDate}T00:00:00Z`).getTime() -
          new Date(`${startBizDate}T00:00:00Z`).getTime()) /
          86_400_000,
      ) + 1;
    return {
      kind: "range",
      startBizDate,
      endBizDate,
      label: "本月",
      days,
    };
  }

  return {
    kind: "single",
    bizDate: localToday,
    label: "今天",
    days: 1,
  };
}

function resolvePhoneSuffix(text: string): string | undefined {
  const leading = text.match(/(?:尾号|后四位|手机后四位|手机号后四位)\D*(\d{4})/u);
  if (leading?.[1]) {
    return leading[1];
  }
  const trailing = text.match(/(\d{4})\D*(?:尾号|后四位)/u);
  if (trailing?.[1]) {
    return trailing[1];
  }
  return undefined;
}

function buildSyntheticRouteResolution(params: {
  context: HetangQuerySemanticContext;
  kind: HetangQueryIntentKind;
  mentionsAdviceKeyword?: boolean;
  mentionsReportKeyword?: boolean;
}): HetangIntentRouteResolution {
  return {
    kind: params.kind,
    confidence: "high",
    mentionsCompareKeyword: params.context.mentionsCompareKeyword,
    mentionsRankingKeyword: params.context.mentionsRankingKeyword,
    mentionsTrendKeyword: params.context.mentionsTrendKeyword,
    mentionsAnomalyKeyword: params.context.mentionsAnomalyKeyword,
    mentionsRiskKeyword: params.context.mentionsRiskKeyword,
    mentionsAdviceKeyword: params.mentionsAdviceKeyword ?? params.context.mentionsAdviceKeyword,
    mentionsReportKeyword: params.mentionsReportKeyword ?? params.context.mentionsReportKeyword,
  };
}

function resolveSafeOpenBusinessRoute(params: {
  text: string;
  semanticContext: HetangQuerySemanticContext;
}): HetangIntentRouteResolution | null {
  if (
    !WINDOW_TIME_SCOPE_KEYWORDS.test(params.text) ||
    AMBIGUOUS_COLLOQUIAL_AMOUNT_KEYWORDS.test(params.text)
  ) {
    return null;
  }

  const hqWindowAsk =
    (params.semanticContext.allStoresRequested || params.semanticContext.explicitOrgIds.length > 1) &&
    !params.semanticContext.routeSignals.hqStoreMixedScope;
  if (hqWindowAsk) {
    if (
      SAFE_OPEN_STORE_ADVICE_KEYWORDS.test(params.text) ||
      SAFE_OPEN_STORE_REPORT_KEYWORDS.test(params.text)
    ) {
      return buildSyntheticRouteResolution({
        context: params.semanticContext,
        kind: "hq_portfolio",
        mentionsAdviceKeyword: SAFE_OPEN_STORE_ADVICE_KEYWORDS.test(params.text)
          ? true
          : params.semanticContext.mentionsAdviceKeyword,
        mentionsReportKeyword: SAFE_OPEN_STORE_REPORT_KEYWORDS.test(params.text)
          ? true
          : params.semanticContext.mentionsReportKeyword,
      });
    }
    return null;
  }

  const singleStoreWindowAsk =
    params.semanticContext.semanticSlots.object === "store" &&
    params.semanticContext.explicitOrgIds.length === 1 &&
    !params.semanticContext.allStoresRequested;
  if (!singleStoreWindowAsk) {
    return null;
  }

  if (SAFE_OPEN_STORE_ADVICE_KEYWORDS.test(params.text)) {
    return buildSyntheticRouteResolution({
      context: params.semanticContext,
      kind: "advice",
      mentionsAdviceKeyword: true,
    });
  }

  if (SAFE_OPEN_STORE_REPORT_KEYWORDS.test(params.text)) {
    return buildSyntheticRouteResolution({
      context: params.semanticContext,
      kind: "report",
      mentionsReportKeyword: true,
    });
  }

  return null;
}

export function resolveHetangQueryIntent(params: {
  config: HetangOpsConfig;
  text: string;
  now: Date;
}): HetangQueryIntent | null {
  const text = params.text.trim();
  if (!text || text.startsWith("/")) {
    return null;
  }
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text,
  });
  const resolvedRoute = resolveHetangIntentRoute(semanticContext);
  const safeOpenRoute = resolveSafeOpenBusinessRoute({
    text,
    semanticContext,
  });
  const intent =
    safeOpenRoute && (!resolvedRoute || resolvedRoute.kind === "metric")
      ? safeOpenRoute
      : resolvedRoute ?? safeOpenRoute;
  if (!intent) {
    return null;
  }

  const { timeFrame, comparisonTimeFrame } = resolveTimeFrames({
    text,
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
    kind: intent.kind,
    compareLike: intent.kind === "compare" || intent.kind === "anomaly",
  });
  const timeSlot =
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
        };

  return {
    rawText: text,
    kind: intent.kind,
    explicitOrgIds: semanticContext.explicitOrgIds,
    allStoresRequested: semanticContext.allStoresRequested,
    timeFrame,
    comparisonTimeFrame,
    phoneSuffix: intent.kind === "customer_profile" ? resolvePhoneSuffix(text) : undefined,
    metrics: semanticContext.metrics.supported,
    unsupportedMetrics: semanticContext.metrics.unsupported,
    rankingTarget: intent.rankingTarget,
    rankingOrder: intent.rankingOrder,
    mentionsCompareKeyword: intent.mentionsCompareKeyword,
    mentionsRankingKeyword: intent.mentionsRankingKeyword,
    mentionsTrendKeyword: intent.mentionsTrendKeyword,
    mentionsAnomalyKeyword: intent.mentionsAnomalyKeyword,
    mentionsRiskKeyword: intent.mentionsRiskKeyword,
    mentionsAdviceKeyword: intent.mentionsAdviceKeyword,
    mentionsReportKeyword: intent.mentionsReportKeyword,
    routeConfidence: intent.confidence,
    requiresClarification: intent.requiresClarification,
    clarificationReason: intent.clarificationReason,
    semanticSlots: {
      ...semanticContext.semanticSlots,
      time: timeSlot,
    },
  };
}
