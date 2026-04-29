import { evaluateStoreBusinessScore, type StoreBusinessSignal } from "./business-score.js";
import {
  describeUnsupportedMetricResolution,
  formatMetricValue,
  getMetricNumericValue,
  resolveMetricIntent,
  resolvePrimarySupportedMetric,
  type HetangSupportedMetricKey,
} from "./metric-query.js";
import type { QueryPlan } from "./query-plan.js";
import type { HetangQueryIntent, HetangQueryTimeFrame } from "./query-intent.js";
import {
  isExecutiveAnalysisLens,
  resolveAnalysisSignalLabel,
  type QueryAnalysisLens,
} from "./analysis-lens.js";
import type { StoreExternalContextAiPayload } from "./store-external-context.js";
import type {
  DailyStoreAlert,
  DailyStoreMetrics,
  DailyStoreReport,
  EnvironmentContextSnapshot,
  HetangOpsConfig,
  StoreManagerDailyKpiRow,
  TechLeaderboardRow,
} from "./types.js";

type StoreWindowSummary = {
  orgId: string;
  storeName: string;
  frame: HetangQueryTimeFrame;
  reports: DailyStoreReport[];
  metrics: DailyStoreMetrics;
  complete: boolean;
};

type AnalysisEnvironmentContext = Pick<
  EnvironmentContextSnapshot,
  | "bizDate"
  | "seasonTag"
  | "solarTerm"
  | "holidayTag"
  | "weatherTag"
  | "temperatureBand"
  | "postDinnerLeisureBias"
  | "eveningOutingLikelihood"
  | "badWeatherTouchPenalty"
  | "narrativePolicy"
>;

function readStoreExternalContextText(
  source: Record<string, unknown>,
  key: string,
): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStoreExternalContextNumber(
  source: Record<string, unknown>,
  key: string,
): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatChineseCountInWan(value: number): string {
  if (value >= 10_000) {
    return `${round(value / 10_000, 2).toFixed(2)}万`;
  }
  return `${round(value, 0).toFixed(0)}`;
}

function formatSolarTermLabel(solarTerm: EnvironmentContextSnapshot["solarTerm"]): string | null {
  switch (solarTerm) {
    case "xiaohan":
      return "小寒";
    case "dahan":
      return "大寒";
    case "lichun":
      return "立春";
    case "yushui":
      return "雨水";
    case "jingzhe":
      return "惊蛰";
    case "chunfen":
      return "春分";
    case "qingming":
      return "清明";
    case "guyu":
      return "谷雨";
    case "lixia":
      return "立夏";
    case "xiaoman":
      return "小满";
    case "mangzhong":
      return "芒种";
    case "xiazhi":
      return "夏至";
    case "xiaoshu":
      return "小暑";
    case "dashu":
      return "大暑";
    case "liqiu":
      return "立秋";
    case "chushu":
      return "处暑";
    case "bailu":
      return "白露";
    case "qiufen":
      return "秋分";
    case "hanlu":
      return "寒露";
    case "shuangjiang":
      return "霜降";
    case "lidong":
      return "立冬";
    case "xiaoxue":
      return "小雪";
    case "daxue":
      return "大雪";
    case "dongzhi":
      return "冬至";
    default:
      return null;
  }
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function percentDiff(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return current / previous - 1;
}

function formatPercentChange(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${value >= 0 ? "+" : ""}${round(value * 100, 1)}%`;
}

export function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

export function formatPercentValue(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${round(value * 100, 1).toFixed(1)}%`;
}

export function formatCount(value: number, digits = 1): string {
  return round(value, digits).toFixed(digits);
}

function resolveServingRiskReasons(row: Record<string, unknown>): string[] {
  const sleepingMemberRate = Number(row.sleeping_member_rate ?? NaN);
  const renewalPressureIndex30d = Number(row.renewal_pressure_index_30d ?? NaN);
  const memberRepurchaseRate7d = Number(row.member_repurchase_rate_7d ?? NaN);
  const candidates: Array<{ contribution: number; text: string }> = [];

  if (Number.isFinite(sleepingMemberRate)) {
    candidates.push({
      contribution: Math.max(sleepingMemberRate, 0) * 100,
      text: `沉默会员率 ${formatPercentValue(sleepingMemberRate)}`,
    });
  }
  if (Number.isFinite(memberRepurchaseRate7d)) {
    candidates.push({
      contribution: Math.max(1 - memberRepurchaseRate7d, 0) * 40,
      text: `会员7日复购率 ${formatPercentValue(memberRepurchaseRate7d)}`,
    });
  }
  if (Number.isFinite(renewalPressureIndex30d) && renewalPressureIndex30d > 1) {
    candidates.push({
      contribution: (renewalPressureIndex30d - 1) * 30,
      text: `续费压力 ${round(renewalPressureIndex30d, 2).toFixed(2)}`,
    });
  }

  return candidates
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 2)
    .map((entry) => entry.text);
}

function resolveServingRiskTopActionKind(
  row: Record<string, unknown>,
): "sleeping" | "repurchase" | "renewal" | "generic" {
  const sleepingMemberRate = Number(row.sleeping_member_rate ?? NaN);
  const renewalPressureIndex30d = Number(row.renewal_pressure_index_30d ?? NaN);
  const memberRepurchaseRate7d = Number(row.member_repurchase_rate_7d ?? NaN);

  if (Number.isFinite(sleepingMemberRate) && sleepingMemberRate >= 0.15) {
    return "sleeping";
  }
  if (Number.isFinite(memberRepurchaseRate7d) && memberRepurchaseRate7d < 0.45) {
    return "repurchase";
  }
  if (Number.isFinite(renewalPressureIndex30d) && renewalPressureIndex30d >= 1.5) {
    return "renewal";
  }
  return "generic";
}

function resolveServingRiskTopAction(row: Record<string, unknown>, storeName: string): string {
  switch (resolveServingRiskTopActionKind(row)) {
    case "sleeping":
      return `把 ${storeName} 沉默会员召回列成今日动作单，别让老会员盘继续变冷。`;
    case "repurchase":
      return `拉出 ${storeName} 上周到店会员名单，按熟客技师和储值层级做二次邀约。`;
    case "renewal":
      return `同步盯 ${storeName} 续费名单、耗卡节奏和到店唤醒，不要只看冲储金额。`;
    default:
      return `先对 ${storeName} 做一次周度经营复盘，确认当前风险是否只是短期波动。`;
  }
}

function renderChineseStoreCount(count: number): string {
  switch (count) {
    case 0:
      return "零";
    case 1:
      return "一";
    case 2:
      return "两";
    case 3:
      return "三";
    case 4:
      return "四";
    case 5:
      return "五";
    case 6:
      return "六";
    case 7:
      return "七";
    case 8:
      return "八";
    case 9:
      return "九";
    case 10:
      return "十";
    default:
      return String(count);
  }
}

function resolvePortfolioCohortLabel(params: {
  focusRows: Record<string, unknown>[];
  allRows: Record<string, unknown>[];
  resolveStoreName: (row: Record<string, unknown>) => string;
}): string | null {
  if (params.focusRows.length === 0) {
    return null;
  }
  if (params.focusRows.length === 1) {
    return params.resolveStoreName(params.focusRows[0] ?? {});
  }

  const focusOrgIds = new Set(
    params.focusRows
      .map((row) => String(row.org_id ?? row.store_name ?? ""))
      .filter((value) => value.length > 0),
  );
  if (params.focusRows.length === params.allRows.length) {
    return `${renderChineseStoreCount(params.focusRows.length)}店都`;
  }
  if (params.allRows.length - params.focusRows.length === 1) {
    const excludedRow = params.allRows.find(
      (row) => !focusOrgIds.has(String(row.org_id ?? row.store_name ?? "")),
    );
    if (excludedRow) {
      return `除${params.resolveStoreName(excludedRow)}外，其余${params.focusRows.length}店`;
    }
  }
  if (params.focusRows.length <= 3) {
    return params.focusRows.map((row) => params.resolveStoreName(row)).join("、");
  }
  const names = params.focusRows.slice(0, 3).map((row) => params.resolveStoreName(row));
  return `${names.join("、")}等${params.focusRows.length}店`;
}

function renderPortfolioFocusSentence(params: {
  subject: string | null;
  finding: string;
  action: string;
}): string | null {
  if (!params.subject) {
    return null;
  }
  const needsTightJoin = params.subject.includes("都") || params.subject.startsWith("除");
  return `${params.subject}${needsTightJoin ? "" : " "}${params.finding}，${params.action}`;
}

function renderPortfolioSignalPhrase(params: {
  subject: string | null;
  finding: string;
}): string | null {
  if (!params.subject) {
    return null;
  }
  if (params.subject.includes("都")) {
    return `${params.subject}存在${params.finding}问题`;
  }
  const needsTightJoin = params.subject.startsWith("除");
  return `${params.subject}${needsTightJoin ? "" : " "}${params.finding}`;
}

function isHqPortfolioScope(plan: QueryPlan): boolean {
  return (
    plan.scope.access_scope_kind === "hq" &&
    (plan.scope.scope_kind === "multi" || plan.scope.scope_kind === "all")
  );
}

function isBroadPortfolioRankingAsk(plan: QueryPlan, metric: string): boolean {
  if (plan.action !== "ranking" || metric !== "serviceRevenue") {
    return false;
  }
  if (!isHqPortfolioScope(plan)) {
    return false;
  }
  const text = plan.planner_meta.normalized_question;
  const hasBroadSignal = /(情况|整体|怎么样|如何|总览|全景|重点关注|先抓)/u.test(text);
  const hasNarrowSignal = /(排名|排行|最高|最低|top|倒数|最危险|风险排序)/iu.test(text);
  return hasBroadSignal && !hasNarrowSignal;
}

function isBroadPortfolioRiskFocusAsk(plan: QueryPlan, metric: string): boolean {
  if (plan.action !== "ranking" || metric !== "riskScore") {
    return false;
  }
  if (!isHqPortfolioScope(plan)) {
    return false;
  }
  const text = plan.planner_meta.normalized_question;
  const hasBroadSignal =
    /(重点看什么|该看什么|先看什么|看什么指标|重点抓什么|该抓什么|先抓什么|重点盯什么|先盯什么|盯什么)/u.test(
      text,
    );
  const hasNarrowSignal =
    /(哪家|哪个|哪几个|排名|排行|最高|最低|top|倒数|最危险|风险排序|重点关注|须重点关注|需要重点关注)/iu.test(
      text,
    );
  return hasBroadSignal && !hasNarrowSignal;
}

function renderBroadPortfolioRevenueRanking(params: {
  rows: Record<string, unknown>[];
  plan: QueryPlan;
  config: HetangOpsConfig;
}): string | null {
  if (params.rows.length === 0) {
    return null;
  }
  const rowsByRevenue = [...params.rows].sort((left, right) => {
    const leftRevenue = coerceFiniteNumber(left.service_revenue) ?? Number.NEGATIVE_INFINITY;
    const rightRevenue = coerceFiniteNumber(right.service_revenue) ?? Number.NEGATIVE_INFINITY;
    return rightRevenue - leftRevenue;
  });
  const totalRevenue = rowsByRevenue.reduce(
    (sum, row) => sum + (coerceFiniteNumber(row.service_revenue) ?? 0),
    0,
  );
  const topRevenueRow = rowsByRevenue[0] ?? null;
  const bottomRevenueRow = rowsByRevenue.at(-1) ?? null;
  const headTailGap =
    topRevenueRow && bottomRevenueRow
      ? Math.max(
          0,
          (coerceFiniteNumber(topRevenueRow.service_revenue) ?? 0) -
            (coerceFiniteNumber(bottomRevenueRow.service_revenue) ?? 0),
        )
      : 0;
  const focusRow = bottomRevenueRow;
  const countLabel = `${params.rows.length}店`;
  const windowLabel =
    params.plan.time.mode === "window"
      ? `近${params.plan.time.window_days ?? params.rows[0]?.window_days ?? ""}天`
      : String(params.rows[0]?.biz_date ?? params.plan.time.biz_date ?? "当前");
  const resolveStoreName = (row: Record<string, unknown>): string =>
    params.config.stores.find((entry) => entry.orgId === row.org_id)?.storeName ??
    String(row.store_name ?? row.org_id ?? "门店");
  const lines = [`${countLabel} ${windowLabel} 营收总览`];
  lines.push(
    `- 总营收 ${formatCurrency(totalRevenue)}；最高 ${resolveStoreName(topRevenueRow ?? {})} ${formatCurrency(
      coerceFiniteNumber(topRevenueRow?.service_revenue) ?? 0,
    )}；最低 ${resolveStoreName(bottomRevenueRow ?? {})} ${formatCurrency(
      coerceFiniteNumber(bottomRevenueRow?.service_revenue) ?? 0,
    )}；头尾差 ${formatCurrency(headTailGap)}。`,
  );
  lines.push("营收排名");
  rowsByRevenue.forEach((row, index) => {
    lines.push(
      `${index + 1}. ${resolveStoreName(row)} ${formatCurrency(coerceFiniteNumber(row.service_revenue) ?? 0)}`,
    );
  });
  if (focusRow) {
    const focusStoreName = resolveStoreName(focusRow);
    lines.push(`最该关注：${focusStoreName}`);
    lines.push(`- 原因：近7天营收最低，较头部门店少 ${formatCurrency(headTailGap)}。`);
    lines.push(`- 下周动作：先盯 ${focusStoreName} 的客流承接和客单放大，优先把营收缺口补回来。`);
  }
  return lines.join("\n");
}

function renderBroadPortfolioRiskFocus(params: {
  rows: Record<string, unknown>[];
  plan: QueryPlan;
  config: HetangOpsConfig;
}): string | null {
  if (params.rows.length === 0) {
    return null;
  }

  const rowsByRisk = [...params.rows].sort((left, right) => {
    const leftRisk = coerceFiniteNumber(left.risk_score ?? left.metric_value) ?? Number.NEGATIVE_INFINITY;
    const rightRisk = coerceFiniteNumber(right.risk_score ?? right.metric_value) ?? Number.NEGATIVE_INFINITY;
    return rightRisk - leftRisk;
  });
  const resolveStoreName = (row: Record<string, unknown>): string =>
    params.config.stores.find((entry) => entry.orgId === row.org_id)?.storeName ??
    String(row.store_name ?? row.org_id ?? "门店");
  const countLabel = `${params.rows.length}店`;
  const windowLabel =
    params.plan.time.mode === "window"
      ? `近${params.plan.time.window_days ?? params.rows[0]?.window_days ?? ""}天`
      : String(params.rows[0]?.biz_date ?? params.plan.time.biz_date ?? "当前");
  const topRiskRow = rowsByRisk[0] ?? null;
  const secondRiskRow = rowsByRisk[1] ?? null;
  const lowRepurchaseRows = rowsByRisk.filter((row) => {
    const value = coerceFiniteNumber(row.member_repurchase_rate_7d);
    return value !== null && value < 0.45;
  });
  const highSleepingRows = rowsByRisk.filter((row) => {
    const value = coerceFiniteNumber(row.sleeping_member_rate);
    return value !== null && value >= 0.15;
  });
  const highRenewalRows = rowsByRisk.filter((row) => {
    const value = coerceFiniteNumber(row.renewal_pressure_index_30d);
    return value !== null && value >= 1.2;
  });
  const topActionKind = topRiskRow ? resolveServingRiskTopActionKind(topRiskRow) : "generic";
  const lowRepurchaseActionRows =
    topActionKind === "repurchase"
      ? lowRepurchaseRows.filter((row) => row !== topRiskRow)
      : lowRepurchaseRows;
  const highSleepingActionRows =
    topActionKind === "sleeping" ? highSleepingRows.filter((row) => row !== topRiskRow) : highSleepingRows;
  const highRenewalActionRows =
    topActionKind === "renewal" ? highRenewalRows.filter((row) => row !== topRiskRow) : highRenewalRows;
  const sharedSignals: string[] = [];
  if (lowRepurchaseRows.length > 0) {
    const signal = renderPortfolioSignalPhrase({
      subject: resolvePortfolioCohortLabel({
        focusRows: lowRepurchaseRows,
        allRows: rowsByRisk,
        resolveStoreName,
      }),
      finding: "会员7日复购偏弱",
    });
    if (signal) {
      sharedSignals.push(signal);
    }
  }
  if (highSleepingRows.length > 0) {
    const signal = renderPortfolioSignalPhrase({
      subject: resolvePortfolioCohortLabel({
        focusRows: highSleepingRows,
        allRows: rowsByRisk,
        resolveStoreName,
      }),
      finding: "沉默会员占比偏高",
    });
    if (signal) {
      sharedSignals.push(signal);
    }
  }
  if (highRenewalRows.length > 0) {
    const signal = renderPortfolioSignalPhrase({
      subject: resolvePortfolioCohortLabel({
        focusRows: highRenewalRows,
        allRows: rowsByRisk,
        resolveStoreName,
      }),
      finding: "续费压力偏高",
    });
    if (signal) {
      sharedSignals.push(signal);
    }
  }

  const focusItems: string[] = [];
  if (topRiskRow) {
    focusItems.push(resolveServingRiskTopAction(topRiskRow, resolveStoreName(topRiskRow)));
  }
  const lowRepurchaseFocusItem = renderPortfolioFocusSentence({
    subject: resolvePortfolioCohortLabel({
      focusRows: lowRepurchaseActionRows,
      allRows: rowsByRisk,
      resolveStoreName,
    }),
    finding: "会员回流偏弱",
    action: "今天统一复盘上周到店会员名单，优先补齐未二次邀约客户。",
  });
  if (lowRepurchaseFocusItem) {
    focusItems.push(lowRepurchaseFocusItem);
  }
  const highSleepingFocusItem = renderPortfolioFocusSentence({
    subject: resolvePortfolioCohortLabel({
      focusRows: highSleepingActionRows,
      allRows: rowsByRisk,
      resolveStoreName,
    }),
    finding: "沉默会员占比偏高",
    action: "优先拉出高价值沉默会员名单，今天先做召回。",
  });
  if (highSleepingFocusItem) {
    focusItems.push(highSleepingFocusItem);
  }
  const highRenewalFocusItem = renderPortfolioFocusSentence({
    subject: resolvePortfolioCohortLabel({
      focusRows: highRenewalActionRows,
      allRows: rowsByRisk,
      resolveStoreName,
    }),
    finding: "续费压力偏高",
    action: "同步盯续费名单、耗卡节奏和到店唤醒，别只看冲储金额。",
  });
  if (highRenewalFocusItem) {
    focusItems.push(highRenewalFocusItem);
  }
  if (focusItems.length === 0) {
    focusItems.push("先盯头尾门店差异，确认问题是留存、续费还是短期波动。");
  }

  const averageTicketRows = rowsByRisk
    .map((row) => ({
      row,
      averageTicket: coerceFiniteNumber(row.average_ticket),
    }))
    .filter(
      (
        entry,
      ): entry is {
        row: Record<string, unknown>;
        averageTicket: number;
      } => entry.averageTicket !== null,
    )
    .sort((left, right) => right.averageTicket - left.averageTicket);
  const highestAverageTicket = averageTicketRows[0] ?? null;
  const lowestAverageTicket = averageTicketRows.at(-1) ?? null;
  const analysisLens = params.plan.analysis;
  const usesExecutiveLens =
    isExecutiveAnalysisLens(analysisLens) &&
    analysisLens.framework_id === "hq_growth_priority_v1";
  const executiveLens = usesExecutiveLens ? analysisLens : null;
  const lines = [`${countLabel} ${windowLabel} 当前重点看什么`];
  lines.push(`一、${executiveLens?.section_labels.summary ?? "结论摘要"}`);
  if (topRiskRow) {
    const topStoreName = resolveStoreName(topRiskRow);
    const topRiskScore = (coerceFiniteNumber(topRiskRow.risk_score ?? topRiskRow.metric_value) ?? 0)
      .toFixed(1);
    const topReasons = resolveServingRiskReasons(topRiskRow);
    const summaryParts = [
      `当前先盯 ${topStoreName}（风险分 ${topRiskScore}${topReasons.length > 0 ? `，${topReasons.join("、")}` : ""}）`,
    ];
    if (secondRiskRow) {
      const secondStoreName = resolveStoreName(secondRiskRow);
      const secondRiskScore = (
        coerceFiniteNumber(secondRiskRow.risk_score ?? secondRiskRow.metric_value) ?? 0
      ).toFixed(1);
      summaryParts.push(`第二关注 ${secondStoreName}（风险分 ${secondRiskScore}）`);
    }
    lines.push(`- ${summaryParts.join("；")}。`);
  }
  if (sharedSignals.length > 0) {
    lines.push(`- 共性信号：${sharedSignals.join("；")}。`);
  }
  if (executiveLens) {
    lines.push(`二、${executiveLens.section_labels.signals}`);
    lines.push(
      `1. ${resolveAnalysisSignalLabel(executiveLens, "retention", "先看留存")}：${
        renderPortfolioSignalPhrase({
          subject: resolvePortfolioCohortLabel({
            focusRows: lowRepurchaseRows,
            allRows: rowsByRisk,
            resolveStoreName,
          }),
          finding: "会员7日复购偏弱",
        }) ?? "当前未识别出明显留存异常。"
      }。`,
    );
    lines.push(
      `2. ${resolveAnalysisSignalLabel(executiveLens, "member_asset_health", "再看会员资产")}：${
        renderPortfolioSignalPhrase({
          subject: resolvePortfolioCohortLabel({
            focusRows: [...new Set([...highSleepingRows, ...highRenewalRows])],
            allRows: rowsByRisk,
            resolveStoreName,
          }),
          finding:
            highSleepingRows.length > 0 && highRenewalRows.length > 0
              ? "沉默会员占比偏高且续费压力偏高"
              : highSleepingRows.length > 0
                ? "沉默会员占比偏高"
                : highRenewalRows.length > 0
                  ? "续费压力偏高"
                  : "当前会员资产信号整体平稳"
        }) ?? "当前会员资产信号整体平稳"
      }。`,
    );
    if (highestAverageTicket && lowestAverageTicket) {
      lines.push(
        `3. ${resolveAnalysisSignalLabel(executiveLens, "unit_economics", "再看单客价值")}：${resolveStoreName(highestAverageTicket.row)} 客单价 ${formatCurrency(highestAverageTicket.averageTicket)} 最高，${resolveStoreName(lowestAverageTicket.row)} ${formatCurrency(lowestAverageTicket.averageTicket)} 最低；当前主矛盾仍是留存和会员资产，不只是客单价。`,
      );
    } else {
      lines.push(
        `3. ${resolveAnalysisSignalLabel(executiveLens, "unit_economics", "再看单客价值")}：当前快答缺少稳定的单客价值对比样本。`,
      );
    }
    lines.push(
      `4. ${resolveAnalysisSignalLabel(executiveLens, "conversion", "最后看拉新质量")}：当前快答未带出新客转化/团购承接链路，如要判断 CMO 侧拉新质量，需要继续下钻。`,
    );
    lines.push(`三、${executiveLens.section_labels.actions}`);
  } else {
    lines.push("二、重点事项");
  }
  focusItems.slice(0, 3).forEach((item, index) => {
    lines.push(`${index + 1}. ${item}`);
  });
  lines.push(`${
    executiveLens ? `四、${executiveLens.section_labels.ranking}` : "三、风险排序"
  }`);
  rowsByRisk.forEach((row, index) => {
    const storeName = resolveStoreName(row);
    const riskScore = (
      coerceFiniteNumber(row.risk_score ?? row.metric_value) ?? 0
    ).toFixed(1);
    lines.push(`${index + 1}. ${storeName} | 风险分 ${riskScore}`);
    const reasons = resolveServingRiskReasons(row);
    if (reasons.length > 0) {
      lines.push(`   原因：${reasons.join("、")}`);
    }
  });
  return lines.join("\n");
}

export function formatMetricDelta(
  metricKey: HetangSupportedMetricKey,
  delta: number | null,
): string {
  if (delta === null) {
    return "N/A";
  }
  switch (metricKey) {
    case "serviceRevenue":
    case "averageTicket":
    case "orderAverageAmount":
    case "memberPaymentAmount":
    case "cashPaymentAmount":
    case "wechatPaymentAmount":
    case "alipayPaymentAmount":
    case "storedConsumeAmount":
    case "rechargeCash":
    case "currentStoredBalance":
      return `${delta >= 0 ? "+" : ""}${round(delta, 2).toFixed(2)} 元`;
    case "clockEffect":
      return `${delta >= 0 ? "+" : ""}${round(delta, 2).toFixed(2)} 元/钟`;
    case "groupbuyOrderShare":
    case "groupbuyRevisitRate":
    case "groupbuyMemberPayConversionRate":
    case "groupbuy7dRevisitRate":
    case "groupbuy7dCardOpenedRate":
    case "groupbuy7dStoredValueConversionRate":
    case "groupbuy30dMemberPayConversionRate":
    case "groupbuyFirstOrderHighValueMemberRate":
    case "sleepingMemberRate":
    case "pointClockRate":
    case "addClockRate":
      return `${delta >= 0 ? "+" : ""}${round(delta * 100, 1).toFixed(1)}pct`;
    default:
      return `${delta >= 0 ? "+" : ""}${round(delta, 1).toFixed(1)}`;
  }
}

function resolveServingMetricLabel(metric: string): string {
  switch (metric) {
    case "serviceRevenue":
      return "服务营收";
    case "serviceOrderCount":
      return "服务单数";
    case "orderAverageAmount":
      return "单均金额";
    case "customerCount":
      return "消费人数";
    case "totalClockCount":
      return "总钟数";
    case "averageTicket":
      return "客单价";
    case "clockEffect":
      return "钟效";
    case "pointClockRate":
      return "点钟率";
    case "addClockRate":
      return "加钟率";
    case "riskScore":
      return "风险分";
    case "followupScore":
      return "跟进分";
    default:
      return metric;
  }
}

function coerceFiniteNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function deriveClockCountsFromServingSummaryRow(row: Record<string, unknown>): {
  pointClockCount: number | null;
  addClockCount: number | null;
} | null {
  const totalClocks = coerceFiniteNumber(row.total_clocks);
  const addClockRate = coerceFiniteNumber(row.add_clock_rate);
  if (totalClocks === null || totalClocks <= 0 || addClockRate === null || addClockRate < 0) {
    return null;
  }

  const upClockCount = totalClocks / (1 + addClockRate);
  if (!Number.isFinite(upClockCount) || upClockCount <= 0) {
    return null;
  }

  const pointClockRate = coerceFiniteNumber(row.point_clock_rate);
  const pointClockCount =
    pointClockRate === null || pointClockRate < 0 ? null : Math.max(Math.round(upClockCount * pointClockRate), 0);
  const addClockCount = Math.max(Math.round(totalClocks - upClockCount), 0);

  return {
    pointClockCount,
    addClockCount,
  };
}

export function renderServingQueryResult(params: {
  rows: Record<string, unknown>[];
  plan: QueryPlan;
  config: HetangOpsConfig;
}): string | null {
  const metric = params.plan.metrics[0] ?? "serviceRevenue";
  const metricLabel = resolveServingMetricLabel(metric);
  const resolveRowMetricValue = (row: Record<string, unknown>): unknown => {
    switch (metric) {
      case "serviceRevenue":
        return row.metric_value ?? row.service_revenue;
      case "serviceOrderCount":
        return row.metric_value ?? row.service_order_count;
      case "orderAverageAmount":
        return row.metric_value ?? row.order_average_amount;
      case "customerCount":
        return row.metric_value ?? row.customer_count;
      case "averageTicket":
        return row.metric_value ?? row.average_ticket;
      case "clockEffect":
        return row.metric_value ?? row.clock_effect;
      case "pointClockRate":
        return row.metric_value ?? row.point_clock_rate;
      case "addClockRate":
        return row.metric_value ?? row.add_clock_rate;
      case "riskScore":
        return row.metric_value ?? row.risk_score;
      case "followupScore":
        return row.metric_value ?? row.followup_score;
      case "totalClockCount":
        return row.metric_value ?? row.total_clocks;
      default:
        return row.metric_value;
    }
  };
  const resolveBaselineMetricValue = (row: Record<string, unknown>): unknown => {
    switch (metric) {
      case "serviceRevenue":
        return row.baseline_metric_value ?? row.baseline_service_revenue;
      case "serviceOrderCount":
        return row.baseline_metric_value ?? row.baseline_service_order_count;
      case "orderAverageAmount":
        return row.baseline_metric_value ?? row.baseline_order_average_amount;
      case "customerCount":
        return row.baseline_metric_value ?? row.baseline_customer_count;
      case "averageTicket":
        return row.baseline_metric_value ?? row.baseline_average_ticket;
      case "clockEffect":
        return row.baseline_metric_value ?? row.baseline_clock_effect;
      case "pointClockRate":
        return row.baseline_metric_value ?? row.baseline_point_clock_rate;
      case "addClockRate":
        return row.baseline_metric_value ?? row.baseline_add_clock_rate;
      case "riskScore":
        return row.baseline_metric_value ?? row.baseline_risk_score;
      case "followupScore":
        return row.baseline_metric_value ?? row.baseline_followup_score;
      case "totalClockCount":
        return row.baseline_metric_value ?? row.baseline_total_clocks;
      default:
        return row.baseline_metric_value;
    }
  };
  const renderMetricValue = (rawValue: unknown): string => {
    const numeric = typeof rawValue === "number" ? rawValue : Number(rawValue ?? 0);
    if (metric === "pointClockRate" || metric === "addClockRate") {
      return formatPercentValue(numeric);
    }
    if (metric === "serviceOrderCount") {
      return `${formatCount(numeric, 0)} 单`;
    }
    if (metric === "customerCount") {
      return `${formatCount(numeric, 0)} 人`;
    }
    if (metric === "totalClockCount") {
      return `${formatCount(numeric, 0)} 钟`;
    }
    if (metric === "clockEffect") {
      return `${round(numeric, 2).toFixed(2)} 元/钟`;
    }
    if (metric === "riskScore" || metric === "followupScore") {
      return round(numeric, 1).toFixed(1);
    }
    return formatCurrency(numeric);
  };
  const resolveRankingTitle = (): string =>
    metric === "riskScore" ? "风险排序" : `${metricLabel}排名`;
  const resolveStoreName = (row: Record<string, unknown>): string =>
    params.config.stores.find((entry) => entry.orgId === row.org_id)?.storeName ??
    String(row.store_name ?? row.org_id ?? "门店");
  const resolveSegmentLabel = (primarySegment: unknown): string => {
    switch (String(primarySegment ?? "")) {
      case "important-reactivation-member":
        return "高价值待唤回";
      case "potential-growth-customer":
        return "潜力成长";
      case "groupbuy-retain-candidate":
        return "团购留存";
      case "important-value-member":
        return "重要价值会员";
      case "active-member":
        return "活跃会员";
      case "sleeping-customer":
        return "沉默客群";
      case "standard-customer":
        return "标准客群";
      default:
        return String(primarySegment ?? "未分层");
    }
  };
  const resolveBaselineStoreName = (row: Record<string, unknown>): string | null => {
    const baselineOrgId =
      typeof row.baseline_org_id === "string" ? row.baseline_org_id : undefined;
    const baselineStoreName =
      typeof row.baseline_store_name === "string" ? row.baseline_store_name : undefined;
    if (baselineStoreName) {
      return baselineStoreName;
    }
    if (baselineOrgId) {
      return (
        params.config.stores.find((entry) => entry.orgId === baselineOrgId)?.storeName ?? baselineOrgId
      );
    }
    return null;
  };

  if (params.plan.entity === "store") {
    if (params.plan.action === "breakdown") {
      if (params.rows.length === 0) {
        return null;
      }
      const [row] = params.rows;
      const storeName = resolveStoreName(row);
      const bizDate = String(row.biz_date ?? params.plan.time.biz_date ?? "当日");
      const totalClocks = Number(row.total_clocks ?? 0);
      const assignClocks = Number(row.assign_clocks ?? row.point_clock_record_count ?? 0);
      const queueClocks = Number(
        row.queue_clocks ??
          Math.max(
            totalClocks - assignClocks - Number(row.add_clock_count ?? row.add_clock_record_count ?? 0),
            0,
          ),
      );
      const addClocks = Number(row.add_clock_count ?? row.add_clock_record_count ?? 0);
      return [
        `${storeName} ${bizDate} 钟数构成`,
        `- 总钟数: ${formatCount(totalClocks)} 个`,
        `- 点钟: ${formatCount(assignClocks)} 个`,
        `- 排钟: ${formatCount(queueClocks)} 个`,
        `- 加钟: ${formatCount(addClocks)} 个`,
      ].join("\n");
    }

    if (params.plan.action === "ranking") {
    if (params.rows.length === 0) {
      return null;
    }
    if (isBroadPortfolioRankingAsk(params.plan, metric)) {
      return renderBroadPortfolioRevenueRanking(params);
    }
    const countLabel = `${params.rows.length}店`;
    const windowLabel =
      params.plan.time.mode === "window"
          ? `近${params.plan.time.window_days ?? params.rows[0]?.window_days ?? ""}天`
          : String(params.rows[0]?.biz_date ?? params.plan.time.biz_date ?? "当前");
      const lines = [`${countLabel} ${windowLabel} ${resolveRankingTitle()}`];
      params.rows.forEach((row, index) => {
        const storeName = resolveStoreName(row);
        lines.push(
          `${index + 1}. ${storeName} | ${metricLabel} ${renderMetricValue(resolveRowMetricValue(row))}`,
        );
        if (metric === "riskScore") {
          const reasons = resolveServingRiskReasons(row);
          if (reasons.length > 0) {
            lines.push(`   原因：${reasons.join("、")}`);
          }
        }
      });
      return lines.join("\n");
    }

    if (params.plan.action === "compare") {
      if (params.rows.length === 0) {
        return null;
      }
      const [row] = params.rows;
      const storeName = resolveStoreName(row);
      const baselineStoreName = resolveBaselineStoreName(row);
      const currentValue = resolveRowMetricValue(row);
      const baselineValue = resolveBaselineMetricValue(row);
      if (currentValue === undefined || currentValue === null || baselineValue === undefined || baselineValue === null) {
        return null;
      }
      const currentNumeric = typeof currentValue === "number" ? currentValue : Number(currentValue);
      const baselineNumeric =
        typeof baselineValue === "number" ? baselineValue : Number(baselineValue);
      if (!Number.isFinite(currentNumeric) || !Number.isFinite(baselineNumeric)) {
        return null;
      }
      const currentLabel =
        params.plan.compare?.baseline === "peer_group" && baselineStoreName
          ? storeName
          : params.plan.time.mode === "window"
            ? `近${params.plan.time.window_days ?? row.window_days ?? ""}天`
            : String(params.plan.time.biz_date ?? row.biz_date ?? "当前");
      const baselineLabel =
        params.plan.compare?.baseline === "peer_group" && baselineStoreName
          ? baselineStoreName
          : params.plan.compare?.label ??
            (params.plan.compare?.baseline === "previous_window"
              ? `前${params.plan.compare.window_days ?? row.baseline_window_days ?? ""}天`
              : params.plan.compare?.baseline === "previous_day"
                ? "上一日"
                : "对比期");
      const delta = round(currentNumeric - baselineNumeric, 4);
      return [
        params.plan.compare?.baseline === "peer_group" && baselineStoreName
          ? `${storeName} vs ${baselineStoreName}`
          : `${storeName} ${currentLabel} vs ${baselineLabel}`,
        `- ${metricLabel}: ${currentLabel} ${renderMetricValue(currentValue)}；${baselineLabel} ${renderMetricValue(baselineValue)}；差额 ${formatMetricDelta(metric as HetangSupportedMetricKey, delta)}`,
      ].join("\n");
    }

    if (params.plan.action === "summary") {
      if (params.rows.length === 0) {
        return null;
      }
      const [row] = params.rows;
      const storeName = resolveStoreName(row);
      const dateLabel =
        params.plan.time.mode === "day"
          ? (row.biz_date as string | undefined) ?? params.plan.time.biz_date ?? "当日"
          : params.plan.time.mode === "window"
            ? `近${params.plan.time.window_days ?? row.window_days ?? ""}天`
            : params.plan.time.as_of_biz_date ?? "当前";
      const lines = [`${storeName} ${dateLabel}`];
      if (metric === "pointClockRate" || metric === "addClockRate") {
        const derivedClockCounts = deriveClockCountsFromServingSummaryRow(row);
        const pointClockCount = derivedClockCounts?.pointClockCount;
        const addClockCount = derivedClockCounts?.addClockCount;
        if (metric === "pointClockRate" && pointClockCount !== null && pointClockCount !== undefined) {
          lines.push(`- 点钟数量: ${formatCount(pointClockCount, 0)} 个`);
        }
        if (metric === "addClockRate" && addClockCount !== null && addClockCount !== undefined) {
          lines.push(`- 加钟数量: ${formatCount(addClockCount, 0)} 个`);
        }
      }
      lines.push(`- ${metricLabel}: ${renderMetricValue(resolveRowMetricValue(row))}`);
      return lines.join("\n");
    }

    if (params.plan.action === "trend") {
      if (params.rows.length === 0) {
        return null;
      }
      const storeName =
        params.config.stores.find((entry) => entry.orgId === params.rows[0]?.org_id)?.storeName ??
        String(params.rows[0]?.store_name ?? params.rows[0]?.org_id ?? "门店");
      const lines = [`${storeName} ${metricLabel}趋势`];
      params.rows.forEach((row) => {
        lines.push(`${String(row.biz_date ?? "")}: ${renderMetricValue(row.metric_value)}`);
      });
      return lines.join("\n");
    }
  }

  if (params.plan.entity === "hq" && params.plan.action === "ranking") {
    if (params.rows.length === 0) {
      return null;
    }
    if (isBroadPortfolioRiskFocusAsk(params.plan, metric)) {
      return renderBroadPortfolioRiskFocus(params);
    }
    const countLabel = `${params.rows.length}店`;
    const windowLabel =
      params.plan.time.mode === "window"
        ? `近${params.plan.time.window_days ?? params.rows[0]?.window_days ?? ""}天`
        : String(params.rows[0]?.biz_date ?? params.plan.time.biz_date ?? "当前");
    const lines = [`${countLabel} ${windowLabel} ${resolveRankingTitle()}`];
    params.rows.forEach((row, index) => {
      const storeName = resolveStoreName(row);
      lines.push(
        `${index + 1}. ${storeName} | ${metricLabel} ${renderMetricValue(resolveRowMetricValue(row))}`,
      );
      if (metric === "riskScore") {
        const reasons = resolveServingRiskReasons(row);
        if (reasons.length > 0) {
          lines.push(`   原因：${reasons.join("、")}`);
        }
        if (index === 0) {
          lines.push(`   总部先盯：${resolveServingRiskTopAction(row, storeName)}`);
        }
      }
    });
    return lines.join("\n");
  }

  if (params.plan.entity === "customer_profile" && params.plan.action === "profile") {
    if (params.rows.length === 0) {
      return "未找到对应顾客画像。";
    }
    const [row] = params.rows;
    const storeName = resolveStoreName(row);
    const phoneSuffix =
      String(
        row.phone_suffix ??
          params.plan.filters.find((filter) => filter.field === "phone_suffix")?.value ??
          "",
      ) || "未知";
    const identityStable =
      row.identity_stable === false || row.identity_stable === "false" ? false : true;
    return [
      `${storeName} 尾号 ${phoneSuffix} 顾客画像`,
      `- 顾客: ${String(row.customer_display_name ?? "未知顾客")}`,
      `- 近90天消费: ${formatCurrency(Number(row.pay_amount_90d ?? 0))}`,
      `- 当前储值余额: ${formatCurrency(Number(row.current_stored_amount ?? 0))}`,
      `- 主要分层: ${resolveSegmentLabel(row.primary_segment)}`,
      identityStable
        ? `- 主要技师: ${String(row.top_tech_name ?? "未知")}`
        : "- 主要技师辅助信息: 已收紧（身份未稳定）",
      `- 跟进分 / 风险分: ${Number(row.followup_score ?? 0).toFixed(1)} / ${Number(row.risk_score ?? 0).toFixed(1)}`,
    ].join("\n");
  }

  if (params.plan.entity === "customer_profile" && params.plan.action === "list") {
    const primarySegment = params.plan.filters.find(
      (filter) => filter.field === "primary_segment",
    )?.value;
    if (primarySegment !== undefined) {
      if (
        params.plan.response_shape === "ranking_list" &&
        params.plan.dimensions.includes("tech")
      ) {
        const [firstRow] = params.rows;
        const storeName = firstRow
          ? resolveStoreName(firstRow)
          : params.config.stores.find((entry) => entry.orgId === params.plan.scope.org_ids[0])?.storeName ??
            String(params.plan.scope.org_ids[0] ?? "门店");
        const asOfBizDate = String(
          firstRow?.as_of_biz_date ?? params.plan.time.as_of_biz_date ?? "当前",
        );
        const titleSegmentLabel =
          primarySegment === "sleeping-customer"
            ? "沉睡会员"
            : primarySegment === "important-value-member"
              ? "重要价值会员"
              : primarySegment === "important-reactivation-member"
                ? "重要唤回会员"
                : primarySegment === "potential-growth-customer"
                  ? "潜力发展客户"
                  : primarySegment === "groupbuy-retain-candidate"
                    ? "团购留存候选"
                    : resolveSegmentLabel(primarySegment);
        const lines = [`${storeName} ${asOfBizDate} ${titleSegmentLabel}绑定技师排名`];
        if (params.rows.length === 0) {
          lines.push("- 当前没有可统计的绑定技师。");
          return lines.join("\n");
        }
        params.rows.forEach((row, index) => {
          lines.push(
            `${index + 1}. ${String(row.tech_name ?? row.top_tech_name ?? "未知技师")} ${Number(row.customer_count ?? 0)} 位`,
          );
        });
        return lines.join("\n");
      }
      if (params.plan.response_shape === "scalar") {
        const [row] = params.rows;
        const storeName = row
          ? resolveStoreName(row)
          : params.config.stores.find((entry) => entry.orgId === params.plan.scope.org_ids[0])?.storeName ??
            String(params.plan.scope.org_ids[0] ?? "门店");
        const asOfBizDate = String(
          row?.as_of_biz_date ?? params.plan.time.as_of_biz_date ?? "当前",
        );
        const titleSegmentLabel =
          primarySegment === "sleeping-customer"
            ? "沉睡会员"
            : primarySegment === "important-value-member"
              ? "重要价值会员"
              : primarySegment === "important-reactivation-member"
                ? "重要唤回会员"
                : primarySegment === "potential-growth-customer"
                  ? "潜力发展客户"
                  : primarySegment === "groupbuy-retain-candidate"
                    ? "团购留存候选"
                    : resolveSegmentLabel(primarySegment);
        const customerCount = Number(row?.customer_count ?? 0);
        const loyalCount = Number(row?.single_tech_loyal_count ?? 0);
        const payAmount90dTotal = Number(row?.pay_amount_90d_total ?? 0);
        return [
          `${storeName} ${asOfBizDate} ${titleSegmentLabel} ${customerCount} 人`,
          `- 单技师忠诚客户: ${loyalCount} 人`,
          `- 近 90 天累计支付: ${formatCurrency(payAmount90dTotal)}`,
        ].join("\n");
      }
      const [firstRow] = params.rows;
      const storeName = firstRow
        ? resolveStoreName(firstRow)
        : params.config.stores.find((entry) => entry.orgId === params.plan.scope.org_ids[0])?.storeName ??
          String(params.plan.scope.org_ids[0] ?? "门店");
      const asOfBizDate = String(
        firstRow?.as_of_biz_date ?? params.plan.time.as_of_biz_date ?? "当前",
      );
      const titleSegmentLabel =
        primarySegment === "sleeping-customer"
          ? "沉睡会员"
          : primarySegment === "important-value-member"
            ? "重要价值会员"
            : primarySegment === "important-reactivation-member"
              ? "重要唤回会员"
              : primarySegment === "potential-growth-customer"
                ? "潜力发展客户"
                : primarySegment === "groupbuy-retain-candidate"
                  ? "团购留存候选"
                  : resolveSegmentLabel(primarySegment);
      const lines = [`${storeName} ${asOfBizDate} ${titleSegmentLabel}名单（共 ${params.rows.length} 人）`];
      if (params.rows.length === 0) {
        lines.push("- 当前没有符合条件的客户。");
        return lines.join("\n");
      }
      params.rows.forEach((row, index) => {
        const memberName = String(
          row.customer_display_name ?? row.member_name ?? row.customer_name ?? `客户${index + 1}`,
        );
        const payAmount90d = Number(row.pay_amount_90d ?? 0);
        const silentDays = Number(row.current_silent_days ?? 0);
        const identityStable =
          row.identity_stable === false || row.identity_stable === "false" ? false : true;
        const techSuffix =
          identityStable && row.top_tech_name
            ? ` | 主服务技师 ${String(row.top_tech_name)}`
            : "";
        lines.push(
          `${index + 1}. ${memberName} | 近90天支付 ${formatCurrency(payAmount90d)} | 当前沉默 ${silentDays} 天${techSuffix}`,
        );
      });
      return lines.join("\n");
    }

    if (params.rows.length === 0) {
      return "当前没有待跟进的会员。";
    }
    const [firstRow] = params.rows;
    const storeName = resolveStoreName(firstRow);
    const asOfBizDate = String(firstRow.as_of_biz_date ?? params.plan.time.as_of_biz_date ?? "当前");
    const lines = [`${storeName} ${asOfBizDate} 跟进名单`];
    params.rows.forEach((row, index) => {
      const memberName = String(row.customer_display_name ?? row.member_name ?? row.customer_name ?? `客户${index + 1}`);
      const segmentLabel = resolveSegmentLabel(row.primary_segment);
      const balance = Number(row.current_stored_amount ?? row.current_stored_balance ?? 0);
      const priorityBand = String(row.priority_band ?? "P1");
      const reason = String(row.reason_summary ?? "尽快完成跟进。");
      const advice = String(row.touch_advice_summary ?? "尽快联系。");
      lines.push(
        `${index + 1}. ${memberName} | ${priorityBand} | ${segmentLabel} | 余额 ${formatCurrency(balance)}`,
      );
      lines.push(`   - 原因: ${reason}`);
      lines.push(`   - 建议: ${advice}`);
    });
    return lines.join("\n");
  }

  if (params.plan.entity === "hq" && params.plan.action === "summary") {
    if (params.rows.length === 0) {
      return null;
    }
    const windowLabel =
      params.plan.time.mode === "window"
        ? `近${params.plan.time.window_days ?? params.rows[0]?.window_days ?? ""}天`
        : params.plan.time.biz_date ?? "当前";
    const totalMetric = params.rows.reduce(
      (sum, row) => sum + Number(resolveRowMetricValue(row) ?? 0),
      0,
    );
    const lines = [`总部${windowLabel}${metricLabel}总览`, `- 合计 ${renderMetricValue(totalMetric)}`];
    params.rows.forEach((row, index) => {
      const storeName = resolveStoreName(row);
      lines.push(`${index + 1}. ${storeName} ${renderMetricValue(resolveRowMetricValue(row))}`);
    });
    return lines.join("\n");
  }

  return null;
}

function metricNumber(metrics: Partial<DailyStoreMetrics>, key: keyof DailyStoreMetrics): number {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function resolveMetricResolution(intent: HetangQueryIntent) {
  if (intent.metrics.length > 0 || intent.unsupportedMetrics.length > 0) {
    return {
      supported: intent.metrics,
      unsupported: intent.unsupportedMetrics,
    };
  }
  return resolveMetricIntent("营收");
}

export function renderCompareText(params: {
  left: StoreWindowSummary;
  right: StoreWindowSummary;
  intent: HetangQueryIntent;
}): string {
  const resolution = resolveMetricResolution(params.intent);
  const metrics =
    resolution.supported.length > 0
      ? resolution.supported
      : [resolvePrimarySupportedMetric(resolution)];
  const title =
    params.left.orgId === params.right.orgId
      ? `${params.left.storeName} ${params.left.frame.label} vs ${params.right.frame.label}`
      : `${params.left.storeName} vs ${params.right.storeName}`;
  const lines = [title];
  for (const metric of metrics) {
    const leftNumeric = getMetricNumericValue(metric, params.left.metrics);
    const rightNumeric = getMetricNumericValue(metric, params.right.metrics);
    const delta =
      leftNumeric === null || rightNumeric === null ? null : round(leftNumeric - rightNumeric, 4);
    lines.push(
      `- ${metric.label}: ${params.left.storeName} ${formatMetricValue(metric, params.left.metrics)}；${params.right.storeName} ${formatMetricValue(metric, params.right.metrics)}；差额 ${formatMetricDelta(metric.key, delta)}`,
    );
  }
  const unsupportedText = describeUnsupportedMetricResolution(resolution);
  if (unsupportedText) {
    lines.push(unsupportedText);
  }
  return lines.join("\n");
}

export function renderStoreRankingText(params: {
  label: string;
  metric: ReturnType<typeof resolvePrimarySupportedMetric>;
  rows: StoreWindowSummary[];
}): string {
  const lines = [`${params.label} ${params.metric.label}排名`];
  params.rows.forEach((summary, index) => {
    lines.push(
      `${index + 1}. ${summary.storeName} ${formatMetricValue(params.metric, summary.metrics)}`,
    );
  });
  return lines.join("\n");
}

export function renderTrendText(params: {
  summary: StoreWindowSummary;
  metric: ReturnType<typeof resolvePrimarySupportedMetric>;
}): string {
  const lines = [`${params.summary.storeName} ${params.summary.frame.label} ${params.metric.label}趋势`];
  params.summary.reports.forEach((report) => {
    lines.push(
      `- ${report.bizDate}: ${formatMetricValue(params.metric, report.metrics ?? params.summary.metrics)}`,
    );
  });
  return lines.join("\n");
}

export function renderRiskAdviceText(params: {
  summary: StoreWindowSummary;
  intent: HetangQueryIntent;
  analysis?: QueryAnalysisLens;
  environmentContext?: AnalysisEnvironmentContext;
  storeExternalContext?: StoreExternalContextAiPayload;
  worldModelSupplement?: string | null;
}): string {
  const alertMap = new Map<
    string,
    { severity: DailyStoreAlert["severity"]; message: string; count: number }
  >();
  for (const report of params.summary.reports) {
    for (const alert of report.alerts ?? []) {
      const current = alertMap.get(alert.code) ?? {
        severity: alert.severity,
        message: alert.message,
        count: 0,
      };
      current.count += 1;
      alertMap.set(alert.code, current);
    }
  }
  const latestSuggestions =
    params.summary.reports[params.summary.reports.length - 1]?.suggestions ?? [];
  const executiveAnalysis = isExecutiveAnalysisLens(params.analysis) ? params.analysis : null;
  const usesStoreGrowthLens = executiveAnalysis?.framework_id === "store_growth_diagnosis_v1";
  const usesStoreOperationsLens =
    executiveAnalysis?.framework_id === "store_operations_diagnosis_v1";
  const usesStoreProfitLens = executiveAnalysis?.framework_id === "store_profit_diagnosis_v1";
  if (usesStoreGrowthLens && executiveAnalysis) {
    return renderStoreGrowthDiagnosisText({
      summary: params.summary,
      analysis: executiveAnalysis,
      latestSuggestions,
      environmentContext: params.environmentContext,
      storeExternalContext: params.storeExternalContext,
      worldModelSupplement: params.worldModelSupplement,
    });
  }
  if (usesStoreOperationsLens && executiveAnalysis) {
    return renderStoreOperationsDiagnosisText({
      summary: params.summary,
      analysis: executiveAnalysis,
      latestSuggestions,
      environmentContext: params.environmentContext,
      storeExternalContext: params.storeExternalContext,
      worldModelSupplement: params.worldModelSupplement,
    });
  }
  if (usesStoreProfitLens && executiveAnalysis) {
    return renderStoreProfitDiagnosisText({
      summary: params.summary,
      analysis: executiveAnalysis,
      latestSuggestions,
      environmentContext: params.environmentContext,
      storeExternalContext: params.storeExternalContext,
      worldModelSupplement: params.worldModelSupplement,
    });
  }
  const lines = [`${params.summary.storeName} ${params.summary.frame.label} 风险与建议`];
  lines.push("风险");
  if (alertMap.size === 0) {
    lines.push("- 暂无重大预警。");
  } else {
    for (const [, alert] of alertMap) {
      lines.push(
        `- [${alert.severity}] ${alert.message}${params.summary.reports.length > 1 ? `（${alert.count} 天出现）` : ""}`,
      );
    }
  }
  if (
    params.intent.mentionsAdviceKeyword ||
    params.intent.kind === "advice" ||
    params.intent.kind === "report"
  ) {
    lines.push("建议");
    if (latestSuggestions.length === 0) {
      lines.push("1. 先盯服务营收、总钟数、钟效三项基础盘。");
    } else {
      latestSuggestions.forEach((entry, index) => {
        lines.push(`${index + 1}. ${entry}`);
      });
    }
  }
  const externalContextHint = resolveStoreExternalContextExplanationHint(params.storeExternalContext);
  if (externalContextHint) {
    lines.push(externalContextHint);
  }
  if (params.worldModelSupplement) {
    lines.push(...params.worldModelSupplement.split("\n"));
  }
  return lines.join("\n");
}

function resolveEnvironmentExplanationHint(
  environmentContext: AnalysisEnvironmentContext | undefined,
): string | null {
  if (!environmentContext) {
    return null;
  }
  if (environmentContext.narrativePolicy === "suppress") {
    return null;
  }
  const solarTermLabel = formatSolarTermLabel(environmentContext.solarTerm);
  if (
    environmentContext.badWeatherTouchPenalty === "medium" ||
    environmentContext.badWeatherTouchPenalty === "high"
  ) {
    return "今天天气偏弱，不适合强推即时到店，更适合先约后续更稳的窗口。";
  }
  if (
    environmentContext.seasonTag === "spring" &&
    environmentContext.eveningOutingLikelihood === "high" &&
    environmentContext.postDinnerLeisureBias === "high"
  ) {
    if (solarTermLabel) {
      return `当前临近${solarTermLabel}，春季晚间出行偏活跃，晚饭后和夜场承接更值得优先看。`;
    }
    return "当前春季晚间出行偏活跃，晚饭后和夜场承接更值得优先看。";
  }
  if (
    environmentContext.eveningOutingLikelihood === "high" &&
    environmentContext.postDinnerLeisureBias === "high"
  ) {
    return "当前晚间休闲需求偏强，饭后和夜场窗口更值得优先关注。";
  }
  return null;
}

function resolveStoreExternalContextExplanationHint(
  storeExternalContext: StoreExternalContextAiPayload | undefined,
): string | null {
  if (!storeExternalContext) {
    return null;
  }

  const serviceHours = readStoreExternalContextText(
    storeExternalContext.confirmed,
    "service_hours",
  );
  const population3km = readStoreExternalContextNumber(
    storeExternalContext.estimatedMarketContext,
    "market_population_scale_3km",
  );
  const catering3km = readStoreExternalContextNumber(
    storeExternalContext.estimatedMarketContext,
    "catering_poi_count_3km",
  );
  const hotel3km = readStoreExternalContextNumber(
    storeExternalContext.estimatedMarketContext,
    "hotel_poi_count_3km",
  );
  const businessScene = storeExternalContext.researchNotes.find(
    (entry) =>
      entry.metricKey === "store_business_scene_inference" && typeof entry.value === "string",
  );
  const nightScene = storeExternalContext.researchNotes.find(
    (entry) =>
      entry.metricKey === "seasonal_nightlife_pattern" && typeof entry.value === "string",
  );

  const parts: string[] = [];
  if (serviceHours) {
    parts.push(`确认营业时段 ${serviceHours}`);
  }
  if (population3km !== null || catering3km !== null || hotel3km !== null) {
    const estimatedParts: string[] = [];
    if (population3km !== null) {
      estimatedParts.push(`周边3km约${formatChineseCountInWan(population3km)}人`);
    }
    if (catering3km !== null) {
      estimatedParts.push(`餐饮${round(catering3km, 0).toFixed(0)}家`);
    }
    if (hotel3km !== null) {
      estimatedParts.push(`酒店${round(hotel3km, 0).toFixed(0)}家`);
    }
    if (estimatedParts.length > 0) {
      parts.push(`第三方估算显示${estimatedParts.join("、")}`);
    }
  }
  if (businessScene && typeof businessScene.value === "string") {
    parts.push(`研究备注偏向 ${businessScene.value}`);
  } else if (nightScene && typeof nightScene.value === "string") {
    parts.push(`研究备注提到 ${nightScene.value}`);
  }

  if (parts.length === 0) {
    return null;
  }
  return `外部情报补充：${parts.join("；")}。仅作经营解释，不直接改主评分。`;
}

function formatTurnsPerRoom(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${round(value, 2).toFixed(2)} 次/间`;
}

type StoreOperationsPrimaryDimension =
  | "execution_efficiency"
  | "service_conversion"
  | "capacity_utilization"
  | "staffing_health";

function resolveStoreOperationsDiagnosisFocus(metrics: DailyStoreMetrics): {
  summary: string;
  closing: string;
  primaryDimension: StoreOperationsPrimaryDimension;
} {
  const pointClockRate = metrics.pointClockRate ?? null;
  const addClockRate = metrics.addClockRate ?? null;
  const clockEffect = metrics.clockEffect ?? null;
  const roomOccupancyRate = metrics.roomOccupancyRate ?? null;
  const roomTurnoverRate = metrics.roomTurnoverRate ?? null;
  const activeRatio =
    metrics.onDutyTechCount > 0 ? metrics.activeTechCount / metrics.onDutyTechCount : null;

  if (
    (pointClockRate !== null && pointClockRate < 0.35) ||
    (clockEffect !== null && clockEffect < 70)
  ) {
    return {
      summary: "当前先抓点钟承接和前场履约效率。",
      closing: "先把前场承接接稳，再谈后面的客单和规模放大。",
      primaryDimension: "execution_efficiency",
    };
  }
  if (addClockRate !== null && addClockRate < 0.22) {
    return {
      summary: "当前先抓加钟收口和服务后半程转化。",
      closing: "先把服务后半程做深，再谈单客价值放大。",
      primaryDimension: "service_conversion",
    };
  }
  if (
    (roomOccupancyRate !== null && roomOccupancyRate < 0.68) ||
    (roomTurnoverRate !== null && roomTurnoverRate < 2.6)
  ) {
    return {
      summary: "当前先抓包间产能和高峰翻房节奏。",
      closing: "先把高峰产能接顺，别让现场空转和排队同时出现。",
      primaryDimension: "capacity_utilization",
    };
  }
  if (activeRatio !== null && activeRatio < 0.75) {
    return {
      summary: "当前先抓在岗和活跃排班匹配。",
      closing: "先把排班负荷配平，再看现场承接还能不能提速。",
      primaryDimension: "staffing_health",
    };
  }
  return {
    summary: "当前先盯承接节奏和高峰履约稳定性。",
    closing: "履约盘面暂时可控，但高峰班次还要继续盯。",
    primaryDimension: "execution_efficiency",
  };
}

function resolveStoreOperationsDiagnosisActions(params: {
  primaryDimension: StoreOperationsPrimaryDimension;
  latestSuggestions: string[];
}): string[] {
  if (params.latestSuggestions.length > 0) {
    return params.latestSuggestions.slice(0, 3);
  }
  switch (params.primaryDimension) {
    case "execution_efficiency":
      return [
        "今天先把晚场高峰的承接链路拆开看，确认前台分配和技师接单有没有卡点。",
        "高峰班次优先把点钟强、承接稳的技师顶上去，别把强承接的人放在低峰。",
        "前台统一补一句项目承接话术，先减少有客无承接的流失。",
      ];
    case "service_conversion":
      return [
        "今天先复盘服务后半程的加钟收口，先把加钟强的技师排在高峰班次。",
        "前台和技师统一补一句升级服务话术，别让基础单直接结束。",
        "先盯高价值会员和高意向客的加项转化，避免忙但不深。",
      ];
    case "capacity_utilization":
      return [
        "今天先按班次看包间空置和翻房慢点位，优先补高峰时段周转。",
        "房间清场和候钟衔接要有人盯，别让上一单结束后空档过长。",
        "先把高峰可承接能力拉起来，再决定要不要继续加客流。",
      ];
    default:
      return [
        "今天先核对在岗和活跃技师差额，确认有没有排班虚高或出勤偏弱。",
        "高峰班次优先补足承接稳的技师，低峰班次再做弹性安排。",
        "先把班表和真实接单能力对齐，别让现场排队和空班同时存在。",
      ];
  }
}

function renderStoreOperationsDiagnosisText(params: {
  summary: StoreWindowSummary;
  analysis: QueryAnalysisLens;
  latestSuggestions: string[];
  environmentContext?: AnalysisEnvironmentContext;
  storeExternalContext?: StoreExternalContextAiPayload;
  worldModelSupplement?: string | null;
}): string {
  const metrics = params.summary.metrics;
  const focus = resolveStoreOperationsDiagnosisFocus(metrics);
  const actions = resolveStoreOperationsDiagnosisActions({
    primaryDimension: focus.primaryDimension,
    latestSuggestions: params.latestSuggestions,
  });
  const pointClockRate = metrics.pointClockRate ?? null;
  const addClockRate = metrics.addClockRate ?? null;
  const clockEffect = metrics.clockEffect ?? null;
  const roomOccupancyRate = metrics.roomOccupancyRate ?? null;
  const roomTurnoverRate = metrics.roomTurnoverRate ?? null;
  const activeRatio =
    metrics.onDutyTechCount > 0 ? metrics.activeTechCount / metrics.onDutyTechCount : null;
  const lines = [`${params.summary.storeName} ${params.summary.frame.label} 当前重点看什么`];

  lines.push(`一、${params.analysis.section_labels.summary}`);
  lines.push(`- ${focus.summary}`);
  lines.push(`- ${focus.closing}`);
  const environmentHint = resolveEnvironmentExplanationHint(params.environmentContext);
  if (environmentHint) {
    lines.push(`- ${environmentHint}`);
  }
  const externalContextHint = resolveStoreExternalContextExplanationHint(params.storeExternalContext);
  if (externalContextHint) {
    lines.push(`- ${externalContextHint}`);
  }
  if (params.worldModelSupplement) {
    lines.push(...params.worldModelSupplement.split("\n").map((line) => `- ${line}`));
  }

  lines.push(`二、${params.analysis.section_labels.signals}`);
  lines.push(
    `1. ${resolveAnalysisSignalLabel(params.analysis, "execution_efficiency", "先看承接效率")}：点钟率 ${formatPercentValue(
      pointClockRate,
    )}，钟效 ${
      clockEffect === null ? "N/A" : `${round(clockEffect, 1).toFixed(1)}`
    }，${
      (pointClockRate ?? 1) < 0.35 || (clockEffect ?? Infinity) < 70
        ? "前场承接已经偏弱。"
        : "前场承接暂时还算稳。"
    }`,
  );
  lines.push(
    `2. ${resolveAnalysisSignalLabel(params.analysis, "service_conversion", "再看二次成交")}：加钟率 ${formatPercentValue(
      addClockRate,
    )}，客单价 ${formatCurrency(metrics.averageTicket ?? 0)}，${
      (addClockRate ?? 1) < 0.22
        ? "服务后半程的收口还没接住。"
        : "服务后半程转化暂时可控。"
    }`,
  );
  lines.push(
    `3. ${resolveAnalysisSignalLabel(params.analysis, "capacity_utilization", "再看产能利用")}：包间上座率 ${formatPercentValue(
      roomOccupancyRate,
    )}，翻房率 ${formatTurnsPerRoom(roomTurnoverRate)}，${
      (roomOccupancyRate ?? 1) < 0.68 || (roomTurnoverRate ?? Infinity) < 2.6
        ? "产能利用还有明显空档。"
        : "包间产能整体还算顺。"
    }`,
  );
  lines.push(
    `4. ${resolveAnalysisSignalLabel(params.analysis, "staffing_health", "最后看排班负荷")}：在岗技师 ${round(
      metrics.onDutyTechCount ?? 0,
      1,
    ).toFixed(1)} 人，活跃技师 ${round(metrics.activeTechCount ?? 0, 1).toFixed(1)} 人，活跃占比 ${formatPercentValue(
      activeRatio,
    )}，${
      activeRatio !== null && activeRatio < 0.75
        ? "班表和真实承接能力还有偏差。"
        : "排班负荷暂时没有明显失衡。"
    }`,
  );

  lines.push(`三、${params.analysis.section_labels.actions}`);
  actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action}`);
  });

  lines.push(`四、${params.analysis.section_labels.ranking}`);
  lines.push(
    `- 当前第一优先级是${
      focus.primaryDimension === "execution_efficiency"
        ? "承接效率"
        : focus.primaryDimension === "service_conversion"
          ? "二次成交"
          : focus.primaryDimension === "capacity_utilization"
            ? "产能利用"
            : "排班负荷"
    }，不要把现场问题平均摊到所有环节。`,
  );
  return lines.join("\n");
}

function resolveStoreGrowthDiagnosisFocus(metrics: DailyStoreMetrics): {
  summary: string;
  closing: string;
  primaryDimension: "retention" | "member_asset_health" | "unit_economics" | "conversion";
} {
  const repurchaseRate = metrics.memberRepurchaseRate7d ?? null;
  const repurchaseBase = metrics.memberRepurchaseBaseCustomerCount7d ?? 0;
  const sleepingRate = metrics.sleepingMemberRate ?? null;
  const renewalPressure = metrics.renewalPressureIndex30d ?? null;
  const storedBalanceLifeMonths = metrics.storedBalanceLifeMonths ?? null;
  const currentStoredBalance = metrics.currentStoredBalance ?? 0;
  const addClockRate = metrics.addClockRate ?? null;
  const averageTicket = metrics.averageTicket ?? 0;

  if (
    (repurchaseBase >= 12 && repurchaseRate !== null && repurchaseRate < 0.45) ||
    (sleepingRate !== null && sleepingRate >= 0.15)
  ) {
    return {
      summary: "当前先抓老客回流和会员激活。",
      closing: "先把老客回流接住，再决定后续拉新和续费放大。",
      primaryDimension: "retention",
    };
  }
  if (
    (renewalPressure !== null && renewalPressure >= 1.25) ||
    (storedBalanceLifeMonths !== null && storedBalanceLifeMonths < 3 && currentStoredBalance > 0)
  ) {
    return {
      summary: "当前先抓续费收口和会员资产健康。",
      closing: "先守住高余额会员和续费节奏，再放大其他动作。",
      primaryDimension: "member_asset_health",
    };
  }
  if ((addClockRate !== null && addClockRate < 0.28) || averageTicket < 160) {
    return {
      summary: "当前先抓单客价值和加钟承接。",
      closing: "先把每次到店做深，再谈规模扩张。",
      primaryDimension: "unit_economics",
    };
  }
  return {
    summary: "当前先盯承接质量和新客转会员链路。",
    closing: "增长节奏整体可控，但拉新质量还需要继续下钻。",
    primaryDimension: "conversion",
  };
}

function resolveStoreGrowthDiagnosisActions(params: {
  primaryDimension: "retention" | "member_asset_health" | "unit_economics" | "conversion";
  latestSuggestions: string[];
}): string[] {
  if (params.latestSuggestions.length > 0) {
    return params.latestSuggestions.slice(0, 3);
  }
  switch (params.primaryDimension) {
    case "retention":
      return [
        "今天先把上周到店但本周没回来的老会员拉名单，按高价值/普通两档分开打。",
        "前台和熟悉技师一起做二次邀约，先把人约回来，再谈续费和开卡。",
        "今天少发泛优惠券，先把高价值老会员的到店节奏接住。",
      ];
    case "member_asset_health":
      return [
        "今天先拉高余额且最近7天到过店的会员名单，优先做续费收口。",
        "前台先拆续费理由和卡型结构，不要平均发力。",
        "技师端今天重点配合前台把续费价值和到店节奏讲清楚。",
      ];
    case "unit_economics":
      return [
        "今天先复盘晚场高峰的加钟承接，优先把加钟强的技师放到高峰班次。",
        "前台和技师统一补一句升级服务的承接话术，别只做基础单。",
        "先盯高客单会员的加项转化，避免忙但不赚。",
      ];
    default:
      return [
        "今天先拆最近7天新客承接链路，确认首单后谁在流失。",
        "前台先拉未复到店的新客名单，按来源和首单类型分层跟进。",
        "别急着放大投放，先把首单承接和转会员动作补齐。",
      ];
  }
}

function renderStoreGrowthDiagnosisText(params: {
  summary: StoreWindowSummary;
  analysis: QueryAnalysisLens;
  latestSuggestions: string[];
  environmentContext?: AnalysisEnvironmentContext;
  storeExternalContext?: StoreExternalContextAiPayload;
  worldModelSupplement?: string | null;
}): string {
  const metrics = params.summary.metrics;
  const focus = resolveStoreGrowthDiagnosisFocus(metrics);
  const actions = resolveStoreGrowthDiagnosisActions({
    primaryDimension: focus.primaryDimension,
    latestSuggestions: params.latestSuggestions,
  });
  const repurchaseRate = metrics.memberRepurchaseRate7d ?? null;
  const repurchaseBase = metrics.memberRepurchaseBaseCustomerCount7d ?? 0;
  const repurchaseReturned = metrics.memberRepurchaseReturnedCustomerCount7d ?? 0;
  const sleepingRate = metrics.sleepingMemberRate ?? null;
  const renewalPressure = metrics.renewalPressureIndex30d ?? null;
  const storedBalanceLifeMonths = metrics.storedBalanceLifeMonths ?? null;
  const addClockRate = metrics.addClockRate ?? null;
  const averageTicket = metrics.averageTicket ?? 0;
  const revisitRate = metrics.groupbuy7dRevisitRate ?? null;
  const storedValueConversionRate = metrics.groupbuy7dStoredValueConversionRate ?? null;
  const lines = [`${params.summary.storeName} ${params.summary.frame.label} 当前重点看什么`];

  lines.push(`一、${params.analysis.section_labels.summary}`);
  lines.push(`- ${focus.summary}`);
  lines.push(`- ${focus.closing}`);
  const environmentHint = resolveEnvironmentExplanationHint(params.environmentContext);
  if (environmentHint) {
    lines.push(`- ${environmentHint}`);
  }
  const externalContextHint = resolveStoreExternalContextExplanationHint(params.storeExternalContext);
  if (externalContextHint) {
    lines.push(`- ${externalContextHint}`);
  }
  if (params.worldModelSupplement) {
    lines.push(...params.worldModelSupplement.split("\n").map((line) => `- ${line}`));
  }

  lines.push(`二、${params.analysis.section_labels.signals}`);
  lines.push(
    `1. ${resolveAnalysisSignalLabel(params.analysis, "retention", "先看留存")}：会员7日复购率 ${formatPercentWithCounts(
      repurchaseRate,
      repurchaseReturned,
      repurchaseBase,
    )}，沉默会员占比 ${formatPercentValue(sleepingRate)}，${
      (repurchaseBase >= 12 && (repurchaseRate ?? 1) < 0.45) || (sleepingRate ?? 0) >= 0.15
        ? "老客回流已经转弱。"
        : "老客回流暂时还算稳。"
    }`,
  );
  lines.push(
    `2. ${resolveAnalysisSignalLabel(params.analysis, "member_asset_health", "再看会员资产")}：续费压力 ${
      renewalPressure === null ? "N/A" : round(renewalPressure, 2).toFixed(2)
    }，储值寿命 ${
      storedBalanceLifeMonths === null ? "N/A" : `${round(storedBalanceLifeMonths, 1).toFixed(1)} 个月`
    }，${
      (renewalPressure ?? 0) >= 1.25 || ((storedBalanceLifeMonths ?? Infinity) < 3 && (metrics.currentStoredBalance ?? 0) > 0)
        ? "续费和耗卡节奏偏紧。"
        : "会员资产暂时可控。"
    }`,
  );
  lines.push(
    `3. ${resolveAnalysisSignalLabel(params.analysis, "unit_economics", "再看单客价值")}：客单价 ${formatCurrency(
      averageTicket,
    )}，加钟率 ${formatPercentValue(addClockRate)}，${
      (addClockRate ?? 1) < 0.28 || averageTicket < 160
        ? "单客价值承接偏弱。"
        : "单客价值整体还算稳定。"
    }`,
  );
  lines.push(
    `4. ${resolveAnalysisSignalLabel(params.analysis, "conversion", "最后看拉新质量")}：7天复到店率 ${formatPercentValue(
      revisitRate,
    )}，7天储值转化率 ${formatPercentValue(storedValueConversionRate)}，${
      revisitRate === null && storedValueConversionRate === null
        ? "当前快答缺少稳定的新客承接样本。"
        : "如要判断拉新质量，还要继续下钻到渠道和新客分层。"
    }`,
  );

  lines.push(`三、${params.analysis.section_labels.actions}`);
  actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action}`);
  });

  lines.push(`四、${params.analysis.section_labels.ranking}`);
  lines.push(
    `- 当前第一优先级是${focus.primaryDimension === "retention"
      ? "留存"
      : focus.primaryDimension === "member_asset_health"
        ? "会员资产"
        : focus.primaryDimension === "unit_economics"
          ? "单客价值"
          : "拉新承接"}，不要把精力平均摊在所有问题上。`,
  );
  return lines.join("\n");
}

type StoreProfitPrimaryDimension =
  | "profitability"
  | "break_even_safety"
  | "cashflow_quality"
  | "member_asset_health";

function resolveStoreProfitDiagnosisFocus(params: {
  metrics: DailyStoreMetrics;
  frameDays: number;
}): {
  summary: string;
  closing: string;
  primaryDimension: StoreProfitPrimaryDimension;
  normalizedBreakEvenRevenue: number | null;
} {
  const { metrics } = params;
  const grossMarginRate = metrics.grossMarginRate ?? null;
  const netMarginRate = metrics.netMarginRate ?? null;
  const normalizedBreakEvenRevenue =
    metrics.breakEvenRevenue === null
      ? null
      : (metrics.breakEvenRevenue * Math.max(params.frameDays, 1)) / 30;
  const revenueGap =
    normalizedBreakEvenRevenue === null ? null : metrics.serviceRevenue - normalizedBreakEvenRevenue;
  const rechargeCash = metrics.rechargeCash ?? 0;
  const storedConsumeAmount = metrics.storedConsumeAmount ?? 0;
  const storedBalanceLifeMonths = metrics.storedBalanceLifeMonths ?? null;
  const renewalPressure = metrics.renewalPressureIndex30d ?? null;

  if (
    (grossMarginRate !== null && grossMarginRate < 0.52) ||
    (netMarginRate !== null && netMarginRate < 0.1)
  ) {
    return {
      summary: "当前先守毛利和净利，不要只看流水。",
      closing: "先把利润空间守住，再决定后续要不要继续放大客流和活动。",
      primaryDimension: "profitability",
      normalizedBreakEvenRevenue,
    };
  }
  if (revenueGap !== null && revenueGap < 0) {
    return {
      summary: "当前先补保本安全垫，别让流水看起来有规模却不够安全。",
      closing: "先把保本缺口补上，再谈利润放大。",
      primaryDimension: "break_even_safety",
      normalizedBreakEvenRevenue,
    };
  }
  if (rechargeCash > 0 && storedConsumeAmount > rechargeCash * 1.5) {
    return {
      summary: "当前先盯储值现金回流，别让耗卡节奏跑得比现金回流更快。",
      closing: "先把现金回流稳住，再谈冲储和投放放大。",
      primaryDimension: "cashflow_quality",
      normalizedBreakEvenRevenue,
    };
  }
  if (
    (storedBalanceLifeMonths !== null && storedBalanceLifeMonths < 3) ||
    (renewalPressure !== null && renewalPressure >= 1.25)
  ) {
    return {
      summary: "当前先守会员资产寿命和续费收口。",
      closing: "先把高余额会员和续费节奏接住，再谈新增储值。",
      primaryDimension: "member_asset_health",
      normalizedBreakEvenRevenue,
    };
  }
  return {
    summary: "利润结构暂时可控，但利润安全垫还要持续盯。",
    closing: "利润盘面没有明显失控，但别因为流水平稳就放松利润纪律。",
    primaryDimension: "profitability",
    normalizedBreakEvenRevenue,
  };
}

function resolveStoreProfitDiagnosisActions(params: {
  primaryDimension: StoreProfitPrimaryDimension;
  latestSuggestions: string[];
}): string[] {
  if (params.latestSuggestions.length > 0) {
    return params.latestSuggestions.slice(0, 3);
  }
  switch (params.primaryDimension) {
    case "profitability":
      return [
        "今天先把低毛利项目和低毛利引流单拆出来，确认哪些流水在拖利润。",
        "前台和店长统一补升级服务与加项收口，别只追单量不追利润。",
        "先守住毛利率和净利率，再决定是否继续放大活动。",
      ];
    case "break_even_safety":
      return [
        "今天先按班次拆保本缺口，优先补最容易掉到保本线下的时段。",
        "低峰时段先控低毛利折扣和无效让利，别让保本线继续抬高。",
        "把高毛利、高复购的项目优先推给高意向客，先把保本安全垫补出来。",
      ];
    case "cashflow_quality":
      return [
        "今天先核对近7天储值进账和耗卡节奏，确认是不是低价单吃掉了现金回流。",
        "前台优先盯高余额会员续费和到店唤醒，别只看当天冲储金额。",
        "现金回流没稳住前，先别继续放大低毛利促销。",
      ];
    default:
      return [
        "今天先拉高余额且近30天有消费的会员名单，优先做续费收口。",
        "把续费理由、卡型结构和到店节奏拆开看，别平均发力。",
        "先把会员资产寿命拉长，再决定冲储动作要不要加码。",
      ];
  }
}

function renderStoreProfitDiagnosisText(params: {
  summary: StoreWindowSummary;
  analysis: QueryAnalysisLens;
  latestSuggestions: string[];
  environmentContext?: AnalysisEnvironmentContext;
  storeExternalContext?: StoreExternalContextAiPayload;
  worldModelSupplement?: string | null;
}): string {
  const metrics = params.summary.metrics;
  const focus = resolveStoreProfitDiagnosisFocus({
    metrics,
    frameDays: params.summary.frame.days,
  });
  const actions = resolveStoreProfitDiagnosisActions({
    primaryDimension: focus.primaryDimension,
    latestSuggestions: params.latestSuggestions,
  });
  const grossMarginRate = metrics.grossMarginRate ?? null;
  const netMarginRate = metrics.netMarginRate ?? null;
  const rechargeCash = metrics.rechargeCash ?? 0;
  const rechargeStoredValue = metrics.rechargeStoredValue ?? 0;
  const storedConsumeAmount = metrics.storedConsumeAmount ?? 0;
  const storedBalanceLifeMonths = metrics.storedBalanceLifeMonths ?? null;
  const renewalPressure = metrics.renewalPressureIndex30d ?? null;
  const revenueGap =
    focus.normalizedBreakEvenRevenue === null
      ? null
      : metrics.serviceRevenue - focus.normalizedBreakEvenRevenue;
  const lines = [`${params.summary.storeName} ${params.summary.frame.label} 当前重点看什么`];

  lines.push(`一、${params.analysis.section_labels.summary}`);
  lines.push(`- ${focus.summary}`);
  lines.push(`- ${focus.closing}`);
  const environmentHint = resolveEnvironmentExplanationHint(params.environmentContext);
  if (environmentHint) {
    lines.push(`- ${environmentHint}`);
  }
  const externalContextHint = resolveStoreExternalContextExplanationHint(params.storeExternalContext);
  if (externalContextHint) {
    lines.push(`- ${externalContextHint}`);
  }
  if (params.worldModelSupplement) {
    lines.push(...params.worldModelSupplement.split("\n").map((line) => `- ${line}`));
  }

  lines.push(`二、${params.analysis.section_labels.signals}`);
  lines.push(
    `1. ${resolveAnalysisSignalLabel(params.analysis, "profitability", "先看利润空间")}：毛利率 ${formatPercentValue(
      grossMarginRate,
    )}，净利率 ${formatPercentValue(netMarginRate)}，${
      (grossMarginRate ?? 1) < 0.52 || (netMarginRate ?? 1) < 0.1
        ? "利润空间已经偏薄。"
        : "利润空间暂时可控。"
    }`,
  );
  lines.push(
    `2. ${resolveAnalysisSignalLabel(params.analysis, "break_even_safety", "再看保本安全垫")}：同口径保本营收约 ${
      focus.normalizedBreakEvenRevenue === null
        ? "N/A"
        : formatCurrency(focus.normalizedBreakEvenRevenue)
    }，本期服务营收 ${formatCurrency(metrics.serviceRevenue ?? 0)}，${
      revenueGap === null
        ? "当前缺少稳定的保本安全垫判断。"
        : revenueGap < 0
          ? "保本安全垫已经偏薄。"
          : "当前还在保本线之上。"
    }`,
  );
  lines.push(
    `3. ${resolveAnalysisSignalLabel(params.analysis, "cashflow_quality", "再看储值现金流")}：充值现金 ${formatCurrency(
      rechargeCash,
    )}，充值总额 ${formatCurrency(rechargeStoredValue)}，耗卡金额 ${formatCurrency(
      storedConsumeAmount,
    )}，${
      rechargeCash > 0 && storedConsumeAmount > rechargeCash * 1.5
        ? "耗卡跑得比现金回流更快。"
        : "现金回流暂时还算稳。"
    }`,
  );
  lines.push(
    `4. ${resolveAnalysisSignalLabel(params.analysis, "member_asset_health", "最后看会员资产寿命")}：储值寿命 ${
      storedBalanceLifeMonths === null ? "N/A" : `${round(storedBalanceLifeMonths, 1).toFixed(1)} 个月`
    }，续费压力 ${
      renewalPressure === null ? "N/A" : round(renewalPressure, 2).toFixed(2)
    }，${
      (storedBalanceLifeMonths ?? Infinity) < 3 || (renewalPressure ?? 0) >= 1.25
        ? "会员资产寿命已经偏紧。"
        : "会员资产寿命暂时可控。"
    }`,
  );

  lines.push(`三、${params.analysis.section_labels.actions}`);
  actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action}`);
  });

  lines.push(`四、${params.analysis.section_labels.ranking}`);
  lines.push(
    `- 当前第一优先级是${
      focus.primaryDimension === "profitability"
        ? "利润空间"
        : focus.primaryDimension === "break_even_safety"
          ? "保本安全垫"
          : focus.primaryDimension === "cashflow_quality"
            ? "储值现金流"
            : "会员资产寿命"
    }，不要被表面流水掩盖利润问题。`,
  );
  return lines.join("\n");
}

type PortfolioRiskEntry = {
  summary: StoreWindowSummary;
  score: number;
  level: "high" | "medium" | "watch";
  reasons: string[];
  criticalAlertKinds: number;
  warnAlertKinds: number;
  infoAlertKinds: number;
};

export function buildPortfolioRiskEntry(
  summary: StoreWindowSummary,
  comparisonSummary?: StoreWindowSummary,
): PortfolioRiskEntry {
  const criticalCodes = new Set<string>();
  const warnCodes = new Set<string>();
  const infoCodes = new Set<string>();
  for (const report of summary.reports) {
    for (const alert of report.alerts ?? []) {
      if (alert.severity === "critical") {
        criticalCodes.add(alert.code);
      } else if (alert.severity === "warn") {
        warnCodes.add(alert.code);
      } else {
        infoCodes.add(alert.code);
      }
    }
  }

  const firstMetrics = summary.reports[0]?.metrics;
  const lastMetrics = summary.reports[summary.reports.length - 1]?.metrics;
  const revenueChange = comparisonSummary
    ? percentDiff(summary.metrics.serviceRevenue, comparisonSummary.metrics.serviceRevenue)
    : firstMetrics && lastMetrics
      ? percentDiff(lastMetrics.serviceRevenue ?? 0, firstMetrics.serviceRevenue ?? 0)
      : null;
  const clockEffectChange = comparisonSummary
    ? percentDiff(summary.metrics.clockEffect, comparisonSummary.metrics.clockEffect)
    : firstMetrics && lastMetrics
      ? percentDiff(lastMetrics.clockEffect ?? 0, firstMetrics.clockEffect ?? 0)
      : null;

  let score = criticalCodes.size * 20 + warnCodes.size * 10 + infoCodes.size * 4;
  const reasons: string[] = [];

  if (criticalCodes.size > 0) {
    reasons.push(`${criticalCodes.size} 类 critical 预警反复出现`);
  }
  if (warnCodes.size > 0) {
    reasons.push(`${warnCodes.size} 类 warn 预警持续出现`);
  }
  if ((revenueChange ?? 0) <= -0.15) {
    score += 18;
    reasons.push(`营收较期初 ${formatPercentChange(revenueChange)}`);
  } else if ((revenueChange ?? 0) <= -0.08) {
    score += 10;
    reasons.push(`营收较期初 ${formatPercentChange(revenueChange)}`);
  }
  if ((clockEffectChange ?? 0) <= -0.12) {
    score += 14;
    reasons.push(`钟效较期初 ${formatPercentChange(clockEffectChange)}`);
  } else if ((clockEffectChange ?? 0) <= -0.06) {
    score += 8;
    reasons.push(`钟效较期初 ${formatPercentChange(clockEffectChange)}`);
  }
  if ((summary.metrics.groupbuy7dRevisitRate ?? 1) < 0.35) {
    score += 12;
    reasons.push(`7天复到店率 ${formatPercentValue(summary.metrics.groupbuy7dRevisitRate)}`);
  }
  if ((summary.metrics.groupbuy7dStoredValueConversionRate ?? 1) < 0.18) {
    score += 10;
    reasons.push(
      `7天储值转化率 ${formatPercentValue(summary.metrics.groupbuy7dStoredValueConversionRate)}`,
    );
  }
  if ((summary.metrics.sleepingMemberRate ?? 0) >= 0.15) {
    score += 12;
    reasons.push(`沉默会员率 ${formatPercentValue(summary.metrics.sleepingMemberRate)}`);
  }
  if (
    (summary.metrics.currentStoredBalance ?? 0) > 0 &&
    (summary.metrics.storedBalanceLifeMonths ?? Infinity) < 3
  ) {
    score += 12;
    reasons.push(
      `储值寿命 ${round(summary.metrics.storedBalanceLifeMonths ?? 0, 1).toFixed(1)} 个月`,
    );
  }
  if ((summary.metrics.renewalPressureIndex30d ?? 0) >= 1.5) {
    score += 14;
    reasons.push(`续费压力 ${(summary.metrics.renewalPressureIndex30d ?? 0).toFixed(2)}`);
  }
  if (
    (summary.metrics.memberRepurchaseBaseCustomerCount7d ?? 0) > 0 &&
    (summary.metrics.memberRepurchaseRate7d ?? 1) < 0.45
  ) {
    score += 10;
    reasons.push(
      `会员7日复购率 ${formatPercentWithCounts(
        summary.metrics.memberRepurchaseRate7d ?? null,
        summary.metrics.memberRepurchaseReturnedCustomerCount7d ?? 0,
        summary.metrics.memberRepurchaseBaseCustomerCount7d ?? 0,
      )}`,
    );
  }
  if ((summary.metrics.addClockRate ?? 1) < 0.28) {
    score += 8;
    reasons.push(`加钟率 ${formatPercentValue(summary.metrics.addClockRate)}`);
  }
  if ((summary.metrics.storedConsumeRate ?? 1) < 0.5 && summary.metrics.rechargeCash > 0) {
    score += 8;
    reasons.push(`储值耗卡比 ${formatPercentValue(summary.metrics.storedConsumeRate)}`);
  }
  const avgTicketFirst = firstMetrics?.averageTicket ?? 0;
  const avgTicketLast = lastMetrics?.averageTicket ?? 0;
  const avgTicketChange =
    avgTicketFirst > 0 && avgTicketLast > 0 ? percentDiff(avgTicketLast, avgTicketFirst) : null;
  if ((avgTicketChange ?? 0) <= -0.1) {
    score += 10;
    reasons.push(`客单价较期初 ${formatPercentChange(avgTicketChange)}`);
  }
  if (!summary.complete) {
    score += 8;
    reasons.push("仍有未完成同步的数据缺口");
  }

  const normalizedScore = Math.min(100, Math.max(0, round(score, 1)));
  const level = normalizedScore >= 70 ? "high" : normalizedScore >= 40 ? "medium" : "watch";
  return {
    summary,
    score: normalizedScore,
    level,
    reasons: reasons.slice(0, 3),
    criticalAlertKinds: criticalCodes.size,
    warnAlertKinds: warnCodes.size,
    infoAlertKinds: infoCodes.size,
  };
}

function formatPortfolioRiskLevel(level: PortfolioRiskEntry["level"]): string {
  switch (level) {
    case "high":
      return "高风险";
    case "medium":
      return "中风险";
    default:
      return "观察中";
  }
}

function resolvePortfolioAdvice(entry: PortfolioRiskEntry): string[] {
  const lines: string[] = [];
  if (
    (entry.summary.metrics.groupbuy7dRevisitRate ?? 1) < 0.35 ||
    (entry.summary.metrics.groupbuy7dStoredValueConversionRate ?? 1) < 0.18
  ) {
    lines.push(
      `先复盘 ${entry.summary.storeName} 团购首单后的 7 天承接，把复到店、开卡、储值三步漏斗拆给店长和前台。`,
    );
  }
  if ((entry.summary.metrics.sleepingMemberRate ?? 0) >= 0.15) {
    lines.push(`把 ${entry.summary.storeName} 沉默会员召回列成今日动作单，别让老会员盘继续变冷。`);
  }
  if ((entry.summary.metrics.addClockRate ?? 1) < 0.28 || entry.criticalAlertKinds > 0) {
    lines.push(
      `复盘 ${entry.summary.storeName} 晚场承接与排班，优先处理“忙但接不住、做了但不够赚”的问题。`,
    );
  }
  if (lines.length === 0) {
    lines.push(
      `先对 ${entry.summary.storeName} 做一次周度经营复盘，确认当前风险是否只是短期波动。`,
    );
  }
  return lines.slice(0, 3);
}

export function renderPortfolioRiskText(params: {
  label: string;
  entries: PortfolioRiskEntry[];
  intent: HetangQueryIntent;
}): string {
  if (params.entries.length === 0) {
    return `${params.label} 暂无可用风险样本。`;
  }
  const [topEntry] = params.entries;
  const lines = [`${params.label} ${topEntry.summary.frame.label}风险雷达`];
  lines.push("结论摘要");
  lines.push(
    `- 最近最需要总部先盯的是${topEntry.summary.storeName}，主要压力来自${topEntry.reasons.join("、") || "关键指标连续走弱"}。`,
  );
  lines.push("风险排序");
  for (const [index, entry] of params.entries.entries()) {
    lines.push(
      `${index + 1}. ${entry.summary.storeName} 风险分 ${entry.score.toFixed(1)}（${formatPortfolioRiskLevel(entry.level)}）`,
    );
    lines.push(
      `   - 预警结构：critical ${entry.criticalAlertKinds} 类，warn ${entry.warnAlertKinds} 类，info ${entry.infoAlertKinds} 类。`,
    );
    lines.push(
      `   - 关键指标：7天复到店率 ${formatPercentValue(entry.summary.metrics.groupbuy7dRevisitRate)}，7天储值转化率 ${formatPercentValue(entry.summary.metrics.groupbuy7dStoredValueConversionRate)}，沉默会员率 ${formatPercentValue(entry.summary.metrics.sleepingMemberRate)}。`,
    );
  }
  if (
    params.intent.mentionsAdviceKeyword ||
    params.intent.kind === "advice" ||
    params.intent.kind === "risk"
  ) {
    lines.push("总部动作建议");
    resolvePortfolioAdvice(topEntry).forEach((advice, index) => {
      lines.push(`${index + 1}. ${advice}`);
    });
  }
  return lines.join("\n");
}

type StorePerformanceEntry = {
  summary: StoreWindowSummary;
  comparisonSummary: StoreWindowSummary;
  revenueChange: number | null;
  clockEffectChange: number | null;
  averageTicketChange: number | null;
  riskEntry: PortfolioRiskEntry;
  businessSignal: StoreBusinessSignal;
};

export function buildStorePerformanceEntry(
  summary: StoreWindowSummary,
  comparisonSummary: StoreWindowSummary,
): StorePerformanceEntry {
  const revenueChange = percentDiff(
    summary.metrics.serviceRevenue,
    comparisonSummary.metrics.serviceRevenue,
  );
  const clockEffectChange = percentDiff(
    summary.metrics.clockEffect,
    comparisonSummary.metrics.clockEffect,
  );
  const averageTicketChange = percentDiff(
    summary.metrics.averageTicket,
    comparisonSummary.metrics.averageTicket,
  );
  return {
    summary,
    comparisonSummary,
    revenueChange,
    clockEffectChange,
    averageTicketChange,
    riskEntry: buildPortfolioRiskEntry(summary, comparisonSummary),
    businessSignal: evaluateStoreBusinessScore({
      revenueChange,
      clockEffectChange,
      groupbuy7dRevisitRate: summary.metrics.groupbuy7dRevisitRate,
      groupbuy7dStoredValueConversionRate: summary.metrics.groupbuy7dStoredValueConversionRate,
      groupbuyFirstOrderHighValueMemberRate: summary.metrics.groupbuyFirstOrderHighValueMemberRate,
      sleepingMemberRate: summary.metrics.sleepingMemberRate,
      pointClockRate: summary.metrics.pointClockRate,
      addClockRate: summary.metrics.addClockRate,
    }),
  };
}

function resolveRisingStore(entries: StorePerformanceEntry[]): StorePerformanceEntry | null {
  const candidates = entries.filter(
    (entry) => (entry.revenueChange ?? 0) > 0 || (entry.clockEffectChange ?? 0) > 0,
  );
  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort(
    (left, right) => (right.revenueChange ?? 0) - (left.revenueChange ?? 0),
  )[0];
}

function describeRisingReasons(entry: StorePerformanceEntry): string[] {
  const reasons: string[] = [];
  if ((entry.revenueChange ?? 0) > 0) {
    reasons.push(`营收环比 ${formatPercentChange(entry.revenueChange)}`);
  }
  if ((entry.clockEffectChange ?? 0) > 0) {
    reasons.push(`钟效环比 ${formatPercentChange(entry.clockEffectChange)}`);
  }
  if ((entry.averageTicketChange ?? 0) > 0.05) {
    reasons.push(`客单价环比 ${formatPercentChange(entry.averageTicketChange)}`);
  }
  if ((entry.summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0) >= 0.2) {
    reasons.push(
      `首单高价值转化率 ${formatPercentValue(entry.summary.metrics.groupbuyFirstOrderHighValueMemberRate)}`,
    );
  }
  if ((entry.summary.metrics.groupbuy7dRevisitRate ?? 0) >= 0.45) {
    reasons.push(
      `7天复到店率 ${formatPercentValue(entry.summary.metrics.groupbuy7dRevisitRate)} 在线`,
    );
  }
  if ((entry.summary.metrics.addClockRate ?? 0) >= 0.3) {
    reasons.push(`加钟率 ${formatPercentValue(entry.summary.metrics.addClockRate)} 不错`);
  }
  return reasons.length > 0 ? reasons : ["整体指标相对稳定"];
}

function resolveHqNextWeekPriorities(entries: StorePerformanceEntry[]): string[] {
  const sorted = [...entries].sort((left, right) => right.riskEntry.score - left.riskEntry.score);
  const priorities: string[] = [];
  const topRisk = sorted[0];

  if (topRisk && topRisk.riskEntry.score >= 40) {
    priorities.push(
      `优先处理 ${topRisk.summary.storeName}：风险分 ${topRisk.riskEntry.score.toFixed(1)}，${topRisk.riskEntry.reasons.slice(0, 2).join("、") || "多项指标走弱"}。`,
    );
  }

  const weakRevisit = entries.filter(
    (entry) => (entry.summary.metrics.groupbuy7dRevisitRate ?? 1) < 0.35,
  );
  if (weakRevisit.length > 0) {
    const names = weakRevisit.map((entry) => entry.summary.storeName).join("、");
    priorities.push(
      `${names} 团购7天复到店率偏低，下周重点复盘首单承接流程，拉出未复到店名单逐个跟进。`,
    );
  }

  const highSleeping = entries.filter(
    (entry) => (entry.summary.metrics.sleepingMemberRate ?? 0) >= 0.15,
  );
  if (highSleeping.length > 0) {
    const names = highSleeping.map((entry) => entry.summary.storeName).join("、");
    priorities.push(`${names} 沉默会员占比偏高，下周安排分层召回，优先救高价值沉默会员。`);
  }

  const weakStoredLifeOrHighRenewalPressure = entries.filter(
    (entry) =>
      ((entry.summary.metrics.storedBalanceLifeMonths ?? Infinity) < 3 &&
        (entry.summary.metrics.currentStoredBalance ?? 0) > 0) ||
      (entry.summary.metrics.renewalPressureIndex30d ?? 0) >= 1.5,
  );
  if (weakStoredLifeOrHighRenewalPressure.length > 0 && priorities.length < 4) {
    const names = weakStoredLifeOrHighRenewalPressure
      .map((entry) => entry.summary.storeName)
      .join("、");
    priorities.push(
      `${names} 储值寿命偏短或续费压力偏高，下周同步盯续费名单、耗卡节奏和到店唤醒，不要只看冲储金额。`,
    );
  }

  const weakMemberRepurchase = entries.filter(
    (entry) =>
      (entry.summary.metrics.memberRepurchaseBaseCustomerCount7d ?? 0) > 0 &&
      (entry.summary.metrics.memberRepurchaseRate7d ?? 1) < 0.45,
  );
  if (weakMemberRepurchase.length > 0 && priorities.length < 5) {
    const names = weakMemberRepurchase.map((entry) => entry.summary.storeName).join("、");
    priorities.push(
      `${names} 老会员7日复购率偏低，下周拉出上周到店会员名单，按熟客技师和储值层级做二次邀约。`,
    );
  }

  const weakAddClock = entries.filter((entry) => (entry.summary.metrics.addClockRate ?? 1) < 0.28);
  if (weakAddClock.length > 0 && priorities.length < 4) {
    const names = weakAddClock.map((entry) => entry.summary.storeName).join("、");
    priorities.push(`${names} 加钟率偏弱，下周排班优先把加钟承接强的技师放到晚场高峰。`);
  }

  const weakStoredConsume = entries.filter(
    (entry) =>
      (entry.summary.metrics.storedConsumeRate ?? 1) < 0.5 &&
      entry.summary.metrics.rechargeCash > 0,
  );
  if (weakStoredConsume.length > 0 && priorities.length < 5) {
    const names = weakStoredConsume.map((entry) => entry.summary.storeName).join("、");
    priorities.push(`${names} 储值耗卡比偏低，减少单纯冲储话术，转到耗卡体验包和到店唤醒。`);
  }

  const bestConversion = [...entries]
    .filter((entry) => (entry.summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0) >= 0.15)
    .sort(
      (left, right) =>
        (right.summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0) -
        (left.summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0),
    );
  if (bestConversion.length > 0 && priorities.length < 6) {
    const best = bestConversion[0];
    priorities.push(
      `把 ${best.summary.storeName} 的首单承接流程（首单高价值转化率 ${formatPercentValue(best.summary.metrics.groupbuyFirstOrderHighValueMemberRate)}）复制到其他门店。`,
    );
  }

  if (priorities.length === 0) {
    priorities.push("各店整体风险可控，下周继续盯紧团购承接和会员留存，不要松劲。");
  }

  return priorities.slice(0, 6);
}

export function renderHqPortfolioText(params: {
  label: string;
  entries: StorePerformanceEntry[];
  intent: HetangQueryIntent;
}): string {
  if (params.entries.length === 0) {
    return `${params.label} 暂无可用数据。`;
  }

  const lines: string[] = [];
  const entries = params.entries;
  const frameLabel = entries[0].summary.frame.label;

  lines.push(`${params.label} ${frameLabel} 总部经营全景`);

  const totalRevenue = round(
    entries.reduce((sum, entry) => sum + entry.summary.metrics.serviceRevenue, 0),
    2,
  );
  const totalPrevRevenue = round(
    entries.reduce((sum, entry) => sum + entry.comparisonSummary.metrics.serviceRevenue, 0),
    2,
  );
  const fleetRevenueChange = percentDiff(totalRevenue, totalPrevRevenue);
  const totalClocks = round(
    entries.reduce((sum, entry) => sum + entry.summary.metrics.totalClockCount, 0),
    1,
  );
  const avgClockEffect = totalClocks > 0 ? round(totalRevenue / totalClocks, 2) : 0;
  const dayCount = Math.max(entries[0].summary.reports.length, 1);

  lines.push("整体概览");
  lines.push(
    `- ${params.label}合计服务营收 ${formatCurrency(totalRevenue)}，日均 ${formatCurrency(totalRevenue / dayCount)}，较上周期 ${formatPercentChange(fleetRevenueChange)}。`,
  );
  lines.push(
    `- 合计总钟数 ${round(totalClocks, 1)} 钟，综合钟效 ${avgClockEffect.toFixed(2)} 元/钟。`,
  );
  const totalOrderCount = round(
    entries.reduce((sum, entry) => sum + entry.summary.metrics.serviceOrderCount, 0),
    0,
  );
  const totalPrevOrderCount = round(
    entries.reduce((sum, entry) => sum + entry.comparisonSummary.metrics.serviceOrderCount, 0),
    0,
  );
  const fleetAvgTicket = totalOrderCount > 0 ? round(totalRevenue / totalOrderCount) : 0;
  const fleetPrevAvgTicket =
    totalPrevOrderCount > 0 ? round(totalPrevRevenue / totalPrevOrderCount) : 0;
  const avgTicketChange = percentDiff(fleetAvgTicket, fleetPrevAvgTicket);
  lines.push(
    `- 综合客单价 ${formatCurrency(fleetAvgTicket)}（上周期 ${formatCurrency(fleetPrevAvgTicket)}，${formatPercentChange(avgTicketChange)}）。`,
  );
  const totalNewMembers = entries.reduce(
    (sum, entry) => sum + (entry.summary.metrics.newMembers ?? 0),
    0,
  );
  const totalStoredConsume = round(
    entries.reduce((sum, entry) => sum + entry.summary.metrics.storedConsumeAmount, 0),
    2,
  );
  const totalRechargeCash = round(
    entries.reduce((sum, entry) => sum + entry.summary.metrics.rechargeCash, 0),
    2,
  );
  const fleetStoredConsumeRate =
    totalRechargeCash > 0 ? totalStoredConsume / totalRechargeCash : null;
  const totalStoredBalance = round(
    entries.reduce((sum, entry) => sum + (entry.summary.metrics.currentStoredBalance ?? 0), 0),
    2,
  );
  const shortestStoredLifeEntry = [...entries]
    .filter(
      (entry) =>
        entry.summary.metrics.storedBalanceLifeMonths !== undefined &&
        entry.summary.metrics.storedBalanceLifeMonths !== null &&
        (entry.summary.metrics.currentStoredBalance ?? 0) > 0,
    )
    .sort(
      (left, right) =>
        (left.summary.metrics.storedBalanceLifeMonths ?? Infinity) -
        (right.summary.metrics.storedBalanceLifeMonths ?? Infinity),
    )[0];
  const highestRenewalPressureEntry = [...entries]
    .filter(
      (entry) =>
        entry.summary.metrics.renewalPressureIndex30d !== undefined &&
        entry.summary.metrics.renewalPressureIndex30d !== null,
    )
    .sort(
      (left, right) =>
        (right.summary.metrics.renewalPressureIndex30d ?? -Infinity) -
        (left.summary.metrics.renewalPressureIndex30d ?? -Infinity),
    )[0];
  lines.push(
    `- 新增会员合计 ${totalNewMembers} 人，储值耗卡比 ${formatPercentValue(fleetStoredConsumeRate)}。`,
  );
  if (shortestStoredLifeEntry || highestRenewalPressureEntry) {
    lines.push(
      `- 当前储值余额合计 ${formatCurrency(totalStoredBalance)}；最短储值寿命 ${shortestStoredLifeEntry ? `${shortestStoredLifeEntry.summary.storeName} ${(shortestStoredLifeEntry.summary.metrics.storedBalanceLifeMonths ?? 0).toFixed(1)} 个月` : "N/A"}；最高续费压力 ${highestRenewalPressureEntry ? `${highestRenewalPressureEntry.summary.storeName} ${(highestRenewalPressureEntry.summary.metrics.renewalPressureIndex30d ?? 0).toFixed(2)}` : "N/A"}。`,
    );
  }

  const byRevenue = [...entries].sort(
    (left, right) => right.summary.metrics.serviceRevenue - left.summary.metrics.serviceRevenue,
  );
  lines.push("营收排名");
  byRevenue.forEach((entry, index) => {
    const storeTicket = entry.summary.metrics.averageTicket;
    const onDuty = entry.summary.metrics.onDutyTechCount;
    const laborEfficiency = onDuty > 0 ? round(entry.summary.metrics.serviceRevenue / onDuty) : 0;
    lines.push(
      `${index + 1}. ${entry.summary.storeName} ${formatCurrency(entry.summary.metrics.serviceRevenue)}（环比 ${formatPercentChange(entry.revenueChange)}）客单价 ${round(storeTicket, 0)} 元，人效 ${round(laborEfficiency, 0)} 元/人，经营状态 ${entry.businessSignal.levelLabel}`,
    );
  });

  const rising = resolveRisingStore(entries);
  lines.push("拉升门店");
  if (rising) {
    const risingReasons = describeRisingReasons(rising);
    lines.push(
      `- ${rising.summary.storeName} 是本周期表现最好的拉升力量：${risingReasons.join("、")}。`,
    );
  } else {
    lines.push("- 本周期没有明显拉升门店，各店均在横盘或下滑。");
  }

  lines.push("增长质量");
  const byConversion = [...entries]
    .filter((entry) => (entry.summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0) > 0)
    .sort(
      (left, right) =>
        (right.summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0) -
        (left.summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0),
    );
  if (byConversion.length > 0) {
    const best = byConversion[0];
    const worst = byConversion[byConversion.length - 1];
    lines.push(
      `- 团购首单→高价值会员转化率：${best.summary.storeName} ${formatPercentValue(best.summary.metrics.groupbuyFirstOrderHighValueMemberRate)}（最高），${worst.summary.storeName} ${formatPercentValue(worst.summary.metrics.groupbuyFirstOrderHighValueMemberRate)}（最低）。`,
    );
  }
  const weakestStoredConsume = [...entries]
    .filter((entry) => entry.summary.metrics.rechargeCash > 0)
    .sort(
      (left, right) =>
        (left.summary.metrics.storedConsumeRate ?? 1) -
        (right.summary.metrics.storedConsumeRate ?? 1),
    );
  if (
    weakestStoredConsume.length > 0 &&
    (weakestStoredConsume[0].summary.metrics.storedConsumeRate ?? 1) < 0.6
  ) {
    const weakest = weakestStoredConsume[0];
    lines.push(
      `- 储值耗卡比最弱门店：${weakest.summary.storeName} ${formatPercentValue(weakest.summary.metrics.storedConsumeRate)}，存在偏重充值轻消耗的预付风险。`,
    );
  }
  const byNewMembers = [...entries].sort(
    (left, right) =>
      (right.summary.metrics.newMembers ?? 0) - (left.summary.metrics.newMembers ?? 0),
  );
  if (byNewMembers.length > 0 && totalNewMembers > 0) {
    const topNewMember = byNewMembers[0];
    lines.push(
      `- 新客贡献：本周期新增会员 ${totalNewMembers} 人，其中 ${topNewMember.summary.storeName} ${topNewMember.summary.metrics.newMembers ?? 0} 人（最多）。`,
    );
  }
  const weakestMemberRepurchase = [...entries]
    .filter((entry) => (entry.summary.metrics.memberRepurchaseBaseCustomerCount7d ?? 0) > 0)
    .sort(
      (left, right) =>
        (left.summary.metrics.memberRepurchaseRate7d ?? 1) -
        (right.summary.metrics.memberRepurchaseRate7d ?? 1),
    )[0];
  if (weakestMemberRepurchase) {
    lines.push(
      `- 老会员复购最弱门店：${weakestMemberRepurchase.summary.storeName} ${formatPercentValue(weakestMemberRepurchase.summary.metrics.memberRepurchaseRate7d ?? null)}（${weakestMemberRepurchase.summary.metrics.memberRepurchaseReturnedCustomerCount7d ?? 0}/${weakestMemberRepurchase.summary.metrics.memberRepurchaseBaseCustomerCount7d ?? 0}）。`,
    );
  }

  const byRisk = [...entries].sort((left, right) => right.riskEntry.score - left.riskEntry.score);
  const mostDangerous = byRisk[0];
  lines.push("最危险门店");
  lines.push(
    `- ${mostDangerous.summary.storeName}，风险分 ${mostDangerous.riskEntry.score.toFixed(1)}（${formatPortfolioRiskLevel(mostDangerous.riskEntry.level)}）。`,
  );
  lines.push(
    `  经营判断：${mostDangerous.businessSignal.levelLabel}（${mostDangerous.businessSignal.tags.join("、")}）。`,
  );
  if (mostDangerous.riskEntry.reasons.length > 0) {
    lines.push(`  主要问题：${mostDangerous.riskEntry.reasons.join("、")}。`);
  }
  lines.push(
    `  关键指标：7天复到店率 ${formatPercentValue(mostDangerous.summary.metrics.groupbuy7dRevisitRate)}，沉默会员率 ${formatPercentValue(mostDangerous.summary.metrics.sleepingMemberRate)}，加钟率 ${formatPercentValue(mostDangerous.summary.metrics.addClockRate)}。`,
  );
  if (
    mostDangerous.summary.metrics.storedBalanceLifeMonths !== undefined ||
    mostDangerous.summary.metrics.renewalPressureIndex30d !== undefined ||
    mostDangerous.summary.metrics.memberRepurchaseRate7d !== undefined
  ) {
    lines.push(
      `  资金与留存：储值寿命 ${mostDangerous.summary.metrics.storedBalanceLifeMonths === undefined || mostDangerous.summary.metrics.storedBalanceLifeMonths === null ? "N/A" : `${(mostDangerous.summary.metrics.storedBalanceLifeMonths ?? 0).toFixed(1)} 个月`}，续费压力 ${mostDangerous.summary.metrics.renewalPressureIndex30d === undefined || mostDangerous.summary.metrics.renewalPressureIndex30d === null ? "N/A" : (mostDangerous.summary.metrics.renewalPressureIndex30d ?? 0).toFixed(2)}，会员7日复购率 ${formatPercentWithCounts(mostDangerous.summary.metrics.memberRepurchaseRate7d ?? null, mostDangerous.summary.metrics.memberRepurchaseReturnedCustomerCount7d ?? 0, mostDangerous.summary.metrics.memberRepurchaseBaseCustomerCount7d ?? 0)}。`,
    );
  }

  if (byRisk.length > 1) {
    lines.push("各店风险排序");
    byRisk.forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${entry.summary.storeName} 风险分 ${entry.riskEntry.score.toFixed(1)}（${formatPortfolioRiskLevel(entry.riskEntry.level)}）`,
      );
    });
  }

  lines.push("下周总部优先动作");
  const priorities = resolveHqNextWeekPriorities(entries);
  priorities.forEach((priority, index) => {
    lines.push(`${index + 1}. ${priority}`);
  });

  return lines.join("\n");
}

export function renderHqPortfolioFocusText(params: {
  label: string;
  entries: StorePerformanceEntry[];
  intent: HetangQueryIntent;
}): string {
  if (params.entries.length === 0) {
    return `${params.label} 暂无可用数据。`;
  }
  const lines: string[] = [];
  const entries = [...params.entries].sort((left, right) => right.riskEntry.score - left.riskEntry.score);
  const frameLabel = entries[0].summary.frame.label;
  const [topEntry] = entries;
  const secondEntry = entries[1] ?? null;

  lines.push(`${params.label} ${frameLabel} 当前重点看什么`);
  lines.push("一、增长结论");
  lines.push(
    `- 当前先盯 ${topEntry.summary.storeName}（风险分 ${topEntry.riskEntry.score.toFixed(1)}${topEntry.riskEntry.reasons.length > 0 ? `，${topEntry.riskEntry.reasons.join("、")}` : ""}）。`,
  );
  if (secondEntry) {
    lines.push(`- 第二关注 ${secondEntry.summary.storeName}（风险分 ${secondEntry.riskEntry.score.toFixed(1)}）。`);
  }

  const lowRepurchaseStores = entries
    .filter((entry) => (entry.summary.metrics.memberRepurchaseRate7d ?? 1) < 0.45)
    .map((entry) => entry.summary.storeName);
  const highSleepingStores = entries
    .filter((entry) => (entry.summary.metrics.sleepingMemberRate ?? 0) >= 0.15)
    .map((entry) => entry.summary.storeName);

  lines.push("二、总部先盯的增长信号");
  lines.push(
    `1. 先看留存：${
      lowRepurchaseStores.length > 0
        ? `${lowRepurchaseStores.join("、")} 会员7日复购偏弱`
        : "当前未识别出明显留存异常"
    }。`,
  );
  lines.push(
    `2. 再看会员资产：${
      highSleepingStores.length > 0
        ? `${highSleepingStores.join("、")} 沉默会员占比偏高`
        : "当前会员资产信号整体平稳"
    }。`,
  );
  lines.push("3. 最后看拉新质量：当前应优先解决高风险门店的承接与留存，再下钻新客转化链路。");

  lines.push("三、总部优先动作");
  resolveHqNextWeekPriorities(entries)
    .slice(0, 3)
    .forEach((priority, index) => {
      lines.push(`${index + 1}. ${priority}`);
    });

  lines.push("四、门店风险排序");
  entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.summary.storeName} | 风险分 ${entry.riskEntry.score.toFixed(1)}`);
    if (entry.riskEntry.reasons.length > 0) {
      lines.push(`   原因：${entry.riskEntry.reasons.join("、")}`);
    }
  });

  return lines.join("\n");
}

export function renderAnomalyText(params: {
  current: StoreWindowSummary;
  previous: StoreWindowSummary;
  metric: ReturnType<typeof resolvePrimarySupportedMetric>;
}): string {
  const currentValue = getMetricNumericValue(params.metric, params.current.metrics) ?? 0;
  const previousValue = getMetricNumericValue(params.metric, params.previous.metrics) ?? 0;
  const change = percentDiff(currentValue, previousValue);

  if (params.metric.key === "serviceRevenue") {
    const currentClock = params.current.metrics.totalClockCount ?? 0;
    const previousClock = params.previous.metrics.totalClockCount ?? 0;
    const currentClockEffect = params.current.metrics.clockEffect ?? 0;
    const previousClockEffect = params.previous.metrics.clockEffect ?? 0;
    const clockChange = percentDiff(currentClock, previousClock);
    const clockEffectChange = percentDiff(currentClockEffect, previousClockEffect);
    const mainDriver =
      Math.abs(clockChange ?? 0) >= Math.abs(clockEffectChange ?? 0)
        ? `主因是总钟数变化（${formatPercentChange(clockChange)}）`
        : `主因是钟效变化（${formatPercentChange(clockEffectChange)}）`;
    const activeTechChange = percentDiff(
      params.current.metrics.activeTechCount ?? 0,
      params.previous.metrics.activeTechCount ?? 0,
    );
    const lines = [
      `${params.current.storeName} ${params.current.frame.label} 营收异常归因`,
      `结论: 营收${change !== null && change < 0 ? "下滑" : "波动"} ${formatPercentChange(change)}，${mainDriver}。`,
      `- 本期服务营收: ${formatCurrency(currentValue)}`,
      `- 对比期服务营收: ${formatCurrency(previousValue)}`,
      `- 本期总钟数: ${round(currentClock, 1)} 钟`,
      `- 对比期总钟数: ${round(previousClock, 1)} 钟`,
      `- 本期钟效: ${round(currentClockEffect, 2).toFixed(2)} 元/钟`,
      `- 对比期钟效: ${round(previousClockEffect, 2).toFixed(2)} 元/钟`,
      `- 本期日均活跃技师: ${round(params.current.metrics.activeTechCount ?? 0, 1)} 人`,
      `- 对比期日均活跃技师: ${round(params.previous.metrics.activeTechCount ?? 0, 1)} 人`,
    ];
    if (activeTechChange !== null && activeTechChange < 0) {
      lines.push(
        `- 辅助判断: 活跃技师下降 ${formatPercentChange(activeTechChange)}，优先排查排班/出勤。`,
      );
    }
    return lines.join("\n");
  }

  return [
    `${params.current.storeName} ${params.current.frame.label} ${params.metric.label}异常归因`,
    `结论: ${params.metric.label}较对比期变动 ${formatPercentChange(change)}。`,
    `- 本期: ${formatMetricValue(params.metric, params.current.metrics)}`,
    `- 对比期: ${formatMetricValue(params.metric, params.previous.metrics)}`,
  ].join("\n");
}

export function formatPercentWithCounts(
  rate: number | null,
  numerator: number,
  denominator: number,
): string {
  if (rate === null || denominator <= 0) {
    return "N/A";
  }
  return `${round(rate * 100, 1).toFixed(1)}%（${numerator}/${denominator}）`;
}

export function formatPercentPointChange(
  current: number | null,
  previous: number | null,
): string {
  if (current === null || previous === null) {
    return "N/A";
  }
  const delta = current - previous;
  return `${delta >= 0 ? "+" : ""}${round(delta * 100, 1).toFixed(1)}pct`;
}

export function renderStorePriorityTradeoffText(params: {
  storeName: string;
  metrics: DailyStoreMetrics;
  previousMetrics?: DailyStoreMetrics;
}): string {
  const metrics = params.metrics;
  const repurchaseRate = metrics.memberRepurchaseRate7d ?? null;
  const repurchaseBase = metrics.memberRepurchaseBaseCustomerCount7d ?? 0;
  const repurchaseWeak = repurchaseBase >= 12 && repurchaseRate !== null && repurchaseRate < 0.45;
  const sleepingRate = metrics.sleepingMemberRate ?? null;
  const sleepingHigh = sleepingRate !== null && sleepingRate >= 0.15;
  const renewalPressure = metrics.renewalPressureIndex30d ?? null;
  const storedBalanceLifeMonths = metrics.storedBalanceLifeMonths ?? null;
  const renewalHigh = renewalPressure !== null && renewalPressure >= 1.25;
  const storedLifeShort =
    storedBalanceLifeMonths !== null &&
    storedBalanceLifeMonths < 3 &&
    (metrics.currentStoredBalance ?? 0) > 0;

  const prioritizeStoredValue =
    (renewalPressure !== null && renewalPressure >= 1.5) ||
    (storedBalanceLifeMonths !== null && storedBalanceLifeMonths < 2.5) ||
    ((renewalHigh || storedLifeShort) && !(repurchaseWeak || sleepingHigh));

  const lines = [`${params.storeName} 当前更该先抓什么`];

  if (prioritizeStoredValue) {
    lines.push("- 结论: 先抓储值和续费。");
    lines.push(
      `- 为什么: 续费压力 ${renewalPressure === null ? "N/A" : round(renewalPressure, 2).toFixed(2)}，储值寿命 ${storedBalanceLifeMonths === null ? "N/A" : `${round(storedBalanceLifeMonths, 1).toFixed(1)} 个月`}，说明近30天耗卡已经在逼近或透支新增充值，当前先补续费收口更急。`,
    );
    lines.push(
      `- 复购侧现状: 会员7日复购率 ${formatPercentWithCounts(repurchaseRate, metrics.memberRepurchaseReturnedCustomerCount7d ?? 0, repurchaseBase)}，沉默会员占比 ${formatPercentValue(sleepingRate)}，老客回流不是最先爆掉的点。`,
    );
    lines.push("今日先抓");
    lines.push("1. 今天先把高耗卡、高余额、最近7天到过店的会员拉名单，前台和客服逐个做续费收口。");
    lines.push("2. 先盯续费理由和卡型结构，不要平均发力，优先守住最容易流失的高余额会员。");
    lines.push("3. 技师端今天少讲泛活动，重点配合前台把续费价值和到店节奏说清楚。");
    return lines.join("\n");
  }

  lines.push("- 结论: 先抓复购和老客回流。");
  lines.push(
    `- 为什么: 会员7日复购率 ${formatPercentWithCounts(repurchaseRate, metrics.memberRepurchaseReturnedCustomerCount7d ?? 0, repurchaseBase)}，沉默会员占比 ${formatPercentValue(sleepingRate)}，说明老客回流已经转弱；人没回来之前，单纯冲储值接不住。`,
  );
  lines.push(
    `- 储值侧现状: 续费压力 ${renewalPressure === null ? "N/A" : round(renewalPressure, 2).toFixed(2)}，储值寿命 ${storedBalanceLifeMonths === null ? "N/A" : `${round(storedBalanceLifeMonths, 1).toFixed(1)} 个月`}，当前还不是最急的现金压力点。`,
  );
  if (
    params.previousMetrics &&
    repurchaseRate !== null &&
    params.previousMetrics.memberRepurchaseRate7d !== null &&
    params.previousMetrics.memberRepurchaseRate7d !== undefined
  ) {
    lines.push(
      `- 辅助判断: 会员7日复购率较上周期 ${formatPercentPointChange(repurchaseRate, params.previousMetrics.memberRepurchaseRate7d ?? null)}。`,
    );
  }
  lines.push("今日先抓");
  lines.push("1. 今天先把上周到店但本周没回来的老会员拉名单，按高价值/普通两档分开打。");
  lines.push("2. 让熟悉技师和客服一起做二次邀约，目标先把人约回来，不是先发券。");
  lines.push("3. 前台今天少讲硬冲储值，先把到店和复购接住，回店后再做开卡和续费收口。");
  return lines.join("\n");
}

function isWeekendBizDate(bizDate: string): boolean {
  const weekday = new Date(`${bizDate}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

function summarizeReportBucket(reports: DailyStoreReport[]): {
  dayCount: number;
  revenue: number;
  averageRevenue: number;
  totalClockCount: number;
  clockEffect: number;
  activeTechCount: number;
  pointClockRate: number | null;
  addClockRate: number | null;
} {
  const dayCount = reports.length;
  const revenue = round(
    reports.reduce(
      (sum, report) =>
        sum + metricNumber((report.metrics ?? {}) as Partial<DailyStoreMetrics>, "serviceRevenue"),
      0,
    ),
    2,
  );
  const totalClockCount = round(
    reports.reduce(
      (sum, report) =>
        sum + metricNumber((report.metrics ?? {}) as Partial<DailyStoreMetrics>, "totalClockCount"),
      0,
    ),
    1,
  );
  const activeTechCount = round(
    reports.reduce(
      (sum, report) =>
        sum + metricNumber((report.metrics ?? {}) as Partial<DailyStoreMetrics>, "activeTechCount"),
      0,
    ) / Math.max(dayCount, 1),
    1,
  );
  const upClockRecordCount = reports.reduce(
    (sum, report) =>
      sum +
      metricNumber((report.metrics ?? {}) as Partial<DailyStoreMetrics>, "upClockRecordCount"),
    0,
  );
  const pointClockRecordCount = reports.reduce(
    (sum, report) =>
      sum +
      metricNumber((report.metrics ?? {}) as Partial<DailyStoreMetrics>, "pointClockRecordCount"),
    0,
  );
  const addClockRecordCount = reports.reduce(
    (sum, report) =>
      sum +
      metricNumber((report.metrics ?? {}) as Partial<DailyStoreMetrics>, "addClockRecordCount"),
    0,
  );
  return {
    dayCount,
    revenue,
    averageRevenue: dayCount > 0 ? round(revenue / dayCount, 2) : 0,
    totalClockCount,
    clockEffect: totalClockCount > 0 ? round(revenue / totalClockCount, 2) : 0,
    activeTechCount,
    pointClockRate: upClockRecordCount > 0 ? pointClockRecordCount / upClockRecordCount : null,
    addClockRate: upClockRecordCount > 0 ? addClockRecordCount / upClockRecordCount : null,
  };
}

function resolveReviewPeriodLead(summary: StoreWindowSummary): string {
  if (summary.frame.kind !== "range") {
    return summary.frame.label;
  }
  return summary.frame.days === 7 ? "本周" : summary.frame.label;
}

function resolveReviewMetricWindowLabel(summary: StoreWindowSummary): string {
  return summary.frame.label;
}

function resolveReviewComparisonLabel(summary: StoreWindowSummary): string {
  return summary.frame.kind === "range" && summary.frame.days === 7 ? "上周" : "上一周期";
}

function describeWeekReviewConclusion(summary: StoreWindowSummary): string[] {
  const firstReport = summary.reports[0];
  const lastReport = summary.reports[summary.reports.length - 1];
  const firstRevenue = metricNumber(
    (firstReport?.metrics ?? {}) as Partial<DailyStoreMetrics>,
    "serviceRevenue",
  );
  const lastRevenue = metricNumber(
    (lastReport?.metrics ?? {}) as Partial<DailyStoreMetrics>,
    "serviceRevenue",
  );
  const firstClockEffect = metricNumber(
    (firstReport?.metrics ?? {}) as Partial<DailyStoreMetrics>,
    "clockEffect",
  );
  const lastClockEffect = metricNumber(
    (lastReport?.metrics ?? {}) as Partial<DailyStoreMetrics>,
    "clockEffect",
  );
  const revenueChange = percentDiff(lastRevenue, firstRevenue);
  const clockEffectChange = percentDiff(lastClockEffect, firstClockEffect);
  const revisitRate = summary.metrics.groupbuy7dRevisitRate;
  const storedValueRate = summary.metrics.groupbuy7dStoredValueConversionRate;
  const highValueRate = summary.metrics.groupbuyFirstOrderHighValueMemberRate;
  const sleepingRate = summary.metrics.sleepingMemberRate;
  const dayCount = Math.max(summary.reports.length, 1);
  const averageRevenue = summary.metrics.serviceRevenue / dayCount;
  const businessSignal = evaluateStoreBusinessScore({
    revenueChange,
    clockEffectChange,
    groupbuy7dRevisitRate: summary.metrics.groupbuy7dRevisitRate,
    groupbuy7dStoredValueConversionRate: summary.metrics.groupbuy7dStoredValueConversionRate,
    groupbuyFirstOrderHighValueMemberRate: summary.metrics.groupbuyFirstOrderHighValueMemberRate,
    sleepingMemberRate: summary.metrics.sleepingMemberRate,
    pointClockRate: summary.metrics.pointClockRate,
    addClockRate: summary.metrics.addClockRate,
  });
  const periodLead = resolveReviewPeriodLead(summary);
  const metricWindowLabel = resolveReviewMetricWindowLabel(summary);

  let headline = `${periodLead}整体基本盘还在，但转化承接和人员产能需要一起盯。`;
  if ((revenueChange ?? 0) <= -0.08 && (clockEffectChange ?? 0) <= 0) {
    headline = `${periodLead}营收走弱，核心不是一句“客流不好”就能糊弄过去，接待效率和后续转化都在掉。`;
  } else if ((revisitRate ?? 0) < 0.4 && (storedValueRate ?? 0) < 0.2) {
    headline = `${periodLead}最大问题不在引流，而在团购首单后的承接，客人来了，但没有被稳稳留下来。`;
  } else if ((highValueRate ?? 0) >= 0.3 && (sleepingRate ?? 0) < 0.12) {
    headline = `${periodLead}经营质量还不错，说明门店已经不只是做成交，还在把首单客往高价值会员上推。`;
  }

  const pressureBits: string[] = [];
  if ((revisitRate ?? 0) < 0.4) {
    pressureBits.push("7天复到店偏弱");
  }
  if ((storedValueRate ?? 0) < 0.2) {
    pressureBits.push("储值承接偏弱");
  }
  if ((summary.metrics.renewalPressureIndex30d ?? 0) >= 1.5) {
    pressureBits.push("续费压力偏高");
  }
  if (
    summary.metrics.storedBalanceLifeMonths !== undefined &&
    summary.metrics.storedBalanceLifeMonths !== null &&
    summary.metrics.storedBalanceLifeMonths < 3
  ) {
    pressureBits.push("储值寿命偏短");
  }
  if ((sleepingRate ?? 0) >= 0.15) {
    pressureBits.push("沉默会员占比偏高");
  }
  if ((summary.metrics.addClockRate ?? 0) < 0.3) {
    pressureBits.push("加钟承接偏弱");
  }

  return [
    "结论摘要",
    `- ${headline}`,
    `- 门店经营判断: ${businessSignal.levelLabel}（${businessSignal.tags.join("、")}）`,
    `- ${metricWindowLabel}服务营收 ${formatCurrency(summary.metrics.serviceRevenue)}，日均 ${formatCurrency(averageRevenue)}；区间首末日营收变化 ${formatPercentChange(revenueChange)}，钟效变化 ${formatPercentChange(clockEffectChange)}。`,
    `- 当前最需要店长盯住的不是“感觉”，而是 ${pressureBits.length > 0 ? pressureBits.join("、") : "营收、会员、技师三条线的持续配合"}。`,
    `- 当前经营优先级: ${businessSignal.actionPriority}`,
  ];
}

function describeWeekReviewComparison(
  summary: StoreWindowSummary,
  comparisonSummary?: StoreWindowSummary,
): string[] {
  if (!comparisonSummary) {
    return [];
  }
  const comparisonLabel = resolveReviewComparisonLabel(summary);

  return [
    `${comparisonLabel}对比`,
    `- 服务营收 ${formatCurrency(summary.metrics.serviceRevenue)}，较${comparisonLabel} ${formatPercentChange(percentDiff(summary.metrics.serviceRevenue, comparisonSummary.metrics.serviceRevenue))}。`,
    `- 总钟数 ${round(summary.metrics.totalClockCount, 1)} 钟，较${comparisonLabel} ${formatPercentChange(percentDiff(summary.metrics.totalClockCount, comparisonSummary.metrics.totalClockCount))}；钟效 ${round(summary.metrics.clockEffect, 2).toFixed(2)} 元/钟，较${comparisonLabel} ${formatPercentChange(percentDiff(summary.metrics.clockEffect, comparisonSummary.metrics.clockEffect))}。`,
    `- 7天复到店率 ${summary.metrics.groupbuy7dRevisitRate === null ? "N/A" : `${round(summary.metrics.groupbuy7dRevisitRate * 100, 1).toFixed(1)}%`}，较${comparisonLabel} ${formatPercentPointChange(summary.metrics.groupbuy7dRevisitRate, comparisonSummary.metrics.groupbuy7dRevisitRate)}；7天储值转化率 ${summary.metrics.groupbuy7dStoredValueConversionRate === null ? "N/A" : `${round(summary.metrics.groupbuy7dStoredValueConversionRate * 100, 1).toFixed(1)}%`}，较${comparisonLabel} ${formatPercentPointChange(summary.metrics.groupbuy7dStoredValueConversionRate, comparisonSummary.metrics.groupbuy7dStoredValueConversionRate)}。`,
  ];
}

function describeWeekdayWeekendBreakdown(summary: StoreWindowSummary): string[] {
  const weekdayReports = summary.reports.filter((report) => !isWeekendBizDate(report.bizDate));
  const weekendReports = summary.reports.filter((report) => isWeekendBizDate(report.bizDate));
  const weekday = summarizeReportBucket(weekdayReports);
  const weekend = summarizeReportBucket(weekendReports);

  const lines = ["工作日 vs 周末"];
  lines.push(
    `- 工作日: ${weekday.dayCount} 天，营收 ${formatCurrency(weekday.revenue)}，日均 ${formatCurrency(weekday.averageRevenue)}，钟效 ${weekday.clockEffect.toFixed(2)} 元/钟，加钟率 ${weekday.addClockRate === null ? "N/A" : `${round(weekday.addClockRate * 100, 1).toFixed(1)}%`}。`,
  );
  lines.push(
    `- 周末: ${weekend.dayCount} 天，营收 ${formatCurrency(weekend.revenue)}，日均 ${formatCurrency(weekend.averageRevenue)}，钟效 ${weekend.clockEffect.toFixed(2)} 元/钟，加钟率 ${weekend.addClockRate === null ? "N/A" : `${round(weekend.addClockRate * 100, 1).toFixed(1)}%`}。`,
  );

  if (weekday.dayCount === 0 || weekend.dayCount === 0) {
    lines.push("- 诊断: 当前样本还不足以拆出稳定的工作日/周末差异。");
    return lines;
  }

  if (weekend.averageRevenue <= weekday.averageRevenue * 1.05) {
    lines.push("- 诊断: 周末没有把营收明显拉高，说明高峰时段排班和现场承接还没吃满。");
  } else if (weekend.clockEffect < weekday.clockEffect) {
    lines.push("- 诊断: 周末客流起来了，但钟效没同步抬升，容易出现“忙但不够赚”的情况。");
  } else {
    lines.push("- 诊断: 周末放大效果还不错，下一步重点是把高峰时段的好表现复制回工作日。");
  }
  return lines;
}

function describeWeekReviewFunnel(summary: StoreWindowSummary): string[] {
  const cohort = summary.metrics.groupbuyCohortCustomerCount;
  const firstOrderCustomerCount = summary.metrics.groupbuyFirstOrderCustomerCount;
  const lines = ["转化漏斗"];
  lines.push(
    `- 7天复到店率: ${formatPercentWithCounts(summary.metrics.groupbuy7dRevisitRate, summary.metrics.groupbuy7dRevisitCustomerCount, cohort)}`,
  );
  lines.push(
    `- 7天开卡率: ${formatPercentWithCounts(summary.metrics.groupbuy7dCardOpenedRate, summary.metrics.groupbuy7dCardOpenedCustomerCount, cohort)}`,
  );
  lines.push(
    `- 7天储值转化率: ${formatPercentWithCounts(summary.metrics.groupbuy7dStoredValueConversionRate, summary.metrics.groupbuy7dStoredValueConvertedCustomerCount, cohort)}`,
  );
  lines.push(
    `- 30天会员消费转化率: ${formatPercentWithCounts(summary.metrics.groupbuy30dMemberPayConversionRate, summary.metrics.groupbuy30dMemberPayConvertedCustomerCount, cohort)}`,
  );
  lines.push(
    `- 团购首单客转高价值会员率: ${formatPercentWithCounts(summary.metrics.groupbuyFirstOrderHighValueMemberRate, summary.metrics.groupbuyFirstOrderHighValueMemberCustomerCount, firstOrderCustomerCount)}`,
  );

  if ((summary.metrics.groupbuy7dRevisitRate ?? 0) < 0.4) {
    lines.push("- 诊断: 团购首单后的7天承接偏弱，当前瓶颈是复到店，而不是继续堆低价流量。");
  } else if ((summary.metrics.groupbuy7dStoredValueConversionRate ?? 0) < 0.2) {
    lines.push("- 诊断: 客人愿意回来，但开卡和储值承接还不够，前台与技师联动要更主动。");
  } else {
    lines.push("- 诊断: 团购漏斗承接基本在线，可以继续放大高价值会员沉淀。");
  }

  return lines;
}

function describeWeekReviewMembership(summary: StoreWindowSummary): string[] {
  const lines = ["会员经营"];
  const metricWindowLabel = resolveReviewMetricWindowLabel(summary);
  lines.push(
    `- ${metricWindowLabel}新增会员 ${summary.metrics.newMembers} 人，当前有效会员 ${summary.metrics.effectiveMembers} 人，沉默会员 ${summary.metrics.sleepingMembers} 人，沉默率 ${summary.metrics.sleepingMemberRate === null ? "N/A" : `${round(summary.metrics.sleepingMemberRate * 100, 1).toFixed(1)}%`}。`,
  );
  lines.push(
    `- 当前储值余额 ${formatCurrency(summary.metrics.currentStoredBalance)}，储值寿命 ${summary.metrics.storedBalanceLifeMonths === undefined || summary.metrics.storedBalanceLifeMonths === null ? "N/A" : `${round(summary.metrics.storedBalanceLifeMonths, 1).toFixed(1)} 个月`}，续费压力 ${summary.metrics.renewalPressureIndex30d === undefined || summary.metrics.renewalPressureIndex30d === null ? "N/A" : round(summary.metrics.renewalPressureIndex30d, 2).toFixed(2)}。`,
  );
  lines.push(
    `- 会员7日复购率 ${formatPercentWithCounts(summary.metrics.memberRepurchaseRate7d ?? null, summary.metrics.memberRepurchaseReturnedCustomerCount7d ?? 0, summary.metrics.memberRepurchaseBaseCustomerCount7d ?? 0)}。`,
  );
  if ((summary.metrics.sleepingMemberRate ?? 0) >= 0.15) {
    lines.push("- 诊断: 老会员盘子不算小，但沉默会员占比已经偏高，说明召回和回访节奏需要收紧。");
  } else if ((summary.metrics.renewalPressureIndex30d ?? 0) >= 1.5) {
    lines.push(
      "- 诊断: 当前耗卡速度已经追上甚至超过新增充值，续费和耗卡节奏要一起盯，避免余额池提前见底。",
    );
  } else if (
    summary.metrics.storedBalanceLifeMonths !== undefined &&
    summary.metrics.storedBalanceLifeMonths !== null &&
    summary.metrics.storedBalanceLifeMonths < 3
  ) {
    lines.push("- 诊断: 当前储值寿命已经偏短，说明现金池安全垫不厚，会员续费动作要前置。");
  } else {
    lines.push("- 诊断: 会员盘相对健康，重点从“拉新”转到“把高潜会员往复购和储值上推”。");
  }
  return lines;
}

function describeWeekReviewMemberProblems(
  summary: StoreWindowSummary,
  comparisonSummary?: StoreWindowSummary,
): string[] {
  const lines = ["会员侧问题"];
  const problems: string[] = [];
  const comparisonLabel = resolveReviewComparisonLabel(summary);

  if ((summary.metrics.groupbuy7dRevisitRate ?? 0) < 0.4) {
    problems.push(
      `团购7天复到店率只有 ${summary.metrics.groupbuy7dRevisitRate === null ? "N/A" : `${round(summary.metrics.groupbuy7dRevisitRate * 100, 1).toFixed(1)}%`}，首单客二次回流偏弱。`,
    );
  }
  if ((summary.metrics.groupbuy7dStoredValueConversionRate ?? 0) < 0.2) {
    problems.push(
      `7天储值转化率只有 ${summary.metrics.groupbuy7dStoredValueConversionRate === null ? "N/A" : `${round(summary.metrics.groupbuy7dStoredValueConversionRate * 100, 1).toFixed(1)}%`}，前台和技师的收口动作还不够硬。`,
    );
  }
  if ((summary.metrics.sleepingMemberRate ?? 0) >= 0.15) {
    problems.push(
      `沉默会员占比 ${summary.metrics.sleepingMemberRate === null ? "N/A" : `${round(summary.metrics.sleepingMemberRate * 100, 1).toFixed(1)}%`}，老会员盘已经开始变冷。`,
    );
  }
  if ((summary.metrics.groupbuyFirstOrderHighValueMemberRate ?? 0) < 0.3) {
    problems.push(
      `团购首单客转高价值会员率仅 ${summary.metrics.groupbuyFirstOrderHighValueMemberRate === null ? "N/A" : `${round(summary.metrics.groupbuyFirstOrderHighValueMemberRate * 100, 1).toFixed(1)}%`}，高价值沉淀偏慢。`,
    );
  }
  if ((summary.metrics.renewalPressureIndex30d ?? 0) >= 1.5) {
    problems.push(
      `续费压力 ${summary.metrics.renewalPressureIndex30d === undefined || summary.metrics.renewalPressureIndex30d === null ? "N/A" : round(summary.metrics.renewalPressureIndex30d, 2).toFixed(2)}，近30天耗卡已经逼近或超过新增充值。`,
    );
  }
  if (
    summary.metrics.storedBalanceLifeMonths !== undefined &&
    summary.metrics.storedBalanceLifeMonths !== null &&
    summary.metrics.storedBalanceLifeMonths < 3
  ) {
    problems.push(
      `储值寿命只剩 ${round(summary.metrics.storedBalanceLifeMonths, 1).toFixed(1)} 个月，余额池安全垫偏薄。`,
    );
  }
  if (
    summary.metrics.memberRepurchaseRate7d !== undefined &&
    summary.metrics.memberRepurchaseRate7d !== null &&
    summary.metrics.memberRepurchaseBaseCustomerCount7d &&
    summary.metrics.memberRepurchaseRate7d < 0.45
  ) {
    problems.push(
      `会员7日复购率 ${round(summary.metrics.memberRepurchaseRate7d * 100, 1).toFixed(1)}%（${summary.metrics.memberRepurchaseReturnedCustomerCount7d ?? 0}/${summary.metrics.memberRepurchaseBaseCustomerCount7d}），老会员二次回流还不够稳。`,
    );
  }

  if (problems.length === 0) {
    lines.push("- 当前会员侧没有明显硬伤，重点继续稳住复购和储值承接。");
  } else {
    problems.forEach((problem) => lines.push(`- ${problem}`));
  }

  if (
    comparisonSummary &&
    (summary.metrics.groupbuy7dRevisitRate ?? 0) <
      (comparisonSummary.metrics.groupbuy7dRevisitRate ?? 0)
  ) {
    lines.push(
      `- 辅助判断: 7天复到店率较${comparisonLabel} ${formatPercentPointChange(summary.metrics.groupbuy7dRevisitRate, comparisonSummary.metrics.groupbuy7dRevisitRate)}，说明首单承接在继续走弱。`,
    );
  }

  return lines;
}

function describeWeekReviewTechnician(summary: StoreWindowSummary): string[] {
  const lines = ["技师经营"];
  const metricWindowLabel = resolveReviewMetricWindowLabel(summary);
  lines.push(
    `- ${metricWindowLabel}总钟数 ${round(summary.metrics.totalClockCount, 1)} 钟，日均活跃技师 ${round(summary.metrics.activeTechCount, 1)} 人，点钟率 ${summary.metrics.pointClockRate === null ? "N/A" : `${round(summary.metrics.pointClockRate * 100, 1).toFixed(1)}%`}，加钟率 ${summary.metrics.addClockRate === null ? "N/A" : `${round(summary.metrics.addClockRate * 100, 1).toFixed(1)}%`}。`,
  );
  if ((summary.metrics.pointClockRate ?? 0) >= 0.5 && (summary.metrics.addClockRate ?? 0) < 0.3) {
    lines.push(
      "- 诊断: 门店有能被顾客点名的技师，但加钟承接还不够，说明服务设计和现场引导还有提升空间。",
    );
  } else if ((summary.metrics.pointClockRate ?? 0) < 0.45) {
    lines.push("- 诊断: 技师个人吸引力偏弱，点钟和复购关系都需要靠服务体验和客情经营补上。");
  } else {
    lines.push("- 诊断: 技师侧整体稳定，下一步重点是把高点钟率转成更高钟效。");
  }
  return lines;
}

function describeWeekReviewTechnicianProblems(
  summary: StoreWindowSummary,
  comparisonSummary?: StoreWindowSummary,
): string[] {
  const lines = ["技师侧问题"];
  const problems: string[] = [];
  const comparisonLabel = resolveReviewComparisonLabel(summary);

  if ((summary.metrics.addClockRate ?? 0) < 0.3) {
    problems.push(
      `加钟率只有 ${summary.metrics.addClockRate === null ? "N/A" : `${round(summary.metrics.addClockRate * 100, 1).toFixed(1)}%`}，服务后半程的收口能力还不够。`,
    );
  }
  if ((summary.metrics.pointClockRate ?? 0) < 0.45) {
    problems.push(
      `点钟率只有 ${summary.metrics.pointClockRate === null ? "N/A" : `${round(summary.metrics.pointClockRate * 100, 1).toFixed(1)}%`}，指定客和个人吸引力还要继续养。`,
    );
  }
  if (
    comparisonSummary &&
    (summary.metrics.activeTechCount ?? 0) < (comparisonSummary.metrics.activeTechCount ?? 0)
  ) {
    problems.push(
      `日均活跃技师 ${round(summary.metrics.activeTechCount ?? 0, 1)} 人，较${comparisonLabel} ${formatPercentChange(percentDiff(summary.metrics.activeTechCount ?? 0, comparisonSummary.metrics.activeTechCount ?? 0))}，排班和出勤要继续盯。`,
    );
  }

  const weekdayReports = summary.reports.filter((report) => !isWeekendBizDate(report.bizDate));
  const weekendReports = summary.reports.filter((report) => isWeekendBizDate(report.bizDate));
  const weekday = summarizeReportBucket(weekdayReports);
  const weekend = summarizeReportBucket(weekendReports);
  if (weekday.dayCount > 0 && weekend.dayCount > 0 && weekend.clockEffect <= weekday.clockEffect) {
    problems.push("周末钟效没有明显拉开，高峰时段的项目搭配和排班仍有浪费。");
  }

  if (problems.length === 0) {
    lines.push("- 当前技师侧整体稳定，重点继续把点钟优势转成更高钟效和更强复购。");
  } else {
    problems.forEach((problem) => lines.push(`- ${problem}`));
  }
  return lines;
}

function describeWeekReviewActions(summary: StoreWindowSummary): string[] {
  const latestSuggestions =
    summary.reports[summary.reports.length - 1]?.suggestions?.filter((entry) => entry.trim()) ?? [];
  const lines = ["店长动作建议"];
  if (latestSuggestions.length > 0) {
    latestSuggestions.forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry}`);
    });
    return lines;
  }

  lines.push("1. 先拉出近7天未复到店的团购客名单，按今天、明天两批完成回访。");
  lines.push("2. 晚场优先排点钟率高、加钟承接强的技师，先保钟效，再谈拉新。");
  lines.push("3. 对沉默会员按消费层级分组，先救高价值沉默会员，再做广撒网触达。");
  return lines;
}

function describeWeekReviewMustDoActions(summary: StoreWindowSummary): string[] {
  const latestSuggestions =
    summary.reports[summary.reports.length - 1]?.suggestions?.filter((entry) => entry.trim()) ?? [];
  const actions: string[] = [];

  if (latestSuggestions[0]) {
    actions.push(`1. ${latestSuggestions[0]}`);
  } else if ((summary.metrics.groupbuy7dRevisitRate ?? 0) < 0.4) {
    actions.push("1. 今天先把近7天未复到店的团购客全部拉名单，按今天/明天两批完成1对1回访。");
  } else {
    actions.push("1. 继续盯紧团购首单客的7天承接，不让首单客在第二次到店前失联。");
  }

  if (latestSuggestions[1]) {
    actions.push(`2. ${latestSuggestions[1]}`);
  } else if (
    (summary.metrics.addClockRate ?? 0) < 0.3 ||
    (summary.metrics.pointClockRate ?? 0) < 0.45
  ) {
    actions.push("2. 晚场和周末把点钟率高、加钟承接强的技师排到前排，服务后半程统一加钟收口话术。");
  } else {
    actions.push("2. 把点钟率好的技师放到高峰班次，继续把高点钟率放大成更高钟效。");
  }

  if ((summary.metrics.sleepingMemberRate ?? 0) >= 0.15) {
    actions.push("3. 把沉默会员按高价值/普通分层，先救高价值沉默会员，再做普通老客提醒。");
  } else {
    actions.push("3. 从本期高潜会员里挑出一批重点客户，安排店长和技师联合做二次邀约。");
  }

  return [
    summary.frame.kind === "range" && summary.frame.days === 7
      ? "本周3个必须动作"
      : "本期3个必须动作",
    ...actions,
  ];
}

export function renderWindowReportText(
  summary: StoreWindowSummary,
  comparisonSummary?: StoreWindowSummary,
): string {
  if (summary.frame.kind === "single") {
    const latest = summary.reports[summary.reports.length - 1];
    if (latest && !latest.complete) {
      return [
        `${summary.storeName} ${latest.bizDate} 营业日数据尚未完成同步，当前不输出正式日报。`,
        ...latest.alerts.map((alert) => `- ${alert.message}`),
      ].join("\n");
    }
    return latest?.markdown ?? `${summary.storeName} ${summary.frame.label} 暂无日报。`;
  }

  return [
    `${summary.storeName} ${summary.frame.label} 经营复盘`,
    ...describeWeekReviewConclusion(summary),
    ...describeWeekReviewComparison(summary, comparisonSummary),
    ...describeWeekdayWeekendBreakdown(summary),
    ...describeWeekReviewFunnel(summary),
    ...describeWeekReviewMembership(summary),
    ...describeWeekReviewMemberProblems(summary, comparisonSummary),
    ...describeWeekReviewTechnician(summary),
    ...describeWeekReviewTechnicianProblems(summary, comparisonSummary),
    ...renderRiskAdviceText({
      summary,
      intent: {
        rawText: "",
        kind: "report",
        explicitOrgIds: [summary.orgId],
        allStoresRequested: false,
        timeFrame: summary.frame,
        metrics: [],
        unsupportedMetrics: [],
        mentionsCompareKeyword: false,
        mentionsRankingKeyword: false,
        mentionsTrendKeyword: false,
        mentionsAnomalyKeyword: false,
        mentionsRiskKeyword: true,
        mentionsAdviceKeyword: true,
        mentionsReportKeyword: true,
        semanticSlots: {
          store: {
            scope: "single",
            orgIds: [summary.orgId],
          },
          object: "store",
          action: "report",
          metricKeys: [],
          time: {
            kind: "range",
            startBizDate: summary.frame.startBizDate,
            endBizDate: summary.frame.endBizDate,
            label: summary.frame.label,
            days: summary.frame.days,
          },
        },
      },
    }).split("\n"),
    ...describeWeekReviewActions(summary),
    ...describeWeekReviewMustDoActions(summary),
  ].join("\n");
}

export function shouldUseSingleDayDailyKpiFastPath(intent: HetangQueryIntent): boolean {
  return (
    intent.kind === "report" &&
    intent.timeFrame.kind === "single" &&
    !/(日报|报表|报告)/u.test(intent.rawText) &&
    /(经营情况|经营怎么样|经营如何|业绩怎么样|业绩如何|业绩情况|生意怎么样|生意如何|复盘|总结)/u.test(
      intent.rawText,
    )
  );
}

function resolveDailyKpiInsight(row: StoreManagerDailyKpiRow): string {
  if (row.pointClockRate === null) {
    return "当前还拿不到完整点钟率，先结合前台分单和技师指定承接做人工复核。";
  }
  if (row.pointClockRate < 0.2) {
    return "点钟承接偏弱，今天先盯前台分单和技师指定承接，别让高意向客人默认滑进排钟。";
  }
  if (row.pointClockRate < 0.35) {
    return "点钟承接还有提升空间，建议把高点钟技师放到高峰班次，前台同步加强指定推荐。";
  }
  if (
    row.dailyOrderCount >= 50 &&
    row.dailyActualRevenue / Math.max(row.dailyOrderCount, 1) < 220
  ) {
    return "客流不差，但客单价还有空间，今天重点盯套餐升级和加钟收口。";
  }
  return "整体盘子基本稳住，继续盯点钟承接和高峰时段的客单放大，别让好流量白白流走。";
}

export function renderSingleDayDailyKpiText(row: StoreManagerDailyKpiRow): string {
  return [
    `${row.storeName} ${row.bizDate} 经营复盘`,
    `- 实收流水：${formatCurrency(row.dailyActualRevenue)}`,
    `- 耗卡金额：${formatCurrency(row.dailyCardConsume)}`,
    `- 进店单数：${Math.round(row.dailyOrderCount)} 单`,
    `- 总上钟数：${formatCount(row.totalClocks)} 个`,
    `- 点钟/排钟：${formatCount(row.assignClocks)} / ${formatCount(row.queueClocks)}`,
    `- 门店点钟率：${formatPercentValue(row.pointClockRate)}`,
    `- 参谋洞察：${resolveDailyKpiInsight(row)}`,
  ].join("\n");
}

export function renderTechRankingText(params: {
  storeName: string;
  frame: HetangQueryTimeFrame;
  metric: ReturnType<typeof resolvePrimarySupportedMetric>;
  rows: TechLeaderboardRow[];
}): string {
  const title = `${params.storeName} ${params.frame.kind === "single" ? params.frame.bizDate : params.frame.label} 技师${params.metric.label}排名`;
  const lines = [title];
  params.rows.forEach((row, index) => {
    if (params.metric.key === "pointClockRate") {
      lines.push(
        `${index + 1}. ${row.personName} ${row.pointClockRate === null ? "N/A" : `${round(row.pointClockRate * 100, 1).toFixed(1)}%`}（${row.pointClockRecordCount}/${row.upClockRecordCount}）`,
      );
      return;
    }
    if (params.metric.key === "addClockRate") {
      lines.push(
        `${index + 1}. ${row.personName} ${row.addClockRate === null ? "N/A" : `${round(row.addClockRate * 100, 1).toFixed(1)}%`}（${row.addClockRecordCount}/${row.upClockRecordCount}）`,
      );
      return;
    }
    if (params.metric.key === "totalClockCount") {
      lines.push(`${index + 1}. ${row.personName} ${round(row.totalClockCount, 1)} 钟`);
      return;
    }
    if (params.metric.key === "techCommissionRate") {
      lines.push(
        `${index + 1}. ${row.personName} ${row.commissionRate === null ? "N/A" : `${round(row.commissionRate * 100, 1).toFixed(1)}%`}`,
      );
      return;
    }
    if (params.metric.key === "serviceRevenue") {
      lines.push(`${index + 1}. ${row.personName} ${formatCurrency(row.turnover)}`);
      return;
    }
    if (params.metric.key === "clockEffect") {
      lines.push(`${index + 1}. ${row.personName} ${round(row.clockEffect ?? 0, 2).toFixed(2)} 元/钟`);
      return;
    }
    if (params.metric.key === "marketRevenue") {
      lines.push(`${index + 1}. ${row.personName} ${formatCurrency(row.marketRevenue)}`);
      return;
    }
    lines.push(`${index + 1}. ${row.personName} ${formatCurrency(row.turnover)}`);
  });
  return lines.join("\n");
}

export function pickPrimaryMetric(intent: HetangQueryIntent) {
  const resolution = resolveMetricResolution(intent);
  return resolvePrimarySupportedMetric(resolution);
}

export function resolveTechMetricScore(
  metric: ReturnType<typeof resolvePrimarySupportedMetric>,
  row: TechLeaderboardRow,
): number {
  switch (metric.key) {
    case "pointClockRate":
      return row.pointClockRate ?? -1;
    case "addClockRate":
      return row.addClockRate ?? -1;
    case "totalClockCount":
      return row.totalClockCount;
    case "techCommissionRate":
      return row.commissionRate ?? -1;
    case "clockEffect":
      return row.clockEffect ?? -1;
    case "marketRevenue":
      return row.marketRevenue;
    case "serviceRevenue":
    default:
      return row.turnover;
  }
}
