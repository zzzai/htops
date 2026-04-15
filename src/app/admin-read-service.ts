import { randomUUID } from "node:crypto";
import { extractHetangAnalysisOrchestrationMetadata } from "../analysis-result.js";
import { HetangOpsStore } from "../store.js";
import { listAuthoritativeSchedulerJobs } from "../schedule.js";
import { resolveLocalDayStartIso } from "../time.js";
import type {
  HetangActionItem,
  HetangAnalysisDeadLetter,
  HetangCommandAuditRecord,
  HetangCommandUsage,
  HetangControlTowerSettingRecord,
  HetangEmployeeBinding,
  HetangInboundMessageAuditRecord,
  HetangLearningSummary,
  HetangLogger,
  HetangOpsConfig,
  HetangQueueStatusSummary,
  HetangSchedulerStatusSummary,
  HetangServicePollerHealth,
  ScheduledJobType,
} from "../types.js";

export type ServicePollerName = "scheduled" | "analysis";

export type ServicePollerState = HetangServicePollerHealth & {
  poller: ServicePollerName;
  status: "ok" | "failed";
  lastRunAt: string;
};

function summarizeReplyError(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
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
    },
  ) {}

  private resolveQueueAccessControlStore(store: HetangOpsStore) {
    return typeof (store as { getQueueAccessControlStore?: unknown }).getQueueAccessControlStore ===
      "function"
      ? (
          store as {
            getQueueAccessControlStore: () => {
              getScheduledJobState: HetangOpsStore["getScheduledJobState"];
              setScheduledJobState: HetangOpsStore["setScheduledJobState"];
              listCompletedRunKeys: HetangOpsStore["listCompletedRunKeys"];
              getLatestScheduledJobRunTimes: HetangOpsStore["getLatestScheduledJobRunTimes"];
              getAnalysisQueueSummary: HetangOpsStore["getAnalysisQueueSummary"];
              listAnalysisDeadLetters: HetangOpsStore["listAnalysisDeadLetters"];
              replayAnalysisDeadLetter: HetangOpsStore["replayAnalysisDeadLetter"];
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
            };
          }
        ).getQueueAccessControlStore()
      : store;
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
        rawState.poller === "scheduled" || rawState.poller === "analysis"
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
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    const [completedRunKeys, lastRunAtByJobType] = await Promise.all([
      typeof (store as { listCompletedRunKeys?: unknown }).listCompletedRunKeys === "function"
        ? (
            store as {
              listCompletedRunKeys: () => Promise<Set<string>>;
            }
          ).listCompletedRunKeys()
        : Promise.resolve(new Set<string>()),
      typeof (store as { getLatestScheduledJobRunTimes?: unknown })
        .getLatestScheduledJobRunTimes === "function"
        ? (
            store as {
              getLatestScheduledJobRunTimes: () => Promise<Partial<Record<string, string>>>;
            }
          ).getLatestScheduledJobRunTimes()
        : Promise.resolve({}),
    ]);
    const scheduledPoller = this.normalizeServicePollerState(
      await store.getScheduledJobState("service-poller", "scheduled"),
    );
    const analysisPoller = this.normalizeServicePollerState(
      await store.getScheduledJobState("service-poller", "analysis"),
    );
    const pollers: HetangServicePollerHealth[] = [
      (scheduledPoller?.poller ? scheduledPoller : { poller: "scheduled" }) as HetangServicePollerHealth,
      (analysisPoller?.poller ? analysisPoller : { poller: "analysis" }) as HetangServicePollerHealth,
    ];

    return {
      authority: "app-service-pollers",
      pollers,
      jobs: listAuthoritativeSchedulerJobs({
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
        reportingEnabled: this.deps.config.reporting.enabled,
      }),
    };
  }

  private async resolveAnalysisQueueSummary(
    store: {
      getAnalysisQueueSummary?: () => Promise<HetangQueueStatusSummary["analysis"]>;
    },
  ): Promise<HetangQueueStatusSummary["analysis"]> {
    return typeof (store as { getAnalysisQueueSummary?: unknown }).getAnalysisQueueSummary ===
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
    const store = this.resolveQueueAccessControlStore(await this.deps.getStore());
    const analysis = await this.resolveAnalysisQueueSummary(store);
    return {
      sync: summarizeLane("sync"),
      delivery: summarizeLane("delivery"),
      analysis,
    };
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
        new Map<string, number>(),
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
}
