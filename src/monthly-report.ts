import type { DailyStoreReport } from "./types.js";

export type MonthlyStoreReportInput = {
  orgId: string;
  storeName: string;
  currentReports: DailyStoreReport[];
  previousReports: DailyStoreReport[];
};

export type FiveStoreMonthlyTrendReportInput = {
  month: string;
  stores: MonthlyStoreReportInput[];
};

type MonthlyAggregate = {
  revenue: number;
  customerCount: number;
  serviceOrders: number;
  totalClocks: number;
  upClockRecords: number;
  pointClockRecords: number;
  addClockRecords: number;
  averageTicket: number;
  pointClockRate: number | null;
  addClockRate: number | null;
  clockEffect: number;
  newMembers: number;
  rechargeCash: number;
  completeDays: number;
  totalDays: number;
};

type MetricTrend = "回升" | "持平" | "走弱";

type StoreDigest = {
  orgId: string;
  storeName: string;
  current: MonthlyAggregate;
  previous: MonthlyAggregate;
  revenueTrend: MetricTrend;
  customerTrend: MetricTrend;
  conversionTrend: MetricTrend;
  memberTrend: MetricTrend;
  focus: "客流" | "转化" | "会员沉淀" | "承接";
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 10000) {
    return `¥${round(value / 10000, 1).toFixed(1)}万`;
  }
  return `¥${round(value, 0).toFixed(0)}`;
}

function formatCount(value: number): string {
  return round(value, 0).toFixed(0);
}

function formatPercent(value: number | null): string {
  return value === null ? "N/A" : `${round(value * 100, 1).toFixed(1)}%`;
}

function formatRatioDelta(current: number, previous: number): string {
  if (previous === 0) {
    return current === 0 ? "持平" : "无上月基线";
  }
  const value = (current - previous) / previous;
  const sign = value > 0 ? "+" : "";
  return `${sign}${round(value * 100, 1).toFixed(1)}%`;
}

function formatPointDelta(current: number | null, previous: number | null): string {
  if (current === null || previous === null) {
    return "N/A";
  }
  const value = current - previous;
  const sign = value > 0 ? "+" : "";
  return `${sign}${round(value * 100, 1).toFixed(1)}个点`;
}

function aggregateReports(reports: DailyStoreReport[]): MonthlyAggregate {
  const revenue = round(reports.reduce((sum, report) => sum + report.metrics.serviceRevenue, 0), 2);
  const customerCount = round(reports.reduce((sum, report) => sum + report.metrics.customerCount, 0), 2);
  const serviceOrders = round(
    reports.reduce((sum, report) => sum + report.metrics.serviceOrderCount, 0),
    2,
  );
  const totalClocks = round(
    reports.reduce((sum, report) => sum + report.metrics.totalClockCount, 0),
    2,
  );
  const upClockRecords = round(
    reports.reduce((sum, report) => sum + report.metrics.upClockRecordCount, 0),
    2,
  );
  const pointClockRecords = round(
    reports.reduce((sum, report) => sum + report.metrics.pointClockRecordCount, 0),
    2,
  );
  const addClockRecords = round(
    reports.reduce((sum, report) => sum + report.metrics.addClockRecordCount, 0),
    2,
  );

  return {
    revenue,
    customerCount,
    serviceOrders,
    totalClocks,
    upClockRecords,
    pointClockRecords,
    addClockRecords,
    averageTicket: customerCount > 0 ? round(revenue / customerCount, 2) : 0,
    pointClockRate: upClockRecords > 0 ? round(pointClockRecords / upClockRecords, 4) : null,
    addClockRate: upClockRecords > 0 ? round(addClockRecords / upClockRecords, 4) : null,
    clockEffect: totalClocks > 0 ? round(revenue / totalClocks, 2) : 0,
    newMembers: round(reports.reduce((sum, report) => sum + report.metrics.newMembers, 0), 2),
    rechargeCash: round(reports.reduce((sum, report) => sum + report.metrics.rechargeCash, 0), 2),
    completeDays: reports.filter((report) => report.complete).length,
    totalDays: reports.length,
  };
}

function trendByRatio(current: number, previous: number, threshold = 0.03): MetricTrend {
  if (previous === 0) {
    return current > 0 ? "回升" : "持平";
  }
  const delta = (current - previous) / previous;
  if (delta >= threshold) {
    return "回升";
  }
  if (delta <= -threshold) {
    return "走弱";
  }
  return "持平";
}

function trendByPoint(current: number | null, previous: number | null, threshold = 0.01): MetricTrend {
  if (current === null || previous === null) {
    return "持平";
  }
  const delta = current - previous;
  if (delta >= threshold) {
    return "回升";
  }
  if (delta <= -threshold) {
    return "走弱";
  }
  return "持平";
}

function weakerTrend(left: MetricTrend, right: MetricTrend): MetricTrend {
  if (left === "走弱" || right === "走弱") {
    return "走弱";
  }
  if (left === "回升" && right === "回升") {
    return "回升";
  }
  return "持平";
}

function classifyFocus(digest: Omit<StoreDigest, "focus">): StoreDigest["focus"] {
  if (digest.customerTrend === "走弱") {
    return "客流";
  }
  if (digest.conversionTrend === "走弱") {
    return "转化";
  }
  if (digest.memberTrend === "走弱") {
    return "会员沉淀";
  }
  return "承接";
}

function buildStoreDigest(store: MonthlyStoreReportInput): StoreDigest {
  const current = aggregateReports(store.currentReports);
  const previous = aggregateReports(store.previousReports);
  const pointTrend = trendByPoint(current.pointClockRate, previous.pointClockRate);
  const addTrend = trendByPoint(current.addClockRate, previous.addClockRate);
  const newMemberTrend = trendByRatio(current.newMembers, previous.newMembers);
  const rechargeTrend = trendByRatio(current.rechargeCash, previous.rechargeCash);
  const digestWithoutFocus = {
    orgId: store.orgId,
    storeName: store.storeName,
    current,
    previous,
    revenueTrend: trendByRatio(current.revenue, previous.revenue),
    customerTrend: trendByRatio(current.customerCount, previous.customerCount),
    conversionTrend: weakerTrend(pointTrend, addTrend),
    memberTrend: weakerTrend(newMemberTrend, rechargeTrend),
  };

  return {
    ...digestWithoutFocus,
    focus: classifyFocus(digestWithoutFocus),
  };
}

function aggregateStoreDigests(digests: StoreDigest[]): MonthlyAggregate {
  return {
    revenue: round(digests.reduce((sum, entry) => sum + entry.current.revenue, 0), 2),
    customerCount: round(digests.reduce((sum, entry) => sum + entry.current.customerCount, 0), 2),
    serviceOrders: round(digests.reduce((sum, entry) => sum + entry.current.serviceOrders, 0), 2),
    totalClocks: round(digests.reduce((sum, entry) => sum + entry.current.totalClocks, 0), 2),
    upClockRecords: round(digests.reduce((sum, entry) => sum + entry.current.upClockRecords, 0), 2),
    pointClockRecords: round(
      digests.reduce((sum, entry) => sum + entry.current.pointClockRecords, 0),
      2,
    ),
    addClockRecords: round(
      digests.reduce((sum, entry) => sum + entry.current.addClockRecords, 0),
      2,
    ),
    averageTicket: 0,
    pointClockRate: null,
    addClockRate: null,
    clockEffect: 0,
    newMembers: round(digests.reduce((sum, entry) => sum + entry.current.newMembers, 0), 2),
    rechargeCash: round(digests.reduce((sum, entry) => sum + entry.current.rechargeCash, 0), 2),
    completeDays: digests.reduce((sum, entry) => sum + entry.current.completeDays, 0),
    totalDays: digests.reduce((sum, entry) => sum + entry.current.totalDays, 0),
  };
}

function finalizeAggregate(value: MonthlyAggregate): MonthlyAggregate {
  return {
    ...value,
    averageTicket: value.customerCount > 0 ? round(value.revenue / value.customerCount, 2) : 0,
    pointClockRate:
      value.upClockRecords > 0 ? round(value.pointClockRecords / value.upClockRecords, 4) : null,
    addClockRate:
      value.upClockRecords > 0 ? round(value.addClockRecords / value.upClockRecords, 4) : null,
    clockEffect: value.totalClocks > 0 ? round(value.revenue / value.totalClocks, 2) : 0,
  };
}

function buildMetricLine(params: {
  label: string;
  current: string;
  delta: string;
  trend: MetricTrend;
}): string {
  return `- ${params.label}：${params.current}，较上月 ${params.delta}，趋势${params.trend}`;
}

function buildCurrentMetricLine(params: {
  label: string;
  current: string;
}): string {
  return `- ${params.label}：${params.current}`;
}

function shortStoreName(name: string): string {
  return name.replace(/^荷塘悦色/u, "");
}

function listNames(digests: StoreDigest[]): string {
  return digests.length > 0 ? digests.map((entry) => shortStoreName(entry.storeName)).join("、") : "无";
}

function sortDescending<T>(items: T[], select: (item: T) => number): T[] {
  return [...items].sort((left, right) => select(right) - select(left));
}

function buildRankMap(items: StoreDigest[], select: (item: StoreDigest) => number): Map<string, number> {
  return new Map(sortDescending(items, select).map((item, index) => [item.orgId, index]));
}

function metricTrendScore(trend: MetricTrend): number {
  if (trend === "回升") {
    return 1;
  }
  if (trend === "走弱") {
    return -1;
  }
  return 0;
}

function buildTrendScore(entry: StoreDigest): number {
  return (
    metricTrendScore(entry.revenueTrend) * 4 +
    metricTrendScore(entry.customerTrend) * 2 +
    metricTrendScore(entry.conversionTrend) * 2 +
    metricTrendScore(entry.memberTrend)
  );
}

function buildOperationalScore(
  entry: StoreDigest,
  rankMaps: {
    revenue: Map<string, number>;
    customers: Map<string, number>;
    recharge: Map<string, number>;
    point: Map<string, number>;
    add: Map<string, number>;
    newMembers: Map<string, number>;
    clockEffect: Map<string, number>;
  },
  storeCount: number,
): number {
  const remaining = (rank: number | undefined): number => storeCount - (rank ?? storeCount);
  return (
    remaining(rankMaps.revenue.get(entry.orgId)) * 3 +
    remaining(rankMaps.customers.get(entry.orgId)) * 2 +
    remaining(rankMaps.recharge.get(entry.orgId)) * 2 +
    remaining(rankMaps.point.get(entry.orgId)) +
    remaining(rankMaps.add.get(entry.orgId)) +
    remaining(rankMaps.newMembers.get(entry.orgId)) +
    remaining(rankMaps.clockEffect.get(entry.orgId))
  );
}

function resolveRankStrength(rank: number | undefined, storeCount: number): number {
  return storeCount - (rank ?? storeCount);
}

function isReliableBaseline(value: MonthlyAggregate): boolean {
  return value.revenue > 0 && value.customerCount > 0 && value.upClockRecords > 0;
}

function resolveStoreFocus(
  entry: StoreDigest,
  rankMaps: {
    revenue: Map<string, number>;
    customers: Map<string, number>;
    recharge: Map<string, number>;
    point: Map<string, number>;
    add: Map<string, number>;
    newMembers: Map<string, number>;
    clockEffect: Map<string, number>;
  },
  storeCount: number,
): StoreDigest["focus"] {
  const dimensionScores: Array<[StoreDigest["focus"], number]> = [
    [
      "客流",
      resolveRankStrength(rankMaps.customers.get(entry.orgId), storeCount),
    ],
    [
      "转化",
      (
        resolveRankStrength(rankMaps.point.get(entry.orgId), storeCount) +
        resolveRankStrength(rankMaps.add.get(entry.orgId), storeCount)
      ) / 2,
    ],
    [
      "会员沉淀",
      (
        resolveRankStrength(rankMaps.recharge.get(entry.orgId), storeCount) +
        resolveRankStrength(rankMaps.newMembers.get(entry.orgId), storeCount)
      ) / 2,
    ],
    [
      "承接",
      (
        resolveRankStrength(rankMaps.revenue.get(entry.orgId), storeCount) +
        resolveRankStrength(rankMaps.clockEffect.get(entry.orgId), storeCount)
      ) / 2,
    ],
  ];

  return [...dimensionScores].sort((left, right) => left[1] - right[1])[0]?.[0] ?? "承接";
}

function buildFocusMetrics(entry: StoreDigest, focus: StoreDigest["focus"]): string {
  if (focus === "客流") {
    return `到店 ${formatCount(entry.current.customerCount)} 人`;
  }
  if (focus === "转化") {
    return `点钟率 ${formatPercent(entry.current.pointClockRate)}、加钟率 ${formatPercent(entry.current.addClockRate)}`;
  }
  if (focus === "会员沉淀") {
    return `新增会员 ${formatCount(entry.current.newMembers)}、储值 ${formatCurrency(entry.current.rechargeCash)}`;
  }
  return `钟效 ${formatCurrency(entry.current.clockEffect)}/钟`;
}

function buildStoreEvidence(entry: StoreDigest, focus: StoreDigest["focus"]): string {
  if (focus === "客流") {
    return "客流位次偏后";
  }
  if (focus === "转化") {
    return `点钟率 ${formatPercent(entry.current.pointClockRate)}、加钟率 ${formatPercent(entry.current.addClockRate)}`;
  }
  if (focus === "会员沉淀") {
    return `新增会员 ${formatCount(entry.current.newMembers)}`;
  }
  return `钟效 ${formatCurrency(entry.current.clockEffect)}/钟`;
}

function buildNextMonthCheck(focus: StoreDigest["focus"]): string {
  if (focus === "客流") {
    return "只验收到店人数和营收是否站稳";
  }
  if (focus === "转化") {
    return "只验收点钟率和加钟率是否回稳";
  }
  if (focus === "会员沉淀") {
    return "只验收新增会员和储值是否修复";
  }
  return "只验收钟效和主项承接是否回稳";
}

function uniqueByOrgId(items: StoreDigest[]): StoreDigest[] {
  return items.filter((entry, index, array) => array.findIndex((item) => item.orgId === entry.orgId) === index);
}

function resolveMonthLabel(month: string): string {
  const [year, rawMonth] = month.split("-");
  return `${year}年${Number(rawMonth)}月`;
}

function buildStoreDetailLine(params: {
  entry: StoreDigest;
  mode: "baseline-valid" | "baseline-insufficient";
  focus: StoreDigest["focus"];
  roleLabel: string;
}): string {
  const storeName = shortStoreName(params.entry.storeName);
  const scale = `营收 ${formatCurrency(params.entry.current.revenue)}，到店 ${formatCount(params.entry.current.customerCount)} 人，储值 ${formatCurrency(params.entry.current.rechargeCash)}`;
  const focusEvidence = buildStoreEvidence(params.entry, params.focus);
  if (params.mode === "baseline-valid") {
    const verdict =
      params.roleLabel === "拉升店"
        ? `结果端在回升，当前最值得继续盯的是${params.focus}`
        : params.roleLabel === "承压店"
          ? `本月承压，主要问题在${params.focus}`
          : `本月处于中位，先盯${params.focus}`;
    return `- ${storeName}：${scale}；${focusEvidence}；判断：${verdict}。`;
  }
  const verdict =
    params.roleLabel === "主力店"
      ? `当前是组合盘主力店，结果端在五店前列`
      : params.roleLabel === "承压店"
        ? `当前是组合盘承压店，短板在${params.focus}`
        : `当前处于中位，先盯${params.focus}`;
  return `- ${storeName}：${scale}；${focusEvidence}；判断：${verdict}。`;
}

export function resolvePreviousMonthKey(month: string): string {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const previousMonth = monthNumber === 1 ? 12 : monthNumber - 1;
  const previousYear = monthNumber === 1 ? year - 1 : year;
  return `${previousYear.toFixed(0).padStart(4, "0")}-${previousMonth.toFixed(0).padStart(2, "0")}`;
}

export function resolveMonthDateRange(month: string): {
  startBizDate: string;
  endBizDate: string;
} {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 0));
  return {
    startBizDate: start.toISOString().slice(0, 10),
    endBizDate: end.toISOString().slice(0, 10),
  };
}

export function listMonthBizDates(month: string): string[] {
  const { startBizDate, endBizDate } = resolveMonthDateRange(month);
  const dates: string[] = [];
  const cursor = new Date(`${startBizDate}T00:00:00Z`);
  const end = new Date(`${endBizDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function renderFiveStoreMonthlyTrendReport(input: FiveStoreMonthlyTrendReportInput): string {
  const digests = input.stores.map(buildStoreDigest);
  const current = finalizeAggregate(aggregateStoreDigests(digests));
  const previous = finalizeAggregate({
    ...aggregateStoreDigests(
      digests.map((entry) => ({
        ...entry,
        current: entry.previous,
      })),
    ),
  });
  const revenueTrend = trendByRatio(current.revenue, previous.revenue);
  const customerTrend = trendByRatio(current.customerCount, previous.customerCount);
  const pointTrend = trendByPoint(current.pointClockRate, previous.pointClockRate);
  const addTrend = trendByPoint(current.addClockRate, previous.addClockRate);
  const newMemberTrend = trendByRatio(current.newMembers, previous.newMembers);
  const rechargeTrend = trendByRatio(current.rechargeCash, previous.rechargeCash);
  const conversionTrend = weakerTrend(pointTrend, addTrend);
  const memberTrend = weakerTrend(newMemberTrend, rechargeTrend);
  const rankMaps = {
    revenue: buildRankMap(digests, (entry) => entry.current.revenue),
    customers: buildRankMap(digests, (entry) => entry.current.customerCount),
    recharge: buildRankMap(digests, (entry) => entry.current.rechargeCash),
    point: buildRankMap(digests, (entry) => entry.current.pointClockRate ?? 0),
    add: buildRankMap(digests, (entry) => entry.current.addClockRate ?? 0),
    newMembers: buildRankMap(digests, (entry) => entry.current.newMembers),
    clockEffect: buildRankMap(digests, (entry) => entry.current.clockEffect),
  };
  const digestsWithAbsoluteFocus = digests.map((entry) => ({
    ...entry,
    focus: resolveStoreFocus(entry, rankMaps, digests.length),
  }));
  const reliableBaselineCount = digests.filter((entry) => isReliableBaseline(entry.previous)).length;
  const hasReliableBaseline = reliableBaselineCount >= Math.max(2, Math.ceil(digests.length / 2));
  const scoredDigests = sortDescending(digestsWithAbsoluteFocus, (entry) =>
    buildOperationalScore(entry, rankMaps, digests.length),
  );
  const focusMap = new Map(digestsWithAbsoluteFocus.map((entry) => [entry.orgId, entry.focus]));
  const monthLabel = resolveMonthLabel(input.month);
  const previousMonthLabel = resolveMonthLabel(resolvePreviousMonthKey(input.month));
  const storeLeadCount = Math.min(2, Math.max(1, Math.floor((digests.length + 1) / 2)));

  if (!hasReliableBaseline) {
    const coreStores = scoredDigests.slice(0, storeLeadCount);
    const pressureStores = [...scoredDigests].reverse().slice(0, storeLeadCount).reverse();
    const stableStores = scoredDigests.filter(
      (entry) =>
        !coreStores.some((candidate) => candidate.orgId === entry.orgId) &&
        !pressureStores.some((candidate) => candidate.orgId === entry.orgId),
    );
    const riskStores = uniqueByOrgId([...pressureStores, ...sortDescending(digestsWithAbsoluteFocus, (entry) => {
      const focus = focusMap.get(entry.orgId) ?? entry.focus;
      if (focus === "转化") {
        return -((entry.current.pointClockRate ?? 0) + (entry.current.addClockRate ?? 0));
      }
      if (focus === "会员沉淀") {
        return -(entry.current.rechargeCash + entry.current.newMembers * 1000);
      }
      if (focus === "客流") {
        return -entry.current.customerCount;
      }
      return -entry.current.clockEffect;
    })]).slice(0, 3);

    return [
      `# 荷塘悦色 ${monthLabel} 月度经营趋势总结`,
      "",
      "## 一、总部结论",
      `- 本月五店总营收 ${formatCurrency(current.revenue)}，到店 ${formatCount(current.customerCount)} 人，储值 ${formatCurrency(current.rechargeCash)}。`,
      `- 上月基线不足：${previousMonthLabel} 的日报事实大面积为 0，本月不做环比结论。`,
      `- 本月先看规模和店间分化：主力店 ${listNames(coreStores)}；承压店 ${listNames(pressureStores)}。`,
      "",
      "## 二、本月组合盘",
      buildCurrentMetricLine({ label: "营收", current: formatCurrency(current.revenue) }),
      buildCurrentMetricLine({ label: "到店人数", current: `${formatCount(current.customerCount)} 人` }),
      buildCurrentMetricLine({ label: "客单价", current: formatCurrency(current.averageTicket) }),
      buildCurrentMetricLine({ label: "点钟率", current: formatPercent(current.pointClockRate) }),
      buildCurrentMetricLine({ label: "加钟率", current: formatPercent(current.addClockRate) }),
      buildCurrentMetricLine({ label: "钟效", current: `${formatCurrency(current.clockEffect)}/钟` }),
      buildCurrentMetricLine({ label: "新增会员", current: formatCount(current.newMembers) }),
      buildCurrentMetricLine({ label: "储值", current: formatCurrency(current.rechargeCash) }),
      "",
      "## 三、门店分层",
      `- 主力店：${listNames(coreStores)}`,
      `- 稳态店：${listNames(stableStores)}`,
      `- 承压店：${listNames(pressureStores)}`,
      "",
      "## 四、门店判断",
      ...scoredDigests.map((entry) =>
        buildStoreDetailLine({
          entry,
          mode: "baseline-insufficient",
          focus: focusMap.get(entry.orgId) ?? entry.focus,
          roleLabel: coreStores.some((candidate) => candidate.orgId === entry.orgId)
            ? "主力店"
            : pressureStores.some((candidate) => candidate.orgId === entry.orgId)
              ? "承压店"
              : "稳态店",
        }),
      ),
      "",
      "## 五、关键风险",
      ...riskStores.map((entry) => {
        const focus = focusMap.get(entry.orgId) ?? entry.focus;
        return `- ${shortStoreName(entry.storeName)}：${buildFocusMetrics(entry, focus)}，当前先盯${focus}。`;
      }),
      "",
      "## 六、下月重点",
      "下月总部只盯三件事：",
      ...riskStores.map((entry, index) => {
        const focus = focusMap.get(entry.orgId) ?? entry.focus;
        return `${index + 1}. ${shortStoreName(entry.storeName)}：${buildNextMonthCheck(focus)}`;
      }),
      "",
      "## 七、备注",
      `- 数据完整度：${digests
        .map((entry) => `${shortStoreName(entry.storeName)} ${entry.current.completeDays}/${entry.current.totalDays} 天`)
        .join("；")}`,
      `- ${previousMonthLabel} 基线不足时，本报告只看本月规模分化，不输出环比涨跌结论。`,
    ].join("\n");
  }

  const overallTrend =
    revenueTrend === "走弱" || customerTrend === "走弱" || conversionTrend === "走弱"
      ? "承压"
      : revenueTrend === "回升" && memberTrend !== "走弱"
        ? "回升"
        : "持平";
  const trendOrderedDigests = sortDescending(digestsWithAbsoluteFocus, (entry) => buildTrendScore(entry));
  const risingStores = trendOrderedDigests.filter((entry) => buildTrendScore(entry) > 0).slice(0, storeLeadCount);
  const pressureStores = [...trendOrderedDigests]
    .reverse()
    .filter((entry) => buildTrendScore(entry) < 0)
    .slice(0, storeLeadCount)
    .reverse();
  const stableStores = trendOrderedDigests.filter(
    (entry) =>
      !risingStores.some((candidate) => candidate.orgId === entry.orgId) &&
      !pressureStores.some((candidate) => candidate.orgId === entry.orgId),
  );
  const riskStores = uniqueByOrgId([...pressureStores, ...trendOrderedDigests.slice(-3)]).slice(0, 3);
  const mainFocus =
    (riskStores[0] ? (focusMap.get(riskStores[0].orgId) ?? riskStores[0].focus) : undefined) ??
    (conversionTrend === "走弱"
      ? "转化"
      : customerTrend === "走弱"
        ? "客流"
        : memberTrend === "走弱"
          ? "会员沉淀"
          : "承接");

  return [
    `# 荷塘悦色 ${monthLabel} 月度经营趋势总结`,
    "",
    "## 一、总部结论",
    `- 本月五店总营收 ${formatCurrency(current.revenue)}，较上月 ${formatRatioDelta(current.revenue, previous.revenue)}，整体${overallTrend}。`,
    `- 拉升店：${listNames(risingStores)}；承压店：${listNames(pressureStores)}。`,
    `- 当前主要压力在${mainFocus}，下月先盯 ${riskStores.map((entry) => shortStoreName(entry.storeName)).join("、")}。`,
    "",
    "## 二、五店组合盘",
    buildMetricLine({
      label: "营收",
      current: formatCurrency(current.revenue),
      delta: formatRatioDelta(current.revenue, previous.revenue),
      trend: revenueTrend,
    }),
    buildMetricLine({
      label: "到店人数",
      current: formatCount(current.customerCount),
      delta: formatRatioDelta(current.customerCount, previous.customerCount),
      trend: customerTrend,
    }),
    buildMetricLine({
      label: "客单价",
      current: `${formatCurrency(current.averageTicket)}`,
      delta: formatRatioDelta(current.averageTicket, previous.averageTicket),
      trend: trendByRatio(current.averageTicket, previous.averageTicket),
    }),
    buildMetricLine({
      label: "点钟率",
      current: formatPercent(current.pointClockRate),
      delta: formatPointDelta(current.pointClockRate, previous.pointClockRate),
      trend: pointTrend,
    }),
    buildMetricLine({
      label: "加钟率",
      current: formatPercent(current.addClockRate),
      delta: formatPointDelta(current.addClockRate, previous.addClockRate),
      trend: addTrend,
    }),
    buildMetricLine({
      label: "钟效",
      current: `${formatCurrency(current.clockEffect)}/钟`,
      delta: formatRatioDelta(current.clockEffect, previous.clockEffect),
      trend: trendByRatio(current.clockEffect, previous.clockEffect),
    }),
    buildMetricLine({
      label: "新增会员",
      current: formatCount(current.newMembers),
      delta: formatRatioDelta(current.newMembers, previous.newMembers),
      trend: newMemberTrend,
    }),
    buildMetricLine({
      label: "储值",
      current: formatCurrency(current.rechargeCash),
      delta: formatRatioDelta(current.rechargeCash, previous.rechargeCash),
      trend: rechargeTrend,
    }),
    "",
    "## 三、门店趋势分层",
    `- 拉升店：${listNames(risingStores)}`,
    `- 稳态店：${listNames(stableStores)}`,
    `- 承压店：${listNames(pressureStores)}`,
    "",
    "## 四、门店判断",
    ...trendOrderedDigests.map((entry) =>
      buildStoreDetailLine({
        entry,
        mode: "baseline-valid",
        focus: focusMap.get(entry.orgId) ?? entry.focus,
        roleLabel: risingStores.some((candidate) => candidate.orgId === entry.orgId)
          ? "拉升店"
          : pressureStores.some((candidate) => candidate.orgId === entry.orgId)
            ? "承压店"
            : "稳态店",
      }),
    ),
    "",
    "## 五、关键趋势风险",
    ...riskStores.map((entry) => {
      const focus = focusMap.get(entry.orgId) ?? entry.focus;
      return `- ${shortStoreName(entry.storeName)}：${buildFocusMetrics(entry, focus)}，本月主要问题在${focus}。`;
    }),
    "",
    "## 六、下月重点",
    "下月总部只盯三件事：",
    ...riskStores.map((entry, index) => {
      const focus = focusMap.get(entry.orgId) ?? entry.focus;
      return `${index + 1}. ${shortStoreName(entry.storeName)}：${buildNextMonthCheck(focus)}`;
    }),
    "",
    "## 七、备注",
    `- 数据完整度：${digests
      .map((entry) => `${shortStoreName(entry.storeName)} ${entry.current.completeDays}/${entry.current.totalDays} 天`)
      .join("；")}`,
    "- 本报告以月度经营事实为主，环比判断仅在上月基线可靠时输出。",
  ].join("\n");
}
