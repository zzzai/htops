import { describe, expect, it, vi } from "vitest";
import { HetangAnalysisOrchestrator } from "./analysis-orchestrator.js";
import type { HetangAnalysisJob } from "./types.js";

function buildJob(overrides: Partial<HetangAnalysisJob> = {}): HetangAnalysisJob {
  return {
    jobId: overrides.jobId ?? "JOB-1",
    jobType: overrides.jobType ?? "store_review",
    orgId: overrides.orgId ?? "1001",
    storeName: overrides.storeName ?? "一号店",
    rawText: overrides.rawText ?? "一号店近7天经营复盘",
    timeFrameLabel: overrides.timeFrameLabel ?? "近7天",
    startBizDate: overrides.startBizDate ?? "2026-03-30",
    endBizDate: overrides.endBizDate ?? "2026-04-05",
    channel: overrides.channel ?? "wecom",
    target: overrides.target ?? "conversation-1",
    status: overrides.status ?? "completed",
    attemptCount: overrides.attemptCount ?? 1,
    resultText: overrides.resultText,
    errorMessage: overrides.errorMessage,
    createdAt: overrides.createdAt ?? "2026-04-06T09:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-06T09:05:00.000Z",
    startedAt: overrides.startedAt,
    finishedAt: overrides.finishedAt ?? "2026-04-06T09:05:00.000Z",
    deliveredAt: overrides.deliveredAt,
    queueDisposition: overrides.queueDisposition,
  };
}

describe("HetangAnalysisOrchestrator", () => {
  it("defers a failing subscriber delivery so later subscribers can still deliver", async () => {
    let nowCursor = new Date("2026-04-07T10:00:00.000Z");
    const deferredUntil = new Map<string, string>();
    const deliveredSubscribers = new Set<string>();
    const subscribers = [
      {
        ...buildJob(),
        subscriberKey: "sub-broken",
        deliveryChannel: "wecom",
        deliveryTarget: "broken-target",
      },
      {
        ...buildJob(),
        subscriberKey: "sub-healthy",
        deliveryChannel: "wecom",
        deliveryTarget: "healthy-target",
      },
    ];
    const store = {
      getNextDeliverableAnalysisSubscription: vi.fn(async () => {
        return (
          subscribers.find((entry) => {
            if (deliveredSubscribers.has(entry.subscriberKey)) {
              return false;
            }
            const nextDeliveryAfter = deferredUntil.get(entry.subscriberKey);
            return !nextDeliveryAfter || nextDeliveryAfter <= nowCursor.toISOString();
          }) ?? null
        );
      }),
      markAnalysisSubscriberDeliveryAttempt: vi.fn(
        async (params: { subscriberKey: string; nextDeliveryAfter: string }) => {
          deferredUntil.set(params.subscriberKey, params.nextDeliveryAfter);
        },
      ),
      markAnalysisSubscriberDelivered: vi.fn(async (params: { subscriberKey: string }) => {
        deliveredSubscribers.add(params.subscriberKey);
      }),
      refreshAnalysisJobDeliveryState: vi.fn().mockResolvedValue(undefined),
      getNextDeliverableAnalysisJob: vi.fn().mockResolvedValue(null),
      claimNextPendingAnalysisJob: vi.fn().mockResolvedValue(null),
    };
    const sendAnalysisReply = vi.fn(
      async (_job: HetangAnalysisJob, notification?: { target: string }) => {
        if (notification?.target === "broken-target") {
          throw new Error("invalid chatid");
        }
      },
    );
    const orchestrator = new HetangAnalysisOrchestrator({
      logger: { info() {}, warn() {}, error() {} },
      getStore: async () => store as never,
      decorateAnalysisJob: async (job) => job,
      sendAnalysisReply,
      autoCreateActionsFromAnalysis: vi.fn().mockResolvedValue(0),
      runScopedQueryAnalysis: vi.fn(),
      runCrewAISidecar: vi.fn(),
      shouldNotifyAnalysisFailure: vi.fn().mockResolvedValue(true),
      isScopedQueryAnalysis: vi.fn().mockReturnValue(false),
    });

    const first = await orchestrator.runPendingAnalysisJobs(nowCursor);
    nowCursor = new Date("2026-04-07T10:01:00.000Z");
    const second = await orchestrator.runPendingAnalysisJobs(nowCursor);

    expect(first).toEqual(["一号店: analysis reply failed - invalid chatid"]);
    expect(second).toEqual(["一号店: analysis reply sent"]);
    expect(sendAnalysisReply).toHaveBeenCalledTimes(2);
    expect(sendAnalysisReply.mock.calls[1]?.[1]).toMatchObject({
      target: "healthy-target",
    });
    expect(store.markAnalysisSubscriberDeliveryAttempt).toHaveBeenCalled();
  });

  it("defers a failing job-level delivery so pending analysis can continue", async () => {
    let nowCursor = new Date("2026-04-07T11:00:00.000Z");
    let directDeliveryDeferredUntil: string | null = null;
    let pendingJobClaimed = false;
    const completedJob = buildJob({
      jobId: "JOB-OLD",
      storeName: "旧店",
      status: "completed",
      resultText: "旧分析结果",
    });
    const pendingJob = buildJob({
      jobId: "JOB-NEW",
      storeName: "新店",
      status: "pending",
      resultText: undefined,
      finishedAt: undefined,
    });
    const store = {
      getNextDeliverableAnalysisSubscription: vi.fn().mockResolvedValue(null),
      getNextDeliverableAnalysisJob: vi.fn(async () => {
        if (
          directDeliveryDeferredUntil &&
          directDeliveryDeferredUntil > nowCursor.toISOString()
        ) {
          return null;
        }
        return completedJob;
      }),
      markAnalysisJobDeliveryAttempt: vi.fn(
        async (params: { nextDeliveryAfter: string }) => {
          directDeliveryDeferredUntil = params.nextDeliveryAfter;
        },
      ),
      claimNextPendingAnalysisJob: vi.fn(async () => {
        if (pendingJobClaimed) {
          return null;
        }
        pendingJobClaimed = true;
        return pendingJob;
      }),
      completeAnalysisJob: vi.fn().mockResolvedValue(undefined),
      failAnalysisJob: vi.fn().mockResolvedValue(undefined),
      markAnalysisJobDelivered: vi.fn().mockResolvedValue(undefined),
    };
    const sendAnalysisReply = vi.fn(async (job: HetangAnalysisJob) => {
      if (job.jobId === "JOB-OLD") {
        throw new Error("delivery endpoint down");
      }
    });
    const orchestrator = new HetangAnalysisOrchestrator({
      logger: { info() {}, warn() {}, error() {} },
      getStore: async () => store as never,
      decorateAnalysisJob: async (job) => job,
      sendAnalysisReply,
      autoCreateActionsFromAnalysis: vi.fn().mockResolvedValue(0),
      runScopedQueryAnalysis: vi.fn(),
      runCrewAISidecar: vi.fn().mockResolvedValue("新分析结果"),
      shouldNotifyAnalysisFailure: vi.fn().mockResolvedValue(true),
      isScopedQueryAnalysis: vi.fn().mockReturnValue(false),
    });

    const first = await orchestrator.runPendingAnalysisJobs(nowCursor);
    nowCursor = new Date("2026-04-07T11:01:00.000Z");
    const second = await orchestrator.runPendingAnalysisJobs(nowCursor);

    expect(first).toEqual(["旧店: analysis reply failed - delivery endpoint down"]);
    expect(second).toEqual(["新店: analysis delivered"]);
    expect(store.claimNextPendingAnalysisJob).toHaveBeenCalledTimes(1);
    expect(store.markAnalysisJobDeliveryAttempt).toHaveBeenCalled();
  });

  it("delivers a structured bounded-fallback analysis result without breaking completion flow", async () => {
    const pendingJob = buildJob({
      jobId: "JOB-FALLBACK",
      storeName: "回退店",
      status: "pending",
      resultText: undefined,
      finishedAt: undefined,
    });
    const store = {
      getNextDeliverableAnalysisSubscription: vi.fn().mockResolvedValue(null),
      getNextDeliverableAnalysisJob: vi.fn().mockResolvedValue(null),
      claimNextPendingAnalysisJob: vi.fn().mockResolvedValue(pendingJob),
      completeAnalysisJob: vi.fn().mockResolvedValue(undefined),
      failAnalysisJob: vi.fn().mockResolvedValue(undefined),
      markAnalysisJobDelivered: vi.fn().mockResolvedValue(undefined),
    };
    const sendAnalysisReply = vi.fn().mockResolvedValue(undefined);
    const orchestrator = new HetangAnalysisOrchestrator({
      logger: { info() {}, warn() {}, error() {} },
      getStore: async () => store as never,
      decorateAnalysisJob: async (job) => job,
      sendAnalysisReply,
      autoCreateActionsFromAnalysis: vi.fn().mockResolvedValue(0),
      runScopedQueryAnalysis: vi.fn(),
      runCrewAISidecar: vi.fn().mockResolvedValue(
        JSON.stringify({
          summary: "已回退到安全分析。",
          markdown: "证据包\n\n快速分析\nscoped analysis fallback",
          suggestions: [],
          risks: [],
          orchestration: {
            version: "v1",
            completedStages: ["evidence_pack", "diagnostic_signals", "bounded_synthesis"],
            fallbackStage: "bounded_synthesis",
          },
        }),
      ),
      shouldNotifyAnalysisFailure: vi.fn().mockResolvedValue(true),
      isScopedQueryAnalysis: vi.fn().mockReturnValue(false),
    });

    const result = await orchestrator.runPendingAnalysisJobs(
      new Date("2026-04-07T11:05:00.000Z"),
    );

    expect(result).toEqual(["回退店: analysis delivered"]);
    expect(store.completeAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "JOB-FALLBACK",
        resultText: expect.stringContaining("\"fallbackStage\":\"bounded_synthesis\""),
      }),
    );
    expect(sendAnalysisReply).toHaveBeenCalledTimes(1);
  });
});
