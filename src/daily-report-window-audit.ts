import { reconcileDailyStoreMetrics } from "./daily-metric-reconciliation.js";
import { shiftBizDate } from "./time.js";
import type {
  DailyMetricReconciliationReport,
} from "./daily-metric-reconciliation.js";
import type {
  HetangDailyReportAuditSampleIssue,
  HetangDailyReportAuditSummary,
  HetangOpsConfig,
} from "./types.js";

const DEFAULT_WINDOW_DAYS = 7;
const MAX_SAMPLE_ISSUES = 5;
const MAX_DIFFS_PER_SAMPLE = 3;

type QueryStoreLike = Parameters<typeof reconcileDailyStoreMetrics>[0]["store"];

export type DailyReportWindowAuditResult = {
  summary: HetangDailyReportAuditSummary;
  lines: string[];
};

export async function auditDailyReportWindow(params: {
  config: HetangOpsConfig;
  store: QueryStoreLike;
  endBizDate: string;
  windowDays?: number;
  reconcileStoreReport?: (params: {
    config: HetangOpsConfig;
    store: QueryStoreLike;
    orgId: string;
    bizDate: string;
  }) => Promise<DailyMetricReconciliationReport>;
}): Promise<DailyReportWindowAuditResult> {
  const windowDays = Math.max(1, Math.floor(params.windowDays ?? DEFAULT_WINDOW_DAYS));
  const dates = Array.from({ length: windowDays }, (_, index) =>
    shiftBizDate(params.endBizDate, index - (windowDays - 1)),
  );
  const activeStores = params.config.stores.filter((entry) => entry.isActive);
  const reconcileStoreReport = params.reconcileStoreReport ?? reconcileDailyStoreMetrics;

  let checkedReports = 0;
  let reportsWithFreshMismatch = 0;
  let reportsWithStoredMismatch = 0;
  let reportsWithOnlyMissingStored = 0;
  let maxUnauditedMetricCount = 0;
  const unauditedKeys = new Set<string>();
  const sampleIssues: HetangDailyReportAuditSampleIssue[] = [];

  for (const bizDate of dates) {
    for (const entry of activeStores) {
      const report = await reconcileStoreReport({
        config: params.config,
        store: params.store,
        orgId: entry.orgId,
        bizDate,
      });
      checkedReports += 1;

      if (report.summary.freshMismatchCount > 0) {
        reportsWithFreshMismatch += 1;
      }
      if (report.summary.storedMismatchCount > 0) {
        reportsWithStoredMismatch += 1;
      }
      if (
        report.summary.storedMismatchCount === 0 &&
        report.summary.missingStoredCount > 0
      ) {
        reportsWithOnlyMissingStored += 1;
      }

      const reportUnauditedKeys = report.summary.unauditedMetricKeys.filter(
        (key) => !["bizDate", "orgId", "storeName"].includes(key),
      );
      maxUnauditedMetricCount = Math.max(maxUnauditedMetricCount, reportUnauditedKeys.length);
      for (const key of reportUnauditedKeys) {
        unauditedKeys.add(key);
      }

      if (
        sampleIssues.length < MAX_SAMPLE_ISSUES &&
        (report.summary.hasDiffs || report.summary.missingStoredCount > 0)
      ) {
        sampleIssues.push({
          orgId: report.orgId,
          storeName: report.storeName,
          bizDate: report.bizDate,
          topDiffs: report.items
            .filter((item) => item.status !== "match")
            .slice(0, MAX_DIFFS_PER_SAMPLE)
            .map((item) => ({
              metricKey: item.metricKey,
              status: item.status,
            })),
        });
      }
    }
  }

  const summary: HetangDailyReportAuditSummary = {
    status:
      reportsWithFreshMismatch > 0 ||
      reportsWithStoredMismatch > 0 ||
      reportsWithOnlyMissingStored > 0 ||
      maxUnauditedMetricCount > 0
        ? "warn"
        : "healthy",
    endBizDate: params.endBizDate,
    windowDays,
    dates,
    storeCount: activeStores.length,
    checkedReports,
    reportsWithFreshMismatch,
    reportsWithStoredMismatch,
    reportsWithOnlyMissingStored,
    maxUnauditedMetricCount,
    unauditedKeys: Array.from(unauditedKeys).sort(),
    sampleIssues,
  };

  return {
    summary,
    lines: [formatDailyReportWindowAuditLine(summary)],
  };
}

export function formatDailyReportWindowAuditLine(summary: HetangDailyReportAuditSummary): string {
  const details = [
    `dates=${summary.dates.length}`,
    `stores=${summary.storeCount}`,
    `checked=${summary.checkedReports}`,
    `fresh=${summary.reportsWithFreshMismatch}`,
    `stored=${summary.reportsWithStoredMismatch}`,
    `missing=${summary.reportsWithOnlyMissingStored}`,
    `unaudited=${summary.maxUnauditedMetricCount}`,
  ];
  const sample = summary.sampleIssues[0];
  const topDiff = sample?.topDiffs[0];
  if (sample && topDiff) {
    details.push(`sample=${sample.storeName}@${sample.bizDate}:${topDiff.metricKey}`);
  }
  return `${summary.endBizDate} report audit ${
    summary.status === "healthy" ? "ok" : "warn"
  } - ${details.join(" ")}`;
}
