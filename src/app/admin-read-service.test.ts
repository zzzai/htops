import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { HetangAdminReadService } from "./admin-read-service.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: "1001", storeName: "迎宾店", isActive: true }],
  });
}

function buildMultiStoreConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "迎宾店", isActive: true },
      { orgId: "1002", storeName: "义乌店", isActive: true },
      { orgId: "1003", storeName: "华美店", isActive: true },
      { orgId: "1004", storeName: "锦苑店", isActive: true },
    ],
  });
}

describe("HetangAdminReadService", () => {
  it("cleans legacy scheduled poller state after authoritative scheduled poller writes", async () => {
    const getScheduledJobState = vi.fn().mockResolvedValue({
      poller: "scheduled-sync",
      status: "ok",
      lastRunAt: "2026-04-15T18:00:00.000Z",
      lastSuccessAt: "2026-04-15T18:00:00.000Z",
    });
    const setScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const deleteScheduledJobState = vi.fn().mockResolvedValue(undefined);
    const queueStore = {
      getScheduledJobState,
      setScheduledJobState,
      deleteScheduledJobState,
    };
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () =>
        ({
          getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
        }) as never,
    });

    await service.recordServicePollerOutcome({
      poller: "scheduled-sync",
      status: "ok",
      startedAt: "2026-04-16T03:00:00.000Z",
      finishedAt: "2026-04-16T03:00:03.000Z",
      lines: ["sync line 1", "sync line 2"],
    });

    expect(setScheduledJobState).toHaveBeenCalledWith(
      "service-poller",
      "scheduled-sync",
      expect.objectContaining({
        poller: "scheduled-sync",
        status: "ok",
        lastRunAt: "2026-04-16T03:00:03.000Z",
        lastSuccessAt: "2026-04-16T03:00:03.000Z",
        lastResultCount: 2,
      }),
      "2026-04-16T03:00:03.000Z",
    );
    expect(deleteScheduledJobState).toHaveBeenCalledWith("service-poller", "scheduled");
  });

  it("fails fast when the queue access control owner getter is missing", async () => {
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => ({}) as never,
    });

    await expect(
      service.getSchedulerStatus(new Date("2026-04-16T09:05:00+08:00")),
    ).rejects.toThrow("admin-read-service requires store.getQueueAccessControlStore()");
  });

  it("returns authoritative split pollers and scheduler jobs", async () => {
    const queueStore = {
      getScheduledJobState: vi.fn(async (_jobType: string, stateKey: string) => {
        switch (stateKey) {
          case "scheduled-sync":
            return {
              poller: "scheduled-sync",
              status: "ok",
              lastRunAt: "2026-04-16T03:20:00+08:00",
            };
          case "scheduled-delivery":
            return {
              poller: "scheduled-delivery",
              status: "ok",
              lastRunAt: "2026-04-16T09:02:00+08:00",
            };
          case "analysis":
            return {
              poller: "analysis",
              status: "ok",
              lastRunAt: "2026-04-16T09:03:00+08:00",
            };
          case "scheduled":
            return {
              poller: "scheduled",
              status: "ok",
              lastRunAt: "2026-04-16T09:01:00+08:00",
            };
          default:
            return null;
        }
      }),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({
        sync: "2026-04-16T03:20:00+08:00",
        "send-report": "2026-04-16T09:02:00+08:00",
      }),
    };
    const martStore = {
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          storeName: "迎宾店",
          bizDate: "2026-04-15",
          alertSentAt: "2026-04-16T01:00:00+08:00",
          upgradedAt: "2026-04-16T03:00:00+08:00",
        },
      ]),
    };
    const store = {
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
    };

    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-16T09:05:00+08:00"));

    expect(status.authority).toBe("app-service-pollers");
    expect(status.contractVersion).toBe("2026-04-23.control-plane.v1");
    expect(status.entrySurface).toEqual({
      entryRole: "runtime_query_api",
      accessMode: "read_only",
      ownerSurface: "admin_read_service",
      auditMode: "none",
      requestDedupe: "none",
    });
    expect(status.observabilityStreams).toEqual([
      "scheduler_snapshot",
      "ai_lane_summary",
      "report_delivery_upgrade_summary",
      "five_store_daily_overview_summary",
      "legacy_poller_warning",
    ]);
    expect(status.pollers.map((entry) => entry.poller)).toEqual([
      "scheduled-sync",
      "scheduled-delivery",
      "analysis",
    ]);
    expect(status.pollers[0]?.lastRunAt).toBe("2026-04-16T03:20:00+08:00");
    expect(status.pollers[1]?.lastRunAt).toBe("2026-04-16T09:02:00+08:00");
    expect(status.jobs.some((job) => job.jobType === "nightly-history-backfill")).toBe(true);
    expect(status.jobs.find((job) => job.jobType === "run-customer-history-catchup")).toMatchObject({
      surfaceRole: "conditional",
      surfaceNote: "仅在夜间原始事实完成后继续补顾客派生层；pending 不代表主链异常",
    });
    expect(status.legacyPollers).toEqual([
      expect.objectContaining({
        stateKey: "scheduled",
        poller: "scheduled",
        status: "ok",
        lastRunAt: "2026-04-16T09:01:00+08:00",
      }),
    ]);
    expect(status.warnings).toEqual([
      "legacy poller state present: scheduled | status=ok | lastRun=2026-04-16T09:01:00+08:00",
    ]);
    expect(status.reportDeliveryUpgradeSummary).toEqual({
      windowStartAt: expect.any(String),
      recentUpgradeCount: 1,
      recentUpgrades: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          bizDate: "2026-04-15",
          alertSentAt: "2026-04-16T01:00:00+08:00",
          upgradedAt: "2026-04-16T03:00:00+08:00",
        },
      ],
    });
    expect(status.aiLanes?.map((entry) => entry.laneId)).toEqual([
      "general-lite",
      "semantic-fallback",
      "customer-growth-json",
      "cheap-summary",
      "analysis-premium",
      "offline-review",
    ]);
    expect(status.aiLanes?.find((entry) => entry.laneId === "analysis-premium")).toMatchObject({
      laneId: "analysis-premium",
      taskClass: "analysis",
      executionMode: "async",
      model: "gpt-5.4",
      reasoningMode: "high",
      timeoutMs: 90000,
      responseMode: "json",
      fallbackBehavior: "deterministic",
      ownerModule: "src/app/analysis-service.ts",
      overrideKeys: [],
    });
    expect(status.aiLanes?.find((entry) => entry.laneId === "offline-review")).toMatchObject({
      laneId: "offline-review",
      taskClass: "review",
      executionMode: "batch",
      model: "gpt-5.4",
      reasoningMode: "high",
      timeoutMs: 120000,
      responseMode: "json",
      fallbackBehavior: "deterministic",
      ownerModule: "src/ops/doctor.ts",
      overrideKeys: [],
    });
  });

  it("fails fast when the mart-derived owner getter is missing", async () => {
    const queueStore = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () =>
        ({
          getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
        }) as never,
    });

    await expect(
      service.getSchedulerStatus(new Date("2026-04-16T09:05:00+08:00")),
    ).rejects.toThrow("admin-read-service requires store.getMartDerivedStore()");
  });

  it("reads report delivery upgrades from mart store even when scheduler state uses queue store", async () => {
    const queueStore = {
      getScheduledJobState: vi.fn(async (_jobType: string, stateKey: string) => {
        switch (stateKey) {
          case "scheduled-sync":
            return {
              poller: "scheduled-sync",
              status: "ok",
              lastRunAt: "2026-04-16T03:20:00+08:00",
            };
          case "scheduled-delivery":
            return {
              poller: "scheduled-delivery",
              status: "ok",
              lastRunAt: "2026-04-16T09:02:00+08:00",
            };
          case "analysis":
            return {
              poller: "analysis",
              status: "ok",
              lastRunAt: "2026-04-16T09:03:00+08:00",
            };
          default:
            return null;
        }
      }),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const martStore = {
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([
        {
          orgId: "1001",
          storeName: "迎宾店",
          bizDate: "2026-04-15",
          alertSentAt: "2026-04-16T01:00:00+08:00",
          upgradedAt: "2026-04-16T03:00:00+08:00",
        },
      ]),
    };
    const store = {
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
    };

    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-16T09:05:00+08:00"));

    expect(status.reportDeliveryUpgradeSummary).toEqual({
      windowStartAt: expect.any(String),
      recentUpgradeCount: 1,
      recentUpgrades: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          bizDate: "2026-04-15",
          alertSentAt: "2026-04-16T01:00:00+08:00",
          upgradedAt: "2026-04-16T03:00:00+08:00",
        },
      ],
    });
    expect(martStore.listRecentReportDeliveryUpgrades).toHaveBeenCalledWith({
      since: expect.any(String),
      limit: 5,
    });
  });

  it("summarizes current daily report readiness for the active stores", async () => {
    const bizDate = "2026-04-16";
    const martStore = {
      getDailyReport: vi.fn(async (orgId: string) => {
        switch (orgId) {
          case "1001":
            return {
              orgId,
              storeName: "迎宾店",
              bizDate,
              complete: true,
              markdown:
                "2026年4月16日 迎宾店经营数据报告  \
营业日口径：次日03:00截止  \
\n【核心经营】  \
预估到店人数：16人",
              metrics: {},
              alerts: [],
              suggestions: [],
            };
          case "1002":
            return {
              orgId,
              storeName: "义乌店",
              bizDate,
              complete: true,
              markdown:
                "2026年4月16日 义乌店经营数据报告  \
营业日口径：次日03:00截止  \
\n【核心经营】  \
主项总钟数：7个",
              metrics: {},
              alerts: [],
              suggestions: [],
            };
          case "1003":
            return {
              orgId,
              storeName: "华美店",
              bizDate,
              complete: false,
              markdown: "华美店异常告警",
              metrics: {},
              alerts: [],
              suggestions: [],
            };
          default:
            return null;
        }
      }),
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
    };
    const queueStore = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const store = {
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
    };

    const service = new HetangAdminReadService({
      config: buildMultiStoreConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-17T09:05:00+08:00"));

    expect(status.reportReadinessSummary).toEqual({
      bizDate,
      totalStoreCount: 4,
      readyCount: 1,
      refreshNeededCount: 1,
      incompleteCount: 1,
      missingCount: 1,
      stores: [
        { orgId: "1001", storeName: "迎宾店", status: "ready" },
        { orgId: "1002", storeName: "义乌店", status: "refresh-needed" },
        { orgId: "1003", storeName: "华美店", status: "incomplete" },
        { orgId: "1004", storeName: "锦苑店", status: "missing" },
      ],
    });
  });

  it("treats reports with 预估到店人数 and 补充指标 as ready", async () => {
    const bizDate = "2026-04-16";
    const martStore = {
      getDailyReport: vi.fn(async (orgId: string) => ({
        orgId,
        storeName:
          orgId === "1001"
            ? "迎宾店"
            : orgId === "1002"
              ? "义乌店"
              : orgId === "1003"
                ? "华美店"
                : "锦苑店",
        bizDate,
        complete: true,
        markdown: [
          `${bizDate} 经营数据报告`,
          "预估到店人数：16人",
          "【补充指标】",
          "- 团购订单：9单",
        ].join("\n"),
        metrics: {},
        alerts: [],
        suggestions: [],
      })),
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
    };
    const queueStore = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const store = {
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
    };

    const service = new HetangAdminReadService({
      config: buildMultiStoreConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-17T09:05:00+08:00"));

    expect(status.reportReadinessSummary).toEqual({
      bizDate,
      totalStoreCount: 4,
      readyCount: 4,
      refreshNeededCount: 0,
      incompleteCount: 0,
      missingCount: 0,
      stores: [
        { orgId: "1001", storeName: "迎宾店", status: "ready" },
        { orgId: "1002", storeName: "义乌店", status: "ready" },
        { orgId: "1003", storeName: "华美店", status: "ready" },
        { orgId: "1004", storeName: "锦苑店", status: "ready" },
      ],
    });
  });

  it("summarizes environment memory readiness and recent disturbance highlights", async () => {
    const bizDate = "2026-04-23";
    const queueStore = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const martStore = {
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
    };
    const currentSnapshots = new Map([
      [
        "1001",
        {
          orgId: "1001",
          bizDate,
          weekdayLabel: "周四",
          holidayTag: "holiday",
          holidayName: "清明节",
          isAdjustedWorkday: false,
          weatherConditionRaw: "暴雨",
          temperatureC: 11,
          precipitationMm: 28,
          windLevel: 6,
          weatherTag: "storm",
          environmentDisturbanceLevel: "high",
          narrativePolicy: "mention",
          snapshotJson: "{}",
          sourceJson: "{}",
          collectedAt: "2026-04-24T03:05:00+08:00",
          updatedAt: "2026-04-24T03:05:00+08:00",
        },
      ],
      [
        "1002",
        {
          orgId: "1002",
          bizDate,
          weekdayLabel: "周四",
          holidayTag: "workday",
          isAdjustedWorkday: false,
          temperatureC: null,
          precipitationMm: null,
          windLevel: null,
          weatherTag: "unknown",
          environmentDisturbanceLevel: "none",
          narrativePolicy: "suppress",
          snapshotJson: "{}",
          sourceJson: "{}",
          collectedAt: "2026-04-24T03:05:00+08:00",
          updatedAt: "2026-04-24T03:05:00+08:00",
        },
      ],
      [
        "1003",
        {
          orgId: "1003",
          bizDate,
          weekdayLabel: "周四",
          holidayTag: "workday",
          weatherConditionRaw: "多云",
          temperatureC: 19,
          precipitationMm: 0,
          windLevel: 2,
          weatherTag: "cloudy",
          environmentDisturbanceLevel: "low",
          narrativePolicy: "suppress",
          snapshotJson: "{}",
          sourceJson: "{}",
          collectedAt: "2026-04-24T03:05:00+08:00",
          updatedAt: "2026-04-24T03:05:00+08:00",
        },
      ],
      [
        "1004",
        {
          orgId: "1004",
          bizDate,
          weekdayLabel: "周四",
          holidayTag: "workday",
          temperatureC: null,
          precipitationMm: null,
          windLevel: null,
          weatherTag: "unknown",
          environmentDisturbanceLevel: "none",
          narrativePolicy: "suppress",
          snapshotJson: "{}",
          sourceJson: "{}",
          collectedAt: "2026-04-24T03:05:00+08:00",
          updatedAt: "2026-04-24T03:05:00+08:00",
        },
      ],
    ]);
    const recentSnapshots = new Map([
      [
        "1001",
        [
          currentSnapshots.get("1001"),
          {
            orgId: "1001",
            bizDate: "2026-04-21",
            holidayTag: "pre_holiday",
            holidayName: "清明节前",
            isAdjustedWorkday: false,
            weatherConditionRaw: "晴",
            temperatureC: 22,
            precipitationMm: 0,
            windLevel: 2,
            weatherTag: "clear",
            badWeatherTouchPenalty: "none",
            environmentDisturbanceLevel: "medium",
            narrativePolicy: "hint",
            snapshotJson: "{}",
            sourceJson: "{}",
            collectedAt: "2026-04-22T03:05:00+08:00",
            updatedAt: "2026-04-22T03:05:00+08:00",
          },
        ],
      ],
      [
        "1002",
        [
          currentSnapshots.get("1002"),
          {
            orgId: "1002",
            bizDate: "2026-04-20",
            holidayTag: "workday",
            isAdjustedWorkday: false,
            weatherConditionRaw: "中雨",
            temperatureC: 17,
            precipitationMm: 7,
            windLevel: 3,
            weatherTag: "rain",
            badWeatherTouchPenalty: "medium",
            environmentDisturbanceLevel: "medium",
            narrativePolicy: "hint",
            snapshotJson: "{}",
            sourceJson: "{}",
            collectedAt: "2026-04-21T03:05:00+08:00",
            updatedAt: "2026-04-21T03:05:00+08:00",
          },
        ],
      ],
      ["1003", [currentSnapshots.get("1003")]],
      ["1004", [currentSnapshots.get("1004")]],
    ]);
    const store = {
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
      getStoreEnvironmentDailySnapshot: vi.fn(async (orgId: string, requestedBizDate: string) => {
        expect(requestedBizDate).toBe(bizDate);
        return currentSnapshots.get(orgId) ?? null;
      }),
      listStoreEnvironmentDailySnapshots: vi.fn(async (orgId: string, limit: number) => {
        expect(limit).toBe(7);
        return (recentSnapshots.get(orgId) ?? []).filter(Boolean);
      }),
    };

    const service = new HetangAdminReadService({
      config: buildMultiStoreConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-24T09:05:00+08:00"));

    expect(status.observabilityStreams).toContain("environment_memory_summary");
    expect((status as any).environmentMemorySummary).toEqual({
      bizDate,
      totalStoreCount: 4,
      readyCount: 1,
      missingCount: 0,
      missingHolidayCount: 1,
      missingWeatherCount: 1,
      fallbackOnlyCount: 1,
      highDisturbanceCount: 1,
      stores: [
        { orgId: "1001", storeName: "迎宾店", status: "ready" },
        { orgId: "1002", storeName: "义乌店", status: "missing-weather" },
        { orgId: "1003", storeName: "华美店", status: "missing-holiday" },
        { orgId: "1004", storeName: "锦苑店", status: "fallback-only" },
      ],
      recentDisturbance: {
        windowDays: 7,
        mediumOrHigherCount: 3,
        highDisturbanceCount: 1,
        hintCount: 2,
        mentionCount: 1,
        highlights: [
          {
            orgId: "1001",
            storeName: "迎宾店",
            bizDate,
            disturbanceLevel: "high",
            reasons: ["holiday:清明节", "weather:storm"],
          },
          {
            orgId: "1001",
            storeName: "迎宾店",
            bizDate: "2026-04-21",
            disturbanceLevel: "medium",
            reasons: ["holiday:清明节前"],
          },
          {
            orgId: "1002",
            storeName: "义乌店",
            bizDate: "2026-04-20",
            disturbanceLevel: "medium",
            reasons: ["weather:rain"],
          },
        ],
      },
    });
  });

  it("summarizes industry context freshness and module coverage", async () => {
    const bizDate = "2026-04-23";
    const queueStore = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const martStore = {
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
    };
    const store = {
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
      listIndustryContextSnapshots: vi.fn().mockResolvedValue([
        {
          snapshotDate: "2026-04-22",
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
          updatedAt: "2026-04-22T09:00:00.000Z",
        },
        {
          snapshotDate: "2026-04-22",
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
          updatedAt: "2026-04-22T09:05:00.000Z",
        },
        {
          snapshotDate: "2026-04-22",
          signalKind: "industry_climate",
          signalKey: "service_consumption_split",
          title: "服务消费分层扩大",
          summary: "高意愿客更看重体验确定性。",
          truthBoundary: "weak_signal",
          confidence: "medium",
          sourceType: "composite_research",
          sourceLabel: "综合研判",
          applicableModules: ["world_model"],
          rawJson: "{}",
          updatedAt: "2026-04-22T09:10:00.000Z",
        },
      ]),
    };

    const service = new HetangAdminReadService({
      config: buildMultiStoreConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-24T09:05:00+08:00"));

    expect(status.observabilityStreams).toContain("industry_context_summary");
    expect((status as any).industryContextSummary).toEqual({
      bizDate,
      status: "refresh-needed",
      snapshotDate: "2026-04-22",
      itemCount: 3,
      freshnessDays: 1,
      moduleCoverage: [
        { module: "hq_narrative", itemCount: 2 },
        { module: "world_model", itemCount: 2 },
        { module: "store_diagnosis", itemCount: 1 },
      ],
    });
  });

  it("summarizes five-store daily overview readiness and pending confirmation state", async () => {
    const bizDate = "2026-04-16";
    const martStore = {
      getDailyReport: vi.fn(async (orgId: string) => ({
        orgId,
        storeName:
          orgId === "1001"
            ? "迎宾店"
            : orgId === "1002"
              ? "义乌店"
              : orgId === "1003"
                ? "华美店"
                : "锦苑店",
        bizDate,
        complete: true,
        markdown:
          "2026年4月16日 经营数据报告  \\\n营业日口径：次日03:00截止  \\\n\n【核心经营】  \\\n预估到店人数：16人",
        metrics: {},
        alerts: [],
        suggestions: [],
      })),
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
    };
    const queueStore = {
      getScheduledJobState: vi.fn(async (jobType: string, stateKey: string) => {
        if (jobType === "send-five-store-daily-overview" && stateKey === bizDate) {
          return {
            stage: "pending_confirm",
            previewSentAt: "2026-04-17T09:08:00+08:00",
            previewTarget: {
              channel: "wecom",
              target: "ZhangZhen",
              enabled: true,
            },
            finalTarget: {
              channel: "wecom",
              target: "hetang-managers",
              enabled: true,
            },
            updatedAt: "2026-04-17T09:08:00+08:00",
          };
        }
        return null;
      }),
      listCompletedRunKeys: vi.fn().mockResolvedValue(
        new Set<string>(["send-report:2026-04-16"]),
      ),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const store = {
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
    };

    const service = new HetangAdminReadService({
      config: buildMultiStoreConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-17T09:10:00+08:00"));

    expect(status.observabilityStreams).toContain("five_store_daily_overview_summary");
    expect((status as any).fiveStoreDailyOverviewSummary).toEqual(
      expect.objectContaining({
        bizDate,
        status: "pending-confirm",
        totalStoreCount: 4,
        readyCount: 4,
        pendingStoreNames: [],
        previewSentAt: "2026-04-17T09:08:00+08:00",
        previewTarget: {
          channel: "wecom",
          target: "ZhangZhen",
          enabled: true,
        },
        finalTarget: {
          channel: "wecom",
          target: "hetang-managers",
          enabled: true,
        },
      }),
    );
  });

  it("surfaces the recent daily report audit summary from scheduled job state", async () => {
    const bizDate = "2026-04-16";
    const martStore = {
      getDailyReport: vi.fn(async (orgId: string) => ({
        orgId,
        storeName:
          orgId === "1001"
            ? "迎宾店"
            : orgId === "1002"
              ? "义乌店"
              : orgId === "1003"
                ? "华美店"
                : "锦苑店",
        bizDate,
        complete: true,
        markdown:
          "2026年4月16日 经营数据报告  \\\n营业日口径：次日03:00截止  \\\n\n【核心经营】  \\\n预估到店人数：16人",
        metrics: {},
        alerts: [],
        suggestions: [],
      })),
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
    };
    const queueStore = {
      getScheduledJobState: vi.fn(async (jobType: string, stateKey: string) => {
        if (jobType === "audit-daily-report-window" && stateKey === bizDate) {
          return {
            status: "warn",
            endBizDate: bizDate,
            windowDays: 7,
            dates: [
              "2026-04-10",
              "2026-04-11",
              "2026-04-12",
              "2026-04-13",
              "2026-04-14",
              "2026-04-15",
              "2026-04-16",
            ],
            storeCount: 4,
            checkedReports: 28,
            reportsWithFreshMismatch: 0,
            reportsWithStoredMismatch: 2,
            reportsWithOnlyMissingStored: 0,
            maxUnauditedMetricCount: 1,
            unauditedKeys: ["groupbuy7dCardOpenedRate"],
            sampleIssues: [
              {
                orgId: "1001",
                storeName: "迎宾店",
                bizDate,
                topDiffs: [{ metricKey: "groupbuy7dCardOpenedRate", status: "stored_mismatch" }],
              },
            ],
            updatedAt: "2026-04-17T09:07:00+08:00",
          };
        }
        return null;
      }),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const store = {
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
    };

    const service = new HetangAdminReadService({
      config: buildMultiStoreConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-17T09:10:00+08:00"));

    expect(status.observabilityStreams).toContain("daily_report_audit_summary");
    expect((status as any).dailyReportAuditSummary).toEqual({
      status: "warn",
      endBizDate: bizDate,
      windowDays: 7,
      dates: [
        "2026-04-10",
        "2026-04-11",
        "2026-04-12",
        "2026-04-13",
        "2026-04-14",
        "2026-04-15",
        "2026-04-16",
      ],
      storeCount: 4,
      checkedReports: 28,
      reportsWithFreshMismatch: 0,
      reportsWithStoredMismatch: 2,
      reportsWithOnlyMissingStored: 0,
      maxUnauditedMetricCount: 1,
      unauditedKeys: ["groupbuy7dCardOpenedRate"],
      sampleIssues: [
        {
          orgId: "1001",
          storeName: "迎宾店",
          bizDate,
          topDiffs: [{ metricKey: "groupbuy7dCardOpenedRate", status: "stored_mismatch" }],
        },
      ],
      updatedAt: "2026-04-17T09:07:00+08:00",
    });
  });

  it("surfaces a cancelled five-store daily overview state", async () => {
    const bizDate = "2026-04-16";
    const martStore = {
      getDailyReport: vi.fn(async (orgId: string) => ({
        orgId,
        storeName:
          orgId === "1001"
            ? "迎宾店"
            : orgId === "1002"
              ? "义乌店"
              : orgId === "1003"
                ? "华美店"
                : "锦苑店",
        bizDate,
        complete: true,
        markdown:
          "2026年4月16日 经营数据报告  \\\n营业日口径：次日03:00截止  \\\n\n【核心经营】  \\\n预估到店人数：16人",
        metrics: {},
        alerts: [],
        suggestions: [],
      })),
      listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
    };
    const queueStore = {
      getScheduledJobState: vi.fn(async (jobType: string, stateKey: string) => {
        if (jobType === "send-five-store-daily-overview" && stateKey === bizDate) {
          return {
            stage: "cancelled",
            previewSentAt: "2026-04-17T09:08:00+08:00",
            canceledAt: "2026-04-17T09:20:00+08:00",
            canceledBy: "codex-window",
            finalTarget: {
              channel: "wecom",
              target: "hetang-managers",
              enabled: true,
            },
            updatedAt: "2026-04-17T09:20:00+08:00",
          };
        }
        return null;
      }),
      listCompletedRunKeys: vi.fn().mockResolvedValue(
        new Set<string>(["send-report:2026-04-16", "send-five-store-daily-overview:2026-04-16"]),
      ),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
    };
    const store = {
      getMartDerivedStore: vi.fn().mockReturnValue(martStore),
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
    };

    const service = new HetangAdminReadService({
      config: buildMultiStoreConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-17T09:30:00+08:00"));

    expect((status as any).fiveStoreDailyOverviewSummary).toEqual(
      expect.objectContaining({
        bizDate,
        status: "cancelled",
        totalStoreCount: 4,
        readyCount: 4,
        pendingStoreNames: [],
        previewSentAt: "2026-04-17T09:08:00+08:00",
        canceledAt: "2026-04-17T09:20:00+08:00",
        canceledBy: "codex-window",
      }),
    );
  });

  it("aggregates 24h semantic quality top failure classes through the semantic quality owner", async () => {
    const getSemanticQualitySummary = vi.fn().mockResolvedValue({
      windowHours: 24,
      totalCount: 12,
      successCount: 7,
      successRate: 0.5833,
      clarifyCount: 3,
      clarifyRate: 0.25,
      fallbackUsedCount: 2,
      fallbackRate: 0.1667,
      carrySuccessCount: 5,
      carrySuccessRate: 0.625,
      topicSwitchCount: 3,
      latestOccurredAt: "2026-04-17T15:30:00.000Z",
      topFailureClasses: [
        { failureClass: "clarify_missing_time", count: 2 },
        { failureClass: "generic_unmatched", count: 1 },
      ],
      topAnalysisFrameworks: [{ frameworkId: "store_profit_diagnosis_v1", count: 2 }],
      topRouteUpgrades: [{ upgradeKind: "metric_to_advice", count: 2 }],
      optimizationBacklog: [
        {
          failureClass: "clarify_missing_time",
          count: 2,
          ownerModule: "src/query-intent.ts",
          recommendedAction: "补 missing-time carry 规则",
          priority: "high",
        },
      ],
      sampleCandidates: [
        {
          failureClass: "clarify_missing_time",
          ownerModule: "src/query-intent.ts",
          sampleTag: "time_scope_gap",
          prompt: "义乌店营收怎么样",
        },
      ],
      reviewBacklog: [
        {
          source: "conversation_review",
          failureClass: "review:scope_gap",
          count: 2,
          ownerModule: "src/query-intent.ts",
          recommendedAction: "把“这几天/近几天”这类口语时间窗补进默认窗口规则。",
          priority: "high",
        },
      ],
      reviewSampleCandidates: [
        {
          source: "conversation_review",
          failureClass: "review:scope_gap",
          count: 2,
          ownerModule: "src/query-intent.ts",
          sampleTag: "review_scope_gap",
          prompt: "这几天义乌店加钟率多少",
        },
      ],
      reviewDeployFollowupCount: 1,
    });
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => ({}) as never,
      getSemanticQualityService: async () =>
        ({
          getSemanticQualitySummary,
        }) as never,
    });

    const summary = await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-17T16:00:00.000Z"),
    });

    expect(getSemanticQualitySummary).toHaveBeenCalledWith({
      windowHours: 24,
      now: new Date("2026-04-17T16:00:00.000Z"),
      limit: 5,
    });
    expect(summary.topFailureClasses).toEqual([
      { failureClass: "clarify_missing_time", count: 2 },
      { failureClass: "generic_unmatched", count: 1 },
    ]);
    expect(summary.optimizationBacklog).toEqual([
      {
        failureClass: "clarify_missing_time",
        count: 2,
        ownerModule: "src/query-intent.ts",
        recommendedAction: "补 missing-time carry 规则",
        priority: "high",
      },
    ]);
    expect(summary.sampleCandidates).toEqual([
      {
        failureClass: "clarify_missing_time",
        ownerModule: "src/query-intent.ts",
        sampleTag: "time_scope_gap",
        prompt: "义乌店营收怎么样",
      },
    ]);
    expect(summary.reviewBacklog).toEqual([
      expect.objectContaining({
        source: "conversation_review",
        failureClass: "review:scope_gap",
      }),
    ]);
    expect(summary.reviewSampleCandidates).toEqual([
      expect.objectContaining({
        source: "conversation_review",
        failureClass: "review:scope_gap",
      }),
    ]);
    expect(summary.reviewDeployFollowupCount).toBe(1);
    expect(summary.topAnalysisFrameworks).toEqual([
      { frameworkId: "store_profit_diagnosis_v1", count: 2 },
    ]);
    expect(summary.topRouteUpgrades).toEqual([
      { upgradeKind: "metric_to_advice", count: 2 },
    ]);
    expect(summary.fallbackUsedCount).toBe(2);
    expect(summary.carrySuccessCount).toBe(5);
    expect(summary.carrySuccessRate).toBe(0.625);
    expect(summary.topicSwitchCount).toBe(3);
    expect(summary.fallbackConfig).toEqual({
      state: "off",
      enabled: false,
      configured: false,
      timeoutMs: 5_000,
      autoAcceptConfidence: 0.85,
      clarifyConfidence: 0.7,
    });
  });

  it("passes through occurredAfter and deployMarker when reading semantic quality summary", async () => {
    const getSemanticQualitySummary = vi.fn().mockResolvedValue({
      windowHours: 24,
      totalCount: 1,
      successCount: 1,
      successRate: 1,
      clarifyCount: 0,
      clarifyRate: 0,
      fallbackUsedCount: 0,
      fallbackRate: 0,
      topFailureClasses: [],
      topAnalysisFrameworks: [],
      topRouteUpgrades: [],
      optimizationBacklog: [],
      sampleCandidates: [],
    });
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => ({}) as never,
      getSemanticQualityService: async () =>
        ({
          getSemanticQualitySummary,
        }) as never,
    });

    await service.getSemanticQualitySummary({
      windowHours: 24,
      now: new Date("2026-04-18T11:30:00.000Z"),
      limit: 5,
      occurredAfter: "2026-04-18T03:00:00.000Z",
      deployMarker: "serving:serving-20260418040000",
    });

    expect(getSemanticQualitySummary).toHaveBeenCalledWith({
      windowHours: 24,
      now: new Date("2026-04-18T11:30:00.000Z"),
      limit: 5,
      occurredAfter: "2026-04-18T03:00:00.000Z",
      deployMarker: "serving:serving-20260418040000",
    });
  });

  it("surfaces semantic fallback config state alongside semantic quality summary", async () => {
    const getSemanticQualitySummary = vi.fn().mockResolvedValue({
      windowHours: 24,
      totalCount: 2,
      successCount: 1,
      successRate: 0.5,
      clarifyCount: 1,
      clarifyRate: 0.5,
      fallbackUsedCount: 0,
      fallbackRate: 0,
      topFailureClasses: [{ failureClass: "clarify_missing_store_scope", count: 1 }],
    });
    const config = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      semanticFallback: {
        enabled: true,
        baseUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: "demo-key",
        model: "gpt-5-mini",
        timeoutMs: 8_000,
        autoAcceptConfidence: 0.9,
        clarifyConfidence: 0.75,
      },
      stores: [{ orgId: "1001", storeName: "迎宾店", isActive: true }],
    });
    const service = new HetangAdminReadService({
      config,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => ({}) as never,
      getSemanticQualityService: async () =>
        ({
          getSemanticQualitySummary,
        }) as never,
    });

    await expect(service.getSemanticQualitySummary()).resolves.toMatchObject({
      fallbackConfig: {
        state: "on",
        enabled: true,
        configured: true,
        model: "gpt-5-mini",
        timeoutMs: 8_000,
        autoAcceptConfidence: 0.9,
        clarifyConfidence: 0.75,
      },
    });
  });

  it("summarizes unresolved analysis dead letters inside queue status", async () => {
    const queueStore = {
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
      }),
      listAnalysisDeadLetters: vi.fn().mockResolvedValue([
        {
          deadLetterKey: "dl-1",
          jobId: "ANL-1",
          orgId: "1001",
          deadLetterScope: "subscriber",
          reason:
            "[2026-04-13T07:57:31.987Z] [AiBotSDK] [WARN] Reply ack error: reqId=aibot_send_msg_1776067051878_c14a5fe1, errcode=93006, errmsg=invalid chatid, hint: [1776067052074153311952067], from ip: 115.57.50.24, more info at https://open.work.weixin.qq.com/devtool/query?e=93006\n[object Object]\n",
          createdAt: "2026-04-13T07:57:31.354Z",
        },
        {
          deadLetterKey: "dl-2",
          jobId: "ANL-1",
          orgId: "1001",
          deadLetterScope: "job",
          reason: "delivery abandoned after subscriber fan-out exhaustion",
          createdAt: "2026-04-13T07:57:31.000Z",
        },
        {
          deadLetterKey: "dl-3",
          jobId: "ANL-2",
          orgId: "1001",
          deadLetterScope: "subscriber",
          reason:
            "[2026-04-13T07:51:01.610Z] [AiBotSDK] [WARN] Reply ack error: reqId=aibot_send_msg_1776066661506_fe440f96, errcode=93006, errmsg=invalid chatid, hint: [1776066661074154187781415], from ip: 115.57.50.24, more info at https://open.work.weixin.qq.com/devtool/query?e=93006\n[object Object]\n",
          createdAt: "2026-04-13T07:51:00.994Z",
        },
      ]),
    };
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () =>
        ({
          getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
        }) as never,
    });

    const queueStatus = await service.getQueueStatus(
      new Date("2026-04-16T19:00:00+08:00"),
      {
        authority: "app-service-pollers",
        contractVersion: "2026-04-16.control-plane.v1",
        jobs: [],
        pollers: [],
      },
    );

    expect(queueStatus.analysis).toMatchObject({
      unresolvedDeadLetterCount: 8,
      deadLetterSummary: {
        unresolvedJobCount: 1,
        unresolvedSubscriberCount: 2,
        latestUnresolvedAt: "2026-04-13T07:57:31.354Z",
        latestUnresolvedAgeHours: 75,
        stale: true,
        latestReason: "invalid chatid",
        invalidChatidSubscriberCount: 2,
        subscriberFanoutExhaustedJobCount: 1,
        residualClass: "stale-invalid-chatid-subscriber",
      },
    });
    expect(queueStatus.entrySurface).toEqual({
      entryRole: "runtime_query_api",
      accessMode: "read_only",
      ownerSurface: "admin_read_service",
      auditMode: "none",
      requestDedupe: "none",
    });
    expect(queueStatus.observabilityStreams).toEqual([
      "queue_snapshot",
      "analysis_dead_letter_summary",
      "sync_execution_summary",
    ]);
  });

  it("returns the latest conversation review summary with unresolved high-severity findings", async () => {
    const queueStore = {
      listConversationReviewRuns: vi.fn().mockResolvedValue([
        {
          reviewRunId: "run-1",
          reviewDate: "2026-04-16",
          sourceWindowStart: "2026-04-15T00:00:00.000Z",
          sourceWindowEnd: "2026-04-16T00:00:00.000Z",
          status: "completed",
          inputConversationCount: 12,
          inputShadowSampleCount: 0,
          inputAnalysisJobCount: 3,
          findingCount: 2,
          summaryJson: JSON.stringify({
            reviewMode: "deterministic-only",
            reviewDate: "2026-04-16",
            sourceWindowStart: "2026-04-15T00:00:00.000Z",
            sourceWindowEnd: "2026-04-16T00:00:00.000Z",
            inputConversationCount: 12,
            inputShadowSampleCount: 0,
            inputAnalysisJobCount: 3,
            findingCount: 2,
            topFindingTypes: ["scope_gap", "analysis_gap"],
            severityBreakdown: {
              low: 0,
              medium: 0,
              high: 2,
            },
          }),
          createdAt: "2026-04-16T01:00:00.000Z",
          updatedAt: "2026-04-16T01:05:00.000Z",
        },
      ]),
      listConversationReviewFindings: vi.fn().mockResolvedValue([
        {
          findingId: "finding-1",
          reviewRunId: "run-1",
          findingType: "scope_gap",
          severity: "high",
          title: "缺少默认时间窗",
          summary: "用户问这几天但没有走默认5天。",
          evidenceJson: "{}",
          status: "open",
          createdAt: "2026-04-16T01:01:00.000Z",
        },
        {
          findingId: "finding-2",
          reviewRunId: "run-1",
          findingType: "memory_candidate",
          severity: "medium",
          title: "默认规则候选",
          summary: "用户明确给了默认5天口径。",
          evidenceJson: "{}",
          status: "open",
          createdAt: "2026-04-16T01:02:00.000Z",
        },
      ]),
    };
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () =>
        ({
          getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
        }) as never,
    });

    const result = await service.getLatestConversationReviewSummary();

    expect(result).toMatchObject({
      run: {
        reviewRunId: "run-1",
        status: "completed",
      },
      summary: {
        reviewMode: "deterministic-only",
        topFindingTypes: ["scope_gap", "analysis_gap"],
      },
      unresolvedHighSeverityFindings: [
        expect.objectContaining({
          findingId: "finding-1",
          findingType: "scope_gap",
          severity: "high",
        }),
      ],
    });
  });

  it("aggregates top finding types and suggested action counts for conversation review summary", async () => {
    const queueStore = {
      listConversationReviewRuns: vi.fn().mockResolvedValue([
        {
          reviewRunId: "run-2",
          reviewDate: "2026-04-16",
          sourceWindowStart: "2026-04-15T00:00:00.000Z",
          sourceWindowEnd: "2026-04-16T00:00:00.000Z",
          status: "completed",
          inputConversationCount: 20,
          inputShadowSampleCount: 0,
          inputAnalysisJobCount: 3,
          findingCount: 5,
          summaryJson: JSON.stringify({
            reviewMode: "deterministic-only",
            reviewDate: "2026-04-16",
            sourceWindowStart: "2026-04-15T00:00:00.000Z",
            sourceWindowEnd: "2026-04-16T00:00:00.000Z",
            inputConversationCount: 20,
            inputShadowSampleCount: 0,
            inputAnalysisJobCount: 3,
            findingCount: 5,
            topFindingTypes: ["scope_gap", "analysis_gap"],
            severityBreakdown: { low: 0, medium: 1, high: 4 },
          }),
          createdAt: "2026-04-16T01:00:00.000Z",
          updatedAt: "2026-04-16T01:05:00.000Z",
        },
      ]),
      listConversationReviewFindings: vi.fn().mockResolvedValue([
        {
          findingId: "f-1",
          reviewRunId: "run-2",
          findingType: "scope_gap",
          severity: "high",
          title: "缺少默认时间窗",
          summary: "用户问这几天但没有走默认5天。",
          evidenceJson: "{}",
          suggestedActionType: "add_eval_sample",
          followupTargets: ["sample_candidate", "backlog_candidate"],
          status: "open",
          createdAt: "2026-04-16T01:01:00.000Z",
        },
        {
          findingId: "f-2",
          reviewRunId: "run-2",
          findingType: "scope_gap",
          severity: "high",
          title: "口语范围未结构化",
          summary: "时间窗表达还没标准化。",
          evidenceJson: "{}",
          suggestedActionType: "add_eval_sample",
          followupTargets: ["sample_candidate", "backlog_candidate"],
          status: "open",
          createdAt: "2026-04-16T01:02:00.000Z",
        },
        {
          findingId: "f-3",
          reviewRunId: "run-2",
          findingType: "analysis_gap",
          severity: "high",
          title: "analysis fallback",
          summary: "bounded synthesis 退化。",
          evidenceJson: "{}",
          suggestedActionType: "add_diagnostic_signal",
          followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
          status: "open",
          createdAt: "2026-04-16T01:03:00.000Z",
        },
      ]),
    };
    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () =>
        ({
          getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
        }) as never,
    });

    const summary = await service.getConversationReviewSummary();

    expect(summary.latestRun?.findingCount).toBe(5);
    expect(summary.topFindingTypes[0]).toEqual({
      findingType: "scope_gap",
      count: 2,
    });
    expect(summary.suggestedActionCounts).toEqual([
      { suggestedActionType: "add_eval_sample", count: 2 },
      { suggestedActionType: "add_diagnostic_signal", count: 1 },
    ]);
    expect(summary.followupTargetCounts).toEqual([
      { followupTarget: "backlog_candidate", count: 3 },
      { followupTarget: "sample_candidate", count: 2 },
      { followupTarget: "deploy_followup_candidate", count: 1 },
    ]);
    expect(summary.unresolvedHighSeverityFindings).toHaveLength(3);
  });

  it("surfaces stale sync execution in scheduler warnings and queue summary", async () => {
    const queueStore = {
      getScheduledJobState: vi.fn().mockResolvedValue(null),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
      getAnalysisQueueSummary: vi.fn().mockResolvedValue({
        pendingCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        jobDeliveryPendingCount: 0,
        jobDeliveryRetryingCount: 0,
        jobDeliveryAbandonedCount: 0,
        subscriberDeliveryPendingCount: 0,
        subscriberDeliveryRetryingCount: 0,
        subscriberDeliveryAbandonedCount: 0,
        unresolvedDeadLetterCount: 0,
      }),
    };
    const store = {
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
      getMartDerivedStore: vi.fn().mockReturnValue({
        listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
      }),
      getSyncRunExecutionSummary: vi.fn().mockResolvedValue({
        runningCount: 3,
        staleRunningCount: 2,
        dailyRunningCount: 2,
        staleDailyRunningCount: 1,
        backfillRunningCount: 1,
        staleBackfillRunningCount: 1,
        latestStartedAt: "2026-04-17T02:58:35.583Z",
      }),
    };

    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const now = new Date("2026-04-17T11:05:00+08:00");
    const schedulerStatus = await service.getSchedulerStatus(now);
    const queueStatus = await service.getQueueStatus(now, schedulerStatus);

    expect(schedulerStatus.warnings).toContain(
      "stale sync runs present: running 3 | stale 2 | daily 2/1 | backfill 1/1 | latest=2026-04-17T02:58:35.583Z | age=0.1h",
    );
    expect(queueStatus.observabilityStreams).toEqual([
      "queue_snapshot",
      "analysis_dead_letter_summary",
      "sync_execution_summary",
    ]);
    expect(queueStatus.syncExecution).toEqual({
      runningCount: 3,
      staleRunningCount: 2,
      dailyRunningCount: 2,
      staleDailyRunningCount: 1,
      backfillRunningCount: 1,
      staleBackfillRunningCount: 1,
      latestStartedAt: "2026-04-17T02:58:35.583Z",
      latestAgeHours: 0.1,
      staleCutoffAt: "2026-04-16T23:05:00.000Z",
    });
  });

  it("explains when scheduled-sync lastRun is old because a current sync wave is still in progress", async () => {
    const queueStore = {
      getScheduledJobState: vi
        .fn()
        .mockImplementation(async (_jobType: string, stateKey: string) => {
          if (stateKey === "scheduled-sync") {
            return {
              poller: "scheduled-sync",
              status: "ok",
              lastRunAt: "2026-04-16T18:59:52.583Z",
              lastSuccessAt: "2026-04-16T18:59:52.583Z",
              lastResultCount: 0,
            };
          }
          return null;
        }),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set<string>()),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({}),
      getAnalysisQueueSummary: vi.fn().mockResolvedValue({
        pendingCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        jobDeliveryPendingCount: 0,
        jobDeliveryRetryingCount: 0,
        jobDeliveryAbandonedCount: 0,
        subscriberDeliveryPendingCount: 0,
        subscriberDeliveryRetryingCount: 0,
        subscriberDeliveryAbandonedCount: 0,
        unresolvedDeadLetterCount: 0,
      }),
    };
    const store = {
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
      getMartDerivedStore: vi.fn().mockReturnValue({
        listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
      }),
      getSyncRunExecutionSummary: vi.fn().mockResolvedValue({
        runningCount: 1,
        staleRunningCount: 0,
        dailyRunningCount: 1,
        staleDailyRunningCount: 0,
        backfillRunningCount: 0,
        staleBackfillRunningCount: 0,
        latestStartedAt: "2026-04-17T03:43:37.088Z",
      }),
    };

    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-17T11:46:54+08:00"));

    expect(status.warnings).toContain(
      "scheduled sync wave in progress: running 1 | daily 1 | backfill 0 | latest=2026-04-17T03:43:37.088Z | age=0.1h | scheduled-sync lastRun updates after the current wave finishes",
    );
  });

  it("explains when scheduled-sync lastRun lags a completed sync job but no active sync wave exists", async () => {
    const queueStore = {
      getScheduledJobState: vi
        .fn()
        .mockImplementation(async (_jobType: string, stateKey: string) => {
          if (stateKey === "scheduled-sync") {
            return {
              poller: "scheduled-sync",
              status: "ok",
              lastRunAt: "2026-04-18T00:00:13.403Z",
              lastSuccessAt: "2026-04-18T00:00:13.403Z",
              lastResultCount: 7,
            };
          }
          return null;
        }),
      listCompletedRunKeys: vi.fn().mockResolvedValue(new Set(["sync:2026-04-18"])),
      getLatestScheduledJobRunTimes: vi.fn().mockResolvedValue({
        sync: "2026-04-18T04:25:32.880Z",
      }),
      getAnalysisQueueSummary: vi.fn().mockResolvedValue({
        pendingCount: 0,
        runningCount: 0,
        completedCount: 0,
        failedCount: 0,
        jobDeliveryPendingCount: 0,
        jobDeliveryRetryingCount: 0,
        jobDeliveryAbandonedCount: 0,
        subscriberDeliveryPendingCount: 0,
        subscriberDeliveryRetryingCount: 0,
        subscriberDeliveryAbandonedCount: 0,
        unresolvedDeadLetterCount: 0,
      }),
    };
    const store = {
      getQueueAccessControlStore: vi.fn().mockReturnValue(queueStore),
      getMartDerivedStore: vi.fn().mockReturnValue({
        listRecentReportDeliveryUpgrades: vi.fn().mockResolvedValue([]),
      }),
      getSyncRunExecutionSummary: vi.fn().mockResolvedValue({
        runningCount: 0,
        staleRunningCount: 0,
        dailyRunningCount: 0,
        staleDailyRunningCount: 0,
        backfillRunningCount: 0,
        staleBackfillRunningCount: 0,
      }),
    };

    const service = new HetangAdminReadService({
      config: buildConfig(),
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      getStore: async () => store as never,
    });

    const status = await service.getSchedulerStatus(new Date("2026-04-18T12:31:47+08:00"));

    expect(status.warnings).toContain(
      "scheduled-sync poller timestamp lags completed sync job | poller=2026-04-18T00:00:13.403Z | syncJob=2026-04-18T04:25:32.880Z | no active sync wave; scheduler job sync is authoritative",
    );
  });
});
