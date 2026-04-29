import { describe, expect, it } from "vitest";

import { listAuthoritativeSchedulerJobs } from "./schedule.js";

function findMonthlyJob(now: Date) {
  return listAuthoritativeSchedulerJobs({
    now,
    timeZone: "Asia/Shanghai",
    completedRunKeys: new Set<string>(),
    syncEnabled: false,
    historyBackfillEnabled: false,
    reportingEnabled: true,
    externalIntelligenceEnabled: false,
    sendReportEnabled: true,
    sendFiveStoreDailyOverviewEnabled: false,
    sendWeeklyReportEnabled: false,
    sendWeeklyChartEnabled: false,
    sendMiddayBriefEnabled: false,
    sendReactivationPushEnabled: false,
    sendMonthlyReportEnabled: true,
    monthlyReportTime: "10:10",
  }).find((job) => job.jobType === "send-monthly-report");
}

describe("monthly report schedule", () => {
  it("is only due on the first local day of the month after the configured monthly report time", () => {
    const firstBefore = findMonthlyJob(new Date("2026-04-01T02:09:00Z"));
    const firstAfter = findMonthlyJob(new Date("2026-04-01T02:11:00Z"));
    const secondAfter = findMonthlyJob(new Date("2026-04-02T02:11:00Z"));

    expect(firstBefore?.runKey).toBe("2026-03");
    expect(firstBefore?.status).toBe("waiting");
    expect(firstAfter?.runKey).toBe("2026-03");
    expect(firstAfter?.status).toBe("pending");
    expect(secondAfter?.status).toBe("waiting");
  });
});
