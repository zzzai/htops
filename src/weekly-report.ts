import { shiftBizDate } from "./time.js";
import { buildWeeklyReportWorldModelLines } from "./world-model/rendering.js";
import type { DailyStoreReport } from "./types.js";
import type { OperatingWorldIndustryObservation } from "./world-model/types.js";
import {
  buildWeeklyStoreChartDataset,
  type WeeklyStoreChartSignal,
  type WeeklyStoreChartStore,
} from "./weekly-chart-image.js";

export type WeeklyStoreReportInput = {
  orgId: string;
  storeName: string;
  currentReports: DailyStoreReport[];
  previousReports: DailyStoreReport[];
};

type WeeklyAggregate = {
  revenue: number;
  customerCount: number;
  serviceOrders: number;
  totalClocks: number;
  averageTicket: number;
  clockEffect: number;
  addClockRate: number | null;
  pointClockRate: number | null;
  groupbuy7dRevisitRate: number | null;
  sleepingMemberRate: number | null;
  netMarginRate: number | null;
  newMembers: number;
  rechargeCash: number;
  completeDays: number;
  totalDays: number;
};

type WeeklyStoreDigest = {
  orgId: string;
  storeName: string;
  shortName: string;
  current: WeeklyAggregate;
  previous: WeeklyAggregate;
  revenueDelta: number;
  customerDelta: number;
  clockEffectDelta: number;
  addClockRateDelta: number | null;
  groupbuy7dRevisitRateDelta: number | null;
  sleepingMemberRateDelta: number | null;
  netMarginRateDelta: number | null;
};

type WeeklyBenchmarks = {
  revenueMedian: number;
  customerCountMedian: number;
  clockEffectMedian: number;
  averageTicketMedian: number;
  addClockRateMedian: number | null;
  groupbuy7dRevisitRateMedian: number | null;
  sleepingMemberRateMedian: number | null;
  netMarginRateMedian: number | null;
};

type SignalCandidate = {
  key: string;
  score: number;
  text: string;
};

type ActionCandidate = SignalCandidate & {
  watchItems: string[];
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 10000) {
    return `¥${round(value / 10000, 1).toFixed(1)}万`;
  }
  return `¥${round(value, 0).toFixed(0)}`;
}

function formatSignedCurrency(value: number): string {
  if (value === 0) {
    return formatCurrency(0);
  }
  return `${value > 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${round(value * 100, 1).toFixed(1)}%`;
}

function formatPercentPointDelta(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  const points = round(Math.abs(value) * 100, 1).toFixed(1);
  if (value === 0) {
    return "0.0个点";
  }
  return `${value > 0 ? "+" : "-"}${points}个点`;
}

function formatCount(value: number): string {
  return round(value, 0).toFixed(0);
}

function formatSignedCount(value: number, suffix = ""): string {
  const rounded = round(value, 0);
  if (rounded > 0) {
    return `+${rounded.toFixed(0)}${suffix}`;
  }
  if (rounded < 0) {
    return `${rounded.toFixed(0)}${suffix}`;
  }
  return `0${suffix}`;
}

function pickLatestNullableNumber(
  reports: DailyStoreReport[],
  getter: (report: DailyStoreReport) => number | null | undefined,
): number | null {
  for (const report of [...reports].reverse()) {
    const value = getter(report);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function aggregateWeeklyReports(reports: DailyStoreReport[]): WeeklyAggregate {
  const revenue = round(reports.reduce((sum, report) => sum + report.metrics.serviceRevenue, 0), 2);
  const customerCount = round(reports.reduce((sum, report) => sum + report.metrics.customerCount, 0), 2);
  const serviceOrders = round(
    reports.reduce((sum, report) => sum + report.metrics.serviceOrderCount, 0),
    2,
  );
  const totalClocks = round(
    reports.reduce((sum, report) => sum + report.metrics.totalClockCount, 0),
    2,
  );
  const upClockRecords = round(
    reports.reduce((sum, report) => sum + report.metrics.upClockRecordCount, 0),
    2,
  );
  const addClockRecords = round(
    reports.reduce((sum, report) => sum + report.metrics.addClockRecordCount, 0),
    2,
  );
  const pointClockRecords = round(
    reports.reduce((sum, report) => sum + report.metrics.pointClockRecordCount, 0),
    2,
  );

  return {
    revenue,
    customerCount,
    serviceOrders,
    totalClocks,
    averageTicket: customerCount > 0 ? round(revenue / customerCount, 2) : 0,
    clockEffect: totalClocks > 0 ? round(revenue / totalClocks, 2) : 0,
    addClockRate: upClockRecords > 0 ? round(addClockRecords / upClockRecords, 4) : null,
    pointClockRate: upClockRecords > 0 ? round(pointClockRecords / upClockRecords, 4) : null,
    groupbuy7dRevisitRate: pickLatestNullableNumber(
      reports,
      (report) => report.metrics.groupbuy7dRevisitRate,
    ),
    sleepingMemberRate: pickLatestNullableNumber(
      reports,
      (report) => report.metrics.sleepingMemberRate,
    ),
    netMarginRate: pickLatestNullableNumber(reports, (report) => report.metrics.netMarginRate),
    newMembers: round(reports.reduce((sum, report) => sum + report.metrics.newMembers, 0), 2),
    rechargeCash: round(reports.reduce((sum, report) => sum + report.metrics.rechargeCash, 0), 2),
    completeDays: reports.filter((report) => report.complete).length,
    totalDays: reports.length,
  };
}

function nullableDiff(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) {
    return null;
  }
  return round(current - previous, 4);
}

function resolveShortStoreName(storeName: string): string {
  const trimmed = storeName.replace(/^荷塘悦色/, "").trim();
  return trimmed.endsWith("店") ? trimmed.slice(0, -1) : trimmed;
}

function medianNumber(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return round((sorted[middle - 1] + sorted[middle]) / 2, 4);
  }
  return round(sorted[middle] ?? 0, 4);
}

function medianNullableNumber(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return numbers.length > 0 ? medianNumber(numbers) : null;
}

function compareToMedian(current: number | null, median: number | null): number | null {
  if (current === null || median === null) {
    return null;
  }
  return round(current - median, 4);
}

function sortCandidates<T extends SignalCandidate>(candidates: T[]): T[] {
  return candidates.sort((left, right) => right.score - left.score);
}

function applyKeyBoosts<T extends SignalCandidate>(
  candidates: T[],
  boostedKeys: string[],
  boost = 100000,
): T[] {
  if (boostedKeys.length === 0) {
    return sortCandidates(candidates);
  }
  return sortCandidates(
    candidates.map((candidate) =>
      boostedKeys.includes(candidate.key)
        ? {
            ...candidate,
            score: candidate.score + boost,
          }
        : candidate,
    ),
  );
}

function assignUniqueCandidates<T extends SignalCandidate>(
  stores: Array<{ id: string; candidates: T[] }>,
  options?: { minUniqueScoreRatio?: number },
): Map<string, T> {
  const assigned = new Map<string, T>();
  const usedKeys = new Set<string>();
  const minUniqueScoreRatio = options?.minUniqueScoreRatio ?? 0;
  const ordered = [...stores].sort(
    (left, right) => (right.candidates[0]?.score ?? Number.NEGATIVE_INFINITY) - (left.candidates[0]?.score ?? Number.NEGATIVE_INFINITY),
  );

  for (const store of ordered) {
    const top = store.candidates[0];
    const unique = store.candidates.find((candidate) => !usedKeys.has(candidate.key));
    const canUseUnique =
      unique &&
      top &&
      unique.key !== top.key &&
      unique.score >= top.score * minUniqueScoreRatio;
    const pick = canUseUnique ? unique : top ?? unique;
    if (!pick) {
      continue;
    }
    assigned.set(store.id, pick);
    usedKeys.add(pick.key);
  }

  return assigned;
}

function buildBaseStoreDigest(store: WeeklyStoreReportInput): WeeklyStoreDigest {
  const current = aggregateWeeklyReports(store.currentReports);
  const previous = aggregateWeeklyReports(store.previousReports);

  return {
    orgId: store.orgId,
    storeName: store.storeName,
    shortName: resolveShortStoreName(store.storeName),
    current,
    previous,
    revenueDelta: round(current.revenue - previous.revenue, 2),
    customerDelta: round(current.customerCount - previous.customerCount, 2),
    clockEffectDelta: round(current.clockEffect - previous.clockEffect, 2),
    addClockRateDelta: nullableDiff(current.addClockRate, previous.addClockRate),
    groupbuy7dRevisitRateDelta: nullableDiff(current.groupbuy7dRevisitRate, previous.groupbuy7dRevisitRate),
    sleepingMemberRateDelta: nullableDiff(current.sleepingMemberRate, previous.sleepingMemberRate),
    netMarginRateDelta: nullableDiff(current.netMarginRate, previous.netMarginRate),
  };
}

function buildBenchmarks(digests: WeeklyStoreDigest[]): WeeklyBenchmarks {
  return {
    revenueMedian: medianNumber(digests.map((entry) => entry.current.revenue)),
    customerCountMedian: medianNumber(digests.map((entry) => entry.current.customerCount)),
    clockEffectMedian: medianNumber(digests.map((entry) => entry.current.clockEffect)),
    averageTicketMedian: medianNumber(digests.map((entry) => entry.current.averageTicket)),
    addClockRateMedian: medianNullableNumber(digests.map((entry) => entry.current.addClockRate)),
    groupbuy7dRevisitRateMedian: medianNullableNumber(
      digests.map((entry) => entry.current.groupbuy7dRevisitRate),
    ),
    sleepingMemberRateMedian: medianNullableNumber(digests.map((entry) => entry.current.sleepingMemberRate)),
    netMarginRateMedian: medianNullableNumber(digests.map((entry) => entry.current.netMarginRate)),
  };
}

function buildChainAggregate(
  stores: WeeklyStoreReportInput[],
  digests: WeeklyStoreDigest[],
  period: "current" | "previous",
): WeeklyAggregate {
  const base = aggregateWeeklyReports(
    stores.flatMap((store) => (period === "current" ? store.currentReports : store.previousReports)),
  );
  const scopedDigests = digests.map((entry) => (period === "current" ? entry.current : entry.previous));

  return {
    ...base,
    groupbuy7dRevisitRate: medianNullableNumber(scopedDigests.map((entry) => entry.groupbuy7dRevisitRate)),
    sleepingMemberRate: medianNullableNumber(scopedDigests.map((entry) => entry.sleepingMemberRate)),
    netMarginRate: medianNullableNumber(scopedDigests.map((entry) => entry.netMarginRate)),
  };
}

function buildRoleCandidates(digest: WeeklyStoreDigest, benchmarks: WeeklyBenchmarks): SignalCandidate[] {
  const addGap = compareToMedian(digest.current.addClockRate, benchmarks.addClockRateMedian);
  const revisitGap = compareToMedian(
    digest.current.groupbuy7dRevisitRate,
    benchmarks.groupbuy7dRevisitRateMedian,
  );
  const sleepingGap = compareToMedian(digest.current.sleepingMemberRate, benchmarks.sleepingMemberRateMedian);
  const marginGap = compareToMedian(digest.current.netMarginRate, benchmarks.netMarginRateMedian);
  const customerGap = digest.current.customerCount - benchmarks.customerCountMedian;
  const clockEffectGap = digest.current.clockEffect - benchmarks.clockEffectMedian;

  const candidates: SignalCandidate[] = [];

  if (digest.revenueDelta > 0) {
    candidates.push({
      key: "growth_engine",
      text: "增长引擎",
      score:
        digest.revenueDelta +
        Math.max(addGap ?? 0, 0) * 12000 +
        Math.max(revisitGap ?? 0, 0) * 8000,
    });
  }
  if (customerGap > 0 || digest.customerDelta > 0) {
    candidates.push({
      key: "traffic_anchor",
      text: "客流锚点",
      score: Math.max(customerGap, 0) * 40 + Math.max(digest.customerDelta, 0) * 24,
    });
  }
  if ((addGap ?? 0) > 0.01 || clockEffectGap > 3) {
    candidates.push({
      key: "conversion_sample",
      text: "转化样板",
      score: Math.max(addGap ?? 0, 0) * 14000 + Math.max(clockEffectGap, 0) * 40,
    });
  }
  if ((revisitGap ?? 0) > 0.01 && (sleepingGap ?? 0) < -0.005) {
    candidates.push({
      key: "member_stabilizer",
      text: "会员稳盘",
      score: Math.max(revisitGap ?? 0, 0) * 12000 + Math.max(-(sleepingGap ?? 0), 0) * 10000,
    });
  }
  if ((marginGap ?? 0) > 0.01) {
    candidates.push({
      key: "profit_anchor",
      text: "利润样板",
      score: Math.max(marginGap ?? 0, 0) * 12000 + Math.max(clockEffectGap, 0) * 15,
    });
  }
  if (digest.revenueDelta < 0 && ((addGap ?? 0) < -0.01 || clockEffectGap < -3)) {
    candidates.push({
      key: "repair_priority",
      text: "修复优先",
      score:
        Math.abs(digest.revenueDelta) +
        Math.max(-(addGap ?? 0), 0) * 12000 +
        Math.max(-clockEffectGap, 0) * 40,
    });
  }
  if ((sleepingGap ?? 0) > 0.01 || (revisitGap ?? 0) < -0.01) {
    candidates.push({
      key: "member_recovery",
      text: "会员回补",
      score:
        Math.max(sleepingGap ?? 0, 0) * 12000 +
        Math.max(-(revisitGap ?? 0), 0) * 12000 +
        Math.abs(Math.min(digest.revenueDelta, 0)),
    });
  }

  candidates.push({
    key: "base_store",
    text: "基本盘店",
    score: 1,
  });

  return sortCandidates(candidates);
}

function buildContributionCandidates(
  digest: WeeklyStoreDigest,
  benchmarks: WeeklyBenchmarks,
  roleKey?: string,
): SignalCandidate[] {
  const addGap = compareToMedian(digest.current.addClockRate, benchmarks.addClockRateMedian);
  const revisitGap = compareToMedian(
    digest.current.groupbuy7dRevisitRate,
    benchmarks.groupbuy7dRevisitRateMedian,
  );
  const sleepingGap = compareToMedian(digest.current.sleepingMemberRate, benchmarks.sleepingMemberRateMedian);
  const marginGap = compareToMedian(digest.current.netMarginRate, benchmarks.netMarginRateMedian);
  const customerGap = digest.current.customerCount - benchmarks.customerCountMedian;
  const clockEffectGap = digest.current.clockEffect - benchmarks.clockEffectMedian;

  const candidates: SignalCandidate[] = [];

  if (digest.revenueDelta > 0) {
    candidates.push({
      key: "revenue_up",
      score: digest.revenueDelta * 2,
      text: `营收 ${formatSignedCurrency(digest.revenueDelta)}，是本周净增长的主要来源。`,
    });
  }
  if (digest.customerDelta > 0 || customerGap > 0) {
    const customerTierText =
      formatCount(digest.current.customerCount) === formatCount(benchmarks.customerCountMedian)
        ? "位于5店客流第一梯队"
        : `高于5店中位值 ${formatCount(benchmarks.customerCountMedian)}`;
    candidates.push({
      key: "traffic_up",
      score: Math.max(digest.customerDelta, 0) * 40 + Math.max(customerGap, 0) * 20,
      text: `客流 ${formatSignedCount(digest.customerDelta, "人")}，本周客数 ${formatCount(digest.current.customerCount)}，${customerTierText}。`,
    });
  }
  if ((addGap ?? 0) > 0.01) {
    candidates.push({
      key: "add_clock_up",
      score: Math.max(addGap ?? 0, 0) * 15000,
      text: `加钟率 ${formatPercent(digest.current.addClockRate)}，高于5店中位值 ${formatPercent(benchmarks.addClockRateMedian)}。`,
    });
  }
  if ((revisitGap ?? 0) > 0.01) {
    candidates.push({
      key: "revisit_up",
      score: Math.max(revisitGap ?? 0, 0) * 14000,
      text: `团购7天复到店 ${formatPercent(digest.current.groupbuy7dRevisitRate)}，新客沉淀强于组合盘。`,
    });
  }
  if ((sleepingGap ?? 0) < -0.01) {
    candidates.push({
      key: "sleeping_down",
      score: Math.max(-(sleepingGap ?? 0), 0) * 13000,
      text: `沉默会员率 ${formatPercent(digest.current.sleepingMemberRate)}，低于5店中位值 ${formatPercent(benchmarks.sleepingMemberRateMedian)}。`,
    });
  }
  if ((marginGap ?? 0) > 0.01) {
    candidates.push({
      key: "margin_up",
      score: Math.max(marginGap ?? 0, 0) * 13000,
      text: `净利率 ${formatPercent(digest.current.netMarginRate)}，高于5店中位值 ${formatPercent(benchmarks.netMarginRateMedian)}。`,
    });
  }
  if (clockEffectGap > 3) {
    candidates.push({
      key: "clock_effect_up",
      score: Math.max(clockEffectGap, 0) * 35,
      text: `钟效 ${formatCurrency(digest.current.clockEffect)}/钟，高于5店中位值 ${formatCurrency(benchmarks.clockEffectMedian)}/钟。`,
    });
  }
  if (digest.revenueDelta < 0) {
    candidates.push({
      key: "revenue_down",
      score: Math.abs(digest.revenueDelta) * 2,
      text: `本周拖累营收 ${formatCurrency(Math.abs(digest.revenueDelta))}，是当前组合盘主要回撤点。`,
    });
  }
  if (digest.customerDelta < 0) {
    candidates.push({
      key: "traffic_down",
      score: Math.abs(digest.customerDelta) * 35,
      text: `客流 ${formatSignedCount(digest.customerDelta, "人")}，前段进店承接开始变弱。`,
    });
  }

  candidates.push({
    key: "steady_state",
    score: 1,
    text: "盘面基本稳定，暂未出现更强的放大项。",
  });

  const boostedKeys =
    roleKey === "growth_engine"
      ? ["revenue_up", "add_clock_up"]
      : roleKey === "traffic_anchor"
        ? ["traffic_up"]
        : roleKey === "conversion_sample"
          ? ["add_clock_up", "clock_effect_up"]
          : roleKey === "member_stabilizer"
            ? ["revisit_up", "sleeping_down"]
            : roleKey === "profit_anchor"
              ? ["margin_up", "clock_effect_up"]
              : roleKey === "member_recovery"
                ? ["revenue_down", "traffic_down"]
                : roleKey === "repair_priority"
                  ? ["revenue_down", "traffic_down"]
                  : [];

  return applyKeyBoosts(candidates, boostedKeys);
}

function buildIssueCandidates(
  digest: WeeklyStoreDigest,
  benchmarks: WeeklyBenchmarks,
  roleKey?: string,
): SignalCandidate[] {
  const addGap = compareToMedian(digest.current.addClockRate, benchmarks.addClockRateMedian);
  const revisitGap = compareToMedian(
    digest.current.groupbuy7dRevisitRate,
    benchmarks.groupbuy7dRevisitRateMedian,
  );
  const sleepingGap = compareToMedian(digest.current.sleepingMemberRate, benchmarks.sleepingMemberRateMedian);
  const marginGap = compareToMedian(digest.current.netMarginRate, benchmarks.netMarginRateMedian);
  const customerGap = digest.current.customerCount - benchmarks.customerCountMedian;
  const clockEffectGap = digest.current.clockEffect - benchmarks.clockEffectMedian;

  const candidates: SignalCandidate[] = [];

  if ((addGap ?? 0) < -0.01) {
    candidates.push({
      key: "add_clock_low",
      score: Math.max(-(addGap ?? 0), 0) * 16000,
      text: `加钟率 ${formatPercent(digest.current.addClockRate)}，低于5店中位值 ${formatPercent(benchmarks.addClockRateMedian)}，后半程转化没接住。`,
    });
  }
  if ((revisitGap ?? 0) < -0.01) {
    candidates.push({
      key: "revisit_low",
      score: Math.max(-(revisitGap ?? 0), 0) * 15000,
      text: `团购7天复到店 ${formatPercent(digest.current.groupbuy7dRevisitRate)}，低于5店中位值 ${formatPercent(benchmarks.groupbuy7dRevisitRateMedian)}。`,
    });
  }
  if ((sleepingGap ?? 0) > 0.01) {
    candidates.push({
      key: "sleeping_high",
      score: Math.max(sleepingGap ?? 0, 0) * 15000,
      text: `沉默会员率 ${formatPercent(digest.current.sleepingMemberRate)}，高于5店中位值 ${formatPercent(benchmarks.sleepingMemberRateMedian)}。`,
    });
  }
  if (clockEffectGap < -3) {
    candidates.push({
      key: "clock_effect_low",
      score: Math.max(-clockEffectGap, 0) * 40,
      text: `钟效 ${formatCurrency(digest.current.clockEffect)}/钟，低于5店中位值 ${formatCurrency(benchmarks.clockEffectMedian)}/钟。`,
    });
  }
  if (customerGap < -5 || digest.customerDelta < -3) {
    candidates.push({
      key: "traffic_low",
      score: Math.max(-customerGap, 0) * 20 + Math.max(-digest.customerDelta, 0) * 30,
      text: `本周客数 ${formatCount(digest.current.customerCount)}，前段进店承接偏弱。`,
    });
  }
  if ((marginGap ?? 0) < -0.01) {
    candidates.push({
      key: "margin_low",
      score: Math.max(-(marginGap ?? 0), 0) * 13000,
      text: `净利率 ${formatPercent(digest.current.netMarginRate)}，增长质量低于组合盘。`,
    });
  }
  if (digest.revenueDelta > 0) {
    candidates.push({
      key: "second_engine_missing",
      score: 80,
      text: "增长仍偏依赖单一强项，第二增长点还没完全打开。",
    });
  }
  if (roleKey === "traffic_anchor") {
    candidates.push({
      key: "traffic_without_conversion",
      score: 82,
      text: "客流已经在第一梯队，但加钟和钟效还没同步拉开。",
    });
  }
  if (roleKey === "conversion_sample") {
    candidates.push({
      key: "conversion_without_member",
      score: 82,
      text: "转化表现强，但会员沉淀还没形成第二推动力。",
    });
  }
  if (roleKey === "profit_anchor") {
    candidates.push({
      key: "profit_without_scale",
      score: 82,
      text: "增长质量好，但规模放大还不够明显。",
    });
  }
  if (roleKey === "base_store") {
    candidates.push({
      key: "missing_sharp_edge",
      score: 82,
      text: "盘面稳定，但缺少足够鲜明的放大项。",
    });
  }

  candidates.push({
    key: "no_breakthrough",
    score: 1,
    text: "盘面没有明显硬伤，但也还没有出现新的放大器。",
  });

  const boostedKeys =
    roleKey === "growth_engine"
      ? ["second_engine_missing"]
      : roleKey === "traffic_anchor"
        ? ["add_clock_low", "traffic_without_conversion", "second_engine_missing"]
        : roleKey === "conversion_sample"
          ? ["revisit_low", "conversion_without_member", "second_engine_missing"]
          : roleKey === "member_stabilizer"
            ? ["second_engine_missing", "no_breakthrough"]
            : roleKey === "profit_anchor"
              ? ["profit_without_scale", "no_breakthrough", "second_engine_missing"]
              : roleKey === "member_recovery"
                ? ["sleeping_high", "revisit_low"]
                : roleKey === "repair_priority"
                  ? ["add_clock_low", "traffic_low", "clock_effect_low"]
                  : roleKey === "base_store"
                    ? ["missing_sharp_edge", "no_breakthrough"]
                  : [];

  return applyKeyBoosts(candidates, boostedKeys);
}

function buildActionCandidates(
  digest: WeeklyStoreDigest,
  benchmarks: WeeklyBenchmarks,
  roleKey?: string,
): ActionCandidate[] {
  const addGap = compareToMedian(digest.current.addClockRate, benchmarks.addClockRateMedian);
  const revisitGap = compareToMedian(
    digest.current.groupbuy7dRevisitRate,
    benchmarks.groupbuy7dRevisitRateMedian,
  );
  const sleepingGap = compareToMedian(digest.current.sleepingMemberRate, benchmarks.sleepingMemberRateMedian);
  const marginGap = compareToMedian(digest.current.netMarginRate, benchmarks.netMarginRateMedian);
  const customerGap = digest.current.customerCount - benchmarks.customerCountMedian;

  const candidates: ActionCandidate[] = [];

  if (digest.revenueDelta > 0 && (addGap ?? 0) > 0.01) {
    candidates.push({
      key: "export_sop",
      score: digest.revenueDelta + Math.max(addGap ?? 0, 0) * 12000,
      text: "把本周晚场承接与加钟话术沉淀成 1 页 SOP，周内复制到另外 2 店。",
      watchItems: [
        `营收 ${formatCurrency(digest.current.revenue)}`,
        `加钟率 ${formatPercent(digest.current.addClockRate)}`,
        digest.current.groupbuy7dRevisitRate !== null
          ? `复到店 ${formatPercent(digest.current.groupbuy7dRevisitRate)}`
          : `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
      ],
    });
  }
  if ((addGap ?? 0) < -0.01) {
    candidates.push({
      key: "lift_add_clock",
      score: Math.max(-(addGap ?? 0), 0) * 15000,
      text: "服务结束后 3 分钟内必须做二次推荐，先把加钟率拉回5店中位值附近。",
      watchItems: [
        `加钟率 ${formatPercent(digest.current.addClockRate)}`,
        `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
        `客流 ${formatCount(digest.current.customerCount)}`,
      ],
    });
  }
  if ((revisitGap ?? 0) < -0.01) {
    candidates.push({
      key: "recall_groupbuy",
      score: Math.max(-(revisitGap ?? 0), 0) * 14500,
      text: "首单团购顾客在 48 小时内二次触达，优先约下次到店，不做泛发券。",
      watchItems: [
        `复到店 ${formatPercent(digest.current.groupbuy7dRevisitRate)}`,
        `客流 ${formatCount(digest.current.customerCount)}`,
        `新客 ${formatCount(digest.current.newMembers)}`,
      ],
    });
  }
  if ((sleepingGap ?? 0) > 0.01) {
    candidates.push({
      key: "wake_sleeping_members",
      score: Math.max(sleepingGap ?? 0, 0) * 14500,
      text: "高价值沉默会员按已联系/已预约/已到店三档推进，不做大水漫灌。",
      watchItems: [
        `沉默会员率 ${formatPercent(digest.current.sleepingMemberRate)}`,
        `复到店 ${formatPercent(digest.current.groupbuy7dRevisitRate)}`,
        `营收 ${formatCurrency(digest.current.revenue)}`,
      ],
    });
  }
  if (customerGap < -5 || digest.customerDelta < -3) {
    candidates.push({
      key: "repair_front_intake",
      score: Math.max(-customerGap, 0) * 20 + Math.max(-digest.customerDelta, 0) * 30,
      text: "围绕 18:00-22:00 重新盯前台排钟和候客承接，先把进店段补稳。",
      watchItems: [
        `客流 ${formatCount(digest.current.customerCount)}`,
        `营收 ${formatCurrency(digest.current.revenue)}`,
        `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
      ],
    });
  }
  if ((marginGap ?? 0) > 0.01) {
    candidates.push({
      key: "protect_margin",
      score: Math.max(marginGap ?? 0, 0) * 13000,
      text: "保持高钟效项目承接，不额外加低毛利引流动作，先守住增长质量。",
      watchItems: [
        `净利率 ${formatPercent(digest.current.netMarginRate)}`,
        `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
        `客单 ${formatCurrency(digest.current.averageTicket)}`,
      ],
    });
  }
  if (roleKey === "traffic_anchor") {
    candidates.push({
      key: "traffic_to_conversion",
      score: 75,
      text: "先把现有客流做成加钟和复到店，不新增泛流量动作。",
      watchItems: [
        `客流 ${formatCount(digest.current.customerCount)}`,
        `加钟率 ${formatPercent(digest.current.addClockRate)}`,
        `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
      ],
    });
  }
  if (roleKey === "conversion_sample") {
    candidates.push({
      key: "conversion_to_member",
      score: 75,
      text: "把当日转化延到 48 小时回访，别让强转化只停留在当班成交。",
      watchItems: [
        `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
        digest.current.groupbuy7dRevisitRate !== null
          ? `复到店 ${formatPercent(digest.current.groupbuy7dRevisitRate)}`
          : `客流 ${formatCount(digest.current.customerCount)}`,
        `加钟率 ${formatPercent(digest.current.addClockRate)}`,
      ],
    });
  }
  if (roleKey === "base_store") {
    candidates.push({
      key: "choose_one_gap",
      score: 75,
      text: "从客流、钟效、会员三项里只挑一个补差距，先做出清晰变化。",
      watchItems: [
        `营收 ${formatCurrency(digest.current.revenue)}`,
        `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
        `客流 ${formatCount(digest.current.customerCount)}`,
      ],
    });
  }
  if (digest.revenueDelta > 0) {
    candidates.push({
      key: "build_second_engine",
      score: 70,
      text: "在保住现有强项的同时，再补一个会员沉淀或钟效提升动作，别让增长只靠单点。",
      watchItems: [
        `营收 ${formatCurrency(digest.current.revenue)}`,
        digest.current.groupbuy7dRevisitRate !== null
          ? `复到店 ${formatPercent(digest.current.groupbuy7dRevisitRate)}`
          : `钟效 ${formatCurrency(digest.current.clockEffect)}/钟`,
        `加钟率 ${formatPercent(digest.current.addClockRate)}`,
      ],
    });
  }

  candidates.push({
    key: "single_breakthrough",
    score: 1,
    text: "下周只盯一个突破点，不再平均发力，周三先看一次中途数据。",
    watchItems: [
      `营收 ${formatCurrency(digest.current.revenue)}`,
      `客流 ${formatCount(digest.current.customerCount)}`,
      `加钟率 ${formatPercent(digest.current.addClockRate)}`,
    ],
  });

  const boostedKeys =
    roleKey === "growth_engine"
      ? ["export_sop"]
      : roleKey === "traffic_anchor"
        ? ["traffic_to_conversion", "build_second_engine", "lift_add_clock"]
        : roleKey === "conversion_sample"
          ? ["conversion_to_member", "export_sop", "build_second_engine"]
          : roleKey === "member_stabilizer"
            ? ["recall_groupbuy", "build_second_engine"]
            : roleKey === "profit_anchor"
              ? ["protect_margin"]
              : roleKey === "member_recovery"
                ? ["wake_sleeping_members", "recall_groupbuy"]
              : roleKey === "repair_priority"
                ? ["lift_add_clock", "repair_front_intake"]
                : roleKey === "base_store"
                  ? ["choose_one_gap", "single_breakthrough"]
                : [];

  return applyKeyBoosts(candidates, boostedKeys);
}

function resolveWindowLabel(weekEndBizDate: string): string {
  return `${shiftBizDate(weekEndBizDate, -6)} ~ ${weekEndBizDate}`;
}

function describePrimaryGrowth(digests: WeeklyStoreDigest[]): string {
  const growthStores = [...digests]
    .filter((entry) => entry.revenueDelta > 0)
    .sort((left, right) => right.revenueDelta - left.revenueDelta)
    .slice(0, 2);

  if (growthStores.length === 0) {
    return "本周暂无明显增长来源，净增长更多依赖自然波动。";
  }

  return `增长来源集中在 ${growthStores
    .map((entry) => `${entry.shortName} ${formatSignedCurrency(entry.revenueDelta)}`)
    .join("、")}。`;
}

function describePrimaryDrag(digests: WeeklyStoreDigest[]): string {
  const dragStores = [...digests]
    .filter((entry) => entry.revenueDelta < 0)
    .sort((left, right) => left.revenueDelta - right.revenueDelta)
    .slice(0, 2);

  if (dragStores.length === 0) {
    return "本周没有明确的回撤门店，主要压力来自结构质量而不是单店塌陷。";
  }

  return `主要回撤来自 ${dragStores
    .map((entry) => `${entry.shortName} ${formatSignedCurrency(entry.revenueDelta)}`)
    .join("、")}。`;
}

function buildChainPositiveSignals(current: WeeklyAggregate, previous: WeeklyAggregate): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const clockEffectDelta = round(current.clockEffect - previous.clockEffect, 2);
  const addClockDelta = nullableDiff(current.addClockRate, previous.addClockRate);
  const revisitDelta = nullableDiff(current.groupbuy7dRevisitRate, previous.groupbuy7dRevisitRate);
  const sleepingDelta = nullableDiff(current.sleepingMemberRate, previous.sleepingMemberRate);
  const netMarginDelta = nullableDiff(current.netMarginRate, previous.netMarginRate);

  if (clockEffectDelta > 0) {
    candidates.push({
      key: "clock_effect_up",
      score: clockEffectDelta * 35,
      text: `结构亮点：钟效 ${formatCurrency(current.clockEffect)}/钟，较上周 ${formatSignedCurrency(clockEffectDelta)}/钟。`,
    });
  }
  if ((addClockDelta ?? 0) > 0) {
    candidates.push({
      key: "add_clock_up",
      score: Math.max(addClockDelta ?? 0, 0) * 14000,
      text: `结构亮点：加钟率 ${formatPercent(current.addClockRate)}，较上周 ${formatPercentPointDelta(addClockDelta)}。`,
    });
  }
  if ((revisitDelta ?? 0) > 0) {
    candidates.push({
      key: "revisit_up",
      score: Math.max(revisitDelta ?? 0, 0) * 14000,
      text: `结构亮点：团购7天复到店 ${formatPercent(current.groupbuy7dRevisitRate)}，较上周 ${formatPercentPointDelta(revisitDelta)}。`,
    });
  }
  if ((sleepingDelta ?? 0) < 0) {
    candidates.push({
      key: "sleeping_down",
      score: Math.max(-(sleepingDelta ?? 0), 0) * 13000,
      text: `结构亮点：沉默会员率 ${formatPercent(current.sleepingMemberRate)}，较上周 ${formatPercentPointDelta(sleepingDelta)}。`,
    });
  }
  if ((netMarginDelta ?? 0) > 0) {
    candidates.push({
      key: "margin_up",
      score: Math.max(netMarginDelta ?? 0, 0) * 12000,
      text: `结构亮点：净利率 ${formatPercent(current.netMarginRate)}，较上周 ${formatPercentPointDelta(netMarginDelta)}。`,
    });
  }

  return sortCandidates(candidates);
}

function buildChainNegativeSignals(current: WeeklyAggregate, previous: WeeklyAggregate): SignalCandidate[] {
  const candidates: SignalCandidate[] = [];
  const addClockDelta = nullableDiff(current.addClockRate, previous.addClockRate);
  const revisitDelta = nullableDiff(current.groupbuy7dRevisitRate, previous.groupbuy7dRevisitRate);
  const sleepingDelta = nullableDiff(current.sleepingMemberRate, previous.sleepingMemberRate);
  const netMarginDelta = nullableDiff(current.netMarginRate, previous.netMarginRate);
  const customerDelta = round(current.customerCount - previous.customerCount, 2);

  if ((addClockDelta ?? 0) < 0) {
    candidates.push({
      key: "add_clock_down",
      score: Math.max(-(addClockDelta ?? 0), 0) * 14000,
      text: `结构风险：加钟率 ${formatPercent(current.addClockRate)}，较上周 ${formatPercentPointDelta(addClockDelta)}。`,
    });
  }
  if ((revisitDelta ?? 0) < 0) {
    candidates.push({
      key: "revisit_down",
      score: Math.max(-(revisitDelta ?? 0), 0) * 14000,
      text: `结构风险：团购7天复到店 ${formatPercent(current.groupbuy7dRevisitRate)}，较上周 ${formatPercentPointDelta(revisitDelta)}。`,
    });
  }
  if ((sleepingDelta ?? 0) > 0) {
    candidates.push({
      key: "sleeping_up",
      score: Math.max(sleepingDelta ?? 0, 0) * 14000,
      text: `结构风险：沉默会员率 ${formatPercent(current.sleepingMemberRate)}，较上周 ${formatPercentPointDelta(sleepingDelta)}。`,
    });
  }
  if ((netMarginDelta ?? 0) < 0) {
    candidates.push({
      key: "margin_down",
      score: Math.max(-(netMarginDelta ?? 0), 0) * 12000,
      text: `结构风险：净利率 ${formatPercent(current.netMarginRate)}，较上周 ${formatPercentPointDelta(netMarginDelta)}。`,
    });
  }
  if (customerDelta < 0) {
    candidates.push({
      key: "customer_down",
      score: Math.abs(customerDelta) * 25,
      text: `结构风险：服务客数 ${formatCount(current.customerCount)}，较上周 ${formatSignedCount(customerDelta, "人")}。`,
    });
  }

  return sortCandidates(candidates);
}

function buildChainJudgement(current: WeeklyAggregate, previous: WeeklyAggregate): string {
  const customerDelta = round(current.customerCount - previous.customerCount, 2);
  const addClockDelta = nullableDiff(current.addClockRate, previous.addClockRate);
  const revisitDelta = nullableDiff(current.groupbuy7dRevisitRate, previous.groupbuy7dRevisitRate);
  const sleepingDelta = nullableDiff(current.sleepingMemberRate, previous.sleepingMemberRate);

  if (customerDelta >= 0 && (addClockDelta ?? 0) < 0) {
    return "经营判断：前段进店不差，真正要修的是服务后的二次转化。";
  }
  if ((addClockDelta ?? 0) >= 0 && (sleepingDelta ?? 0) > 0) {
    return "经营判断：本周增长更多靠现有到店客户吃得更满，老客盘转冷要提前处理。";
  }
  if ((revisitDelta ?? 0) < 0) {
    return "经营判断：新客承接还在，但首单后的复到店链路偏弱，下周不能只看营收。";
  }
  return "经营判断：当前更像强店先跑出来，下一步关键是把强动作复制成全店稳定动作。";
}

function buildHeadquarterActions(
  digests: WeeklyStoreDigest[],
  roles: Map<string, SignalCandidate>,
  issues: Map<string, SignalCandidate>,
): string[] {
  const growthStore = [...digests]
    .filter((entry) => roles.get(entry.orgId)?.key === "growth_engine" || roles.get(entry.orgId)?.key === "conversion_sample")
    .sort((left, right) => right.revenueDelta - left.revenueDelta)[0];
  const repairStore =
    [...digests]
      .filter((entry) => {
        const key = issues.get(entry.orgId)?.key;
        return key === "add_clock_low" || key === "revisit_low" || key === "sleeping_high" || key === "traffic_low";
      })
      .sort((left, right) => Math.abs(right.revenueDelta) - Math.abs(left.revenueDelta))[0] ??
    [...digests].sort((left, right) => left.revenueDelta - right.revenueDelta)[0];

  const actions: string[] = [];
  const repairFocusText =
    repairStore && issues.get(repairStore.orgId)?.key === "sleeping_high"
      ? "沉默会员率拉回中位值附近"
      : repairStore && issues.get(repairStore.orgId)?.key === "revisit_low"
        ? "7天复到店拉回中位值附近"
        : repairStore && issues.get(repairStore.orgId)?.key === "add_clock_low"
          ? "加钟率拉回中位值附近"
          : repairStore && issues.get(repairStore.orgId)?.key === "traffic_low"
            ? "晚场进店承接补稳"
            : repairStore && issues.get(repairStore.orgId)?.key === "margin_low"
              ? "增长质量拉回组合盘附近"
              : "核心断点修回中位值附近";

  if (growthStore) {
    actions.push(
      `- 复制动作：先把 ${growthStore.shortName} 的强项打法拆成 1 页纸，下发另外两家弱项最接近的门店照做。`,
    );
  }
  if (repairStore) {
    actions.push(
      `- 修复动作：${repairStore.shortName} 下周只盯一个断点，先把 ${repairFocusText}。`,
    );
  }
  actions.push("- 复盘动作：周三看一次中途数据，周五只复盘动作是否执行，不讨论空泛口号。");

  return actions;
}

function findSignal(
  store: WeeklyStoreChartStore,
  label: WeeklyStoreChartSignal["label"],
): WeeklyStoreChartSignal | undefined {
  return store.signals.find((signal) => signal.label === label);
}

function describeStoreRole(store: WeeklyStoreChartStore): string {
  const roleLabel =
    store.tier === "客流拉升"
      ? "客流拉升"
      : store.tier === "转化拉升"
        ? "转化拉升"
        : store.tier === "会员沉淀"
          ? "会员沉淀"
          : store.tier === "客流承压"
            ? "客流承压"
            : store.tier === "转化承压"
              ? "转化承压"
              : "稳态承接";
  return `${roleLabel}，${store.insight}`;
}

function sumRevenue(points: Array<{ value: number | null }>): number {
  return round(points.reduce((sum, point) => sum + (point.value ?? 0), 0), 2);
}

function calculateStoreRiskScore(store: WeeklyStoreChartStore): number {
  return store.signals.reduce((score, signal) => {
    if ((signal.wowDelta ?? 0) >= 0) {
      return score;
    }
    if (signal.label === "客流") {
      return score + Math.abs(signal.wowDelta ?? 0) * 5;
    }
    if (signal.label === "加钟率" || signal.label === "点钟率") {
      return score + Math.abs(signal.wowDelta ?? 0) * 100000;
    }
    if (signal.label === "新增会员") {
      return score + Math.abs(signal.wowDelta ?? 0) * 20;
    }
    return score + Math.abs(signal.wowDelta ?? 0) / 5000;
  }, 0);
}

function resolveWeakSignalLabel(store: WeeklyStoreChartStore): WeeklyStoreChartSignal["label"] | null {
  const weakest = [...store.signals]
    .filter((signal) => (signal.wowDelta ?? 0) < 0)
    .sort((left, right) => {
      const leftScore =
        left.label === "客流"
          ? Math.abs(left.wowDelta ?? 0) * 5
          : left.label === "加钟率" || left.label === "点钟率"
            ? Math.abs(left.wowDelta ?? 0) * 100000
            : left.label === "新增会员"
              ? Math.abs(left.wowDelta ?? 0) * 20
              : Math.abs(left.wowDelta ?? 0) / 5000;
      const rightScore =
        right.label === "客流"
          ? Math.abs(right.wowDelta ?? 0) * 5
          : right.label === "加钟率" || right.label === "点钟率"
            ? Math.abs(right.wowDelta ?? 0) * 100000
            : right.label === "新增会员"
              ? Math.abs(right.wowDelta ?? 0) * 20
              : Math.abs(right.wowDelta ?? 0) / 5000;
      return rightScore - leftScore;
    })[0];
  return weakest?.label ?? null;
}

function resolvePrimaryIssueSignalLabel(
  store: WeeklyStoreChartStore,
): WeeklyStoreChartSignal["label"] | null {
  const customer = findSignal(store, "客流");
  const addClock = findSignal(store, "加钟率");
  const pointClock = findSignal(store, "点钟率");
  const newMembers = findSignal(store, "新增会员");
  const rechargeCash = findSignal(store, "本周新增储值");

  if ((customer?.wowDelta ?? 0) < 0 && store.tier !== "客流承压") {
    return "客流";
  }
  if ((addClock?.wowDelta ?? 0) < 0) {
    return "加钟率";
  }
  if ((pointClock?.wowDelta ?? 0) < 0) {
    return "点钟率";
  }
  if ((newMembers?.wowDelta ?? 0) < 0) {
    return "新增会员";
  }
  if ((rechargeCash?.wowDelta ?? 0) < 0) {
    return "本周新增储值";
  }
  return null;
}

function describeStoreContribution(params: {
  store: WeeklyStoreChartStore;
  revenueDelta: number;
}): string {
  const customer = findSignal(params.store, "客流");
  const addClock = findSignal(params.store, "加钟率");
  const pointClock = findSignal(params.store, "点钟率");
  const newMembers = findSignal(params.store, "新增会员");
  const rechargeCash = findSignal(params.store, "本周新增储值");

  switch (params.store.tier) {
    case "客流拉升":
      return `营收 ${formatSignedCurrency(params.revenueDelta)}；客流 ${customer?.deltaText ?? "0人"}，增长主要由进店恢复拉动。`;
    case "转化拉升":
      return (pointClock?.wowDelta ?? 0) >= (addClock?.wowDelta ?? 0)
        ? `营收 ${formatSignedCurrency(params.revenueDelta)}；点钟率 ${pointClock?.deltaText ?? "0.0个点"}，高意愿客户承接更强。`
        : `营收 ${formatSignedCurrency(params.revenueDelta)}；加钟率 ${addClock?.deltaText ?? "0.0个点"}，二次转化拉动了结果端。`;
    case "会员沉淀":
      return `新增会员 ${newMembers?.deltaText ?? "0人"}；本周新增储值 ${rechargeCash?.deltaText ?? "+¥0"}，增长开始沉淀成会员资产。`;
    case "客流承压":
      return `营收 ${formatSignedCurrency(params.revenueDelta)}；客流 ${customer?.deltaText ?? "0人"}，回撤先出在进店端。`;
    case "转化承压":
      return (pointClock?.wowDelta ?? 0) <= (addClock?.wowDelta ?? 0)
        ? `客流 ${customer?.deltaText ?? "0人"}；点钟率 ${pointClock?.deltaText ?? "0.0个点"}，高意愿客户没有接住。`
        : `客流 ${customer?.deltaText ?? "0人"}；加钟率 ${addClock?.deltaText ?? "0.0个点"}，后半程转化在掉。`;
    case "稳态承接":
      if ((customer?.wowDelta ?? 0) > 0 && (addClock?.wowDelta ?? 0) > 0) {
        return `营收 ${formatSignedCurrency(params.revenueDelta)}；客流 ${customer?.deltaText ?? "0人"}；加钟率 ${addClock?.deltaText ?? "0.0个点"}，当前属于均衡修复。`;
      }
      if ((customer?.wowDelta ?? 0) > 0) {
        return `营收 ${formatSignedCurrency(params.revenueDelta)}；客流 ${customer?.deltaText ?? "0人"}，当前更偏客流托底。`;
      }
      if ((newMembers?.wowDelta ?? 0) > 0 && (rechargeCash?.wowDelta ?? 0) > 0) {
        return `新增会员 ${newMembers?.deltaText ?? "0人"}；本周新增储值 ${rechargeCash?.deltaText ?? "+¥0"}，会员资产开始回暖。`;
      }
      if ((pointClock?.wowDelta ?? 0) > 0) {
        return `营收 ${formatSignedCurrency(params.revenueDelta)}；点钟率 ${pointClock?.deltaText ?? "0.0个点"}，高意愿客户结构在改善。`;
      }
      if ((rechargeCash?.wowDelta ?? 0) > 0) {
        return `营收 ${formatSignedCurrency(params.revenueDelta)}；本周新增储值 ${rechargeCash?.deltaText ?? "+¥0"}，盘面主要靠会员资产托底。`;
      }
      return `营收 ${formatSignedCurrency(params.revenueDelta)}；客流 ${customer?.deltaText ?? "0人"}，整体处于稳态承接。`;
  }
}

function describeStoreIssue(store: WeeklyStoreChartStore): string {
  const customer = findSignal(store, "客流");
  const addClock = findSignal(store, "加钟率");
  const pointClock = findSignal(store, "点钟率");
  const newMembers = findSignal(store, "新增会员");
  const rechargeCash = findSignal(store, "本周新增储值");
  const primaryIssue = resolvePrimaryIssueSignalLabel(store);

  if (primaryIssue === "客流") {
    return `客流 ${customer?.deltaText ?? "0人"}，进店承接还不够稳。`;
  }
  if (primaryIssue === "加钟率") {
    return `加钟率 ${addClock?.deltaText ?? "0.0个点"}，服务结束后的二次转化偏弱。`;
  }
  if (primaryIssue === "点钟率") {
    return `点钟率 ${pointClock?.deltaText ?? "0.0个点"}，熟客绑定和高意愿承接不足。`;
  }
  if (primaryIssue === "新增会员") {
    return `新增会员 ${newMembers?.deltaText ?? "0人"}，新客沉淀没有跟上当前客流。`;
  }
  if (primaryIssue === "本周新增储值") {
    return `本周新增储值 ${rechargeCash?.deltaText ?? "+¥0"}，消费有了，但会员资产沉淀还没跟上。`;
  }
  return "当前没有明显硬伤，但第二增长点还不够清晰。";
}

function describeStoreAction(store: WeeklyStoreChartStore): string {
  const customer = findSignal(store, "客流");
  const addClock = findSignal(store, "加钟率");
  const pointClock = findSignal(store, "点钟率");
  const newMembers = findSignal(store, "新增会员");
  const rechargeCash = findSignal(store, "本周新增储值");

  if (store.tier === "客流拉升") {
    if ((addClock?.wowDelta ?? 0) < 0) {
      return "先保住晚场进店承接，再把收尾 3 分钟加钟动作固定下来，避免客流来了却没做满。";
    }
    if ((pointClock?.wowDelta ?? 0) < 0) {
      return "先保住客流，再补熟客绑定和指名承接，把高意愿客户接稳后再复制打法。";
    }
    return "把晚场进店承接和排钟动作拆成 SOP，先复制到一家具备同类客流结构的门店。";
  }
  if (store.tier === "转化拉升") {
    return (pointClock?.wowDelta ?? 0) >= (addClock?.wowDelta ?? 0)
      ? "放大高意愿客户承接打法，把点钟优势延伸到加钟和储值，而不是只停留在当班成交。"
      : "把现有加钟话术固化到收尾 3 分钟内执行，避免转化只靠个人发挥。";
  }
  if (store.tier === "会员沉淀") {
    return "把新增会员 48 小时内回访和储值跟进固化成固定动作，继续把新客沉淀成会员资产。";
  }
  if (store.tier === "客流承压") {
    return "围绕 18:00-22:00 重排前台候客承接和房态衔接，先把进店量补稳。";
  }
  if (store.tier === "转化承压") {
    return (pointClock?.wowDelta ?? 0) <= (addClock?.wowDelta ?? 0)
      ? "优先修复点钟承接，先把熟客和指名需求接住，再谈放大量。"
      : "优先修复加钟转化，先把到店客做满，再追加新的引流动作。";
  }
  if ((customer?.wowDelta ?? 0) < 0) {
    return "先看周中客流承接波动，把晚场排钟和前台补位动作做实。";
  }
  if ((addClock?.wowDelta ?? 0) < 0) {
    return "只盯加钟率一个突破口，把结束前推荐动作做成标准动作。";
  }
  if ((pointClock?.wowDelta ?? 0) < 0) {
    return "只盯点钟率一个突破口，把熟客绑定和指定承接流程做扎实。";
  }
  if ((newMembers?.wowDelta ?? 0) < 0) {
    return "把新增会员后的 48 小时回访做成固定动作，先补新客沉淀，不额外加泛券。";
  }
  if ((rechargeCash?.wowDelta ?? 0) < 0) {
    return "把储值跟进挂到本周高意愿客户名单上，先补会员资产沉淀，不做平均发力。";
  }
  return "下周只选一个链路指标拉开差距，周三中途复盘一次。";
}

function buildStoreWatchItems(store: WeeklyStoreChartStore): string[] {
  return store.signals.map((signal) => {
    const currentText =
      signal.label === "客流" || signal.label === "新增会员"
        ? formatCount(signal.currentValue ?? 0)
        : signal.label === "本周新增储值"
          ? formatCurrency(signal.currentValue ?? 0)
          : formatPercent(signal.currentValue);
    return `${signal.label} ${currentText}`;
  });
}

function buildWeeklyHeadquarterActions(params: {
  growthStore?: { shortName: string; tier: WeeklyStoreChartStore["tier"] };
  riskStore?: {
    shortName: string;
    tier: WeeklyStoreChartStore["tier"];
    weakSignalLabel: WeeklyStoreChartSignal["label"] | null;
  };
}): string[] {
  const growthAction = params.growthStore
    ? params.growthStore.tier === "客流拉升"
      ? `- 复制动作：先把 ${params.growthStore.shortName} 的晚场承接和排钟动作拆成 1 页纸，复制到客流偏弱门店。`
      : params.growthStore.tier === "转化拉升"
        ? `- 复制动作：先把 ${params.growthStore.shortName} 的加钟/点钟成交打法沉淀成 SOP，复制到转化偏弱门店。`
        : `- 复制动作：先把 ${params.growthStore.shortName} 的会员沉淀动作拆开，复制到新增会员与储值偏弱门店。`
    : "- 复制动作：本周没有单一强店明显拉开差距，先从最稳定动作里挑一个复制。";
  const repairFocusText =
    params.riskStore?.weakSignalLabel === "客流"
      ? "把 18:00-22:00 的进店承接补稳"
      : params.riskStore?.weakSignalLabel === "加钟率"
        ? "把加钟率拉回组内中位值附近"
        : params.riskStore?.weakSignalLabel === "点钟率"
          ? "把点钟承接拉回组内中位值附近"
          : params.riskStore?.weakSignalLabel === "新增会员"
            ? "把新增会员后的 48 小时回访做实"
            : params.riskStore?.weakSignalLabel === "本周新增储值"
              ? "把高意愿客户储值沉淀补稳"
              : "只盯一个链路指标修复";
  const repairAction = params.riskStore
    ? params.riskStore.tier === "客流承压"
      ? `- 修复动作：${params.riskStore.shortName} 下周只盯客流承接，把 18:00-22:00 的进店链路补稳。`
      : params.riskStore.tier === "转化承压"
        ? `- 修复动作：${params.riskStore.shortName} 下周只盯转化，把点钟/加钟断点修回到组内中位值附近。`
        : `- 修复动作：${params.riskStore.shortName} 下周先 ${repairFocusText}，不做平均发力。`
    : "- 修复动作：本周没有明显塌陷门店，优先修小断点，不做大动作翻盘。";

  return [
    growthAction,
    repairAction,
    "- 复盘动作：周三统一复盘客流、加钟率、点钟率、新增会员、本周新增储值，周五只看动作是否执行到位。",
  ];
}

export function renderFiveStoreWeeklyReport(params: {
  weekEndBizDate: string;
  stores: WeeklyStoreReportInput[];
  industryObservations?: OperatingWorldIndustryObservation[];
}): string {
  const windowLabel = resolveWindowLabel(params.weekEndBizDate);
  const digests = params.stores.map((store) => buildBaseStoreDigest(store));
  const digestByOrgId = new Map(digests.map((entry) => [entry.orgId, entry] as const));
  const chainCurrent = buildChainAggregate(params.stores, digests, "current");
  const chainPrevious = buildChainAggregate(params.stores, digests, "previous");
  const revenueDelta = round(chainCurrent.revenue - chainPrevious.revenue, 2);
  const customerDelta = round(chainCurrent.customerCount - chainPrevious.customerCount, 2);
  const addClockRateDelta = nullableDiff(chainCurrent.addClockRate, chainPrevious.addClockRate);
  const pointClockRateDelta = nullableDiff(chainCurrent.pointClockRate, chainPrevious.pointClockRate);
  const newMembersDelta = round(chainCurrent.newMembers - chainPrevious.newMembers, 2);
  const rechargeCashDelta = round(chainCurrent.rechargeCash - chainPrevious.rechargeCash, 2);
  const worldModelLines = buildWeeklyReportWorldModelLines({
    weekEndBizDate: params.weekEndBizDate,
    currentAggregate: {
      revenue: chainCurrent.revenue,
      customerCount: chainCurrent.customerCount,
      rechargeCash: chainCurrent.rechargeCash,
      addClockRate: chainCurrent.addClockRate,
      pointClockRate: chainCurrent.pointClockRate,
      newMembers: chainCurrent.newMembers,
    },
    previousAggregate: {
      revenue: chainPrevious.revenue,
      customerCount: chainPrevious.customerCount,
      rechargeCash: chainPrevious.rechargeCash,
      addClockRate: chainPrevious.addClockRate,
      pointClockRate: chainPrevious.pointClockRate,
      newMembers: chainPrevious.newMembers,
    },
    industryObservations: params.industryObservations,
  });
  const chartDataset = buildWeeklyStoreChartDataset({
    weekEndBizDate: params.weekEndBizDate,
    stores: params.stores,
  });
  const incompleteStores = digests.filter((entry) => entry.current.completeDays < entry.current.totalDays);
  const orderedStores = [...chartDataset.stores].sort(
    (left, right) => sumRevenue(right.revenueThisWeek) - sumRevenue(left.revenueThisWeek),
  );
  const growthStore = [...orderedStores]
    .filter((store) => {
      const digest = digestByOrgId.get(store.orgId);
      return digest && digest.revenueDelta > 0;
    })
    .sort(
      (left, right) =>
        (digestByOrgId.get(right.orgId)?.revenueDelta ?? 0) -
        (digestByOrgId.get(left.orgId)?.revenueDelta ?? 0),
    )[0];
  const riskStore = [...orderedStores]
    .filter((store) => {
      const digest = digestByOrgId.get(store.orgId);
      return digest && digest.revenueDelta < 0;
    })
    .sort(
      (left, right) =>
        (digestByOrgId.get(left.orgId)?.revenueDelta ?? 0) -
        (digestByOrgId.get(right.orgId)?.revenueDelta ?? 0),
    )[0];
  const fallbackRiskStore =
    riskStore ??
    [...orderedStores]
      .filter((store) => store.orgId !== growthStore?.orgId)
      .sort((left, right) => calculateStoreRiskScore(right) - calculateStoreRiskScore(left))[0];

  const lines = [
    "# 荷塘悦色5店经营周报",
    `周期：${windowLabel}`,
    "",
    "## 一、经营总览",
    `- 本周营收 ${formatCurrency(chainCurrent.revenue)}，较上周 ${formatSignedCurrency(revenueDelta)}；客流 ${formatCount(chainCurrent.customerCount)}，较上周 ${formatSignedCount(customerDelta, "人")}。`,
    `- 加钟率 ${formatPercent(chainCurrent.addClockRate)}，较上周 ${formatPercentPointDelta(addClockRateDelta)}；点钟率 ${formatPercent(chainCurrent.pointClockRate)}，较上周 ${formatPercentPointDelta(pointClockRateDelta)}。`,
    `- 新增会员 ${formatCount(chainCurrent.newMembers)}，较上周 ${formatSignedCount(newMembersDelta, "人")}；本周新增储值 ${formatCurrency(chainCurrent.rechargeCash)}，较上周 ${formatSignedCurrency(rechargeCashDelta)}。`,
    `- ${describePrimaryGrowth(digests)}`,
    `- ${describePrimaryDrag(digests)}`,
    `- 经营判断：${chartDataset.summary.headline.replace(/。$/u, "")}，${rechargeCashDelta >= 0 ? "会员资产沉淀同步回暖。" : "会员资产沉淀仍需补强。"}`,
    ...worldModelLines,
    "",
    "## 二、下周动作",
    ...buildWeeklyHeadquarterActions({
      growthStore: growthStore
        ? { shortName: growthStore.shortName, tier: growthStore.tier }
        : undefined,
      riskStore: fallbackRiskStore
        ? {
            shortName: fallbackRiskStore.shortName,
            tier: fallbackRiskStore.tier,
            weakSignalLabel: resolvePrimaryIssueSignalLabel(fallbackRiskStore) ?? resolveWeakSignalLabel(fallbackRiskStore),
          }
        : undefined,
    }),
    "",
    "## 三、门店动作",
  ];

  for (const store of orderedStores) {
    const digest = digestByOrgId.get(store.orgId);
    const storeRevenueDelta = digest?.revenueDelta ?? 0;

    lines.push(`### ${store.shortName}`);
    lines.push(`- 角色：${describeStoreRole(store)}`);
    lines.push(`- 贡献：${describeStoreContribution({ store, revenueDelta: storeRevenueDelta })}`);
    lines.push(`- 问题：${describeStoreIssue(store)}`);
    lines.push(`- 动作：${describeStoreAction(store)}`);
    lines.push(`- 盯盘：${buildStoreWatchItems(store).join("；")}。`);
    lines.push("");
  }

  lines.push("## 四、口径说明");
  lines.push("- 周报按上周一至周日对比前一完整周，先看变化，再看绝对值。");
  lines.push("- 当前优先使用已稳定在线指标，不等额外实验口径后再发送。");
  if (incompleteStores.length > 0) {
    lines.push(`- 数据完整性：${incompleteStores.map((entry) => entry.shortName).join("、")} 本周存在未完成日报天数，结论以方向判断为主。`);
  }

  return lines.join("\n");
}
