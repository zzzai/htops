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
      monthlyReportAtLocalTime: "10:10",
      sendReportEnabled: true,
      sendFiveStoreDailyOverviewEnabled: false,
      sendWeeklyReportEnabled: false,
      sendMonthlyReportEnabled: true,
      sendWeeklyChartEnabled: false,
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
  sendMonthlyReport?: ReturnType<typeof vi.fn>;
}) {
  const store = buildFakeStore();
  const sendMonthlyReport =
    params.sendMonthlyReport ??
    vi.fn(async ({ month }: { month?: string }) => `monthly report sent for ${month}`);

  return {
    store,
    sendMonthlyReport,
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
          endBizDate: "2026-03-31",
          windowDays: 7,
          dates: [],
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
      sendFiveStoreDailyOverview: vi.fn(async () => "five-store overview sent"),
      sendWeeklyReport: vi.fn(async () => "weekly report sent"),
      sendMonthlyReport: sendMonthlyReport as unknown as (params: {
        month?: string;
        now?: Date;
      }) => Promise<string>,
      sendWeeklyChartImage: vi.fn(async () => "weekly chart sent"),
      sendNotificationMessage: vi.fn(async () => undefined),
      sendReport: params.sendReport as unknown as (params: {
        orgId: string;
        bizDate?: string;
        now?: Date;
      }) => Promise<string>,
    }),
  };
}

describe("HetangSyncOrchestrator monthly report delivery", () => {
  it("waits for the previous month-end daily report before sending the monthly report", async () => {
    const sendReport = vi.fn(async () => {
      throw new Error("wecom down");
    });
    const { orchestrator, sendMonthlyReport } = buildOrchestrator({ sendReport });

    const lines = await orchestrator.runDueJobs(new Date("2026-04-01T02:11:00Z"));

    expect(sendReport).toHaveBeenCalledTimes(1);
    expect(sendMonthlyReport).not.toHaveBeenCalled();
    expect(lines).toContain("迎宾店: send failed - wecom down");
    expect(lines).toContain("2026-03 monthly report waiting - month-end daily reports not fully sent yet");
  });

  it("sends the previous month report after the month-end daily report completes in the same run", async () => {
    const sendReport = vi.fn(async () => "迎宾店: report sent");
    const { orchestrator, sendMonthlyReport, store } = buildOrchestrator({ sendReport });
    const now = new Date("2026-04-01T02:11:00Z");

    const lines = await orchestrator.runDueJobs(now);

    expect(sendReport).toHaveBeenCalledTimes(1);
    expect(sendMonthlyReport).toHaveBeenCalledWith({
      month: "2026-03",
      now,
    });
    expect(lines).toContain("monthly report sent for 2026-03");
    expect(store.markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-monthly-report",
      "2026-03",
      expect.any(String),
    );
  });
});
