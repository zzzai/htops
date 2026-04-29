import { randomUUID } from "node:crypto";
import { extractHetangAnalysisOrchestrationMetadata } from "../analysis-result.js";
import type { HetangOpsStore } from "../store.js";
import type {
  HetangAnalysisJob,
  HetangConversationReviewAnalysisSignal,
  HetangConversationReviewFinding,
  HetangConversationReviewCustomerProfileSignal,
  HetangConversationReviewFindingCandidate,
  HetangConversationReviewFindingSeverity,
  HetangConversationReviewFindingType,
  HetangConversationReviewRun,
  HetangConversationReviewRunResult,
  HetangConversationReviewSummary,
  HetangConversationReviewSynthesis,
  HetangInboundMessageAuditRecord,
  HetangLogger,
} from "../types.js";
import { buildConversationReviewFindingCandidates } from "./conversation-review-finding-service.js";

function parseIsoTime(value?: string): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWithinWindow(value: string | undefined, startMs: number, endMs: number): boolean {
  const parsed = parseIsoTime(value);
  return parsed !== null && parsed >= startMs && parsed < endMs;
}

function resolveAnalysisSignalTimestamp(job: HetangAnalysisJob): string | undefined {
  return job.finishedAt ?? job.updatedAt ?? job.createdAt;
}

function buildSummary(params: {
  reviewDate: string;
  sourceWindowStart: string;
  sourceWindowEnd: string;
  inputConversationCount: number;
  inputShadowSampleCount: number;
  inputAnalysisJobCount: number;
  findings: HetangConversationReviewFinding[];
}): HetangConversationReviewSummary {
  const typeCounts = new Map<HetangConversationReviewFindingType, number>();
  const severityBreakdown: Record<HetangConversationReviewFindingSeverity, number> = {
    low: 0,
    medium: 0,
    high: 0,
  };

  for (const finding of params.findings) {
    typeCounts.set(finding.findingType, (typeCounts.get(finding.findingType) ?? 0) + 1);
    severityBreakdown[finding.severity] += 1;
  }

  const topFindingTypes = Array.from(typeCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, 5)
    .map(([findingType]) => findingType);

  return {
    reviewMode: "deterministic-only",
    reviewDate: params.reviewDate,
    sourceWindowStart: params.sourceWindowStart,
    sourceWindowEnd: params.sourceWindowEnd,
    inputConversationCount: params.inputConversationCount,
    inputShadowSampleCount: params.inputShadowSampleCount,
    inputAnalysisJobCount: params.inputAnalysisJobCount,
    findingCount: params.findings.length,
    topFindingTypes,
    severityBreakdown,
  };
}

function buildAnalysisSignals(jobs: HetangAnalysisJob[]): HetangConversationReviewAnalysisSignal[] {
  return jobs.flatMap((job) => {
    const orchestration = extractHetangAnalysisOrchestrationMetadata(job.resultText);
    if (!orchestration?.fallbackStage) {
      return [];
    }
    return [
      {
        jobId: job.jobId,
        orgId: job.orgId,
        storeName: job.storeName,
        fallbackStage: orchestration.fallbackStage,
      },
    ];
  });
}

function materializeFinding(params: {
  reviewRunId: string;
  candidate: HetangConversationReviewFindingCandidate;
  findingIndex: number;
  createdAt: string;
}): HetangConversationReviewFinding {
  return {
    findingId: `${params.reviewRunId}-finding-${params.findingIndex}`,
    reviewRunId: params.reviewRunId,
    conversationId: params.candidate.conversationId,
    messageId: params.candidate.messageId,
    jobId: params.candidate.jobId,
    channel: params.candidate.channel,
    accountId: params.candidate.accountId,
    chatId: params.candidate.chatId,
    senderId: params.candidate.senderId,
    orgId: params.candidate.orgId,
    storeName: params.candidate.storeName,
    findingType: params.candidate.findingType,
    severity: params.candidate.severity,
    confidence: params.candidate.confidence,
    title: params.candidate.title,
    summary: params.candidate.summary,
    evidenceJson: params.candidate.evidenceJson,
    suggestedActionType: params.candidate.suggestedActionType,
    suggestedActionPayloadJson: params.candidate.suggestedActionPayloadJson,
    followupTargets: params.candidate.followupTargets,
    memoryCandidateJson: params.candidate.memoryCandidateJson,
    status: "open",
    createdAt: params.createdAt,
  };
}

function applyBoundedSynthesis(params: {
  summary: HetangConversationReviewSummary;
  findings: HetangConversationReviewFinding[];
  synthesis: HetangConversationReviewSynthesis | null;
}): HetangConversationReviewSummary {
  if (!params.synthesis) {
    return params.summary;
  }
  const availableFindingTypes = new Set(params.findings.map((finding) => finding.findingType));
  const prioritizedFindingTypes = Array.isArray(params.synthesis.prioritizedFindingTypes)
    ? Array.from(
        new Set(
          params.synthesis.prioritizedFindingTypes.filter((findingType) =>
            availableFindingTypes.has(findingType),
          ),
        ),
      )
    : [];

  return {
    ...params.summary,
    reviewMode: "bounded-synthesis",
    reviewHeadline:
      typeof params.synthesis.reviewHeadline === "string" &&
      params.synthesis.reviewHeadline.trim().length > 0
        ? params.synthesis.reviewHeadline.trim()
        : params.summary.reviewHeadline,
    prioritizedFindingTypes:
      prioritizedFindingTypes.length > 0
        ? prioritizedFindingTypes
        : params.summary.prioritizedFindingTypes,
  };
}

export function parseConversationReviewSummaryJson(
  summaryJson?: string,
): HetangConversationReviewSummary | null {
  if (!summaryJson) {
    return null;
  }
  try {
    const parsed = JSON.parse(summaryJson) as Partial<HetangConversationReviewSummary>;
    if (
      parsed &&
      typeof parsed.reviewDate === "string" &&
      typeof parsed.sourceWindowStart === "string" &&
      typeof parsed.sourceWindowEnd === "string" &&
      typeof parsed.inputConversationCount === "number" &&
      typeof parsed.inputShadowSampleCount === "number" &&
      typeof parsed.inputAnalysisJobCount === "number" &&
      typeof parsed.findingCount === "number" &&
      Array.isArray(parsed.topFindingTypes) &&
      typeof parsed.severityBreakdown === "object" &&
      parsed.severityBreakdown !== null &&
      (parsed.reviewMode === "deterministic-only" || parsed.reviewMode === "bounded-synthesis")
    ) {
      return {
        reviewMode: parsed.reviewMode,
        reviewDate: parsed.reviewDate,
        sourceWindowStart: parsed.sourceWindowStart,
        sourceWindowEnd: parsed.sourceWindowEnd,
        inputConversationCount: parsed.inputConversationCount,
        inputShadowSampleCount: parsed.inputShadowSampleCount,
        inputAnalysisJobCount: parsed.inputAnalysisJobCount,
        findingCount: parsed.findingCount,
        topFindingTypes: parsed.topFindingTypes.filter(
          (value): value is HetangConversationReviewFindingType => typeof value === "string",
        ),
        severityBreakdown: {
          low: Number((parsed.severityBreakdown as Record<string, unknown>).low ?? 0),
          medium: Number((parsed.severityBreakdown as Record<string, unknown>).medium ?? 0),
          high: Number((parsed.severityBreakdown as Record<string, unknown>).high ?? 0),
        },
        reviewHeadline:
          typeof parsed.reviewHeadline === "string" && parsed.reviewHeadline.trim().length > 0
            ? parsed.reviewHeadline.trim()
            : undefined,
        prioritizedFindingTypes: Array.isArray(parsed.prioritizedFindingTypes)
          ? parsed.prioritizedFindingTypes.filter(
              (value): value is HetangConversationReviewFindingType => typeof value === "string",
            )
          : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export class HetangConversationReviewService {
  constructor(
    private readonly deps: {
      logger: HetangLogger;
      getStore: () => Promise<HetangOpsStore>;
      now?: () => Date;
      createReviewRunId?: () => string;
      runBoundedReviewSynthesis?: (params: {
        summary: HetangConversationReviewSummary;
        findings: HetangConversationReviewFinding[];
      }) => Promise<HetangConversationReviewSynthesis | null>;
      listCustomerProfileReviewSignals?: (params: {
        reviewDate: string;
        sourceWindowStart: string;
        sourceWindowEnd: string;
      }) => Promise<HetangConversationReviewCustomerProfileSignal[]>;
    },
  ) {}

  private resolveQueueAccessControlStore(store: HetangOpsStore) {
    if (
      typeof (store as { getQueueAccessControlStore?: unknown }).getQueueAccessControlStore !==
      "function"
    ) {
      throw new Error("conversation-review-service requires store.getQueueAccessControlStore()");
    }
    return (
      store as {
        getQueueAccessControlStore: () => {
          listInboundMessageAudits: (params?: {
            channel?: string;
            senderId?: string;
            conversationId?: string;
            contains?: string;
            limit?: number;
          }) => Promise<HetangInboundMessageAuditRecord[]>;
          listAnalysisJobs: (params?: {
            orgId?: string;
            status?: HetangAnalysisJob["status"];
          }) => Promise<HetangAnalysisJob[]>;
          createConversationReviewRun: (run: HetangConversationReviewRun) => Promise<void>;
          createConversationReviewFinding: (
            finding: HetangConversationReviewFinding,
          ) => Promise<void>;
        };
      }
    ).getQueueAccessControlStore();
  }

  async runNightlyConversationReview(params: {
    reviewDate: string;
    sourceWindowStart: string;
    sourceWindowEnd: string;
  }): Promise<HetangConversationReviewRunResult> {
    const startMs = parseIsoTime(params.sourceWindowStart);
    const endMs = parseIsoTime(params.sourceWindowEnd);
    if (startMs === null || endMs === null || startMs >= endMs) {
      throw new Error("invalid conversation review source window");
    }

    const queueStore = this.resolveQueueAccessControlStore(await this.deps.getStore());
    const [allAudits, allAnalysisJobs] = await Promise.all([
      queueStore.listInboundMessageAudits({ limit: 500 }),
      queueStore.listAnalysisJobs({}),
    ]);
    const inboundAudits = allAudits.filter((audit) =>
      isWithinWindow(audit.receivedAt, startMs, endMs),
    );
    const analysisJobs = allAnalysisJobs.filter((job) =>
      isWithinWindow(resolveAnalysisSignalTimestamp(job), startMs, endMs),
    );
    const analysisSignals = buildAnalysisSignals(analysisJobs);
    const customerProfileSignals = this.deps.listCustomerProfileReviewSignals
      ? await this.deps.listCustomerProfileReviewSignals({
          reviewDate: params.reviewDate,
          sourceWindowStart: params.sourceWindowStart,
          sourceWindowEnd: params.sourceWindowEnd,
        })
      : [];
    const shadowSignals: [] = [];
    const reviewRunId = this.deps.createReviewRunId?.() ?? `review-${randomUUID()}`;
    const nowIso = (this.deps.now ?? (() => new Date()))().toISOString();

    await queueStore.createConversationReviewRun({
      reviewRunId,
      reviewDate: params.reviewDate,
      sourceWindowStart: params.sourceWindowStart,
      sourceWindowEnd: params.sourceWindowEnd,
      status: "running",
      inputConversationCount: inboundAudits.length,
      inputShadowSampleCount: shadowSignals.length,
      inputAnalysisJobCount: analysisJobs.length,
      findingCount: 0,
      startedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const candidateSet = buildConversationReviewFindingCandidates({
      inboundAudits,
      analysisSignals,
      customerProfileSignals,
      shadowSignals,
    });
    const findings = candidateSet.findings.map((candidate, index) =>
      materializeFinding({
        reviewRunId,
        candidate,
        findingIndex: index + 1,
        createdAt: nowIso,
      }),
    );
    for (const finding of findings) {
      await queueStore.createConversationReviewFinding(finding);
    }

    const deterministicSummary = buildSummary({
      reviewDate: params.reviewDate,
      sourceWindowStart: params.sourceWindowStart,
      sourceWindowEnd: params.sourceWindowEnd,
      inputConversationCount: inboundAudits.length,
      inputShadowSampleCount: shadowSignals.length,
      inputAnalysisJobCount: analysisJobs.length,
      findings,
    });
    let summary = deterministicSummary;
    if (this.deps.runBoundedReviewSynthesis) {
      try {
        summary = applyBoundedSynthesis({
          summary: deterministicSummary,
          findings,
          synthesis: await this.deps.runBoundedReviewSynthesis({
            summary: deterministicSummary,
            findings,
          }),
        });
      } catch (error) {
        this.deps.logger.warn?.("conversation review bounded synthesis failed", {
          reviewRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await queueStore.createConversationReviewRun({
      reviewRunId,
      reviewDate: params.reviewDate,
      sourceWindowStart: params.sourceWindowStart,
      sourceWindowEnd: params.sourceWindowEnd,
      status: "completed",
      inputConversationCount: inboundAudits.length,
      inputShadowSampleCount: shadowSignals.length,
      inputAnalysisJobCount: analysisJobs.length,
      findingCount: findings.length,
      summaryJson: JSON.stringify(summary),
      startedAt: nowIso,
      completedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.deps.logger.info?.("conversation review run completed", {
      reviewRunId,
      reviewDate: params.reviewDate,
      findingCount: findings.length,
    });

    return {
      reviewRunId,
      reviewDate: params.reviewDate,
      sourceWindowStart: params.sourceWindowStart,
      sourceWindowEnd: params.sourceWindowEnd,
      findingCount: findings.length,
      summary,
      findings,
    };
  }
}
