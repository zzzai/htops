import { listDueScheduledJobs } from "./schedule.js";
import { resolveMonthDateRange } from "./monthly-report.js";
import type { HetangOpsStore } from "./store.js";
import type {
  HetangDailyReportAuditSummary,
  DailyStoreReport,
  HetangLogger,
  HetangNotificationTarget,
  HetangOpsConfig,
  ScheduledJobOrchestrator,
} from "./types.js";

const SCHEDULED_SYNC_RUNNER_ADVISORY_LOCK_KEY = 42_060_407;
const SCHEDULED_DELIVERY_RUNNER_ADVISORY_LOCK_KEY = 42_060_408;

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
    options?: { publishAnalytics?: boolean; maxPasses?: number; maxPlans?: number },
  ) => Promise<string[]>;
  runNightlyApiHistoryDepthProbe: (now: Date) => Promise<string[]>;
  publishNightlyServingViews: (now: Date) => Promise<void>;
  runCustomerHistoryCatchup: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<{ lines: string[]; allComplete: boolean }>;
  runNightlyConversationReview: (now: Date) => Promise<string[]>;
  buildAllStoreEnvironmentMemory: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<string[]>;
  buildAllReports: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<DailyStoreReport[]>;
  auditDailyReportWindow: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<{ summary: HetangDailyReportAuditSummary; lines: string[] }>;
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
  sendFiveStoreDailyOverview: (params: {
    bizDate?: string;
    now?: Date;
  }) => Promise<string>;
  sendWeeklyReport: (params: {
    weekEndBizDate?: string;
    now?: Date;
  }) => Promise<string>;
  sendMonthlyReport?: (params: {
    month?: string;
    now?: Date;
  }) => Promise<string>;
  sendWeeklyChartImage: (params: {
    weekEndBizDate?: string;
    now?: Date;
  }) => Promise<string>;
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

function isFinalReportDeliveryState(
  existing: { sentAt?: string | null; sendStatus?: string | null } | null,
  line: string | null,
): boolean {
  if (existing?.sentAt && existing.sendStatus === "sent") {
    return true;
  }
  if (!line) {
    return false;
  }
  return (
    line.endsWith(": report sent") ||
    line.includes(": notification disabled by control tower")
  );
}

function normalizeScheduledOrchestrators(
  orchestrators?: ScheduledJobOrchestrator[],
): ScheduledJobOrchestrator[] {
  if (!orchestrators || orchestrators.length === 0) {
    return ["sync", "delivery"];
  }
  const normalized = Array.from(
    new Set(
      orchestrators.filter(
        (entry): entry is ScheduledJobOrchestrator =>
          entry === "sync" || entry === "delivery",
      ),
    ),
  );
  return normalized.length > 0 ? normalized : ["sync", "delivery"];
}

function resolveScheduledRunnerLockKeys(
  orchestrators: ScheduledJobOrchestrator[],
): number[] {
  return orchestrators.map((orchestrator) =>
    orchestrator === "sync"
      ? SCHEDULED_SYNC_RUNNER_ADVISORY_LOCK_KEY
      : SCHEDULED_DELIVERY_RUNNER_ADVISORY_LOCK_KEY,
  );
}

function formatScheduledOrchestratorScope(orchestrators: ScheduledJobOrchestrator[]): string {
  return orchestrators.join("+");
}

export class HetangSyncOrchestrator {
  constructor(private readonly deps: HetangSyncOrchestratorDeps) {}

  async runDueJobs(
    now = new Date(),
    options: { orchestrators?: ScheduledJobOrchestrator[] } = {},
  ): Promise<string[]> {
    const store = await this.deps.getStore();
    const orchestrators = normalizeScheduledOrchestrators(options.orchestrators);
    const lockKeys = resolveScheduledRunnerLockKeys(orchestrators);
    const acquiredLockKeys: number[] = [];
    for (const lockKey of lockKeys) {
      const lockAcquired = await store.tryAdvisoryLock(lockKey);
      if (!lockAcquired) {
        this.deps.logger.debug?.(
          `hetang-ops: scheduled runner lease already held for ${formatScheduledOrchestratorScope(orchestrators)}, skipping`,
        );
        for (const acquiredLockKey of acquiredLockKeys.reverse()) {
          await store.releaseAdvisoryLock(acquiredLockKey);
        }
        return [];
      }
      acquiredLockKeys.push(lockKey);
    }

    try {
      const completedRunKeys = await store.listCompletedRunKeys();
      const jobs = listDueScheduledJobs({
        now,
        timeZone: this.deps.config.timeZone,
        completedRunKeys,
        businessDayCutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
        syncTime: this.deps.config.sync.runAtLocalTime,
        syncWindowStart: this.deps.config.sync.accessWindowStartLocalTime,
        syncWindowEnd: this.deps.config.sync.accessWindowEndLocalTime,
        historyCatchupTime: this.deps.config.sync.historyCatchupAtLocalTime,
        buildReportTime: this.deps.config.reporting.buildAtLocalTime,
        sendReportTime: this.deps.config.reporting.sendAtLocalTime,
        fiveStoreDailyOverviewTime: this.deps.config.reporting.fiveStoreDailyOverviewAtLocalTime,
        weeklyReportTime: this.deps.config.reporting.weeklyReportAtLocalTime,
        weeklyReportStartDate: this.deps.config.reporting.weeklyReportStartDate,
        monthlyReportTime: this.deps.config.reporting.monthlyReportAtLocalTime,
        monthlyReportStartMonth: this.deps.config.reporting.monthlyReportStartMonth,
        weeklyChartTime: this.deps.config.reporting.weeklyChartAtLocalTime,
        weeklyChartStartDate: this.deps.config.reporting.weeklyChartStartDate,
        middayBriefTime: this.deps.config.reporting.middayBriefAtLocalTime,
        reactivationPushTime: this.deps.config.reporting.reactivationPushAtLocalTime,
        sendReportEnabled: this.deps.config.reporting.sendReportEnabled,
        sendFiveStoreDailyOverviewEnabled:
          this.deps.config.reporting.sendFiveStoreDailyOverviewEnabled,
        sendWeeklyReportEnabled: this.deps.config.reporting.sendWeeklyReportEnabled,
        sendMonthlyReportEnabled: this.deps.config.reporting.sendMonthlyReportEnabled,
        sendWeeklyChartEnabled: this.deps.config.reporting.sendWeeklyChartEnabled,
        sendMiddayBriefEnabled: this.deps.config.reporting.sendMiddayBriefEnabled,
        sendReactivationPushEnabled: this.deps.config.reporting.sendReactivationPushEnabled,
        externalIntelligenceEnabled: this.deps.config.externalIntelligence.enabled,
        externalIntelligenceTime: this.deps.config.reporting.buildAtLocalTime,
        syncEnabled: this.deps.config.sync.enabled,
        historyBackfillEnabled: this.deps.config.sync.historyBackfillEnabled,
        reportingEnabled: this.deps.config.reporting.enabled,
        orchestrators,
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
          completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          continue;
        }

        if (job.jobType === "nightly-history-backfill") {
          const backfillStartedAtMs = Date.now();
          const backfillLines = await this.deps.runNightlyHistoryBackfill(now, {
            publishAnalytics: true,
            maxPasses: 1,
            maxPlans: 1,
          });
          lines.push(...backfillLines);
          logNightlyPhase(
            this.deps.logger,
            "backfill",
            backfillStartedAtMs,
            summarizeNightlyBackfillLines(backfillLines),
          );
          if (backfillLines.length === 0) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          }
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
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          }
          continue;
        }

        if (job.jobType === "nightly-conversation-review") {
          const reviewLines = await this.deps.runNightlyConversationReview(now);
          lines.push(...reviewLines);
          await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          continue;
        }

        if (job.jobType === "build-store-environment-memory") {
          const environmentMemoryLines = await this.deps.buildAllStoreEnvironmentMemory({
            bizDate: job.runKey,
            now,
          });
          lines.push(...environmentMemoryLines);
          if (!environmentMemoryLines.some((line) => line.includes(": environment memory build failed"))) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          }
          continue;
        }

        if (job.jobType === "build-report") {
          if (!completedRunKeys.has(`build-store-environment-memory:${job.runKey}`)) {
            lines.push(`${job.runKey} build report waiting - environment memory not ready`);
            continue;
          }
          const reports = await this.deps.buildAllReports({ bizDate: job.runKey, now });
          lines.push(...reports.map((report) => summarizeSyncResult(report.storeName, report)));
          await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
          completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          continue;
        }

        if (job.jobType === "audit-daily-report-window") {
          if (!completedRunKeys.has(`build-report:${job.runKey}`)) {
            lines.push(`${job.runKey} report audit waiting - build-report not completed`);
            continue;
          }
          try {
            const auditResult = await this.deps.auditDailyReportWindow({
              bizDate: job.runKey,
              now,
            });
            await store.setScheduledJobState(
              job.jobType,
              job.runKey,
              auditResult.summary as unknown as Record<string, unknown>,
              now.toISOString(),
            );
            lines.push(...auditResult.lines);
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          } catch (error) {
            const message = summarizeUnknownError(error);
            this.deps.logger.warn(
              `hetang-ops: daily report audit failed for ${job.runKey}: ${message}`,
            );
            lines.push(`${job.runKey} report audit failed - ${message}`);
          }
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
          completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          continue;
        }

        if (job.jobType === "send-midday-brief") {
          const middayResult = await this.deps.sendAllMiddayBriefs({ bizDate: job.runKey, now });
          lines.push(...middayResult.lines);
          if (middayResult.allSent) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
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
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          }
          continue;
        }

        if (job.jobType === "send-report") {
          let allSent = true;
          let allFinalized = true;
          const activeStores = this.deps.config.stores.filter((storeEntry) => storeEntry.isActive);
          const existingReports = new Map(
            await Promise.all(
              activeStores.map(async (entry) =>
                [entry.orgId, await store.getDailyReport(entry.orgId, job.runKey)] as const,
              ),
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
              if (existing?.sentAt && existing.sendStatus === "sent") {
                lines.push(`${entry.storeName}: already sent`);
                continue;
              }
              const line = await this.deps.sendReport({
                orgId: entry.orgId,
                bizDate: job.runKey,
                now,
              });
              lines.push(line);
              if (!isFinalReportDeliveryState(existing, line)) {
                allFinalized = false;
              }
            } catch (error) {
              allSent = false;
              const message = summarizeUnknownError(error);
              this.deps.logger.warn(
                `hetang-ops: send report failed for ${entry.storeName}: ${message}`,
              );
              lines.push(`${entry.storeName}: send failed - ${message}`);
            }
          }
          if (allSent && allFinalized) {
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          }
          continue;
        }

        if (job.jobType === "send-weekly-report") {
          if (!completedRunKeys.has(`send-report:${job.runKey}`)) {
            lines.push(`${job.runKey} weekly report waiting - daily reports not fully sent yet`);
            continue;
          }
          try {
            lines.push(
              await this.deps.sendWeeklyReport({
                weekEndBizDate: job.runKey,
                now,
              }),
            );
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          } catch (error) {
            const message = summarizeUnknownError(error);
            this.deps.logger.warn(
              `hetang-ops: send weekly report failed for ${job.runKey}: ${message}`,
            );
            lines.push(`${job.runKey} weekly report failed - ${message}`);
          }
          continue;
        }

        if (job.jobType === "send-five-store-daily-overview") {
          if (!completedRunKeys.has(`send-report:${job.runKey}`)) {
            lines.push(`${job.runKey} five-store daily overview waiting - daily reports not fully sent yet`);
            continue;
          }
          try {
            const line = await this.deps.sendFiveStoreDailyOverview({
              bizDate: job.runKey,
              now,
            });
            lines.push(line);
            const terminalWithoutConfirmation =
              !line.includes(": waiting -") &&
              !line.includes("preview sent to ZhangZhen") &&
              !line.includes(": pending confirmation");
            if (terminalWithoutConfirmation) {
              await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
              completedRunKeys.add(`${job.jobType}:${job.runKey}`);
            }
          } catch (error) {
            const message = summarizeUnknownError(error);
            this.deps.logger.warn(
              `hetang-ops: send five-store daily overview failed for ${job.runKey}: ${message}`,
            );
            lines.push(`${job.runKey} five-store daily overview failed - ${message}`);
          }
          continue;
        }

        if (job.jobType === "send-monthly-report") {
          const monthEndBizDate = resolveMonthDateRange(job.runKey).endBizDate;
          if (!completedRunKeys.has(`send-report:${monthEndBizDate}`)) {
            lines.push(`${job.runKey} monthly report waiting - month-end daily reports not fully sent yet`);
            continue;
          }
          if (!this.deps.sendMonthlyReport) {
            lines.push(`${job.runKey} monthly report failed - missing sender`);
            continue;
          }
          try {
            lines.push(
              await this.deps.sendMonthlyReport({
                month: job.runKey,
                now,
              }),
            );
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          } catch (error) {
            const message = summarizeUnknownError(error);
            this.deps.logger.warn(
              `hetang-ops: send monthly report failed for ${job.runKey}: ${message}`,
            );
            lines.push(`${job.runKey} monthly report failed - ${message}`);
          }
          continue;
        }

        if (job.jobType === "send-weekly-chart") {
          const waitingOnWeeklyReport =
            this.deps.config.reporting.sendWeeklyReportEnabled &&
            !completedRunKeys.has(`send-weekly-report:${job.runKey}`);
          if (waitingOnWeeklyReport) {
            lines.push(`${job.runKey} weekly chart waiting - weekly report not fully sent yet`);
            continue;
          }
          if (!completedRunKeys.has(`send-report:${job.runKey}`)) {
            lines.push(`${job.runKey} weekly chart waiting - daily reports not fully sent yet`);
            continue;
          }
          try {
            lines.push(
              await this.deps.sendWeeklyChartImage({
                weekEndBizDate: job.runKey,
                now,
              }),
            );
            await store.markScheduledJobCompleted(job.jobType, job.runKey, now.toISOString());
            completedRunKeys.add(`${job.jobType}:${job.runKey}`);
          } catch (error) {
            const message = summarizeUnknownError(error);
            this.deps.logger.warn(
              `hetang-ops: send weekly chart failed for ${job.runKey}: ${message}`,
            );
            lines.push(`${job.runKey} weekly chart failed - ${message}`);
          }
          continue;
        }
      }

      return lines;
    } finally {
      for (const lockKey of acquiredLockKeys.reverse()) {
        await store.releaseAdvisoryLock(lockKey);
      }
    }
  }
}
