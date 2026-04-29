import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { DailyStoreReport } from "./types.js";

export type WeeklyStoreChartInput = {
  orgId: string;
  storeName: string;
  currentReports: DailyStoreReport[];
  previousReports: DailyStoreReport[];
};

export type WeeklyStoreChartPoint = {
  bizDate: string;
  label: string;
  value: number | null;
};

export type WeeklyStoreChartSignal = {
  label: "客流" | "加钟率" | "点钟率" | "新增会员" | "本周新增储值";
  currentValue: number | null;
  previousValue: number | null;
  wowDelta: number | null;
  deltaText: string;
};

export type WeeklyStoreChartTier =
  | "客流拉升"
  | "转化拉升"
  | "会员沉淀"
  | "稳态承接"
  | "客流承压"
  | "转化承压";

export type WeeklyStoreChartStore = {
  orgId: string;
  storeName: string;
  shortName: string;
  tier: WeeklyStoreChartTier;
  revenueWowDelta: number;
  revenueThisWeek: WeeklyStoreChartPoint[];
  revenueLastWeek: WeeklyStoreChartPoint[];
  signals: WeeklyStoreChartSignal[];
  insight: string;
};

export type WeeklyStoreChartDataset = {
  title: string;
  weekEndBizDate: string;
  weekStartBizDate: string;
  summary: {
    totalRevenueThisWeek: number;
    totalRevenueLastWeek: number;
    revenueWowDelta: number;
    totalCustomersThisWeek: number;
    totalCustomersLastWeek: number;
    customerWowDelta: number;
    addClockRateThisWeek: number | null;
    addClockRateLastWeek: number | null;
    addClockRateWowDelta: number | null;
    headline: string;
  };
  portfolioRevenueSeries: Array<{
    storeName: string;
    shortName: string;
    dates: string[];
    currentWeekValues: number[];
    previousWeekValues: number[];
    wowDelta: number;
  }>;
  stores: WeeklyStoreChartStore[];
};

type RasterizeCommandRunner = (
  argv: string[],
  options: {
    timeoutMs: number;
    cwd?: string;
    env?: Record<string, string | undefined>;
  },
) => Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}>;

type WeeklyAggregate = {
  revenue: number;
  customerCount: number;
  addClockRate: number | null;
  pointClockRate: number | null;
  newMembers: number;
  rechargeCash: number;
};

const STORE_LINE_COLORS = ["#2563EB", "#0F766E", "#9333EA", "#EA580C", "#DC2626"];

function resolveShortStoreName(storeName: string): string {
  const trimmed = storeName.replace(/^荷塘悦色/u, "").trim();
  return trimmed.endsWith("店") ? trimmed.slice(0, -1) : trimmed;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatDateLabel(bizDate: string): string {
  return bizDate.slice(5);
}

function sum(values: Array<number | null | undefined>): number {
  return round(
    values.reduce<number>(
      (total, value) => total + (typeof value === "number" && Number.isFinite(value) ? value : 0),
      0,
    ),
    2,
  );
}

function latestNumber(
  reports: DailyStoreReport[],
  getter: (report: DailyStoreReport) => number | null | undefined,
): number | null {
  for (const report of [...reports].reverse()) {
    const value = getter(report);
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function aggregateWeeklyReports(reports: DailyStoreReport[]): WeeklyAggregate {
  const upClockRecords = sum(reports.map((report) => report.metrics.upClockRecordCount));
  const addClockRecords = sum(reports.map((report) => report.metrics.addClockRecordCount));
  const pointClockRecords = sum(reports.map((report) => report.metrics.pointClockRecordCount));
  return {
    revenue: sum(reports.map((report) => report.metrics.serviceRevenue)),
    customerCount: sum(reports.map((report) => report.metrics.customerCount)),
    addClockRate: upClockRecords > 0 ? round(addClockRecords / upClockRecords, 4) : null,
    pointClockRate: upClockRecords > 0 ? round(pointClockRecords / upClockRecords, 4) : null,
    newMembers: sum(reports.map((report) => report.metrics.newMembers)),
    rechargeCash: sum(reports.map((report) => report.metrics.rechargeCash)),
  };
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 10000) {
    return `¥${round(value / 10000, 1).toFixed(1)}万`;
  }
  return `¥${round(value, 0).toFixed(0)}`;
}

function formatSignedCurrency(value: number): string {
  return `${value >= 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}

function formatCount(value: number): string {
  return round(value, 0).toFixed(0);
}

function formatSignedCount(value: number, suffix = ""): string {
  const rounded = round(value, 0);
  if (rounded > 0) {
    return `+${rounded.toFixed(0)}${suffix}`;
  }
  if (rounded < 0) {
    return `${rounded.toFixed(0)}${suffix}`;
  }
  return `0${suffix}`;
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  return `${round(value * 100, 1).toFixed(1)}%`;
}

function formatPercentPointDelta(value: number | null): string {
  if (value === null) {
    return "N/A";
  }
  const points = round(Math.abs(value) * 100, 1).toFixed(1);
  if (value === 0) {
    return "0.0个点";
  }
  return `${value > 0 ? "+" : "-"}${points}个点`;
}

function diff(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) {
    return null;
  }
  return round(current - previous, 4);
}

function resolveTier(params: {
  revenueWowDelta: number;
  customerDelta: number;
  addClockRateDelta: number | null;
  pointClockRateDelta: number | null;
  newMembersDelta: number;
  rechargeCashDelta: number;
}): WeeklyStoreChartTier {
  if (params.revenueWowDelta >= 0.08 && params.customerDelta >= 15) {
    return "客流拉升";
  }
  if (params.revenueWowDelta >= 0.03 && (params.addClockRateDelta ?? 0) >= 0.012) {
    return "转化拉升";
  }
  if (
    params.revenueWowDelta >= 0.02 &&
    params.rechargeCashDelta > 0 &&
    params.customerDelta > 0 &&
    params.newMembersDelta > 0 &&
    (params.addClockRateDelta ?? 0) < 0
  ) {
    return "会员沉淀";
  }
  if (params.revenueWowDelta >= 0.02 && (params.pointClockRateDelta ?? 0) >= 0.012) {
    return "转化拉升";
  }
  if (params.revenueWowDelta <= -0.05 && params.customerDelta <= -10) {
    return "客流承压";
  }
  if (params.revenueWowDelta <= -0.02 && (params.addClockRateDelta ?? 0) <= -0.008) {
    return "转化承压";
  }
  if (params.revenueWowDelta < 0 && params.rechargeCashDelta > 0) {
    return "稳态承接";
  }
  return "稳态承接";
}

function resolveInsight(params: {
  tier: WeeklyStoreChartTier;
  revenueDelta: number;
  customerDelta: number;
  addClockRateDelta: number | null;
  pointClockRateDelta: number | null;
  newMembersDelta: number;
  rechargeCashDelta: number;
}): string {
  const customerText = `客流${formatSignedCount(params.customerDelta, "人")}`;
  const addClockText = `加钟率${formatPercentPointDelta(params.addClockRateDelta)}`;
  const pointClockText = `点钟率${formatPercentPointDelta(params.pointClockRateDelta)}`;
  const newMembersText = `新增会员${formatSignedCount(params.newMembersDelta, "人")}`;
  const rechargeText = `新增储值${formatSignedCurrency(params.rechargeCashDelta)}`;

  switch (params.tier) {
    case "客流拉升":
      return (params.addClockRateDelta ?? 0) < 0
        ? `${customerText}，但${addClockText}，增长主要还是靠到店恢复拉动。`
        : `${customerText}，营收增长主要由到店恢复拉动。`;
    case "转化拉升":
      return (params.pointClockRateDelta ?? 0) > (params.addClockRateDelta ?? 0)
        ? `${pointClockText}，在客流没有明显放大的情况下仍带动增长。`
        : `${addClockText}，在客流没有明显放大的情况下仍带动增长。`;
    case "客流承压":
      return (params.addClockRateDelta ?? 0) > 0
        ? `${customerText}，即使${addClockText}也没完全补回营收缺口。`
        : `${customerText}，营收回落先看晚场进店承接。`;
    case "转化承压":
      return (params.pointClockRateDelta ?? 0) < (params.addClockRateDelta ?? 0)
        ? `${customerText}，但${pointClockText}，高意愿客户承接偏弱。`
        : `${customerText}，但${addClockText}，主要断点在二次加项。`;
    case "会员沉淀":
      return `${newMembersText}，${rechargeText}，当前更偏会员沉淀型修复。`;
    case "稳态承接":
      if (params.revenueDelta > 0 && (params.customerDelta > 0 || (params.addClockRateDelta ?? 0) > 0)) {
        if (params.customerDelta > 0 && (params.addClockRateDelta ?? 0) > 0) {
          return `${customerText}，${addClockText}，当前属于均衡修复。`;
        }
        if (params.rechargeCashDelta > 0 && params.newMembersDelta > 0) {
          return `${newMembersText}，${rechargeText}，当前属于会员沉淀型修复。`;
        }
        if (params.customerDelta > 0) {
          return `${customerText}，当前更偏客流托底的稳态修复。`;
        }
        if ((params.pointClockRateDelta ?? 0) > 0) {
          return `${pointClockText}，当前更偏高意愿客户结构改善。`;
        }
        return `${addClockText}，当前更偏结构改善的稳态修复。`;
      }
      if (params.revenueDelta < 0) {
        if (params.rechargeCashDelta > 0) {
          return `${customerText}，但${rechargeText}，说明消费弱于储值沉淀。`;
        }
        return `${customerText}，整体小幅回落，优先排查周中承接波动。`;
      }
      return "整体平稳，继续观察周中承接波动。";
  }
}

function buildRevenuePoints(reports: DailyStoreReport[]): WeeklyStoreChartPoint[] {
  return [...reports]
    .sort((left, right) => left.bizDate.localeCompare(right.bizDate))
    .map((report) => ({
      bizDate: report.bizDate,
      label: formatDateLabel(report.bizDate),
      value: report.metrics.serviceRevenue,
    }));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildWeeklyStoreChartDataset(params: {
  weekEndBizDate: string;
  stores: WeeklyStoreChartInput[];
}): WeeklyStoreChartDataset {
  const weekStartBizDate = params.stores[0]?.currentReports
    .slice()
    .sort((left, right) => left.bizDate.localeCompare(right.bizDate))[0]?.bizDate ?? params.weekEndBizDate;

  const stores = params.stores.map((store) => {
    const revenueThisWeek = buildRevenuePoints(store.currentReports);
    const revenueLastWeek = buildRevenuePoints(store.previousReports);
    const currentAggregate = aggregateWeeklyReports(store.currentReports);
    const previousAggregate = aggregateWeeklyReports(store.previousReports);
    const customerDelta = round(currentAggregate.customerCount - previousAggregate.customerCount, 2);
    const addClockRateDelta = diff(currentAggregate.addClockRate, previousAggregate.addClockRate);
    const pointClockRateDelta = diff(currentAggregate.pointClockRate, previousAggregate.pointClockRate);
    const newMembersDelta = round(currentAggregate.newMembers - previousAggregate.newMembers, 2);
    const rechargeCashDelta = round(currentAggregate.rechargeCash - previousAggregate.rechargeCash, 2);
    const revenueDelta = round(currentAggregate.revenue - previousAggregate.revenue, 2);
    const revenueWowDelta =
      previousAggregate.revenue > 0 ? round(revenueDelta / previousAggregate.revenue, 4) : 0;
    const tier = resolveTier({
      revenueWowDelta,
      customerDelta,
      addClockRateDelta,
      pointClockRateDelta,
      newMembersDelta,
      rechargeCashDelta,
    });

    return {
      orgId: store.orgId,
      storeName: store.storeName,
      shortName: resolveShortStoreName(store.storeName),
      tier,
      revenueWowDelta,
      revenueThisWeek,
      revenueLastWeek,
      signals: [
        {
          label: "客流",
          currentValue: currentAggregate.customerCount,
          previousValue: previousAggregate.customerCount,
          wowDelta: customerDelta,
          deltaText: formatSignedCount(customerDelta, "人"),
        },
        {
          label: "加钟率",
          currentValue: currentAggregate.addClockRate,
          previousValue: previousAggregate.addClockRate,
          wowDelta: addClockRateDelta,
          deltaText: formatPercentPointDelta(addClockRateDelta),
        },
        {
          label: "点钟率",
          currentValue: currentAggregate.pointClockRate,
          previousValue: previousAggregate.pointClockRate,
          wowDelta: pointClockRateDelta,
          deltaText: formatPercentPointDelta(pointClockRateDelta),
        },
        {
          label: "新增会员",
          currentValue: currentAggregate.newMembers,
          previousValue: previousAggregate.newMembers,
          wowDelta: newMembersDelta,
          deltaText: formatSignedCount(newMembersDelta, "人"),
        },
        {
          label: "本周新增储值",
          currentValue: currentAggregate.rechargeCash,
          previousValue: previousAggregate.rechargeCash,
          wowDelta: rechargeCashDelta,
          deltaText: formatSignedCurrency(rechargeCashDelta),
        },
      ],
      insight: resolveInsight({
        tier,
        revenueDelta,
        customerDelta,
        addClockRateDelta,
        pointClockRateDelta,
        newMembersDelta,
        rechargeCashDelta,
      }),
    } satisfies WeeklyStoreChartStore;
  });

  const totalRevenueThisWeek = sum(
    params.stores.map((store) => aggregateWeeklyReports(store.currentReports).revenue),
  );
  const totalRevenueLastWeek = sum(
    params.stores.map((store) => aggregateWeeklyReports(store.previousReports).revenue),
  );
  const totalCustomersThisWeek = sum(
    params.stores.map((store) => aggregateWeeklyReports(store.currentReports).customerCount),
  );
  const totalCustomersLastWeek = sum(
    params.stores.map((store) => aggregateWeeklyReports(store.previousReports).customerCount),
  );
  const currentAddClockWeightedNumerator = sum(
    params.stores.map((store) =>
      sum(store.currentReports.map((report) => report.metrics.addClockRecordCount)),
    ),
  );
  const currentAddClockWeightedDenominator = sum(
    params.stores.map((store) =>
      sum(store.currentReports.map((report) => report.metrics.upClockRecordCount)),
    ),
  );
  const previousAddClockWeightedNumerator = sum(
    params.stores.map((store) =>
      sum(store.previousReports.map((report) => report.metrics.addClockRecordCount)),
    ),
  );
  const previousAddClockWeightedDenominator = sum(
    params.stores.map((store) =>
      sum(store.previousReports.map((report) => report.metrics.upClockRecordCount)),
    ),
  );
  const addClockRateThisWeek =
    currentAddClockWeightedDenominator > 0
      ? round(currentAddClockWeightedNumerator / currentAddClockWeightedDenominator, 4)
      : null;
  const addClockRateLastWeek =
    previousAddClockWeightedDenominator > 0
      ? round(previousAddClockWeightedNumerator / previousAddClockWeightedDenominator, 4)
      : null;
  const revenueWowDelta =
    totalRevenueLastWeek > 0
      ? round((totalRevenueThisWeek - totalRevenueLastWeek) / totalRevenueLastWeek, 4)
      : 0;
  const customerWowDelta = round(totalCustomersThisWeek - totalCustomersLastWeek, 2);
  const addClockRateWowDelta = diff(addClockRateThisWeek, addClockRateLastWeek);
  const headline =
    revenueWowDelta > 0 && customerWowDelta > 0
      ? "本周5店总盘上行，增长主要来自客流恢复。"
      : revenueWowDelta < 0 && (addClockRateWowDelta ?? 0) < 0
        ? "本周5店总盘承压，风险集中在后半程转化。"
        : revenueWowDelta < 0
          ? "本周5店总盘回落，优先排查弱店周中承接。"
          : "本周5店总盘平稳，继续盯周中波动。";

  return {
    title: "荷塘悦色5店周经营决策图",
    weekEndBizDate: params.weekEndBizDate,
    weekStartBizDate,
    summary: {
      totalRevenueThisWeek,
      totalRevenueLastWeek,
      revenueWowDelta,
      totalCustomersThisWeek,
      totalCustomersLastWeek,
      customerWowDelta,
      addClockRateThisWeek,
      addClockRateLastWeek,
      addClockRateWowDelta,
      headline,
    },
    portfolioRevenueSeries: stores.map((store) => ({
      storeName: store.storeName,
      shortName: store.shortName,
      dates: store.revenueThisWeek.map((point) => point.label),
      currentWeekValues: store.revenueThisWeek.map((point) => point.value ?? 0),
      previousWeekValues: store.revenueLastWeek.map((point) => point.value ?? 0),
      wowDelta: store.revenueWowDelta,
    })),
    stores,
  };
}

function colorForDelta(value: number | null): string {
  if (value === null || value === 0) {
    return "#6B7280";
  }
  return value > 0 ? "#15803D" : "#DC2626";
}

function resolveTierStyle(tier: WeeklyStoreChartTier): { fill: string; text: string } {
  switch (tier) {
    case "客流拉升":
      return { fill: "#DCFCE7", text: "#166534" };
    case "转化拉升":
      return { fill: "#DBEAFE", text: "#1D4ED8" };
    case "会员沉淀":
      return { fill: "#FEF3C7", text: "#B45309" };
    case "客流承压":
    case "转化承压":
      return { fill: "#FEE2E2", text: "#991B1B" };
    case "稳态承接":
      return { fill: "#E5E7EB", text: "#374151" };
  }
}

function buildLinePath(
  values: Array<number | null>,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const normalizedValues = values.map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0,
  );
  if (normalizedValues.length === 0) {
    return `M ${x} ${y + height / 2} L ${x + width} ${y + height / 2}`;
  }
  const min = Math.min(...normalizedValues);
  const max = Math.max(...normalizedValues);
  const range = max - min || 1;
  return normalizedValues
    .map((value, index) => {
      const pointX = x + (width / Math.max(normalizedValues.length - 1, 1)) * index;
      const normalized = (value - min) / range;
      const pointY = y + height - normalized * height;
      return `${index === 0 ? "M" : "L"} ${round(pointX, 2)} ${round(pointY, 2)}`;
    })
    .join(" ");
}

function buildAxisLabels(points: WeeklyStoreChartPoint[], x: number, y: number, width: number): string[] {
  return points.map((point, index) => {
    const pointX = x + (width / Math.max(points.length - 1, 1)) * index;
    return `<text class="axis-label" x="${pointX}" y="${y}" text-anchor="middle">${escapeXml(point.label)}</text>`;
  });
}

export function renderWeeklyStoreChartSvg(dataset: WeeklyStoreChartDataset): string {
  const width = 1240;
  const summaryHeight = 260;
  const trendHeight = 420;
  const rowHeight = 300;
  const rowGap = 24;
  const topPadding = 56;
  const contentWidth = width - 80;
  const chartWidth = 480;
  const chartHeight = 112;
  const height = topPadding + summaryHeight + trendHeight + dataset.stores.length * (rowHeight + rowGap) + 40;

  const svg: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">`,
    `<rect width="${width}" height="${height}" fill="#F5F5F7"/>`,
    `<style>
      text {
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif;
      }
      .title { font-size: 44px; font-weight: 700; fill: #111827; }
      .subtitle { font-size: 20px; font-weight: 500; fill: #6B7280; }
      .section-title { font-size: 28px; font-weight: 700; fill: #111827; }
      .section-body { font-size: 18px; font-weight: 500; fill: #374151; }
      .metric-label { font-size: 18px; font-weight: 600; fill: #4B5563; }
      .metric-value { font-size: 36px; font-weight: 700; fill: #111827; }
      .metric-delta { font-size: 17px; font-weight: 600; }
      .store-name { font-size: 28px; font-weight: 700; fill: #111827; }
      .store-tag { font-size: 15px; font-weight: 700; fill: #1D4ED8; }
      .store-insight { font-size: 18px; font-weight: 500; fill: #374151; }
      .signal-label { font-size: 16px; font-weight: 600; fill: #4B5563; }
      .signal-value { font-size: 18px; font-weight: 700; fill: #111827; }
      .signal-delta { font-size: 15px; font-weight: 600; }
      .axis-label { font-size: 12px; font-weight: 500; fill: #6B7280; }
      .legend-text { font-size: 15px; font-weight: 600; fill: #4B5563; }
    </style>`,
    `<text class="title" x="40" y="${topPadding}">${escapeXml(dataset.title)}</text>`,
    `<text class="subtitle" x="40" y="${topPadding + 34}">${escapeXml(`${dataset.weekStartBizDate} - ${dataset.weekEndBizDate}`)}</text>`,
  ];

  const summaryTop = topPadding + 54;
  svg.push(
    `<rect x="24" y="${summaryTop}" width="${contentWidth}" height="${summaryHeight - 24}" rx="32" fill="#FFFFFF"/>`,
    `<text class="section-title" x="52" y="${summaryTop + 42}">5店整体结论</text>`,
    `<text class="section-body" x="52" y="${summaryTop + 76}">${escapeXml(dataset.summary.headline)}</text>`,
  );

  const summaryCards = [
    {
      label: "本周总营收",
      value: formatCurrency(dataset.summary.totalRevenueThisWeek),
      delta: formatSignedCurrency(dataset.summary.totalRevenueThisWeek - dataset.summary.totalRevenueLastWeek),
      deltaValue: dataset.summary.revenueWowDelta,
    },
    {
      label: "本周总客流",
      value: formatCount(dataset.summary.totalCustomersThisWeek),
      delta: formatSignedCount(dataset.summary.customerWowDelta, "人"),
      deltaValue: dataset.summary.customerWowDelta,
    },
    {
      label: "本周加钟率",
      value: formatPercent(dataset.summary.addClockRateThisWeek),
      delta: formatPercentPointDelta(dataset.summary.addClockRateWowDelta),
      deltaValue: dataset.summary.addClockRateWowDelta,
    },
  ];

  summaryCards.forEach((card, index) => {
    const cardX = 52 + index * 374;
    const cardY = summaryTop + 106;
    svg.push(
      `<rect x="${cardX}" y="${cardY}" width="338" height="104" rx="24" fill="#F8FAFC"/>`,
      `<text class="metric-label" x="${cardX + 24}" y="${cardY + 32}">${escapeXml(card.label)}</text>`,
      `<text class="metric-value" x="${cardX + 24}" y="${cardY + 72}">${escapeXml(card.value)}</text>`,
      `<text class="metric-delta" x="${cardX + 24}" y="${cardY + 96}" fill="${colorForDelta(card.deltaValue)}">较上周 ${escapeXml(card.delta)}</text>`,
    );
  });

  const trendTop = summaryTop + summaryHeight;
  const trendChartX = 52;
  const trendChartY = trendTop + 74;
  const trendChartWidth = 1090;
  const trendChartHeight = 220;
  const trendDates = dataset.portfolioRevenueSeries[0]?.dates ?? [];

  svg.push(
    `<rect x="24" y="${trendTop}" width="${contentWidth}" height="${trendHeight - 24}" rx="32" fill="#FFFFFF"/>`,
    `<text class="section-title" x="52" y="${trendTop + 42}">5店营收走势</text>`,
    `<text class="section-body" x="52" y="${trendTop + 72}">当前周看趋势，逐店区看本周 vs 上周。</text>`,
  );

  dataset.portfolioRevenueSeries.forEach((series, index) => {
    svg.push(
      `<path d="${buildLinePath(series.currentWeekValues, trendChartX, trendChartY, trendChartWidth, trendChartHeight)}" stroke="${STORE_LINE_COLORS[index % STORE_LINE_COLORS.length]}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>`,
    );
    const legendX = 56 + (index % 3) * 164;
    const legendY = trendTop + 332 + Math.floor(index / 3) * 28;
    svg.push(
      `<line x1="${legendX}" y1="${legendY - 6}" x2="${legendX + 20}" y2="${legendY - 6}" stroke="${STORE_LINE_COLORS[index % STORE_LINE_COLORS.length]}" stroke-width="4" stroke-linecap="round"/>`,
      `<text class="legend-text" x="${legendX + 28}" y="${legendY}">${escapeXml(series.shortName)}</text>`,
    );
  });

  svg.push(...buildAxisLabels(
    trendDates.map((label, index) => ({
      bizDate: dataset.stores[0]?.revenueThisWeek[index]?.bizDate ?? label,
      label,
      value: null,
    })),
    trendChartX,
    trendChartY + trendChartHeight + 24,
    trendChartWidth,
  ));

  dataset.stores.forEach((store, index) => {
    const rowTop = trendTop + trendHeight + index * (rowHeight + rowGap);
    const rowChartX = 320;
    const rowChartY = rowTop + 70;
    const signalX = 860;
    const tierStyle = resolveTierStyle(store.tier);
    const tierWidth = Math.max(78, store.tier.length * 18 + 24);

    svg.push(
      `<rect x="24" y="${rowTop}" width="${contentWidth}" height="${rowHeight}" rx="28" fill="#FFFFFF"/>`,
      `<text class="store-name" x="52" y="${rowTop + 42}">${escapeXml(store.shortName)}</text>`,
      `<rect x="138" y="${rowTop + 18}" width="${tierWidth}" height="28" rx="14" fill="${tierStyle.fill}"/>`,
      `<text class="store-tag" x="${138 + tierWidth / 2}" y="${rowTop + 37}" text-anchor="middle" fill="${tierStyle.text}">${escapeXml(store.tier)}</text>`,
      `<text class="store-insight" x="52" y="${rowTop + 80}">${escapeXml(store.insight)}</text>`,
      `<line x1="${rowChartX}" y1="${rowTop + 30}" x2="${rowChartX + 20}" y2="${rowTop + 30}" stroke="#2563EB" stroke-width="4" stroke-linecap="round"/>`,
      `<text class="legend-text" x="${rowChartX + 28}" y="${rowTop + 36}">本周</text>`,
      `<line x1="${rowChartX + 92}" y1="${rowTop + 30}" x2="${rowChartX + 112}" y2="${rowTop + 30}" stroke="#93C5FD" stroke-width="4" stroke-dasharray="8 8" stroke-linecap="round"/>`,
      `<text class="legend-text" x="${rowChartX + 120}" y="${rowTop + 36}">上周</text>`,
      `<path d="${buildLinePath(store.revenueThisWeek.map((point) => point.value), rowChartX, rowChartY, chartWidth, chartHeight)}" stroke="#2563EB" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      `<path d="${buildLinePath(store.revenueLastWeek.map((point) => point.value), rowChartX, rowChartY, chartWidth, chartHeight)}" stroke="#93C5FD" stroke-width="4" stroke-dasharray="8 8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    );

    svg.push(
      ...buildAxisLabels(store.revenueThisWeek, rowChartX, rowChartY + chartHeight + 22, chartWidth),
    );

    store.signals.forEach((signal, signalIndex) => {
      const signalTop = rowTop + 50 + signalIndex * 42;
      svg.push(
        `<text class="signal-label" x="${signalX}" y="${signalTop}">${escapeXml(signal.label)}</text>`,
        `<text class="signal-value" x="${signalX}" y="${signalTop + 22}">${escapeXml(formatSignalValue(signal))}</text>`,
        `<text class="signal-delta" x="${signalX + 132}" y="${signalTop + 22}" fill="${colorForDelta(signal.wowDelta)}">较上周 ${escapeXml(signal.deltaText)}</text>`,
      );
    });
  });

  svg.push("</svg>");
  return svg.join("");
}

function formatSignalValue(signal: WeeklyStoreChartSignal): string {
  switch (signal.label) {
    case "客流":
    case "新增会员":
      return formatCount(signal.currentValue ?? 0);
    case "本周新增储值":
      return formatCurrency(signal.currentValue ?? 0);
    case "加钟率":
    case "点钟率":
      return formatPercent(signal.currentValue);
  }
}

export async function buildWeeklyStoreChartImage(params: {
  dataset: WeeklyStoreChartDataset;
  outputDir: string;
  runCommandWithTimeout: RasterizeCommandRunner;
  chromeBinary?: string;
}): Promise<string> {
  fs.mkdirSync(params.outputDir, { recursive: true });
  const svgPath = path.join(params.outputDir, `weekly-store-chart-${params.dataset.weekEndBizDate}.svg`);
  const pngPath = path.join(params.outputDir, `weekly-store-chart-${params.dataset.weekEndBizDate}.png`);
  fs.writeFileSync(svgPath, renderWeeklyStoreChartSvg(params.dataset), "utf8");

  const chromeBinary =
    params.chromeBinary ||
    process.env.GOOGLE_CHROME_BIN ||
    process.env.CHROME_BIN ||
    "/usr/bin/google-chrome-stable";
  const chromeArgs = [
    chromeBinary,
    "--headless=new",
    "--disable-gpu",
    ...(typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : []),
    `--screenshot=${pngPath}`,
    "--window-size=1240,2600",
    pathToFileURL(svgPath).toString(),
  ];

  const result = await params.runCommandWithTimeout(chromeArgs, {
    timeoutMs: 120_000,
    cwd: process.cwd(),
  });

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `weekly chart rasterize failed with code ${result.code}`);
  }

  if (!fs.existsSync(pngPath)) {
    throw new Error(`weekly chart rasterize did not produce ${pngPath}`);
  }

  return pngPath;
}
