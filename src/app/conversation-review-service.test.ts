import { describe, expect, it, vi } from "vitest";
import { HetangConversationReviewService } from "./conversation-review-service.js";
import type { HetangAnalysisJob } from "../types.js";

function buildAnalysisJob(overrides: Partial<HetangAnalysisJob> = {}): HetangAnalysisJob {
  return {
    jobId: overrides.jobId ?? "JOB-1",
    jobType: overrides.jobType ?? "store_review",
    orgId: overrides.orgId ?? "1001",
    storeName: overrides.storeName ?? "义乌店",
    rawText: overrides.rawText ?? "义乌店近7天经营复盘",
    timeFrameLabel: overrides.timeFrameLabel ?? "近7天",
    startBizDate: overrides.startBizDate ?? "2026-04-09",
    endBizDate: overrides.endBizDate ?? "2026-04-15",
    channel: overrides.channel ?? "wecom",
    target: overrides.target ?? "chat-1",
    accountId: overrides.accountId,
    threadId: overrides.threadId,
    senderId: overrides.senderId ?? "u-1",
    status: overrides.status ?? "completed",
    attemptCount: overrides.attemptCount ?? 1,
    resultText: overrides.resultText,
    errorMessage: overrides.errorMessage,
    createdAt: overrides.createdAt ?? "2026-04-15T11:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-15T12:00:00.000Z",
    startedAt: overrides.startedAt,
    finishedAt: overrides.finishedAt ?? "2026-04-15T12:00:00.000Z",
    deliveredAt: overrides.deliveredAt,
    queueDisposition: overrides.queueDisposition,
  };
}

function buildQueueStore() {
  return {
    listInboundMessageAudits: vi.fn().mockResolvedValue([
      {
        requestId: "req-1",
        channel: "wecom",
        senderId: "u-1",
        conversationId: "chat-1",
        isGroup: false,
        content: "这几天义乌店加钟率多少",
        receivedAt: "2026-04-15T10:00:00.000Z",
      },
    ]),
    listAnalysisJobs: vi.fn().mockResolvedValue([
      buildAnalysisJob({
        jobId: "job-1",
        resultText: JSON.stringify({
          summary: "analysis fallback",
          orchestration: {
            version: "v1",
            completedStages: ["evidence_pack", "diagnostic_signals"],
            fallbackStage: "bounded_synthesis",
          },
        }),
        updatedAt: "2026-04-15T12:00:00.000Z",
        finishedAt: "2026-04-15T12:00:00.000Z",
      }),
    ]),
    createConversationReviewRun: vi.fn().mockResolvedValue(undefined),
    createConversationReviewFinding: vi.fn().mockResolvedValue(undefined),
  };
}

function buildStore(queueStore: ReturnType<typeof buildQueueStore>) {
  return {
    getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
  };
}

describe("HetangConversationReviewService", () => {
  it("persists a completed conversation review run with findings and summary", async () => {
    const queueStore = buildQueueStore();
    queueStore.listInboundMessageAudits.mockResolvedValueOnce([
      {
        requestId: "req-1",
        channel: "wecom",
        senderId: "u-1",
        conversationId: "chat-1",
        isGroup: false,
        content: "这几天义乌店加钟率多少",
        receivedAt: "2026-04-15T10:00:00.000Z",
      },
      {
        requestId: "req-2",
        channel: "wecom",
        senderId: "u-2",
        conversationId: "chat-2",
        isGroup: false,
        content: "默认5天",
        receivedAt: "2026-04-14T23:59:59.000Z",
      },
    ]);
    queueStore.listAnalysisJobs.mockResolvedValueOnce([
      buildAnalysisJob({
        jobId: "job-1",
        resultText: JSON.stringify({
          summary: "analysis fallback",
          orchestration: {
            version: "v1",
            completedStages: ["evidence_pack", "diagnostic_signals"],
            fallbackStage: "bounded_synthesis",
          },
        }),
        updatedAt: "2026-04-15T12:00:00.000Z",
        finishedAt: "2026-04-15T12:00:00.000Z",
      }),
      buildAnalysisJob({
        jobId: "job-2",
        resultText: JSON.stringify({
          summary: "old analysis fallback",
          orchestration: {
            version: "v1",
            completedStages: ["evidence_pack"],
            fallbackStage: "bounded_synthesis",
          },
        }),
        updatedAt: "2026-04-14T12:00:00.000Z",
        finishedAt: "2026-04-14T12:00:00.000Z",
      }),
    ]);
    const service = new HetangConversationReviewService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => buildStore(queueStore) as never,
      now: () => new Date("2026-04-16T01:00:00.000Z"),
      createReviewRunId: () => "run-1",
    });

    const result = await service.runNightlyConversationReview({
      reviewDate: "2026-04-16",
      sourceWindowStart: "2026-04-15T00:00:00.000Z",
      sourceWindowEnd: "2026-04-16T00:00:00.000Z",
    });

    expect(result.findingCount).toBe(2);
    expect(queueStore.createConversationReviewRun).toHaveBeenCalled();
    expect(queueStore.createConversationReviewFinding).toHaveBeenCalledTimes(2);
    expect(result.summary.topFindingTypes).toContain("scope_gap");
    expect(result.summary.topFindingTypes).toContain("analysis_gap");
    expect(queueStore.createConversationReviewRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        reviewRunId: "run-1",
        status: "completed",
        findingCount: 2,
        inputConversationCount: 1,
        inputAnalysisJobCount: 1,
        summaryJson: expect.any(String),
      }),
    );
    expect(queueStore.createConversationReviewFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        findingType: "scope_gap",
        followupTargets: ["sample_candidate", "backlog_candidate"],
      }),
    );
    expect(queueStore.createConversationReviewFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        findingType: "analysis_gap",
        followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
      }),
    );
  });

  it("fails fast when the queue access control owner getter is missing", async () => {
    const service = new HetangConversationReviewService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => ({}) as never,
      now: () => new Date("2026-04-16T01:00:00.000Z"),
      createReviewRunId: () => "run-missing-queue",
    });

    await expect(
      service.runNightlyConversationReview({
        reviewDate: "2026-04-16",
        sourceWindowStart: "2026-04-15T00:00:00.000Z",
        sourceWindowEnd: "2026-04-16T00:00:00.000Z",
      }),
    ).rejects.toThrow("conversation-review-service requires store.getQueueAccessControlStore()");
  });

  it("falls back to deterministic-only review findings when synthesis is unavailable", async () => {
    const queueStore = buildQueueStore();
    const service = new HetangConversationReviewService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => buildStore(queueStore) as never,
      now: () => new Date("2026-04-16T01:00:00.000Z"),
      createReviewRunId: () => "run-2",
    });

    const result = await service.runNightlyConversationReview({
      reviewDate: "2026-04-16",
      sourceWindowStart: "2026-04-15T00:00:00.000Z",
      sourceWindowEnd: "2026-04-16T00:00:00.000Z",
    });

    expect(result.summary.reviewMode).toBe("deterministic-only");
    expect(result.findings[0]?.findingType).toBe("scope_gap");
  });

  it("applies bounded synthesis prioritization without replacing deterministic findings", async () => {
    const queueStore = buildQueueStore();
    const service = new HetangConversationReviewService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => buildStore(queueStore) as never,
      now: () => new Date("2026-04-16T01:00:00.000Z"),
      createReviewRunId: () => "run-3",
      runBoundedReviewSynthesis: vi.fn().mockResolvedValue({
        reviewHeadline: "优先修复时间窗解释和 analysis fallback。",
        prioritizedFindingTypes: ["analysis_gap", "scope_gap"],
      }),
    });

    const result = await service.runNightlyConversationReview({
      reviewDate: "2026-04-16",
      sourceWindowStart: "2026-04-15T00:00:00.000Z",
      sourceWindowEnd: "2026-04-16T00:00:00.000Z",
    });

    expect(result.summary.reviewMode).toBe("bounded-synthesis");
    expect(result.summary.reviewHeadline).toBe("优先修复时间窗解释和 analysis fallback。");
    expect(result.summary.prioritizedFindingTypes).toEqual(["analysis_gap", "scope_gap"]);
    expect(result.findings.map((finding) => finding.findingType)).toEqual(
      expect.arrayContaining(["scope_gap", "analysis_gap"]),
    );
  });

  it("bridges customer profile review signals into nightly review findings", async () => {
    const queueStore = buildQueueStore();
    const service = new HetangConversationReviewService({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => buildStore(queueStore) as never,
      now: () => new Date("2026-04-16T01:00:00.000Z"),
      createReviewRunId: () => "run-4",
      listCustomerProfileReviewSignals: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          storeName: "义乌店",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          signalType: "stale_profile",
          severity: "high",
          summary: "顾客经营画像超过3天未刷新。",
          evidenceJson: JSON.stringify({ staleDays: 4 }),
        },
        {
          orgId: "1001",
          storeName: "义乌店",
          customerIdentityKey: "member:M-002",
          customerDisplayName: "李女士",
          signalType: "low_hit_action",
          severity: "medium",
          summary: "画像桥接动作近7天到店命中偏低。",
          evidenceJson: JSON.stringify({ arrivalRate7d: 0.08 }),
        },
      ]),
    });

    const result = await service.runNightlyConversationReview({
      reviewDate: "2026-04-16",
      sourceWindowStart: "2026-04-15T00:00:00.000Z",
      sourceWindowEnd: "2026-04-16T00:00:00.000Z",
    });

    expect(result.findings.map((finding) => finding.findingType)).toEqual(
      expect.arrayContaining(["scope_gap", "analysis_gap", "capability_gap"]),
    );
    expect(queueStore.createConversationReviewFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        findingType: "capability_gap",
        title: "顾客经营画像已过期",
        followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
      }),
    );
    expect(queueStore.createConversationReviewFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        findingType: "analysis_gap",
        title: "画像桥接动作命中偏低",
      }),
    );
  });
});
