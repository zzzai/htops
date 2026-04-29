import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveHetangOpsConfig } from "../config.js";
import type {
  DailyStoreMetrics,
  DailyStoreReport,
  HetangIndustryContextSnapshotRecord,
} from "../types.js";

const sendReportMessageMock = vi.fn(async () => undefined);

vi.mock("../notify.js", () => ({
  sendReportMessage: sendReportMessageMock,
}));

const { HetangReportingService } = await import("./reporting-service.js");

function buildConfig() {
  return resolveHetangOpsConfig({
    api: { appKey: "demo", appSecret: "demo" },
    database: { url: "postgresql://demo:demo@127.0.0.1:5432/demo" },
    stores: [
      { orgId: "1001", storeName: "迎宾店" },
      { orgId: "1002", storeName: "滨江店" },
      { orgId: "1003", storeName: "国贸店" },
      { orgId: "1004", storeName: "万达店" },
      { orgId: "1005", storeName: "开发区店" },
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
    storeName: "迎宾店",
    bizDate: "2026-04-19",
    serviceRevenue: 10000,
    rechargeCash: 0,
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
    groupbuy7dRevisitCustomerCount: 20,
    groupbuy7dRevisitRate: 0.36,
    groupbuy7dCardOpenedCustomerCount: 0,
    groupbuy7dCardOpenedRate: null,
    groupbuy7dStoredValueConvertedCustomerCount: 0,
    groupbuy7dStoredValueConversionRate: 0.09,
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
    }),
    alerts: [],
    suggestions: [],
    markdown: "cached",
    complete: true,
  };
}

function buildIndustrySnapshot(
  overrides: Partial<HetangIndustryContextSnapshotRecord> = {},
): HetangIndustryContextSnapshotRecord {
  return {
    snapshotDate: "2026-04-19",
    signalKind: "platform_rule",
    signalKey: "meituan_price_mindshare",
    title: "平台价格心智抬升",
    summary: "低价敏感客决策更快，门店更需要差异化承接。",
    truthBoundary: "weak_signal",
    confidence: "medium",
    sourceType: "manual_research",
    sourceLabel: "平台观察",
    applicableModules: ["world_model", "hq_narrative"],
    rawJson: "{\"source\":\"platform-watch\"}",
    updatedAt: "2026-04-19T09:00:00.000Z",
    ...overrides,
  };
}

describe("HetangReportingService.sendWeeklyReport", () => {
  beforeEach(() => {
    sendReportMessageMock.mockClear();
  });

  it("sends the weekly report through the shared delivery target", async () => {
    const reportMap = new Map<string, DailyStoreReport>();
    const bizDates = [
      "2026-04-06",
      "2026-04-07",
      "2026-04-08",
      "2026-04-09",
      "2026-04-10",
      "2026-04-11",
      "2026-04-12",
      "2026-04-13",
      "2026-04-14",
      "2026-04-15",
      "2026-04-16",
      "2026-04-17",
      "2026-04-18",
      "2026-04-19",
    ];
    const stores = [
      ["1001", "迎宾店", 12000],
      ["1002", "滨江店", 9000],
      ["1003", "国贸店", 9500],
      ["1004", "万达店", 11000],
      ["1005", "开发区店", 8800],
    ] as const;

    for (const [orgId, storeName, currentRevenue] of stores) {
      bizDates.forEach((bizDate, index) => {
        reportMap.set(
          `${orgId}:${bizDate}`,
          buildDailyReport({
            orgId,
            storeName,
            bizDate,
            revenue: index < 7 ? currentRevenue - 800 : currentRevenue,
          }),
        );
      });
    }

    const fakeStore = {
      getDailyReport: vi.fn(async (orgId: string, bizDate: string) => reportMap.get(`${orgId}:${bizDate}`) ?? null),
      listIndustryContextSnapshots: vi.fn(async () => [buildIndustrySnapshot()]),
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
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      getStore: async () => fakeStore as never,
      runCommandWithTimeout: vi.fn() as never,
      listCustomerSegments: async () => [],
      listMemberReactivationFeatures: async () => [],
      listMemberReactivationStrategies: async () => [],
    });

    const result = await service.sendWeeklyReport({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:10:00Z"),
    });

    expect(result).toContain("weekly report sent");
    expect(sendReportMessageMock).toHaveBeenCalledTimes(1);
    expect(fakeStore.listIndustryContextSnapshots).toHaveBeenCalledWith({
      snapshotDate: "2026-04-19",
    });
    expect(sendReportMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("平台价格心智抬升"),
      }),
    );
  });
});
