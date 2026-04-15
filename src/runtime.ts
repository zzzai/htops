import { resolveAiSemanticFallback } from "./ai-semantic-fallback.js";
import { hasHetangApiCredentials } from "./config.js";
import { type ExternalBriefLlmClient } from "./external-intelligence/llm.js";
import { sendReportMessage, type CommandRunner } from "./notify.js";
import {
  formatAnalysisDeliveryHealthSummary,
  formatAnalysisQueueLine,
  formatDoctorPollerState,
  formatQueueLaneLine,
  formatSchedulerJobDoctorLine,
  renderHetangDoctorReport,
} from "./ops/doctor.js";
import {
  HetangAdminReadService,
  type ServicePollerName,
  type ServicePollerState,
} from "./app/admin-read-service.js";
import { HetangAnalysisExecutionService } from "./app/analysis-execution-service.js";
import {
  HetangAnalysisQueueLimitError,
  HetangAnalysisService,
} from "./app/analysis-service.js";
import { buildHetangDiagnosticBundle } from "./app/analysis-diagnostic-service.js";
import { HetangDeliveryService } from "./app/delivery-service.js";
import {
  HetangExternalIntelligenceService,
  type BuiltExternalBriefIssue,
  type ExternalSourceDocumentInput,
} from "./app/external-intelligence-service.js";
import { HetangQueryReadService } from "./app/query-read-service.js";
import { HetangReportingService } from "./app/reporting-service.js";
import { HetangSyncService } from "./app/sync-service.js";
import { HetangRuntimeContext } from "./runtime/runtime-context.js";
import { HetangOpsStore } from "./store.js";
import { HetangSyncOrchestrator } from "./sync-orchestrator.js";
import { syncHetangStore } from "./sync.js";
import type {
  HetangActionItem,
  HetangAnalysisDeliveryHealthSummary,
  HetangAnalysisDeadLetter,
  HetangAnalysisJob,
  DailyStoreReport,
  HetangCommandAuditRecord,
  HetangCommandUsage,
  HetangClientLike,
  HetangControlTowerSettingRecord,
  HetangEmployeeBinding,
  HetangInboundMessageAuditRecord,
  HetangLearningSummary,
  HetangLogger,
  HetangNotificationTarget,
  HetangOpsConfig,
  HetangQueueStatusSummary,
  MemberReactivationFeatureRecord,
  MemberReactivationFeedbackRecord,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
  RechargeBillRecord,
  HetangSchedulerStatusSummary,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechProfile30dRow,
  TechLeaderboardRow,
} from "./types.js";

export function isHetangAnalysisQueueLimitError(
  error: unknown,
): error is HetangAnalysisQueueLimitError {
  return (
    error instanceof HetangAnalysisQueueLimitError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "HETANG_ANALYSIS_QUEUE_LIMIT")
  );
}

type RuntimeParams = {
  config: HetangOpsConfig;
  logger: HetangLogger;
  resolveStateDir: () => string;
  runCommandWithTimeout: CommandRunner;
  poolRole?: "app" | "query" | "sync" | "analysis";
  databaseUrlOverride?: string;
  poolMaxOverride?: number;
  resolveNow?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  syncStore?: typeof syncHetangStore;
  createApiClient?: (
    apiConfig: HetangOpsConfig["api"],
  ) => Pick<HetangClientLike, "fetchPaged" | "fetchTechUpClockList" | "fetchTechMarketList">;
  loadExternalSourceDocuments?: (params: {
    now: Date;
    config: HetangOpsConfig;
  }) => Promise<ExternalSourceDocumentInput[]>;
  externalBriefLlm?: ExternalBriefLlmClient;
};

function formatWatermarks(watermarks: Record<string, string>): string {
  const entries = Object.entries(watermarks).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return "none";
  }
  return entries.map(([endpoint, value]) => `${endpoint}=${value}`).join(", ");
}

function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return "configured";
  }
}

export class HetangOpsRuntime {
  private runtimeContext: HetangRuntimeContext | null = null;
  private store: HetangOpsStore | null = null;
  private syncOrchestrator: HetangSyncOrchestrator | null = null;
  private deliveryService: HetangDeliveryService | null = null;
  private analysisExecutionService: HetangAnalysisExecutionService | null = null;
  private analysisService: HetangAnalysisService | null = null;
  private adminReadService: HetangAdminReadService | null = null;
  private queryReadService: HetangQueryReadService | null = null;
  private reportingService: HetangReportingService | null = null;
  private syncService: HetangSyncService | null = null;
  private externalIntelligenceService: HetangExternalIntelligenceService | null = null;

  constructor(private readonly params: RuntimeParams) {}

  private getRuntimeContext(): HetangRuntimeContext {
    if (!this.runtimeContext) {
      this.runtimeContext = new HetangRuntimeContext({
        config: this.params.config,
        poolRole: this.params.poolRole,
        databaseUrlOverride: this.params.databaseUrlOverride,
        poolMaxOverride: this.params.poolMaxOverride,
        resolveStoreForShell: async () => await this.getStore(),
        renderDoctorReport: async () => {
          const store = await this.getStore();
          const schedulerStatus = await this.getAdminReadService().getSchedulerStatus(
            this.resolveNow(),
          );
          const queueStatus = await this.getAdminReadService().getQueueStatus(this.resolveNow());
          const analysisDeliverySummary =
            typeof (store as { getAnalysisDeliveryHealthSummary?: unknown })
              .getAnalysisDeliveryHealthSummary === "function"
              ? await (
                  store as {
                    getAnalysisDeliveryHealthSummary: () => Promise<HetangAnalysisDeliveryHealthSummary>;
                  }
                ).getAnalysisDeliveryHealthSummary()
              : null;
          const dbConnection = this.getRuntimeContext().getDatabaseConnection();
          const schedulerLines = [
            ...schedulerStatus.pollers.map((poller) =>
              formatDoctorPollerState(poller.poller, poller as Partial<ServicePollerState>),
            ),
            ...schedulerStatus.jobs.map((job) => formatSchedulerJobDoctorLine(job)),
          ];
          const queueLines = [
            ...(analysisDeliverySummary
              ? [formatAnalysisDeliveryHealthSummary(analysisDeliverySummary)]
              : []),
            formatQueueLaneLine("Sync queue", queueStatus.sync),
            formatQueueLaneLine("Delivery queue", queueStatus.delivery),
            formatAnalysisQueueLine(queueStatus.analysis),
          ];
          const storeWatermarks = [];
          for (const entry of this.params.config.stores) {
            const watermarks = await store.getEndpointWatermarksForOrg(entry.orgId);
            storeWatermarks.push({
              orgId: entry.orgId,
              storeName: entry.storeName,
              summary: formatWatermarks(watermarks),
            });
          }
          return await renderHetangDoctorReport({
            dbUrl: redactDatabaseUrl(dbConnection.url),
            poolRole: this.params.poolRole ?? "query",
            poolMax: dbConnection.poolMax,
            timeZone: this.params.config.timeZone,
            storeCount: this.params.config.stores.length,
            apiCredentialsConfigured: hasHetangApiCredentials(this.params.config),
            middayBriefTime: this.params.config.reporting.middayBriefAtLocalTime,
            schedulerLines,
            queueLines,
            storeWatermarks,
          });
        },
      });
    }
    return this.runtimeContext;
  }

  private getRuntimeShell() {
    return this.getRuntimeContext().getRuntimeShell();
  }

  private getAdminReadService(): HetangAdminReadService {
    if (!this.adminReadService) {
      this.adminReadService = new HetangAdminReadService({
        config: this.params.config,
        logger: this.params.logger,
        getStore: () => this.getStore(),
      });
    }
    return this.adminReadService;
  }

  private getReportingService(): HetangReportingService {
    if (!this.reportingService) {
      this.reportingService = new HetangReportingService({
        config: this.params.config,
        logger: this.params.logger,
        getStore: () => this.getStore(),
        runCommandWithTimeout: this.params.runCommandWithTimeout,
        listCustomerSegments: async (params) => {
          const store = await this.getStore();
          return store.listCustomerSegments(params.orgId, params.bizDate);
        },
        listMemberReactivationFeatures: async (params) =>
          await this.listMemberReactivationFeatures(params),
        listMemberReactivationStrategies: async (params) =>
          await this.listMemberReactivationStrategies(params),
      });
    }
    return this.reportingService;
  }

  private getSyncOrchestrator(): HetangSyncOrchestrator {
    if (!this.syncOrchestrator) {
      this.syncOrchestrator = new HetangSyncOrchestrator({
        config: this.params.config,
        logger: this.params.logger,
        getStore: () => this.getStore(),
        syncStores: (params) => this.syncStores(params),
        runNightlyHistoryBackfill: (now, options) => this.runNightlyHistoryBackfill(now, options),
        runNightlyApiHistoryDepthProbe: (now) => this.runNightlyApiHistoryDepthProbe(now),
        publishNightlyServingViews: (now) => this.publishNightlyServingViews(now),
        runCustomerHistoryCatchup: (params) => this.runCustomerHistoryCatchup(params),
        buildAllReports: (params) => this.getReportingService().buildAllReports(params),
        buildExternalBriefIssue: (params) => this.buildExternalBriefIssue(params),
        sendAllMiddayBriefs: (params) => this.sendAllMiddayBriefs(params),
        sendAllReactivationPushes: (params) => this.sendAllReactivationPushes(params),
        sendNotificationMessage: async (params) =>
          await sendReportMessage({
            notification: params.notification,
            message: params.message,
            runCommandWithTimeout: this.params.runCommandWithTimeout,
          }),
        sendReport: (params) => this.getReportingService().sendReport(params),
      });
    }
    return this.syncOrchestrator;
  }

  private getDeliveryService(): HetangDeliveryService {
    if (!this.deliveryService) {
      this.deliveryService = new HetangDeliveryService({
        config: this.params.config,
        logger: this.params.logger,
        getStore: () => this.getStore(),
        sendMiddayBrief: (params) => this.getReportingService().sendMiddayBrief(params),
        sendReactivationPush: (params) => this.getReportingService().sendReactivationPush(params),
      });
    }
    return this.deliveryService;
  }

  private getAnalysisExecutionService(): HetangAnalysisExecutionService {
    if (!this.analysisExecutionService) {
      this.analysisExecutionService = new HetangAnalysisExecutionService({
        config: this.params.config,
        getStore: () => this.getStore(),
        queryRuntime: this as never,
      });
    }
    return this.analysisExecutionService;
  }

  private getAnalysisService(): HetangAnalysisService {
    if (!this.analysisService) {
      this.analysisService = new HetangAnalysisService({
        config: this.params.config,
        logger: this.params.logger,
        getStore: () => this.getStore(),
        runCommandWithTimeout: this.params.runCommandWithTimeout,
        resolveStateDir: this.params.resolveStateDir,
        decorateAnalysisJob: (job) => this.getAnalysisExecutionService().decorateAnalysisJob(job),
        runScopedQueryAnalysis: (job) =>
          this.getAnalysisExecutionService().runScopedQueryAnalysis(job),
        buildAnalysisEvidencePack: (job) =>
          this.getAnalysisExecutionService().buildAnalysisEvidencePack(job),
        buildAnalysisDiagnosticBundle: (pack) => buildHetangDiagnosticBundle(pack),
      });
    }
    return this.analysisService;
  }

  private getQueryReadService(): HetangQueryReadService {
    if (!this.queryReadService) {
      this.queryReadService = new HetangQueryReadService({
        getStore: () => this.getStore(),
        getCurrentServingVersion: async () => await this.getRuntimeShell().getCurrentServingVersion(),
        executeCompiledServingQuery: async (params) =>
          await this.getRuntimeShell().executeCompiledServingQuery(params),
      });
    }
    return this.queryReadService;
  }

  private getSyncService(): HetangSyncService {
    if (!this.syncService) {
      this.syncService = new HetangSyncService({
        config: this.params.config,
        logger: this.params.logger,
        getStore: () => this.getStore(),
        resolveNow: () => this.resolveNow(),
        sleep: this.params.sleep,
        syncStore: this.params.syncStore,
        createApiClient: this.params.createApiClient,
        markAnalyticsViewsVerified: () => this.getRuntimeContext().markAnalyticsViewsVerified(),
      });
    }
    return this.syncService;
  }

  private getExternalIntelligenceService(): HetangExternalIntelligenceService {
    if (!this.externalIntelligenceService) {
      this.externalIntelligenceService = new HetangExternalIntelligenceService({
        config: this.params.config,
        getStore: () => this.getStore(),
        runCommandWithTimeout: this.params.runCommandWithTimeout,
        loadExternalSourceDocuments: this.params.loadExternalSourceDocuments,
        externalBriefLlm: this.params.externalBriefLlm,
        logger: this.params.logger,
      });
    }
    return this.externalIntelligenceService;
  }

  private resolveNow(): Date {
    return this.params.resolveNow?.() ?? new Date();
  }

  get config(): HetangOpsConfig {
    return this.params.config;
  }

  private async getStore(): Promise<HetangOpsStore> {
    if (this.store) {
      return this.store;
    }
    this.store = await this.getRuntimeContext().getStore();
    return this.store;
  }

  async close(): Promise<void> {
    await this.runtimeContext?.close();
    if (!this.runtimeContext && this.store && typeof this.store.close === "function") {
      await this.store.close();
    }
    this.runtimeContext = null;
    this.store = null;
    this.syncOrchestrator = null;
    this.deliveryService?.reset();
    this.deliveryService = null;
    this.analysisExecutionService = null;
    this.analysisService = null;
    this.adminReadService = null;
    this.queryReadService = null;
    this.reportingService = null;
    this.syncService = null;
    this.externalIntelligenceService = null;
  }

  async recordServicePollerOutcome(params: {
    poller: ServicePollerName;
    status: "ok" | "failed";
    startedAt: string;
    finishedAt?: string;
    lines?: string[];
    error?: unknown;
  }): Promise<void> {
    await this.getAdminReadService().recordServicePollerOutcome(params);
  }

  async getSchedulerStatus(now = new Date()): Promise<HetangSchedulerStatusSummary> {
    return await this.getAdminReadService().getSchedulerStatus(now);
  }

  async getQueueStatus(now = new Date()): Promise<HetangQueueStatusSummary> {
    return await this.getAdminReadService().getQueueStatus(now, await this.getSchedulerStatus(now));
  }

  async listAnalysisDeadLetters(
    params: {
      orgId?: string;
      deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
      unresolvedOnly?: boolean;
      limit?: number;
    } = {},
  ): Promise<HetangAnalysisDeadLetter[]> {
    return await this.getAdminReadService().listAnalysisDeadLetters(params);
  }

  async replayAnalysisDeadLetter(params: {
    deadLetterKey: string;
    replayedAt: string;
  }): Promise<HetangAnalysisDeadLetter | null> {
    return await this.getAdminReadService().replayAnalysisDeadLetter(params);
  }

  async syncStores(
    params: { orgIds?: string[]; now?: Date; publishAnalytics?: boolean } = {},
  ): Promise<string[]> {
    return await this.getSyncService().syncStores(params);
  }

  private async runNightlyApiHistoryDepthProbe(now: Date): Promise<string[]> {
    return await this.getSyncService().runNightlyApiHistoryDepthProbe(now);
  }

  private async runNightlyHistoryBackfill(
    now: Date,
    options?: { publishAnalytics?: boolean },
  ): Promise<string[]> {
    return await this.getSyncService().runNightlyHistoryBackfill(now, options);
  }

  private async publishNightlyServingViews(now: Date): Promise<void> {
    await this.getSyncService().publishNightlyServingViews(now);
  }

  async backfillStores(params: {
    orgIds?: string[];
    startBizDate: string;
    endBizDate: string;
    now?: Date;
  }): Promise<string[]> {
    return await this.getSyncService().backfillStores(params);
  }

  async repairMissingCoverage(
    params: {
      orgIds?: string[];
      startBizDate?: string;
      endBizDate?: string;
      maxPlans?: number;
      now?: Date;
      publishAnalytics?: boolean;
    } = {},
  ): Promise<string[]> {
    return await this.getSyncService().repairMissingCoverage(params);
  }

  async backfillFebruary2026(params: { orgIds?: string[]; now?: Date } = {}): Promise<string[]> {
    return await this.getSyncService().backfillFebruary2026(params);
  }

  async buildReport(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
  }): Promise<DailyStoreReport> {
    return await this.getReportingService().buildReport(params);
  }

  async buildAllReports(
    params: { bizDate?: string; now?: Date } = {},
  ): Promise<DailyStoreReport[]> {
    return await this.getReportingService().buildAllReports(params);
  }

  async ingestExternalSourceDocuments(
    documents: ExternalSourceDocumentInput[],
    now = new Date(),
  ): Promise<number> {
    return await this.getExternalIntelligenceService().ingestExternalSourceDocuments(documents, now);
  }

  async getExternalBriefIssue(issueId: string) {
    return await this.getExternalIntelligenceService().getExternalBriefIssue(issueId);
  }

  async getLatestExternalBriefIssue() {
    return await this.getExternalIntelligenceService().getLatestExternalBriefIssue();
  }

  async renderLatestExternalBriefIssue(): Promise<string> {
    return await this.getExternalIntelligenceService().renderLatestExternalBriefIssue();
  }

  async renderExternalBriefIssueById(issueId: string): Promise<string> {
    return await this.getExternalIntelligenceService().renderExternalBriefIssueById(issueId);
  }

  async deliverExternalBriefIssue(params: { message: string }): Promise<void> {
    await this.getExternalIntelligenceService().deliverExternalBriefIssue(params);
  }

  async buildExternalBriefIssue(
    params: {
      now?: Date;
      deliver?: boolean;
    } = {},
  ): Promise<BuiltExternalBriefIssue | null> {
    return await this.getExternalIntelligenceService().buildExternalBriefIssue(params);
  }

  async enqueueAnalysisJob(params: {
    jobType: HetangAnalysisJob["jobType"];
    capabilityId?: string;
    orgId: string;
    rawText: string;
    timeFrameLabel: string;
    startBizDate: string;
    endBizDate: string;
    notification: {
      channel: string;
      target: string;
      accountId?: string;
      threadId?: string;
    };
    senderId?: string;
    createdAt?: string;
    subscribeToCompletion?: boolean;
  }): Promise<HetangAnalysisJob> {
    return await this.getAnalysisService().enqueueAnalysisJob(params);
  }

  async createAction(
    params: Omit<HetangActionItem, "actionId" | "createdAt" | "updatedAt"> & {
      actionId?: string;
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<HetangActionItem> {
    return await this.getAdminReadService().createAction(params);
  }

  async listActions(
    params: {
      orgId?: string;
      status?: HetangActionItem["status"];
    } = {},
  ): Promise<HetangActionItem[]> {
    return await this.getAdminReadService().listActions(params);
  }

  async getAnalysisJob(jobId: string): Promise<HetangAnalysisJob | null> {
    return await this.getAnalysisService().getAnalysisJob(jobId);
  }

  async listAnalysisJobs(
    params: {
      orgId?: string;
      status?: HetangAnalysisJob["status"];
    } = {},
  ): Promise<HetangAnalysisJob[]> {
    return await this.getAnalysisService().listAnalysisJobs(params);
  }

  async retryAnalysisJob(params: {
    jobId: string;
    retriedAt?: string;
  }): Promise<HetangAnalysisJob | null> {
    return await this.getAnalysisService().retryAnalysisJob(params);
  }

  async getActionItem(actionId: string): Promise<HetangActionItem | null> {
    return await this.getAdminReadService().getActionItem(actionId);
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
    return await this.getAdminReadService().updateActionStatus(params);
  }

  async getLearningSummary(params: { orgId?: string }): Promise<HetangLearningSummary> {
    return await this.getAdminReadService().getLearningSummary(params);
  }

  async resolveControlTowerSettings(
    params: {
      orgId?: string;
    } = {},
  ): Promise<Record<string, string | number | boolean>> {
    return await this.getAdminReadService().resolveControlTowerSettings(params);
  }

  async upsertControlTowerSetting(
    record: HetangControlTowerSettingRecord,
  ): Promise<HetangControlTowerSettingRecord> {
    return await this.getAdminReadService().upsertControlTowerSetting(record);
  }

  async listTechLeaderboard(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<TechLeaderboardRow[]> {
    return await this.getQueryReadService().listTechLeaderboard(params);
  }

  async listCustomerTechLinks(params: { orgId: string; bizDate: string }) {
    return await this.getQueryReadService().listCustomerTechLinks(params);
  }

  async listCustomerTechLinksByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return await this.getQueryReadService().listCustomerTechLinksByDateRange(params);
  }

  async listCustomerSegments(params: { orgId: string; bizDate: string }) {
    return await this.getQueryReadService().listCustomerSegments(params);
  }

  async listMemberReactivationFeatures(params: { orgId: string; bizDate: string }) {
    return await this.getQueryReadService().listMemberReactivationFeatures(params);
  }

  async listMemberReactivationStrategies(params: { orgId: string; bizDate: string }) {
    return await this.getQueryReadService().listMemberReactivationStrategies(params);
  }

  async listMemberReactivationQueue(params: { orgId: string; bizDate: string }) {
    return await this.getQueryReadService().listMemberReactivationQueue(params);
  }

  async listMemberReactivationFeedback(params: { orgId: string; bizDate: string }) {
    return await this.getQueryReadService().listMemberReactivationFeedback(params);
  }

  async listCustomerProfile90dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return await this.getQueryReadService().listCustomerProfile90dByDateRange(params);
  }

  async getDailyReportSnapshot(params: {
    orgId: string;
    bizDate: string;
  }): Promise<DailyStoreReport | null> {
    return await this.getQueryReadService().getDailyReportSnapshot(params);
  }

  async getCurrentServingVersion(): Promise<string> {
    return await this.getQueryReadService().getCurrentServingVersion();
  }

  async executeCompiledServingQuery(params: {
    sql: string;
    queryParams?: unknown[];
    cacheKey?: string;
    ttlSeconds?: number;
  }): Promise<Record<string, unknown>[]> {
    return await this.getQueryReadService().executeCompiledServingQuery(params);
  }

  async listStoreManagerDailyKpiByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<StoreManagerDailyKpiRow[]> {
    return await this.getQueryReadService().listStoreManagerDailyKpiByDateRange(params);
  }

  async listTechProfile30dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<TechProfile30dRow[]> {
    return await this.getQueryReadService().listTechProfile30dByDateRange(params);
  }

  async listStoreReview7dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<StoreReview7dRow[]> {
    return await this.getQueryReadService().listStoreReview7dByDateRange(params);
  }

  async listStoreSummary30dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<StoreSummary30dRow[]> {
    return await this.getQueryReadService().listStoreSummary30dByDateRange(params);
  }

  async findCurrentMembersByPhoneSuffix(params: { orgId: string; phoneSuffix: string }) {
    return await this.getQueryReadService().findCurrentMembersByPhoneSuffix(params);
  }

  async listCurrentMembers(params: { orgId: string }) {
    return await this.getQueryReadService().listCurrentMembers(params);
  }

  async listCurrentMemberCards(params: { orgId: string }) {
    return await this.getQueryReadService().listCurrentMemberCards(params);
  }

  async listConsumeBillsByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return await this.getQueryReadService().listConsumeBillsByDateRange(params);
  }

  async listRechargeBillsByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<RechargeBillRecord[]> {
    return await this.getQueryReadService().listRechargeBillsByDateRange(params);
  }

  async listTechUpClockByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return await this.getQueryReadService().listTechUpClockByDateRange(params);
  }

  async listTechMarketByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return await this.getQueryReadService().listTechMarketByDateRange(params);
  }

  async sendReport(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    dryRun?: boolean;
  }): Promise<string> {
    return await this.getReportingService().sendReport(params);
  }

  async sendMiddayBrief(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    dryRun?: boolean;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    return await this.getReportingService().sendMiddayBrief(params);
  }

  async renderMiddayBrief(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
  }): Promise<string> {
    return await this.getReportingService().renderMiddayBrief(params);
  }

  async sendAllMiddayBriefs(
    params: {
      bizDate?: string;
      now?: Date;
      notificationOverride?: HetangNotificationTarget;
    } = {},
  ): Promise<{ lines: string[]; allSent: boolean }> {
    return await this.getDeliveryService().sendAllMiddayBriefs(params);
  }

  async sendReactivationPush(params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
    dryRun?: boolean;
    notificationOverride?: HetangNotificationTarget;
  }): Promise<string> {
    return await this.getReportingService().sendReactivationPush(params);
  }

  async sendAllReactivationPushes(
    params: {
      bizDate?: string;
      now?: Date;
      notificationOverride?: HetangNotificationTarget;
    } = {},
  ): Promise<{ lines: string[]; allSent: boolean }> {
    return await this.getDeliveryService().sendAllReactivationPushes(params);
  }

  async runCustomerHistoryCatchup(
    params: {
      bizDate?: string;
      now?: Date;
      orgIds?: string[];
    } = {},
  ): Promise<{ lines: string[]; allComplete: boolean }> {
    return await this.getSyncService().runCustomerHistoryCatchup(params);
  }

  async repairAnalyticsViews(): Promise<string> {
    return await this.getSyncService().repairAnalyticsViews();
  }

  async runPendingAnalysisJobs(now = new Date()): Promise<string[]> {
    return await this.getAnalysisService().runPendingAnalysisJobs(now);
  }

  async getEmployeeBinding(params: {
    channel: string;
    senderId: string;
  }): Promise<HetangEmployeeBinding | null> {
    return await this.getAdminReadService().getEmployeeBinding(params);
  }

  async resolveSemanticFallbackIntent(params: {
    config: HetangOpsConfig;
    text: string;
    now: Date;
    binding: HetangEmployeeBinding;
    ruleIntent?: { kind: string } | null;
  }): Promise<{
    intent?: import("./query-intent.js").HetangQueryIntent;
    clarificationText?: string;
  } | null> {
    void params.binding;
    void params.ruleIntent;
    try {
      return await resolveAiSemanticFallback({
        config: params.config,
        text: params.text,
        now: params.now,
        logger: this.params.logger,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.params.logger.warn(`hetang-ops: semantic fallback failed: ${message}`);
      return null;
    }
  }

  async listEmployeeBindings(channel?: string): Promise<HetangEmployeeBinding[]> {
    return await this.getAdminReadService().listEmployeeBindings(channel);
  }

  async grantEmployeeBinding(binding: HetangEmployeeBinding): Promise<void> {
    await this.getAdminReadService().grantEmployeeBinding(binding);
  }

  async revokeEmployeeBinding(params: {
    channel: string;
    senderId: string;
    updatedAt?: string;
  }): Promise<void> {
    await this.getAdminReadService().revokeEmployeeBinding(params);
  }

  async getCommandUsage(params: {
    channel: string;
    senderId: string;
    now?: Date;
  }): Promise<HetangCommandUsage> {
    return await this.getAdminReadService().getCommandUsage(params);
  }

  async recordCommandAudit(record: HetangCommandAuditRecord): Promise<void> {
    await this.getAdminReadService().recordCommandAudit(record);
  }

  async recordInboundMessageAudit(record: HetangInboundMessageAuditRecord): Promise<void> {
    await this.getAdminReadService().recordInboundMessageAudit(record);
  }

  async listInboundMessageAudits(params?: {
    channel?: string;
    senderId?: string;
    conversationId?: string;
    contains?: string;
    limit?: number;
  }): Promise<HetangInboundMessageAuditRecord[]> {
    return await this.getAdminReadService().listInboundMessageAudits(params);
  }

  async runDueJobs(now = new Date()): Promise<string[]> {
    return await this.getSyncOrchestrator().runDueJobs(now);
  }

  async doctor(): Promise<string> {
    return await this.getRuntimeShell().doctor();
  }
}

export function createHetangOpsRuntime(params: RuntimeParams): HetangOpsRuntime {
  return new HetangOpsRuntime(params);
}
