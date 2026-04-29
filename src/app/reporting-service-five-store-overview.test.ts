import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHetangOpsConfig } from "../config.js";
import type { DailyStoreMetrics, DailyStoreReport } from "../types.js";

const sendReportMessageMock = vi.fn(async () => undefined);

vi.mock("../notify.js", () => ({
  sendReportMessage: sendReportMessageMock,
}));

const { HetangReportingService } = await import("./reporting-service.js");

function buildConfig() {
  return resolveHetangOpsConfig({
    api: { appKey: "demo", appSecret: "demo" },
    database: { url: "postgresql://demo:demo@127.0.0.1:5432/demo" },
    sync: {
      enabled: false,
      historyBackfillEnabled: false,
    },
    stores: [
      { orgId: "1001", storeName: "迎宾店" },
      { orgId: "1002", storeName: "滨江店" },
      { orgId: "1003", storeName: "华美店" },
      { orgId: "1004", storeName: "义乌店" },
      { orgId: "1005", storeName: "园中园店" },
    ],
    reporting: {
      sharedDelivery: {
        channel: "wecom",
        target: "hetang-managers",
        enabled: true,
      },
    },
  });
}

function buildMetrics(params: {
  orgId: string;
  storeName: string;
  bizDate: string;
  serviceRevenue: number;
  customerCount: number;
  totalClockCount: number;
  pointClockRate: number;
  addClockRate: number;
  clockEffect: number;
}): DailyStoreMetrics {
  const effectiveMembers = Math.max(params.customerCount * 2, 40);
  const newMembers = Math.max(Math.round(params.customerCount / 15), 1);
  const sleepingMembers = Math.max(Math.round(effectiveMembers * 0.16), 1);
  const sleepingMemberRate = sleepingMembers / effectiveMembers;
  const highBalanceSleepingMemberCount = Math.max(Math.round(effectiveMembers / 30), 1);
  const highBalanceSleepingMemberAmount = highBalanceSleepingMemberCount * 2600;
  const firstChargeUnconsumedMemberCount = Math.max(Math.round(newMembers * 0.8), 1);
  const firstChargeUnconsumedMemberAmount = firstChargeUnconsumedMemberCount * 1200;
  const memberRepurchaseBaseCustomerCount7d = Math.max(Math.round(params.customerCount / 3), 12);
  const memberRepurchaseReturnedCustomerCount7d = Math.max(
    Math.round(memberRepurchaseBaseCustomerCount7d * 0.36),
    1,
  );
  const memberRepurchaseRate7d =
    memberRepurchaseReturnedCustomerCount7d / memberRepurchaseBaseCustomerCount7d;

  return {
    orgId: params.orgId,
    storeName: params.storeName,
    bizDate: params.bizDate,
    serviceRevenue: params.serviceRevenue,
    rechargeCash: 0,
    rechargeStoredValue: 0,
    rechargeBonusValue: 0,
    antiServiceRevenue: 0,
    serviceOrderCount: params.customerCount,
    customerCount: params.customerCount,
    averageTicket: params.customerCount > 0 ? params.serviceRevenue / params.customerCount : 0,
    totalClockCount: params.totalClockCount,
    upClockRecordCount: params.totalClockCount,
    pointClockRecordCount: Math.round(params.totalClockCount * params.pointClockRate),
    pointClockRate: params.pointClockRate,
    addClockRecordCount: Math.round(params.totalClockCount * params.addClockRate),
    addClockRate: params.addClockRate,
    clockRevenue: params.serviceRevenue,
    clockEffect: params.clockEffect,
    activeTechCount: 12,
    onDutyTechCount: 14,
    techCommission: 0,
    techCommissionRate: 0,
    marketRevenue: 0,
    marketCommission: 0,
    memberPaymentAmount: 0,
    memberPaymentShare: null,
    cashPaymentAmount: 0,
    cashPaymentShare: null,
    wechatPaymentAmount: 0,
    wechatPaymentShare: null,
    alipayPaymentAmount: 0,
    alipayPaymentShare: null,
    storedConsumeAmount: 0,
    storedConsumeRate: null,
    groupbuyOrderCount: 0,
    groupbuyOrderShare: null,
    groupbuyAmount: 0,
    groupbuyAmountShare: null,
    groupbuyPlatformBreakdown: [],
    groupbuyCohortCustomerCount: 0,
    groupbuyRevisitCustomerCount: 0,
    groupbuyRevisitRate: null,
    groupbuyMemberPayConvertedCustomerCount: 0,
    groupbuyMemberPayConversionRate: null,
    groupbuy7dRevisitCustomerCount: 0,
    groupbuy7dRevisitRate: null,
    groupbuy7dCardOpenedCustomerCount: 0,
    groupbuy7dCardOpenedRate: null,
    groupbuy7dStoredValueConvertedCustomerCount: 0,
    groupbuy7dStoredValueConversionRate: null,
    groupbuy30dMemberPayConvertedCustomerCount: 0,
    groupbuy30dMemberPayConversionRate: null,
    groupbuyFirstOrderCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberRate: null,
    effectiveMembers,
    newMembers,
    sleepingMembers,
    sleepingMemberRate,
    currentStoredBalance: 0,
    highBalanceSleepingMemberCount,
    highBalanceSleepingMemberAmount,
    firstChargeUnconsumedMemberCount,
    firstChargeUnconsumedMemberAmount,
    storedBalanceLifeMonths: null,
    renewalPressureIndex30d: null,
    memberRepurchaseBaseCustomerCount7d,
    memberRepurchaseReturnedCustomerCount7d,
    memberRepurchaseRate7d,
    roomOccupancyRate: null,
    roomTurnoverRate: null,
    grossMarginRate: 0.45,
    netMarginRate: 0.16,
    breakEvenRevenue: null,
    incompleteSync: false,
    staleSyncEndpoints: [],
    unavailableMetrics: [],
  };
}

function buildReport(params: {
  orgId: string;
  storeName: string;
  bizDate: string;
  serviceRevenue: number;
  customerCount: number;
  totalClockCount: number;
  pointClockRate: number;
  addClockRate: number;
  clockEffect: number;
  complete?: boolean;
  markdown?: string;
}): DailyStoreReport {
  return {
    orgId: params.orgId,
    storeName: params.storeName,
    bizDate: params.bizDate,
    metrics: buildMetrics(params),
    alerts: [],
    suggestions: [],
    markdown: params.markdown ?? `${params.storeName} ${params.bizDate} 日报`,
    complete: params.complete ?? true,
  };
}

function buildService(
  reportMap: Map<string, DailyStoreReport | null>,
  environmentMap = new Map<string, Record<string, unknown> | null>(),
) {
  const scheduledJobState = new Map<string, Record<string, unknown>>();
  const fakeStore = {
    getDailyReport: vi.fn(async (orgId: string, bizDate: string) => reportMap.get(`${orgId}:${bizDate}`) ?? null),
    getStoreEnvironmentDailySnapshot: vi.fn(
      async (orgId: string, bizDate: string) => environmentMap.get(`${orgId}:${bizDate}`) ?? null,
    ),
    getEndpointWatermarksForOrg: vi.fn(async () => ({})),
    resolveControlTowerSettings: vi.fn(async () => ({})),
    getScheduledJobState: vi.fn(async (jobType: string, stateKey: string) => {
      return scheduledJobState.get(`${jobType}:${stateKey}`) ?? null;
    }),
    setScheduledJobState: vi.fn(
      async (jobType: string, stateKey: string, state: Record<string, unknown>) => {
        scheduledJobState.set(`${jobType}:${stateKey}`, state);
      },
    ),
    markScheduledJobCompleted: vi.fn(async () => undefined),
    getMartDerivedStore() {
      return this;
    },
    getQueueAccessControlStore() {
      return this;
    },
    getRawIngestionStore() {
      return this;
    },
  };

  const service = new HetangReportingService({
    config: buildConfig(),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getStore: async () => fakeStore as never,
    runCommandWithTimeout: vi.fn() as never,
    listCustomerSegments: async () => [],
    listMemberReactivationFeatures: async () => [],
    listMemberReactivationStrategies: async () => [],
  });

  return {
    fakeStore,
    scheduledJobState,
    service,
  };
}

function seedCompleteReportMap() {
  const reportMap = new Map<string, DailyStoreReport | null>();
  const currentDate = "2026-04-22";
  const baselineDate = "2026-04-15";
  const stores = [
    {
      orgId: "1001",
      storeName: "迎宾店",
      current: { serviceRevenue: 12800, customerCount: 88, totalClockCount: 124, pointClockRate: 0.28, addClockRate: 0.24, clockEffect: 103.2 },
      baseline: { serviceRevenue: 11600, customerCount: 81, totalClockCount: 116, pointClockRate: 0.24, addClockRate: 0.2, clockEffect: 100 },
    },
    {
      orgId: "1002",
      storeName: "滨江店",
      current: { serviceRevenue: 9800, customerCount: 74, totalClockCount: 108, pointClockRate: 0.18, addClockRate: 0.11, clockEffect: 90.7 },
      baseline: { serviceRevenue: 10200, customerCount: 78, totalClockCount: 111, pointClockRate: 0.2, addClockRate: 0.14, clockEffect: 91.9 },
    },
    {
      orgId: "1003",
      storeName: "华美店",
      current: { serviceRevenue: 10400, customerCount: 83, totalClockCount: 121, pointClockRate: 0.31, addClockRate: 0.16, clockEffect: 86 },
      baseline: { serviceRevenue: 9900, customerCount: 80, totalClockCount: 117, pointClockRate: 0.27, addClockRate: 0.15, clockEffect: 84.6 },
    },
    {
      orgId: "1004",
      storeName: "义乌店",
      current: { serviceRevenue: 9300, customerCount: 69, totalClockCount: 98, pointClockRate: 0.22, addClockRate: 0.19, clockEffect: 94.9 },
      baseline: { serviceRevenue: 8800, customerCount: 65, totalClockCount: 93, pointClockRate: 0.19, addClockRate: 0.16, clockEffect: 94.6 },
    },
    {
      orgId: "1005",
      storeName: "园中园店",
      current: { serviceRevenue: 8700, customerCount: 71, totalClockCount: 104, pointClockRate: 0.2, addClockRate: 0.13, clockEffect: 83.7 },
      baseline: { serviceRevenue: 9100, customerCount: 73, totalClockCount: 107, pointClockRate: 0.22, addClockRate: 0.15, clockEffect: 85 },
    },
  ] as const;

  for (const store of stores) {
    reportMap.set(
      `${store.orgId}:${currentDate}`,
      buildReport({
        orgId: store.orgId,
        storeName: store.storeName,
        bizDate: currentDate,
        ...store.current,
      }),
    );
    reportMap.set(
      `${store.orgId}:${baselineDate}`,
      buildReport({
        orgId: store.orgId,
        storeName: store.storeName,
        bizDate: baselineDate,
        ...store.baseline,
      }),
    );
  }

  return reportMap;
}

describe("HetangReportingService five-store daily overview", () => {
  beforeEach(() => {
    sendReportMessageMock.mockClear();
  });

  it("sends the five-store overview directly to the shared delivery target by default", async () => {
    const reportMap = seedCompleteReportMap();
    const { service, fakeStore, scheduledJobState } = buildService(reportMap);

    const markdown = await service.renderFiveStoreDailyOverview({
      bizDate: "2026-04-22",
    });
    const result = await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:40:00Z"),
    });

    expect(fakeStore.getDailyReport).toHaveBeenCalledWith("1001", "2026-04-22");
    expect(fakeStore.getDailyReport).toHaveBeenCalledWith("1001", "2026-04-15");
    expect(markdown).toContain("# 荷塘悦色5店昨日经营总览");
    expect(markdown).toContain("## 二、证据链");
    expect(markdown).toContain("## 三、真正的核心问题");
    expect(markdown).toContain("## 四、最值得警惕的会员信号");
    expect(markdown).toContain("## 五、门店级判断");
    expect(markdown).toContain("## 六、如果今天只做一件事");
    expect(markdown).toContain("这不是销售问题，这是激活问题。");
    expect(markdown).toContain("48小时首耗激活完成率");
    expect(markdown).not.toContain("客单");
    expect(markdown).not.toContain("现金与会员边界");
    expect(markdown).not.toContain("N/A");
    expect(result).toBe("five-store daily overview sent for 2026-04-22");
    expect(sendReportMessageMock).toHaveBeenCalledTimes(1);
    expect(sendReportMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          channel: "wecom",
          target: "hetang-managers",
        }),
        message: markdown,
      }),
    );
    expect(scheduledJobState.get("send-five-store-daily-overview:2026-04-22")).toMatchObject({
      stage: "sent",
      finalTarget: {
        channel: "wecom",
        target: "hetang-managers",
        enabled: true,
      },
      finalMessage: markdown,
    });
  });

  it("keeps preview mode available for manual operator review", async () => {
    const reportMap = seedCompleteReportMap();
    const { service, scheduledJobState } = buildService(reportMap);

    const result = await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:40:00Z"),
      deliveryMode: "preview",
    });

    expect(result).toBe("five-store daily overview preview sent to ZhangZhen for 2026-04-22");
    expect(sendReportMessageMock).toHaveBeenCalledTimes(1);
    expect(sendReportMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          channel: "wecom",
          target: "ZhangZhen",
        }),
        message: expect.stringContaining("请确认后再发店长群"),
      }),
    );
    expect(scheduledJobState.get("send-five-store-daily-overview:2026-04-22")).toMatchObject({
      stage: "pending_confirm",
    });
  });

  it("does not resend the preview while the same five-store overview is still pending confirmation", async () => {
    const reportMap = seedCompleteReportMap();
    const { service } = buildService(reportMap);

    const firstResult = await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:40:00Z"),
      deliveryMode: "preview",
    });
    const secondResult = await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:45:00Z"),
      deliveryMode: "preview",
    });

    expect(firstResult).toBe("five-store daily overview preview sent to ZhangZhen for 2026-04-22");
    expect(secondResult).toBe("five-store daily overview 2026-04-22: pending confirmation");
    expect(sendReportMessageMock).toHaveBeenCalledTimes(1);
  });

  it("confirms and sends the exact previewed five-store overview to the shared manager group", async () => {
    const reportMap = seedCompleteReportMap();
    const { service, fakeStore } = buildService(reportMap);

    await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:40:00Z"),
      deliveryMode: "preview",
    });
    sendReportMessageMock.mockClear();

    const result = await service.confirmFiveStoreDailyOverviewSend({
      bizDate: "2026-04-22",
      confirmedAt: "2026-04-23T03:50:00Z",
      confirmedBy: "codex-window",
    });

    expect(result).toBe("five-store daily overview sent for 2026-04-22");
    expect(sendReportMessageMock).toHaveBeenCalledTimes(1);
    expect(sendReportMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          channel: "wecom",
          target: "hetang-managers",
        }),
        message: expect.stringContaining("## 五、门店级判断"),
      }),
    );
    expect(fakeStore.markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-five-store-daily-overview",
      "2026-04-22",
      "2026-04-23T03:50:00Z",
    );
  });

  it("can cancel a pending preview and suppress any later resend for the same business date", async () => {
    const reportMap = seedCompleteReportMap();
    const { service, fakeStore, scheduledJobState } = buildService(reportMap);

    await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:40:00Z"),
      deliveryMode: "preview",
    });

    const result = await service.cancelFiveStoreDailyOverviewSend({
      bizDate: "2026-04-22",
      canceledAt: "2026-04-23T04:10:00Z",
      canceledBy: "codex-window",
    });
    const resendResult = await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T04:20:00Z"),
      deliveryMode: "preview",
    });

    expect(result).toBe("five-store daily overview cancelled for 2026-04-22");
    expect(resendResult).toBe("five-store daily overview cancelled for 2026-04-22");
    expect(sendReportMessageMock).toHaveBeenCalledTimes(1);
    expect(fakeStore.markScheduledJobCompleted).toHaveBeenCalledWith(
      "send-five-store-daily-overview",
      "2026-04-22",
      "2026-04-23T04:10:00Z",
    );
    expect(scheduledJobState.get("send-five-store-daily-overview:2026-04-22")).toMatchObject({
      stage: "cancelled",
      canceledAt: "2026-04-23T04:10:00Z",
      canceledBy: "codex-window",
    });
  });

  it("does not send the five-store overview when any store report is incomplete", async () => {
    const reportMap = seedCompleteReportMap();
    reportMap.set(
      "1002:2026-04-22",
      buildReport({
        orgId: "1002",
        storeName: "滨江店",
        bizDate: "2026-04-22",
        serviceRevenue: 9800,
        customerCount: 74,
        totalClockCount: 108,
        pointClockRate: 0.18,
        addClockRate: 0.11,
        clockEffect: 90.7,
        complete: false,
        markdown: "滨江店同步异常告警",
      }),
    );
    const { service } = buildService(reportMap);

    const result = await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:40:00Z"),
    });

    expect(result).toBe("five-store daily overview 2026-04-22: waiting - daily reports incomplete");
    expect(sendReportMessageMock).not.toHaveBeenCalled();
  });

  it("treats cached completed reports with the current daily report blocks as fresh enough for direct send", async () => {
    const reportMap = seedCompleteReportMap();
    for (const key of [...reportMap.keys()]) {
      if (!key.endsWith(":2026-04-22")) {
        continue;
      }
      const report = reportMap.get(key)!;
      reportMap.set(key, {
        ...report,
        markdown: [
          `${report.storeName} ${report.bizDate} 经营数据报告`,
          "口径：主项总钟数只含足道主项，不含SPA/采耳/小项",
          "预估到店人数：66人",
          "【补充指标】",
          "- 团购订单：9单",
        ].join("\n"),
      });
    }
    const { service, fakeStore } = buildService(reportMap);

    const result = await service.sendFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:40:00Z"),
    });

    expect(result).toBe("five-store daily overview sent for 2026-04-22");
    expect(fakeStore.resolveControlTowerSettings).not.toHaveBeenCalled();
  });

  it("keeps environment memory hidden when all narrative policies are suppress", async () => {
    const reportMap = seedCompleteReportMap();
    const environmentMap = new Map<string, Record<string, unknown> | null>();
    for (const orgId of ["1001", "1002", "1003", "1004", "1005"]) {
      environmentMap.set(`${orgId}:2026-04-22`, {
        orgId,
        bizDate: "2026-04-22",
        holidayTag: "workday",
        narrativePolicy: "suppress",
      });
    }
    const { service } = buildService(reportMap, environmentMap);

    const message = await service.renderFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      baselineBizDate: "2026-04-15",
    });

    expect(message).not.toContain("背景提示");
    expect(message).not.toContain("天气");
  });

  it("adds one background hint when persisted environment memory allows mention", async () => {
    const reportMap = seedCompleteReportMap();
    const environmentMap = new Map<string, Record<string, unknown> | null>([
      [
        "1004:2026-04-22",
        {
          orgId: "1004",
          bizDate: "2026-04-22",
          holidayTag: "holiday",
          holidayName: "劳动节",
          narrativePolicy: "mention",
          badWeatherTouchPenalty: "none",
        },
      ],
    ]);
    const { service } = buildService(reportMap, environmentMap);

    const message = await service.renderFiveStoreDailyOverview({
      bizDate: "2026-04-22",
      baselineBizDate: "2026-04-15",
    });

    expect(message).toContain("背景提示");
    expect(message).toContain("劳动节");
  });
});
