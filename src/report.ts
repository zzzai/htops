import { evaluateStoreBusinessScore } from "./business-score.js";
import { rebuildCustomerIntelligenceForBizDate } from "./customer-intelligence.js";
import { computeDailyStoreMetrics } from "./metrics.js";
import { HetangOpsStore } from "./store.js";
import {
  buildStoreManagerDailyDetail,
  renderStoreManagerDailyReport,
} from "./store-manager-daily-detail.js";
import {
  type DailyStoreReport,
  type DailyStoreMetrics,
  type HetangOpsConfig,
  type StoreReview7dRow,
  type StoreSummary30dRow,
} from "./types.js";

function formatCurrency(value: number): string {
  return `${value.toFixed(2)} 元`;
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0+$/u, "").replace(/(\.\d*[1-9])0+$/u, "$1");
}

function formatCompactCurrency(value: number): string {
  if (Math.abs(value) >= 10_000) {
    return `${trimTrailingZero((value / 10_000).toFixed(2))}万`;
  }
  return `${trimTrailingZero(value.toFixed(0))}元`;
}

function formatCompactCount(value: number): string {
  return trimTrailingZero(value.toFixed(0));
}

function formatCompactPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return `${trimTrailingZero((value * 100).toFixed(1))}%`;
}

function formatCompactPercentOptional(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return `${trimTrailingZero((value * 100).toFixed(1))}%`;
}

function formatCompactRatio(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return trimTrailingZero(value.toFixed(2));
}

function formatCompactRatioOptional(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return trimTrailingZero(value.toFixed(2));
}

function formatCompactMonths(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return `${trimTrailingZero(value.toFixed(1))}个月`;
}

function formatCompactMonthsOptional(value: number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return `${trimTrailingZero(value.toFixed(1))}个月`;
}

function formatSignedPercentChange(current: number | null | undefined, previous: number | null | undefined) {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    previous <= 0
  ) {
    return null;
  }
  const delta = ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 0.05) {
    return "持平";
  }
  return `${delta >= 0 ? "+" : ""}${trimTrailingZero(delta.toFixed(1))}%`;
}

function formatSignedPercentPointChange(
  current: number | null | undefined,
  previous: number | null | undefined,
) {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
  ) {
    return null;
  }
  const delta = (current - previous) * 100;
  if (Math.abs(delta) < 0.05) {
    return "持平";
  }
  return `${delta >= 0 ? "+" : ""}${trimTrailingZero(delta.toFixed(1))}pp`;
}

function formatSignedCompactCurrencyChange(current: number | null | undefined, previous: number | null | undefined) {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
  ) {
    return null;
  }
  const delta = current - previous;
  if (Math.abs(delta) < 0.5) {
    return "持平";
  }
  return `${delta >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(delta))}`;
}

function resolvePercentDelta(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    previous <= 0
  ) {
    return null;
  }
  return (current - previous) / previous;
}

function hasReliableMemberRiskSignal(params: {
  summary30d?: StoreSummary30dRow | null;
  report: DailyStoreReport;
}): boolean {
  const repurchaseBase =
    params.summary30d?.memberRepurchaseBaseCustomerCount7d ??
    params.report.metrics.memberRepurchaseBaseCustomerCount7d ??
    0;
  const repurchaseReturned =
    params.summary30d?.memberRepurchaseReturnedCustomerCount7d ??
    params.report.metrics.memberRepurchaseReturnedCustomerCount7d ??
    0;
  const repurchaseRate =
    params.summary30d?.memberRepurchaseRate7d ??
    params.report.metrics.memberRepurchaseRate7d;
  const sleepingRate =
    params.summary30d?.sleepingMemberRate ??
    params.report.metrics.sleepingMemberRate;

  if (repurchaseBase >= 12 || repurchaseReturned > 0) {
    return true;
  }
  if ((repurchaseRate ?? 0) > 0) {
    return true;
  }
  if ((sleepingRate ?? 0) >= 0.12) {
    return true;
  }
  return false;
}

function appendSection(lines: string[], title: string, sectionLines: string[]): void {
  if (sectionLines.length === 0) {
    return;
  }
  lines.push("", title, ...sectionLines);
}

function renderAlerts(report: DailyStoreReport): string[] {
  if (report.alerts.length === 0) {
    return ["- 无重大异常，今日重点继续盯钟效、耗卡和技师产能。"];
  }
  return report.alerts.map((alert) => `- [${alert.severity}] ${alert.message}`);
}

function renderSuggestions(report: DailyStoreReport): string[] {
  return report.suggestions.map((suggestion, index) => `${index + 1}. ${suggestion}`);
}

function renderMarkdown(
  report: DailyStoreReport,
  detail: Awaited<ReturnType<typeof buildStoreManagerDailyDetail>>,
): string {
  return renderStoreManagerDailyReport({
    storeName: report.storeName,
    bizDate: report.bizDate,
    metrics: report.metrics,
    detail,
    alerts: report.alerts,
    suggestions: report.suggestions,
  });
}

async function enrichDailyMetricsWithWindowSignals(params: {
  store: HetangOpsStore;
  orgId: string;
  bizDate: string;
  metrics: DailyStoreMetrics;
}): Promise<DailyStoreMetrics> {
  let reviewRows: StoreReview7dRow[] = [];
  let summaryRows: StoreSummary30dRow[] = [];
  try {
    [reviewRows, summaryRows] = await Promise.all([
      params.store.listStoreReview7dByDateRange(params.orgId, params.bizDate, params.bizDate),
      params.store.listStoreSummary30dByDateRange(params.orgId, params.bizDate, params.bizDate),
    ]);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    if (code === "42P01") {
      return params.metrics;
    }
    throw error;
  }
  const review = reviewRows[0];
  const summary = summaryRows[0];
  const memberRepurchaseBase =
    review?.memberRepurchaseBaseCustomerCount7d ??
    summary?.memberRepurchaseBaseCustomerCount7d ??
    params.metrics.memberRepurchaseBaseCustomerCount7d;
  const memberRepurchaseReturned =
    review?.memberRepurchaseReturnedCustomerCount7d ??
    summary?.memberRepurchaseReturnedCustomerCount7d ??
    params.metrics.memberRepurchaseReturnedCustomerCount7d;
  const memberRepurchaseRate =
    review?.memberRepurchaseRate7d ??
    summary?.memberRepurchaseRate7d ??
    params.metrics.memberRepurchaseRate7d;

  return {
    ...params.metrics,
    memberRepurchaseBaseCustomerCount7d: memberRepurchaseBase,
    memberRepurchaseReturnedCustomerCount7d: memberRepurchaseReturned,
    memberRepurchaseRate7d: memberRepurchaseRate,
  };
}

function buildMiddayJudgment(params: {
  report: DailyStoreReport;
  review7d?: StoreMiddayWindow<StoreReview7dRow>;
  summary30d?: StoreMiddayWindow<StoreSummary30dRow>;
}) {
  const metrics = params.report.metrics;
  const currentReview = params.review7d?.current;
  const previousReview = params.review7d?.previous;
  const currentSummary = params.summary30d?.current;
  return evaluateStoreBusinessScore({
    revenueChange: resolvePercentDelta(currentReview?.revenue7d, previousReview?.revenue7d),
    clockEffectChange: resolvePercentDelta(currentReview?.clockEffect7d, previousReview?.clockEffect7d),
    groupbuy7dRevisitRate:
      currentReview?.groupbuy7dRevisitRate ??
      currentSummary?.groupbuy7dRevisitRate ??
      metrics.groupbuy7dRevisitRate,
    groupbuy7dStoredValueConversionRate:
      currentReview?.groupbuy7dStoredValueConversionRate ??
      currentSummary?.groupbuy7dStoredValueConversionRate ??
      metrics.groupbuy7dStoredValueConversionRate,
    groupbuyFirstOrderHighValueMemberRate:
      currentSummary?.groupbuyFirstOrderHighValueMemberRate ??
      currentReview?.groupbuyFirstOrderHighValueMemberRate ??
      metrics.groupbuyFirstOrderHighValueMemberRate,
    sleepingMemberRate: currentSummary?.sleepingMemberRate ?? metrics.sleepingMemberRate,
    pointClockRate:
      currentReview?.pointClockRate7d ?? currentSummary?.pointClockRate30d ?? metrics.pointClockRate,
    addClockRate:
      currentReview?.addClockRate7d ?? currentSummary?.addClockRate30d ?? metrics.addClockRate,
  });
}

function renderIncompleteMiddayBrief(report: DailyStoreReport): string {
  return [
    `# ${report.storeName} 昨日经营午报`,
    "",
    "口径：营业日按次日 03:00 截止。",
    "",
    "数据提醒：昨日同步还没完全闭环，当前不下正式经营判断。",
    ...renderAlerts(report),
  ].join("\n");
}

export type StoreMiddayWindow<T> = {
  current?: T | null;
  previous?: T | null;
};

export type StoreMiddayBriefContext = {
  review7d?: StoreMiddayWindow<StoreReview7dRow>;
  summary30d?: StoreMiddayWindow<StoreSummary30dRow>;
};

function resolveMiddayHeadline(params: {
  report: DailyStoreReport;
  review7d?: StoreMiddayWindow<StoreReview7dRow>;
  summary30d?: StoreMiddayWindow<StoreSummary30dRow>;
}): string {
  const judgment = buildMiddayJudgment(params);
  const headlineTags = judgment.tags.filter(
    (tag) => tag !== "基本盘稳" && tag !== "基本盘稳且转化在线",
  );
  if (headlineTags.length === 0) {
    return judgment.levelLabel;
  }
  return `${judgment.levelLabel}，${headlineTags.slice(0, 2).join("，")}`;
}

function renderDailyCloseSection(report: DailyStoreReport): string[] {
  const metrics = report.metrics;
  return [
    `- 营收 ${formatCompactCurrency(metrics.serviceRevenue)} | ${formatCompactCount(metrics.serviceOrderCount)}单 | ${formatCompactCount(metrics.totalClockCount)}钟 | 钟效 ${formatCompactCurrency(metrics.clockEffect)}/钟 | 点钟率 ${formatCompactPercent(metrics.pointClockRate)} | 加钟率 ${formatCompactPercent(metrics.addClockRate)}`,
  ];
}

function renderReview7dSection(params: {
  report: DailyStoreReport;
  review7d?: StoreMiddayWindow<StoreReview7dRow>;
}): string[] {
  const current = params.review7d?.current;
  const previous = params.review7d?.previous;
  const lines: string[] = [];

  if (current) {
    const revenueDelta = formatSignedPercentChange(current.revenue7d, previous?.revenue7d);
    lines.push(
      `- 营收 ${formatCompactCurrency(current.revenue7d)}${revenueDelta ? `，较前7天 ${revenueDelta}` : ""}`,
    );

    const handoffBits: string[] = [];
    const revisit = formatCompactPercentOptional(current.groupbuy7dRevisitRate);
    if (revisit) {
      const delta = formatSignedPercentPointChange(
        current.groupbuy7dRevisitRate,
        previous?.groupbuy7dRevisitRate,
      );
      handoffBits.push(`7天复到店 ${revisit}${delta ? `（较前7天 ${delta}）` : ""}`);
    }
    const stored = formatCompactPercentOptional(current.groupbuy7dStoredValueConversionRate);
    if (stored) {
      const delta = formatSignedPercentPointChange(
        current.groupbuy7dStoredValueConversionRate,
        previous?.groupbuy7dStoredValueConversionRate,
      );
      handoffBits.push(`7天储值转化 ${stored}${delta ? `（较前7天 ${delta}）` : ""}`);
    }
    if (handoffBits.length > 0) {
      lines.push(`- ${handoffBits.join(" | ")}`);
    }

    const addClock = formatCompactPercentOptional(current.addClockRate7d);
    if (addClock) {
      const delta = formatSignedPercentPointChange(current.addClockRate7d, previous?.addClockRate7d);
      lines.push(`- 加钟率 ${addClock}${delta ? `（较前7天 ${delta}）` : ""}`);
    }

    return lines;
  }

  const fallbackBits: string[] = [];
  const fallbackRevisit = formatCompactPercentOptional(params.report.metrics.groupbuy7dRevisitRate);
  if (fallbackRevisit) {
    fallbackBits.push(`7天复到店 ${fallbackRevisit}`);
  }
  const fallbackStored = formatCompactPercentOptional(
    params.report.metrics.groupbuy7dStoredValueConversionRate,
  );
  if (fallbackStored) {
    fallbackBits.push(`7天储值转化 ${fallbackStored}`);
  }
  const fallbackAddClock = formatCompactPercentOptional(params.report.metrics.addClockRate);
  if (fallbackAddClock) {
    fallbackBits.push(`当前加钟率 ${fallbackAddClock}`);
  }
  if (fallbackBits.length > 0) {
    lines.push(`- ${fallbackBits.join(" | ")}`);
  }

  return lines;
}

function renderSummary30dSection(params: {
  report: DailyStoreReport;
  summary30d?: StoreMiddayWindow<StoreSummary30dRow>;
}): string[] {
  const current = params.summary30d?.current;
  const previous = params.summary30d?.previous;
  const lines: string[] = [];

  if (current) {
    const memberBits: string[] = [];
    const repurchase = formatCompactPercentOptional(current.memberRepurchaseRate7d);
    if (repurchase) {
      const delta = formatSignedPercentPointChange(
        current.memberRepurchaseRate7d,
        previous?.memberRepurchaseRate7d,
      );
      memberBits.push(`会员7日复购 ${repurchase}${delta ? `（较上周期 ${delta}）` : ""}`);
    }
    const sleeping = formatCompactPercentOptional(current.sleepingMemberRate);
    if (sleeping) {
      const delta = formatSignedPercentPointChange(
        current.sleepingMemberRate,
        previous?.sleepingMemberRate,
      );
      memberBits.push(`沉默会员占比 ${sleeping}${delta ? `（较上周期 ${delta}）` : ""}`);
    }
    if (memberBits.length > 0) {
      lines.push(`- ${memberBits.join(" | ")}`);
    }

    const renewalBits: string[] = [
      `近30天充值 ${formatCompactCurrency(current.rechargeCash30d)}`,
      `耗卡 ${formatCompactCurrency(current.storedConsumeAmount30d)}`,
    ];
    const pressure = formatCompactRatioOptional(current.renewalPressureIndex30d);
    if (pressure) {
      renewalBits.push(`续费压力 ${pressure}`);
    }
    if (renewalBits.length > 0) {
      lines.push(`- ${renewalBits.join(" | ")}`);
    }

    const balanceDelta = formatSignedCompactCurrencyChange(
      current.currentStoredBalance,
      previous?.currentStoredBalance,
    );
    lines.push(
      `- 当前储值余额 ${formatCompactCurrency(current.currentStoredBalance)}${balanceDelta ? `，较上周期 ${balanceDelta}` : ""}`,
    );
    return lines;
  }

  const metrics = params.report.metrics;
  const hasDedicated30dSignal =
    metrics.memberRepurchaseRate7d !== undefined ||
    metrics.storedBalanceLifeMonths !== undefined ||
    metrics.renewalPressureIndex30d !== undefined;
  if (!hasDedicated30dSignal) {
    return lines;
  }
  const fallbackMemberBits: string[] = [];
  const repurchase = formatCompactPercentOptional(metrics.memberRepurchaseRate7d);
  if (repurchase) {
    fallbackMemberBits.push(`会员7日复购 ${repurchase}`);
  }
  const sleeping = formatCompactPercentOptional(metrics.sleepingMemberRate);
  if (sleeping) {
    fallbackMemberBits.push(`沉默会员占比 ${sleeping}`);
  }
  if (fallbackMemberBits.length > 0) {
    lines.push(`- ${fallbackMemberBits.join(" | ")}`);
  }

  const fallbackRiskBits: string[] = [];
  const storedLife = formatCompactMonthsOptional(metrics.storedBalanceLifeMonths);
  if (storedLife) {
    fallbackRiskBits.push(`储值寿命 ${storedLife}`);
  }
  const pressure = formatCompactRatioOptional(metrics.renewalPressureIndex30d);
  if (pressure) {
    fallbackRiskBits.push(`续费压力 ${pressure}`);
  }
  if (metrics.currentStoredBalance > 0) {
    fallbackRiskBits.push(`当前储值余额 ${formatCompactCurrency(metrics.currentStoredBalance)}`);
  }
  if (fallbackRiskBits.length > 0) {
    lines.push(`- ${fallbackRiskBits.join(" | ")}`);
  }

  return lines;
}

function renderMiddayActions(params: {
  report: DailyStoreReport;
  review7d?: StoreMiddayWindow<StoreReview7dRow>;
  summary30d?: StoreMiddayWindow<StoreSummary30dRow>;
}): string[] {
  const metrics = params.report.metrics;
  const currentReview = params.review7d?.current;
  const previousReview = params.review7d?.previous;
  const currentSummary = params.summary30d?.current;
  const previousSummary = params.summary30d?.previous;
  const candidates: Array<{ key: string; score: number; text: string }> = [];
  const push = (key: string, score: number, text: string) => {
    if (!Number.isFinite(score) || score <= 0) {
      return;
    }
    if (candidates.some((candidate) => candidate.key === key)) {
      return;
    }
    candidates.push({ key, score, text });
  };

  const revenueDelta = resolvePercentDelta(currentReview?.revenue7d, previousReview?.revenue7d);
  const revenueDeltaText = formatSignedPercentChange(currentReview?.revenue7d, previousReview?.revenue7d);
  if (revenueDelta !== null && revenueDeltaText) {
    if (revenueDelta <= -0.08) {
      push(
        "revenue-recovery",
        30 + Math.abs(revenueDelta) * 100,
        `店长先盯近7天营收较前7天 ${revenueDeltaText}的掉量时段和班次，客服今天优先补预约和老客回流。`,
      );
    } else if (revenueDelta >= 0.1) {
      push(
        "growth-replication",
        20 + revenueDelta * 60,
        `店长先复盘近7天营收较前7天 ${revenueDeltaText}的拉升班次，晚场把技师搭配和收口动作直接复制。`,
      );
    }
  }

  const renewalPressure = currentSummary?.renewalPressureIndex30d ?? metrics.renewalPressureIndex30d;
  const storedBalanceLife = currentSummary?.storedBalanceLifeMonths ?? metrics.storedBalanceLifeMonths;
  if (renewalPressure !== null && renewalPressure !== undefined && renewalPressure >= 1.25) {
    push(
      "renewal-pressure",
      18 + (renewalPressure - 1.25) * 40 + (storedBalanceLife !== undefined && storedBalanceLife !== null && storedBalanceLife < 3 ? 4 : 0),
      `客服和前台先盯近30天续费压力 ${formatCompactRatio(renewalPressure)}，把高耗卡高余额会员拉名单，今天优先做续费收口。`,
    );
  }

  const hasMemberRiskSignal = hasReliableMemberRiskSignal({
    summary30d: currentSummary,
    report: params.report,
  });
  const memberRepurchaseRate = currentSummary?.memberRepurchaseRate7d ?? metrics.memberRepurchaseRate7d;
  if (
    hasMemberRiskSignal &&
    memberRepurchaseRate !== null &&
    memberRepurchaseRate !== undefined &&
    memberRepurchaseRate > 0 &&
    memberRepurchaseRate < 0.45
  ) {
    push(
      "member-repurchase",
      14 + (0.45 - memberRepurchaseRate) * 80,
      `客服今天先抓会员7日复购只有 ${formatCompactPercent(memberRepurchaseRate)}的老会员回流，回访名单按A/B两档分开打。`,
    );
  }

  const sleepingMemberRate = currentSummary?.sleepingMemberRate ?? metrics.sleepingMemberRate;
  const sleepingMemberRatePrevious = previousSummary?.sleepingMemberRate;
  if (
    hasMemberRiskSignal &&
    sleepingMemberRate !== null &&
    sleepingMemberRate !== undefined &&
    sleepingMemberRate >= 0.15
  ) {
    const sleepingDeltaText = formatSignedPercentPointChange(
      sleepingMemberRate,
      sleepingMemberRatePrevious,
    );
    push(
      "sleeping-members",
      16 + sleepingMemberRate * 40,
      `客服先把沉默会员占比 ${formatCompactPercent(sleepingMemberRate)}${sleepingDeltaText ? `（较上周期 ${sleepingDeltaText}）` : ""}的高价值待唤回名单拉出来，今天至少完成一轮人工回访。`,
    );
  }

  const revisitRate = currentReview?.groupbuy7dRevisitRate ?? metrics.groupbuy7dRevisitRate;
  if (revisitRate !== null && revisitRate !== undefined && revisitRate < 0.6) {
    push(
      "groupbuy-revisit",
      16 + (0.6 - revisitRate) * 80,
      `客服先盯7天复到店只有 ${formatCompactPercent(revisitRate)}的首单团购客，今天逐个约回，前台到店后继续收口。`,
    );
  }

  const storedValueConversionRate =
    currentReview?.groupbuy7dStoredValueConversionRate ??
    metrics.groupbuy7dStoredValueConversionRate;
  if (
    storedValueConversionRate !== null &&
    storedValueConversionRate !== undefined &&
    storedValueConversionRate < 0.12
  ) {
    push(
      "groupbuy-stored",
      16 + (0.12 - storedValueConversionRate) * 100 + (revisitRate !== null && revisitRate !== undefined && revisitRate >= 0.75 ? 6 : 0),
      `前台先盯7天储值转化只有 ${formatCompactPercent(storedValueConversionRate)}的已复到店顾客，今天逐个做储值收口。`,
    );
  }

  const pointClockRate = metrics.pointClockRate;
  if (pointClockRate !== null && pointClockRate !== undefined && pointClockRate < 0.45) {
    const pointScore =
      pointClockRate < 0.18
        ? 34 + (0.18 - pointClockRate) * 120
        : pointClockRate < 0.3
          ? 28 + (0.3 - pointClockRate) * 80
          : 12 + (0.45 - pointClockRate) * 40;
    push(
      "point-clock",
      pointScore,
      `店长和前台先盯点钟率只有 ${formatCompactPercent(pointClockRate)}的问题，今天高峰班把指定技师推荐和排钟承接做硬。`,
    );
  }

  const addClockRate = metrics.addClockRate;
  if (addClockRate !== null && addClockRate !== undefined && addClockRate < 0.25) {
    const addClockScore =
      addClockRate < 0.08
        ? 36 + (0.08 - addClockRate) * 160
        : addClockRate < 0.15
          ? 24 + (0.15 - addClockRate) * 100
          : 10 + (0.25 - addClockRate) * 40;
    push(
      "add-clock",
      addClockScore,
      `店长今天先盯加钟率只有 ${formatCompactPercent(addClockRate)}的问题，晚场统一加钟话术，重点抓服务后半程的二次成交。`,
    );
  }

  if (candidates.length === 0) {
    const judgment = buildMiddayJudgment(params);
    push("fallback-priority", 2, `店长先抓：${judgment.actionPriority}`);
    push("fallback-copy", 1, "店长复盘昨天高客单与高加钟技师的打法，今天先复制到晚场。");
  }

  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry, index) => `${index + 1}. ${entry.text}`);
}

export function renderStoreMiddayBrief(
  report: DailyStoreReport,
  context: StoreMiddayBriefContext = {},
): string {
  if (!report.complete) {
    return renderIncompleteMiddayBrief(report);
  }

  const lines = [
    `# ${report.storeName} 昨日经营午报`,
    "",
    "口径：营业日按次日 03:00 截止。",
    "",
    "一句话判断",
    `- ${resolveMiddayHeadline({
      report,
      review7d: context.review7d,
      summary30d: context.summary30d,
    })}`,
  ];

  appendSection(lines, "昨日收盘", renderDailyCloseSection(report));
  appendSection(
    lines,
    "近7天变化",
    renderReview7dSection({ report, review7d: context.review7d }),
  );
  appendSection(
    lines,
    "近30天会员与储值风险",
    renderSummary30dSection({ report, summary30d: context.summary30d }),
  );
  appendSection(
    lines,
    "今日先抓",
    renderMiddayActions({
      report,
      review7d: context.review7d,
      summary30d: context.summary30d,
    }),
  );

  return lines.join("\n");
}

export async function buildDailyStoreReport(params: {
  config: HetangOpsConfig;
  store: HetangOpsStore;
  orgId: string;
  bizDate: string;
}): Promise<DailyStoreReport> {
  const computed = await computeDailyStoreMetrics(params);
  const metrics = await enrichDailyMetricsWithWindowSignals({
    store: params.store,
    orgId: params.orgId,
    bizDate: params.bizDate,
    metrics: computed.metrics,
  });
  const { alerts, suggestions } = computed;
  const report: DailyStoreReport = {
    orgId: params.orgId,
    storeName: metrics.storeName,
    bizDate: params.bizDate,
    metrics,
    alerts,
    suggestions,
    markdown: "",
    complete: !metrics.incompleteSync,
  };
  const detail = await buildStoreManagerDailyDetail({
    store: params.store,
    orgId: params.orgId,
    bizDate: params.bizDate,
    metrics,
  });
  report.markdown = renderMarkdown(report, detail);

  const generatedAt = new Date().toISOString();
  await Promise.all([
    params.store.saveDailyMetrics(metrics, generatedAt, { refreshViews: false }),
    params.store.replaceDailyAlerts(params.orgId, params.bizDate, alerts),
    params.store.saveDailyReport(report, generatedAt),
    rebuildCustomerIntelligenceForBizDate({
      store: params.store,
      orgId: params.orgId,
      bizDate: params.bizDate,
      updatedAt: generatedAt,
      refreshViews: false,
    }),
  ]);
  await params.store.forceRebuildAnalyticsViews();

  return report;
}
