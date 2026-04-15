import { listDueScheduledJobs } from "./schedule.js";
import type { HetangOpsStore } from "./store.js";
import type {
  DailyStoreReport,
  HetangLogger,
  HetangNotificationTarget,
  HetangOpsConfig,
} from "./types.js";

const SCHEDULED_RUNNER_ADVISORY_LOCK_KEY = 42_060_407;

type ExternalBriefIssue = {
  issueDate: string;
  itemCount: number;
};

export type HetangSyncOrchestratorDeps = {
  config: HetangOpsConfig;
  logger: HetangLogger;
  getStore: () => Promise<HetangOpsStore>;
  syncStores: (params: { now?: Date; publishAnalytics?: boolean }) => Promise<string[]>;
  runNightlyHistoryBackfill: (
    now: Date,
    options?: { publishAnalytics?: boolean },
  ) => Promise<string[]>;
  runNightlyApiHistoryDepthProbe: (now: Date) => Promise<string[]>;
  publishNightlyServingViews: (now: Date) => Promise<void>;
  runCustomerHistoryCatchup: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<{ lines: string[]; allComplete: boolean }>;
  buildAllReports: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<DailyStoreReport[]>;
  buildExternalBriefIssue: (params: {
    now: Date;
    deliver: boolean;
  }) => Promise<ExternalBriefIssue | null>;
  sendAllMiddayBriefs: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<{ lines: string[]; allSent: boolean }>;
  sendAllReactivationPushes: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<{ lines: string[]; allSent: boolean }>;
  sendNotificationMessage: (params: {
    notification: HetangNotificationTarget;
    message: string;
  }) => Promise<void>;
  sendReport: (params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
  }) => Promise<string>;
};

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function formatDurationMs(startedAtMs: number): string {
  return `${Math.max(0, Date.now() - startedAtMs)}ms`;
}

function summarizeNightlySyncLines(lines: string[]): string {
  const complete = lines.filter((line) => line.includes(": sync complete")).length;
  const partial = lines.filter((line) => line.includes(": sync partial")).length;
  const failed = lines.filter((line) => line.includes(": sync failed")).length;
  return `stores=${lines.length} complete=${complete} partial=${partial} failed=${failed}`;
}

function summarizeNightlyBackfillLines(lines: string[]): string {
  return `slices=${lines.length}`;
}

function summarizeNightlyProbeLines(lines: string[]): string {
  const text = lines.join(" | ");
  const confirmed = (text.match(/>=\d+d/gu) ?? []).length;
  const skipped = (text.match(/=skipped/gu) ?? []).length;
  const errors = (text.match(/=error/gu) ?? []).length;
  const noData = (text.match(/=no-data/gu) ?? []).length;
  const currentOnly = (text.match(/=current-only/gu) ?? []).length;
  const cardScoped = (text.match(/=card-scoped/gu) ?? []).length;
  return [
    `summaries=${lines.length}`,
    `confirmed=${confirmed}`,
    `skipped=${skipped}`,
    `error=${errors}`,
    `noData=${noData}`,
    `currentOnly=${currentOnly}`,
    `cardScoped=${cardScoped}`,
  ].join(" ");
}

function logNightlyPhase(
  logger: HetangLogger,
  phase: "sync" | "backfill" | "probe" | "publish",
  startedAtMs: number,
  summary: string,
): void {
  logger.info(`hetang-ops: nightly phase ${phase} ${formatDurationMs(startedAtMs)} ${summary}`);
}

function summarizeSyncResult(storeName: string, report: DailyStoreReport): string {
  return [
    `${storeName} ${report.bizDate} 日报`,
    `服务营收 ${report.metrics.serviceRevenue.toFixed(2)} 元`,
    `总钟数 ${report.metrics.totalClockCount.toFixed(0)} 钟`,
    `耗卡金额 ${report.metrics.storedConsumeAmount.toFixed(2)} 元`,
    `团购占比 ${((report.metrics.groupbuyOrderShare ?? 0) * 100).toFixed(1)}%`,
    `风险条数 ${report.alerts.length}`,
  ].join(" | ");
}

function formatChineseBizDate(bizDate: string): string {
  const [year, month, day] = bizDate.split("-");
  if (!year || !month || !day) {
    return bizDate;
  }
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

function sameNotificationTarget(
  left: HetangNotificationTarget | undefined,
  right: HetangNotificationTarget | undefined,
): boolean {
  if (!left || !right) {
    return false;
  }
  return (
    left.enabled !== false &&
    right.enabled !== false &&
    left.channel === right.channel &&
    left.target === right.target &&
    (left.accountId ?? "") === (right.accountId ?? "") &&
    (left.threadId ?? "") === (right.threadId ?? "")
  );
}

function resolveSharedReportAnnouncementTarget(
  config: HetangOpsConfig,
): HetangNotificationTarget | null {
  const activeStores = config.stores.filter((entry) => entry.isActive);
  if (activeStores.length === 0) {
    return null;
  }

  const targets = activeStores.map(
    (entry) => entry.notification ?? config.reporting.sharedDelivery,
  );
  const firstTarget = targets[0];
  if (!firstTarget || firstTarget.enabled === false) {
    return null;
  }
  if (!targets.every((target) => sameNotificationTarget(firstTarget, target))) {
    return null;
  }
  return firstTarget;
}

function buildSharedReportAnnouncementMessage(bizDate: string, storeCount: number): string {
  return [`${formatChineseBizDate(bizDate)} ${storeCount}家店前一营业日日报如下。`, `@所有人`].join(
    "\n",
  );
}

export class HetangSyncOrchestrator {
  constructor(private readonly deps: HetangSyncOrchestratorDeps) {}

  async runDueJobs(now = new Date()): Promise<string[]> {
    const store = await this.deps.getStore();
    const lockAcquired = await store.tryAdvisoryLock(SCHEDULED_RUNNER_ADVISORY_LOCK_KEY);
    if (!lockAcquired) {
      this.deps.logger.debug?.("hetang-ops: scheduled runner lease already held, skipping");
      return [];
    }

    try {
      const jobs = listDueScheduledJobs({
        now,
        timeZone: this.deps.config.timeZone,
        completedRunKeys: await store.listCompletedRunKeys(),
        businessDayCutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
        syncTime: this.deps.config.sync.runAtLocalTime,
        syncWindowStart: this.deps.config.sync.accessWindowStartLocalTime,
        syncWindowEnd: this.deps.config.sync.accessWindowEndLocalTime,
        historyCatchupTime: this.deps.config.sync.historyCatchupAtLocalTime,
        buildReportTime: this.deps.config.reporting.buildAtLocalTime,
        sendReportTime: this.deps.config.reporting.sendAtLocalTime,
        middayBriefTime: this.deps.config.reporting.middayBriefAtLocalTime,
        reactivationPushTime: this.deps.config.reporting.reactivationPushAtLocalTime,
        sendReportEnabled: this.deps.config.reporting.sendReportEnabled,
        sendMiddayBriefEnabled: this.deps.config.reporting.sendMiddayBriefEnabled,
        sendReactivationPushEnabled: this.deps.config.reporting.sendReactivationPushEnabled,
        externalIntelligenceEnabled: this.deps.config.externalIntelligence.enabled,
        externalIntelligenceTime: this.deps.config.reporting.buildAtLocalTime,
        syncEnabled: this.deps.config.sync.enabled,
        reportingEnabled: this.deps.config.reporting.enabled,
      });

      const lines: string[] = [];
      for (const job of jobs) {
        if (job.jobType === "sync") {
          const nightlyStartedAtMs = Date.now();

          const syncStartedAtMs = Date.now();
          const syncLines = await this.deps.syncStores({ now, publishAnalytics: false });
          lines.push(...syncLines);
          logNightlyPhase(
            this.deps.logger,
            "sync",
            syncStartedAtMs,
            summarizeNightlySyncLines(syncLines),
          );

          const backfillStartedAtMs = Date.now();
          const backfillLines = await this.deps.runNightlyHistoryBackfill(now, {
            publishAnalytics: false,
          });
          lines.push(...backfillLines);
          logNightlyPhase(
            this.deps.logger,
            "backfill",
            backfillStartedAtMs,
            summarizeNightlyBackfillLines(backfillLines),
          );

          const probeStartedAtMs = Date.now();
          const probeLines = await this.deps.runNightlyApiHistoryDepthProbe(now);
          lines.push(...probeLines);
          logNightlyPhase(
            this.deps.logger,
            "probe",
            probeStartedAtMs,
            summarizeNightlyProbeLines(probeLines),
          );

          const publishStartedAtMs = Date.now();
          await this.deps.publishNightlyServingViews(now);
          logNightlyPhase(this.deps.logger, "publish", publishStartedAtMs, "published=1");
          this.deps.logger.info(
            `hetang-ops: nightly window complete ${formatDurationMs(nightlyStartedAtMs)} lines=${lines.length}`,
          );
          await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          continue;
        }

        if (job.jobType === "run-customer-history-catchup") {
          const catchupResult = await this.deps.runCustomerHistoryCatchup({
            bizDate: job.runKey,
            now,
          });
          lines.push(...catchupResult.lines);
          if (catchupResult.allComplete) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          }
          continue;
        }

        if (job.jobType === "build-report") {
          const reports = await this.deps.buildAllReports({ bizDate: job.runKey, now });
          lines.push(...reports.map((report) => summarizeSyncResult(report.storeName, report)));
          await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          continue;
        }

        if (job.jobType === "build-external-brief") {
          try {
            const issue = await this.deps.buildExternalBriefIssue({
              now,
              deliver: true,
            });
            lines.push(
              issue
                ? `HQ 外部情报 ${issue.issueDate}: delivered ${issue.itemCount} items`
                : `HQ 外部情报 ${job.runKey}: no qualified items`,
            );
          } catch (error) {
            const message = summarizeUnknownError(error);
            this.deps.logger.warn(`hetang-ops: build external brief failed: ${message}`);
            lines.push(`HQ 外部情报 ${job.runKey}: build failed - ${message}`);
          }
          await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          continue;
        }

        if (job.jobType === "send-midday-brief") {
          const middayResult = await this.deps.sendAllMiddayBriefs({ bizDate: job.runKey, now });
          lines.push(...middayResult.lines);
          if (middayResult.allSent) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          }
          continue;
        }

        if (job.jobType === "send-reactivation-push") {
          const reactivationResult = await this.deps.sendAllReactivationPushes({
            bizDate: job.runKey,
            now,
          });
          lines.push(...reactivationResult.lines);
          if (reactivationResult.allSent) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          }
          continue;
        }

        if (job.jobType === "send-report") {
          let allSent = true;
          const activeStores = this.deps.config.stores.filter((storeEntry) => storeEntry.isActive);
          const existingReports = new Map(
            await Promise.all(
              activeStores.map(async (entry) => [
                entry.orgId,
                await store.getDailyReport(entry.orgId, job.runKey),
              ]),
            ),
          );
          const sharedAnnouncementTarget = resolveSharedReportAnnouncementTarget(this.deps.config);
          const shouldSendSharedAnnouncement =
            sharedAnnouncementTarget !== null &&
            activeStores.every((entry) => !existingReports.get(entry.orgId)?.sentAt);

          if (shouldSendSharedAnnouncement) {
            try {
              await this.deps.sendNotificationMessage({
                notification: sharedAnnouncementTarget,
                message: buildSharedReportAnnouncementMessage(job.runKey, activeStores.length),
              });
            } catch (error) {
              allSent = false;
              const message = summarizeUnknownError(error);
              this.deps.logger.warn(
                `hetang-ops: send report announcement failed for ${job.runKey}: ${message}`,
              );
            }
          }

          for (const entry of activeStores) {
            try {
              const existing = existingReports.get(entry.orgId) ?? null;
              if (existing?.sentAt) {
                lines.push(`${entry.storeName}: already sent`);
                continue;
              }
              lines.push(
                await this.deps.sendReport({
                  orgId: entry.orgId,
                  bizDate: job.runKey,
                  now,
                }),
              );
            } catch (error) {
              allSent = false;
              const message = summarizeUnknownError(error);
              this.deps.logger.warn(
                `hetang-ops: send report failed for ${entry.storeName}: ${message}`,
              );
              lines.push(`${entry.storeName}: send failed - ${message}`);
            }
          }
          if (allSent) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          }
        }
      }

      return lines;
    } finally {
      await store.releaseAdvisoryLock(SCHEDULED_RUNNER_ADVISORY_LOCK_KEY);
    }
  }
}
