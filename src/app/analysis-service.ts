import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveAiLaneConfig } from "../ai-lanes/resolver.js";
import { buildHetangAnalysisOrchestrationPlan } from "./analysis-orchestration-plan.js";
import { buildDeterministicBoundedAnalysisResult } from "./analysis-bounded-synthesis.js";
import {
  HetangAnalysisOrchestrator,
  type AnalysisDeliveryNotification,
} from "../analysis-orchestrator.js";
import {
  extractHetangAnalysisActionItems,
  extractHetangAnalysisSuggestions,
  parseHetangAnalysisResult,
  renderHetangAnalysisResult,
  summarizeHetangAnalysisResult,
} from "../analysis-result.js";
import { decodeHetangAnalysisScopeOrgId } from "../analysis-router.js";
import { sendReportMessage, type CommandRunner } from "../notify.js";
import { HetangOpsStore } from "../store.js";
import type {
  HetangActionPriority,
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
  HetangLogger,
  HetangAnalysisOrchestrationMetadata,
  HetangAnalysisOrchestrationStageTrace,
  HetangOpsConfig,
} from "../types.js";

const CREWAI_SIDECAR_TIMEOUT_MS = 180_000;

function resolveAnalysisPremiumLaneRuntime(config: HetangOpsConfig): {
  timeoutMs: number;
  env: Record<string, string>;
} {
  if (!config.aiLanes["analysis-premium"]) {
    return {
      timeoutMs: CREWAI_SIDECAR_TIMEOUT_MS,
      env: {},
    };
  }

  const laneConfig = resolveAiLaneConfig(config, "analysis-premium");
  const env: Record<string, string> = {
    CREWAI_MODEL: laneConfig.model,
    OPENAI_MODEL: laneConfig.model,
    CREWAI_TIMEOUT_SECONDS: String(Math.max(1, Math.ceil(laneConfig.timeoutMs / 1000))),
  };

  if (laneConfig.reasoningMode === "off") {
    env.CREWAI_REASONING_EFFORT = "";
  } else {
    env.CREWAI_REASONING_EFFORT = laneConfig.reasoningMode;
  }

  if (laneConfig.baseUrl) {
    env.CREWAI_BASE_URL = laneConfig.baseUrl;
    env.OPENAI_BASE_URL = laneConfig.baseUrl;
  }
  if (laneConfig.apiKey) {
    env.CREWAI_API_KEY = laneConfig.apiKey;
    env.OPENAI_API_KEY = laneConfig.apiKey;
  }

  return {
    timeoutMs: laneConfig.timeoutMs,
    env,
  };
}

function summarizeReplyError(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 120 ? trimmed : `${trimmed.slice(0, 117)}...`;
}

function numberSetting(
  settings: Record<string, string | number | boolean>,
  key: string,
): number | undefined {
  const value = settings[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanSetting(
  settings: Record<string, string | number | boolean>,
  key: string,
): boolean | undefined {
  const value = settings[key];
  return typeof value === "boolean" ? value : undefined;
}

function resolveAnalysisMaxActionItems(
  settings: Record<string, string | number | boolean>,
): number {
  const configured = numberSetting(settings, "analysis.maxActionItems");
  if (!configured || !Number.isFinite(configured)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.floor(configured)));
}

function resolveAnalysisActionId(jobId: string, index: number): string {
  return `ACT-${jobId}-${index + 1}`;
}

function resolveAnalysisActionSourceRef(jobId: string, index: number): string {
  return `analysis:${jobId}:${index + 1}`;
}

function resolveAnalysisActionCategory(title: string): string {
  if (/(会员|回访|复购|召回|沉默)/u.test(title)) {
    return "会员运营";
  }
  if (/(团购|投放|拉新|转化|抖音|美团)/u.test(title)) {
    return "营销投放";
  }
  if (/(技师|排班|点钟|加钟|钟效|人效|晚场|班次)/u.test(title)) {
    return "技师运营";
  }
  if (/(储值|充值|耗卡|提成|成本|利润)/u.test(title)) {
    return "财务经营";
  }
  return "经营复盘";
}

function resolveStructuredActionPriority(value: unknown): HetangActionPriority | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function resolveCrewAISidecarDir(): string {
  const configured =
    process.env.HETANG_CREWAI_SIDECAR_DIR?.trim() ||
    process.env.OPENCLAW_CREWAI_SIDECAR_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  const localDir = path.resolve(process.cwd(), "tools/crewai-sidecar");
  if (existsSync(localDir)) {
    return localDir;
  }

  const siblingOpenClawDir = path.resolve(process.cwd(), "../openclaw/tools/crewai-sidecar");
  if (existsSync(siblingOpenClawDir)) {
    return siblingOpenClawDir;
  }

  return localDir;
}

function resolveCrewAISidecarPython(sidecarDir: string): string {
  const unixPython = path.join(sidecarDir, ".venv", "bin", "python");
  if (existsSync(unixPython)) {
    return unixPython;
  }
  const windowsPython = path.join(sidecarDir, ".venv", "Scripts", "python.exe");
  if (existsSync(windowsPython)) {
    return windowsPython;
  }
  return "python3";
}

function formatCrewAISidecarFailure(result: {
  code: number | null;
  stdout: string;
  stderr: string;
  signal?: NodeJS.Signals | null;
  termination?: "exit" | "timeout" | "no-output-timeout" | "signal";
  noOutputTimedOut?: boolean;
}): string {
  const stderr = result.stderr.trim();
  if (stderr) {
    return stderr;
  }
  const stdout = result.stdout.trim();
  if (stdout) {
    return stdout;
  }
  if (result.termination === "timeout") {
    return `CrewAI sidecar timed out after ${Math.round(CREWAI_SIDECAR_TIMEOUT_MS / 1000)}s`;
  }
  if (result.termination === "no-output-timeout" || result.noOutputTimedOut) {
    return "CrewAI sidecar was killed after producing no output";
  }
  if (result.termination === "signal") {
    return `CrewAI sidecar was terminated by signal ${result.signal ?? "unknown"}`;
  }
  return `CrewAI sidecar failed with code ${result.code}`;
}

function attachAnalysisOrchestrationMetadata(
  resultText: string,
  metadata: HetangAnalysisOrchestrationMetadata,
): string {
  const trimmed = resultText.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return trimmed;
    }
    const nextMetadata = appendActionItemsStageTrace(trimmed, metadata);
    return JSON.stringify({
      ...parsed,
      orchestration: nextMetadata,
    });
  } catch {
    return trimmed;
  }
}

function appendCompletedStage(
  completedStages: readonly string[],
  stage: string,
): string[] {
  return completedStages.includes(stage) ? [...completedStages] : [...completedStages, stage];
}

function appendStageTrace(
  metadata: HetangAnalysisOrchestrationMetadata,
  trace: HetangAnalysisOrchestrationStageTrace,
): HetangAnalysisOrchestrationMetadata {
  const stageTrace = [
    ...(metadata.stageTrace ?? []).filter((entry) => entry.stage !== trace.stage),
    trace,
  ];
  return {
    ...metadata,
    completedStages:
      trace.status === "completed"
        ? (appendCompletedStage(metadata.completedStages, trace.stage) as typeof metadata.completedStages)
        : [...metadata.completedStages],
    stageTrace,
  };
}

function buildEvidencePackStageTrace(
  evidencePack: HetangAnalysisEvidencePack,
): HetangAnalysisOrchestrationStageTrace {
  return {
    stage: "evidence_pack",
    status: "completed",
    detail: `scope=${evidencePack.scopeType}; orgs=${evidencePack.orgIds.length}; range=${evidencePack.startBizDate}..${evidencePack.endBizDate}`,
  };
}

function buildDiagnosticSignalsStageTrace(
  diagnosticBundle: HetangAnalysisDiagnosticBundle,
): HetangAnalysisOrchestrationStageTrace {
  const prioritizedSignals = diagnosticBundle.signals
    .slice(0, 3)
    .map((signal) => signal.signalId)
    .join(",");
  return {
    stage: "diagnostic_signals",
    status: "completed",
    detail: `signals=${diagnosticBundle.signals.length}${prioritizedSignals ? `; ids=${prioritizedSignals}` : ""}`,
  };
}

function buildDiagnosticSignalsFallbackStageTrace(reason: string): HetangAnalysisOrchestrationStageTrace {
  return {
    stage: "diagnostic_signals",
    status: "fallback",
    detail: `signals=0; reason=${reason}`,
  };
}

function buildOrchestrationPlanStageTrace(params: {
  focusAreas: string[];
  priorityActions: string[];
  decisionSteps: string[];
}): HetangAnalysisOrchestrationStageTrace {
  return {
    stage: "orchestration_plan",
    status: "completed",
    detail:
      `focus=${params.focusAreas.slice(0, 2).join(",") || "none"}; ` +
      `actions=${params.priorityActions.length}; ` +
      `steps=${params.decisionSteps.length}`,
  };
}

function buildBoundedSynthesisStageTrace(params: {
  status: HetangAnalysisOrchestrationStageTrace["status"];
  reason: string;
}): HetangAnalysisOrchestrationStageTrace {
  return {
    stage: "bounded_synthesis",
    status: params.status,
    detail:
      params.status === "completed"
        ? `mode=crewai_sidecar; reason=${params.reason}`
        : `mode=scoped_query_fallback; reason=${params.reason}`,
  };
}

function appendActionItemsStageTrace(
  resultText: string,
  metadata: HetangAnalysisOrchestrationMetadata,
): HetangAnalysisOrchestrationMetadata {
  const parsed = parseHetangAnalysisResult(resultText);
  const structuredCount = parsed.actionItems?.length ?? 0;
  const suggestionCount = parsed.suggestions.length;
  if (structuredCount > 0) {
    return appendStageTrace(metadata, {
      stage: "action_items",
      status: "completed",
      detail: `structured=${structuredCount}`,
    });
  }

  const nextMetadata = appendStageTrace(metadata, {
    stage: "action_items",
    status: "fallback",
    detail:
      suggestionCount > 0
        ? `derived_from_suggestions=${suggestionCount}`
        : "derived_from_suggestions=0",
  });
  return nextMetadata.fallbackStage
    ? nextMetadata
    : {
        ...nextMetadata,
        fallbackStage: "action_items",
      };
}

function renderDiagnosticSignalMarkdown(bundle: HetangAnalysisDiagnosticBundle): string[] {
  if (bundle.signals.length === 0) {
    return [];
  }
  return [
    "诊断信号",
    ...bundle.signals.slice(0, 5).map((signal) => `- ${signal.title}: ${signal.finding}`),
  ];
}

function sanitizeAnalysisFailureReason(errorMessage?: string | null): string | null {
  const normalized = errorMessage?.trim();
  if (!normalized) {
    return null;
  }
  if (
    /authentication failed|upstream authentication failed|invalid api key|incorrect api key|unauthorized|upstream_error/iu.test(
      normalized,
    )
  ) {
    return "AI 分析服务鉴权异常，请稍后再试。";
  }
  if (/empty output/iu.test(normalized)) {
    return "AI 分析服务返回异常，请稍后再试。";
  }
  if (
    /timed out|timeout|gateway time-?out|502|503|504|no output|terminated by signal|econnreset|etimedout/iu.test(
      normalized,
    )
  ) {
    return "AI 分析服务暂时繁忙，请稍后再试。";
  }
  return "AI 分析服务暂时不可用，请稍后再试。";
}

export class HetangAnalysisQueueLimitError extends Error {
  readonly code = "HETANG_ANALYSIS_QUEUE_LIMIT";
  readonly orgId: string;
  readonly pendingCount: number;
  readonly limit: number;

  constructor(params: { orgId: string; pendingCount: number; limit: number }) {
    super(
      `analysis queue limit reached for ${params.orgId}: pending=${params.pendingCount}, limit=${params.limit}`,
    );
    this.name = "HetangAnalysisQueueLimitError";
    this.orgId = params.orgId;
    this.pendingCount = params.pendingCount;
    this.limit = params.limit;
  }
}

type AnalysisQueueStore = Pick<
  HetangOpsStore,
  | "countPendingAnalysisJobsByOrg"
  | "findReusableAnalysisJob"
  | "upsertAnalysisSubscriber"
  | "createAnalysisJob"
  | "getAnalysisJob"
  | "listAnalysisJobs"
  | "retryAnalysisJob"
  | "resolveControlTowerSettings"
  | "getActionItem"
  | "createActionItem"
  | "getNextDeliverableAnalysisSubscription"
  | "markAnalysisSubscriberDelivered"
  | "markAnalysisSubscriberDeliveryAttempt"
  | "refreshAnalysisJobDeliveryState"
  | "getNextDeliverableAnalysisJob"
  | "markAnalysisJobDeliveryAttempt"
  | "claimNextPendingAnalysisJob"
  | "completeAnalysisJob"
  | "failAnalysisJob"
  | "markAllAnalysisSubscribersDelivered"
  | "markAnalysisJobDelivered"
>;

export class HetangAnalysisService {
  private analysisOrchestrator: HetangAnalysisOrchestrator | null = null;

  constructor(
    private readonly deps: {
      config: HetangOpsConfig;
      logger: HetangLogger;
      getStore: () => Promise<HetangOpsStore>;
      runCommandWithTimeout: CommandRunner;
      resolveStateDir: () => string;
      decorateAnalysisJob: (job: HetangAnalysisJob) => Promise<HetangAnalysisJob>;
      runScopedQueryAnalysis: (job: HetangAnalysisJob) => Promise<string>;
      buildAnalysisEvidencePack: (job: HetangAnalysisJob) => Promise<HetangAnalysisEvidencePack>;
      buildAnalysisDiagnosticBundle: (
        pack: HetangAnalysisEvidencePack,
      ) => HetangAnalysisDiagnosticBundle;
    },
  ) {}

  private resolveQueueAccessControlStore(store: HetangOpsStore): AnalysisQueueStore {
    if (
      typeof (store as { getQueueAccessControlStore?: unknown }).getQueueAccessControlStore !==
      "function"
    ) {
      throw new Error("analysis-service requires store.getQueueAccessControlStore()");
    }
    return (
      store as {
        getQueueAccessControlStore: () => AnalysisQueueStore;
      }
    ).getQueueAccessControlStore();
  }

  private async getQueueStore(): Promise<AnalysisQueueStore> {
    return this.resolveQueueAccessControlStore(await this.deps.getStore());
  }

  private getAnalysisOrchestrator(): HetangAnalysisOrchestrator {
    if (!this.analysisOrchestrator) {
      this.analysisOrchestrator = new HetangAnalysisOrchestrator({
        logger: this.deps.logger,
        getStore: async () => (await this.getQueueStore()) as never,
        decorateAnalysisJob: (job) => this.deps.decorateAnalysisJob(job),
        sendAnalysisReply: (job, notification) => this.sendAnalysisReply(job, notification),
        autoCreateActionsFromAnalysis: (job) => this.autoCreateActionsFromAnalysis(job),
        runScopedQueryAnalysis: (job) => this.deps.runScopedQueryAnalysis(job),
        runCrewAISidecar: (job) => this.runCrewAISidecar(job),
        shouldNotifyAnalysisFailure: (orgId) => this.shouldNotifyAnalysisFailure(orgId),
        isScopedQueryAnalysis: (job) =>
          decodeHetangAnalysisScopeOrgId(job.orgId) !== null || job.orgId === "all",
      });
    }
    return this.analysisOrchestrator;
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
    const store = await this.getQueueStore();
    const pendingCount = await store.countPendingAnalysisJobsByOrg(params.orgId);
    const maxPendingPerOrg = this.deps.config.queue.maxPendingAnalysisJobsPerOrg;
    if (pendingCount >= maxPendingPerOrg) {
      throw new HetangAnalysisQueueLimitError({
        orgId: params.orgId,
        pendingCount,
        limit: maxPendingPerOrg,
      });
    }
    const createdAt = params.createdAt ?? new Date().toISOString();
    const reusable = await store.findReusableAnalysisJob({
      jobType: params.jobType,
      orgId: params.orgId,
      startBizDate: params.startBizDate,
      endBizDate: params.endBizDate,
    });
    if (reusable) {
      if (
        params.subscribeToCompletion &&
        (reusable.status === "pending" || reusable.status === "running")
      ) {
        await store.upsertAnalysisSubscriber({
          jobId: reusable.jobId,
          channel: params.notification.channel,
          target: params.notification.target,
          accountId: params.notification.accountId,
          threadId: params.notification.threadId,
          senderId: params.senderId,
          createdAt,
        });
      }
      return await this.deps.decorateAnalysisJob({
        ...reusable,
        queueDisposition:
          reusable.status === "running"
            ? "reused-running"
            : reusable.status === "completed"
              ? "reused-completed"
              : "reused-pending",
      });
    }

    const job: HetangAnalysisJob = {
      jobId: `ANL-${randomUUID().slice(0, 8)}`,
      jobType: params.jobType,
      capabilityId: params.capabilityId,
      orgId: params.orgId,
      rawText: params.rawText,
      timeFrameLabel: params.timeFrameLabel,
      startBizDate: params.startBizDate,
      endBizDate: params.endBizDate,
      channel: params.notification.channel,
      target: params.notification.target,
      accountId: params.notification.accountId,
      threadId: params.notification.threadId,
      senderId: params.senderId,
      status: "pending",
      attemptCount: 0,
      createdAt,
      updatedAt: createdAt,
      queueDisposition: "created",
    };
    await store.createAnalysisJob(job);
    if (params.subscribeToCompletion) {
      await store.upsertAnalysisSubscriber({
        jobId: job.jobId,
        channel: params.notification.channel,
        target: params.notification.target,
        accountId: params.notification.accountId,
        threadId: params.notification.threadId,
        senderId: params.senderId,
        createdAt,
      });
    }
    return await this.deps.decorateAnalysisJob(job);
  }

  async getAnalysisJob(jobId: string): Promise<HetangAnalysisJob | null> {
    const job = await (await this.getQueueStore()).getAnalysisJob(jobId);
    if (!job) {
      return null;
    }
    return await this.deps.decorateAnalysisJob(job);
  }

  async listAnalysisJobs(
    params: {
      orgId?: string;
      status?: HetangAnalysisJob["status"];
    } = {},
  ): Promise<HetangAnalysisJob[]> {
    const jobs = await (await this.getQueueStore()).listAnalysisJobs(params);
    return await Promise.all(jobs.map((job) => this.deps.decorateAnalysisJob(job)));
  }

  async retryAnalysisJob(params: {
    jobId: string;
    retriedAt?: string;
  }): Promise<HetangAnalysisJob | null> {
    const job = await (await this.getQueueStore()).retryAnalysisJob({
      jobId: params.jobId,
      retriedAt: params.retriedAt ?? new Date().toISOString(),
    });
    if (!job) {
      return null;
    }
    return await this.deps.decorateAnalysisJob({
      ...job,
      queueDisposition: "retried",
    });
  }

  buildAnalysisReply(job: HetangAnalysisJob): string {
    if (job.status === "failed") {
      const sanitizedReason = sanitizeAnalysisFailureReason(job.errorMessage);
      const reason = sanitizedReason ? `\n失败原因：${summarizeReplyError(sanitizedReason)}` : "";
      return `${job.storeName ?? job.orgId}${job.timeFrameLabel}经营复盘生成失败，请稍后重试。${reason}`;
    }
    const result = renderHetangAnalysisResult(job.resultText);
    if (!result || result.length === 0) {
      return `${job.storeName ?? job.orgId}${job.timeFrameLabel}经营复盘已完成，但未生成可发送内容。`;
    }
    const summary =
      summarizeHetangAnalysisResult(job.resultText)?.trim() || "已整理出关键结论与动作建议。";
    const normalizedResult = result.trim();
    const derivedBody =
      normalizedResult.includes("\n") ||
      (normalizedResult !== summary && normalizedResult !== `结论摘要：${summary}`)
        ? normalizedResult
        : `结论摘要：${summary}`;
    const lines = [
      `${job.storeName ?? job.orgId}${job.timeFrameLabel}经营复盘已完成，我先把最重要的结论回给你。`,
      `完成摘要：${summary}`,
    ];
    if (derivedBody.trim().length > 0) {
      lines.push("", "正式回复", derivedBody);
    }
    return lines.join("\n");
  }

  async sendAnalysisReply(
    job: HetangAnalysisJob,
    notification?: AnalysisDeliveryNotification,
  ): Promise<void> {
    await sendReportMessage({
      notification: {
        channel: notification?.channel ?? job.channel,
        target: notification?.target ?? job.target,
        accountId: notification?.accountId ?? job.accountId,
        threadId: notification?.threadId ?? job.threadId,
        enabled: true,
      },
      message: this.buildAnalysisReply(job),
      runCommandWithTimeout: this.deps.runCommandWithTimeout,
    });
  }

  async shouldNotifyAnalysisFailure(orgId: string): Promise<boolean> {
    const controlTowerSettings = await (await this.getQueueStore()).resolveControlTowerSettings(orgId);
    return booleanSetting(controlTowerSettings, "analysis.notifyOnFailure") !== false;
  }

  async autoCreateActionsFromAnalysis(job: HetangAnalysisJob): Promise<number> {
    const store = await this.getQueueStore();
    const controlTowerSettings = await store.resolveControlTowerSettings(job.orgId);
    if (booleanSetting(controlTowerSettings, "analysis.autoCreateActions") === false) {
      return 0;
    }
    const limit = resolveAnalysisMaxActionItems(controlTowerSettings);
    const actionItems = extractHetangAnalysisActionItems(job.resultText).slice(0, limit);
    const suggestions =
      actionItems.length > 0
        ? actionItems.map((item) => item.title)
        : extractHetangAnalysisSuggestions(job.resultText).slice(0, limit);
    if (suggestions.length === 0) {
      return 0;
    }

    let createdCount = 0;
    for (const [index, suggestion] of suggestions.entries()) {
      const structuredItem = actionItems[index];
      const actionId = resolveAnalysisActionId(job.jobId, index);
      const existing = await store.getActionItem(actionId);
      if (existing) {
        continue;
      }
      await store.createActionItem({
        actionId,
        orgId: job.orgId,
        bizDate: job.endBizDate,
        category: structuredItem?.category || resolveAnalysisActionCategory(suggestion),
        title: suggestion,
        priority: resolveStructuredActionPriority(structuredItem?.priority) ?? "medium",
        status: "proposed",
        sourceKind: "analysis",
        sourceRef: resolveAnalysisActionSourceRef(job.jobId, index),
        createdByChannel: job.channel,
        createdBySenderId: job.senderId,
        createdByName: "AI 经营复盘",
        createdAt: job.finishedAt ?? job.updatedAt,
        updatedAt: job.finishedAt ?? job.updatedAt,
      });
      createdCount += 1;
    }
    return createdCount;
  }

  async runCrewAISidecar(job: HetangAnalysisJob): Promise<string> {
    const sidecarDir = resolveCrewAISidecarDir();
    const scriptPath = path.join(sidecarDir, "store_review.py");
    const evidencePack = await this.deps.buildAnalysisEvidencePack(job);
    let orchestration: HetangAnalysisOrchestrationMetadata = {
      version: "v1",
      completedStages: [],
      signalCount: 0,
    };
    orchestration = appendStageTrace(orchestration, buildEvidencePackStageTrace(evidencePack));
    let diagnosticBundle: HetangAnalysisDiagnosticBundle;
    try {
      diagnosticBundle = this.deps.buildAnalysisDiagnosticBundle(evidencePack);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      this.deps.logger.warn(
        `hetang-ops: diagnostic signal build failed for ${job.jobId}, fallback to evidence-only scoped analysis: ${message}`,
      );
      return await this.runEvidenceOnlyScopedAnalysis(job, evidencePack, {
        ...appendStageTrace(
          orchestration,
          buildDiagnosticSignalsFallbackStageTrace("diagnostic_signals_error"),
        ),
        fallbackStage: "diagnostic_signals",
        signalCount: 0,
      });
    }
    orchestration = {
      ...orchestration,
      signalCount: diagnosticBundle.signals.length,
    };
    orchestration = appendStageTrace(
      orchestration,
      buildDiagnosticSignalsStageTrace(diagnosticBundle),
    );
    const orchestrationPlan = buildHetangAnalysisOrchestrationPlan({
      job,
      evidencePack,
      diagnosticBundle,
    });
    orchestration = appendStageTrace(
      orchestration,
      buildOrchestrationPlanStageTrace(orchestrationPlan),
    );
    if (diagnosticBundle.signals.length === 0) {
      this.deps.logger.warn(
        `hetang-ops: no diagnostic signals for ${job.jobId}, fallback to scoped query analysis`,
      );
      return await this.runEvidenceBackedScopedAnalysis(job, evidencePack, diagnosticBundle, {
        ...appendStageTrace(
          orchestration,
          buildBoundedSynthesisStageTrace({
            status: "fallback",
            reason: "signals_empty",
          }),
        ),
        fallbackStage: "bounded_synthesis",
      });
    }
    if (!existsSync(sidecarDir) || !existsSync(scriptPath)) {
      this.deps.logger.warn(
        `hetang-ops: CrewAI sidecar missing at ${sidecarDir}, fallback to scoped query analysis for ${job.jobId}`,
      );
      return await this.runEvidenceBackedScopedAnalysis(job, evidencePack, diagnosticBundle, {
        ...appendStageTrace(
          orchestration,
          buildBoundedSynthesisStageTrace({
            status: "fallback",
            reason: "sidecar_missing",
          }),
        ),
        fallbackStage: "bounded_synthesis",
      });
    }
    const python = resolveCrewAISidecarPython(sidecarDir);
    const controlTowerSettings = await (await this.getQueueStore()).resolveControlTowerSettings(
      job.orgId,
    );
    const analysisPremiumLane = resolveAnalysisPremiumLaneRuntime(this.deps.config);
    const reviewMode =
      typeof controlTowerSettings["analysis.reviewMode"] === "string"
        ? String(controlTowerSettings["analysis.reviewMode"])
        : undefined;
    let result;
    try {
      result = await this.deps.runCommandWithTimeout(
        [
          python,
          scriptPath,
          "--org",
          job.orgId,
          "--start",
          job.startBizDate,
          "--end",
          job.endBizDate,
        ],
        {
          timeoutMs: analysisPremiumLane.timeoutMs,
          cwd: sidecarDir,
          env: {
            ...process.env,
            HETANG_DATABASE_URL: this.deps.config.database.url,
            OPENCLAW_CREWAI_RUNTIME_DIR: path.join(
              this.deps.resolveStateDir(),
              "crewai-sidecar-runtime",
            ),
            HETANG_ANALYSIS_EVIDENCE_JSON: JSON.stringify(evidencePack),
            HETANG_ANALYSIS_EVIDENCE_MARKDOWN: evidencePack.markdown,
            HETANG_ANALYSIS_DIAGNOSTIC_JSON: JSON.stringify(diagnosticBundle),
            HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON: JSON.stringify(orchestrationPlan),
            ...analysisPremiumLane.env,
            ...(reviewMode ? { CREWAI_REVIEW_MODE: reviewMode } : {}),
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      this.deps.logger.warn(
        `hetang-ops: CrewAI sidecar failed for ${job.jobId}, fallback to scoped query analysis: ${message}`,
      );
      return await this.runEvidenceBackedScopedAnalysis(job, evidencePack, diagnosticBundle, {
        ...appendStageTrace(
          orchestration,
          buildBoundedSynthesisStageTrace({
            status: "fallback",
            reason: "sidecar_error",
          }),
        ),
        fallbackStage: "bounded_synthesis",
      });
    }
    if (result.code !== 0) {
      this.deps.logger.warn(
        `hetang-ops: CrewAI sidecar returned non-zero for ${job.jobId}, fallback to scoped query analysis: ${formatCrewAISidecarFailure(result)}`,
      );
      return await this.runEvidenceBackedScopedAnalysis(job, evidencePack, diagnosticBundle, {
        ...appendStageTrace(
          orchestration,
          buildBoundedSynthesisStageTrace({
            status: "fallback",
            reason: "sidecar_non_zero",
          }),
        ),
        fallbackStage: "bounded_synthesis",
      });
    }
    const output = result.stdout.trim();
    if (!output) {
      this.deps.logger.warn(
        `hetang-ops: CrewAI sidecar returned empty output for ${job.jobId}, fallback to scoped query analysis`,
      );
      return await this.runEvidenceBackedScopedAnalysis(job, evidencePack, diagnosticBundle, {
        ...appendStageTrace(
          orchestration,
          buildBoundedSynthesisStageTrace({
            status: "fallback",
            reason: "sidecar_empty",
          }),
        ),
        fallbackStage: "bounded_synthesis",
      });
    }
    const parsed = parseHetangAnalysisResult(output);
    if (!parsed.isStructured || (!parsed.summary && !parsed.markdown)) {
      this.deps.logger.warn(
        `hetang-ops: CrewAI sidecar returned unstructured output for ${job.jobId}, fallback to scoped query analysis`,
      );
      return await this.runEvidenceBackedScopedAnalysis(job, evidencePack, diagnosticBundle, {
        ...appendStageTrace(
          orchestration,
          buildBoundedSynthesisStageTrace({
            status: "fallback",
            reason: "sidecar_unstructured",
          }),
        ),
        fallbackStage: "bounded_synthesis",
      });
    }
    orchestration = appendStageTrace(
      orchestration,
      buildBoundedSynthesisStageTrace({
        status: "completed",
        reason: "sidecar_ok",
      }),
    );
    return attachAnalysisOrchestrationMetadata(output, orchestration);
  }

  private async runEvidenceBackedScopedAnalysis(
    job: HetangAnalysisJob,
    evidencePack: HetangAnalysisEvidencePack,
    diagnosticBundle: HetangAnalysisDiagnosticBundle,
    orchestration: HetangAnalysisOrchestrationMetadata,
  ): Promise<string> {
    try {
      return attachAnalysisOrchestrationMetadata(
        JSON.stringify(
          buildDeterministicBoundedAnalysisResult({
            job,
            evidencePack,
            diagnosticBundle,
          }),
        ),
        orchestration,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      this.deps.logger.warn(
        `hetang-ops: deterministic bounded synthesis failed for ${job.jobId}, fallback to scoped query analysis: ${message}`,
      );
      const scopedText = await this.deps.runScopedQueryAnalysis(job);
      const markdown = [
        evidencePack.markdown,
        ...(diagnosticBundle.signals.length > 0
          ? ["", ...renderDiagnosticSignalMarkdown(diagnosticBundle)]
          : []),
        "",
        "快速分析",
        scopedText,
      ].join("\n");
      return attachAnalysisOrchestrationMetadata(
        JSON.stringify({
          summary:
            summarizeHetangAnalysisResult(scopedText)?.trim() || "已基于证据包回退到安全分析。",
          markdown,
          suggestions: extractHetangAnalysisSuggestions(scopedText),
          risks: [],
        }),
        orchestration,
      );
    }
  }

  private async runEvidenceOnlyScopedAnalysis(
    job: HetangAnalysisJob,
    evidencePack: HetangAnalysisEvidencePack,
    orchestration: HetangAnalysisOrchestrationMetadata,
  ): Promise<string> {
    try {
      return attachAnalysisOrchestrationMetadata(
        JSON.stringify(
          buildDeterministicBoundedAnalysisResult({
            job,
            evidencePack,
          }),
        ),
        orchestration,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      this.deps.logger.warn(
        `hetang-ops: evidence-only bounded synthesis failed for ${job.jobId}, fallback to scoped query analysis: ${message}`,
      );
      const scopedText = await this.deps.runScopedQueryAnalysis(job);
      const markdown = [evidencePack.markdown, "", "快速分析", scopedText].join("\n");
      return attachAnalysisOrchestrationMetadata(
        JSON.stringify({
          summary:
            summarizeHetangAnalysisResult(scopedText)?.trim() || "已基于证据包回退到安全分析。",
          markdown,
          suggestions: extractHetangAnalysisSuggestions(scopedText),
          risks: [],
        }),
        orchestration,
      );
    }
  }

  async runPendingAnalysisJobs(now = new Date()): Promise<string[]> {
    return await this.getAnalysisOrchestrator().runPendingAnalysisJobs(now);
  }
}
