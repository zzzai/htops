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
