import { describe, expect, it, vi } from "vitest";
const {
  rebuildMemberDailySnapshotsForDateRangeMock,
  rebuildCustomerIntelligenceForDateRangeMock,
  rebuildMemberReactivationFeaturesForDateRangeMock,
  rebuildMemberReactivationStrategiesForDateRangeMock,
  rebuildMemberReactivationQueueForDateRangeMock,
} = vi.hoisted(() => ({
  rebuildMemberDailySnapshotsForDateRangeMock: vi.fn(),
  rebuildCustomerIntelligenceForDateRangeMock: vi.fn(),
  rebuildMemberReactivationFeaturesForDateRangeMock: vi.fn(),
  rebuildMemberReactivationStrategiesForDateRangeMock: vi.fn(),
  rebuildMemberReactivationQueueForDateRangeMock: vi.fn(),
}));

vi.mock("../customer-growth/history-backfill.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../customer-growth/history-backfill.js")>();
  return {
    ...actual,
    rebuildMemberDailySnapshotsForDateRange: rebuildMemberDailySnapshotsForDateRangeMock,
  };
});

vi.mock("../customer-growth/intelligence.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../customer-growth/intelligence.js")>();
  return {
    ...actual,
    rebuildCustomerIntelligenceForDateRange: rebuildCustomerIntelligenceForDateRangeMock,
  };
});

vi.mock("../customer-growth/reactivation/features.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../customer-growth/reactivation/features.js")>();
  return {
    ...actual,
    rebuildMemberReactivationFeaturesForDateRange: rebuildMemberReactivationFeaturesForDateRangeMock,
  };
});

vi.mock("../customer-growth/reactivation/strategy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../customer-growth/reactivation/strategy.js")>();
  return {
    ...actual,
    rebuildMemberReactivationStrategiesForDateRange:
      rebuildMemberReactivationStrategiesForDateRangeMock,
  };
});

vi.mock("../customer-growth/reactivation/queue.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../customer-growth/reactivation/queue.js")>();
  return {
    ...actual,
    rebuildMemberReactivationQueueForDateRange: rebuildMemberReactivationQueueForDateRangeMock,
  };
});

import { resolveHetangOpsConfig } from "../config.js";
import type { HetangStoreConfig } from "../types.js";
import { HetangSyncService } from "./sync-service.js";

type TestStoreConfig = Pick<HetangStoreConfig, "orgId" | "storeName"> & Partial<HetangStoreConfig>;

function buildConfig(params?: {
  stores?: TestStoreConfig[];
  sync?: Record<string, unknown>;
}) {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    sync: {
      historyBackfillDays: 45,
      ...(params?.sync ?? {}),
    },
    stores:
      params?.stores ?? [
        { orgId: "1001", storeName: "迎宾店" },
        { orgId: "1002", storeName: "义乌店" },
        { orgId: "1003", storeName: "华美店" },
      ],
  });
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function buildCoverageSnapshot(params: {
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  derivedComplete?: boolean;
}) {
  const start = Date.parse(`${params.startBizDate}T00:00:00Z`);
  const end = Date.parse(`${params.endBizDate}T00:00:00Z`);
  const dayCount = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const span = {
    rowCount: dayCount,
    dayCount,
    minBizDate: params.startBizDate,
    maxBizDate: params.endBizDate,
  };
  return {
    orgId: params.orgId,
    startBizDate: params.startBizDate,
    endBizDate: params.endBizDate,
    rawFacts: {
      "1.2": span,
      "1.3": span,
      "1.6": span,
    },
    derivedLayers: params.derivedComplete
      ? {
          factMemberDailySnapshot: span,
          martCustomerSegments: span,
          martCustomerConversionCohorts: span,
          mvCustomerProfile90d: span,
        }
      : {},
  };
}

function buildHistoricalSpan(startBizDate: string, endBizDate: string) {
  const start = Date.parse(`${startBizDate}T00:00:00Z`);
  const end = Date.parse(`${endBizDate}T00:00:00Z`);
  const dayCount = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  return {
    rowCount: dayCount,
    dayCount,
    minBizDate: startBizDate,
    maxBizDate: endBizDate,
  };
}

describe("HetangSyncService", () => {
  it("fails fast when the serving publication owner getter is missing", async () => {
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
      }),
      logger: buildLogger(),
      getStore: async () => ({}) as never,
    });

    await expect(service.repairAnalyticsViews()).rejects.toThrow(
      "sync-service requires store.getServingPublicationStore()",
    );
  });

  it("publishes analytics once after the full nightly sync wave completes", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const publishAnalyticsViews = vi.fn().mockResolvedValue("serving-v1");
    const store = {
      listRecentUserTradeCandidateCardIds: vi
        .fn()
        .mockImplementation(async ({ orgId }: { orgId: string }) =>
          orgId === "1001" ? ["card-001", "card-002"] : [],
        ),
      getServingPublicationStore: () => ({
        publishAnalyticsViews,
      }),
    };
    const service = new HetangSyncService({
      config: buildConfig(),
      logger: buildLogger(),
      getStore: async () => store as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:20:00+08:00"),
    });

    const lines = await service.syncStores({
      orgIds: ["1003", "1001", "1002"],
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(lines).toEqual([
      "迎宾店: sync complete",
      "义乌店: sync complete",
      "华美店: sync complete",
    ]);
    expect(syncStore).toHaveBeenCalledTimes(22);
    expect(publishAnalyticsViews).toHaveBeenCalledTimes(1);
    expect(publishAnalyticsViews).toHaveBeenCalledWith({
      publishedAt: "2026-03-30T19:10:00.000Z",
      notes: "nightly-sync:2026-03-30T19:10:00.000Z",
    });
  });

  it("reclaims stale daily sync runs before the full nightly sync wave", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const reclaimStaleSyncRuns = vi.fn().mockResolvedValue(2);
    const logger = buildLogger();
    const store = {
      reclaimStaleSyncRuns,
      listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([]),
      getServingPublicationStore: () => ({
        publishAnalyticsViews: vi.fn().mockResolvedValue("serving-v1"),
      }),
    };
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
      }),
      logger,
      getStore: async () => store as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:20:00+08:00"),
    });

    await service.syncStores({
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(reclaimStaleSyncRuns).toHaveBeenCalledWith({
      modes: ["daily"],
      reclaimedAt: "2026-03-30T19:10:00.000Z",
      staleBefore: "2026-03-30T15:10:00.000Z",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "hetang-ops: reclaimed 2 stale daily sync runs before nightly sync",
    );
  });

  it("does not reclaim stale sync runs for scoped manual sync", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const reclaimStaleSyncRuns = vi.fn().mockResolvedValue(2);
    const store = {
      reclaimStaleSyncRuns,
      listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([]),
      getServingPublicationStore: () => ({
        publishAnalyticsViews: vi.fn().mockResolvedValue("serving-v1"),
      }),
    };
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
      }),
      logger: buildLogger(),
      getStore: async () => store as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:20:00+08:00"),
    });

    await service.syncStores({
      orgIds: ["1001"],
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(reclaimStaleSyncRuns).not.toHaveBeenCalled();
  });

  it("always prioritizes 迎宾店 first during the nightly sync wave", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const store = {
      listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([]),
      getServingPublicationStore: () => ({
        publishAnalyticsViews: vi.fn().mockResolvedValue("serving-v1"),
      }),
    };
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [
          { orgId: "1002", storeName: "义乌店" },
          { orgId: "1003", storeName: "华美店" },
          { orgId: "1001", storeName: "迎宾店" },
        ],
      }),
      logger: buildLogger(),
      getStore: async () => store as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:20:00+08:00"),
    });

    const lines = await service.syncStores({
      orgIds: ["1002", "1003", "1001"],
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(lines).toEqual([
      "迎宾店: sync complete",
      "义乌店: sync complete",
      "华美店: sync complete",
    ]);
  });

  it("can defer serving publication until the full nightly api window finishes", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const publishAnalyticsViews = vi.fn().mockResolvedValue("serving-v1");
    const store = {
      listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([]),
      getServingPublicationStore: () => ({
        publishAnalyticsViews,
      }),
    };
    const service = new HetangSyncService({
      config: buildConfig(),
      logger: buildLogger(),
      getStore: async () => store as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:20:00+08:00"),
    });

    await service.syncStores({
      orgIds: ["1001", "1002"],
      now: new Date("2026-03-31T03:10:00+08:00"),
      publishAnalytics: false,
    });

    expect(publishAnalyticsViews).not.toHaveBeenCalled();
  });

  it("limits nightly user-trade candidate lookback to the configured overlap window", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const listRecentUserTradeCandidateCardIds = vi.fn().mockResolvedValue(["card-001"]);
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
        sync: {
          overlapDays: 3,
        },
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          listRecentUserTradeCandidateCardIds,
          getServingPublicationStore: () => ({
            publishAnalyticsViews: vi.fn().mockResolvedValue("serving-v1"),
          }),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:20:00+08:00"),
    });

    await service.syncStores({
      orgIds: ["1001"],
      now: new Date("2026-03-31T03:10:00+08:00"),
    });

    expect(listRecentUserTradeCandidateCardIds).toHaveBeenCalledWith({
      orgId: "1001",
      startBizDate: "2026-03-28",
      endBizDate: "2026-03-30",
    });
  });

  it("skips nightly backfill once the reserved probe budget window begins", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const publishAnalyticsViews = vi.fn().mockResolvedValue("serving-v1");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
        sync: {
          accessWindowEndLocalTime: "04:00",
        },
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          getHistoricalCoverageSnapshot: vi.fn().mockResolvedValue({
            orgId: "1001",
            startBizDate: "2026-02-14",
            endBizDate: "2026-03-30",
            rawFacts: {
              "1.2": { rowCount: 5, dayCount: 5, minBizDate: "2026-03-26", maxBizDate: "2026-03-30" },
              "1.3": { rowCount: 5, dayCount: 5, minBizDate: "2026-03-26", maxBizDate: "2026-03-30" },
              "1.4": { rowCount: 0, dayCount: 0 },
              "1.6": { rowCount: 5, dayCount: 5, minBizDate: "2026-03-26", maxBizDate: "2026-03-30" },
              "1.7": { rowCount: 0, dayCount: 0 },
            },
            derivedLayers: {},
          }),
          listMemberCardIds: vi.fn().mockResolvedValue([]),
          getServingPublicationStore: () => ({
            publishAnalyticsViews,
          }),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:57:00+08:00"),
    });

    const lines = await service.runNightlyHistoryBackfill(new Date("2026-03-31T03:57:00+08:00"), {
      publishAnalytics: false,
    });

    expect(lines).toEqual([]);
    expect(syncStore).not.toHaveBeenCalled();
    expect(publishAnalyticsViews).not.toHaveBeenCalled();
  });

  it("reclaims stale backfill sync runs before nightly history backfill planning", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const reclaimStaleSyncRuns = vi.fn().mockResolvedValue(3);
    const logger = buildLogger();
    const now = new Date("2026-03-31T03:12:00+08:00");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
      }),
      logger,
      getStore: async () =>
        ({
          reclaimStaleSyncRuns,
          getHistoricalCoverageSnapshot: vi.fn().mockImplementation(
            async ({
              orgId,
              startBizDate,
              endBizDate,
            }: {
              orgId: string;
              startBizDate: string;
              endBizDate: string;
            }) => ({
              orgId,
              startBizDate,
              endBizDate,
              rawFacts: {
                "1.2": buildHistoricalSpan(startBizDate, endBizDate),
                "1.3": buildHistoricalSpan(startBizDate, endBizDate),
                "1.4": buildHistoricalSpan(startBizDate, endBizDate),
                "1.6": buildHistoricalSpan(startBizDate, endBizDate),
                "1.7": buildHistoricalSpan(startBizDate, endBizDate),
              },
              derivedLayers: {},
            }),
          ),
          listMemberCardIds: vi.fn().mockResolvedValue([]),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: () => new Date("2026-03-31T03:20:00+08:00"),
    });

    const lines = await service.runNightlyHistoryBackfill(now, {
      publishAnalytics: false,
    });

    expect(lines).toEqual([]);
    expect(reclaimStaleSyncRuns).toHaveBeenCalledWith({
      modes: ["backfill"],
      reclaimedAt: "2026-03-30T19:12:00.000Z",
      staleBefore: "2026-03-30T15:12:00.000Z",
    });
    expect(logger.warn).toHaveBeenCalledWith(
      "hetang-ops: reclaimed 3 stale backfill sync runs before nightly history backfill",
    );
    expect(syncStore).not.toHaveBeenCalled();
  });

  it("backfills deferred large-store 1.4 gaps for the recent window with selected cards", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const publishAnalyticsViews = vi.fn().mockResolvedValue("serving-v1");
    const now = new Date("2026-03-31T03:12:00+08:00");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
        sync: {
          accessWindowEndLocalTime: "04:00",
        },
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          getScheduledJobState: vi.fn().mockResolvedValue(null),
          setScheduledJobState: vi.fn().mockResolvedValue(undefined),
          getHistoricalCoverageSnapshot: vi.fn().mockResolvedValue({
            orgId: "1001",
            startBizDate: "2026-02-14",
            endBizDate: "2026-03-30",
            rawFacts: {
              "1.2": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
              "1.3": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
              "1.4": {
                rowCount: 12,
                dayCount: 12,
                minBizDate: "2026-03-20",
                maxBizDate: "2026-03-30",
              },
              "1.6": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
              "1.7": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
            },
            derivedLayers: {},
          }),
          listMemberCardIds: vi.fn().mockResolvedValue(
            Array.from({ length: 500 }, (_value, index) => `card-${index}`),
          ),
          listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([
            "recent-card-001",
            "recent-card-002",
          ]),
          getServingPublicationStore: () => ({
            publishAnalyticsViews,
          }),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: vi
        .fn<() => Date>()
        .mockReturnValueOnce(new Date("2026-03-31T03:12:00+08:00"))
        .mockReturnValue(new Date("2026-03-31T04:01:00+08:00")),
    });

    const lines = await service.runNightlyHistoryBackfill(now, {
      publishAnalytics: false,
    });

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "backfill",
        skipEndpoints: ["1.1", "1.2", "1.3", "1.5", "1.6", "1.7", "1.8"],
        selectedCardIds: ["recent-card-001", "recent-card-002"],
        windowOverride: {
          startTime: "2026-03-01 03:00:00",
          endTime: "2026-03-22 02:59:59",
        },
      },
    });
    expect(lines).toEqual([
      "迎宾店 2026-03-01..2026-03-21: nightly backfill complete",
    ]);
  });

  it("uses the shared 2025-10-06 history floor for non-Yingbin stores", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-03-31T03:12:00+08:00");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1002", storeName: "义乌店" }],
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          getHistoricalCoverageSnapshot: vi.fn().mockImplementation(
            async ({
              orgId,
              startBizDate,
              endBizDate,
            }: {
              orgId: string;
              startBizDate: string;
              endBizDate: string;
            }) => ({
              orgId,
              startBizDate,
              endBizDate,
              rawFacts: {
                "1.2": {
                  rowCount: 20,
                  dayCount: 20,
                  minBizDate: "2025-11-01",
                  maxBizDate: endBizDate,
                },
                "1.3": buildHistoricalSpan(startBizDate, endBizDate),
                "1.4": buildHistoricalSpan(startBizDate, endBizDate),
                "1.6": buildHistoricalSpan(startBizDate, endBizDate),
                "1.7": buildHistoricalSpan(startBizDate, endBizDate),
              },
              derivedLayers: {},
            }),
          ),
          listMemberCardIds: vi.fn().mockResolvedValue([]),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: vi
        .fn<() => Date>()
        .mockReturnValueOnce(new Date("2026-03-31T03:12:00+08:00"))
        .mockReturnValue(new Date("2026-03-31T04:01:00+08:00")),
    });

    const lines = await service.runNightlyHistoryBackfill(now, {
      publishAnalytics: false,
      maxPasses: 1,
      maxPlans: 1,
    });

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1002",
      now,
      syncPlan: {
        mode: "backfill",
        skipEndpoints: ["1.1", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"],
        windowOverride: {
          startTime: "2025-10-06 03:00:00",
          endTime: "2025-10-13 02:59:59",
        },
      },
    });
    expect(lines).toEqual([
      "义乌店 2025-10-06..2025-10-12: nightly backfill complete",
    ]);
  });

  it("falls back to Yingbin full-history backfill once the recent window is complete", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const getHistoricalCoverageSnapshot = vi.fn().mockImplementation(
      async ({
        orgId,
        startBizDate,
        endBizDate,
      }: {
        orgId: string;
        startBizDate: string;
        endBizDate: string;
      }) => {
        if (startBizDate === "2026-03-01") {
          return {
            orgId,
            startBizDate,
            endBizDate,
            rawFacts: {
              "1.2": buildHistoricalSpan(startBizDate, endBizDate),
              "1.3": buildHistoricalSpan(startBizDate, endBizDate),
              "1.4": buildHistoricalSpan(startBizDate, endBizDate),
              "1.6": buildHistoricalSpan(startBizDate, endBizDate),
              "1.7": buildHistoricalSpan(startBizDate, endBizDate),
            },
            derivedLayers: {},
          };
        }

        return {
          orgId,
          startBizDate,
          endBizDate,
          rawFacts: {
            "1.2": {
              rowCount: 20,
              dayCount: 20,
              minBizDate: "2019-01-01",
              maxBizDate: endBizDate,
            },
            "1.3": buildHistoricalSpan(startBizDate, endBizDate),
            "1.4": buildHistoricalSpan(startBizDate, endBizDate),
            "1.6": buildHistoricalSpan(startBizDate, endBizDate),
            "1.7": buildHistoricalSpan(startBizDate, endBizDate),
          },
          derivedLayers: {},
        };
      },
    );
    const now = new Date("2026-03-31T03:12:00+08:00");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          getHistoricalCoverageSnapshot,
          listMemberCardIds: vi.fn().mockResolvedValue([]),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: vi
        .fn<() => Date>()
        .mockReturnValueOnce(new Date("2026-03-31T03:12:00+08:00"))
        .mockReturnValue(new Date("2026-03-31T04:01:00+08:00")),
    });

    const lines = await service.runNightlyHistoryBackfill(now, {
      publishAnalytics: false,
      maxPasses: 1,
      maxPlans: 1,
    });

    expect(getHistoricalCoverageSnapshot).toHaveBeenCalledTimes(2);
    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "backfill",
        skipEndpoints: ["1.1", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"],
        windowOverride: {
          startTime: "2018-12-02 03:00:00",
          endTime: "2018-12-09 02:59:59",
        },
      },
    });
    expect(lines).toEqual([
      "迎宾店 2018-12-02..2018-12-08: nightly backfill complete",
    ]);
  });

  it("can bound the unified history backfill to one coverage-aware pass per scheduler poll", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-03-31T10:30:00+08:00");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          getHistoricalCoverageSnapshot: vi.fn().mockResolvedValue({
            orgId: "1001",
            startBizDate: "2026-02-14",
            endBizDate: "2026-03-30",
            rawFacts: {
              "1.2": {
                rowCount: 12,
                dayCount: 12,
                minBizDate: "2026-03-20",
                maxBizDate: "2026-03-30",
              },
              "1.3": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
              "1.4": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
              "1.6": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
              "1.7": {
                rowCount: 45,
                dayCount: 45,
                minBizDate: "2026-02-14",
                maxBizDate: "2026-03-30",
              },
            },
            derivedLayers: {},
          }),
          listMemberCardIds: vi.fn().mockResolvedValue([]),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
      resolveNow: vi.fn<() => Date>().mockReturnValue(new Date("2026-03-31T10:31:00+08:00")),
    });

    const lines = await service.runNightlyHistoryBackfill(now, {
      publishAnalytics: false,
      maxPasses: 1,
    });

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([
      "迎宾店 2026-03-01..2026-03-07: nightly backfill complete",
    ]);
  });

  it("repairs missing daytime coverage in bounded batches with selected cards for deferred 1.4 gaps", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const publishAnalyticsViews = vi.fn().mockResolvedValue("serving-v1");
    const now = new Date("2026-03-31T10:30:00+08:00");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [
          { orgId: "1001", storeName: "迎宾店" },
          { orgId: "1002", storeName: "义乌店" },
        ],
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          getHistoricalCoverageSnapshot: vi.fn().mockImplementation(
            async ({
              orgId,
              startBizDate,
              endBizDate,
            }: {
              orgId: string;
              startBizDate: string;
              endBizDate: string;
            }) => ({
              orgId,
              startBizDate,
              endBizDate,
              rawFacts:
                orgId === "1001"
                  ? {
                      "1.2": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                      "1.3": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                      "1.4": {
                        rowCount: 12,
                        dayCount: 12,
                        minBizDate: "2026-03-20",
                        maxBizDate: endBizDate,
                      },
                      "1.6": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                      "1.7": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                    }
                  : {
                      "1.2": {
                        rowCount: 10,
                        dayCount: 10,
                        minBizDate: "2026-03-22",
                        maxBizDate: endBizDate,
                      },
                      "1.3": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                      "1.4": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                      "1.6": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                      "1.7": {
                        rowCount: 45,
                        dayCount: 45,
                        minBizDate: startBizDate,
                        maxBizDate: endBizDate,
                      },
                    },
              derivedLayers: {},
            }),
          ),
          listMemberCardIds: vi.fn().mockImplementation(async (orgId: string) =>
            orgId === "1001"
              ? Array.from({ length: 500 }, (_value, index) => `card-${index}`)
              : Array.from({ length: 10 }, (_value, index) => `small-card-${index}`),
          ),
          listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([
            "recent-card-001",
            "recent-card-002",
          ]),
          getServingPublicationStore: () => ({
            publishAnalyticsViews,
          }),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const lines = await service.repairMissingCoverage({
      now,
      maxPlans: 1,
    });

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1001",
      now,
      syncPlan: {
        mode: "backfill",
        skipEndpoints: ["1.1", "1.2", "1.3", "1.5", "1.6", "1.7", "1.8"],
        selectedCardIds: ["recent-card-001", "recent-card-002"],
      },
      publishAnalytics: false,
    });
    expect(lines).toEqual([
      "迎宾店 2026-03-01..2026-03-21: coverage repair complete",
    ]);
    expect(publishAnalyticsViews).toHaveBeenCalledTimes(1);
  });

  it("uses recent candidate cards for daytime 1.4 repair even on smaller stores", async () => {
    const syncStore = vi.fn().mockResolvedValue(undefined);
    const publishAnalyticsViews = vi.fn().mockResolvedValue("serving-v1");
    const now = new Date("2026-04-14T11:30:00+08:00");
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1002", storeName: "园中园店" }],
      }),
      logger: buildLogger(),
      getStore: async () =>
        ({
          getHistoricalCoverageSnapshot: vi.fn().mockImplementation(
            async ({
              orgId,
              startBizDate,
              endBizDate,
            }: {
              orgId: string;
              startBizDate: string;
              endBizDate: string;
            }) => ({
              orgId,
              startBizDate,
              endBizDate,
              rawFacts: {
                "1.2": {
                  rowCount: 3,
                  dayCount: 3,
                  minBizDate: startBizDate,
                  maxBizDate: endBizDate,
                },
                "1.3": {
                  rowCount: 3,
                  dayCount: 3,
                  minBizDate: startBizDate,
                  maxBizDate: endBizDate,
                },
                "1.4": {
                  rowCount: 0,
                  dayCount: 0,
                },
                "1.6": {
                  rowCount: 3,
                  dayCount: 3,
                  minBizDate: startBizDate,
                  maxBizDate: endBizDate,
                },
                "1.7": {
                  rowCount: 3,
                  dayCount: 3,
                  minBizDate: startBizDate,
                  maxBizDate: endBizDate,
                },
              },
              derivedLayers: {},
            }),
          ),
          listMemberCardIds: vi.fn().mockResolvedValue(
            Array.from({ length: 10 }, (_value, index) => `small-card-${index}`),
          ),
          listRecentUserTradeCandidateCardIds: vi.fn().mockResolvedValue([
            "recent-card-101",
            "recent-card-102",
          ]),
          getServingPublicationStore: () => ({
            publishAnalyticsViews,
          }),
        }) as never,
      syncStore,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await service.repairMissingCoverage({
      now,
      startBizDate: "2026-04-11",
      endBizDate: "2026-04-13",
      maxPlans: 1,
    });

    expect(syncStore).toHaveBeenCalledTimes(1);
    expect(syncStore.mock.calls[0]?.[0]).toMatchObject({
      orgId: "1002",
      now,
      syncPlan: {
        mode: "backfill",
        selectedCardIds: ["recent-card-101", "recent-card-102"],
      },
      publishAnalytics: false,
    });
    expect(publishAnalyticsViews).toHaveBeenCalledTimes(1);
  });

  it("rebuilds customer history across stores and refreshes analytics only once after the batch", async () => {
    rebuildMemberDailySnapshotsForDateRangeMock.mockResolvedValue(undefined);
    rebuildCustomerIntelligenceForDateRangeMock.mockResolvedValue(undefined);
    rebuildMemberReactivationFeaturesForDateRangeMock.mockResolvedValue(undefined);
    rebuildMemberReactivationStrategiesForDateRangeMock.mockResolvedValue(undefined);
    rebuildMemberReactivationQueueForDateRangeMock.mockResolvedValue(undefined);

    const forceRebuildAnalyticsViews = vi.fn().mockResolvedValue(undefined);
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const store = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      setScheduledJobState,
      getHistoricalCoverageSnapshot: vi.fn().mockImplementation(
        async ({
          orgId,
          startBizDate,
          endBizDate,
        }: {
          orgId: string;
          startBizDate: string;
          endBizDate: string;
        }) => buildCoverageSnapshot({ orgId, startBizDate, endBizDate }),
      ),
      getServingPublicationStore: () => ({
        forceRebuildAnalyticsViews,
      }),
    };
    const service = new HetangSyncService({
      config: buildConfig(),
      logger: buildLogger(),
      getStore: async () => store as never,
    });

    const result = await service.runCustomerHistoryCatchup({
      bizDate: "2026-04-10",
      orgIds: ["1001", "1002"],
    });

    expect(rebuildMemberDailySnapshotsForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildCustomerIntelligenceForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildMemberReactivationFeaturesForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildMemberReactivationStrategiesForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(rebuildMemberReactivationQueueForDateRangeMock).toHaveBeenCalledTimes(2);
    expect(forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
    expect(setScheduledJobState).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      lines: [
        "迎宾店: customer history catchup complete (2026-02-25..2026-04-10)",
        "义乌店: customer history catchup complete (2026-02-25..2026-04-10)",
      ],
      allComplete: true,
    });
  });

  it("rebuilds the current-day customer tail when snapshots are ready and derived layers only lag at the tail", async () => {
    rebuildMemberDailySnapshotsForDateRangeMock.mockResolvedValue(undefined);
    rebuildCustomerIntelligenceForDateRangeMock.mockResolvedValue(undefined);
    rebuildMemberReactivationFeaturesForDateRangeMock.mockResolvedValue(undefined);
    rebuildMemberReactivationStrategiesForDateRangeMock.mockResolvedValue(undefined);
    rebuildMemberReactivationQueueForDateRangeMock.mockResolvedValue(undefined);

    const forceRebuildAnalyticsViews = vi.fn().mockResolvedValue(undefined);
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const store = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      setScheduledJobState,
      getHistoricalCoverageSnapshot: vi.fn().mockImplementation(
        async ({
          orgId,
          startBizDate,
          endBizDate,
        }: {
          orgId: string;
          startBizDate: string;
          endBizDate: string;
        }) => ({
          orgId,
          startBizDate,
          endBizDate,
          rawFacts: {
            "1.2": {
              rowCount: 40,
              dayCount: 40,
              minBizDate: startBizDate,
              maxBizDate: "2026-04-17",
              firstMissingBizDate: "2026-03-09",
            },
            "1.3": {
              rowCount: 39,
              dayCount: 39,
              minBizDate: startBizDate,
              maxBizDate: "2026-04-17",
              firstMissingBizDate: "2026-03-10",
            },
            "1.6": {
              rowCount: 41,
              dayCount: 41,
              minBizDate: startBizDate,
              maxBizDate: "2026-04-17",
              firstMissingBizDate: "2026-03-08",
            },
          },
          derivedLayers: {
            factMemberDailySnapshot: buildHistoricalSpan(startBizDate, endBizDate),
            martCustomerSegments: buildHistoricalSpan(startBizDate, "2026-04-17"),
            martCustomerConversionCohorts: {
              rowCount: 0,
              dayCount: 0,
            },
            mvCustomerProfile90d: buildHistoricalSpan(startBizDate, "2026-04-17"),
          },
        }),
      ),
      getServingPublicationStore: () => ({
        forceRebuildAnalyticsViews,
      }),
    };
    const service = new HetangSyncService({
      config: buildConfig({
        stores: [{ orgId: "1001", storeName: "迎宾店" }],
      }),
      logger: buildLogger(),
      getStore: async () => store as never,
    });

    const result = await service.runCustomerHistoryCatchup({
      bizDate: "2026-04-18",
      orgIds: ["1001"],
    });

    expect(rebuildMemberDailySnapshotsForDateRangeMock).toHaveBeenCalledWith({
      store: store,
      orgId: "1001",
      startBizDate: "2026-04-18",
      endBizDate: "2026-04-18",
    });
    expect(rebuildCustomerIntelligenceForDateRangeMock).toHaveBeenCalledWith({
      store: store,
      orgId: "1001",
      startBizDate: "2026-04-18",
      endBizDate: "2026-04-18",
      refreshViews: false,
      chunkDays: 14,
      storeConfig: {
        orgId: "1001",
        storeName: "迎宾店",
        rawAliases: [],
        isActive: true,
        notification: undefined,
        customerGrowth: undefined,
        roomCount: undefined,
        operatingHoursPerDay: undefined,
        fixedMonthlyCost: undefined,
        variableCostRate: undefined,
        materialCostRate: undefined,
      },
    });
    expect(rebuildMemberReactivationFeaturesForDateRangeMock).toHaveBeenCalledWith({
      store: store,
      orgId: "1001",
      startBizDate: "2026-04-18",
      endBizDate: "2026-04-18",
      refreshViews: false,
    });
    expect(rebuildMemberReactivationStrategiesForDateRangeMock).toHaveBeenCalledWith({
      store: store,
      orgId: "1001",
      startBizDate: "2026-04-18",
      endBizDate: "2026-04-18",
      refreshViews: false,
      storeConfig: expect.objectContaining({
        orgId: "1001",
        storeName: "迎宾店",
      }),
    });
    expect(rebuildMemberReactivationQueueForDateRangeMock).toHaveBeenCalledWith({
      store: store,
      orgId: "1001",
      startBizDate: "2026-04-18",
      endBizDate: "2026-04-18",
      refreshViews: false,
      storeConfig: expect.objectContaining({
        orgId: "1001",
        storeName: "迎宾店",
      }),
    });
    expect(forceRebuildAnalyticsViews).toHaveBeenCalledTimes(1);
    expect(setScheduledJobState).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      lines: ["迎宾店: customer history catchup complete (2026-04-18..2026-04-18)"],
      allComplete: true,
    });
  });
});
