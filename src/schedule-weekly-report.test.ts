import { describe, expect, it } from "vitest";

import { listAuthoritativeSchedulerJobs } from "./schedule.js";

function findWeeklyJob(now: Date) {
  return listAuthoritativeSchedulerJobs({
    now,
    timeZone: "Asia/Shanghai",
    completedRunKeys: new Set<string>(),
    syncEnabled: false,
    historyBackfillEnabled: false,
    reportingEnabled: true,
    externalIntelligenceEnabled: false,
    sendReportEnabled: true,
    sendWeeklyReportEnabled: true,
    sendMiddayBriefEnabled: false,
    sendReactivationPushEnabled: false,
    buildReportTime: "08:50",
    sendReportTime: "10:00",
    weeklyReportTime: "10:05",
  }).find((job) => job.jobType === "send-weekly-report");
}

function findWeeklyJobWithStartDate(now: Date, weeklyReportStartDate: string) {
  return listAuthoritativeSchedulerJobs({
    now,
    timeZone: "Asia/Shanghai",
    completedRunKeys: new Set<string>(),
    syncEnabled: false,
    historyBackfillEnabled: false,
    reportingEnabled: true,
    externalIntelligenceEnabled: false,
    sendReportEnabled: true,
    sendWeeklyReportEnabled: true,
    sendMiddayBriefEnabled: false,
    sendReactivationPushEnabled: false,
    buildReportTime: "08:50",
    sendReportTime: "10:00",
    weeklyReportTime: "10:05",
    weeklyReportStartDate,
  }).find((job) => job.jobType === "send-weekly-report");
}

describe("weekly report schedule", () => {
  it("is only due on Monday after the configured weekly report time", () => {
    const mondayBefore = findWeeklyJob(new Date("2026-04-20T01:58:00Z"));
    const mondayAfter = findWeeklyJob(new Date("2026-04-20T02:06:00Z"));
    const tuesdayAfter = findWeeklyJob(new Date("2026-04-21T02:06:00Z"));

    expect(mondayBefore?.due).toBe(false);
    expect(mondayBefore?.status).toBe("waiting");
    expect(mondayAfter?.due).toBe(true);
    expect(mondayAfter?.status).toBe("pending");
    expect(tuesdayAfter?.due).toBe(false);
  });

  it("keeps the weekly report waiting before the configured rollout start date", () => {
    const gated = findWeeklyJobWithStartDate(new Date("2026-04-20T02:06:00Z"), "2026-04-27");

    expect(gated?.due).toBe(false);
    expect(gated?.status).toBe("waiting");
  });
});
