import controlPlaneContract from "../control-plane-contract.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import { extractHetangAnalysisOrchestrationMetadata } from "../analysis-result.js";
import { summarizeAiLaneObservability } from "../ai-lanes/observability.js";
import type { HetangSemanticQualityService } from "./semantic-quality-service.js";
import { HetangOpsStore } from "../store.js";
import { CONTROL_PLANE_CONTRACT_VERSION, listAuthoritativeSchedulerJobs } from "../schedule.js";
import { resolveLocalDayStartIso, resolveReportBizDate } from "../time.js";
import { parseConversationReviewSummaryJson } from "./conversation-review-service.js";
import type {
  HetangActionItem,
  HetangAnalysisDeadLetterCleanupResult,
  HetangAnalysisDeadLetterSummary,
  HetangAnalysisDeadLetter,
  HetangBoundedAnalysisStage,
  HetangCommandAuditRecord,
  HetangCommandUsage,
  HetangDailyReportAuditSummary,
  HetangDailyReportReadinessStoreStatus,
  HetangDailyReportReadinessSummary,
  HetangControlTowerSettingRecord,
  HetangEmployeeBinding,
  DailyStoreReport,
  HetangFiveStoreDailyOverviewStatus,
  HetangFiveStoreDailyOverviewSummary,
  HetangConversationReviewLatestSummary,
  HetangConversationReviewOverview,
  HetangInboundMessageAuditRecord,
  HetangIndustryContextReadinessSummary,
  HetangLearningSummary,
  HetangLegacyServicePollerHealth,
  HetangEnvironmentMemoryReadinessSummary,
  HetangEnvironmentMemoryStoreStatus,
  HetangLogger,
  HetangNotificationTarget,
  HetangOpsConfig,
  HetangQueueStatusSummary,
  HetangReportDeliveryUpgradeSummary,
  HetangSchedulerJobSummary,
  HetangSchedulerStatusSummary,
  HetangSemanticFallbackObservability,
  HetangSemanticQualitySummary,
  HetangSyncExecutionSummary,
  HetangServicePollerHealth,
  HetangServicePollerName,
  ScheduledJobType,
  StoreEnvironmentDailySnapshotRecord,
} from "../types.js";

export type ServicePollerName = HetangServicePollerName;

export type ServicePollerState = HetangServicePollerHealth & {
  poller: ServicePollerName;
  status: "ok" | "failed";
  lastRunAt: string;
};

const AUTHORITATIVE_SERVICE_POLLERS = (
  controlPlaneContract as {
    service_pollers: Array<{ poller: ServicePollerName }>;
  }
).service_pollers.map((entry) => entry.poller);
const AUTHORITATIVE_SCHEDULED_SERVICE_POLLERS = new Set<ServicePollerName>([
  "scheduled-sync",
  "scheduled-delivery",
]);
const REPORT_DELIVERY_UPGRADE_WINDOW_DAYS = 7;
const REPORT_DELIVERY_UPGRADE_LIMIT = 5;
const ENVIRONMENT_MEMORY_RECENT_WINDOW_DAYS = 7;
const ANALYSIS_DEAD_LETTER_STALE_AFTER_HOURS = 24;
const SYNC_RUN_STALE_AFTER_HOURS = 4;
const INDUSTRY_CONTEXT_MODULES = [
  "hq_narrative",
  "world_model",
  "store_diagnosis",
] as const;
const ANALYSIS_DEAD_LETTER_SUBSCRIBER_FANOUT_EXHAUSTED_REASON =
  "delivery abandoned after subscriber fan-out exhaustion";
const FIVE_STORE_DAILY_OVERVIEW_JOB_TYPE = "send-five-store-daily-overview";
const DAILY_REPORT_AUDIT_JOB_TYPE = "audit-daily-report-window";
const RUNTIME_QUERY_ENTRY_SURFACE = {
  entryRole: "runtime_query_api",
  accessMode: "read_only",
  ownerSurface: "admin_read_service",
  auditMode: "none",
  requestDedupe: "none",
} as const;

function summarizeReplyError(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}

function normalizeStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeNotificationTarget(value: unknown): HetangNotificationTarget | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const channel = normalizeStringField(raw.channel);
  const target = normalizeStringField(raw.target);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : undefined;
  if (!channel || !target || enabled === undefined) {
    return undefined;
  }
  return {
    channel,
    target,
    accountId: normalizeStringField(raw.accountId),
    threadId: normalizeStringField(raw.threadId),
    enabled,
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function normalizeNumberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function summarizeDeadLetterReason(reason: string): string {
  const normalized = reason.replace(/\s+/gu, " ").trim();
  const explicitMessage = normalized.match(/errmsg=([^,]+(?:,[^,]+)*)/iu)?.[1]?.trim();
  if (explicitMessage && /invalid chatid/iu.test(explicitMessage)) {
    return "invalid chatid";
  }
  if (/invalid chatid/iu.test(normalized)) {
    return "invalid chatid";
  }
  const permissionDenied = normalized.match(/permission denied for schema [a-z0-9_]+/iu)?.[0];
  if (permissionDenied) {
    return permissionDenied;
  }
  const notAView = normalized.match(/"[^"]+" is not a view/iu)?.[0];
  if (notAView) {
    return notAView;
  }
  return summarizeReplyError(normalized);
}

function resolveDateOnlyAgeDays(fromDate: string, toDate: string): number | undefined {
  const fromMs = Date.parse(`${fromDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${toDate}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return undefined;
  }
  return Math.max(0, Math.floor((toMs - fromMs) / 86_400_000));
}

function isInvalidChatidDeadLetterReason(reason: string | undefined): boolean {
  return typeof reason === "string" && /invalid chatid/iu.test(reason);
}

function isSubscriberFanoutExhaustedReason(reason: string | undefined): boolean {
  return reason === ANALYSIS_DEAD_LETTER_SUBSCRIBER_FANOUT_EXHAUSTED_REASON;
}

function resolveDeadLetterAgeHours(now: Date, createdAt?: string): number | undefined {
  if (!createdAt) {
    return undefined;
  }
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return undefined;
  }
  return round(Math.max(0, now.getTime() - createdAtMs) / 3_600_000, 1);
}

function formatLegacyPollerWarning(state: HetangLegacyServicePollerHealth): string {
  const details = [`legacy poller state present: ${state.stateKey}`];
  if (state.status) {
    details.push(`status=${state.status}`);
  }
  if (state.lastRunAt) {
    details.push(`lastRun=${state.lastRunAt}`);
  }
  if (state.lastError) {
    details.push(`error=${state.lastError}`);
  }
  return details.join(" | ");
}

function formatStaleSyncRunWarning(summary: HetangSyncExecutionSummary): string {
  const details = [
    `stale sync runs present: running ${summary.runningCount}`,
    `stale ${summary.staleRunningCount}`,
    `daily ${summary.dailyRunningCount}/${summary.staleDailyRunningCount}`,
    `backfill ${summary.backfillRunningCount}/${summary.staleBackfillRunningCount}`,
  ];
  if (summary.latestStartedAt) {
    details.push(`latest=${summary.latestStartedAt}`);
  }
  if (typeof summary.latestAgeHours === "number") {
    details.push(`age=${summary.latestAgeHours.toFixed(1)}h`);
  }
  return details.join(" | ");
}

function formatActiveScheduledSyncWarning(summary: HetangSyncExecutionSummary): string {
  const details = [
    `scheduled sync wave in progress: running ${summary.runningCount}`,
    `daily ${summary.dailyRunningCount}`,
    `backfill ${summary.backfillRunningCount}`,
  ];
  if (summary.latestStartedAt) {
    details.push(`latest=${summary.latestStartedAt}`);
  }
  if (typeof summary.latestAgeHours === "number") {
    details.push(`age=${summary.latestAgeHours.toFixed(1)}h`);
  }
  details.push("scheduled-sync lastRun updates after the current wave finishes");
  return details.join(" | ");
}

function formatIdleScheduledSyncPollerWarning(params: {
  pollerLastRunAt: string;
  syncJobLastRanAt: string;
}): string {
  return [
    "scheduled-sync poller timestamp lags completed sync job",
    `poller=${params.pollerLastRunAt}`,
    `syncJob=${params.syncJobLastRanAt}`,
    "no active sync wave; scheduler job sync is authoritative",
  ].join(" | ");
}

function needsDailyReportMarkdownRefresh(
  report: Pick<DailyStoreReport, "markdown" | "complete">,
): boolean {
  if (!report.complete) {
    return false;
  }
  const markdown = report.markdown.trim();
  if (markdown.length === 0) {
    return true;
  }
  return (
    markdown.includes("【详细指标】") ||
    !markdown.includes("预估到店人数：") ||
    /^#\s/iu.test(markdown)
  );
}

function shouldExplainActiveScheduledSync(params: {
  syncExecutionSummary: HetangSyncExecutionSummary | null;
  scheduledSyncPoller: Partial<ServicePollerState> | null;
}): boolean {
  const { syncExecutionSummary, scheduledSyncPoller } = params;
  if (!syncExecutionSummary || syncExecutionSummary.runningCount <= 0) {
    return false;
  }
  if (syncExecutionSummary.staleRunningCount > 0) {
    return false;
  }
  if (!syncExecutionSummary.latestStartedAt || !scheduledSyncPoller?.lastRunAt) {
    return true;
  }
  const latestStartedAtMs = Date.parse(syncExecutionSummary.latestStartedAt);
  const lastRunAtMs = Date.parse(scheduledSyncPoller.lastRunAt);
  if (!Number.isFinite(latestStartedAtMs) || !Number.isFinite(lastRunAtMs)) {
    return true;
  }
  return latestStartedAtMs > lastRunAtMs;
}

function shouldExplainIdleScheduledSyncPoller(params: {
  syncExecutionSummary: HetangSyncExecutionSummary | null;
  scheduledSyncPoller: Partial<ServicePollerState> | null;
  syncJob: Pick<HetangSchedulerJobSummary, "status" | "lastRanAt"> | null;
}): boolean {
  const { syncExecutionSummary, scheduledSyncPoller, syncJob } = params;
  if (!syncExecutionSummary) {
    return false;
  }
  if (syncExecutionSummary.runningCount > 0 || syncExecutionSummary.staleRunningCount > 0) {
    return false;
  }
  if (syncJob?.status !== "completed" || !syncJob.lastRanAt || !scheduledSyncPoller?.lastRunAt) {
    return false;
  }
  const syncJobLastRanAtMs = Date.parse(syncJob.lastRanAt);
  const pollerLastRunAtMs = Date.parse(scheduledSyncPoller.lastRunAt);
  if (!Number.isFinite(syncJobLastRanAtMs) || !Number.isFinite(pollerLastRunAtMs)) {
    return false;
  }
  return syncJobLastRanAtMs > pollerLastRunAtMs;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function resolveSemanticFallbackObservability(
  config: HetangOpsConfig["semanticFallback"],
): HetangSemanticFallbackObservability {
  const configured = Boolean(config.baseUrl && config.apiKey && config.model);
  return {
    state: !config.enabled ? "off" : configured ? "on" : "unconfigured",
    enabled: config.enabled,
    configured,
    model: config.model,
    timeoutMs: config.timeoutMs,
    autoAcceptConfidence: config.autoAcceptConfidence,
    clarifyConfidence: config.clarifyConfidence,
  };
}

function percent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function resolveAnalysisDurationMinutes(
  job: Pick<{ startedAt?: string; finishedAt?: string }, "startedAt" | "finishedAt">,
): number | null {
  if (!job.startedAt || !job.finishedAt) {
    return null;
  }
  const startedAt = Date.parse(job.startedAt);
  const finishedAt = Date.parse(job.finishedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
    return null;
  }
  return (finishedAt - startedAt) / 60_000;
}

export class HetangAdminReadService {
  constructor(
    private readonly deps: {
      config: HetangOpsConfig;
      logger: HetangLogger;
      getStore: () => Promise<HetangOpsStore>;
      getSemanticQualityService?: () => Promise<
        Pick<HetangSemanticQualityService, "getSemanticQualitySummary">
      >;
    },
  ) {}

  private resolveQueueAccessControlStore(store: HetangOpsStore) {
    if (
      typeof (store as { getQueueAccessControlStore?: unknown }).getQueueAccessControlStore !==
      "function"
    ) {
      throw new Error("admin-read-service requires store.getQueueAccessControlStore()");
    }
    return (
      store as {
        getQueueAccessControlStore: () => {
          getScheduledJobState: HetangOpsStore["getScheduledJobState"];
          deleteScheduledJobState?: HetangOpsStore["deleteScheduledJobState"];
          setScheduledJobState: HetangOpsStore["setScheduledJobState"];
          listCompletedRunKeys: HetangOpsStore["listCompletedRunKeys"];
          getLatestScheduledJobRunTimes: HetangOpsStore["getLatestScheduledJobRunTimes"];
          getAnalysisQueueSummary: HetangOpsStore["getAnalysisQueueSummary"];
          getAnalysisDeadLetterSummary?: HetangOpsStore["getAnalysisDeadLetterSummary"];
          listAnalysisDeadLetters: HetangOpsStore["listAnalysisDeadLetters"];
          replayAnalysisDeadLetter: HetangOpsStore["replayAnalysisDeadLetter"];
          cleanupStaleInvalidChatidSubscriberResiduals?: HetangOpsStore["cleanupStaleInvalidChatidSubscriberResiduals"];
          listAnalysisJobs: HetangOpsStore["listAnalysisJobs"];
          createActionItem: HetangOpsStore["createActionItem"];
          listActionItems: HetangOpsStore["listActionItems"];
          getActionItem: HetangOpsStore["getActionItem"];
          updateActionItemStatus: HetangOpsStore["updateActionItemStatus"];
          resolveControlTowerSettings: HetangOpsStore["resolveControlTowerSettings"];
          upsertControlTowerSetting: HetangOpsStore["upsertControlTowerSetting"];
          getEmployeeBinding: HetangOpsStore["getEmployeeBinding"];
          listEmployeeBindings: HetangOpsStore["listEmployeeBindings"];
          upsertEmployeeBinding: HetangOpsStore["upsertEmployeeBinding"];
          revokeEmployeeBinding: HetangOpsStore["revokeEmployeeBinding"];
          countAllowedCommandAudits: HetangOpsStore["countAllowedCommandAudits"];
          recordCommandAudit: HetangOpsStore["recordCommandAudit"];
          recordInboundMessageAudit: HetangOpsStore["recordInboundMessageAudit"];
          listInboundMessageAudits: HetangOpsStore["listInboundMessageAudits"];
          listConversationReviewRuns: HetangOpsStore["listConversationReviewRuns"];
          listConversationReviewFindings: HetangOpsStore["listConversationReviewFindings"];
        };
      }
    ).getQueueAccessControlStore();
  }

  private resolveMartDerivedStore(store: HetangOpsStore) {
    if (typeof (store as { getMartDerivedStore?: unknown }).getMartDerivedStore !== "function") {
      throw new Error("admin-read-service requires store.getMartDerivedStore()");
    }
    return (
      store as {
        getMartDerivedStore: () => {
          getDailyReport?: (
            orgId: string,
            bizDate: string,
          ) => Promise<(DailyStoreReport & { sentAt?: string | null; sendStatus?: string | null }) | null>;
          listRecentReportDeliveryUpgrades?: (params?: {
            since?: string;
            limit?: number;
          }) => Promise<
            Array<{
              orgId: string;
              storeName: string;
              bizDate: string;
              alertSentAt?: string;
              upgradedAt: string;
            }>
          >;
        };
      }
    ).getMartDerivedStore();
  }

  private normalizeServicePollerState(
    rawState: Record<string, unknown> | null,
  ): Partial<ServicePollerState> | null {
    if (!rawState) {
      return null;
    }
    const normalizeString = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim().length > 0 ? value : undefined;
    const normalizeNumber = (value: unknown): number | undefined =>
      typeof value === "number" && Number.isFinite(value) ? value : undefined;
    const normalizeLines = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value.filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
          )
        : undefined;
    return {
      poller:
        rawState.poller === "scheduled-sync" ||
        rawState.poller === "scheduled-delivery" ||
        rawState.poller === "analysis"
          ? rawState.poller
          : undefined,
      status:
        rawState.status === "ok" || rawState.status === "failed" ? rawState.status : undefined,
      lastRunAt: normalizeString(rawState.lastRunAt),
      lastSuccessAt: normalizeString(rawState.lastSuccessAt),
      lastFailureAt: normalizeString(rawState.lastFailureAt),
      lastDurationMs: normalizeNumber(rawState.lastDurationMs),
      lastResultCount: normalizeNumber(rawState.lastResultCount),
      lastError: normalizeString(rawState.lastError),
      lastLines: normalizeLines(rawState.lastLines),
    };
  }

  private normalizeLegacyServicePollerState(
    stateKey: string,
    rawState: Record<string, unknown> | null,
  ): HetangLegacyServicePollerHealth | null {
    if (!rawState) {
      return null;
    }
    const normalized = this.normalizeServicePollerState(rawState);
    const poller =
      typeof rawState.poller === "string" && rawState.poller.trim().length > 0
        ? rawState.poller
        : stateKey;
    return {
      stateKey,
      poller,
      status: normalized?.status,
      lastRunAt: normalized?.lastRunAt,
      lastSuccessAt: normalized?.lastSuccessAt,
      lastFailureAt: normalized?.lastFailureAt,
      lastDurationMs: normalized?.lastDurationMs,
      lastResultCount: normalized?.lastResultCount,
      lastError: normalized?.lastError,
      lastLines: normalized?.lastLines,
    };
  }

  private async resolveDailyReportReadinessSummary(
    store: HetangOpsStore,
    now: Date,
  ): Promise<HetangDailyReportReadinessSummary | undefined> {
    const martStore = this.resolveMartDerivedStore(store);
    if (
      typeof (
        martStore as {
          getDailyReport?: unknown;
        }
      ).getDailyReport !== "function"
    ) {
      return undefined;
    }

    const bizDate = resolveReportBizDate({
      now,
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const activeStores = this.deps.config.stores.filter((entry) => entry.isActive);
    const stores = await Promise.all(
      activeStores.map(async (entry) => {
        const report = await (
          martStore as {
            getDailyReport: (
              orgId: string,
              bizDate: string,
            ) => Promise<(DailyStoreReport & { sentAt?: string | null; sendStatus?: string | null }) | null>;
          }
        ).getDailyReport(entry.orgId, bizDate);

        let status: HetangDailyReportReadinessStoreStatus = "missing";
        if (report) {
          status = !report.complete
            ? "incomplete"
            : needsDailyReportMarkdownRefresh(report)
              ? "refresh-needed"
              : "ready";
        }

        return {
          orgId: entry.orgId,
          storeName: entry.storeName,
          status,
        };
      }),
    );

    return {
      bizDate,
      totalStoreCount: stores.length,
      readyCount: stores.filter((entry) => entry.status === "ready").length,
      refreshNeededCount: stores.filter((entry) => entry.status === "refresh-needed").length,
      incompleteCount: stores.filter((entry) => entry.status === "incomplete").length,
      missingCount: stores.filter((entry) => entry.status === "missing").length,
      stores,
    };
  }

  private hasEnvironmentMemoryHolidayTruth(
    snapshot: Pick<StoreEnvironmentDailySnapshotRecord, "holidayTag" | "holidayName" | "isAdjustedWorkday">,
  ): boolean {
    if (typeof snapshot.isAdjustedWorkday === "boolean") {
      return true;
    }
    if (normalizeStringField(snapshot.holidayName)) {
      return true;
    }
    return (
      snapshot.holidayTag === "holiday" ||
      snapshot.holidayTag === "pre_holiday" ||
      snapshot.holidayTag === "post_holiday" ||
      snapshot.holidayTag === "adjusted_workday"
    );
  }

  private hasEnvironmentWeatherObservation(
    snapshot: Pick<
      StoreEnvironmentDailySnapshotRecord,
      "weatherConditionRaw" | "temperatureC" | "precipitationMm" | "windLevel"
    >,
  ): boolean {
    return (
      Boolean(normalizeStringField(snapshot.weatherConditionRaw)) ||
      typeof snapshot.temperatureC === "number" ||
      typeof snapshot.precipitationMm === "number" ||
      typeof snapshot.windLevel === "number"
    );
  }

  private resolveEnvironmentMemoryStoreStatus(
    snapshot: StoreEnvironmentDailySnapshotRecord | null,
  ): HetangEnvironmentMemoryStoreStatus {
    if (!snapshot) {
      return "missing";
    }
    const hasHolidayTruth = this.hasEnvironmentMemoryHolidayTruth(snapshot);
    const hasWeatherObservation = this.hasEnvironmentWeatherObservation(snapshot);
    if (!hasHolidayTruth && !hasWeatherObservation) {
      return "fallback-only";
    }
    if (!hasHolidayTruth) {
      return "missing-holiday";
    }
    if (!hasWeatherObservation) {
      return "missing-weather";
    }
    return "ready";
  }

  private resolveEnvironmentMemoryDisturbanceReasons(
    snapshot: Pick<
      StoreEnvironmentDailySnapshotRecord,
      "holidayTag" | "holidayName" | "weatherTag" | "badWeatherTouchPenalty"
    >,
  ): string[] {
    const reasons: string[] = [];
    if (
      snapshot.holidayTag === "holiday" ||
      snapshot.holidayTag === "pre_holiday" ||
      snapshot.holidayTag === "post_holiday"
    ) {
      reasons.push(`holiday:${snapshot.holidayName ?? snapshot.holidayTag}`);
    } else if (snapshot.holidayTag === "adjusted_workday") {
      reasons.push("holiday:adjusted_workday");
    }
    if (
      snapshot.weatherTag === "storm" ||
      snapshot.weatherTag === "snow" ||
      snapshot.weatherTag === "rain"
    ) {
      reasons.push(`weather:${snapshot.weatherTag}`);
    } else if (
      reasons.length === 0 &&
      (snapshot.badWeatherTouchPenalty === "high" || snapshot.badWeatherTouchPenalty === "medium")
    ) {
      reasons.push(`weather_penalty:${snapshot.badWeatherTouchPenalty}`);
    }
    return reasons;
  }

  private async resolveEnvironmentMemoryReadinessSummary(
    store: HetangOpsStore,
    now: Date,
  ): Promise<HetangEnvironmentMemoryReadinessSummary | undefined> {
    if (
      typeof (
        store as {
          getStoreEnvironmentDailySnapshot?: unknown;
          listStoreEnvironmentDailySnapshots?: unknown;
        }
      ).getStoreEnvironmentDailySnapshot !== "function" ||
      typeof (
        store as {
          getStoreEnvironmentDailySnapshot?: unknown;
          listStoreEnvironmentDailySnapshots?: unknown;
        }
      ).listStoreEnvironmentDailySnapshots !== "function"
    ) {
      return undefined;
    }

    const bizDate = resolveReportBizDate({
      now,
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const activeStores = this.deps.config.stores.filter((entry) => entry.isActive);
    const snapshotStore = store as {
      getStoreEnvironmentDailySnapshot: (
        orgId: string,
        bizDate: string,
      ) => Promise<StoreEnvironmentDailySnapshotRecord | null>;
      listStoreEnvironmentDailySnapshots: (
        orgId: string,
        limit?: number,
      ) => Promise<StoreEnvironmentDailySnapshotRecord[]>;
    };
    const currentSnapshots = await Promise.all(
      activeStores.map(async (entry) => {
        const snapshot = await snapshotStore.getStoreEnvironmentDailySnapshot(entry.orgId, bizDate);
        return {
          orgId: entry.orgId,
          storeName: entry.storeName,
          snapshot,
          status: this.resolveEnvironmentMemoryStoreStatus(snapshot),
        };
      }),
    );
    const recentSnapshots = (
      await Promise.all(
        activeStores.map(async (entry) => {
          const snapshots = await snapshotStore.listStoreEnvironmentDailySnapshots(
            entry.orgId,
            ENVIRONMENT_MEMORY_RECENT_WINDOW_DAYS,
          );
          return snapshots.map((snapshot) => ({
            orgId: entry.orgId,
            storeName: entry.storeName,
            snapshot,
          }));
        }),
      )
    ).flat();
    const disturbanceHighlights = recentSnapshots
      .filter(
        (entry) =>
          entry.snapshot.environmentDisturbanceLevel === "medium" ||
          entry.snapshot.environmentDisturbanceLevel === "high",
      )
      .sort((left, right) => {
        const bizDateCompare = right.snapshot.bizDate.localeCompare(left.snapshot.bizDate);
        if (bizDateCompare !== 0) {
          return bizDateCompare;
        }
        const levelScore = (value: string | undefined) => (value === "high" ? 2 : value === "medium" ? 1 : 0);
        const levelCompare =
          levelScore(right.snapshot.environmentDisturbanceLevel) -
          levelScore(left.snapshot.environmentDisturbanceLevel);
        if (levelCompare !== 0) {
          return levelCompare;
        }
        return left.storeName.localeCompare(right.storeName, "zh-CN");
      })
      .slice(0, 5)
      .map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        bizDate: entry.snapshot.bizDate,
        disturbanceLevel: entry.snapshot.environmentDisturbanceLevel as "medium" | "high",
        reasons: this.resolveEnvironmentMemoryDisturbanceReasons(entry.snapshot),
      }));

    return {
      bizDate,
      totalStoreCount: currentSnapshots.length,
      readyCount: currentSnapshots.filter((entry) => entry.status === "ready").length,
      missingCount: currentSnapshots.filter((entry) => entry.status === "missing").length,
      missingHolidayCount: currentSnapshots.filter((entry) => entry.status === "missing-holiday")
        .length,
      missingWeatherCount: currentSnapshots.filter((entry) => entry.status === "missing-weather")
        .length,
      fallbackOnlyCount: currentSnapshots.filter((entry) => entry.status === "fallback-only").length,
      highDisturbanceCount: currentSnapshots.filter(
        (entry) => entry.snapshot?.environmentDisturbanceLevel === "high",
      ).length,
      stores: currentSnapshots.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        status: entry.status,
      })),
      recentDisturbance: {
        windowDays: ENVIRONMENT_MEMORY_RECENT_WINDOW_DAYS,
        mediumOrHigherCount: recentSnapshots.filter(
          (entry) =>
            entry.snapshot.environmentDisturbanceLevel === "medium" ||
            entry.snapshot.environmentDisturbanceLevel === "high",
        ).length,
        highDisturbanceCount: recentSnapshots.filter(
          (entry) => entry.snapshot.environmentDisturbanceLevel === "high",
        ).length,
        hintCount: recentSnapshots.filter((entry) => entry.snapshot.narrativePolicy === "hint").length,
        mentionCount: recentSnapshots.filter(
          (entry) => entry.snapshot.narrativePolicy === "mention",
        ).length,
        highlights: disturbanceHighlights,
      },
    };
  }

  private async resolveIndustryContextReadinessSummary(
    store: HetangOpsStore,
    now: Date,
  ): Promise<HetangIndustryContextReadinessSummary | undefined> {
    if (
      typeof (
        store as {
          listIndustryContextSnapshots?: unknown;
        }
      ).listIndustryContextSnapshots !== "function"
    ) {
      return undefined;
    }

    const bizDate = resolveReportBizDate({
      now,
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const items = await (
      store as {
        listIndustryContextSnapshots: () => Promise<
          Array<{
            snapshotDate: string;
            applicableModules: string[];
          }>
        >;
      }
    ).listIndustryContextSnapshots();
    const moduleCoverage = INDUSTRY_CONTEXT_MODULES.map((module) => ({
      module,
      itemCount: items.filter((item) =>
        item.applicableModules.length === 0 || item.applicableModules.includes(module),
      ).length,
    }));

    if (items.length <= 0) {
      return {
        bizDate,
        status: "missing",
        itemCount: 0,
        moduleCoverage,
      };
    }

    const snapshotDate = items[0]?.snapshotDate;
    const freshnessDays =
      typeof snapshotDate === "string" ? resolveDateOnlyAgeDays(snapshotDate, bizDate) : undefined;

    return {
      bizDate,
      status: snapshotDate === bizDate ? "ready" : "refresh-needed",
      snapshotDate,
      itemCount: items.length,
      freshnessDays,
      moduleCoverage,
    };
  }

  private async resolveFiveStoreDailyOverviewSummary(params: {
    store: HetangOpsStore;
    now: Date;
    reportReadinessSummary?: HetangDailyReportReadinessSummary;
  }): Promise<HetangFiveStoreDailyOverviewSummary> {
    const queueStore = this.resolveQueueAccessControlStore(params.store);
    const activeStores = this.deps.config.stores.filter((entry) => entry.isActive);
    const readiness =
      params.reportReadinessSummary ??
      (await this.resolveDailyReportReadinessSummary(params.store, params.now));
    const bizDate =
      readiness?.bizDate ??
      resolveReportBizDate({
        now: params.now,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const pendingStoreNames =
      readiness?.stores
        .filter((entry) => entry.status !== "ready")
        .map((entry) => entry.storeName) ?? activeStores.map((entry) => entry.storeName);
    const totalStoreCount = readiness?.totalStoreCount ?? activeStores.length;
    const readyCount = readiness?.readyCount ?? 0;

    if (!this.deps.config.reporting.sendFiveStoreDailyOverviewEnabled) {
      return {
        bizDate,
        status: "disabled",
        totalStoreCount,
        readyCount,
        pendingStoreNames,
      };
    }

    const rawState =
      typeof (queueStore as { getScheduledJobState?: unknown }).getScheduledJobState === "function"
        ? await (
            queueStore as {
              getScheduledJobState: (
                jobType: string,
                stateKey: string,
              ) => Promise<Record<string, unknown> | null>;
            }
          ).getScheduledJobState(FIVE_STORE_DAILY_OVERVIEW_JOB_TYPE, bizDate)
        : null;
    const stage = normalizeStringField(rawState?.stage);
    const status: HetangFiveStoreDailyOverviewStatus =
      stage === "pending_confirm"
        ? "pending-confirm"
        : stage === "cancelled"
          ? "cancelled"
        : stage === "sent"
          ? "sent"
          : stage === "failed"
            ? "failed"
            : pendingStoreNames.length > 0
              ? "waiting"
              : "ready";

    return {
      bizDate,
      status,
      totalStoreCount,
      readyCount,
      pendingStoreNames,
      previewSentAt: normalizeStringField(rawState?.previewSentAt),
      canceledAt: normalizeStringField(rawState?.canceledAt),
      canceledBy: normalizeStringField(rawState?.canceledBy),
      confirmedAt: normalizeStringField(rawState?.confirmedAt),
      confirmedBy: normalizeStringField(rawState?.confirmedBy),
      finalSentAt: normalizeStringField(rawState?.finalSentAt),
      previewTarget: normalizeNotificationTarget(rawState?.previewTarget),
      finalTarget: normalizeNotificationTarget(rawState?.finalTarget),
    };
  }

  private async resolveDailyReportAuditSummary(params: {
    store: HetangOpsStore;
    now: Date;
    reportReadinessSummary?: HetangDailyReportReadinessSummary;
  }): Promise<HetangDailyReportAuditSummary | undefined> {
    const queueStore = this.resolveQueueAccessControlStore(params.store);
    const readiness =
      params.reportReadinessSummary ??
      (await this.resolveDailyReportReadinessSummary(params.store, params.now));
    const stateKey =
      readiness?.bizDate ??
      resolveReportBizDate({
        now: params.now,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const rawState =
      typeof (queueStore as { getScheduledJobState?: unknown }).getScheduledJobState === "function"
        ? await (
            queueStore as {
              getScheduledJobState: (
                jobType: string,
                stateKey: string,
              ) => Promise<Record<string, unknown> | null>;
            }
          ).getScheduledJobState(DAILY_REPORT_AUDIT_JOB_TYPE, stateKey)
        : null;
    if (!rawState) {
      return undefined;
    }

    const status = normalizeStringField(rawState.status);
    const endBizDate = normalizeStringField(rawState.endBizDate);
    const windowDays = normalizeNumberField(rawState.windowDays);
    const storeCount = normalizeNumberField(rawState.storeCount);
    const checkedReports = normalizeNumberField(rawState.checkedReports);
    const reportsWithFreshMismatch = normalizeNumberField(rawState.reportsWithFreshMismatch);
    const reportsWithStoredMismatch = normalizeNumberField(rawState.reportsWithStoredMismatch);
    const reportsWithOnlyMissingStored = normalizeNumberField(rawState.reportsWithOnlyMissingStored);
    const maxUnauditedMetricCount = normalizeNumberField(rawState.maxUnauditedMetricCount);
    if (
      (status !== "healthy" && status !== "warn") ||
      !endBizDate ||
      windowDays === undefined ||
      storeCount === undefined ||
      checkedReports === undefined ||
      reportsWithFreshMismatch === undefined ||
      reportsWithStoredMismatch === undefined ||
      reportsWithOnlyMissingStored === undefined ||
      maxUnauditedMetricCount === undefined
    ) {
      return undefined;
    }

    const sampleIssues = Array.isArray(rawState.sampleIssues)
      ? rawState.sampleIssues.flatMap((entry) => {
          if (!entry || typeof entry !== "object") {
            return [];
          }
          const raw = entry as Record<string, unknown>;
          const orgId = normalizeStringField(raw.orgId);
          const storeName = normalizeStringField(raw.storeName);
          const bizDate = normalizeStringField(raw.bizDate);
          if (!orgId || !storeName || !bizDate) {
            return [];
          }
          const topDiffs = Array.isArray(raw.topDiffs)
            ? raw.topDiffs.flatMap((diff) => {
                if (!diff || typeof diff !== "object") {
                  return [];
                }
                const rawDiff = diff as Record<string, unknown>;
                const metricKey = normalizeStringField(rawDiff.metricKey);
                const diffStatus = normalizeStringField(rawDiff.status);
                return metricKey && diffStatus ? [{ metricKey, status: diffStatus }] : [];
              })
            : [];
          return [{ orgId, storeName, bizDate, topDiffs }];
        })
      : [];

    return {
      status,
      endBizDate,
      windowDays,
      dates: normalizeStringArray(rawState.dates),
      storeCount,
      checkedReports,
      reportsWithFreshMismatch,
      reportsWithStoredMismatch,
      reportsWithOnlyMissingStored,
      maxUnauditedMetricCount,
      unauditedKeys: normalizeStringArray(rawState.unauditedKeys),
      sampleIssues,
      updatedAt: normalizeStringField(rawState.updatedAt),
    };
  }

  private async resolveReportDeliveryUpgradeSummary(
    store: HetangOpsStore,
    now: Date,
  ): Promise<HetangReportDeliveryUpgradeSummary> {
    const martStore = this.resolveMartDerivedStore(store);
    const windowStartAt = new Date(
      now.getTime() - REPORT_DELIVERY_UPGRADE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const recentUpgrades =
      typeof (
        martStore as {
          listRecentReportDeliveryUpgrades?: unknown;
        }
      ).listRecentReportDeliveryUpgrades === "function"
        ? await (
            martStore as {
              listRecentReportDeliveryUpgrades: (params?: {
                since?: string;
                limit?: number;
              }) => Promise<HetangReportDeliveryUpgradeSummary["recentUpgrades"]>;
            }
          ).listRecentReportDeliveryUpgrades({
            since: windowStartAt,
            limit: REPORT_DELIVERY_UPGRADE_LIMIT,
          })
        : [];
    return {
      windowStartAt,
      recentUpgradeCount: recentUpgrades.length,
      recentUpgrades,
    };
  }

  private async resolveSyncExecutionSummary(
    store: HetangOpsStore,
    now: Date,
  ): Promise<HetangSyncExecutionSummary | null> {
    if (
      typeof (
        store as {
          getSyncRunExecutionSummary?: unknown;
        }
      ).getSyncRunExecutionSummary !== "function"
    ) {
      return null;
    }
    const staleCutoffAt = new Date(now.getTime() - SYNC_RUN_STALE_AFTER_HOURS * 3_600_000)
      .toISOString();
    const summary = await (
      store as {
        getSyncRunExecutionSummary: (params: {
          staleBefore: string;
        }) => Promise<HetangSyncExecutionSummary>;
      }
    ).getSyncRunExecutionSummary({
      staleBefore: staleCutoffAt,
    });
    return {
      ...summary,
      latestStartedAt:
        typeof summary.latestStartedAt === "string" && summary.latestStartedAt.trim().length > 0
          ? summary.latestStartedAt
          : undefined,
      latestAgeHours: resolveDeadLetterAgeHours(now, summary.latestStartedAt),
      staleCutoffAt,
    };
  }

  async recordServicePollerOutcome(params: {
    poller: ServicePollerName;
    status: "ok" | "failed";
    startedAt: string;
    finishedAt?: string;
    lines?: string[];
    error?: unknown;
  }): Promise<void> {
    const finishedAt = params.finishedAt ?? new Date().toISOString();
    const startedMs = Date.parse(params.startedAt);
    const finishedMs = Date.parse(finishedAt);
    const lastDurationMs =
      Number.isFinite(startedMs) && Number.isFinite(finishedMs) && finishedMs >= startedMs
        ? finishedMs - startedMs
        : undefined;
    const lastLines = params.lines
      ?.map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 5);
    const lastError =
      params.status === "failed" && params.error !== undefined
        ? summarizeReplyError(summarizeUnknownError(params.error))
        : undefined;

    try {
      const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
      const previous = this.normalizeServicePollerState(
        await store.getScheduledJobState("service-poller", params.poller),
      );
      const nextState: ServicePollerState = {
        poller: params.poller,
        status: params.status,
        lastRunAt: finishedAt,
        lastSuccessAt: params.status === "ok" ? finishedAt : previous?.lastSuccessAt,
        lastFailureAt: params.status === "failed" ? finishedAt : previous?.lastFailureAt,
        lastDurationMs,
        lastResultCount: params.lines?.length ?? 0,
        lastError,
        lastLines: lastLines && lastLines.length > 0 ? lastLines : undefined,
      };
      await store.setScheduledJobState(
        "service-poller",
        params.poller,
        nextState as unknown as Record<string, unknown>,
        finishedAt,
      );
      if (
        AUTHORITATIVE_SCHEDULED_SERVICE_POLLERS.has(params.poller) &&
        typeof (store as { deleteScheduledJobState?: unknown }).deleteScheduledJobState ===
          "function"
      ) {
        await (
          store as {
            deleteScheduledJobState: (jobType: string, stateKey: string) => Promise<void>;
          }
        ).deleteScheduledJobState("service-poller", "scheduled");
      }
    } catch (error) {
      this.deps.logger.error(
        `hetang-ops: ${params.poller} poller status persistence failed: ${summarizeReplyError(
          summarizeUnknownError(error),
        )}`,
      );
    }

    if (params.status === "failed") {
      this.deps.logger.error(
        `hetang-ops: ${params.poller} poller failed: ${lastError ?? "unknown error"}`,
      );
      return;
    }

    if ((params.lines?.length ?? 0) > 0) {
      this.deps.logger.info(
        `hetang-ops: ${params.poller} poller ok (${params.lines?.length ?? 0} result lines)`,
      );
      if (lastLines && lastLines.length > 0) {
        this.deps.logger.debug?.(
          `hetang-ops: ${params.poller} poller sample lines: ${lastLines.join(" | ")}`,
        );
      }
      return;
    }

    this.deps.logger.debug?.(`hetang-ops: ${params.poller} poller ok (no due work)`);
  }

  async getSchedulerStatus(now = new Date()): Promise<HetangSchedulerStatusSummary> {
    const baseStore = await this.deps.getStore();
    const queueStore = this.resolveQueueAccessControlStore(baseStore);
    const [completedRunKeys, lastRunAtByJobType] = await Promise.all([
      typeof (queueStore as { listCompletedRunKeys?: unknown }).listCompletedRunKeys === "function"
        ? (
            queueStore as {
              listCompletedRunKeys: () => Promise<Set<string>>;
            }
          ).listCompletedRunKeys()
        : Promise.resolve(new Set<string>()),
      typeof (queueStore as { getLatestScheduledJobRunTimes?: unknown })
        .getLatestScheduledJobRunTimes === "function"
        ? (
            queueStore as {
              getLatestScheduledJobRunTimes: () => Promise<Partial<Record<string, string>>>;
            }
          ).getLatestScheduledJobRunTimes()
        : Promise.resolve({}),
    ]);
    const [
      pollerStates,
      legacyScheduled,
      reportDeliveryUpgradeSummary,
      dailyReportAuditSummary,
      reportReadinessSummary,
      industryContextSummary,
      environmentMemorySummary,
      syncExecutionSummary,
    ] = await Promise.all([
        Promise.all(
          AUTHORITATIVE_SERVICE_POLLERS.map(async (poller) =>
            this.normalizeServicePollerState(
              await queueStore.getScheduledJobState("service-poller", poller),
            ),
          ),
        ),
        this.normalizeLegacyServicePollerState(
          "scheduled",
          await queueStore.getScheduledJobState("service-poller", "scheduled"),
        ),
        this.resolveReportDeliveryUpgradeSummary(baseStore, now),
        this.resolveDailyReportAuditSummary({ store: baseStore, now }),
        this.resolveDailyReportReadinessSummary(baseStore, now),
        this.resolveIndustryContextReadinessSummary(baseStore, now),
        this.resolveEnvironmentMemoryReadinessSummary(baseStore, now),
        this.resolveSyncExecutionSummary(baseStore, now),
      ]);
    const legacyPollers = legacyScheduled ? [legacyScheduled] : [];
    const warnings = legacyPollers.map((entry) => formatLegacyPollerWarning(entry));
    if ((syncExecutionSummary?.staleRunningCount ?? 0) > 0) {
      warnings.push(formatStaleSyncRunWarning(syncExecutionSummary!));
    }
    const pollers: HetangServicePollerHealth[] = AUTHORITATIVE_SERVICE_POLLERS.map(
      (poller, index) =>
        (pollerStates[index]?.poller ? pollerStates[index] : { poller }) as HetangServicePollerHealth,
    );
    const jobs = listAuthoritativeSchedulerJobs({
      now,
      timeZone: this.deps.config.timeZone,
      completedRunKeys,
      lastRunAtByJobType: lastRunAtByJobType as Partial<Record<ScheduledJobType, string>>,
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
      historyBackfillEnabled: this.deps.config.sync.historyBackfillEnabled,
      reportingEnabled: this.deps.config.reporting.enabled,
    });
    const syncJob = jobs.find((job) => job.jobType === "sync") ?? null;
    const aiLanes = summarizeAiLaneObservability(this.deps.config);
    if (
      shouldExplainActiveScheduledSync({
        syncExecutionSummary,
        scheduledSyncPoller: pollerStates[0] ?? null,
      })
    ) {
      warnings.push(formatActiveScheduledSyncWarning(syncExecutionSummary!));
    } else if (
      shouldExplainIdleScheduledSyncPoller({
        syncExecutionSummary,
        scheduledSyncPoller: pollerStates[0] ?? null,
        syncJob,
      })
    ) {
      warnings.push(
        formatIdleScheduledSyncPollerWarning({
          pollerLastRunAt: pollerStates[0]!.lastRunAt!,
          syncJobLastRanAt: syncJob!.lastRanAt!,
        }),
      );
    }
    const fiveStoreDailyOverviewSummary = await this.resolveFiveStoreDailyOverviewSummary({
      store: baseStore,
      now,
      reportReadinessSummary,
    });

    return {
      authority: "app-service-pollers",
      contractVersion: CONTROL_PLANE_CONTRACT_VERSION,
      entrySurface: RUNTIME_QUERY_ENTRY_SURFACE,
      observabilityStreams: [
        "scheduler_snapshot",
        "ai_lane_summary",
        "report_delivery_upgrade_summary",
        ...(dailyReportAuditSummary ? ["daily_report_audit_summary" as const] : []),
        ...(reportReadinessSummary ? ["daily_report_readiness_summary" as const] : []),
        ...(industryContextSummary ? ["industry_context_summary" as const] : []),
        ...(environmentMemorySummary ? ["environment_memory_summary" as const] : []),
        "five_store_daily_overview_summary",
        "legacy_poller_warning",
      ],
      pollers,
      jobs,
      aiLanes,
      legacyPollers,
      warnings,
      reportDeliveryUpgradeSummary,
      dailyReportAuditSummary,
      reportReadinessSummary,
      industryContextSummary,
      environmentMemorySummary,
      fiveStoreDailyOverviewSummary,
    };
  }

  private async resolveAnalysisQueueSummary(
    store: {
      getAnalysisDeadLetterSummary?: () => Promise<HetangAnalysisDeadLetterSummary | null>;
      getAnalysisQueueSummary?: () => Promise<HetangQueueStatusSummary["analysis"]>;
      listAnalysisDeadLetters?: (params?: {
        orgId?: string;
        deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
        unresolvedOnly?: boolean;
        limit?: number;
      }) => Promise<HetangAnalysisDeadLetter[]>;
    },
    now: Date,
  ): Promise<HetangQueueStatusSummary["analysis"]> {
    const summary =
      typeof (store as { getAnalysisQueueSummary?: unknown }).getAnalysisQueueSummary ===
      "function"
        ? await (
          store as {
            getAnalysisQueueSummary: () => Promise<HetangQueueStatusSummary["analysis"]>;
          }
        ).getAnalysisQueueSummary()
        : {
          pendingCount: 0,
          runningCount: 0,
          completedCount: 0,
          failedCount: 0,
          jobDeliveryPendingCount: 0,
          jobDeliveryRetryingCount: 0,
          jobDeliveryAbandonedCount: 0,
          subscriberDeliveryPendingCount: 0,
          subscriberDeliveryRetryingCount: 0,
          subscriberDeliveryAbandonedCount: 0,
          unresolvedDeadLetterCount: 0,
        };
    const normalizedSummary = this.normalizeAnalysisQueueDeadLetterSummary(summary, now);
    if (normalizedSummary.unresolvedDeadLetterCount <= 0) {
      return normalizedSummary;
    }
    const deadLetterSummary =
      typeof (store as { getAnalysisDeadLetterSummary?: unknown }).getAnalysisDeadLetterSummary ===
      "function"
        ? await (
            store as {
              getAnalysisDeadLetterSummary: () => Promise<HetangAnalysisDeadLetterSummary | null>;
            }
          ).getAnalysisDeadLetterSummary()
        : await this.resolveAnalysisDeadLetterSummaryFromList(
            store as {
              listAnalysisDeadLetters?: (params?: {
                orgId?: string;
                deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
                unresolvedOnly?: boolean;
                limit?: number;
              }) => Promise<HetangAnalysisDeadLetter[]>;
            },
            normalizedSummary.unresolvedDeadLetterCount,
          );
    if (!deadLetterSummary) {
      return normalizedSummary;
    }
    return {
      ...normalizedSummary,
      deadLetterSummary: this.decorateAnalysisDeadLetterSummary(deadLetterSummary, now),
    };
  }

  private normalizeAnalysisQueueDeadLetterSummary(
    summary: HetangQueueStatusSummary["analysis"],
    now: Date,
  ): HetangQueueStatusSummary["analysis"] {
    if (!summary.deadLetterSummary) {
      return summary;
    }
    return {
      ...summary,
      deadLetterSummary: this.decorateAnalysisDeadLetterSummary(summary.deadLetterSummary, now),
    };
  }

  private decorateAnalysisDeadLetterSummary(
    summary: HetangAnalysisDeadLetterSummary,
    now: Date,
  ): HetangAnalysisDeadLetterSummary {
    const latestUnresolvedAgeHours = resolveDeadLetterAgeHours(now, summary.latestUnresolvedAt);
    const stale =
      typeof latestUnresolvedAgeHours === "number"
        ? latestUnresolvedAgeHours >= ANALYSIS_DEAD_LETTER_STALE_AFTER_HOURS
        : undefined;
    const invalidChatidSubscriberCount = summary.invalidChatidSubscriberCount ?? 0;
    const subscriberFanoutExhaustedJobCount = summary.subscriberFanoutExhaustedJobCount ?? 0;
    const residualClass =
      stale &&
      summary.unresolvedSubscriberCount > 0 &&
      invalidChatidSubscriberCount === summary.unresolvedSubscriberCount &&
      subscriberFanoutExhaustedJobCount === summary.unresolvedJobCount
        ? "stale-invalid-chatid-subscriber"
        : undefined;
    return {
      ...summary,
      latestUnresolvedAgeHours,
      stale,
      latestReason: summary.latestReason ? summarizeDeadLetterReason(summary.latestReason) : undefined,
      invalidChatidSubscriberCount,
      subscriberFanoutExhaustedJobCount,
      residualClass,
    };
  }

  private async resolveAnalysisDeadLetterSummaryFromList(
    store: {
      listAnalysisDeadLetters?: (params?: {
        orgId?: string;
        deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
        unresolvedOnly?: boolean;
        limit?: number;
      }) => Promise<HetangAnalysisDeadLetter[]>;
    },
    unresolvedDeadLetterCount: number,
  ): Promise<HetangAnalysisDeadLetterSummary | null> {
    if (
      typeof (store as { listAnalysisDeadLetters?: unknown }).listAnalysisDeadLetters !== "function"
    ) {
      return null;
    }
    const deadLetters = await (
      store as {
        listAnalysisDeadLetters: (params?: {
          orgId?: string;
          deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
          unresolvedOnly?: boolean;
          limit?: number;
        }) => Promise<HetangAnalysisDeadLetter[]>;
      }
    ).listAnalysisDeadLetters({
      unresolvedOnly: true,
      limit: Math.max(1, Math.min(unresolvedDeadLetterCount, 100)),
    });
    if (deadLetters.length === 0) {
      return null;
    }
    return {
      unresolvedJobCount: deadLetters.filter((entry) => entry.deadLetterScope === "job").length,
      unresolvedSubscriberCount: deadLetters.filter((entry) => entry.deadLetterScope === "subscriber")
        .length,
      latestUnresolvedAt: deadLetters[0]?.createdAt,
      latestReason: deadLetters[0]?.reason,
      invalidChatidSubscriberCount: deadLetters.filter(
        (entry) =>
          entry.deadLetterScope === "subscriber" && isInvalidChatidDeadLetterReason(entry.reason),
      ).length,
      subscriberFanoutExhaustedJobCount: deadLetters.filter(
        (entry) =>
          entry.deadLetterScope === "job" && isSubscriberFanoutExhaustedReason(entry.reason),
      ).length,
    };
  }

  async getQueueStatus(
    now = new Date(),
    schedulerStatus?: HetangSchedulerStatusSummary,
  ): Promise<HetangQueueStatusSummary> {
    const effectiveSchedulerStatus = schedulerStatus ?? (await this.getSchedulerStatus(now));
    const summarizeLane = (orchestrator: "sync" | "delivery"): HetangQueueStatusSummary["sync"] => {
      const jobs = effectiveSchedulerStatus.jobs.filter((job) => job.orchestrator === orchestrator);
      return {
        pendingCount: jobs.filter((job) => job.status === "pending").length,
        completedCount: jobs.filter((job) => job.status === "completed").length,
        waitingCount: jobs.filter((job) => job.status === "waiting").length,
      };
    };
    const baseStore = await this.deps.getStore();
    const store = this.resolveQueueAccessControlStore(baseStore);
    const [analysis, syncExecution] = await Promise.all([
      this.resolveAnalysisQueueSummary(store, now),
      this.resolveSyncExecutionSummary(baseStore, now),
    ]);
    return {
      entrySurface: RUNTIME_QUERY_ENTRY_SURFACE,
      observabilityStreams: [
        "queue_snapshot",
        "analysis_dead_letter_summary",
        "sync_execution_summary",
      ],
      sync: summarizeLane("sync"),
      delivery: summarizeLane("delivery"),
      analysis,
      syncExecution: syncExecution ?? undefined,
    };
  }

  async getSemanticQualitySummary(params: {
    windowHours?: number;
    now?: Date;
    limit?: number;
    occurredAfter?: string;
    deployMarker?: string;
  } = {}): Promise<HetangSemanticQualitySummary> {
    const fallbackConfig = resolveSemanticFallbackObservability(this.deps.config.semanticFallback);
    const fallbackSummary: HetangSemanticQualitySummary = {
      windowHours: params.windowHours ?? 24,
      totalCount: 0,
      successCount: 0,
      successRate: null,
      clarifyCount: 0,
      clarifyRate: null,
      fallbackUsedCount: 0,
      fallbackRate: null,
      topFailureClasses: [],
      topAnalysisFrameworks: [],
      topRouteUpgrades: [],
      optimizationBacklog: [],
      sampleCandidates: [],
      reviewBacklog: [],
      reviewSampleCandidates: [],
      reviewDeployFollowupCount: 0,
      fallbackConfig,
      carrySuccessCount: 0,
      carrySuccessRate: null,
      topicSwitchCount: 0,
    };
    if (!this.deps.getSemanticQualityService) {
      return fallbackSummary;
    }
    try {
      const service = await this.deps.getSemanticQualityService();
      const summary = await service.getSemanticQualitySummary({
        windowHours: params.windowHours ?? 24,
        now: params.now ?? new Date(),
        limit: params.limit ?? 5,
        occurredAfter: params.occurredAfter,
        deployMarker: params.deployMarker,
      });
      return {
        ...summary,
        fallbackConfig,
      };
    } catch (error) {
      this.deps.logger.warn(
        `hetang-ops: semantic quality summary unavailable: ${summarizeUnknownError(error)}`,
      );
      return fallbackSummary;
    }
  }

  async listAnalysisDeadLetters(
    params: {
      orgId?: string;
      deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
      unresolvedOnly?: boolean;
      limit?: number;
    } = {},
  ): Promise<HetangAnalysisDeadLetter[]> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    if (
      typeof (store as { listAnalysisDeadLetters?: unknown }).listAnalysisDeadLetters !== "function"
    ) {
      return [];
    }
    return await (
      store as {
        listAnalysisDeadLetters: (params: {
          orgId?: string;
          deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
          unresolvedOnly?: boolean;
          limit?: number;
        }) => Promise<HetangAnalysisDeadLetter[]>;
      }
    ).listAnalysisDeadLetters(params);
  }

  async replayAnalysisDeadLetter(params: {
    deadLetterKey: string;
    replayedAt: string;
  }): Promise<HetangAnalysisDeadLetter | null> {
    const baseStore = await this.deps.getStore();
    const store = this.resolveQueueAccessControlStore(baseStore);
    if (
      typeof (store as { replayAnalysisDeadLetter?: unknown }).replayAnalysisDeadLetter !==
      "function"
    ) {
      return null;
    }
    return await (
      store as {
        replayAnalysisDeadLetter: (params: {
          deadLetterKey: string;
          replayedAt: string;
        }) => Promise<HetangAnalysisDeadLetter | null>;
      }
    ).replayAnalysisDeadLetter(params);
  }

  async cleanupStaleInvalidChatidSubscriberResiduals(params: {
    resolvedAt: string;
    limit?: number;
  }): Promise<HetangAnalysisDeadLetterCleanupResult> {
    const baseStore = await this.deps.getStore();
    const store = this.resolveQueueAccessControlStore(baseStore);
    if (
      typeof (store as { cleanupStaleInvalidChatidSubscriberResiduals?: unknown })
        .cleanupStaleInvalidChatidSubscriberResiduals !== "function"
    ) {
      return {
        residualClass: "stale-invalid-chatid-subscriber",
        cleanedSubscriberCount: 0,
        cleanedJobCount: 0,
        resolvedDeadLetterCount: 0,
      };
    }
    const staleBefore = new Date(
      Date.parse(params.resolvedAt) - ANALYSIS_DEAD_LETTER_STALE_AFTER_HOURS * 3_600_000,
    ).toISOString();
    return await (
      store as {
        cleanupStaleInvalidChatidSubscriberResiduals: (params: {
          resolvedAt: string;
          staleBefore: string;
          limit?: number;
        }) => Promise<HetangAnalysisDeadLetterCleanupResult>;
      }
    ).cleanupStaleInvalidChatidSubscriberResiduals({
      resolvedAt: params.resolvedAt,
      staleBefore,
      limit: params.limit,
    });
  }

  async createAction(
    params: Omit<HetangActionItem, "actionId" | "createdAt" | "updatedAt"> & {
      actionId?: string;
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<HetangActionItem> {
    const baseStore = await this.deps.getStore();
    const store = this.resolveQueueAccessControlStore(baseStore);
    const createdAt = params.createdAt ?? new Date().toISOString();
    const updatedAt = params.updatedAt ?? createdAt;
    const action: HetangActionItem = {
      ...params,
      actionId: params.actionId ?? `ACT-${randomUUID().slice(0, 8)}`,
      createdAt,
      updatedAt,
    };
    await store.createActionItem(action);
    return {
      ...action,
      storeName: await baseStore.getStoreName(action.orgId),
    };
  }

  async listActions(
    params: {
      orgId?: string;
      status?: HetangActionItem["status"];
    } = {},
  ): Promise<HetangActionItem[]> {
    const baseStore = await this.deps.getStore();
    const store = this.resolveQueueAccessControlStore(baseStore);
    const items = await store.listActionItems(params);
    return await Promise.all(
      items.map(async (item) => ({
        ...item,
        storeName: await baseStore.getStoreName(item.orgId),
      })),
    );
  }

  async getActionItem(actionId: string): Promise<HetangActionItem | null> {
    const baseStore = await this.deps.getStore();
    const store = this.resolveQueueAccessControlStore(baseStore);
    const item = await store.getActionItem(actionId);
    if (!item) {
      return null;
    }
    return {
      ...item,
      storeName: await baseStore.getStoreName(item.orgId),
    };
  }

  async updateActionStatus(params: {
    actionId: string;
    status: HetangActionItem["status"];
    resultNote?: string;
    effectScore?: number;
    ownerName?: string;
    dueDate?: string;
    updatedAt?: string;
    completedAt?: string;
  }): Promise<HetangActionItem | null> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    const updatedAt = params.updatedAt ?? new Date().toISOString();
    const completedAt =
      params.completedAt ??
      (params.status === "done" || params.status === "failed" ? updatedAt : undefined);
    await store.updateActionItemStatus({
      ...params,
      updatedAt,
      completedAt,
    });
    return await this.getActionItem(params.actionId);
  }

  async getLearningSummary(params: { orgId?: string }): Promise<HetangLearningSummary> {
    const baseStore = await this.deps.getStore();
    const store = this.resolveQueueAccessControlStore(baseStore);
    const [items, analysisJobs] = await Promise.all([
      store.listActionItems(params.orgId ? { orgId: params.orgId } : {}),
      store.listAnalysisJobs(params.orgId ? { orgId: params.orgId } : {}),
    ]);
    const decidedStatuses = new Set<HetangActionItem["status"]>([
      "approved",
      "executing",
      "done",
      "failed",
      "rejected",
    ]);
    const adoptedStatuses = new Set<HetangActionItem["status"]>([
      "approved",
      "executing",
      "done",
      "failed",
    ]);
    const decided = items.filter((item) => decidedStatuses.has(item.status));
    const adopted = items.filter((item) => adoptedStatuses.has(item.status));
    const rejected = items.filter((item) => item.status === "rejected");
    const done = items.filter((item) => item.status === "done");
    const failed = items.filter((item) => item.status === "failed");
    const topEffectiveCategories = Array.from(
      items
        .filter((item) => typeof item.effectScore === "number")
        .reduce((map, item) => {
          const current = map.get(item.category) ?? {
            category: item.category,
            actionCount: 0,
            totalEffectScore: 0,
          };
          current.actionCount += 1;
          current.totalEffectScore += item.effectScore ?? 0;
          map.set(item.category, current);
          return map;
        }, new Map<string, { category: string; actionCount: number; totalEffectScore: number }>())
        .values(),
    )
      .map((entry) => ({
        category: entry.category,
        actionCount: entry.actionCount,
        averageEffectScore: round(entry.totalEffectScore / entry.actionCount, 2),
      }))
      .sort((left, right) => {
        if (right.averageEffectScore !== left.averageEffectScore) {
          return right.averageEffectScore - left.averageEffectScore;
        }
        return right.actionCount - left.actionCount;
      })
      .slice(0, 3);
    const analysisCompleted = analysisJobs.filter((job) => job.status === "completed");
    const analysisFailed = analysisJobs.filter((job) => job.status === "failed");
    const analysisRetried = analysisJobs.filter((job) => job.attemptCount > 1);
    const analysisFallbackCount = analysisCompleted.filter((job) =>
      Boolean(extractHetangAnalysisOrchestrationMetadata(job.resultText)?.fallbackStage),
    ).length;
    const analysisFallbackStageBreakdown = Array.from(
      analysisCompleted.reduce(
        (map, job) => {
          const fallbackStage = extractHetangAnalysisOrchestrationMetadata(job.resultText)?.fallbackStage;
          if (!fallbackStage) {
            return map;
          }
          map.set(fallbackStage, (map.get(fallbackStage) ?? 0) + 1);
          return map;
        },
        new Map<HetangBoundedAnalysisStage, number>(),
      ),
    )
      .map(([stage, count]) => ({
        stage,
        count,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.stage.localeCompare(right.stage);
      });
    const analysisActionItems = items.filter((item) => item.sourceKind === "analysis");
    const analysisActionedJobIds = new Set(
      analysisActionItems
        .map((item) => item.sourceRef?.match(/^analysis:([^:]+):/u)?.[1])
        .filter((value): value is string => Boolean(value)),
    );
    const analysisDurations = analysisJobs
      .map((job) => resolveAnalysisDurationMinutes(job))
      .filter((value): value is number => value !== null);
    const analysisAverageDurationMinutes =
      analysisDurations.length > 0
        ? round(
            analysisDurations.reduce((total, value) => total + value, 0) / analysisDurations.length,
            1,
          )
        : null;

    return {
      orgId: params.orgId ?? "all",
      storeName: params.orgId ? await baseStore.getStoreName(params.orgId) : "全部门店",
      totalActionCount: items.length,
      decidedActionCount: decided.length,
      adoptedActionCount: adopted.length,
      rejectedActionCount: rejected.length,
      doneActionCount: done.length,
      failedActionCount: failed.length,
      adoptionRate: percent(adopted.length, decided.length),
      completionRate: percent(done.length, adopted.length),
      analysisJobCount: analysisJobs.length,
      analysisCompletedCount: analysisCompleted.length,
      analysisFailedCount: analysisFailed.length,
      analysisRetriedJobCount: analysisRetried.length,
      analysisCompletionRate: percent(analysisCompleted.length, analysisJobs.length),
      analysisRetryRate: percent(analysisRetried.length, analysisJobs.length),
      analysisAverageDurationMinutes,
      analysisFallbackCount,
      analysisFallbackRate: percent(analysisFallbackCount, analysisCompleted.length),
      analysisFallbackStageBreakdown,
      analysisAutoActionItemCount: analysisActionItems.length,
      analysisActionedJobCount: analysisActionedJobIds.size,
      analysisActionConversionRate: percent(analysisActionedJobIds.size, analysisCompleted.length),
      analysisAverageActionsPerCompletedJob:
        analysisCompleted.length > 0
          ? round(analysisActionItems.length / analysisCompleted.length, 1)
          : null,
      topEffectiveCategories,
    };
  }

  async resolveControlTowerSettings(
    params: {
      orgId?: string;
    } = {},
  ): Promise<Record<string, string | number | boolean>> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    return await store.resolveControlTowerSettings(params.orgId);
  }

  async upsertControlTowerSetting(
    record: HetangControlTowerSettingRecord,
  ): Promise<HetangControlTowerSettingRecord> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    await store.upsertControlTowerSetting(record);
    return record;
  }

  async getEmployeeBinding(params: {
    channel: string;
    senderId: string;
  }): Promise<HetangEmployeeBinding | null> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    return await store.getEmployeeBinding(params);
  }

  async listEmployeeBindings(channel?: string): Promise<HetangEmployeeBinding[]> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    return await store.listEmployeeBindings(channel);
  }

  async grantEmployeeBinding(binding: HetangEmployeeBinding): Promise<void> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    await store.upsertEmployeeBinding(binding);
  }

  async revokeEmployeeBinding(params: {
    channel: string;
    senderId: string;
    updatedAt?: string;
  }): Promise<void> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    await store.revokeEmployeeBinding(params);
  }

  async getCommandUsage(params: {
    channel: string;
    senderId: string;
    now?: Date;
  }): Promise<HetangCommandUsage> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    const now = params.now ?? new Date();
    return {
      hourlyCount: await store.countAllowedCommandAudits({
        channel: params.channel,
        senderId: params.senderId,
        since: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      }),
      dailyCount: await store.countAllowedCommandAudits({
        channel: params.channel,
        senderId: params.senderId,
        since: resolveLocalDayStartIso(now, this.deps.config.timeZone),
      }),
    };
  }

  async recordCommandAudit(record: HetangCommandAuditRecord): Promise<void> {
    const store = await this.deps.getStore();
    await store.recordCommandAudit(record);
  }

  async recordInboundMessageAudit(record: HetangInboundMessageAuditRecord): Promise<void> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    await store.recordInboundMessageAudit(record);
  }

  async listInboundMessageAudits(params?: {
    channel?: string;
    senderId?: string;
    conversationId?: string;
    contains?: string;
    limit?: number;
  }): Promise<HetangInboundMessageAuditRecord[]> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    return await store.listInboundMessageAudits(params);
  }

  async getLatestConversationReviewSummary(): Promise<HetangConversationReviewLatestSummary | null> {
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    if (
      typeof (store as { listConversationReviewRuns?: unknown }).listConversationReviewRuns !==
      "function" ||
      typeof (store as { listConversationReviewFindings?: unknown }).listConversationReviewFindings !==
        "function"
    ) {
      return null;
    }

    const [run] = await (
      store as {
        listConversationReviewRuns: (params?: { status?: string; limit?: number }) => Promise<
          Array<{
            reviewRunId: string;
            summaryJson?: string;
          }>
        >;
      }
    ).listConversationReviewRuns({ limit: 1 });
    if (!run) {
      return null;
    }

    const findings = await (
      store as {
        listConversationReviewFindings: (params?: {
          reviewRunId?: string;
          findingType?: string;
          status?: string;
          limit?: number;
        }) => Promise<
          Array<{
            severity: string;
          }>
        >;
      }
    ).listConversationReviewFindings({
      reviewRunId: run.reviewRunId,
      status: "open",
      limit: 100,
    });

    return {
      run: run as never,
      summary: parseConversationReviewSummaryJson(run.summaryJson),
      unresolvedHighSeverityFindings: findings.filter(
        (finding) => finding.severity === "high",
      ) as never,
    };
  }

  async getConversationReviewSummary(): Promise<HetangConversationReviewOverview> {
    const latest = await this.getLatestConversationReviewSummary();
    if (!latest) {
      return {
        latestRun: null,
        summary: null,
        topFindingTypes: [],
        suggestedActionCounts: [],
        followupTargetCounts: [],
        unresolvedHighSeverityFindings: [],
      };
    }

    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    const findings =
      typeof (store as { listConversationReviewFindings?: unknown }).listConversationReviewFindings ===
      "function"
        ? await (
            store as {
              listConversationReviewFindings: (params?: {
                reviewRunId?: string;
                findingType?: string;
                status?: string;
                limit?: number;
              }) => Promise<
                Array<{
                  findingType?: string;
                  suggestedActionType?: string;
                  followupTargets?: string[];
                }>
              >;
            }
          ).listConversationReviewFindings({
            reviewRunId: latest.run.reviewRunId,
            limit: 500,
          })
        : [];

    const topFindingTypes = Array.from(
      findings.reduce((map, finding) => {
        if (!finding.findingType) {
          return map;
        }
        map.set(finding.findingType, (map.get(finding.findingType) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
    )
      .map(([findingType, count]) => ({
        findingType,
        count,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.findingType.localeCompare(right.findingType);
      }) as HetangConversationReviewOverview["topFindingTypes"];

    const suggestedActionCounts = Array.from(
      findings.reduce((map, finding) => {
        if (!finding.suggestedActionType) {
          return map;
        }
        map.set(finding.suggestedActionType, (map.get(finding.suggestedActionType) ?? 0) + 1);
        return map;
      }, new Map<string, number>()),
    )
      .map(([suggestedActionType, count]) => ({
        suggestedActionType,
        count,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.suggestedActionType.localeCompare(right.suggestedActionType);
      });

    const followupTargetCounts = Array.from(
      findings.reduce((map, finding) => {
        for (const followupTarget of finding.followupTargets ?? []) {
          if (!followupTarget) {
            continue;
          }
          map.set(followupTarget, (map.get(followupTarget) ?? 0) + 1);
        }
        return map;
      }, new Map<string, number>()),
    )
      .map(([followupTarget, count]) => ({
        followupTarget,
        count,
      }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.followupTarget.localeCompare(right.followupTarget);
      }) as HetangConversationReviewOverview["followupTargetCounts"];

    return {
      latestRun: latest.run,
      summary: latest.summary,
      topFindingTypes,
      suggestedActionCounts,
      followupTargetCounts,
      unresolvedHighSeverityFindings: latest.unresolvedHighSeverityFindings,
    };
  }
}
