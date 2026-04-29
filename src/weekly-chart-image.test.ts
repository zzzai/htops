import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWeeklyStoreChartDataset,
  buildWeeklyStoreChartImage,
  renderWeeklyStoreChartSvg,
} from "./weekly-chart-image.js";
import type { DailyStoreMetrics, DailyStoreReport } from "./types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) {
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function buildMetrics(overrides: Partial<DailyStoreMetrics> = {}): DailyStoreMetrics {
  return {
    orgId: "1001",
    storeName: "荷塘悦色迎宾店",
    bizDate: "2026-04-19",
    serviceRevenue: 10000,
    rechargeCash: 5000,
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
  rechargeCash: number;
  customers: number;
  averageTicket: number;
  addClockRate: number;
  pointClockRate: number;
  newMembers: number;
  groupbuy7dRevisitRate: number;
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
      rechargeCash: params.rechargeCash,
      customerCount: params.customers,
      averageTicket: params.averageTicket,
      addClockRate: params.addClockRate,
      addClockRecordCount: Math.round(params.addClockRate * 100),
      pointClockRate: params.pointClockRate,
      pointClockRecordCount: Math.round(params.pointClockRate * 100),
      newMembers: params.newMembers,
      groupbuy7dRevisitRate: params.groupbuy7dRevisitRate,
    }),
    alerts: [],
    suggestions: [],
    markdown: "",
    complete: true,
  };
}

function buildStoreReports(
  orgId: string,
  storeName: string,
  currentWeekRevenueBase: number,
  previousWeekRevenueBase: number,
  options: {
    currentCustomersBase?: number;
    currentCustomersSlope?: number;
    previousCustomersBase?: number;
    previousCustomersSlope?: number;
    currentAddClockBase?: number;
    currentAddClockSlope?: number;
    previousAddClockBase?: number;
    previousAddClockSlope?: number;
    currentRevisitBase?: number;
    currentRevisitSlope?: number;
    previousRevisitBase?: number;
    previousRevisitSlope?: number;
  } = {},
): { currentReports: DailyStoreReport[]; previousReports: DailyStoreReport[] } {
  return {
    currentReports: Array.from({ length: 7 }, (_, index) => {
      const day = String(13 + index).padStart(2, "0");
      return buildDailyReport({
        orgId,
        storeName,
        bizDate: `2026-04-${day}`,
        revenue: currentWeekRevenueBase + index * 800,
        rechargeCash: 3000 + index * 160,
        customers: (options.currentCustomersBase ?? 50) + index * (options.currentCustomersSlope ?? 3),
        averageTicket: 180 + index * 3,
        addClockRate: (options.currentAddClockBase ?? 0.12) + index * (options.currentAddClockSlope ?? 0.01),
        pointClockRate: 0.24 + index * 0.01,
        newMembers: 2 + index,
        groupbuy7dRevisitRate:
          (options.currentRevisitBase ?? 0.18) + index * (options.currentRevisitSlope ?? 0.02),
      });
    }),
    previousReports: Array.from({ length: 7 }, (_, index) => {
      const day = String(6 + index).padStart(2, "0");
      return buildDailyReport({
        orgId,
        storeName,
        bizDate: `2026-04-${day}`,
        revenue: previousWeekRevenueBase + index * 500,
        rechargeCash: 2600 + index * 120,
        customers: (options.previousCustomersBase ?? 46) + index * (options.previousCustomersSlope ?? 2),
        averageTicket: 176 + index * 2,
        addClockRate:
          (options.previousAddClockBase ?? 0.1) + index * (options.previousAddClockSlope ?? 0.008),
        pointClockRate: 0.22 + index * 0.009,
        newMembers: 1 + index,
        groupbuy7dRevisitRate:
          (options.previousRevisitBase ?? 0.15) + index * (options.previousRevisitSlope ?? 0.015),
      });
    }),
  };
}

function buildInput() {
  return [
    {
      orgId: "1001",
      storeName: "荷塘悦色迎宾店",
      ...buildStoreReports("1001", "荷塘悦色迎宾店", 10000, 8800, {
        currentCustomersBase: 52,
        currentCustomersSlope: 4,
        previousCustomersBase: 45,
        previousCustomersSlope: 2,
        currentAddClockBase: 0.13,
        currentAddClockSlope: 0.012,
      }),
    },
    {
      orgId: "1002",
      storeName: "荷塘悦色义乌店",
      ...buildStoreReports("1002", "荷塘悦色义乌店", 10400, 10000, {
        currentCustomersBase: 43,
        currentCustomersSlope: 2,
        previousCustomersBase: 46,
        previousCustomersSlope: 2,
        currentAddClockBase: 0.16,
        currentAddClockSlope: 0.014,
        previousAddClockBase: 0.09,
        previousAddClockSlope: 0.006,
      }),
    },
    {
      orgId: "1003",
      storeName: "荷塘悦色华美店",
      ...buildStoreReports("1003", "荷塘悦色华美店", 8400, 9800, {
        currentCustomersBase: 40,
        currentCustomersSlope: 1,
        previousCustomersBase: 48,
        previousCustomersSlope: 2,
        currentAddClockBase: 0.1,
        currentAddClockSlope: 0.004,
        previousAddClockBase: 0.12,
        previousAddClockSlope: 0.008,
      }),
    },
    {
      orgId: "1004",
      storeName: "荷塘悦色锦苑店",
      ...buildStoreReports("1004", "荷塘悦色锦苑店", 9800, 9600, {
        currentCustomersBase: 47,
        currentCustomersSlope: 3,
        previousCustomersBase: 46,
        previousCustomersSlope: 2,
        currentAddClockBase: 0.11,
        currentAddClockSlope: 0.008,
        previousAddClockBase: 0.105,
        previousAddClockSlope: 0.007,
        currentRevisitBase: 0.11,
        currentRevisitSlope: 0.012,
        previousRevisitBase: 0.18,
        previousRevisitSlope: 0.015,
      }),
    },
    {
      orgId: "1005",
      storeName: "荷塘悦色园中园店",
      ...buildStoreReports("1005", "荷塘悦色园中园店", 9100, 9400, {
        currentCustomersBase: 50,
        currentCustomersSlope: 3,
        previousCustomersBase: 44,
        previousCustomersSlope: 2,
        currentAddClockBase: 0.09,
        currentAddClockSlope: 0.005,
        previousAddClockBase: 0.12,
        previousAddClockSlope: 0.007,
      }),
    },
  ];
}

describe("weekly decision chart image", () => {
  it("builds a decision-oriented dataset with summary, dated trend series, and per-store insights", () => {
    const dataset = buildWeeklyStoreChartDataset({
      weekEndBizDate: "2026-04-19",
      stores: buildInput() as never,
    }) as unknown as {
      title: string;
      summary: {
        revenueWowDelta: number;
        customerWowDelta: number;
        addClockRateWowDelta: number | null;
      };
      portfolioRevenueSeries: Array<{
        storeName: string;
        dates: string[];
        currentWeekValues: number[];
        previousWeekValues: number[];
      }>;
      stores: Array<{
        shortName: string;
        tier: string;
        revenueThisWeek: Array<{ bizDate: string; value: number | null }>;
        revenueLastWeek: Array<{ bizDate: string; value: number | null }>;
        signals: Array<{ label: string; wowDelta: number | null; currentValue: number | null }>;
        insight: string;
      }>;
    };

    expect(dataset.title).toBe("荷塘悦色5店周经营决策图");
    expect(dataset.summary.revenueWowDelta).not.toBe(0);
    expect(dataset.summary.customerWowDelta).not.toBe(0);
    expect(dataset.portfolioRevenueSeries).toHaveLength(5);
    expect(dataset.portfolioRevenueSeries[0]?.dates).toEqual([
      "04-13",
      "04-14",
      "04-15",
      "04-16",
      "04-17",
      "04-18",
      "04-19",
    ]);
    expect(dataset.stores).toHaveLength(5);
    expect(dataset.stores[0]?.shortName).toBe("迎宾");
    expect(dataset.stores[0]?.revenueThisWeek).toHaveLength(7);
    expect(dataset.stores[0]?.revenueLastWeek).toHaveLength(7);
    expect(dataset.stores[0]?.signals.map((signal) => signal.label)).toEqual([
      "客流",
      "加钟率",
      "点钟率",
      "新增会员",
      "本周新增储值",
    ]);
    const rechargeSignal = dataset.stores[0]?.signals.find((signal) => signal.label === "本周新增储值");
    const newMembersSignal = dataset.stores[0]?.signals.find((signal) => signal.label === "新增会员");
    const pointClockSignal = dataset.stores[0]?.signals.find((signal) => signal.label === "点钟率");
    expect(rechargeSignal?.currentValue).toBe(24360);
    expect(newMembersSignal?.currentValue).toBe(35);
    expect(pointClockSignal?.currentValue).toBeGreaterThan(0.26);
    expect(dataset.stores[0]?.signals.some((signal) => signal.label === "团购客复购率")).toBe(false);
    expect(dataset.stores.every((store) => store.insight.trim().length > 0)).toBe(true);
    expect(new Set(dataset.stores.map((store) => store.tier)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(dataset.stores.map((store) => store.insight)).size).toBeGreaterThanOrEqual(4);
  });

  it("renders a mobile-friendly decision chart with dated line charts and week-over-week comparison", () => {
    const dataset = buildWeeklyStoreChartDataset({
      weekEndBizDate: "2026-04-19",
      stores: buildInput() as never,
    });

    const svg = renderWeeklyStoreChartSvg(dataset);

    expect(svg).toContain("荷塘悦色5店周经营决策图");
    expect(svg).toContain("5店整体结论");
    expect(svg).toContain("5店营收走势");
    expect(svg).toContain("本周");
    expect(svg).toContain("上周");
    expect(svg).toContain("04-13");
    expect(svg).toContain("04-19");
    expect(svg).toContain("迎宾");
    expect(svg).toContain("园中园");
    expect(svg).toContain("客流");
    expect(svg).toContain("点钟率");
    expect(svg).toContain("新增会员");
    expect(svg).toContain("本周新增储值");
    expect(svg).not.toContain("团购客复购率");
    expect(svg).not.toContain("metric-card-");
  });

  it("writes a png through headless chrome and returns the generated file path", async () => {
    const dataset = buildWeeklyStoreChartDataset({
      weekEndBizDate: "2026-04-19",
      stores: [
        {
          orgId: "1001",
          storeName: "荷塘悦色迎宾店",
          ...buildStoreReports("1001", "荷塘悦色迎宾店", 10000, 8800),
        },
      ] as never,
    });
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-chart-image-"));
    tempDirs.push(outputDir);

    const runCommandWithTimeout = vi.fn(async (argv: string[]) => {
      const screenshotArg = argv.find((value) => value.startsWith("--screenshot="));
      const outputPath = screenshotArg?.slice("--screenshot=".length);
      if (outputPath) {
        fs.writeFileSync(outputPath, "png");
      }
      return {
        code: 0,
        stdout: "",
        stderr: "",
      };
    });

    const imagePath = await buildWeeklyStoreChartImage({
      dataset,
      outputDir,
      runCommandWithTimeout,
    });

    expect(imagePath).toBe(path.join(outputDir, "weekly-store-chart-2026-04-19.png"));
    expect(fs.existsSync(imagePath)).toBe(true);
    expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
    expect(runCommandWithTimeout.mock.calls[0]?.[0]?.[0]).toContain("google-chrome");
    expect(runCommandWithTimeout.mock.calls[0]?.[0]).toContain("--no-sandbox");
    expect(runCommandWithTimeout.mock.calls[0]?.[0]).toContain(`--screenshot=${imagePath}`);
  });
});
