import { describe, expect, it } from "vitest";

import { listDueScheduledJobs } from "./schedule.js";

describe("weekly chart schedule", () => {
  it("emits the Monday weekly chart checkpoint after the configured weekly chart time", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-04-20T09:17:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-04-20",
          "nightly-history-backfill:2026-04-20",
          "build-report:2026-04-19",
          "send-report:2026-04-19",
          "send-weekly-report:2026-04-19",
        ]),
        weeklyChartTime: "09:18",
      }),
    ).not.toContainEqual({ jobType: "send-weekly-chart", runKey: "2026-04-19" });

    expect(
      listDueScheduledJobs({
        now: new Date("2026-04-20T09:18:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-04-20",
          "nightly-history-backfill:2026-04-20",
          "build-report:2026-04-19",
          "send-report:2026-04-19",
          "send-weekly-report:2026-04-19",
        ]),
        weeklyChartTime: "09:18",
      }),
    ).toContainEqual({ jobType: "send-weekly-chart", runKey: "2026-04-19" });
  });

  it("suppresses the weekly chart job when disabled", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-04-20T09:20:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        sendWeeklyChartEnabled: false,
      }),
    ).not.toContainEqual({ jobType: "send-weekly-chart", runKey: "2026-04-19" });
  });

  it("keeps the weekly chart job idle before the configured rollout start date", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-04-20T09:20:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-04-20",
          "nightly-history-backfill:2026-04-20",
          "build-report:2026-04-19",
          "send-report:2026-04-19",
          "send-weekly-report:2026-04-19",
        ]),
        weeklyChartTime: "09:18",
        weeklyChartStartDate: "2026-04-27",
      }),
    ).not.toContainEqual({ jobType: "send-weekly-chart", runKey: "2026-04-19" });
  });
});
