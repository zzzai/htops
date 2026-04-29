import { describe, expect, it, vi } from "vitest";

import { resolveHetangOpsConfig } from "./config.js";
import { HetangSyncOrchestrator } from "./sync-orchestrator.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: { appKey: "demo", appSecret: "demo" },
    database: { url: "postgresql://demo:demo@127.0.0.1:5432/demo" },
    stores: [{ orgId: "1001", storeName: "迎宾店" }],
    sync: {
      enabled: false,
      historyBackfillEnabled: false,
    },
    reporting: {
      enabled: true,
      buildAtLocalTime: "23:59",
      sendAtLocalTime: "10:00",
      fiveStoreDailyOverviewAtLocalTime: "10:03",
      sendReportEnabled: true,
      sendFiveStoreDailyOverviewEnabled: true,
      sendWeeklyReportEnabled: false,
      sendMiddayBriefEnabled: false,
      sendReactivationPushEnabled: false,
    },
  });
}

function buildFakeStore(initialCompletedRunKeys: string[] = []) {
  const completedRunKeys = new Set(initialCompletedRunKeys);
  return {
    tryAdvisoryLock: vi.fn(async () => true),
    releaseAdvisoryLock: vi.fn(async () => undefined),
    listCompletedRunKeys: vi.fn(async () => new Set(completedRunKeys)),
    markScheduledJobCompleted: vi.fn(
      async (jobType: string, runKey: string) => completedRunKeys.add(`${jobType}:${runKey}`),
    ),
    getDailyReport: vi.fn(async () => null),
  };
}

function buildOrchestrator(params: {
  sendReport: ReturnType<typeof vi.fn>;
  sendFiveStoreDailyOverview?: ReturnType<typeof vi.fn>;
  store?: ReturnType<typeof buildFakeStore>;
}) {
  const store = params.store ?? buildFakeStore();
  const sendFiveStoreDailyOverview =
    params.sendFiveStoreDailyOverview ??
    vi.fn(
      async ({ bizDate }: { bizDate?: string }) =>
        `five-store daily overview sent for ${bizDate}`,
    );
  const sendWeeklyReport = vi.fn(async () => "weekly report sent");
  const sendWeeklyChartImage = vi.fn(async () => "weekly chart image sent");

  return {
    store,
    sendFiveStoreDailyOverview,
    orchestrator: new HetangSyncOrchestrator({
      config: buildConfig(),
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      getStore: async () => store as never,
      syncStores: vi.fn(async () => []),
      runNightlyHistoryBackfill: vi.fn(async () => []),
      runNightlyApiHistoryDepthProbe: vi.fn(async () => []),
      publishNightlyServingViews: vi.fn(async () => undefined),
      runCustomerHistoryCatchup: vi.fn(async () => ({ lines: [], allComplete: true })),
      runNightlyConversationReview: vi.fn(async () => []),
      buildAllStoreEnvironmentMemory: vi.fn(async () => []),
      buildAllReports: vi.fn(async () => []),
      auditDailyReportWindow: vi.fn(async () => ({
        summary: {
          status: "healthy" as const,
          endBizDate: "2026-04-22",
          windowDays: 7,
          dates: ["2026-04-16", "2026-04-17", "2026-04-18", "2026-04-19", "2026-04-20", "2026-04-21", "2026-04-22"],
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
      })),
      buildExternalBriefIssue: vi.fn(async () => null),
      sendAllMiddayBriefs: vi.fn(async () => ({ lines: [], allSent: true })),
      sendAllReactivationPushes: vi.fn(async () => ({ lines: [], allSent: true })),
      sendFiveStoreDailyOverview:
        sendFiveStoreDailyOverview as unknown as (params: {
          bizDate?: string;
          now?: Date;
        }) => Promise<string>,
      sendWeeklyReport: sendWeeklyReport as unknown as (params: {
        weekEndBizDate?: string;
        now?: Date;
      }) => Promise<string>,
      sendWeeklyChartImage: sendWeeklyChartImage as unknown as (params: {
        weekEndBizDate?: string;
        now?: Date;
      }) => Promise<string>,
      sendNotificationMessage: vi.fn(async () => undefined),
      sendReport: params.sendReport as unknown as (params: {
        orgId: string;
        bizDate?: string;
        now?: Date;
      }) => Promise<string>,
    }),
  };
}

describe("HetangSyncOrchestrator five-store daily overview delivery", () => {
  it("waits for the five-store overview when daily reports are not fully sent", async () => {
    const sendReport = vi.fn(async () => {
      throw new Error("wecom down");
    });
    const { orchestrator, sendFiveStoreDailyOverview, store } = buildOrchestrator({
      sendReport,
    });

    const lines = await orchestrator.runDueJobs(new Date("2026-04-23T02:04:00Z"));

    expect(sendReport).toHaveBeenCalledTimes(1);
    expect(sendFiveStoreDailyOverview).not.toHaveBeenCalled();
    expect(lines).toContain("迎宾店: send failed - wecom down");
    expect(lines).toContain("2026-04-22 five-store daily overview waiting - daily reports not fully sent yet");
    expect(store.markScheduledJobCompleted).not.toHaveBeenCalledWith(
      "send-five-store-daily-overview",
      "2026-04-22",
      expect.any(String),
    );
  });

  it("sends the five-store overview directly after daily reports finish and marks the job complete", async () => {
    const sendReport = vi.fn(async () => "迎宾店: report sent");
    const { orchestrator, sendFiveStoreDailyOverview, store } = buildOrchestrator({
      sendReport,
    });

    const lines = await orchestrator.runDueJobs(new Date("2026-04-23T02:04:00Z"));

    expect(sendFiveStoreDailyOverview).toHaveBeenCalledWith({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T02:04:00.000Z"),
    });
    expect(lines).toContain("five-store daily overview sent for 2026-04-22");
    expect(store.markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-report",
      "2026-04-22",
      expect.any(String),
    );
    expect(store.markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-five-store-daily-overview",
      "2026-04-22",
      expect.any(String),
    );
  });
});
