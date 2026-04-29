import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { HetangSyncOrchestrator } from "./sync-orchestrator.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: "1001", storeName: "一号店" }],
    reporting: {
      sendFiveStoreDailyOverviewEnabled: false,
    },
  });
}

describe("HetangSyncOrchestrator.runDueJobs", () => {
  it("runs nightly conversation review on the sync orchestrator and marks completion", async () => {
    const tryAdvisoryLock = vi.fn().mockResolvedValue(true);
    const listCompletedRunKeys = vi
      .fn()
      .mockResolvedValue(
        new Set([
          "sync:2026-03-31",
          "nightly-history-backfill:2026-03-31",
          "run-customer-history-catchup:2026-03-30",
        ]),
      );
    const releaseAdvisoryLock = vi.fn().mockResolvedValue(undefined);
    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const runNightlyConversationReview = vi
      .fn()
      .mockResolvedValue(["conversation review completed"]);
    const sendWeeklyReport = vi.fn().mockResolvedValue("weekly report sent");
    const sendWeeklyChartImage = vi.fn().mockResolvedValue("weekly chart image sent");
    const orchestrator = new HetangSyncOrchestrator({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      getStore: async () =>
        ({
          tryAdvisoryLock,
          releaseAdvisoryLock,
          listCompletedRunKeys,
          markScheduledJobCompleted,
          getDailyReport: vi.fn().mockResolvedValue(null),
        }) as never,
      syncStores: vi.fn().mockResolvedValue(["sync ok"]),
      runNightlyHistoryBackfill: vi.fn().mockResolvedValue(["backfill ok"]),
      runNightlyApiHistoryDepthProbe: vi.fn().mockResolvedValue(["probe ok"]),
      publishNightlyServingViews: vi.fn().mockResolvedValue(undefined),
      runCustomerHistoryCatchup: vi.fn().mockResolvedValue({ lines: [], allComplete: true }),
      runNightlyConversationReview,
      buildAllStoreEnvironmentMemory: vi.fn().mockResolvedValue([]),
      buildAllReports: vi.fn().mockResolvedValue([]),
      auditDailyReportWindow: vi.fn().mockResolvedValue({
        summary: {
          status: "healthy",
          endBizDate: "2026-03-30",
          windowDays: 7,
          dates: ["2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"],
          storeCount: 1,
          checkedReports: 7,
          reportsWithFreshMismatch: 0,
          reportsWithStoredMismatch: 0,
          reportsWithOnlyMissingStored: 0,
          maxUnauditedMetricCount: 0,
          unauditedKeys: [],
          sampleIssues: [],
        },
        lines: [],
      }),
      buildExternalBriefIssue: vi.fn().mockResolvedValue(null),
      sendAllMiddayBriefs: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendAllReactivationPushes: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendFiveStoreDailyOverview: vi.fn().mockResolvedValue("five-store daily overview sent"),
      sendWeeklyReport: sendWeeklyReport as unknown as (params: {
        weekEndBizDate?: string;
        now?: Date;
      }) => Promise<string>,
      sendWeeklyChartImage: sendWeeklyChartImage as unknown as (params: {
        weekEndBizDate?: string;
        now?: Date;
      }) => Promise<string>,
      sendNotificationMessage: vi.fn().mockResolvedValue(undefined),
      sendReport: vi.fn().mockResolvedValue("report sent") as unknown as (params: {
        orgId: string;
        bizDate?: string;
        now?: Date;
      }) => Promise<string>,
    });

    const now = new Date("2026-03-31T04:20:00+08:00");
    const lines = await (orchestrator as any).runDueJobs(now, { orchestrators: ["sync"] });

    expect(lines).toEqual(["conversation review completed"]);
    expect(runNightlyConversationReview).toHaveBeenCalledWith(now);
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "nightly-conversation-review",
      "2026-03-31",
      now.toISOString(),
    );
  });

  it("uses independent scoped leases so delivery can run while the sync lane is blocked", async () => {
    const tryAdvisoryLock = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const listCompletedRunKeys = vi.fn().mockResolvedValue(new Set<string>());
    const releaseAdvisoryLock = vi.fn().mockResolvedValue(undefined);
    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const getDailyReport = vi.fn().mockResolvedValue(null);
    const sendReport = vi.fn().mockResolvedValue("一号店: report sent");
    const sendWeeklyReport = vi.fn().mockResolvedValue("weekly report sent");
    const sendWeeklyChartImage = vi.fn().mockResolvedValue("weekly chart image sent");
    const config = buildConfig();
    const orchestrator = new HetangSyncOrchestrator({
      config,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      getStore: async () =>
        ({
          tryAdvisoryLock,
          releaseAdvisoryLock,
          listCompletedRunKeys,
          markScheduledJobCompleted,
          getDailyReport,
        }) as never,
      syncStores: vi.fn().mockResolvedValue(["sync ok"]),
      runNightlyHistoryBackfill: vi.fn().mockResolvedValue(["backfill ok"]),
      runNightlyApiHistoryDepthProbe: vi.fn().mockResolvedValue(["probe ok"]),
      publishNightlyServingViews: vi.fn().mockResolvedValue(undefined),
      runCustomerHistoryCatchup: vi.fn().mockResolvedValue({ lines: [], allComplete: true }),
      runNightlyConversationReview: vi.fn().mockResolvedValue([]),
      buildAllStoreEnvironmentMemory: vi.fn().mockResolvedValue([]),
      buildAllReports: vi.fn().mockResolvedValue([]),
      auditDailyReportWindow: vi.fn().mockResolvedValue({
        summary: {
          status: "healthy",
          endBizDate: "2026-03-30",
          windowDays: 7,
          dates: ["2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"],
          storeCount: 1,
          checkedReports: 7,
          reportsWithFreshMismatch: 0,
          reportsWithStoredMismatch: 0,
          reportsWithOnlyMissingStored: 0,
          maxUnauditedMetricCount: 0,
          unauditedKeys: [],
          sampleIssues: [],
        },
        lines: [],
      }),
      buildExternalBriefIssue: vi.fn().mockResolvedValue(null),
      sendAllMiddayBriefs: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendAllReactivationPushes: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendFiveStoreDailyOverview: vi.fn().mockResolvedValue("five-store daily overview sent"),
      sendWeeklyReport: sendWeeklyReport as unknown as (params: {
        weekEndBizDate?: string;
        now?: Date;
      }) => Promise<string>,
      sendWeeklyChartImage: sendWeeklyChartImage as unknown as (params: {
        weekEndBizDate?: string;
        now?: Date;
      }) => Promise<string>,
      sendNotificationMessage: vi.fn().mockResolvedValue(undefined),
      sendReport: sendReport as unknown as (params: {
        orgId: string;
        bizDate?: string;
        now?: Date;
      }) => Promise<string>,
    });

    const syncLines = await (orchestrator as any).runDueJobs(
      new Date("2026-03-31T10:05:00+08:00"),
      { orchestrators: ["sync"] },
    );
    const deliveryLines = await (orchestrator as any).runDueJobs(
      new Date("2026-03-31T10:05:00+08:00"),
      { orchestrators: ["delivery"] },
    );

    expect(syncLines).toEqual([]);
    expect(deliveryLines).toEqual(["一号店: report sent"]);
    expect(tryAdvisoryLock).toHaveBeenCalledTimes(2);
    expect(tryAdvisoryLock.mock.calls[0]?.[0]).not.toBe(tryAdvisoryLock.mock.calls[1]?.[0]);
    expect(listCompletedRunKeys).toHaveBeenCalledTimes(1);
    expect(sendReport).toHaveBeenCalledWith({
      orgId: "1001",
      bizDate: "2026-03-30",
      now: new Date("2026-03-31T10:05:00+08:00"),
    });
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-report",
      "2026-03-30",
      "2026-03-31T02:05:00.000Z",
    );
    expect(releaseAdvisoryLock).toHaveBeenCalledTimes(1);
  });

  it("builds environment memory before building reports on the sync orchestrator", async () => {
    const now = new Date("2026-03-31T08:55:00+08:00");
    const tryAdvisoryLock = vi.fn().mockResolvedValue(true);
    const listCompletedRunKeys = vi
      .fn()
      .mockResolvedValue(
        new Set([
          "sync:2026-03-31",
          "nightly-history-backfill:2026-03-31",
          "run-customer-history-catchup:2026-03-30",
          "nightly-conversation-review:2026-03-31",
        ]),
      );
    const releaseAdvisoryLock = vi.fn().mockResolvedValue(undefined);
    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const buildAllStoreEnvironmentMemory = vi
      .fn()
      .mockResolvedValue(["2026-03-30 store environment memory built"]);
    const buildAllReports = vi.fn().mockResolvedValue([]);
    const orchestrator = new HetangSyncOrchestrator({
      config: buildConfig(),
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      getStore: async () =>
        ({
          tryAdvisoryLock,
          releaseAdvisoryLock,
          listCompletedRunKeys,
          markScheduledJobCompleted,
          getDailyReport: vi.fn().mockResolvedValue(null),
        }) as never,
      syncStores: vi.fn().mockResolvedValue(["sync ok"]),
      runNightlyHistoryBackfill: vi.fn().mockResolvedValue(["backfill ok"]),
      runNightlyApiHistoryDepthProbe: vi.fn().mockResolvedValue(["probe ok"]),
      publishNightlyServingViews: vi.fn().mockResolvedValue(undefined),
      runCustomerHistoryCatchup: vi.fn().mockResolvedValue({ lines: [], allComplete: true }),
      runNightlyConversationReview: vi.fn().mockResolvedValue([]),
      buildAllStoreEnvironmentMemory,
      buildAllReports,
      auditDailyReportWindow: vi.fn().mockResolvedValue({
        summary: {
          status: "healthy",
          endBizDate: "2026-03-30",
          windowDays: 7,
          dates: ["2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"],
          storeCount: 1,
          checkedReports: 7,
          reportsWithFreshMismatch: 0,
          reportsWithStoredMismatch: 0,
          reportsWithOnlyMissingStored: 0,
          maxUnauditedMetricCount: 0,
          unauditedKeys: [],
          sampleIssues: [],
        },
        lines: [],
      }),
      buildExternalBriefIssue: vi.fn().mockResolvedValue(null),
      sendAllMiddayBriefs: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendAllReactivationPushes: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendFiveStoreDailyOverview: vi.fn().mockResolvedValue("five-store daily overview sent"),
      sendWeeklyReport: vi.fn().mockResolvedValue("weekly report sent"),
      sendWeeklyChartImage: vi.fn().mockResolvedValue("weekly chart image sent"),
      sendNotificationMessage: vi.fn().mockResolvedValue(undefined),
      sendReport: vi.fn().mockResolvedValue("report sent"),
    });

    const lines = await (orchestrator as any).runDueJobs(now, { orchestrators: ["sync"] });

    expect(lines).toContain("2026-03-30 store environment memory built");
    expect(buildAllStoreEnvironmentMemory).toHaveBeenCalledWith({
      bizDate: "2026-03-30",
      now,
    });
    expect(buildAllReports).toHaveBeenCalledWith({
      bizDate: "2026-03-30",
      now,
    });
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "build-store-environment-memory",
      "2026-03-30",
      now.toISOString(),
    );
  });

  it("waits for the daily report window audit until build-report completes", async () => {
    const now = new Date("2026-03-31T08:55:00+08:00");
    const tryAdvisoryLock = vi.fn().mockResolvedValue(true);
    const listCompletedRunKeys = vi
      .fn()
      .mockResolvedValue(
        new Set([
          "sync:2026-03-31",
          "nightly-history-backfill:2026-03-31",
          "run-customer-history-catchup:2026-03-30",
          "nightly-conversation-review:2026-03-31",
        ]),
      );
    const releaseAdvisoryLock = vi.fn().mockResolvedValue(undefined);
    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const buildAllStoreEnvironmentMemory = vi
      .fn()
      .mockResolvedValue(["一号店: environment memory build failed"]);
    const auditDailyReportWindow = vi.fn().mockResolvedValue({
      summary: {
        status: "healthy",
      },
      lines: ["2026-03-30 report audit ok - dates=7 stores=1 checked=7 fresh=0 stored=0 missing=0 unaudited=0"],
    });

    const orchestrator = new HetangSyncOrchestrator({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () =>
        ({
          tryAdvisoryLock,
          releaseAdvisoryLock,
          listCompletedRunKeys,
          markScheduledJobCompleted,
          setScheduledJobState,
          getDailyReport: vi.fn().mockResolvedValue(null),
        }) as never,
      syncStores: vi.fn().mockResolvedValue(["sync ok"]),
      runNightlyHistoryBackfill: vi.fn().mockResolvedValue(["backfill ok"]),
      runNightlyApiHistoryDepthProbe: vi.fn().mockResolvedValue(["probe ok"]),
      publishNightlyServingViews: vi.fn().mockResolvedValue(undefined),
      runCustomerHistoryCatchup: vi.fn().mockResolvedValue({ lines: [], allComplete: true }),
      runNightlyConversationReview: vi.fn().mockResolvedValue([]),
      buildAllStoreEnvironmentMemory,
      buildAllReports: vi.fn().mockResolvedValue([]),
      buildExternalBriefIssue: vi.fn().mockResolvedValue(null),
      sendAllMiddayBriefs: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendAllReactivationPushes: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendFiveStoreDailyOverview: vi.fn().mockResolvedValue("five-store daily overview sent"),
      sendWeeklyReport: vi.fn().mockResolvedValue("weekly report sent"),
      sendWeeklyChartImage: vi.fn().mockResolvedValue("weekly chart image sent"),
      sendNotificationMessage: vi.fn().mockResolvedValue(undefined),
      sendReport: vi.fn().mockResolvedValue("report sent"),
      auditDailyReportWindow,
    } as any);

    const lines = await orchestrator.runDueJobs(now, { orchestrators: ["sync"] });

    expect(lines).toContain("2026-03-30 build report waiting - environment memory not ready");
    expect(lines).toContain("2026-03-30 report audit waiting - build-report not completed");
    expect(auditDailyReportWindow).not.toHaveBeenCalled();
    expect(setScheduledJobState).not.toHaveBeenCalled();
  });

  it("persists the daily report window audit summary after build-report completes", async () => {
    const now = new Date("2026-03-31T08:55:00+08:00");
    const tryAdvisoryLock = vi.fn().mockResolvedValue(true);
    const listCompletedRunKeys = vi
      .fn()
      .mockResolvedValue(
        new Set([
          "sync:2026-03-31",
          "nightly-history-backfill:2026-03-31",
          "run-customer-history-catchup:2026-03-30",
          "nightly-conversation-review:2026-03-31",
        ]),
      );
    const releaseAdvisoryLock = vi.fn().mockResolvedValue(undefined);
    const markScheduledJobCompleted = vi.fn().mockResolvedValue(undefined);
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const auditSummary = {
      status: "warn",
      endBizDate: "2026-03-30",
      windowDays: 7,
      dates: [
        "2026-03-24",
        "2026-03-25",
        "2026-03-26",
        "2026-03-27",
        "2026-03-28",
        "2026-03-29",
        "2026-03-30",
      ],
      storeCount: 1,
      checkedReports: 7,
      reportsWithFreshMismatch: 0,
      reportsWithStoredMismatch: 1,
      reportsWithOnlyMissingStored: 0,
      maxUnauditedMetricCount: 1,
      unauditedKeys: ["groupbuy7dCardOpenedRate"],
      sampleIssues: [
        {
          orgId: "1001",
          storeName: "一号店",
          bizDate: "2026-03-30",
          topDiffs: [{ metricKey: "groupbuy7dCardOpenedRate", status: "stored_mismatch" }],
        },
      ],
    };
    const auditDailyReportWindow = vi.fn().mockResolvedValue({
      summary: auditSummary,
      lines: [
        "2026-03-30 report audit warn - dates=7 stores=1 checked=7 fresh=0 stored=1 missing=0 unaudited=1 sample=一号店@2026-03-30:groupbuy7dCardOpenedRate",
      ],
    });

    const orchestrator = new HetangSyncOrchestrator({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () =>
        ({
          tryAdvisoryLock,
          releaseAdvisoryLock,
          listCompletedRunKeys,
          markScheduledJobCompleted,
          setScheduledJobState,
          getDailyReport: vi.fn().mockResolvedValue(null),
        }) as never,
      syncStores: vi.fn().mockResolvedValue(["sync ok"]),
      runNightlyHistoryBackfill: vi.fn().mockResolvedValue(["backfill ok"]),
      runNightlyApiHistoryDepthProbe: vi.fn().mockResolvedValue(["probe ok"]),
      publishNightlyServingViews: vi.fn().mockResolvedValue(undefined),
      runCustomerHistoryCatchup: vi.fn().mockResolvedValue({ lines: [], allComplete: true }),
      runNightlyConversationReview: vi.fn().mockResolvedValue([]),
      buildAllStoreEnvironmentMemory: vi.fn().mockResolvedValue(["2026-03-30 store environment memory built"]),
      buildAllReports: vi.fn().mockResolvedValue([]),
      buildExternalBriefIssue: vi.fn().mockResolvedValue(null),
      sendAllMiddayBriefs: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendAllReactivationPushes: vi.fn().mockResolvedValue({ lines: [], allSent: true }),
      sendFiveStoreDailyOverview: vi.fn().mockResolvedValue("five-store daily overview sent"),
      sendWeeklyReport: vi.fn().mockResolvedValue("weekly report sent"),
      sendWeeklyChartImage: vi.fn().mockResolvedValue("weekly chart image sent"),
      sendNotificationMessage: vi.fn().mockResolvedValue(undefined),
      sendReport: vi.fn().mockResolvedValue("report sent"),
      auditDailyReportWindow,
    } as any);

    const lines = await orchestrator.runDueJobs(now, { orchestrators: ["sync"] });

    expect(auditDailyReportWindow).toHaveBeenCalledWith({
      bizDate: "2026-03-30",
      now,
    });
    expect(lines).toContain(
      "2026-03-30 report audit warn - dates=7 stores=1 checked=7 fresh=0 stored=1 missing=0 unaudited=1 sample=一号店@2026-03-30:groupbuy7dCardOpenedRate",
    );
    expect(setScheduledJobState).toHaveBeenCalledWith(
      "audit-daily-report-window",
      "2026-03-30",
      auditSummary,
      now.toISOString(),
    );
    expect(markScheduledJobCompleted).toHaveBeenCalledWith(
      "audit-daily-report-window",
      "2026-03-30",
      now.toISOString(),
    );
  });
});
