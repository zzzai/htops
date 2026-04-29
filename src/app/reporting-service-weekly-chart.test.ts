import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHetangOpsConfig } from "../config.js";
import type { DailyStoreMetrics, DailyStoreReport } from "../types.js";

const buildWeeklyStoreChartDatasetMock = vi.fn();
const buildWeeklyStoreChartImageMock = vi.fn();
const sendReportImageMock = vi.fn(async () => undefined);

vi.mock("../weekly-chart-image.js", () => ({
  buildWeeklyStoreChartDataset: buildWeeklyStoreChartDatasetMock,
  buildWeeklyStoreChartImage: buildWeeklyStoreChartImageMock,
}));

vi.mock("../notify.js", () => ({
  sendReportMessage: vi.fn(async () => undefined),
  sendReportImage: sendReportImageMock,
}));

const { HetangReportingService } = await import("./reporting-service.js");

function buildConfig() {
  return resolveHetangOpsConfig({
    api: { appKey: "demo", appSecret: "demo" },
    database: { url: "postgresql://demo:demo@127.0.0.1:5432/demo" },
    stores: [
      { orgId: "1001", storeName: "荷塘悦色迎宾店" },
      { orgId: "1002", storeName: "荷塘悦色义乌店" },
      { orgId: "1003", storeName: "荷塘悦色华美店" },
      { orgId: "1004", storeName: "荷塘悦色锦苑店" },
      { orgId: "1005", storeName: "荷塘悦色园中园店" },
    ],
    reporting: {
      sharedDelivery: {
        channel: "wecom",
        target: "hetang-hq",
        enabled: true,
      },
    },
  });
}

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "荷塘悦色迎宾店",
    bizDate: "2026-04-19",
    serviceRevenue: 10000,
    rechargeCash: 3000,
    rechargeStoredValue: 0,
    rechargeBonusValue: 0,
    antiServiceRevenue: 0,
    serviceOrderCount: 80,
    customerCount: 70,
    averageTicket: 125,
    totalClockCount: 110,
    upClockRecordCount: 100,
    pointClockRecordCount: 20,
    pointClockRate: 0.2,
    addClockRecordCount: 22,
    addClockRate: 0.22,
    clockRevenue: 10000,
    clockEffect: 90.9,
    activeTechCount: 12,
    onDutyTechCount: 14,
    techCommission: 0,
    techCommissionRate: 0,
    marketRevenue: 800,
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
    groupbuy7dRevisitCustomerCount: 12,
    groupbuy7dRevisitRate: 0.32,
    groupbuy7dCardOpenedCustomerCount: 0,
    groupbuy7dCardOpenedRate: null,
    groupbuy7dStoredValueConvertedCustomerCount: 0,
    groupbuy7dStoredValueConversionRate: null,
    groupbuy30dMemberPayConvertedCustomerCount: 0,
    groupbuy30dMemberPayConversionRate: null,
    groupbuyFirstOrderCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberCustomerCount: 0,
    groupbuyFirstOrderHighValueMemberRate: null,
    effectiveMembers: 180,
    newMembers: 8,
    sleepingMembers: 20,
    sleepingMemberRate: 0.11,
    currentStoredBalance: 0,
    highBalanceSleepingMemberCount: 0,
    highBalanceSleepingMemberAmount: 0,
    firstChargeUnconsumedMemberCount: 0,
    firstChargeUnconsumedMemberAmount: 0,
    storedBalanceLifeMonths: null,
    renewalPressureIndex30d: null,
    memberRepurchaseBaseCustomerCount7d: 0,
    memberRepurchaseReturnedCustomerCount7d: 0,
    memberRepurchaseRate7d: null,
    roomOccupancyRate: null,
    roomTurnoverRate: null,
    grossMarginRate: 0.46,
    netMarginRate: 0.18,
    breakEvenRevenue: null,
    incompleteSync: false,
    staleSyncEndpoints: [],
    unavailableMetrics: [],
    ...overrides,
  };
}

function buildDailyReport(params: {
  orgId: string;
  storeName: string;
  bizDate: string;
  revenue: number;
}): DailyStoreReport {
  return {
    orgId: params.orgId,
    storeName: params.storeName,
    bizDate: params.bizDate,
    metrics: buildMetrics({
      orgId: params.orgId,
      storeName: params.storeName,
      bizDate: params.bizDate,
      serviceRevenue: params.revenue,
      rechargeCash: Math.round(params.revenue * 0.3),
      customerCount: Math.round(params.revenue / 180),
      averageTicket: 180,
      addClockRate: 0.18,
      pointClockRate: 0.31,
      newMembers: 4,
      groupbuy7dRevisitRate: 0.28,
    }),
    alerts: [],
    suggestions: [],
    markdown: "cached",
    complete: true,
  };
}

function buildReportMap() {
  const map = new Map<string, DailyStoreReport>();
  const stores = [
    ["1001", "荷塘悦色迎宾店", 12000],
    ["1002", "荷塘悦色义乌店", 11000],
    ["1003", "荷塘悦色华美店", 10500],
    ["1004", "荷塘悦色锦苑店", 9800],
    ["1005", "荷塘悦色园中园店", 10100],
  ] as const;

  for (const [orgId, storeName, revenueBase] of stores) {
    Array.from({ length: 14 }, (_, index) => {
      const bizDate = `2026-04-${String(6 + index).padStart(2, "0")}`;
      map.set(
        `${orgId}:${bizDate}`,
        buildDailyReport({
          orgId,
          storeName,
          bizDate,
          revenue: (index < 7 ? revenueBase - 1600 : revenueBase) + index * 300,
        }),
      );
    });
  }

  return map;
}

describe("HetangReportingService weekly chart image", () => {
  beforeEach(() => {
    buildWeeklyStoreChartDatasetMock.mockReset();
    buildWeeklyStoreChartImageMock.mockReset();
    sendReportImageMock.mockClear();
    buildWeeklyStoreChartDatasetMock.mockReturnValue({
      title: "荷塘悦色5店周经营决策图",
      weekEndBizDate: "2026-04-19",
      weekStartBizDate: "2026-04-13",
      summary: {
        totalRevenueThisWeek: 1,
        totalRevenueLastWeek: 1,
        revenueWowDelta: 0.1,
        totalCustomersThisWeek: 1,
        totalCustomersLastWeek: 1,
        customerWowDelta: 1,
        addClockRateThisWeek: 0.1,
        addClockRateLastWeek: 0.09,
        addClockRateWowDelta: 0.01,
        headline: "本周5店总盘上行，增长主要来自客流恢复。",
      },
      portfolioRevenueSeries: [],
      stores: [],
    });
    buildWeeklyStoreChartImageMock.mockResolvedValue("/tmp/weekly-store-chart-2026-04-19.png");
  });

  it("renders a weekly chart image from the latest 7 daily snapshots and previous-week baselines per active store", async () => {
    const reportMap = buildReportMap();
    const fakeStore = {
      getDailyReport: vi.fn(async (orgId: string, bizDate: string) => reportMap.get(`${orgId}:${bizDate}`) ?? null),
      resolveControlTowerSettings: vi.fn(async () => ({})),
      getMartDerivedStore() {
        return this;
      },
      getQueueAccessControlStore() {
        return this;
      },
    };

    const service = new HetangReportingService({
      config: buildConfig(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getStore: async () => fakeStore as never,
      runCommandWithTimeout: vi.fn() as never,
      listCustomerSegments: async () => [],
      listMemberReactivationFeatures: async () => [],
      listMemberReactivationStrategies: async () => [],
    });

    const imagePath = await service.renderWeeklyChartImage({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:10:00Z"),
    });

    expect(imagePath).toBe("/tmp/weekly-store-chart-2026-04-19.png");
    expect(buildWeeklyStoreChartDatasetMock).toHaveBeenCalledTimes(1);
    expect(buildWeeklyStoreChartDatasetMock).toHaveBeenCalledWith({
      weekEndBizDate: "2026-04-19",
      stores: expect.arrayContaining([
        expect.objectContaining({
          orgId: "1001",
          storeName: "荷塘悦色迎宾店",
          currentReports: expect.any(Array),
          previousReports: expect.any(Array),
        }),
        expect.objectContaining({
          orgId: "1005",
          storeName: "荷塘悦色园中园店",
          currentReports: expect.any(Array),
          previousReports: expect.any(Array),
        }),
      ]),
    });
    const datasetArg = buildWeeklyStoreChartDatasetMock.mock.calls[0]?.[0];
    expect(datasetArg?.stores).toHaveLength(5);
    expect(
      datasetArg?.stores.every(
        (store: {
          currentReports: DailyStoreReport[];
          previousReports: DailyStoreReport[];
        }) => store.currentReports.length === 7 && store.previousReports.length === 7,
      ),
    ).toBe(true);
    expect(buildWeeklyStoreChartImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: expect.objectContaining({ title: "荷塘悦色5店周经营决策图" }),
        runCommandWithTimeout: expect.any(Function),
      }),
    );
  });

  it("supports dry-run by returning the local png path without sending", async () => {
    const reportMap = buildReportMap();
    const fakeStore = {
      getDailyReport: vi.fn(async (orgId: string, bizDate: string) => reportMap.get(`${orgId}:${bizDate}`) ?? null),
      resolveControlTowerSettings: vi.fn(async () => ({})),
      getMartDerivedStore() {
        return this;
      },
      getQueueAccessControlStore() {
        return this;
      },
    };

    const service = new HetangReportingService({
      config: buildConfig(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getStore: async () => fakeStore as never,
      runCommandWithTimeout: vi.fn() as never,
      listCustomerSegments: async () => [],
      listMemberReactivationFeatures: async () => [],
      listMemberReactivationStrategies: async () => [],
    });

    const result = await service.sendWeeklyChartImage({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:10:00Z"),
      dryRun: true,
    });

    expect(result).toContain("/tmp/weekly-store-chart-2026-04-19.png");
    expect(sendReportImageMock).not.toHaveBeenCalled();
  });

  it("sends the weekly chart image through the shared delivery target", async () => {
    const reportMap = buildReportMap();
    const fakeStore = {
      getDailyReport: vi.fn(async (orgId: string, bizDate: string) => reportMap.get(`${orgId}:${bizDate}`) ?? null),
      resolveControlTowerSettings: vi.fn(async () => ({})),
      getMartDerivedStore() {
        return this;
      },
      getQueueAccessControlStore() {
        return this;
      },
    };

    const service = new HetangReportingService({
      config: buildConfig(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getStore: async () => fakeStore as never,
      runCommandWithTimeout: vi.fn() as never,
      listCustomerSegments: async () => [],
      listMemberReactivationFeatures: async () => [],
      listMemberReactivationStrategies: async () => [],
    });

    const result = await service.sendWeeklyChartImage({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:10:00Z"),
    });

    expect(result).toBe("weekly chart image sent for 2026-04-19");
    expect(sendReportImageMock).toHaveBeenCalledTimes(1);
    expect(sendReportImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({
          channel: "wecom",
          target: "hetang-hq",
        }),
        filePath: "/tmp/weekly-store-chart-2026-04-19.png",
      }),
    );
  });
});
