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
      weeklyReportAtLocalTime: "10:05",
      weeklyChartAtLocalTime: "10:08",
      sendReportEnabled: true,
      sendFiveStoreDailyOverviewEnabled: false,
      sendWeeklyReportEnabled: true,
      sendWeeklyChartEnabled: true,
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
  sendWeeklyReport?: ReturnType<typeof vi.fn>;
  sendWeeklyChartImage?: ReturnType<typeof vi.fn>;
  store?: ReturnType<typeof buildFakeStore>;
}) {
  const store = params.store ?? buildFakeStore();
  const sendWeeklyReport =
    params.sendWeeklyReport ??
    vi.fn(async ({ weekEndBizDate }: { weekEndBizDate?: string }) => `weekly report sent for ${weekEndBizDate}`);
  const sendWeeklyChartImage =
    params.sendWeeklyChartImage ??
    vi.fn(async ({ weekEndBizDate }: { weekEndBizDate?: string }) => `weekly chart image sent for ${weekEndBizDate}`);
  const sendFiveStoreDailyOverview = vi.fn(async () => "five-store daily overview sent");

  return {
    store,
    sendWeeklyReport,
    sendWeeklyChartImage,
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
          endBizDate: "2026-04-19",
          windowDays: 7,
          dates: ["2026-04-13", "2026-04-14", "2026-04-15", "2026-04-16", "2026-04-17", "2026-04-18", "2026-04-19"],
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

describe("HetangSyncOrchestrator weekly chart delivery", () => {
  it("waits for the weekly chart when the weekly report is not fully sent yet", async () => {
    const sendReport = vi.fn(async () => "迎宾店: report sent");
    const sendWeeklyReport = vi.fn(async () => {
      throw new Error("weekly report failed");
    });
    const { orchestrator, sendWeeklyChartImage, store } = buildOrchestrator({
      sendReport,
      sendWeeklyReport,
    });

    const lines = await orchestrator.runDueJobs(new Date("2026-04-20T02:09:00Z"));

    expect(sendWeeklyChartImage).not.toHaveBeenCalled();
    expect(lines).toContain("2026-04-19 weekly chart waiting - weekly report not fully sent yet");
    expect(store.markScheduledJobCompleted).not.toHaveBeenCalledWith(
      "send-weekly-chart",
      "2026-04-19",
      expect.any(String),
    );
  });

  it("sends the weekly chart after the weekly report finishes in the same run", async () => {
    const sendReport = vi.fn(async () => "迎宾店: report sent");
    const { orchestrator, sendWeeklyReport, sendWeeklyChartImage, store } = buildOrchestrator({
      sendReport,
    });

    const lines = await orchestrator.runDueJobs(new Date("2026-04-20T02:09:00Z"));

    expect(sendWeeklyReport).toHaveBeenCalledWith({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:09:00.000Z"),
    });
    expect(sendWeeklyChartImage).toHaveBeenCalledWith({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:09:00.000Z"),
    });
    expect(lines).toContain("weekly chart image sent for 2026-04-19");
    expect(store.markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-weekly-chart",
      "2026-04-19",
      expect.any(String),
    );
  });
});
