import { shiftBizDate } from "./time.js";
import type { EndpointCode, HetangHistoricalCoverageSnapshot, HetangHistoricalCoverageSpan } from "./types.js";

export type ProjectDataCoverageStatus = "complete" | "partial" | "missing" | "incomplete";

export type ProjectDataCoverageMetric = {
  key: string;
  label: string;
  dayCount: number;
  expectedDays: number;
  coverageRate: number;
  status: Exclude<ProjectDataCoverageStatus, "incomplete">;
  firstMissingBizDate?: string;
  minBizDate?: string;
  maxBizDate?: string;
};

export type ProjectDataCoverageStoreReport = {
  orgId: string;
  storeName: string;
  status: "complete" | "incomplete";
  rawCoverageRate: number;
  derivedCoverageRate: number;
  rawFacts: ProjectDataCoverageMetric[];
  derivedLayers: ProjectDataCoverageMetric[];
};

export type ProjectDataCoverageReport = {
  startBizDate: string;
  endBizDate: string;
  expectedDays: number;
  overallStatus: "complete" | "incomplete";
  stores: ProjectDataCoverageStoreReport[];
};

export type ProjectDataCoverageGapImpact = "日报" | "问答" | "动作闭环";

export type ProjectDataCoverageGap = ProjectDataCoverageMetric & {
  storeName: string;
  orgId: string;
  affectsDailyReport: boolean;
  affectsQuestionAnswering: boolean;
  affectsActionLoop: boolean;
  impactLabels: ProjectDataCoverageGapImpact[];
};

export type ProjectDataCoverageProgressStoreState = {
  orgId: string;
  storeName: string;
  dayCount: number;
  expectedDays: number;
  coverageRate: number;
  firstMissingBizDate?: string;
};

export type ProjectDataCoverageProgressStatus =
  | "complete"
  | "progressed"
  | "no_progress"
  | "stalled";

export type ProjectDataCoverageProgressState = {
  checkedAt: string;
  startBizDate: string;
  endBizDate: string;
  focusMetricKey: string;
  focusCoveredDays: number;
  focusExpectedDays: number;
  focusCoverageRate: number;
  noProgressNightCount: number;
  status: ProjectDataCoverageProgressStatus;
  stores: ProjectDataCoverageProgressStoreState[];
};

const RAW_FACT_LABELS: Array<[EndpointCode, string]> = [
  ["1.2", "消费明细"],
  ["1.3", "充值明细"],
  ["1.4", "消费流水"],
  ["1.6", "技师上钟"],
  ["1.7", "技师推销"],
];

const DERIVED_LAYER_LABELS: Array<[keyof HetangHistoricalCoverageSnapshot["derivedLayers"], string]> = [
  ["factMemberDailySnapshot", "会员日快照"],
  ["martCustomerSegments", "顾客分层"],
  ["martCustomerConversionCohorts", "转化队列"],
  ["mvCustomerProfile90d", "90天画像"],
];

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function countBizDaysInclusive(startBizDate: string, endBizDate: string): number {
  if (startBizDate > endBizDate) {
    throw new Error("startBizDate must be on or before endBizDate");
  }
  let count = 0;
  for (let cursor = startBizDate; cursor <= endBizDate; cursor = shiftBizDate(cursor, 1)) {
    count += 1;
  }
  return count;
}

function resolveFirstMissingBizDate(params: {
  span?: HetangHistoricalCoverageSpan;
  startBizDate: string;
  expectedDays: number;
}): string | undefined {
  if (params.span?.firstMissingBizDate) {
    return params.span.firstMissingBizDate;
  }
  if ((params.span?.dayCount ?? 0) === 0 && params.expectedDays > 0) {
    return params.startBizDate;
  }
  return undefined;
}

function buildMetric(params: {
  key: string;
  label: string;
  span?: HetangHistoricalCoverageSpan;
  expectedDays: number;
  startBizDate: string;
}): ProjectDataCoverageMetric {
  const dayCount = Math.max(0, params.span?.dayCount ?? 0);
  const coverageRate = params.expectedDays <= 0 ? 1 : round(Math.min(dayCount / params.expectedDays, 1));
  const status = coverageRate >= 1 ? "complete" : dayCount <= 0 ? "missing" : "partial";
  return {
    key: params.key,
    label: params.label,
    dayCount,
    expectedDays: params.expectedDays,
    coverageRate,
    status,
    firstMissingBizDate: resolveFirstMissingBizDate({
      span: params.span,
      startBizDate: params.startBizDate,
      expectedDays: params.expectedDays,
    }),
    minBizDate: params.span?.minBizDate,
    maxBizDate: params.span?.maxBizDate,
  };
}

function averageCoverageRate(metrics: ProjectDataCoverageMetric[]): number {
  if (metrics.length === 0) {
    return 1;
  }
  return round(metrics.reduce((sum, metric) => sum + metric.coverageRate, 0) / metrics.length, 4);
}

export function buildProjectDataCoverageReport(params: {
  startBizDate: string;
  endBizDate: string;
  stores: Array<{ orgId: string; storeName: string }>;
  snapshots: HetangHistoricalCoverageSnapshot[];
}): ProjectDataCoverageReport {
  const expectedDays = countBizDaysInclusive(params.startBizDate, params.endBizDate);
  const snapshotByOrgId = new Map(params.snapshots.map((snapshot) => [snapshot.orgId, snapshot]));
  const stores = params.stores.map((store) => {
    const snapshot = snapshotByOrgId.get(store.orgId);
    const rawFacts = RAW_FACT_LABELS.map(([key, label]) =>
      buildMetric({
        key,
        label,
        span: snapshot?.rawFacts[key],
        expectedDays,
        startBizDate: params.startBizDate,
      }),
    );
    const derivedLayers = DERIVED_LAYER_LABELS.map(([key, label]) =>
      buildMetric({
        key,
        label,
        span: snapshot?.derivedLayers[key],
        expectedDays,
        startBizDate: params.startBizDate,
      }),
    );
    const rawCoverageRate = averageCoverageRate(rawFacts);
    const derivedCoverageRate = averageCoverageRate(derivedLayers);
    const status: ProjectDataCoverageStoreReport["status"] =
      rawCoverageRate >= 1 && derivedCoverageRate >= 1 ? "complete" : "incomplete";
    return {
      orgId: store.orgId,
      storeName: store.storeName,
      status,
      rawCoverageRate,
      derivedCoverageRate,
      rawFacts,
      derivedLayers,
    };
  });

  return {
    startBizDate: params.startBizDate,
    endBizDate: params.endBizDate,
    expectedDays,
    overallStatus: stores.every((store) => store.status === "complete") ? "complete" : "incomplete",
    stores,
  };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function resolveMetricImpact(metric: ProjectDataCoverageMetric): {
  affectsDailyReport: boolean;
  affectsQuestionAnswering: boolean;
  affectsActionLoop: boolean;
} {
  const affectsDailyReport = ["1.2", "1.3", "1.4", "1.6", "1.7", "factMemberDailySnapshot"].includes(
    metric.key,
  );
  const affectsActionLoop = [
    "1.1",
    "1.2",
    "1.3",
    "1.4",
    "factMemberDailySnapshot",
    "martCustomerSegments",
    "martCustomerConversionCohorts",
    "mvCustomerProfile90d",
  ].includes(metric.key);
  return {
    affectsDailyReport,
    affectsQuestionAnswering: true,
    affectsActionLoop,
  };
}

function resolveImpactLabels(gap: {
  affectsDailyReport: boolean;
  affectsQuestionAnswering: boolean;
  affectsActionLoop: boolean;
}): ProjectDataCoverageGapImpact[] {
  return [
    ...(gap.affectsDailyReport ? (["日报"] as const) : []),
    ...(gap.affectsQuestionAnswering ? (["问答"] as const) : []),
    ...(gap.affectsActionLoop ? (["动作闭环"] as const) : []),
  ];
}

export function buildStoreDataCoverageGaps(
  store: ProjectDataCoverageStoreReport,
): ProjectDataCoverageGap[] {
  return [...store.rawFacts, ...store.derivedLayers]
    .filter((metric) => metric.status !== "complete")
    .map((metric) => {
      const impact = resolveMetricImpact(metric);
      return {
        ...metric,
        orgId: store.orgId,
        storeName: store.storeName,
        ...impact,
        impactLabels: resolveImpactLabels(impact),
      };
    })
    .sort(
      (left, right) =>
        Number(right.affectsDailyReport) - Number(left.affectsDailyReport) ||
        Number(right.affectsActionLoop) - Number(left.affectsActionLoop) ||
        left.key.localeCompare(right.key),
    );
}

export function buildProjectDataCoverageGaps(
  report: ProjectDataCoverageReport,
): ProjectDataCoverageGap[] {
  return report.stores.flatMap((store) => buildStoreDataCoverageGaps(store));
}

export function formatProjectDataCoverageDoctorLines(
  report: ProjectDataCoverageReport,
  options: { maxGaps?: number } = {},
): string[] {
  const lines = [
    `Data coverage ${report.startBizDate}..${report.endBizDate}: ${report.overallStatus} | stores=${report.stores.length} | expected_days=${report.expectedDays}`,
  ];
  const maxGaps = Math.max(0, Math.trunc(options.maxGaps ?? 12));
  const gaps = buildProjectDataCoverageGaps(report).slice(0, maxGaps);
  for (const gap of gaps) {
    lines.push(
      [
        `Data coverage gap: ${gap.storeName}`,
        `${gap.key} ${gap.label}`,
        `rate=${pct(gap.coverageRate)}`,
        `first_missing=${gap.firstMissingBizDate ?? "unknown"}`,
        `affects=${gap.impactLabels.join(",") || "none"}`,
      ].join(" | "),
    );
  }
  return lines;
}

function buildProgressStores(params: {
  report: ProjectDataCoverageReport;
  focusMetricKey: string;
}): ProjectDataCoverageProgressStoreState[] {
  return params.report.stores.map((store) => {
    const metric = [...store.rawFacts, ...store.derivedLayers].find(
      (entry) => entry.key === params.focusMetricKey,
    );
    return {
      orgId: store.orgId,
      storeName: store.storeName,
      dayCount: metric?.dayCount ?? 0,
      expectedDays: metric?.expectedDays ?? params.report.expectedDays,
      coverageRate: metric?.coverageRate ?? 0,
      firstMissingBizDate: metric?.firstMissingBizDate,
    };
  });
}

export function buildProjectDataCoverageProgressState(params: {
  report: ProjectDataCoverageReport;
  previousState?: ProjectDataCoverageProgressState | null;
  checkedAt: string;
  focusMetricKey?: string;
}): ProjectDataCoverageProgressState {
  const focusMetricKey = params.focusMetricKey ?? "1.4";
  const stores = buildProgressStores({
    report: params.report,
    focusMetricKey,
  });
  const focusCoveredDays = stores.reduce((sum, store) => sum + store.dayCount, 0);
  const focusExpectedDays = stores.reduce((sum, store) => sum + store.expectedDays, 0);
  const focusCoverageRate =
    focusExpectedDays <= 0 ? 1 : round(Math.min(focusCoveredDays / focusExpectedDays, 1), 4);
  const progressed =
    !params.previousState ||
    params.previousState.focusMetricKey !== focusMetricKey ||
    focusCoveredDays > params.previousState.focusCoveredDays ||
    focusCoverageRate > params.previousState.focusCoverageRate;
  const complete = focusCoverageRate >= 1;
  const noProgressNightCount = complete
    ? 0
    : progressed
      ? 0
      : (params.previousState?.noProgressNightCount ?? 0) + 1;
  const status: ProjectDataCoverageProgressStatus = complete
    ? "complete"
    : progressed
      ? "progressed"
      : noProgressNightCount >= 2
        ? "stalled"
        : "no_progress";

  return {
    checkedAt: params.checkedAt,
    startBizDate: params.report.startBizDate,
    endBizDate: params.report.endBizDate,
    focusMetricKey,
    focusCoveredDays,
    focusExpectedDays,
    focusCoverageRate,
    noProgressNightCount,
    status,
    stores,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseProjectDataCoverageProgressState(
  value: unknown,
): ProjectDataCoverageProgressState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const checkedAt = readString(raw.checkedAt);
  const startBizDate = readString(raw.startBizDate);
  const endBizDate = readString(raw.endBizDate);
  const focusMetricKey = readString(raw.focusMetricKey);
  const status = readString(raw.status);
  const focusCoveredDays = readNumber(raw.focusCoveredDays);
  const focusExpectedDays = readNumber(raw.focusExpectedDays);
  const focusCoverageRate = readNumber(raw.focusCoverageRate);
  const noProgressNightCount = readNumber(raw.noProgressNightCount);
  if (
    !checkedAt ||
    !startBizDate ||
    !endBizDate ||
    !focusMetricKey ||
    (status !== "complete" &&
      status !== "progressed" &&
      status !== "no_progress" &&
      status !== "stalled") ||
    focusCoveredDays === undefined ||
    focusExpectedDays === undefined ||
    focusCoverageRate === undefined ||
    noProgressNightCount === undefined
  ) {
    return undefined;
  }
  const stores: ProjectDataCoverageProgressStoreState[] = [];
  if (Array.isArray(raw.stores)) {
    for (const entry of raw.stores) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const row = entry as Record<string, unknown>;
      const orgId = readString(row.orgId);
      const storeName = readString(row.storeName);
      const dayCount = readNumber(row.dayCount);
      const expectedDays = readNumber(row.expectedDays);
      const coverageRate = readNumber(row.coverageRate);
      if (
        !orgId ||
        !storeName ||
        dayCount === undefined ||
        expectedDays === undefined ||
        coverageRate === undefined
      ) {
        continue;
      }
      stores.push({
        orgId,
        storeName,
        dayCount,
        expectedDays,
        coverageRate,
        firstMissingBizDate: readString(row.firstMissingBizDate),
      });
    }
  }
  return {
    checkedAt,
    startBizDate,
    endBizDate,
    focusMetricKey,
    focusCoveredDays,
    focusExpectedDays,
    focusCoverageRate,
    noProgressNightCount,
    status,
    stores,
  };
}

export function formatProjectDataCoverageProgressLine(
  state: ProjectDataCoverageProgressState,
): string {
  const details = [
    `Data coverage progress: ${state.focusMetricKey} ${state.focusCoveredDays}/${state.focusExpectedDays} days ${pct(state.focusCoverageRate)}`,
    `status=${state.status}`,
    `no_progress_nights=${state.noProgressNightCount}`,
  ];
  if (state.status === "stalled") {
    details.push("check upstream window/card candidates/lock/task order/api failures");
  }
  return details.join(" | ");
}

function formatMetricGap(metric: ProjectDataCoverageMetric): string | undefined {
  if (metric.status === "complete") {
    return undefined;
  }
  return `${metric.key} ${pct(metric.coverageRate)}，缺口 ${metric.firstMissingBizDate ?? "unknown"}`;
}

export function formatProjectDataCoverageReport(report: ProjectDataCoverageReport): string {
  const lines = [
    `数据覆盖率检查：${report.startBizDate}..${report.endBizDate}`,
    `范围天数：${report.expectedDays} 天；整体状态：${report.overallStatus}`,
    "",
  ];
  for (const store of report.stores) {
    lines.push(
      `${store.storeName}：${store.status}，raw ${pct(store.rawCoverageRate)}，derived ${pct(store.derivedCoverageRate)}`,
    );
    const gaps = [...store.rawFacts, ...store.derivedLayers]
      .map(formatMetricGap)
      .filter((entry): entry is string => Boolean(entry));
    if (gaps.length > 0) {
      lines.push(`  缺口：${gaps.slice(0, 8).join("；")}`);
    }
  }
  return lines.join("\n");
}
