import { describe, expect, it, vi } from "vitest";
import { HetangSemanticQualityService } from "./semantic-quality-service.js";

describe("HetangSemanticQualityService", () => {
  it("writes a structured semantic execution audit for clarify-missing-time", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn(),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.recordSemanticExecutionAudit({
      entry: "inbound",
      channel: "wecom",
      senderId: "user-1",
      conversationId: "conv-1",
      rawText: "迎宾店营收怎么样",
      effectiveText: "迎宾店营收怎么样",
      semanticLane: "meta",
      intentKind: "clarify_missing_time",
      clarificationNeeded: true,
      clarificationReason: "missing-time",
      success: false,
      occurredAt: "2026-04-17T16:00:00.000Z",
      durationMs: 88,
    });

    expect(store.insertSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: "inbound",
        rawText: "迎宾店营收怎么样",
        effectiveText: "迎宾店营收怎么样",
        semanticLane: "meta",
        intentKind: "clarify_missing_time",
        clarificationNeeded: true,
        clarificationReason: "missing-time",
        fallbackUsed: false,
        success: false,
        failureClass: "clarify_missing_time",
        occurredAt: "2026-04-17T16:00:00.000Z",
        durationMs: 88,
      }),
    );
  });

  it("writes fallback_used=true when AI semantic fallback is used", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn(),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.recordSemanticExecutionAudit({
      entry: "query",
      channel: "wecom",
      senderId: "user-1",
      rawText: "义乌店昨天盘里收了多少",
      semanticLane: "query",
      intentKind: "query",
      entrySource: "ai_fallback",
      executed: true,
      success: true,
      occurredAt: "2026-04-17T16:05:00.000Z",
    });

    expect(store.insertSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        entry: "query",
        entrySource: "ai_fallback",
        fallbackUsed: true,
        success: true,
        failureClass: undefined,
      }),
    );
  });

  it("reclassifies colloquial generic misses into colloquial_lane_miss", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn(),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.recordSemanticExecutionAudit({
      entry: "inbound",
      channel: "wecom",
      senderId: "user-1",
      rawText: "盘子怎么样",
      effectiveText: "盘子怎么样",
      semanticLane: "meta",
      intentKind: "generic_unmatched",
      success: false,
      occurredAt: "2026-04-29T12:10:00.000Z",
    });

    expect(store.insertSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        intentKind: "generic_unmatched",
        failureClass: "colloquial_lane_miss",
      }),
    );
  });

  it("reclassifies object-switch generic misses into scope_inheritance_miss", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn(),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.recordSemanticExecutionAudit({
      entry: "inbound",
      channel: "wecom",
      senderId: "user-1",
      rawText: "那风险呢",
      effectiveText: "那风险呢",
      semanticLane: "meta",
      intentKind: "generic_unmatched",
      stateCarriedForward: false,
      topicSwitchDetected: false,
      success: false,
      occurredAt: "2026-04-29T12:12:00.000Z",
    });

    expect(store.insertSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        failureClass: "scope_inheritance_miss",
      }),
    );
  });

  it("reclassifies object-switch misses with topic-switch detection into topic_switch_false_positive", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn(),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.recordSemanticExecutionAudit({
      entry: "inbound",
      channel: "wecom",
      senderId: "user-1",
      rawText: "那建议呢",
      effectiveText: "那建议呢",
      semanticLane: "meta",
      intentKind: "generic_unmatched",
      stateCarriedForward: false,
      topicSwitchDetected: true,
      success: false,
      occurredAt: "2026-04-29T12:13:00.000Z",
    });

    expect(store.insertSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        failureClass: "topic_switch_false_positive",
      }),
    );
  });

  it("preserves analysis lens and route-upgrade telemetry when writing semantic audits", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn(),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.recordSemanticExecutionAudit({
      entry: "query",
      channel: "wecom",
      senderId: "user-1",
      rawText: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
      semanticLane: "query",
      intentKind: "advice",
      analysisFrameworkId: "store_profit_diagnosis_v1",
      analysisPersonaId: "profit_exec_cfo_v1",
      routeUpgradeKind: "metric_to_advice",
      executed: true,
      success: true,
      occurredAt: "2026-04-18T03:00:00.000Z",
    });

    expect(store.insertSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisFrameworkId: "store_profit_diagnosis_v1",
        analysisPersonaId: "profit_exec_cfo_v1",
        routeUpgradeKind: "metric_to_advice",
      }),
    );
  });

  it("defaults deploy marker from serving version when writing semantic audits", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn(),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.recordSemanticExecutionAudit({
      entry: "query",
      channel: "wecom",
      senderId: "user-1",
      rawText: "义乌店近7天重点看什么",
      semanticLane: "query",
      intentKind: "advice",
      servingVersion: "serving-20260418040000",
      executed: true,
      success: true,
      occurredAt: "2026-04-18T04:10:00.000Z",
    });

    expect(store.insertSemanticExecutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        servingVersion: "serving-20260418040000",
        deployMarker: "serving:serving-20260418040000",
      }),
    );
  });

  it("maps top failure classes into optimization backlog items and sample candidates", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn().mockResolvedValue({
        windowHours: 24,
        totalCount: 15,
        successCount: 9,
        successRate: 0.6,
        clarifyCount: 4,
        clarifyRate: 0.2667,
        fallbackUsedCount: 2,
        fallbackRate: 0.1333,
        latestOccurredAt: "2026-04-17T16:30:00.000Z",
        topFailureClasses: [
          { failureClass: "clarify_missing_time", count: 3 },
          { failureClass: "generic_unmatched", count: 2 },
        ],
        topAnalysisFrameworks: [{ frameworkId: "store_profit_diagnosis_v1", count: 2 }],
        topRouteUpgrades: [{ upgradeKind: "metric_to_advice", count: 2 }],
      }),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    const summary = await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-17T17:00:00.000Z"),
      limit: 5,
    });

    expect(summary.optimizationBacklog).toEqual([
      expect.objectContaining({
        failureClass: "clarify_missing_time",
        count: 3,
        ownerModule: "src/query-intent.ts",
        priority: "high",
      }),
      expect.objectContaining({
        failureClass: "generic_unmatched",
        count: 2,
        ownerModule: "src/semantic-intent.ts",
        priority: "high",
      }),
    ]);
    expect(summary.sampleCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureClass: "clarify_missing_time",
          ownerModule: "src/query-intent.ts",
          sampleTag: "time_scope_gap",
        }),
        expect.objectContaining({
          failureClass: "generic_unmatched",
          ownerModule: "src/semantic-intent.ts",
          sampleTag: "boss_open_guidance",
        }),
      ]),
    );
    expect(summary.topAnalysisFrameworks).toEqual([
      { frameworkId: "store_profit_diagnosis_v1", count: 2 },
    ]);
    expect(summary.topRouteUpgrades).toEqual([
      { upgradeKind: "metric_to_advice", count: 2 },
    ]);
  });

  it("bridges latest conversation review findings into review backlog, review samples, and deploy follow-up counts", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn().mockResolvedValue({
        windowHours: 24,
        totalCount: 3,
        successCount: 2,
        successRate: 0.6667,
        clarifyCount: 1,
        clarifyRate: 0.3333,
        fallbackUsedCount: 0,
        fallbackRate: 0,
        latestOccurredAt: "2026-04-18T08:30:00.000Z",
        topFailureClasses: [{ failureClass: "clarify_missing_time", count: 1 }],
        topAnalysisFrameworks: [],
        topRouteUpgrades: [],
      }),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
      listLatestConversationReviewFindings: vi.fn().mockResolvedValue([
        {
          findingId: "f-1",
          reviewRunId: "run-1",
          findingType: "scope_gap",
          severity: "high",
          title: "缺少默认时间窗",
          summary: "“这几天”没有走默认5天。",
          evidenceJson: JSON.stringify({ rawText: "这几天义乌店加钟率多少" }),
          followupTargets: ["sample_candidate", "backlog_candidate"],
          status: "open",
          createdAt: "2026-04-18T04:20:00.000Z",
        },
        {
          findingId: "f-2",
          reviewRunId: "run-1",
          findingType: "analysis_gap",
          severity: "high",
          title: "analysis fallback",
          summary: "bounded synthesis 退化。",
          evidenceJson: JSON.stringify({ rawText: "五店近7天重点看什么" }),
          followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
          status: "open",
          createdAt: "2026-04-18T04:21:00.000Z",
        },
      ]),
    });

    const summary = await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-18T09:00:00.000Z"),
      limit: 5,
    });

    expect(summary.reviewBacklog).toEqual([
      expect.objectContaining({
        source: "conversation_review",
        failureClass: "review:analysis_gap",
        ownerModule: "src/app/analysis-bounded-synthesis.ts",
        priority: "high",
      }),
      expect.objectContaining({
        source: "conversation_review",
        failureClass: "review:scope_gap",
        ownerModule: "src/query-intent.ts",
        priority: "high",
      }),
    ]);
    expect(summary.reviewSampleCandidates).toEqual([
      expect.objectContaining({
        source: "conversation_review",
        failureClass: "review:scope_gap",
        sampleTag: "review_scope_gap",
        prompt: "这几天义乌店加钟率多少",
      }),
    ]);
    expect(summary.reviewDeployFollowupCount).toBe(1);
  });

  it("passes through an occurredAfter lower bound when requesting semantic quality summary", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn().mockResolvedValue({
        windowHours: 24,
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
      }),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-18T11:30:00.000Z"),
      limit: 5,
      occurredAfter: "2026-04-18T03:00:00.000Z",
    });

    expect(store.getSemanticQualitySummary).toHaveBeenCalledWith({
      windowHours: 24,
      now: new Date("2026-04-18T11:30:00.000Z"),
      limit: 5,
      occurredAfter: "2026-04-18T03:00:00.000Z",
    });
  });

  it("passes through deployMarker when requesting semantic quality summary", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn().mockResolvedValue({
        windowHours: 24,
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
      }),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-18T11:30:00.000Z"),
      limit: 5,
      deployMarker: "serving:serving-20260418040000",
    });

    expect(store.getSemanticQualitySummary).toHaveBeenCalledWith({
      windowHours: 24,
      now: new Date("2026-04-18T11:30:00.000Z"),
      limit: 5,
      deployMarker: "serving:serving-20260418040000",
    });
  });

  it("maps customer profile capability gaps into world-model backlog owners", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn().mockResolvedValue({
        windowHours: 24,
        totalCount: 1,
        successCount: 1,
        successRate: 1,
        clarifyCount: 0,
        clarifyRate: 0,
        fallbackUsedCount: 0,
        fallbackRate: 0,
        latestOccurredAt: "2026-04-21T09:00:00.000Z",
        topFailureClasses: [],
        topAnalysisFrameworks: [],
        topRouteUpgrades: [],
      }),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
      listLatestConversationReviewFindings: vi.fn().mockResolvedValue([
        {
          findingId: "f-profile-1",
          reviewRunId: "run-profile-1",
          findingType: "capability_gap",
          severity: "high",
          title: "顾客经营画像已过期",
          summary: "经营画像超过3天未刷新。",
          evidenceJson: JSON.stringify({ signalType: "stale_profile" }),
          followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
          status: "open",
          createdAt: "2026-04-21T08:30:00.000Z",
        },
      ]),
    });

    const summary = await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-21T09:00:00.000Z"),
      limit: 5,
    });

    expect(summary.reviewBacklog).toEqual([
      expect.objectContaining({
        failureClass: "review:capability_gap",
        ownerModule: "src/world-model/customer-profile-evidence.ts",
        priority: "high",
      }),
    ]);
    expect(summary.reviewDeployFollowupCount).toBe(1);
  });

  it("maps colloquial_lane_miss failure class into the correct playbook entry", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn().mockResolvedValue({
        windowHours: 24,
        totalCount: 5,
        successCount: 2,
        successRate: 0.4,
        clarifyCount: 0,
        clarifyRate: 0,
        fallbackUsedCount: 0,
        fallbackRate: 0,
        latestOccurredAt: "2026-04-29T10:00:00.000Z",
        topFailureClasses: [
          { failureClass: "colloquial_lane_miss", count: 3 },
        ],
        topAnalysisFrameworks: [],
        topRouteUpgrades: [],
      }),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    const summary = await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-29T10:00:00.000Z"),
      limit: 5,
    });

    expect(summary.optimizationBacklog).toEqual([
      expect.objectContaining({
        failureClass: "colloquial_lane_miss",
        count: 3,
        ownerModule: "src/query-semantics.ts",
        priority: "high",
      }),
    ]);
    expect(summary.sampleCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureClass: "colloquial_lane_miss",
          ownerModule: "src/query-semantics.ts",
          sampleTag: "colloquial_lane_miss",
        }),
      ]),
    );
  });

  it("maps scope_inheritance_miss failure class into the correct playbook entry", async () => {
    const store = {
      insertSemanticExecutionAudit: vi.fn().mockResolvedValue(undefined),
      getSemanticQualitySummary: vi.fn().mockResolvedValue({
        windowHours: 24,
        totalCount: 4,
        successCount: 2,
        successRate: 0.5,
        clarifyCount: 0,
        clarifyRate: 0,
        fallbackUsedCount: 0,
        fallbackRate: 0,
        latestOccurredAt: "2026-04-29T10:00:00.000Z",
        topFailureClasses: [
          { failureClass: "scope_inheritance_miss", count: 2 },
        ],
        topAnalysisFrameworks: [],
        topRouteUpgrades: [],
      }),
      getSemanticFailureTopCounts: vi.fn(),
    };
    const service = new HetangSemanticQualityService({
      store: store as never,
    });

    const summary = await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-29T10:00:00.000Z"),
      limit: 5,
    });

    expect(summary.optimizationBacklog).toEqual([
      expect.objectContaining({
        failureClass: "scope_inheritance_miss",
        count: 2,
        ownerModule: "src/query-intent.ts",
        priority: "high",
      }),
    ]);
    expect(summary.sampleCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failureClass: "scope_inheritance_miss",
          ownerModule: "src/query-intent.ts",
          sampleTag: "scope_inheritance_miss",
        }),
      ]),
    );
  });
});
