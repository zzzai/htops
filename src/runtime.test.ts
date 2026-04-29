import { afterAll, describe, expect, it, vi } from "vitest";
const originalSendBinary = process.env.HETANG_MESSAGE_SEND_BIN;
process.env.HETANG_MESSAGE_SEND_BIN = originalSendBinary ?? "openclaw";
const {
  buildDailyStoreReportMock,
  executeHetangQueryMock,
  rebuildMemberDailySnapshotsForDateRangeMock,
  rebuildCustomerIntelligenceForDateRangeMock,
  rebuildMemberReactivationFeaturesForDateRangeMock,
  rebuildMemberReactivationStrategiesForDateRangeMock,
  rebuildMemberReactivationQueueForDateRangeMock,
  loadLatestCustomerSegmentSnapshotMock,
  selectTopReactivationCandidateMock,
  renderReactivationPushMessageMock,
} = vi.hoisted(() => ({
  buildDailyStoreReportMock: vi.fn(),
  executeHetangQueryMock: vi.fn(),
  rebuildMemberDailySnapshotsForDateRangeMock: vi.fn(),
  rebuildCustomerIntelligenceForDateRangeMock: vi.fn(),
  rebuildMemberReactivationFeaturesForDateRangeMock: vi.fn(),
  rebuildMemberReactivationStrategiesForDateRangeMock: vi.fn(),
  rebuildMemberReactivationQueueForDateRangeMock: vi.fn(),
  loadLatestCustomerSegmentSnapshotMock: vi.fn(),
  selectTopReactivationCandidateMock: vi.fn(),
  renderReactivationPushMessageMock: vi.fn(),
}));
vi.mock("./report.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./report.js")>();
  return {
    ...actual,
    buildDailyStoreReport: buildDailyStoreReportMock,
  };
});
vi.mock("./query-engine.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query-engine.js")>();
  return {
    ...actual,
    executeHetangQuery: executeHetangQueryMock,
  };
});
vi.mock("./customer-growth/history-backfill.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./customer-growth/history-backfill.js")>();
  return {
    ...actual,
    rebuildMemberDailySnapshotsForDateRange: rebuildMemberDailySnapshotsForDateRangeMock,
  };
});
vi.mock("./customer-growth/intelligence.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./customer-growth/intelligence.js")>();
  return {
    ...actual,
    rebuildCustomerIntelligenceForDateRange: rebuildCustomerIntelligenceForDateRangeMock,
  };
});
vi.mock("./customer-growth/reactivation/features.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./customer-growth/reactivation/features.js")>();
  return {
    ...actual,
    rebuildMemberReactivationFeaturesForDateRange: rebuildMemberReactivationFeaturesForDateRangeMock,
  };
});
vi.mock("./customer-growth/reactivation/strategy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./customer-growth/reactivation/strategy.js")>();
  return {
    ...actual,
    rebuildMemberReactivationStrategiesForDateRange:
      rebuildMemberReactivationStrategiesForDateRangeMock,
  };
});
vi.mock("./customer-growth/reactivation/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./customer-growth/reactivation/queue.js")>();
  return {
    ...actual,
    rebuildMemberReactivationQueueForDateRange: rebuildMemberReactivationQueueForDateRangeMock,
  };
});
vi.mock("./customer-growth/reactivation/push.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./customer-growth/reactivation/push.js")>();
  return {
    ...actual,
    loadLatestCustomerSegmentSnapshot: loadLatestCustomerSegmentSnapshotMock,
    selectTopReactivationCandidate: selectTopReactivationCandidateMock,
    renderReactivationPushMessage: renderReactivationPushMessageMock,
  };
});
import { resolveHetangOpsConfig } from "./config.js";
import { HetangOpsRuntime } from "./runtime.js";
import { resolveReportBizDate, shiftBizDate } from "./time.js";

afterAll(() => {
  if (originalSendBinary == null) {
    delete process.env.HETANG_MESSAGE_SEND_BIN;
  } else {
    process.env.HETANG_MESSAGE_SEND_BIN = originalSendBinary;
  }
});

describe("HetangOpsRuntime semantic quality summary", () => {
  it("passes through occurredAfter and deployMarker to the admin read service", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);
    const getSemanticQualitySummary = vi.fn().mockResolvedValue({
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
      optimizationBacklog: [],
      sampleCandidates: [],
    });
    (runtime as unknown as { adminReadService: { getSemanticQualitySummary: typeof getSemanticQualitySummary } }).adminReadService = {
      getSemanticQualitySummary,
    };

    await runtime.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-18T11:45:00.000Z"),
      limit: 5,
      occurredAfter: "2026-04-18T03:00:00.000Z",
      deployMarker: "serving:serving-20260418040000",
    });

    expect(getSemanticQualitySummary).toHaveBeenCalledWith({
      windowHours: 24,
      now: new Date("2026-04-18T11:45:00.000Z"),
      limit: 5,
      occurredAfter: "2026-04-18T03:00:00.000Z",
      deployMarker: "serving:serving-20260418040000",
    });
  });

  it("exposes reactivation execution summary, task list, and feedback upsert through runtime", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);
    const listExecutionTasks = vi.fn().mockResolvedValue([
      {
        orgId: "1005",
        bizDate: "2026-04-18",
        memberId: "M-001",
        customerIdentityKey: "member:M-001",
        customerDisplayName: "王女士",
        primarySegment: "important-reactivation-member",
        followupBucket: "high-value-reactivation",
        reactivationPriorityScore: 760,
        strategyPriorityScore: 980,
        executionPriorityScore: 1040,
        priorityBand: "P0",
        priorityRank: 1,
        churnRiskLabel: "critical",
        churnRiskScore: 0.88,
        revisitWindowLabel: "due-now",
        recommendedActionLabel: "immediate-1to1",
        recommendedTouchWeekday: "friday",
        recommendedTouchDaypart: "after-work",
        touchWindowLabel: "best-today",
        reasonSummary: "已沉默36天，近90天消费4680.00元，优先一对一召回。",
        touchAdviceSummary: "建议周五 after-work 联系。",
        daysSinceLastVisit: 36,
        visitCount90d: 5,
        payAmount90d: 4680,
        currentStoredBalanceInferred: 680,
        projectedBalanceDaysLeft: 34,
        birthdayBoostScore: 0,
        queueJson: "{}",
        updatedAt: "2026-04-18T09:00:00+08:00",
        feedbackStatus: "pending",
        contacted: false,
        replied: false,
        booked: false,
        arrived: false,
      },
    ]);
    const getExecutionSummary = vi.fn().mockResolvedValue({
      orgId: "1005",
      bizDate: "2026-04-18",
      totalTaskCount: 1,
      pendingCount: 1,
      contactedCount: 0,
      repliedCount: 0,
      bookedCount: 0,
      arrivedCount: 0,
      closedCount: 0,
      contactRate: 0,
      bookingRate: 0,
      arrivalRate: 0,
      priorityBandCounts: [{ priorityBand: "P0", count: 1 }],
      followupBucketCounts: [{ followupBucket: "high-value-reactivation", count: 1 }],
      topPendingTasks: [],
    });
    const upsertExecutionFeedback = vi.fn().mockResolvedValue(undefined);
    (runtime as unknown as {
      reactivationExecutionService: {
        listExecutionTasks: typeof listExecutionTasks;
        getExecutionSummary: typeof getExecutionSummary;
        upsertExecutionFeedback: typeof upsertExecutionFeedback;
      };
    }).reactivationExecutionService = {
      listExecutionTasks,
      getExecutionSummary,
      upsertExecutionFeedback,
    };

    await runtime.listMemberReactivationExecutionTasks({
      orgId: "1005",
      bizDate: "2026-04-18",
      feedbackStatus: "pending",
      limit: 10,
    });
    await runtime.getMemberReactivationExecutionSummary({
      orgId: "1005",
      bizDate: "2026-04-18",
      pendingLimit: 5,
    });
    await runtime.upsertMemberReactivationExecutionFeedback({
      orgId: "1005",
      bizDate: "2026-04-18",
      memberId: "M-001",
      feedbackStatus: "contacted",
      contacted: true,
      replied: false,
      booked: false,
      arrived: false,
      updatedAt: "2026-04-18T16:05:00+08:00",
    });

    expect(listExecutionTasks).toHaveBeenCalledWith({
      orgId: "1005",
      bizDate: "2026-04-18",
      feedbackStatus: "pending",
      limit: 10,
    });
    expect(getExecutionSummary).toHaveBeenCalledWith({
      orgId: "1005",
      bizDate: "2026-04-18",
      pendingLimit: 5,
    });
    expect(upsertExecutionFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "M-001",
        feedbackStatus: "contacted",
      }),
    );
  });
});

function buildCompleteDeliveryWatermarks(bizDate: string): Record<string, string> {
  const completionIso = `${bizDate}T19:10:00.000Z`;
  return Object.fromEntries(
    ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"].map((endpoint) => [
      endpoint,
      completionIso,
    ]),
  );
}

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "一号店" },
      { orgId: "1002", storeName: "二号店" },
      { orgId: "1003", storeName: "三号店" },
      { orgId: "1004", storeName: "四号店" },
      { orgId: "1005", storeName: "五号店" },
    ],
  });
}

function buildSkippedSharedDeliveryLines(bizDate: string): string[] {
  return [
    `five-store daily overview ${bizDate}: skipped - no shared delivery configured`,
    `weekly report ${bizDate}: skipped - no shared delivery configured`,
    `weekly chart image ${bizDate}: skipped - no shared delivery configured`,
  ];
}

function buildWaitingSharedDeliveryLines(bizDate: string): string[] {
  return [
    `${bizDate} five-store daily overview waiting - daily reports not fully sent yet`,
    `${bizDate} weekly report waiting - daily reports not fully sent yet`,
    `${bizDate} weekly chart waiting - weekly report not fully sent yet`,
  ];
}

type RuntimeStoreMock = Record<string, any>;

function buildRuntimeStore(overrides: RuntimeStoreMock = {}): RuntimeStoreMock {
  const store: RuntimeStoreMock = {
    getEndpointWatermarksForOrg: vi.fn().mockResolvedValue(buildCompleteDeliveryWatermarks("2099-01-01")),
    getHolidayCalendarDay: vi.fn().mockResolvedValue(null),
    getStoreEnvironmentDailySnapshot: vi.fn().mockResolvedValue(null),
    getStoreMasterProfile: vi.fn().mockResolvedValue(null),
    upsertStoreEnvironmentDailySnapshot: vi.fn().mockResolvedValue(undefined),
    listConsumeBillsByDate: vi.fn().mockResolvedValue([]),
    listConsumeBillsByDateRange: vi.fn().mockResolvedValue([]),
    listRechargeBillsByDate: vi.fn().mockResolvedValue([]),
    listRechargeBillsByDateRange: vi.fn().mockResolvedValue([]),
    listUserTradesByDate: vi.fn().mockResolvedValue([]),
    listUserTradesByDateRange: vi.fn().mockResolvedValue([]),
    listTechUpClockByDate: vi.fn().mockResolvedValue([]),
    listTechMarketByDate: vi.fn().mockResolvedValue([]),
    listCurrentMembers: vi.fn().mockResolvedValue([]),
    listMemberDailySnapshotsByDateRange: vi.fn().mockResolvedValue([]),
    listCurrentMemberCards: vi.fn().mockResolvedValue([]),
    listMemberCardDailySnapshotsByDateRange: vi.fn().mockResolvedValue([]),
    listCurrentTech: vi.fn().mockResolvedValue([]),
    listIndustryContextSnapshots: vi.fn().mockResolvedValue([]),
    getDailyMetrics: vi.fn().mockResolvedValue(null),
    getDailyReport: vi.fn().mockResolvedValue(null),
    markReportSent: vi.fn().mockResolvedValue(undefined),
    saveDailyMetrics: vi.fn().mockResolvedValue(undefined),
    saveDailyReport: vi.fn().mockResolvedValue(undefined),
    replaceDailyAlerts: vi.fn().mockResolvedValue(undefined),
    forceRebuildAnalyticsViews: vi.fn().mockResolvedValue(undefined),
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    getScheduledJobState: vi.fn().mockResolvedValue(null),
    setScheduledJobState: vi.fn().mockResolvedValue(undefined),
    deleteScheduledJobState: vi.fn().mockResolvedValue(undefined),
    markScheduledJobCompleted: vi.fn().mockResolvedValue(undefined),
    listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
    getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    getAnalysisQueueSummary: vi.fn().mockResolvedValue({
      pendingCount: 0,
      runningCount: 0,
      completedCount: 0,
      failedCount: 0,
    }),
    getAnalysisDeadLetterSummary: vi.fn().mockResolvedValue(null),
    listAnalysisDeadLetters: vi.fn().mockResolvedValue([]),
    replayAnalysisDeadLetter: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  store.getRawIngestionStore = vi.fn(() => store);
  store.getMartDerivedStore = vi.fn(() => store);
  store.getQueueAccessControlStore = vi.fn(() => store);
  store.getServingPublicationStore = vi.fn(() => store);
  return store;
}

describe("HetangOpsRuntime.syncStores", () => {
  it("runs nightly sync endpoint-by-endpoint in fixed store order and executes 1.4 last with candidate cards", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolveNow = vi
      .fn<() => Date>()
      .mockReturnValue(new Date("2026-03-31T03:20:00+08:00"));
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
      resolveNow,
    } as never);

    const candidateCardIdsByOrgId: Record<string, string[]> = {
      "1001": ["1001-card-1", "1001-card-2"],
      "1002": ["1002-card-1"],
      "1003": [],
      "1004": ["1004-card-1", "1004-card-2", "1004-card-3"],
      "1005": ["1005-card-1"],
    };
    (runtime as any).store = buildRuntimeStore({
      listRecentUserTradeCandidateCardIds: vi.fn().mockImplementation(
        async ({ orgId }: { orgId: string }) => candidateCardIdsByOrgId[orgId] ?? [],
      ),
    });

    const lines = await runtime.syncStores({
      orgIds: ["1003", "1001", "1005", "1002", "1004"],
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    const resolveSelectedEndpoint = (skipEndpoints?: string[]) =>
      (["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] as const).find(
        (endpoint) => !skipEndpoints?.includes(endpoint),
      ) ?? "all";

    expect(lines).toEqual([
      "一号店: sync complete",
      "二号店: sync complete",
      "三号店: sync complete",
      "四号店: sync complete",
      "五号店: sync complete",
    ]);
    expect(syncStore).toHaveBeenCalledTimes(39);
    expect(syncStore.mock.calls.slice(0, 5).map((call) => call[0].orgId)).toEqual([
      "1001",
      "1002",
      "1003",
      "1004",
      "1005",
    ]);
    expect(
      syncStore.mock.calls
        .slice(0, 5)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.1", "1.1", "1.1", "1.1", "1.1"]);
    expect(
      syncStore.mock.calls
        .slice(5, 10)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.2", "1.2", "1.2", "1.2", "1.2"]);
    expect(
      syncStore.mock.calls
        .slice(10, 15)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.3", "1.3", "1.3", "1.3", "1.3"]);
    expect(
      syncStore.mock.calls
        .slice(15, 20)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.5", "1.5", "1.5", "1.5", "1.5"]);
    expect(
      syncStore.mock.calls
        .slice(20, 25)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.6", "1.6", "1.6", "1.6", "1.6"]);
    expect(
      syncStore.mock.calls
        .slice(25, 30)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.7", "1.7", "1.7", "1.7", "1.7"]);
    expect(
      syncStore.mock.calls
        .slice(30, 35)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.8", "1.8", "1.8", "1.8", "1.8"]);
    expect(syncStore.mock.calls.slice(35).map((call) => call[0].orgId)).toEqual([
      "1001",
      "1002",
      "1004",
      "1005",
    ]);
    expect(
      syncStore.mock.calls
        .slice(35)
        .map((call) => resolveSelectedEndpoint(call[0].syncPlan?.skipEndpoints)),
    ).toEqual(["1.4", "1.4", "1.4", "1.4"]);
    expect(syncStore.mock.calls.slice(35).map((call) => call[0].syncPlan?.selectedCardIds)).toEqual(
      [
        ["1001-card-1", "1001-card-2"],
        ["1002-card-1"],
        ["1004-card-1", "1004-card-2", "1004-card-3"],
        ["1005-card-1"],
      ],
    );
    expect(sleep).toHaveBeenNthCalledWith(1, 3_000);
  });

  it("stops launching additional daily user-trade syncs when the remaining access window is too short", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      sync: {
        accessWindowEndLocalTime: "04:00",
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
        { orgId: "1003", storeName: "三号店" },
      ],
    });
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolveNow = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-31T03:35:00+08:00"))
      .mockReturnValueOnce(new Date("2026-03-31T03:50:00+08:00"))
      .mockReturnValue(new Date("2026-03-31T03:50:00+08:00"));
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
      resolveNow,
    } as never);

    const candidateCardIdsByOrgId: Record<string, string[]> = {
      "1001": Array.from({ length: 25 }, (_value, index) => `1001-card-${index + 1}`),
      "1002": Array.from({ length: 29 }, (_value, index) => `1002-card-${index + 1}`),
      "1003": Array.from({ length: 32 }, (_value, index) => `1003-card-${index + 1}`),
    };
    (runtime as any).store = buildRuntimeStore({
      listRecentUserTradeCandidateCardIds: vi.fn().mockImplementation(
        async ({ orgId }: { orgId: string }) => candidateCardIdsByOrgId[orgId] ?? [],
      ),
    });

    const lines = await runtime.syncStores({
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(lines).toEqual([
      "一号店: sync partial - user trades deferred",
      "二号店: sync partial - user trades deferred",
      "三号店: sync partial - user trades deferred",
    ]);
    expect(syncStore).toHaveBeenCalledTimes(21);
    expect(syncStore.mock.calls.every((call) => call[0].syncPlan?.selectedCardIds === undefined)).toBe(true);
  });

  it("continues syncing other stores when one store throws unexpectedly", async () => {
    const syncStore = vi.fn().mockImplementation(
      async (params: { orgId: string; syncPlan?: { skipEndpoints?: string[] } }) => {
        const skipEndpoints = params.syncPlan?.skipEndpoints ?? [];
        const selectedEndpoint = (["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"] as const).find(
          (endpoint) => !skipEndpoints.includes(endpoint),
        );
        if (params.orgId === "1002" && selectedEndpoint === "1.1") {
          throw new Error("1.1 wave boom");
        }
      },
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolveNow = vi
      .fn<() => Date>()
      .mockReturnValue(new Date("2026-03-31T03:20:00+08:00"));
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
      resolveNow,
    } as never);

    (runtime as any).store = buildRuntimeStore({
      listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([]),
    });

    const lines = await runtime.syncStores({
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(lines).toEqual([
      "一号店: sync complete",
      "二号店: sync failed - 1.1 wave boom",
      "三号店: sync complete",
      "四号店: sync complete",
      "五号店: sync complete",
    ]);
    expect(syncStore.mock.calls.slice(0, 5).map((call) => call[0].orgId)).toEqual([
      "1001",
      "1002",
      "1003",
      "1004",
      "1005",
    ]);
    expect(syncStore.mock.calls.slice(5).every((call) => call[0].orgId !== "1002")).toBe(true);
    expect(sleep).toHaveBeenNthCalledWith(1, 3_000);
  });

  it("paces March backfill runs store-by-store and week-by-week", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
    } as never);

    (runtime as any).store = buildRuntimeStore({});

    const lines = await runtime.backfillStores({
      orgIds: ["1001", "1002"],
      startBizDate: "2026-03-01",
      endBizDate: "2026-03-10",
      now: new Date("2026-03-31T09:05:00+08:00"),
    });

    expect(lines).toEqual([
      "一号店 2026-03-01..2026-03-07: backfill complete",
      "一号店 2026-03-08..2026-03-10: backfill complete",
      "二号店 2026-03-01..2026-03-07: backfill complete",
      "二号店 2026-03-08..2026-03-10: backfill complete",
    ]);
    expect(syncStore).toHaveBeenCalledTimes(4);
    expect(
      syncStore.mock.calls.map((call) => ({
        orgId: call[0].orgId,
        mode: call[0].syncPlan.mode,
        startTime: call[0].syncPlan.windowOverride.startTime,
        endTime: call[0].syncPlan.windowOverride.endTime,
        skipEndpoints: call[0].syncPlan.skipEndpoints,
      })),
    ).toEqual([
      {
        orgId: "1001",
        mode: "backfill",
        startTime: "2026-03-01 03:00:00",
        endTime: "2026-03-08 02:59:59",
        skipEndpoints: ["1.5", "1.8"],
      },
      {
        orgId: "1001",
        mode: "backfill",
        startTime: "2026-03-08 03:00:00",
        endTime: "2026-03-11 02:59:59",
        skipEndpoints: ["1.5", "1.8"],
      },
      {
        orgId: "1002",
        mode: "backfill",
        startTime: "2026-03-01 03:00:00",
        endTime: "2026-03-08 02:59:59",
        skipEndpoints: ["1.5", "1.8"],
      },
      {
        orgId: "1002",
        mode: "backfill",
        startTime: "2026-03-08 03:00:00",
        endTime: "2026-03-11 02:59:59",
        skipEndpoints: ["1.5", "1.8"],
      },
    ]);
    expect(sleep.mock.calls).toEqual([[5_000], [3_000], [5_000]]);
  });

  it("runs the fixed February 2026 backfill in weekly chunks without parallel bursts", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
    } as never);

    (runtime as any).store = buildRuntimeStore({});

    const lines = await runtime.backfillFebruary2026({
      orgIds: ["1001"],
      now: new Date("2026-04-02T09:05:00+08:00"),
    });

    expect(lines).toEqual([
      "一号店 2026-02-01..2026-02-07: backfill complete",
      "一号店 2026-02-08..2026-02-14: backfill complete",
      "一号店 2026-02-15..2026-02-21: backfill complete",
      "一号店 2026-02-22..2026-02-28: backfill complete",
    ]);
    expect(
      syncStore.mock.calls.map((call) => ({
        orgId: call[0].orgId,
        mode: call[0].syncPlan.mode,
        startTime: call[0].syncPlan.windowOverride.startTime,
        endTime: call[0].syncPlan.windowOverride.endTime,
      })),
    ).toEqual([
      {
        orgId: "1001",
        mode: "backfill",
        startTime: "2026-02-01 03:00:00",
        endTime: "2026-02-08 02:59:59",
      },
      {
        orgId: "1001",
        mode: "backfill",
        startTime: "2026-02-08 03:00:00",
        endTime: "2026-02-15 02:59:59",
      },
      {
        orgId: "1001",
        mode: "backfill",
        startTime: "2026-02-15 03:00:00",
        endTime: "2026-02-22 02:59:59",
      },
      {
        orgId: "1001",
        mode: "backfill",
        startTime: "2026-02-22 03:00:00",
        endTime: "2026-03-01 02:59:59",
      },
    ]);
    expect(sleep.mock.calls).toEqual([[5_000], [5_000], [5_000]]);
  });

  it("summarizes learning outcomes from action-center items", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveNow: () => new Date("2026-04-16T19:00:00+08:00"),
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      getStoreName: vi.fn().mockResolvedValue("一号店"),
      listActionItems: vi.fn().mockResolvedValue([
        {
          actionId: "ACT-1",
          orgId: "1001",
          category: "会员召回",
          title: "回访沉默会员",
          status: "done",
          effectScore: 5,
          sourceKind: "analysis",
          sourceRef: "analysis:JOB-1:1",
        },
        {
          actionId: "ACT-2",
          orgId: "1001",
          category: "会员召回",
          title: "补打回访电话",
          status: "failed",
          effectScore: 2,
          sourceKind: "analysis",
          sourceRef: "analysis:JOB-1:2",
        },
        {
          actionId: "ACT-3",
          orgId: "1001",
          category: "排班优化",
          title: "晚场补位",
          status: "rejected",
          sourceKind: "manual",
        },
        {
          actionId: "ACT-4",
          orgId: "1001",
          category: "营销投放",
          title: "压缩低效投放",
          status: "proposed",
          sourceKind: "analysis",
          sourceRef: "analysis:JOB-3:1",
        },
      ]),
      listAnalysisJobs: vi.fn().mockResolvedValue([
        {
          jobId: "JOB-1",
          orgId: "1001",
          status: "completed",
          attemptCount: 1,
          resultText: JSON.stringify({
            summary: "正常完成",
            orchestration: {
              version: "v1",
              completedStages: ["evidence_pack", "diagnostic_signals", "bounded_synthesis"],
              signalCount: 2,
              stageTrace: [
                {
                  stage: "evidence_pack",
                  status: "completed",
                  detail: "scope=single_store; orgs=1",
                },
                {
                  stage: "diagnostic_signals",
                  status: "completed",
                  detail: "signals=2",
                },
                {
                  stage: "bounded_synthesis",
                  status: "completed",
                  detail: "mode=primary",
                },
              ],
            },
          }),
          startedAt: "2026-03-30T09:00:00.000Z",
          finishedAt: "2026-03-30T09:10:00.000Z",
        },
        {
          jobId: "JOB-2",
          orgId: "1001",
          status: "failed",
          attemptCount: 2,
          startedAt: "2026-03-30T09:20:00.000Z",
          finishedAt: "2026-03-30T09:35:00.000Z",
        },
        {
          jobId: "JOB-3",
          orgId: "1001",
          status: "completed",
          attemptCount: 1,
          resultText: JSON.stringify({
            summary: "发生退化",
            orchestration: {
              version: "v1",
              completedStages: ["evidence_pack", "diagnostic_signals", "action_items"],
              fallbackStage: "bounded_synthesis",
              signalCount: 1,
              stageTrace: [
                {
                  stage: "evidence_pack",
                  status: "completed",
                  detail: "scope=single_store; orgs=1",
                },
                {
                  stage: "diagnostic_signals",
                  status: "completed",
                  detail: "signals=1",
                },
                {
                  stage: "bounded_synthesis",
                  status: "fallback",
                  detail: "mode=scoped_query_fallback; reason=sidecar_missing",
                },
                {
                  stage: "action_items",
                  status: "completed",
                  detail: "derived_from_suggestions=1",
                },
              ],
            },
          }),
          startedAt: "2026-03-30T10:00:00.000Z",
          finishedAt: "2026-03-30T10:08:00.000Z",
        },
      ]),
    });

    await expect(runtime.getLearningSummary({ orgId: "1001" })).resolves.toMatchObject({
      orgId: "1001",
      storeName: "一号店",
      totalActionCount: 4,
      decidedActionCount: 3,
      adoptedActionCount: 2,
      rejectedActionCount: 1,
      doneActionCount: 1,
      failedActionCount: 1,
      adoptionRate: 2 / 3,
      completionRate: 0.5,
      analysisJobCount: 3,
      analysisCompletedCount: 2,
      analysisFailedCount: 1,
      analysisRetriedJobCount: 1,
      analysisCompletionRate: 2 / 3,
      analysisRetryRate: 1 / 3,
      analysisAverageDurationMinutes: 11,
      analysisFallbackCount: 1,
      analysisFallbackRate: 0.5,
      analysisFallbackStageBreakdown: [
        {
          stage: "bounded_synthesis",
          count: 1,
        },
      ],
      analysisAutoActionItemCount: 3,
      analysisActionedJobCount: 2,
      analysisActionConversionRate: 1,
      analysisAverageActionsPerCompletedJob: 1.5,
      topEffectiveCategories: [
        {
          category: "会员召回",
          actionCount: 2,
          averageEffectScore: 3.5,
        },
      ],
    });
  });

  it("applies control-tower analysis overrides before building a report", async () => {
    buildDailyStoreReportMock.mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-03-31",
      metrics: {},
      alerts: [],
      suggestions: [],
      markdown: "一号店日报",
      complete: true,
    });
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveNow: () => new Date("2026-04-16T19:00:00+08:00"),
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      resolveControlTowerSettings: vi.fn().mockResolvedValue({
        "alert.revenueDropThreshold": 0.45,
        "alert.sleepingMemberRateThreshold": 0.4,
      }),
    });

    await runtime.buildReport({
      orgId: "1001",
      bizDate: "2026-03-31",
      now: new Date("2026-04-01T09:00:00+08:00"),
    });

    expect(buildDailyStoreReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-03-31",
        config: expect.objectContaining({
          analysis: expect.objectContaining({
            revenueDropAlertThreshold: 0.45,
            sleepingMemberRateAlertThreshold: 0.4,
          }),
        }),
      }),
    );
  });

  // "reuses cached daily reports" — removed: tested at service level in
  // app/reporting-service.test.ts. This case was bypassing the ReportingService
  // by mocking (runtime as any).store directly, which no longer matches the
  // runtime delegation path.

  it("rebuilds a cached incomplete report once sync coverage catches up", async () => {
    buildDailyStoreReportMock.mockReset();
    const rebuiltReport = {
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-04-04",
      metrics: {},
      alerts: [],
      suggestions: [],
      markdown: "正式日报",
      complete: true,
    };
    buildDailyStoreReportMock.mockResolvedValue(rebuiltReport);

    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveNow: () => new Date("2026-04-16T19:00:00+08:00"),
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const getDailyReport = vi.fn().mockResolvedValue({
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-04-04",
      metrics: {},
      alerts: [{ code: "data-gap", severity: "critical", message: "stale" }],
      suggestions: [],
      markdown: "旧缓存日报",
      complete: false,
    });
    (runtime as any).store = buildRuntimeStore({
      getDailyReport,
      getEndpointWatermarksForOrg: vi.fn().mockResolvedValue({
        "1.1": "2026-04-04T19:10:15.121Z",
        "1.2": "2026-04-04T19:10:15.121Z",
        "1.3": "2026-04-04T19:10:15.121Z",
        "1.4": "2026-04-04T19:10:15.121Z",
        "1.5": "2026-04-04T19:10:15.121Z",
        "1.6": "2026-04-04T19:10:15.121Z",
        "1.7": "2026-04-04T19:10:15.121Z",
        "1.8": "2026-04-04T19:10:15.121Z",
      }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    });

    await expect(
      runtime.buildReport({
        orgId: "1001",
        bizDate: "2026-04-04",
        now: new Date("2026-04-05T12:00:00+08:00"),
      }),
    ).resolves.toMatchObject(rebuiltReport);

    expect(getDailyReport).toHaveBeenCalledWith("1001", "2026-04-04");
    expect(buildDailyStoreReportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-04-04",
      }),
    );
  });

  it("enqueues deep-analysis jobs with delivery metadata", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const createAnalysisJob = vi.fn().mockResolvedValue(undefined);
    const findReusableAnalysisJob = vi.fn().mockResolvedValue(null);
    const getStoreName = vi.fn().mockResolvedValue("一号店");
    (runtime as any).store = buildRuntimeStore({
      countPendingAnalysisJobsByOrg: vi.fn().mockResolvedValue(0),
      createAnalysisJob,
      findReusableAnalysisJob,
      getStoreName,
    });

    const job = await runtime.enqueueAnalysisJob({
      capabilityId: "store_review_async_v1",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      notification: {
        channel: "wecom",
        target: "conversation-1",
        accountId: "default",
        threadId: "thread-1",
      },
      senderId: "zhangsan",
      createdAt: "2026-03-30T09:00:00.000Z",
    });

    expect(createAnalysisJob).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: "store_review_async_v1",
        jobType: "store_review",
        orgId: "1001",
        timeFrameLabel: "近7天",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
        channel: "wecom",
        target: "conversation-1",
        accountId: "default",
        threadId: "thread-1",
        senderId: "zhangsan",
        status: "pending",
      }),
    );
    expect(job).toMatchObject({
      capabilityId: "store_review_async_v1",
      orgId: "1001",
      storeName: "一号店",
      status: "pending",
    });
  });

  it("reuses an existing pending analysis job for the same store and time window", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const createAnalysisJob = vi.fn().mockResolvedValue(undefined);
    const findReusableAnalysisJob = vi.fn().mockResolvedValue({
      jobId: "ANL-EXISTING",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "pending",
      attemptCount: 0,
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:00:00.000Z",
    });
    const getStoreName = vi.fn().mockResolvedValue("一号店");
    (runtime as any).store = buildRuntimeStore({
      countPendingAnalysisJobsByOrg: vi.fn().mockResolvedValue(0),
      createAnalysisJob,
      findReusableAnalysisJob,
      getStoreName,
    });

    const job = await runtime.enqueueAnalysisJob({
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      notification: {
        channel: "wecom",
        target: "conversation-2",
      },
      senderId: "zhangsan",
      createdAt: "2026-03-30T09:10:00.000Z",
    });

    expect(findReusableAnalysisJob).toHaveBeenCalledWith({
      jobType: "store_review",
      orgId: "1001",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
    });
    expect(createAnalysisJob).not.toHaveBeenCalled();
    expect(job).toMatchObject({
      jobId: "ANL-EXISTING",
      status: "pending",
      queueDisposition: "reused-pending",
    });
  });

  it("rejects deep-analysis enqueue when org-level pending queue is over limit", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      countPendingAnalysisJobsByOrg: vi.fn().mockResolvedValue(20),
    });

    await expect(
      runtime.enqueueAnalysisJob({
        jobType: "store_review",
        orgId: "1001",
        rawText: "一号店近7天经营复盘",
        timeFrameLabel: "近7天",
        startBizDate: "2026-03-23",
        endBizDate: "2026-03-29",
        notification: {
          channel: "wecom",
          target: "conversation-1",
        },
      }),
    ).rejects.toMatchObject({
      code: "HETANG_ANALYSIS_QUEUE_LIMIT",
      orgId: "1001",
      pendingCount: 20,
      limit: 20,
    });
  });

  it("reuses a completed analysis result instead of creating another job", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const createAnalysisJob = vi.fn().mockResolvedValue(undefined);
    const findReusableAnalysisJob = vi.fn().mockResolvedValue({
      jobId: "ANL-DONE",
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      channel: "wecom",
      target: "conversation-1",
      status: "completed",
      attemptCount: 1,
      resultText: "七日复盘结论",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:05:00.000Z",
      finishedAt: "2026-03-30T09:05:00.000Z",
      deliveredAt: "2026-03-30T09:06:00.000Z",
    });
    const getStoreName = vi.fn().mockResolvedValue("一号店");
    (runtime as any).store = buildRuntimeStore({
      countPendingAnalysisJobsByOrg: vi.fn().mockResolvedValue(0),
      createAnalysisJob,
      findReusableAnalysisJob,
      getStoreName,
    });

    const job = await runtime.enqueueAnalysisJob({
      jobType: "store_review",
      orgId: "1001",
      rawText: "一号店近7天经营复盘",
      timeFrameLabel: "近7天",
      startBizDate: "2026-03-23",
      endBizDate: "2026-03-29",
      notification: {
        channel: "wecom",
        target: "conversation-9",
      },
      senderId: "lisi",
      createdAt: "2026-03-30T09:10:00.000Z",
    });

    expect(createAnalysisJob).not.toHaveBeenCalled();
    expect(job).toMatchObject({
      jobId: "ANL-DONE",
      status: "completed",
      resultText: "七日复盘结论",
      queueDisposition: "reused-completed",
    });
  });

  // "runs the CrewAI sidecar for queued reviews" — removed: tested at service
  // level in app/analysis-service.test.ts and analysis-orchestrator.test.ts.
  // These cases were bypassing the AnalysisService/Orchestrator delegation by
  // mocking (runtime as any).store directly.
  //
  // Removed cases:
  //   - runs the CrewAI sidecar for queued reviews and sends the result back
  //   - passes control-tower analysis.reviewMode to the CrewAI sidecar env
  //   - uses a boss-style completion summary for HQ portfolio-style async replies
  //   - auto-creates action-center items from analysis suggestions
  //   - auto-creates action-center items from structured analysis payload and caps the action count
  //   - falls back to current operating priorities when the analysis has no explicit suggestion section
  //   - suppresses failed analysis auto-replies when analysis.notifyOnFailure=false
  //   - records a readable timeout reason when the CrewAI sidecar is killed before exit
  //   - sanitizes upstream provider failures before notifying WeCom

  it("plans coverage-aware nightly backfill from raw fact gaps", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [{ orgId: "1001", storeName: "一号店" }],
    });
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolveNow = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-31T03:12:00+08:00"))
      .mockReturnValueOnce(new Date("2026-03-31T04:01:00+08:00"));
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
      resolveNow,
    } as never);

    const now = new Date("2026-03-31T03:12:00+08:00");
    const anchorEndBizDate = resolveReportBizDate({
      now,
      timeZone: config.timeZone,
      cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
    });
    const anchorStartBizDate = shiftBizDate(
      anchorEndBizDate,
      -(config.sync.historyBackfillDays - 1),
    );
    const recentPriorityStartBizDate = shiftBizDate(anchorEndBizDate, -29);

    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      setScheduledJobState: vi.fn().mockResolvedValue(undefined),
      getHistoricalCoverageSnapshot: vi.fn().mockResolvedValue({
        orgId: "1001",
        startBizDate: anchorStartBizDate,
        endBizDate: anchorEndBizDate,
        rawFacts: {
          "1.2": {
            rowCount: 500,
            dayCount: 180,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.3": {
            rowCount: 120,
            dayCount: 180,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.4": {
            rowCount: 40,
            dayCount: 12,
            minBizDate: "2026-03-20",
            maxBizDate: anchorEndBizDate,
          },
          "1.6": {
            rowCount: 700,
            dayCount: 180,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.7": {
            rowCount: 0,
            dayCount: 0,
          },
        },
        derivedLayers: {},
      }),
    });

    const lines = await (runtime as any).runNightlyHistoryBackfill(now);

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "backfill",
        skipEndpoints: ["1.1", "1.2", "1.3", "1.5", "1.6", "1.8"],
        windowOverride: {
          startTime: `${recentPriorityStartBizDate} 03:00:00`,
          endTime: `${shiftBizDate(recentPriorityStartBizDate, 21)} 02:59:59`,
        },
      },
    });
    expect(lines).toEqual([
      `一号店 ${recentPriorityStartBizDate}..${shiftBizDate(recentPriorityStartBizDate, 20)}: nightly backfill complete`,
    ]);
  });

  it("keeps scheduling nightly backfill when raw fact spans look complete but distinct biz dates are sparse", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [{ orgId: "1001", storeName: "一号店" }],
    });
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolveNow = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-31T03:12:00+08:00"))
      .mockReturnValueOnce(new Date("2026-03-31T04:01:00+08:00"));
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
      resolveNow,
    } as never);

    const now = new Date("2026-03-31T03:12:00+08:00");
    const anchorEndBizDate = resolveReportBizDate({
      now,
      timeZone: config.timeZone,
      cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
    });
    const anchorStartBizDate = shiftBizDate(
      anchorEndBizDate,
      -(config.sync.historyBackfillDays - 1),
    );
    const recentPriorityStartBizDate = shiftBizDate(anchorEndBizDate, -29);

    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      setScheduledJobState: vi.fn().mockResolvedValue(undefined),
      getHistoricalCoverageSnapshot: vi.fn().mockResolvedValue({
        orgId: "1001",
        startBizDate: anchorStartBizDate,
        endBizDate: anchorEndBizDate,
        rawFacts: {
          "1.2": {
            rowCount: 500,
            dayCount: 58,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.3": {
            rowCount: 120,
            dayCount: 53,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.6": {
            rowCount: 700,
            dayCount: 60,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.4": {
            rowCount: 200,
            dayCount: config.sync.historyBackfillDays,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.7": {
            rowCount: 180,
            dayCount: config.sync.historyBackfillDays,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
        },
        derivedLayers: {},
      }),
    });

    const lines = await (runtime as any).runNightlyHistoryBackfill(now);

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "backfill",
        windowOverride: {
          startTime: `${anchorStartBizDate} 03:00:00`,
        },
      },
    });
    expect(lines).toEqual([
      `一号店 ${anchorStartBizDate}..${shiftBizDate(anchorStartBizDate, 6)}: nightly backfill complete`,
    ]);
  });

  it("backfills deferred large-store user trades while still repairing other raw-fact gaps", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [{ orgId: "1001", storeName: "一号店" }],
    });
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolveNow = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-31T03:12:00+08:00"))
      .mockReturnValueOnce(new Date("2026-03-31T04:01:00+08:00"));
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
      resolveNow,
    } as never);

    const now = new Date("2026-03-31T03:12:00+08:00");
    const anchorEndBizDate = resolveReportBizDate({
      now,
      timeZone: config.timeZone,
      cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
    });
    const anchorStartBizDate = shiftBizDate(
      anchorEndBizDate,
      -(config.sync.historyBackfillDays - 1),
    );
    const recentPriorityStartBizDate = shiftBizDate(anchorEndBizDate, -29);

    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      setScheduledJobState: vi.fn().mockResolvedValue(undefined),
      getHistoricalCoverageSnapshot: vi.fn().mockResolvedValue({
        orgId: "1001",
        startBizDate: anchorStartBizDate,
        endBizDate: anchorEndBizDate,
        rawFacts: {
          "1.2": {
            rowCount: 40,
            dayCount: 12,
            minBizDate: "2026-03-20",
            maxBizDate: anchorEndBizDate,
          },
          "1.3": {
            rowCount: 120,
            dayCount: config.sync.historyBackfillDays,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.4": {
            rowCount: 40,
            dayCount: 12,
            minBizDate: "2026-03-20",
            maxBizDate: anchorEndBizDate,
          },
          "1.6": {
            rowCount: 700,
            dayCount: config.sync.historyBackfillDays,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
          "1.7": {
            rowCount: 180,
            dayCount: config.sync.historyBackfillDays,
            minBizDate: anchorStartBizDate,
            maxBizDate: anchorEndBizDate,
          },
        },
        derivedLayers: {},
      }),
      listMemberCardIds: vi.fn().mockResolvedValue(
        Array.from({ length: 500 }, (_value, index) => `card-${index}`),
      ),
      listRecentUserTradeCandidateCardIds: vi
        .fn()
        .mockResolvedValue(["recent-card-001", "recent-card-002"]),
    });

    const lines = await (runtime as any).runNightlyHistoryBackfill(now);

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "backfill",
        skipEndpoints: ["1.1", "1.3", "1.5", "1.6", "1.7", "1.8"],
        selectedCardIds: ["recent-card-001", "recent-card-002"],
        windowOverride: {
          startTime: `${recentPriorityStartBizDate} 03:00:00`,
          endTime: `${shiftBizDate(recentPriorityStartBizDate, 7)} 02:59:59`,
        },
      },
    });
    expect(lines).toEqual([
      `一号店 ${recentPriorityStartBizDate}..${shiftBizDate(recentPriorityStartBizDate, 6)}: nightly backfill complete`,
    ]);
  });
});

describe("HetangOpsRuntime serving query helpers", () => {
  it("proxies serving version lookup and caches compiled serving query rows by cache key", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([
        { org_id: "1001", store_name: "一号店", biz_date: "2026-04-07", service_revenue: 3200 },
      ]),
    });

    await expect(runtime.getCurrentServingVersion()).resolves.toBe("serving-v1");
    await expect(
      runtime.executeCompiledServingQuery({
        sql: "SELECT * FROM serving_store_day WHERE org_id = $1 AND biz_date = $2",
        queryParams: ["1001", "2026-04-07"],
        cacheKey: "serving-v1:test",
        ttlSeconds: 60,
      }),
    ).resolves.toEqual([
      { org_id: "1001", store_name: "一号店", biz_date: "2026-04-07", service_revenue: 3200 },
    ]);

    await runtime.executeCompiledServingQuery({
      sql: "SELECT * FROM serving_store_day WHERE org_id = $1 AND biz_date = $2",
      queryParams: ["1001", "2026-04-07"],
      cacheKey: "serving-v1:test",
      ttlSeconds: 60,
    });

    expect((runtime as any).store.executeCompiledServingQuery).toHaveBeenCalledTimes(1);
  });
});

describe("HetangOpsRuntime query read helpers", () => {
  it("routes tech leaderboard reads through the query-read service path", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      listTechUpClockByDateRange: vi.fn().mockResolvedValue([
        {
          personCode: "T001",
          personName: "小李",
          count: 2,
          clockType: "点钟",
          turnover: 300,
          comm: 120,
          rawJson: JSON.stringify({ AddClockType: 1, ClockType: 2 }),
        },
      ]),
      listTechMarketByDateRange: vi.fn().mockResolvedValue([
        {
          personCode: "T001",
          personName: "小李",
          afterDisc: 66,
          commission: 15,
        },
      ]),
    });

    await expect(
      runtime.listTechLeaderboard({
        orgId: "1001",
        startBizDate: "2026-04-01",
        endBizDate: "2026-04-07",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        personCode: "T001",
        personName: "小李",
        totalClockCount: 2,
        pointClockRate: 1,
        addClockRate: 1,
        marketRevenue: 66,
        marketCommission: 15,
      }),
    ]);
  });
});

describe("HetangOpsRuntime.runDueJobs", () => {
  it("runs nightly conversation review once the review checkpoint is due", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const runNightlyConversationReview = vi
      .fn()
      .mockResolvedValue(["conversation review completed"]);
    (runtime as any).runNightlyConversationReview = runNightlyConversationReview;
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-31",
            "nightly-history-backfill:2026-03-31",
            "run-customer-history-catchup:2026-03-30",
          ]),
        ),
      markScheduledJobCompleted: vi.fn().mockResolvedValue(undefined),
    });

    const now = new Date("2026-03-31T04:20:00+08:00");
    const lines = await runtime.runDueJobs(now);

    expect(lines).toContain("conversation review completed");
    expect(runNightlyConversationReview).toHaveBeenCalledWith(now);
  });

  it("routes scheduled environment memory builds through the dedicated owner service before reports", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const buildAllStoreEnvironmentMemory = vi
      .fn()
      .mockResolvedValue(["2026-03-30 store environment memory built"]);
    const buildAllReports = vi.fn().mockResolvedValue([]);
    (runtime as any).buildAllStoreEnvironmentMemory = buildAllStoreEnvironmentMemory;
    (runtime as any).getReportingService = vi.fn().mockReturnValue({
      buildAllReports,
    });
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-31",
            "nightly-history-backfill:2026-03-31",
            "run-customer-history-catchup:2026-03-30",
            "nightly-conversation-review:2026-03-31",
          ]),
        ),
      markScheduledJobCompleted: vi.fn().mockResolvedValue(undefined),
    });

    const now = new Date("2026-03-31T08:55:00+08:00");
    const lines = await runtime.runDueJobs(now);

    expect(lines).toContain("2026-03-30 store environment memory built");
    expect(buildAllStoreEnvironmentMemory).toHaveBeenCalledWith({
      bizDate: "2026-03-30",
      now,
    });
    expect(buildAllReports).toHaveBeenCalledWith({
      bizDate: "2026-03-30",
      now,
    });
  });

  it("runs the nightly api depth probe inside sync and keeps history backfill as a separate due job", async () => {
    const config = buildConfig();
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const syncStores = vi.fn().mockResolvedValue(["sync ok"]);
    const runNightlyHistoryBackfill = vi.fn().mockResolvedValue(["backfill ok"]);
    const runNightlyApiHistoryDepthProbe = vi.fn().mockResolvedValue(["probe ok"]);
    const publishNightlyServingViews = vi.fn().mockResolvedValue(undefined);
    (runtime as any).syncStores = syncStores;
    (runtime as any).runNightlyHistoryBackfill = runNightlyHistoryBackfill;
    (runtime as any).runNightlyApiHistoryDepthProbe = runNightlyApiHistoryDepthProbe;
    (runtime as any).publishNightlyServingViews = publishNightlyServingViews;
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set()),
      markScheduledJobCompleted: vi.fn().mockResolvedValue(undefined),
    });

    const now = new Date("2026-03-31T03:12:00+08:00");
    const lines = await runtime.runDueJobs(now);

    expect(lines).toEqual(["sync ok", "probe ok", "backfill ok"]);
    expect(syncStores).toHaveBeenCalledWith({ now, publishAnalytics: false });
    expect(runNightlyHistoryBackfill).toHaveBeenCalledWith(now, {
      publishAnalytics: true,
      maxPasses: 1,
      maxPlans: 1,
    });
    expect(runNightlyApiHistoryDepthProbe).toHaveBeenCalledWith(now);
    expect(publishNightlyServingViews).toHaveBeenCalledWith(now);
  });

  it("logs nightly phase timing summaries for sync, backfill, probe, and serving publish", async () => {
    const info = vi.fn();
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info,
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).syncStores = vi.fn().mockResolvedValue([
      "一号店: sync complete",
      "二号店: sync partial - user trades deferred",
      "三号店: sync failed - timeout",
    ]);
    (runtime as any).runNightlyHistoryBackfill = vi.fn().mockResolvedValue([
      "一号店 2026-03-01..2026-03-07: nightly backfill complete",
      "二号店 2026-03-01..2026-03-07: nightly backfill complete",
    ]);
    (runtime as any).runNightlyApiHistoryDepthProbe = vi
      .fn()
      .mockResolvedValue([
        "API历史探针 一号店: 1.1>=365d, 1.2>=180d, 1.3=skipped, 1.4=card-scoped, 1.5=current-only, 1.6=error, 1.7=no-data, 1.8=current-only",
      ]);
    (runtime as any).publishNightlyServingViews = vi.fn().mockResolvedValue(undefined);
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set()),
      markScheduledJobCompleted: vi.fn().mockResolvedValue(undefined),
    });

    await runtime.runDueJobs(new Date("2026-03-31T03:12:00+08:00"));

    const messages = info.mock.calls.map((call) => String(call[0] ?? ""));
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining("nightly phase sync"),
        expect.stringContaining("complete=1"),
        expect.stringContaining("partial=1"),
        expect.stringContaining("failed=1"),
        expect.stringContaining("nightly phase backfill"),
        expect.stringContaining("slices=2"),
        expect.stringContaining("nightly phase probe"),
        expect.stringContaining("confirmed=2"),
        expect.stringContaining("skipped=1"),
        expect.stringContaining("error=1"),
        expect.stringContaining("nightly phase publish"),
        expect.stringContaining("nightly window complete"),
      ]),
    );
  });

  it("records the deepest confirmed api history window in scheduled job state", async () => {
    const now = new Date("2026-04-10T03:20:00+08:00");
    const anchorEndBizDate = resolveReportBizDate({
      now,
      timeZone: buildConfig().timeZone,
      cutoffLocalTime: buildConfig().sync.businessDayCutoffLocalTime,
    });
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      resolveNow: vi.fn().mockReturnValue(new Date("2026-04-10T03:20:00+08:00")),
      sleep: vi.fn().mockResolvedValue(undefined),
      createApiClient: vi.fn().mockReturnValue({
        fetchPaged: vi.fn().mockImplementation(async (endpoint: string, params: Record<string, unknown>) => {
          const start = String(params.Stime ?? "");
          if (endpoint === "1.1" && start.startsWith(`${shiftBizDate(anchorEndBizDate, -365)} 03:00:00`)) {
            return [{ Id: "member-1" }];
          }
          if (endpoint === "1.2" && start.startsWith(`${shiftBizDate(anchorEndBizDate, -180)} 03:00:00`)) {
            return [{ SettleId: "consume-1" }];
          }
          if (endpoint === "1.3" && start.startsWith(`${shiftBizDate(anchorEndBizDate, -90)} 03:00:00`)) {
            return [{ Id: "recharge-1" }];
          }
          return [];
        }),
        fetchTechUpClockList: vi.fn().mockImplementation(async (params: Record<string, unknown>) => {
          const start = String(params.Stime ?? "");
          if (start.startsWith(`${shiftBizDate(anchorEndBizDate, -180)} 03:00:00`)) {
            return [{ PersonCode: "T001" }];
          }
          return [];
        }),
        fetchTechMarketList: vi.fn().mockImplementation(async (params: Record<string, unknown>) => {
          const start = String(params.Stime ?? "");
          if (start.startsWith(`${shiftBizDate(anchorEndBizDate, -30)} 03:00:00`)) {
            return [{ Id: "market-1" }];
          }
          return [];
        }),
      }),
    } as never);

    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    (runtime as any).store = buildRuntimeStore({
      setScheduledJobState,
    });

    const lines = await (runtime as any).runNightlyApiHistoryDepthProbe(now);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("API历史探针");
    expect(lines[0]).toContain("1.1>=365d");
    expect(lines[0]).toContain("1.2>=180d");
    expect(lines[0]).toContain("1.4=card-scoped");
    expect(lines[0]).toContain("1.5=current-only");
    expect(setScheduledJobState).toHaveBeenCalledWith(
      "nightly-api-depth-probe",
      "latest",
      expect.objectContaining({
        orgId: "1001",
        anchorBizDate: anchorEndBizDate,
        endpoints: expect.objectContaining({
          "1.1": expect.objectContaining({
            status: "confirmed",
            confirmedLookbackDays: 365,
          }),
          "1.2": expect.objectContaining({
            status: "confirmed",
            confirmedLookbackDays: 180,
          }),
          "1.4": expect.objectContaining({
            status: "card-scoped",
          }),
          "1.5": expect.objectContaining({
            status: "current-only",
          }),
        }),
      }),
      now.toISOString(),
    );
  });

  it("keeps scheduled daily sync incremental and continues historical slices while the window stays open", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const resolveNow = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-03-31T03:12:00+08:00"))
      .mockReturnValueOnce(new Date("2026-03-31T03:20:00+08:00"))
      .mockReturnValueOnce(new Date("2026-03-31T03:35:00+08:00"))
      .mockReturnValueOnce(new Date("2026-03-31T04:01:00+08:00"));
    const config = buildConfig();
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
      sleep,
      resolveNow,
    } as never);
    (runtime as any).runNightlyApiHistoryDepthProbe = vi.fn().mockResolvedValue([
      "API历史探针 一号店: 1.1=skipped, 1.2=skipped, 1.3=skipped, 1.4=card-scoped, 1.5=current-only, 1.6=skipped, 1.7=skipped, 1.8=current-only",
    ]);

    const listCompletedRunKeys = vi.fn().mockResolvedValue(new Set());
    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const getScheduledJobState = vi.fn().mockResolvedValue(null);
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys,
      markScheduledJobCompleted,
      getScheduledJobState,
      setScheduledJobState,
    });

    const now = new Date("2026-03-31T03:12:00+08:00");
    const lines = await runtime.runDueJobs(now);
    const anchorEndBizDate = resolveReportBizDate({
      now,
      timeZone: config.timeZone,
      cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
    });
    const anchorStartBizDate = shiftBizDate(
      anchorEndBizDate,
      -(config.sync.historyBackfillDays - 1),
    );
    expect(lines).toEqual([
      "一号店: sync complete",
      "二号店: sync complete",
      "三号店: sync complete",
      "四号店: sync complete",
      "五号店: sync complete",
      "API历史探针 一号店: 1.1=skipped, 1.2=skipped, 1.3=skipped, 1.4=card-scoped, 1.5=current-only, 1.6=skipped, 1.7=skipped, 1.8=current-only",
      `一号店 ${anchorStartBizDate}..${shiftBizDate(anchorStartBizDate, 6)}: nightly backfill complete`,
      `二号店 ${anchorStartBizDate}..${shiftBizDate(anchorStartBizDate, 6)}: nightly backfill complete`,
      `三号店 ${anchorStartBizDate}..${shiftBizDate(anchorStartBizDate, 6)}: nightly backfill complete`,
      `四号店 ${anchorStartBizDate}..${shiftBizDate(anchorStartBizDate, 6)}: nightly backfill complete`,
      `五号店 ${anchorStartBizDate}..${shiftBizDate(anchorStartBizDate, 6)}: nightly backfill complete`,
    ]);
    expect(syncStore).toHaveBeenCalledTimes(40);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "daily",
        skipEndpoints: ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"],
      },
    });
    expect(syncStore.mock.calls[35]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "backfill",
        skipEndpoints: ["1.5", "1.8"],
        windowOverride: {
          startTime: `${anchorStartBizDate} 03:00:00`,
          endTime: `${shiftBizDate(anchorStartBizDate, 7)} 02:59:59`,
        },
      },
    });
    expect(syncStore.mock.calls[39]?.[0]).toMatchObject({
      orgId: "1005",
      syncPlan: {
        mode: "backfill",
      },
    });
    expect(
      sleep.mock.calls.some((call) => call[0] === 3_000),
    ).toBe(true);
    expect(getScheduledJobState).toHaveBeenCalledWith("nightly-history-backfill", "default");
    expect(setScheduledJobState).toHaveBeenCalled();
    expect(markScheduledJobCompleted).toHaveBeenCalledWith("sync", "2026-03-31", now.toISOString());
  });

  it("marks the unified history backfill job complete after a bounded pass finds no remaining work", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const runNightlyHistoryBackfill = vi.fn().mockResolvedValue([]);
    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    (runtime as any).runNightlyHistoryBackfill = runNightlyHistoryBackfill;
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-30",
            "nightly-conversation-review:2026-03-30",
            "build-store-environment-memory:2026-03-29",
            "build-report:2026-03-29",
            "audit-daily-report-window:2026-03-29",
            "send-report:2026-03-29",
            "run-customer-history-catchup:2026-03-29",
          ]),
        ),
      markScheduledJobCompleted,
    });

    const now = new Date("2026-03-30T10:05:00+08:00");
    const lines = await runtime.runDueJobs(now);

    expect(lines).toEqual(buildSkippedSharedDeliveryLines("2026-03-29"));
    expect(runNightlyHistoryBackfill).toHaveBeenCalledWith(now, {
      publishAnalytics: true,
      maxPasses: 1,
      maxPlans: 1,
    });
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "nightly-history-backfill",
      "2026-03-30",
      now.toISOString(),
    );
  });

  it("skips due jobs when another process already holds the scheduled runner lease", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
      syncStore,
    } as never);

    const tryAdvisoryLock = vi.fn().mockResolvedValue(false);
    const releaseAdvisoryLock = vi.fn().mockResolvedValue(undefined);
    const listCompletedRunKeys = vi.fn().mockResolvedValue(new Set());
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock,
      releaseAdvisoryLock,
      listCompletedRunKeys,
    });

    const lines = await runtime.runDueJobs(new Date("2026-03-31T03:12:00+08:00"));

    expect(lines).toEqual([]);
    expect(tryAdvisoryLock).toHaveBeenCalledTimes(1);
    expect(listCompletedRunKeys).not.toHaveBeenCalled();
    expect(syncStore).not.toHaveBeenCalled();
    expect(releaseAdvisoryLock).not.toHaveBeenCalled();
  });

  it("runs local customer history catchup inside the app scheduler and marks completion once all stores finish", async () => {
    rebuildMemberDailySnapshotsForDateRangeMock.mockReset();
    rebuildCustomerIntelligenceForDateRangeMock.mockReset();
    rebuildMemberReactivationFeaturesForDateRangeMock.mockReset();
    rebuildMemberReactivationStrategiesForDateRangeMock.mockReset();
    rebuildMemberReactivationQueueForDateRangeMock.mockReset();
    rebuildMemberDailySnapshotsForDateRangeMock.mockResolvedValue(180);
    rebuildCustomerIntelligenceForDateRangeMock.mockResolvedValue(180);
    rebuildMemberReactivationFeaturesForDateRangeMock.mockResolvedValue(180);
    rebuildMemberReactivationStrategiesForDateRangeMock.mockResolvedValue(180);
    rebuildMemberReactivationQueueForDateRangeMock.mockResolvedValue(180);

    const config = buildConfig();
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const forceRebuildAnalyticsViews = vi.fn().mockResolvedValue(undefined);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set(["sync:2026-03-31"])),
      markScheduledJobCompleted,
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      forceRebuildAnalyticsViews,
    });

    const now = new Date("2026-03-31T04:06:00+08:00");
    const endBizDate = resolveReportBizDate({
      now,
      timeZone: config.timeZone,
      cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
    });
    const startBizDate = shiftBizDate(endBizDate, -(config.sync.historyBackfillDays - 1));

    const lines = await runtime.runDueJobs(now);

    expect(lines).toEqual([
      `一号店: customer history catchup complete (${startBizDate}..${endBizDate})`,
      `二号店: customer history catchup complete (${startBizDate}..${endBizDate})`,
      `三号店: customer history catchup complete (${startBizDate}..${endBizDate})`,
      `四号店: customer history catchup complete (${startBizDate}..${endBizDate})`,
      `五号店: customer history catchup complete (${startBizDate}..${endBizDate})`,
    ]);
    expect(rebuildMemberDailySnapshotsForDateRangeMock).toHaveBeenCalledTimes(5);
    expect(rebuildCustomerIntelligenceForDateRangeMock).toHaveBeenCalledTimes(5);
    expect(rebuildMemberReactivationFeaturesForDateRangeMock).toHaveBeenCalledTimes(5);
    expect(rebuildMemberReactivationStrategiesForDateRangeMock).toHaveBeenCalledTimes(5);
    expect(rebuildMemberReactivationQueueForDateRangeMock).toHaveBeenCalledTimes(5);
    expect(rebuildMemberDailySnapshotsForDateRangeMock).toHaveBeenNthCalledWith(1, {
      store: (runtime as any).store,
      orgId: "1001",
      startBizDate,
      endBizDate,
    });
    expect(rebuildCustomerIntelligenceForDateRangeMock).toHaveBeenNthCalledWith(1, {
      store: (runtime as any).store,
      orgId: "1001",
      startBizDate,
      endBizDate,
      refreshViews: false,
      chunkDays: 14,
      storeConfig: config.stores[0],
    });
    expect(rebuildMemberReactivationFeaturesForDateRangeMock).toHaveBeenNthCalledWith(1, {
      store: (runtime as any).store,
      orgId: "1001",
      startBizDate,
      endBizDate,
      refreshViews: false,
    });
    expect(rebuildMemberReactivationStrategiesForDateRangeMock).toHaveBeenNthCalledWith(1, {
      store: (runtime as any).store,
      orgId: "1001",
      startBizDate,
      endBizDate,
      refreshViews: false,
      storeConfig: config.stores[0],
    });
    expect(rebuildMemberReactivationQueueForDateRangeMock).toHaveBeenNthCalledWith(1, {
      store: (runtime as any).store,
      orgId: "1001",
      startBizDate,
      endBizDate,
      refreshViews: false,
      storeConfig: config.stores[0],
    });
    expect(forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "run-customer-history-catchup",
      "2026-03-30",
      now.toISOString(),
    );
  });

  it("rebuilds customer history only for stores whose derived coverage still lags", async () => {
    rebuildMemberDailySnapshotsForDateRangeMock.mockReset();
    rebuildCustomerIntelligenceForDateRangeMock.mockReset();
    rebuildMemberReactivationFeaturesForDateRangeMock.mockReset();
    rebuildMemberReactivationStrategiesForDateRangeMock.mockReset();
    rebuildMemberReactivationQueueForDateRangeMock.mockReset();
    rebuildMemberDailySnapshotsForDateRangeMock.mockResolvedValue(180);
    rebuildCustomerIntelligenceForDateRangeMock.mockResolvedValue(180);
    rebuildMemberReactivationFeaturesForDateRangeMock.mockResolvedValue(180);
    rebuildMemberReactivationStrategiesForDateRangeMock.mockResolvedValue(180);
    rebuildMemberReactivationQueueForDateRangeMock.mockResolvedValue(180);

    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
        { orgId: "1003", storeName: "三号店" },
      ],
    });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    const scheduledJobState = new Map<string, Record<string, unknown>>();
    const forceRebuildAnalyticsViews = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-03-31T04:06:00+08:00");
    const endBizDate = resolveReportBizDate({
      now,
      timeZone: config.timeZone,
      cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
    });
    const startBizDate = shiftBizDate(endBizDate, -(config.sync.historyBackfillDays - 1));

    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      forceRebuildAnalyticsViews,
      getHistoricalCoverageSnapshot: vi
        .fn()
        .mockImplementation(async ({ orgId }: { orgId: string }) => ({
          orgId,
          startBizDate,
          endBizDate,
          rawFacts: {
            "1.2": {
              rowCount: 400,
              dayCount: 180,
              minBizDate: startBizDate,
              maxBizDate: endBizDate,
            },
            "1.3": {
              rowCount: 100,
              dayCount: 180,
              minBizDate: startBizDate,
              maxBizDate: endBizDate,
            },
            "1.6": {
              rowCount: 500,
              dayCount: 180,
              minBizDate: startBizDate,
              maxBizDate: endBizDate,
            },
          },
          derivedLayers:
            orgId === "1001"
              ? {
                  factMemberDailySnapshot: {
                    rowCount: 180,
                    dayCount: 180,
                    minBizDate: startBizDate,
                    maxBizDate: endBizDate,
                  },
                  martCustomerSegments: {
                    rowCount: 180,
                    dayCount: 180,
                    minBizDate: startBizDate,
                    maxBizDate: endBizDate,
                  },
                  martCustomerConversionCohorts: {
                    rowCount: 60,
                    dayCount: 60,
                    minBizDate: startBizDate,
                    maxBizDate: endBizDate,
                  },
                  mvCustomerProfile90d: {
                    rowCount: 180,
                    dayCount: 180,
                    minBizDate: startBizDate,
                    maxBizDate: endBizDate,
                  },
                }
              : {
                  factMemberDailySnapshot: {
                    rowCount: 7,
                    dayCount: 7,
                    minBizDate: "2026-03-25",
                    maxBizDate: endBizDate,
                  },
                  martCustomerSegments: {
                    rowCount: 7,
                    dayCount: 7,
                    minBizDate: "2026-03-25",
                    maxBizDate: endBizDate,
                  },
                  martCustomerConversionCohorts: {
                    rowCount: 7,
                    dayCount: 7,
                    minBizDate: "2026-03-25",
                    maxBizDate: endBizDate,
                  },
                  mvCustomerProfile90d: {
                    rowCount: 7,
                    dayCount: 7,
                    minBizDate: "2026-03-25",
                    maxBizDate: endBizDate,
                  },
                },
        })),
    });

    const result = await runtime.runCustomerHistoryCatchup({
      bizDate: endBizDate,
      now,
    });

    expect(result.lines).toEqual([
      `一号店: customer history catchup already complete (${startBizDate}..${endBizDate})`,
      `二号店: customer history catchup complete (${startBizDate}..${endBizDate})`,
      `三号店: customer history catchup complete (${startBizDate}..${endBizDate})`,
    ]);
    expect(rebuildMemberDailySnapshotsForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildCustomerIntelligenceForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildMemberReactivationFeaturesForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildMemberReactivationStrategiesForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildMemberReactivationQueueForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildMemberDailySnapshotsForDateRangeMock).toHaveBeenNthCalledWith(1, {
      store: (runtime as any).store,
      orgId: "1002",
      startBizDate,
      endBizDate,
    });
    expect(rebuildCustomerIntelligenceForDateRangeMock).toHaveBeenNthCalledWith(2, {
      store: (runtime as any).store,
      orgId: "1003",
      startBizDate,
      endBizDate,
      refreshViews: false,
      chunkDays: 14,
      storeConfig: config.stores[2],
    });
    expect(rebuildMemberReactivationFeaturesForDateRangeMock).toHaveBeenNthCalledWith(2, {
      store: (runtime as any).store,
      orgId: "1003",
      startBizDate,
      endBizDate,
      refreshViews: false,
    });
    expect(rebuildMemberReactivationStrategiesForDateRangeMock).toHaveBeenNthCalledWith(2, {
      store: (runtime as any).store,
      orgId: "1003",
      startBizDate,
      endBizDate,
      refreshViews: false,
      storeConfig: config.stores[2],
    });
    expect(rebuildMemberReactivationQueueForDateRangeMock).toHaveBeenNthCalledWith(2, {
      store: (runtime as any).store,
      orgId: "1003",
      startBizDate,
      endBizDate,
      refreshViews: false,
      storeConfig: config.stores[2],
    });
    expect(forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
    expect(result.allComplete).toBe(true);
  });

  it("sends one concise noon operating brief per store after the long-form report already ran", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        {
          orgId: "1001",
          storeName: "一号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
        {
          orgId: "1002",
          storeName: "二号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
        {
          orgId: "1003",
          storeName: "三号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
        {
          orgId: "1004",
          storeName: "四号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
        {
          orgId: "1005",
          storeName: "五号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });
    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId,
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 12800,
        serviceOrderCount: 86,
        totalClockCount: 92,
        clockEffect: 139.1,
        averageTicket: 148.8,
        groupbuy7dRevisitRate: 0.31,
        groupbuy7dStoredValueConversionRate: 0.12,
        groupbuyFirstOrderHighValueMemberRate: 0.09,
        sleepingMemberRate: 0.16,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 1.63,
        pointClockRate: 0.42,
        addClockRate: 0.27,
        activeTechCount: 7,
        onDutyTechCount: 9,
      },
      alerts: [],
      suggestions: [],
      markdown: `${orgId} 全量日报`,
      complete: true,
    }));

    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);

    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-30",
            "nightly-conversation-review:2026-03-30",
            "build-store-environment-memory:2026-03-29",
            "build-report:2026-03-29",
            "audit-daily-report-window:2026-03-29",
            "send-report:2026-03-29",
            "run-customer-history-catchup:2026-03-29",
          ]),
        ),
      markScheduledJobCompleted,
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      getDailyReport: vi.fn().mockResolvedValue(null),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      listStoreReview7dByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          windowEndBizDate: "2026-03-29",
          storeName: "一号店",
          revenue7d: 86_000,
          orderCount7d: 520,
          totalClocks7d: 610,
          clockEffect7d: 141.2,
          averageTicket7d: 165.4,
          pointClockRate7d: 0.44,
          addClockRate7d: 0.27,
          rechargeCash7d: 18_000,
          storedConsumeAmount7d: 21_000,
          storedConsumeRate7d: 0.41,
          onDutyTechCount7d: 9,
          groupbuyOrderShare7d: 0.23,
          groupbuyCohortCustomerCount: 18,
          groupbuy7dRevisitCustomerCount: 7,
          groupbuy7dRevisitRate: 7 / 18,
          groupbuy7dCardOpenedCustomerCount: 4,
          groupbuy7dCardOpenedRate: 4 / 18,
          groupbuy7dStoredValueConvertedCustomerCount: 3,
          groupbuy7dStoredValueConversionRate: 3 / 18,
          groupbuy30dMemberPayConvertedCustomerCount: 6,
          groupbuy30dMemberPayConversionRate: 6 / 18,
          groupbuyFirstOrderCustomerCount: 10,
          groupbuyFirstOrderHighValueMemberCustomerCount: 1,
          groupbuyFirstOrderHighValueMemberRate: 0.1,
          effectiveMembers: 96,
          sleepingMembers: 16,
          sleepingMemberRate: 16 / 96,
          newMembers7d: 12,
          activeTechCount7d: 7,
          currentStoredBalance: 120_000,
          storedBalanceLifeMonths: 2.4,
          renewalPressureIndex30d: 1.63,
          memberRepurchaseBaseCustomerCount7d: 18,
          memberRepurchaseReturnedCustomerCount7d: 8,
          memberRepurchaseRate7d: 8 / 18,
        },
        {
          orgId: "1001",
          windowEndBizDate: "2026-03-22",
          storeName: "一号店",
          revenue7d: 93_000,
          orderCount7d: 546,
          totalClocks7d: 640,
          clockEffect7d: 145.3,
          averageTicket7d: 170.3,
          pointClockRate7d: 0.47,
          addClockRate7d: 0.31,
          rechargeCash7d: 20_000,
          storedConsumeAmount7d: 20_500,
          storedConsumeRate7d: 0.39,
          onDutyTechCount7d: 9,
          groupbuyOrderShare7d: 0.21,
          groupbuyCohortCustomerCount: 19,
          groupbuy7dRevisitCustomerCount: 8,
          groupbuy7dRevisitRate: 8 / 19,
          groupbuy7dCardOpenedCustomerCount: 5,
          groupbuy7dCardOpenedRate: 5 / 19,
          groupbuy7dStoredValueConvertedCustomerCount: 4,
          groupbuy7dStoredValueConversionRate: 4 / 19,
          groupbuy30dMemberPayConvertedCustomerCount: 7,
          groupbuy30dMemberPayConversionRate: 7 / 19,
          groupbuyFirstOrderCustomerCount: 10,
          groupbuyFirstOrderHighValueMemberCustomerCount: 2,
          groupbuyFirstOrderHighValueMemberRate: 0.2,
          effectiveMembers: 94,
          sleepingMembers: 13,
          sleepingMemberRate: 13 / 94,
          newMembers7d: 10,
          activeTechCount7d: 8,
          currentStoredBalance: 132_000,
          storedBalanceLifeMonths: 3.1,
          renewalPressureIndex30d: 1.31,
          memberRepurchaseBaseCustomerCount7d: 17,
          memberRepurchaseReturnedCustomerCount7d: 9,
          memberRepurchaseRate7d: 9 / 17,
        },
      ]),
      listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          windowEndBizDate: "2026-03-29",
          storeName: "一号店",
          revenue30d: 352_000,
          orderCount30d: 2_110,
          totalClocks30d: 2_480,
          clockEffect30d: 141.9,
          averageTicket30d: 166.8,
          pointClockRate30d: 0.45,
          addClockRate30d: 0.28,
          rechargeCash30d: 42_000,
          storedConsumeAmount30d: 68_000,
          storedConsumeRate30d: 0.39,
          onDutyTechCount30d: 9,
          groupbuyOrderShare30d: 0.24,
          groupbuyCohortCustomerCount: 88,
          groupbuy7dRevisitCustomerCount: 31,
          groupbuy7dRevisitRate: 31 / 88,
          groupbuy7dCardOpenedCustomerCount: 21,
          groupbuy7dCardOpenedRate: 21 / 88,
          groupbuy7dStoredValueConvertedCustomerCount: 16,
          groupbuy7dStoredValueConversionRate: 16 / 88,
          groupbuy30dMemberPayConvertedCustomerCount: 34,
          groupbuy30dMemberPayConversionRate: 34 / 88,
          groupbuyFirstOrderCustomerCount: 51,
          groupbuyFirstOrderHighValueMemberCustomerCount: 9,
          groupbuyFirstOrderHighValueMemberRate: 9 / 51,
          effectiveMembers: 96,
          sleepingMembers: 16,
          sleepingMemberRate: 16 / 96,
          newMembers30d: 34,
          activeTechCount30d: 8,
          currentStoredBalance: 120_000,
          storedBalanceLifeMonths: 2.4,
          renewalPressureIndex30d: 1.63,
          memberRepurchaseBaseCustomerCount7d: 18,
          memberRepurchaseReturnedCustomerCount7d: 8,
          memberRepurchaseRate7d: 8 / 18,
        },
        {
          orgId: "1001",
          windowEndBizDate: "2026-02-27",
          storeName: "一号店",
          revenue30d: 367_000,
          orderCount30d: 2_180,
          totalClocks30d: 2_560,
          clockEffect30d: 143.4,
          averageTicket30d: 168.3,
          pointClockRate30d: 0.46,
          addClockRate30d: 0.31,
          rechargeCash30d: 51_000,
          storedConsumeAmount30d: 63_000,
          storedConsumeRate30d: 0.36,
          onDutyTechCount30d: 9,
          groupbuyOrderShare30d: 0.23,
          groupbuyCohortCustomerCount: 92,
          groupbuy7dRevisitCustomerCount: 36,
          groupbuy7dRevisitRate: 36 / 92,
          groupbuy7dCardOpenedCustomerCount: 23,
          groupbuy7dCardOpenedRate: 23 / 92,
          groupbuy7dStoredValueConvertedCustomerCount: 18,
          groupbuy7dStoredValueConversionRate: 18 / 92,
          groupbuy30dMemberPayConvertedCustomerCount: 39,
          groupbuy30dMemberPayConversionRate: 39 / 92,
          groupbuyFirstOrderCustomerCount: 55,
          groupbuyFirstOrderHighValueMemberCustomerCount: 12,
          groupbuyFirstOrderHighValueMemberRate: 12 / 55,
          effectiveMembers: 94,
          sleepingMembers: 12,
          sleepingMemberRate: 12 / 94,
          newMembers30d: 31,
          activeTechCount30d: 8,
          currentStoredBalance: 138_000,
          storedBalanceLifeMonths: 3.4,
          renewalPressureIndex30d: 1.24,
          memberRepurchaseBaseCustomerCount7d: 17,
          memberRepurchaseReturnedCustomerCount7d: 9,
          memberRepurchaseRate7d: 9 / 17,
        },
      ]),
    });

    const now = new Date("2026-03-30T12:01:00+08:00");
    const lines = await runtime.runDueJobs(now);

    expect(lines).toEqual([
      ...buildSkippedSharedDeliveryLines("2026-03-29"),
      "一号店: midday brief sent",
      "二号店: midday brief sent",
      "三号店: midday brief sent",
      "四号店: midday brief sent",
      "五号店: midday brief sent",
    ]);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(5);
    const firstArgv = runCommandWithTimeout.mock.calls[0]?.[0] ?? [];
    const messageIndex = firstArgv.indexOf("--message");
    const sentMessage = messageIndex >= 0 ? firstArgv[messageIndex + 1] : "";
    expect(sentMessage).toContain("一句话判断");
    expect(sentMessage).toContain("03:00 截止");
    expect(sentMessage).toContain("昨日收盘");
    expect(sentMessage).toContain("近7天变化");
    expect(sentMessage).toContain("近30天会员与储值风险");
    expect(sentMessage).toContain("今日先抓");
    expect(sentMessage).toContain("较前7天");
    expect(sentMessage).not.toContain("现金池");
    expect(sentMessage).not.toContain("N/A");
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-midday-brief",
      "2026-03-29",
      now.toISOString(),
    );
  });

  it("sends one shared @所有人 announcement before daily reports when all active stores share the same target", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sendReportEnabled: true,
        sharedDelivery: {
          channel: "wecom",
          target: "hq-group",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });
    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId,
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 12800,
        serviceOrderCount: 86,
        totalClockCount: 92,
        clockEffect: 139.1,
        averageTicket: 148.8,
        groupbuy7dRevisitRate: 0.31,
        groupbuy7dStoredValueConversionRate: 0.12,
        groupbuyFirstOrderHighValueMemberRate: 0.09,
        sleepingMemberRate: 0.16,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 1.63,
        pointClockRate: 0.42,
        addClockRate: 0.27,
        activeTechCount: 7,
        onDutyTechCount: 9,
      },
      alerts: [],
      suggestions: [],
      markdown: `${orgId} 全量日报`,
      complete: true,
    }));

    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);

    const getDailyReport = vi.fn().mockResolvedValue(null);
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-30",
            "nightly-history-backfill:2026-03-30",
            "nightly-conversation-review:2026-03-30",
            "build-store-environment-memory:2026-03-29",
            "build-report:2026-03-29",
            "audit-daily-report-window:2026-03-29",
            "run-customer-history-catchup:2026-03-29",
            "send-five-store-daily-overview:2026-03-29",
            "send-weekly-report:2026-03-29",
            "send-weekly-chart:2026-03-29",
          ]),
        ),
      markScheduledJobCompleted: vi.fn().mockResolvedValue(undefined),
      getDailyReport,
      markReportSent: vi.fn().mockResolvedValue(undefined),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    });

    const lines = await runtime.runDueJobs(new Date("2026-03-30T10:05:00+08:00"));

    expect(lines).toEqual([
      "一号店: report sent",
      "二号店: report sent",
    ]);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(3);
    const firstArgv = runCommandWithTimeout.mock.calls[0]?.[0] ?? [];
    const messageIndex = firstArgv.indexOf("--message");
    const firstMessage = messageIndex >= 0 ? firstArgv[messageIndex + 1] : "";
    expect(firstArgv).toEqual(expect.arrayContaining(["--target", "hq-group"]));
    expect(firstMessage).toContain("@所有人");
    expect(firstMessage).toContain("2026年3月29日");
    expect(firstMessage.endsWith("@所有人")).toBe(true);
    expect(getDailyReport).toHaveBeenCalled();
  });

  it("does not resend the shared @所有人 announcement after at least one store report was already sent", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sendReportEnabled: true,
        sharedDelivery: {
          channel: "wecom",
          target: "hq-group",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });
    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId,
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 12800,
        serviceOrderCount: 86,
        totalClockCount: 92,
        clockEffect: 139.1,
        averageTicket: 148.8,
        groupbuy7dRevisitRate: 0.31,
        groupbuy7dStoredValueConversionRate: 0.12,
        groupbuyFirstOrderHighValueMemberRate: 0.09,
        sleepingMemberRate: 0.16,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 1.63,
        pointClockRate: 0.42,
        addClockRate: 0.27,
        activeTechCount: 7,
        onDutyTechCount: 9,
      },
      alerts: [],
      suggestions: [],
      markdown: `${orgId} 全量日报`,
      complete: true,
    }));

    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);

    const getDailyReport = vi.fn().mockImplementation(async (orgId: string) => {
      if (orgId === "1001") {
        return {
          orgId,
          storeName: "一号店",
          bizDate: "2026-03-29",
          metrics: {},
          alerts: [],
          suggestions: [],
          markdown: "一号店已发送",
          complete: true,
          sentAt: "2026-03-30T10:01:00.000Z",
          sendStatus: "sent",
        };
      }
      return null;
    });
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-30",
            "nightly-history-backfill:2026-03-30",
            "nightly-conversation-review:2026-03-30",
            "build-store-environment-memory:2026-03-29",
            "build-report:2026-03-29",
            "audit-daily-report-window:2026-03-29",
            "run-customer-history-catchup:2026-03-29",
            "send-five-store-daily-overview:2026-03-29",
            "send-weekly-report:2026-03-29",
            "send-weekly-chart:2026-03-29",
          ]),
        ),
      markScheduledJobCompleted: vi.fn().mockResolvedValue(undefined),
      getDailyReport,
      markReportSent: vi.fn().mockResolvedValue(undefined),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    });

    const lines = await runtime.runDueJobs(new Date("2026-03-30T10:06:00+08:00"));

    expect(lines).toEqual([
      "一号店: already sent",
      "二号店: report sent",
    ]);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    const onlyArgv = runCommandWithTimeout.mock.calls[0]?.[0] ?? [];
    const messageIndex = onlyArgv.indexOf("--message");
    const onlyMessage = messageIndex >= 0 ? onlyArgv[messageIndex + 1] : "";
    expect(onlyMessage).not.toContain("@所有人");
  });

  it("keeps alert-only reports pending until data catches up, then upgrades them to formal reports", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        {
          orgId: "1001",
          storeName: "一号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const runtime = new HetangOpsRuntime({
      config,
      logger,
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);

    let coverageComplete = false;
    let reportState:
      | ({
          sentAt?: string | null;
          sendStatus?: string | null;
        } & Record<string, unknown>)
      | null = {
      orgId: "1001",
      storeName: "一号店",
      bizDate: "2026-03-29",
      metrics: {
        staleSyncEndpoints: ["1.4"],
      },
      alerts: [
        {
          code: "data-gap",
          severity: "critical",
          message: "账户流水 1.4 未更新，正式日报降级。",
        },
      ],
      suggestions: [],
      markdown: "一号店异常告警",
      complete: false,
      sentAt: null,
      sendStatus: null,
    };

    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: "一号店",
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 12800,
        serviceOrderCount: 86,
        totalClockCount: 92,
        clockEffect: 139.1,
        averageTicket: 148.8,
        groupbuy7dRevisitRate: 0.31,
        groupbuy7dStoredValueConversionRate: 0.12,
        groupbuyFirstOrderHighValueMemberRate: 0.09,
        sleepingMemberRate: 0.16,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 1.63,
        pointClockRate: 0.42,
        addClockRate: 0.27,
        activeTechCount: 7,
        onDutyTechCount: 9,
      },
      alerts: [],
      suggestions: [],
      markdown: `${orgId} 全量日报`,
      complete: true,
    }));

    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const markReportSent = vi.fn().mockImplementation(async (params: {
      sentAt: string;
      sendStatus: string;
    }) => {
      if (params.sendStatus === "alert-only") {
        reportState = {
          ...reportState,
          sentAt: params.sentAt,
          sendStatus: params.sendStatus,
        };
        return;
      }
      reportState = {
        orgId: "1001",
        storeName: "一号店",
        bizDate: "2026-03-29",
        metrics: {
          serviceRevenue: 12800,
        },
        alerts: [],
        suggestions: [],
        markdown: "1001 全量日报",
        complete: true,
        sentAt: params.sentAt,
        sendStatus: params.sendStatus,
      };
    });

    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-30",
            "nightly-history-backfill:2026-03-30",
            "nightly-conversation-review:2026-03-30",
            "build-store-environment-memory:2026-03-29",
            "build-report:2026-03-29",
            "audit-daily-report-window:2026-03-29",
            "run-customer-history-catchup:2026-03-29",
          ]),
        ),
      markScheduledJobCompleted,
      getDailyReport: vi.fn().mockImplementation(async () => reportState),
      markReportSent,
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      getEndpointWatermarksForOrg: vi.fn().mockImplementation(async () =>
        coverageComplete
          ? buildCompleteDeliveryWatermarks("2026-03-29")
          : {
              ...buildCompleteDeliveryWatermarks("2026-03-29"),
              "1.4": "2026-03-28T19:00:00.000Z",
            },
      ),
    });

    const firstLines = await runtime.runDueJobs(new Date("2026-03-30T10:05:00+08:00"));
    const secondLines = await runtime.runDueJobs(new Date("2026-03-30T10:15:00+08:00"));
    coverageComplete = true;
    const thirdLines = await runtime.runDueJobs(new Date("2026-03-30T10:25:00+08:00"));

    expect(firstLines).toEqual([
      "一号店: alert sent",
      ...buildWaitingSharedDeliveryLines("2026-03-29"),
    ]);
    expect(secondLines).toEqual([
      "一号店: alert already sent",
      ...buildWaitingSharedDeliveryLines("2026-03-29"),
    ]);
    expect(thirdLines).toEqual([
      "一号店: report sent",
      ...buildSkippedSharedDeliveryLines("2026-03-29"),
    ]);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(3);
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-report",
      "2026-03-29",
      "2026-03-30T02:25:00.000Z",
    );
  });

  it("skips already delivered stores when retrying midday briefs after a partial failure", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        {
          orgId: "1001",
          storeName: "一号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
        {
          orgId: "1002",
          storeName: "二号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
        {
          orgId: "1003",
          storeName: "三号店",
          notification: { channel: "wecom", target: "hq-group" },
        },
      ],
    });
    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId,
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 12800,
        serviceOrderCount: 86,
        totalClockCount: 92,
        clockEffect: 139.1,
        averageTicket: 148.8,
        groupbuy7dRevisitRate: 0.31,
        groupbuy7dStoredValueConversionRate: 0.12,
        groupbuyFirstOrderHighValueMemberRate: 0.09,
        sleepingMemberRate: 0.16,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 1.63,
        pointClockRate: 0.42,
        addClockRate: 0.27,
        activeTechCount: 7,
        onDutyTechCount: 9,
      },
      alerts: [],
      suggestions: [],
      markdown: `${orgId} 全量日报`,
      complete: true,
    }));
    const runCommandWithTimeout = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "midday send failed" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const runtime = new HetangOpsRuntime({
      config,
      logger,
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);

    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      tryAdvisoryLock: vi.fn().mockResolvedValue(true),
      releaseAdvisoryLock: vi.fn().mockResolvedValue(undefined),
      listCompletedRunKeys: vi
        .fn()
        .mockResolvedValue(
          new Set([
            "sync:2026-03-30",
            "nightly-history-backfill:2026-03-30",
            "nightly-conversation-review:2026-03-30",
            "build-store-environment-memory:2026-03-29",
            "build-report:2026-03-29",
            "audit-daily-report-window:2026-03-29",
            "send-report:2026-03-29",
            "run-customer-history-catchup:2026-03-29",
          ]),
        ),
      markScheduledJobCompleted,
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      getDailyReport: vi.fn().mockResolvedValue(null),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      listStoreReview7dByDateRange: vi.fn().mockResolvedValue([]),
      listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([]),
    });

    const now = new Date("2026-03-30T12:01:00+08:00");

    const firstLines = await runtime.runDueJobs(now);
    const secondLines = await runtime.runDueJobs(new Date("2026-03-30T12:11:00+08:00"));

    expect(firstLines).toEqual([
      ...buildSkippedSharedDeliveryLines("2026-03-29"),
      "一号店: midday brief sent",
      "二号店: midday brief send failed - midday send failed",
      "三号店: midday brief sent",
    ]);
    expect(secondLines).toEqual([
      "一号店: midday brief already sent",
      "二号店: midday brief sent",
      "三号店: midday brief already sent",
    ]);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(4);
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-midday-brief",
      "2026-03-29",
      "2026-03-30T04:11:00.000Z",
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("hetang-ops: send midday brief failed for 二号店: midday send failed"),
    );
  });

  it("can send all midday briefs to a shared override target and remains idempotent on retry", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId,
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 12800,
        serviceOrderCount: 86,
        totalClockCount: 92,
        clockEffect: 139.1,
        averageTicket: 148.8,
        groupbuy7dRevisitRate: 0.31,
        groupbuy7dStoredValueConversionRate: 0.12,
        groupbuyFirstOrderHighValueMemberRate: 0.09,
        sleepingMemberRate: 0.16,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 1.63,
        pointClockRate: 0.42,
        addClockRate: 0.27,
        activeTechCount: 7,
        onDutyTechCount: 9,
      },
      alerts: [],
      suggestions: [],
      markdown: `${orgId} 全量日报`,
      complete: true,
    }));
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      listStoreReview7dByDateRange: vi.fn().mockResolvedValue([]),
      listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([]),
      getDailyReport: vi.fn().mockResolvedValue(null),
    });

    const notificationOverride = {
      channel: "wecom",
      target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
      enabled: true,
    };
    const firstResult = await runtime.sendAllMiddayBriefs({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T12:05:00+08:00"),
      notificationOverride,
    });
    const secondResult = await runtime.sendAllMiddayBriefs({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T12:10:00+08:00"),
      notificationOverride,
    });

    expect(firstResult).toEqual({
      lines: ["一号店: midday brief sent", "二号店: midday brief sent"],
      allSent: true,
    });
    expect(secondResult).toEqual({
      lines: ["一号店: midday brief already sent", "二号店: midday brief already sent"],
      allSent: true,
    });
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(2);
    for (const [argv] of runCommandWithTimeout.mock.calls) {
      expect(argv).toContain("--target");
      expect(argv).toContain("REPLACE_WITH_SHARED_DELIVERY_TARGET");
    }
  });

  it("falls back to reporting.sharedDelivery when store notification targets are absent", async () => {
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sharedDelivery: {
          channel: "wecom",
          target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId,
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 12800,
        serviceOrderCount: 86,
        totalClockCount: 92,
        clockEffect: 139.1,
        averageTicket: 148.8,
        groupbuy7dRevisitRate: 0.31,
        groupbuy7dStoredValueConversionRate: 0.12,
        groupbuyFirstOrderHighValueMemberRate: 0.09,
        sleepingMemberRate: 0.16,
        storedBalanceLifeMonths: 2.4,
        renewalPressureIndex30d: 1.63,
        pointClockRate: 0.42,
        addClockRate: 0.27,
        activeTechCount: 7,
        onDutyTechCount: 9,
      },
      alerts: [],
      suggestions: [],
      markdown: `${orgId} 全量日报`,
      complete: true,
    }));
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      listStoreReview7dByDateRange: vi.fn().mockResolvedValue([]),
      listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([]),
      getDailyReport: vi.fn().mockResolvedValue(null),
    });

    await runtime.sendAllMiddayBriefs({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T12:05:00+08:00"),
    });

    expect(runCommandWithTimeout).toHaveBeenCalledTimes(2);
    for (const [argv] of runCommandWithTimeout.mock.calls) {
      expect(argv).toContain("--target");
      expect(argv).toContain("REPLACE_WITH_SHARED_DELIVERY_TARGET");
    }
  });

  it("suppresses midday brief pushes when the target business-day report is still incomplete", async () => {
    buildDailyStoreReportMock.mockReset();
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sharedDelivery: {
          channel: "wecom",
          target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    buildDailyStoreReportMock.mockImplementation(async ({ orgId }: { orgId: string }) => ({
      orgId,
      storeName: config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId,
      bizDate: "2026-03-29",
      metrics: {
        serviceRevenue: 0,
        serviceOrderCount: 0,
        totalClockCount: 0,
        clockEffect: 0,
        averageTicket: 0,
        groupbuy7dRevisitRate: 0,
        groupbuy7dStoredValueConversionRate: 0,
        groupbuyFirstOrderHighValueMemberRate: 0,
        sleepingMemberRate: 0,
        storedBalanceLifeMonths: 0,
        renewalPressureIndex30d: 0,
        pointClockRate: 0,
        addClockRate: 0,
        activeTechCount: 0,
        onDutyTechCount: 0,
      },
      alerts: [{ severity: "high", message: "昨日同步未闭环" }],
      suggestions: [],
      markdown: `${orgId} 未完成日报`,
      complete: false,
    }));
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);
    const getDailyReport = vi.fn().mockResolvedValue(null);
    const listStoreReview7dByDateRange = vi.fn().mockResolvedValue([]);
    const listStoreSummary30dByDateRange = vi.fn().mockResolvedValue([]);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      getEndpointWatermarksForOrg: vi.fn().mockResolvedValue({}),
      listStoreReview7dByDateRange,
      listStoreSummary30dByDateRange,
      getDailyReport,
    });

    const firstResult = await runtime.sendAllMiddayBriefs({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T12:05:00+08:00"),
    });
    const secondResult = await runtime.sendAllMiddayBriefs({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T12:10:00+08:00"),
    });

    expect(firstResult).toEqual({
      lines: [
        "一号店: midday brief skipped - report incomplete",
        "二号店: midday brief skipped - report incomplete",
      ],
      allSent: true,
    });
    expect(secondResult).toEqual({
      lines: ["一号店: midday brief already sent", "二号店: midday brief already sent"],
      allSent: true,
    });
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
    expect(getDailyReport).not.toHaveBeenCalled();
    expect(buildDailyStoreReportMock).not.toHaveBeenCalled();
    expect(listStoreReview7dByDateRange).not.toHaveBeenCalled();
    expect(listStoreSummary30dByDateRange).not.toHaveBeenCalled();
  });

  it("suppresses reactivation pushes when the daily sync is still incomplete even if a same-day snapshot exists", async () => {
    loadLatestCustomerSegmentSnapshotMock.mockReset();
    selectTopReactivationCandidateMock.mockReset();
    renderReactivationPushMessageMock.mockReset();
    loadLatestCustomerSegmentSnapshotMock
      .mockResolvedValueOnce({ bizDate: "2026-03-29", rows: [{ customerId: "C-1" }] })
      .mockResolvedValueOnce({ bizDate: "2026-03-29", rows: [{ customerId: "C-2" }] });

    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sharedDelivery: {
          channel: "wecom",
          target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      getEndpointWatermarksForOrg: vi.fn().mockResolvedValue({}),
    });

    const firstResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:05:00+08:00"),
    });
    const secondResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:10:00+08:00"),
    });

    expect(firstResult).toEqual({
      lines: [
        "一号店: reactivation push skipped - report incomplete",
        "二号店: reactivation push skipped - report incomplete",
      ],
      allSent: true,
    });
    expect(secondResult).toEqual({
      lines: ["一号店: reactivation push already sent", "二号店: reactivation push already sent"],
      allSent: true,
    });
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
    expect(loadLatestCustomerSegmentSnapshotMock).not.toHaveBeenCalled();
    expect(selectTopReactivationCandidateMock).not.toHaveBeenCalled();
    expect(renderReactivationPushMessageMock).not.toHaveBeenCalled();
  });

  it("suppresses reactivation pushes when the latest customer snapshot is stale", async () => {
    loadLatestCustomerSegmentSnapshotMock.mockReset();
    selectTopReactivationCandidateMock.mockReset();
    renderReactivationPushMessageMock.mockReset();
    loadLatestCustomerSegmentSnapshotMock
      .mockResolvedValueOnce({ bizDate: "2026-03-28", rows: [{ customerId: "C-1" }] })
      .mockResolvedValueOnce({ bizDate: "2026-03-28", rows: [{ customerId: "C-2" }] });

    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sharedDelivery: {
          channel: "wecom",
          target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      getEndpointWatermarksForOrg: vi
        .fn()
        .mockResolvedValue(buildCompleteDeliveryWatermarks("2026-03-29")),
    });

    const firstResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:05:00+08:00"),
    });
    const secondResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:10:00+08:00"),
    });

    expect(firstResult).toEqual({
      lines: [
        "一号店: reactivation push skipped - stale segment snapshot 2026-03-28",
        "二号店: reactivation push skipped - stale segment snapshot 2026-03-28",
      ],
      allSent: true,
    });
    expect(secondResult).toEqual({
      lines: ["一号店: reactivation push already sent", "二号店: reactivation push already sent"],
      allSent: true,
    });
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
    expect(selectTopReactivationCandidateMock).not.toHaveBeenCalled();
    expect(renderReactivationPushMessageMock).not.toHaveBeenCalled();
  });

  it("suppresses reactivation pushes when no qualified customer is available on the target snapshot", async () => {
    loadLatestCustomerSegmentSnapshotMock.mockReset();
    selectTopReactivationCandidateMock.mockReset();
    renderReactivationPushMessageMock.mockReset();
    loadLatestCustomerSegmentSnapshotMock
      .mockResolvedValueOnce({ bizDate: "2026-03-29", rows: [{ customerId: "C-1" }] })
      .mockResolvedValueOnce({ bizDate: "2026-03-29", rows: [{ customerId: "C-2" }] });
    selectTopReactivationCandidateMock.mockReturnValue(null);

    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sharedDelivery: {
          channel: "wecom",
          target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
      getEndpointWatermarksForOrg: vi
        .fn()
        .mockResolvedValue(buildCompleteDeliveryWatermarks("2026-03-29")),
    });

    const firstResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:05:00+08:00"),
    });
    const secondResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:10:00+08:00"),
    });

    expect(firstResult).toEqual({
      lines: [
        "一号店: reactivation push skipped - no qualified candidate",
        "二号店: reactivation push skipped - no qualified candidate",
      ],
      allSent: true,
    });
    expect(secondResult).toEqual({
      lines: ["一号店: reactivation push already sent", "二号店: reactivation push already sent"],
      allSent: true,
    });
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
    expect(renderReactivationPushMessageMock).not.toHaveBeenCalled();
  });

  it("can send all reactivation pushes via reporting.sharedDelivery and remains idempotent on retry", async () => {
    loadLatestCustomerSegmentSnapshotMock.mockReset();
    selectTopReactivationCandidateMock.mockReset();
    renderReactivationPushMessageMock.mockReset();
    loadLatestCustomerSegmentSnapshotMock
      .mockResolvedValueOnce({ bizDate: "2026-03-29", rows: [{ customerId: "C-1" }] })
      .mockResolvedValueOnce({ bizDate: "2026-03-29", rows: [{ customerId: "C-2" }] });
    selectTopReactivationCandidateMock.mockReturnValue({
      row: { customerDisplayName: "严**" },
      bucketKey: "high-value-reactivation",
      bucketLabel: "高价值召回",
      score: 98,
      reason: "沉默45天，且近90天贡献较高",
    });
    renderReactivationPushMessageMock.mockImplementation(
      ({ storeName }: { storeName: string }) => `${storeName} 今日唤回名单`,
    );

    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      reporting: {
        sharedDelivery: {
          channel: "wecom",
          target: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
        },
      },
      stores: [
        { orgId: "1001", storeName: "一号店" },
        { orgId: "1002", storeName: "二号店" },
      ],
    });
    const runCommandWithTimeout = vi.fn().mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    const runtime = new HetangOpsRuntime({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);
    const scheduledJobState = new Map<string, Record<string, unknown>>();
    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState: vi.fn().mockImplementation(async (jobType: string, stateKey: string) => {
        return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
      }),
      setScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
          scheduledJobState.set(`${jobType}:${stateKey}`, state);
        }),
      resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    });

    const firstResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:05:00+08:00"),
    });
    const secondResult = await (runtime as any).sendAllReactivationPushes({
      bizDate: "2026-03-29",
      now: new Date("2026-03-30T15:10:00+08:00"),
    });

    expect(firstResult).toEqual({
      lines: ["一号店: reactivation push sent", "二号店: reactivation push sent"],
      allSent: true,
    });
    expect(secondResult).toEqual({
      lines: ["一号店: reactivation push already sent", "二号店: reactivation push already sent"],
      allSent: true,
    });
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(2);
    expect(loadLatestCustomerSegmentSnapshotMock).toHaveBeenCalledTimes(2);
    for (const [argv] of runCommandWithTimeout.mock.calls) {
      expect(argv).toContain("--target");
      expect(argv).toContain("REPLACE_WITH_SHARED_DELIVERY_TARGET");
    }
  });
});

describe("HetangOpsRuntime.recordServicePollerOutcome", () => {
  it("cleans legacy scheduled poller state after split scheduled poller persistence", async () => {
    const getScheduledJobState = vi.fn().mockResolvedValue({
      lastSuccessAt: "2026-04-05T04:00:00.000Z",
    });
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const deleteScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState,
      setScheduledJobState,
      deleteScheduledJobState,
    });

    await runtime.recordServicePollerOutcome({
      poller: "scheduled-delivery",
      status: "ok",
      startedAt: "2026-04-06T01:00:00.000Z",
      finishedAt: "2026-04-06T01:00:02.000Z",
      lines: ["delivery line 1"],
    });

    expect(deleteScheduledJobState).toHaveBeenCalledWith("service-poller", "scheduled");
  });

  it("persists poller failure state and logs the error", async () => {
    const getScheduledJobState = vi.fn().mockResolvedValue({
      lastSuccessAt: "2026-04-05T04:00:00.000Z",
    });
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger,
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      getScheduledJobState,
      setScheduledJobState,
    });

    const startedAt = "2026-04-06T01:00:00.000Z";
    const finishedAt = "2026-04-06T01:00:05.000Z";
    await runtime.recordServicePollerOutcome({
      poller: "scheduled-sync",
      status: "failed",
      startedAt,
      finishedAt,
      error: new Error("scheduled sync boom"),
    });

    expect(getScheduledJobState).toHaveBeenCalledWith("service-poller", "scheduled-sync");
    expect(setScheduledJobState).toHaveBeenCalledWith(
      "service-poller",
      "scheduled-sync",
      expect.objectContaining({
        poller: "scheduled-sync",
        status: "failed",
        lastRunAt: finishedAt,
        lastFailureAt: finishedAt,
        lastSuccessAt: "2026-04-05T04:00:00.000Z",
        lastError: "scheduled sync boom",
        lastDurationMs: 5000,
      }),
      finishedAt,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("hetang-ops: scheduled-sync poller failed: scheduled sync boom"),
    );
  });
});

describe("HetangOpsRuntime.doctor", () => {
  it("surfaces scheduler authority, poller health, and analysis delivery status", async () => {
    const runCommandWithTimeout = vi.fn().mockImplementation(async (args: string[]) => {
      if (args[1] === "-u" && args[2] === "hermes-gateway.service") {
        return {
          code: 0,
          stdout: [
            "2026-04-16 23:32:25 INFO sitecustomize: htops_hermes_command_bridge command=hetang result=handled chat_id=chat-1 user_id=user-1",
            "2026-04-16 23:14:13 WARNING gateway.platforms.wecom: [Wecom] WebSocket error: WeCom websocket closed | ws_state=connected | reconnect_attempt=1 | retry_in=0",
            "2026-04-16 23:14:13 WARNING gateway.platforms.wecom: [Wecom] Reconnect failed: TimeoutError | reconnect_attempt=1 | retry_in=0 | ws_state=none",
            "2026-04-16 23:23:43 INFO gateway.platforms.wecom: [Wecom] Reconnected | reconnect_attempt=2 | ws_state=healthy",
          ].join("\n"),
          stderr: "",
          signal: null,
          killed: false,
          termination: "exit",
        };
      }
      if (args[1] === "-u" && args[2] === "htops-bridge.service") {
        return {
          code: 0,
          stdout: [
            '2026-04-16 23:41:00 INFO hetang-ops: route-compare {"selectedLane":"query","legacyCapabilityId":"store_day_summary_v1","selectedCapabilityId":"store_day_summary_v1","clarificationNeeded":false,"latencyMs":180,"legacyRoute":"query:query","semanticRoute":"query:query"}',
            '2026-04-16 23:42:00 INFO hetang-ops: route-compare {"selectedLane":"analysis","legacyCapabilityId":null,"selectedCapabilityId":"store_review_async_v1","clarificationNeeded":true,"latencyMs":980,"legacyRoute":"query:query","semanticRoute":"analysis:analysis","rawText":"一号店上周问题在哪"}',
          ].join("\n"),
          stderr: "",
          signal: null,
          killed: false,
          termination: "exit",
        };
      }
      return {
        code: 0,
        stdout: "",
        stderr: "",
        signal: null,
        killed: false,
        termination: "exit",
      };
    });
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveNow: () => new Date("2026-04-16T19:00:00+08:00"),
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout,
    } as never);

    (runtime as any).store = buildRuntimeStore({
      getEndpointWatermarksForOrg: vi.fn().mockResolvedValue([]),
      getRecentCommandAuditSummary: vi.fn().mockResolvedValue({
        recentAllowedCount: 4,
        windowHours: 24,
        latestOccurredAt: "2026-04-16T23:46:55+08:00",
        latestCommandBody: "/hetang status",
        latestAction: "status",
        latestSenderId: "ZhangZhen",
      }),
      getDailyReport: vi.fn().mockResolvedValue({
        orgId: "1001",
        storeName: "一号店",
        bizDate: "2026-04-16",
        complete: true,
        markdown: "2026年4月16日 一号店经营数据报告  \
营业日口径：次日03:00截止  \
\n【核心经营】  \
主项总钟数：7个",
        metrics: {},
        alerts: [],
        suggestions: [],
      }),
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          storeName: "一号店",
          bizDate: "2026-04-07",
          alertSentAt: "2026-04-07T01:00:00.000Z",
          upgradedAt: "2026-04-07T09:05:00.000Z",
        },
      ]),
      listIndustryContextSnapshots: vi.fn().mockResolvedValue([
        {
          snapshotDate: "2026-04-14",
          signalKind: "platform_rule",
          signalKey: "meituan_price_mindshare",
          title: "平台价格心智抬升",
          summary: "低价敏感客决策更快。",
          truthBoundary: "weak_signal",
          confidence: "medium",
          sourceType: "manual_research",
          sourceLabel: "平台观察",
          applicableModules: ["world_model", "hq_narrative"],
          rawJson: "{}",
          updatedAt: "2026-04-14T09:00:00.000Z",
        },
        {
          snapshotDate: "2026-04-14",
          signalKind: "city_consumption_trend",
          signalKey: "night_leisure_recovery",
          title: "夜间休闲需求恢复",
          summary: "夜间到店决策回暖。",
          truthBoundary: "weak_signal",
          confidence: "medium",
          sourceType: "city_observation",
          sourceLabel: "同城观察",
          applicableModules: ["hq_narrative", "store_diagnosis"],
          rawJson: "{}",
          updatedAt: "2026-04-14T09:05:00.000Z",
        },
      ]),
      getScheduledJobState: vi
        .fn()
        .mockImplementation(async (jobType: string, runKey: string) => {
          if (jobType === "send-five-store-daily-overview" && runKey === "2026-04-15") {
            return {
              stage: "pending_confirm",
              previewSentAt: "2026-04-16T09:06:00.000Z",
              finalTarget: {
                channel: "wecom",
                target: "hetang-managers",
                enabled: true,
              },
              updatedAt: "2026-04-16T09:06:00.000Z",
            };
          }
          if (runKey === "scheduled-sync") {
            return {
              poller: "scheduled-sync",
              status: "ok",
              lastRunAt: "2026-04-07T04:02:00.000Z",
              lastSuccessAt: "2026-04-07T04:02:00.000Z",
              lastResultCount: 3,
            };
          }
          if (runKey === "scheduled-delivery") {
            return {
              poller: "scheduled-delivery",
              status: "ok",
              lastRunAt: "2026-04-07T09:00:00.000Z",
              lastSuccessAt: "2026-04-07T09:00:00.000Z",
              lastResultCount: 1,
            };
          }
          if (runKey === "scheduled") {
            return {
              poller: "scheduled",
              status: "ok",
              lastRunAt: "2026-04-07T03:58:00.000Z",
            };
          }
          return {
            poller: "analysis",
            status: "failed",
            lastRunAt: "2026-04-07T09:02:00.000Z",
            lastFailureAt: "2026-04-07T09:02:00.000Z",
            lastError: "analysis boom",
          };
        }),
      getAnalysisQueueSummary: vi.fn().mockResolvedValue({
        pendingCount: 0,
        runningCount: 0,
        completedCount: 3,
        failedCount: 5,
        jobDeliveryPendingCount: 0,
        jobDeliveryRetryingCount: 0,
        jobDeliveryAbandonedCount: 4,
        subscriberDeliveryPendingCount: 0,
        subscriberDeliveryRetryingCount: 0,
        subscriberDeliveryAbandonedCount: 4,
        unresolvedDeadLetterCount: 8,
        deadLetterSummary: {
          unresolvedJobCount: 4,
          unresolvedSubscriberCount: 4,
          latestUnresolvedAt: "2026-04-13T07:57:31.354Z",
          latestReason:
            "[2026-04-13T07:57:31.987Z] [AiBotSDK] [WARN] Reply ack error: reqId=aibot_send_msg_1776067051878_c14a5fe1, errcode=93006, errmsg=invalid chatid, hint: [1776067052074153311952067], from ip: 115.57.50.24, more info at https://open.work.weixin.qq.com/devtool/query?e=93006\n[object Object]\n",
          invalidChatidSubscriberCount: 4,
          subscriberFanoutExhaustedJobCount: 4,
        },
      }),
      getAnalysisDeliveryHealthSummary: vi.fn().mockResolvedValue({
        jobPendingCount: 1,
        jobRetryingCount: 2,
        jobAbandonedCount: 1,
        subscriberPendingCount: 0,
        subscriberRetryingCount: 1,
        subscriberAbandonedCount: 2,
      }),
    });

    await expect(runtime.doctor()).resolves.toContain(
      "Scheduler: app service pollers authoritative",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Scheduler warning: legacy poller state present: scheduled | status=ok | lastRun=2026-04-07T03:58:00.000Z",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Poller scheduled-sync: ok | lastRun=2026-04-07T04:02:00.000Z | results=3",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Poller scheduled-delivery: ok | lastRun=2026-04-07T09:00:00.000Z | results=1",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Poller analysis: failed | lastRun=2026-04-07T09:02:00.000Z | error=analysis boom",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Report delivery upgrades (7d): 1 | latest=一号店 2026-04-07 at 2026-04-07T09:05:00.000Z",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Daily report readiness: 0/5 ready | bizDate=2026-04-15 | refresh_needed 5 | pending=一号店:refresh-needed,二号店:refresh-needed,三号店:refresh-needed",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Industry context: status=refresh-needed | bizDate=2026-04-15 | snapshot=2026-04-14 | freshness_days=1 | items=2 | modules=hq_narrative:2,world_model:1,store_diagnosis:1",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "5店昨日经营总览: status=pending-confirm | bizDate=2026-04-15 | daily_reports=0/5 ready | pending=一号店,二号店,三号店 | preview=2026-04-16T09:06:00.000Z | target=wecom:hetang-managers",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "AI lane cheap-summary: model=doubao-seed-2.0-lite | reasoning=off | timeout=5000ms | response=text | mode=sync | task=summary | fallback=deterministic",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "AI lane analysis-premium: model=gpt-5.4 | reasoning=high | timeout=90000ms | response=json | mode=async | task=analysis | fallback=deterministic",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "AI lane offline-review: model=gpt-5.4 | reasoning=high | timeout=120000ms | response=json | mode=batch | task=review | fallback=deterministic",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Analysis delivery: jobs pending 1 / retrying 2 / abandoned 1; subscribers pending 0 / retrying 1 / abandoned 2",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Analysis dead letters: unresolved 8 (job 4 / subscriber 4) | latest=2026-04-13T07:57:31.354Z | age=75.0h | stale=yes | reason=invalid chatid | residual=stale-invalid-chatid-subscriber",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Hermes command bridge: recent allowed audits 4 (24h) | latest=2026-04-16T23:46:55+08:00 | body=/hetang status | action=status | sender=ZhangZhen",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Hermes WeCom transport: websocket_errors 1 / reconnect_failures 1 / reconnect_successes 1 | latest=2026-04-16 23:23:43 | ws_state=healthy",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Query route compare: samples=2 | route_acc=50% | capability_acc=50% | clarify=1 | p50=180ms | p95=980ms | lanes=analysis:1,query:1 | top_capability=store_day_summary_v1:1",
    );
    await expect(runtime.doctor()).resolves.toContain(
      "Query slow sample: lane=analysis | capability=store_review_async_v1 | latency=980ms | text=一号店上周问题在哪",
    );
  });
});

describe("HetangOpsRuntime phase 2 status surfaces", () => {
  it("builds authoritative scheduler status from one registry", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).store = buildRuntimeStore({
      listCompletedRunKeys: vi.fn().mockResolvedValue(
        new Set([
          "sync:2026-04-07",
          "build-report:2026-04-06",
          "build-external-brief:2026-04-07",
        ]),
      ),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({
        sync: "2026-04-07T03:16:00.000Z",
        "build-report": "2026-04-07T08:52:00.000Z",
        "build-external-brief": "2026-04-07T08:53:00.000Z",
      }),
      getScheduledJobState: vi.fn().mockResolvedValue(null),
    });

    const summary = await (runtime as any).getSchedulerStatus(
      new Date("2026-04-07T12:05:00+08:00"),
    );

    expect(summary.authority).toBe("app-service-pollers");
    expect(summary.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          jobType: "sync",
          orchestrator: "sync",
          status: "completed",
          runKey: "2026-04-07",
          lastRanAt: "2026-04-07T03:16:00.000Z",
        }),
        expect.objectContaining({
          jobType: "send-midday-brief",
          orchestrator: "delivery",
          status: "pending",
          runKey: "2026-04-06",
        }),
      ]),
    );
  });

  it("summarizes sync, delivery, and analysis queues with dead letters", async () => {
    const runtime = new HetangOpsRuntime({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
      },
      resolveStateDir: () => "/tmp/openclaw",
      runCommandWithTimeout: vi.fn(),
    } as never);

    (runtime as any).getSchedulerStatus = vi.fn().mockResolvedValue({
      authority: "app-service-pollers",
      jobs: [
        { jobType: "sync", orchestrator: "sync", status: "pending" },
        { jobType: "build-report", orchestrator: "sync", status: "completed" },
        { jobType: "send-midday-brief", orchestrator: "delivery", status: "pending" },
        { jobType: "send-reactivation-push", orchestrator: "delivery", status: "waiting" },
      ],
      pollers: [],
    });
    (runtime as any).store = buildRuntimeStore({
      getAnalysisQueueSummary: vi.fn().mockResolvedValue({
        pendingCount: 2,
        runningCount: 1,
        completedCount: 8,
        failedCount: 3,
        jobDeliveryPendingCount: 1,
        jobDeliveryRetryingCount: 2,
        jobDeliveryAbandonedCount: 1,
        subscriberDeliveryPendingCount: 4,
        subscriberDeliveryRetryingCount: 1,
        subscriberDeliveryAbandonedCount: 2,
        unresolvedDeadLetterCount: 5,
      }),
    });

    const summary = await (runtime as any).getQueueStatus(new Date("2026-04-07T12:05:00+08:00"));

    expect(summary.sync).toMatchObject({
      pendingCount: 1,
      completedCount: 1,
    });
    expect(summary.delivery).toMatchObject({
      pendingCount: 1,
      waitingCount: 1,
    });
    expect(summary.analysis).toMatchObject({
      pendingCount: 2,
      runningCount: 1,
      failedCount: 3,
      unresolvedDeadLetterCount: 5,
      subscriberDeliveryAbandonedCount: 2,
    });
  });
});
