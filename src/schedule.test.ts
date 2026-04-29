import { describe, expect, it } from "vitest";
import {
  listAuthoritativeSchedulerCatalog,
  listAuthoritativeSchedulerJobs,
  listDueScheduledJobs,
} from "./schedule.js";

describe("listDueScheduledJobs", () => {
  it("includes nightly conversation review in the authoritative scheduler catalog", () => {
    expect(
      listAuthoritativeSchedulerCatalog().some(
        (job) => job.jobType === "nightly-conversation-review" && job.orchestrator === "sync",
      ),
    ).toBe(true);
  });

  it("exposes the authoritative scheduler catalog for control surfaces", () => {
    expect(listAuthoritativeSchedulerCatalog()).toHaveLength(15);
    expect(listAuthoritativeSchedulerCatalog()).toMatchObject([
      {
        jobType: "sync",
        label: "夜间同步",
        orchestrator: "sync",
        surfaceRole: "primary",
      },
      {
        jobType: "run-customer-history-catchup",
        label: "顾客历史补齐",
        orchestrator: "sync",
        surfaceRole: "conditional",
        surfaceNote: "仅在夜间原始事实完成后继续补顾客派生层；pending 不代表主链异常",
      },
      {
        jobType: "nightly-conversation-review",
        label: "对话复盘",
        orchestrator: "sync",
        surfaceRole: "primary",
      },
      {
        jobType: "build-store-environment-memory",
        label: "门店环境记忆构建",
        orchestrator: "sync",
        surfaceRole: "primary",
      },
      {
        jobType: "build-report",
        label: "日报构建",
        orchestrator: "sync",
        surfaceRole: "primary",
      },
      {
        jobType: "audit-daily-report-window",
        label: "日报窗口对账巡检",
        orchestrator: "sync",
        surfaceRole: "primary",
      },
      {
        jobType: "build-external-brief",
        label: "外部情报简报",
        orchestrator: "sync",
        surfaceRole: "primary",
      },
      {
        jobType: "send-report",
        label: "门店日报投递",
        orchestrator: "delivery",
        surfaceRole: "primary",
      },
      {
        jobType: "send-five-store-daily-overview",
        label: "5店日报总览投递",
        orchestrator: "delivery",
        surfaceRole: "primary",
      },
      {
        jobType: "send-weekly-report",
        label: "5店周报投递",
        orchestrator: "delivery",
        surfaceRole: "primary",
      },
      {
        jobType: "send-monthly-report",
        label: "5店月报投递",
        orchestrator: "delivery",
        surfaceRole: "primary",
      },
      {
        jobType: "send-weekly-chart",
        label: "5店周图投递",
        orchestrator: "delivery",
        surfaceRole: "primary",
      },
      {
        jobType: "send-midday-brief",
        label: "午报投递",
        orchestrator: "delivery",
        surfaceRole: "primary",
      },
      {
        jobType: "send-reactivation-push",
        label: "唤回推送",
        orchestrator: "delivery",
        surfaceRole: "primary",
      },
      {
        jobType: "nightly-history-backfill",
        label: "统一历史补数",
        orchestrator: "sync",
        surfaceRole: "primary",
      },
    ]);
  });

  it("emits the fixed sync, report-build, and report-send checkpoints", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T03:12:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
      }),
    ).toEqual([
      { jobType: "sync", runKey: "2026-03-30" },
      { jobType: "nightly-history-backfill", runKey: "2026-03-30" },
    ]);

    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T08:55:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        externalIntelligenceEnabled: true,
      }),
    ).toEqual([
      { jobType: "sync", runKey: "2026-03-30" },
      { jobType: "run-customer-history-catchup", runKey: "2026-03-29" },
      { jobType: "nightly-conversation-review", runKey: "2026-03-30" },
      { jobType: "build-store-environment-memory", runKey: "2026-03-29" },
      { jobType: "build-report", runKey: "2026-03-29" },
      { jobType: "audit-daily-report-window", runKey: "2026-03-29" },
      { jobType: "build-external-brief", runKey: "2026-03-30" },
      { jobType: "nightly-history-backfill", runKey: "2026-03-30" },
    ]);

    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T09:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        externalIntelligenceEnabled: true,
      }),
    ).toEqual([
      { jobType: "sync", runKey: "2026-03-30" },
      { jobType: "run-customer-history-catchup", runKey: "2026-03-29" },
      { jobType: "nightly-conversation-review", runKey: "2026-03-30" },
      { jobType: "build-store-environment-memory", runKey: "2026-03-29" },
      { jobType: "build-report", runKey: "2026-03-29" },
      { jobType: "audit-daily-report-window", runKey: "2026-03-29" },
      { jobType: "build-external-brief", runKey: "2026-03-30" },
      { jobType: "send-report", runKey: "2026-03-29" },
      { jobType: "nightly-history-backfill", runKey: "2026-03-30" },
    ]);
  });

  it("does not emit jobs that already ran for the same run key", () => {
    const completedRunKeys = new Set([
      "sync:2026-03-30",
      "nightly-history-backfill:2026-03-30",
      "build-store-environment-memory:2026-03-29",
      "build-report:2026-03-29",
      "audit-daily-report-window:2026-03-29",
      "run-customer-history-catchup:2026-03-29",
      "nightly-conversation-review:2026-03-30",
    ]);

    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T08:55:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys,
      }),
    ).toEqual([]);
  });

  it("suppresses scheduled jobs when sync and reporting are disabled for access-only bootstrap", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T09:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        syncEnabled: false,
        reportingEnabled: false,
      }),
    ).toEqual([]);
  });

  it("can disable sync while keeping reporting checkpoints enabled", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T09:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        syncEnabled: false,
      }),
    ).toEqual([
      { jobType: "build-store-environment-memory", runKey: "2026-03-29" },
      { jobType: "build-report", runKey: "2026-03-29" },
      { jobType: "audit-daily-report-window", runKey: "2026-03-29" },
      { jobType: "send-report", runKey: "2026-03-29" },
    ]);
  });

  it("gates the five-store daily overview by its own enable flag and post-report send time", () => {
    const before = listAuthoritativeSchedulerJobs({
      now: new Date("2026-03-30T09:04:00+08:00"),
      timeZone: "Asia/Shanghai",
      completedRunKeys: new Set<string>(),
      syncEnabled: false,
      reportingEnabled: true,
      sendReportEnabled: true,
      sendFiveStoreDailyOverviewEnabled: true,
      sendReportTime: "09:00",
      fiveStoreDailyOverviewTime: "09:05",
    }).find((job) => job.jobType === "send-five-store-daily-overview");
    const after = listAuthoritativeSchedulerJobs({
      now: new Date("2026-03-30T09:06:00+08:00"),
      timeZone: "Asia/Shanghai",
      completedRunKeys: new Set<string>(),
      syncEnabled: false,
      reportingEnabled: true,
      sendReportEnabled: true,
      sendFiveStoreDailyOverviewEnabled: true,
      sendReportTime: "09:00",
      fiveStoreDailyOverviewTime: "09:05",
    }).find((job) => job.jobType === "send-five-store-daily-overview");
    const disabled = listAuthoritativeSchedulerJobs({
      now: new Date("2026-03-30T09:06:00+08:00"),
      timeZone: "Asia/Shanghai",
      completedRunKeys: new Set<string>(),
      syncEnabled: false,
      reportingEnabled: true,
      sendReportEnabled: true,
      sendFiveStoreDailyOverviewEnabled: false,
      sendReportTime: "09:00",
      fiveStoreDailyOverviewTime: "09:05",
    }).find((job) => job.jobType === "send-five-store-daily-overview");

    expect(before?.schedule).toBe("09:05 after daily reports");
    expect(before?.due).toBe(false);
    expect(before?.status).toBe("waiting");
    expect(after?.due).toBe(true);
    expect(after?.status).toBe("pending");
    expect(disabled?.enabled).toBe(false);
    expect(disabled?.status).toBe("disabled");
  });

  it("only emits sync jobs inside the configured overnight access window", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-31T02:59:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        syncEnabled: true,
        syncTime: "03:10",
        syncWindowStart: "03:00",
        syncWindowEnd: "04:00",
      }),
    ).toEqual([]);

    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-31T03:30:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        syncEnabled: true,
        syncTime: "03:10",
        syncWindowStart: "03:00",
        syncWindowEnd: "04:00",
      }),
    ).toEqual([
      { jobType: "sync", runKey: "2026-03-31" },
      { jobType: "nightly-history-backfill", runKey: "2026-03-31" },
    ]);

    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-31T04:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
        syncEnabled: true,
        syncTime: "03:10",
        syncWindowStart: "03:00",
        syncWindowEnd: "04:00",
      }),
    ).toEqual([]);
  });

  it("uses the default sync window that stays open until 18:00", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-31T04:30:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set(),
      }),
    ).toEqual([
      { jobType: "sync", runKey: "2026-03-31" },
      { jobType: "run-customer-history-catchup", runKey: "2026-03-30" },
      { jobType: "nightly-conversation-review", runKey: "2026-03-31" },
      { jobType: "nightly-history-backfill", runKey: "2026-03-31" },
    ]);
  });

  it("emits the noon store-brief checkpoint after morning report delivery already finished", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T12:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-03-30",
          "nightly-history-backfill:2026-03-30",
          "build-store-environment-memory:2026-03-29",
          "build-report:2026-03-29",
          "audit-daily-report-window:2026-03-29",
          "send-report:2026-03-29",
          "run-customer-history-catchup:2026-03-29",
          "nightly-conversation-review:2026-03-30",
        ]),
      }),
    ).toEqual([
      { jobType: "send-five-store-daily-overview", runKey: "2026-03-29" },
      { jobType: "send-weekly-report", runKey: "2026-03-29" },
      { jobType: "send-weekly-chart", runKey: "2026-03-29" },
      { jobType: "send-midday-brief", runKey: "2026-03-29" },
    ]);
  });

  it("emits the local customer-history catchup checkpoint after the nightly API window closes", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-31T04:06:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-03-31",
          "nightly-history-backfill:2026-03-31",
        ]),
      }),
    ).toEqual([{ jobType: "run-customer-history-catchup", runKey: "2026-03-30" }]);
  });

  it("emits the afternoon reactivation push checkpoint once per business day", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T15:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-03-30",
          "nightly-history-backfill:2026-03-30",
          "build-store-environment-memory:2026-03-29",
          "build-report:2026-03-29",
          "audit-daily-report-window:2026-03-29",
          "send-report:2026-03-29",
          "send-midday-brief:2026-03-29",
          "run-customer-history-catchup:2026-03-29",
          "nightly-conversation-review:2026-03-30",
        ]),
      }),
    ).toEqual([
      { jobType: "send-five-store-daily-overview", runKey: "2026-03-29" },
      { jobType: "send-weekly-report", runKey: "2026-03-29" },
      { jobType: "send-weekly-chart", runKey: "2026-03-29" },
      { jobType: "send-reactivation-push", runKey: "2026-03-29" },
    ]);
  });

  it("can keep noon briefs enabled while suppressing daily report sends", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T12:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-03-30",
          "nightly-history-backfill:2026-03-30",
          "build-store-environment-memory:2026-03-29",
          "build-report:2026-03-29",
          "audit-daily-report-window:2026-03-29",
          "run-customer-history-catchup:2026-03-29",
          "nightly-conversation-review:2026-03-30",
        ]),
        reportingEnabled: true,
        sendReportEnabled: false,
        sendMiddayBriefEnabled: true,
      }),
    ).toEqual([
      { jobType: "send-weekly-report", runKey: "2026-03-29" },
      { jobType: "send-weekly-chart", runKey: "2026-03-29" },
      { jobType: "send-midday-brief", runKey: "2026-03-29" },
    ]);
  });

  it("suppresses noon briefs and afternoon reactivation pushes when delivery toggles are disabled", () => {
    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T12:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-03-30",
          "nightly-history-backfill:2026-03-30",
          "build-store-environment-memory:2026-03-29",
          "build-report:2026-03-29",
          "audit-daily-report-window:2026-03-29",
          "send-report:2026-03-29",
          "run-customer-history-catchup:2026-03-29",
          "nightly-conversation-review:2026-03-30",
        ]),
        sendMiddayBriefEnabled: false,
        sendReactivationPushEnabled: false,
      }),
    ).toEqual([
      { jobType: "send-five-store-daily-overview", runKey: "2026-03-29" },
      { jobType: "send-weekly-report", runKey: "2026-03-29" },
      { jobType: "send-weekly-chart", runKey: "2026-03-29" },
    ]);

    expect(
      listDueScheduledJobs({
        now: new Date("2026-03-30T15:01:00+08:00"),
        timeZone: "Asia/Shanghai",
        completedRunKeys: new Set([
          "sync:2026-03-30",
          "nightly-history-backfill:2026-03-30",
          "build-store-environment-memory:2026-03-29",
          "build-report:2026-03-29",
          "audit-daily-report-window:2026-03-29",
          "send-report:2026-03-29",
          "run-customer-history-catchup:2026-03-29",
          "nightly-conversation-review:2026-03-30",
        ]),
        sendMiddayBriefEnabled: false,
        sendReactivationPushEnabled: false,
      }),
    ).toEqual([
      { jobType: "send-five-store-daily-overview", runKey: "2026-03-29" },
      { jobType: "send-weekly-report", runKey: "2026-03-29" },
      { jobType: "send-weekly-chart", runKey: "2026-03-29" },
    ]);
  });
});
