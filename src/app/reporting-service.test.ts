import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../report.js", () => ({
  buildDailyStoreReport: vi.fn(),
  renderStoreMiddayBrief: vi.fn(),
}));

import { buildDailyStoreReport } from "../report.js";
import { HetangReportingService } from "./reporting-service.js";

function buildService(params: {
  cachedReport?: Record<string, unknown> | null;
  rebuiltReport?: Record<string, unknown>;
  rawWatermarks?: Record<string, string>;
}) {
  process.env.HETANG_MESSAGE_SEND_BIN = "/tmp/fake-send";
  const martStore = {
    getDailyReport: vi.fn().mockResolvedValue(params.cachedReport ?? null),
    listStoreReview7dByDateRange: vi.fn().mockResolvedValue([]),
    listStoreSummary30dByDateRange: vi.fn().mockResolvedValue([]),
    markReportSent: vi.fn(),
    recordReportDeliveryUpgrade: vi.fn(),
  };
  const queueStore = {
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
  };
  const rawStore = {
    getEndpointWatermarksForOrg: vi.fn().mockResolvedValue(params.rawWatermarks ?? {}),
  };
  const store = {
    getMartDerivedStore: () => martStore,
    getQueueAccessControlStore: () => queueStore,
    getRawIngestionStore: () => rawStore,
  };
  const service = new HetangReportingService({
    config: {
      timeZone: "Asia/Shanghai",
      reporting: {
        sharedDelivery: {
          enabled: true,
          channel: "wecom",
          target: "hq-group",
        },
      },
      sync: {
        businessDayCutoffLocalTime: "03:00",
      },
      analysis: {
        revenueDropAlertThreshold: 0.2,
        clockDropAlertThreshold: 0.2,
        antiRatioAlertThreshold: 0.1,
        lowTechActiveCountThreshold: 3,
        lowStoredConsumeRateThreshold: 0.8,
        sleepingMemberRateAlertThreshold: 0.2,
        highTechCommissionRateThreshold: 0.5,
      },
      stores: [{ orgId: "1001", storeName: "义乌店" }],
    } as never,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getStore: async () => store as never,
    runCommandWithTimeout: vi
      .fn()
      .mockResolvedValue({ code: 0, stdout: "", stderr: "" }) as never,
    listCustomerSegments: vi.fn().mockResolvedValue([]),
    listMemberReactivationFeatures: vi.fn().mockResolvedValue([]),
    listMemberReactivationStrategies: vi.fn().mockResolvedValue([]),
  });
  vi.mocked(buildDailyStoreReport).mockResolvedValue((params.rebuiltReport ?? null) as never);
  return {
    service,
    martStore,
  };
}

function buildCompleteDeliveryWatermarks(bizDate: string): Record<string, string> {
  const completionIso = `${bizDate}T19:10:00.000Z`;
  return Object.fromEntries(
    ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"].map((endpoint) => [
      endpoint,
      completionIso,
    ]),
  );
}

describe("HetangReportingService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rebuilds complete cached daily reports when cached markdown is still legacy format", async () => {
    const cachedReport = {
      orgId: "1001",
      storeName: "义乌店",
      bizDate: "2026-04-12",
      complete: true,
      markdown: "2026年4月12日义乌店经营数据报告\n口径：营业日按次日03:00截止\n\n【详细指标】",
      metrics: {},
      alerts: [],
      suggestions: [],
    };
    const rebuiltReport = {
      ...cachedReport,
      markdown: "2026年4月12日 义乌店经营数据报告  \n营业日口径：次日03:00截止  \n\n【技师出勤】",
    };
    const { service, martStore } = buildService({
      cachedReport,
      rebuiltReport,
      rawWatermarks: buildCompleteDeliveryWatermarks("2026-04-12"),
    });

    const report = await service.buildReport({
      orgId: "1001",
      bizDate: "2026-04-12",
    });

    expect(martStore.getDailyReport).toHaveBeenCalledWith("1001", "2026-04-12");
    expect(buildDailyStoreReport).toHaveBeenCalledTimes(1);
    expect(report.markdown).toContain("【技师出勤】");
  });

  it("rebuilds complete cached daily reports when the markdown is missing estimated customer count", async () => {
    const cachedReport = {
      orgId: "1001",
      storeName: "义乌店",
      bizDate: "2026-04-12",
      complete: true,
      markdown:
        "2026年4月12日 义乌店经营数据报告  \n营业日口径：次日03:00截止  \n\n【技师出勤】  \n实力2位 / 明星1位 / SPA0位  \n\n【核心经营】  \n主项总钟数：7个",
      metrics: {},
      alerts: [],
      suggestions: [],
    };
    const rebuiltReport = {
      ...cachedReport,
      markdown: `${cachedReport.markdown}  \n预估到店人数：16人`,
    };
    const { service } = buildService({
      cachedReport,
      rebuiltReport,
      rawWatermarks: buildCompleteDeliveryWatermarks("2026-04-12"),
    });

    const report = await service.buildReport({
      orgId: "1001",
      bizDate: "2026-04-12",
    });

    expect(buildDailyStoreReport).toHaveBeenCalledTimes(1);
    expect(report.markdown).toContain("预估到店人数：16人");
  });

  it("rebuilds complete cached daily reports when the markdown is missing main-clock scope", async () => {
    const cachedReport = {
      orgId: "1001",
      storeName: "义乌店",
      bizDate: "2026-04-12",
      complete: true,
      markdown:
        "2026年4月12日 义乌店经营数据报告  \n营业日口径：次日03:00截止  \n\n【核心经营】  \n主项总钟数：7个  \n预估到店人数：16人",
      metrics: {},
      alerts: [],
      suggestions: [],
    };
    const rebuiltReport = {
      ...cachedReport,
      markdown: `${cachedReport.markdown}  \n口径：主项总钟数只含足道主项，不含SPA/采耳/小项`,
    };
    const { service } = buildService({
      cachedReport,
      rebuiltReport,
      rawWatermarks: buildCompleteDeliveryWatermarks("2026-04-12"),
    });

    const report = await service.buildReport({
      orgId: "1001",
      bizDate: "2026-04-12",
    });

    expect(buildDailyStoreReport).toHaveBeenCalledTimes(1);
    expect(report.markdown).toContain("口径：主项总钟数只含足道主项，不含SPA/采耳/小项");
  });

  it("records delivery upgrade telemetry when an alert-only report is upgraded to sent", async () => {
    const cachedReport = {
      orgId: "1001",
      storeName: "义乌店",
      bizDate: "2026-04-12",
      complete: false,
      markdown: "义乌店异常告警",
      metrics: {},
      alerts: [{ severity: "high", message: "1.4 未闭环" }],
      suggestions: [],
      sentAt: "2026-04-13T01:00:00.000Z",
      sendStatus: "alert-only",
    };
    const rebuiltReport = {
      orgId: "1001",
      storeName: "义乌店",
      bizDate: "2026-04-12",
      complete: true,
      markdown: "义乌店正式日报",
      metrics: {},
      alerts: [],
      suggestions: [],
    };
    const { service, martStore } = buildService({
      cachedReport,
      rebuiltReport,
      rawWatermarks: buildCompleteDeliveryWatermarks("2026-04-12"),
    });

    await service.sendReport({
      orgId: "1001",
      bizDate: "2026-04-12",
    });

    expect(martStore.markReportSent).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-04-12",
        sendStatus: "sent",
      }),
    );
    expect(martStore.recordReportDeliveryUpgrade).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "1001",
        bizDate: "2026-04-12",
        storeName: "义乌店",
        alertSentAt: "2026-04-13T01:00:00.000Z",
      }),
    );
  });

  it("fails fast when the mart-derived owner getter is missing", async () => {
    process.env.HETANG_MESSAGE_SEND_BIN = "/tmp/fake-send";
    const service = new HetangReportingService({
      config: {
        timeZone: "Asia/Shanghai",
        reporting: {
          sharedDelivery: {
            enabled: true,
            channel: "wecom",
            target: "hq-group",
          },
        },
        sync: {
          businessDayCutoffLocalTime: "03:00",
        },
        analysis: {
          revenueDropAlertThreshold: 0.2,
          clockDropAlertThreshold: 0.2,
          antiRatioAlertThreshold: 0.1,
          lowTechActiveCountThreshold: 3,
          lowStoredConsumeRateThreshold: 0.8,
          sleepingMemberRateAlertThreshold: 0.2,
          highTechCommissionRateThreshold: 0.5,
        },
        stores: [{ orgId: "1001", storeName: "义乌店" }],
      } as never,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      getStore: async () =>
        ({
          getQueueAccessControlStore: () => ({
            resolveControlTowerSettings: async () => ({}),
          }),
          getRawIngestionStore: () => ({
            getEndpointWatermarksForOrg: async () => buildCompleteDeliveryWatermarks("2026-04-12"),
          }),
        }) as never,
      runCommandWithTimeout: vi
        .fn()
        .mockResolvedValue({ code: 0, stdout: "", stderr: "" }) as never,
      listCustomerSegments: vi.fn().mockResolvedValue([]),
      listMemberReactivationFeatures: vi.fn().mockResolvedValue([]),
      listMemberReactivationStrategies: vi.fn().mockResolvedValue([]),
    });
    vi.mocked(buildDailyStoreReport).mockResolvedValue({
      orgId: "1001",
      storeName: "义乌店",
      bizDate: "2026-04-12",
      complete: true,
      markdown: "ok",
      metrics: {},
      alerts: [],
      suggestions: [],
    } as never);

    await expect(
      service.buildReport({
        orgId: "1001",
        bizDate: "2026-04-12",
      }),
    ).rejects.toThrow("reporting-service requires store.getMartDerivedStore()");
  });
});
