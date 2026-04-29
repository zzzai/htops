import { buildStoreEnvironmentContextSnapshot } from "./environment-context.js";
import {
  buildPortfolioRiskEntry,
  buildStorePerformanceEntry,
  formatCount,
  renderAnomalyText,
  pickPrimaryMetric,
  renderCompareText,
  renderHqPortfolioText,
  renderHqPortfolioFocusText,
  renderPortfolioRiskText,
  renderRiskAdviceText,
  renderSingleDayDailyKpiText,
  renderStoreRankingText,
  renderStorePriorityTradeoffText,
  renderTrendText,
  renderWindowReportText,
  resolveMetricResolution,
  shouldUseSingleDayDailyKpiFastPath,
} from "./query-engine-renderer.js";
import type { QueryAnalysisLens } from "./analysis-lens.js";
import {
  getMetricNumericValue,
  renderMetricQueryResponse,
  type HetangSupportedMetricKey,
} from "./metric-query.js";
import { assembleStoreExternalContextForAi } from "./store-external-context.js";
import { shiftBizDate } from "./time.js";
import { renderStoreAdviceWorldModelSupplement } from "./world-model/rendering.js";
import type { HetangQueryIntent, HetangQueryTimeFrame } from "./query-intent.js";
import type {
  CustomerOperatingProfileDailyRecord,
  CustomerSegmentRecord,
  DailyStoreMetrics,
  DailyStoreReport,
  EnvironmentContextSnapshot,
  HetangOpsConfig,
  HetangStoreExternalContextEntry,
  MemberReactivationOutcomeSnapshotRecord,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechMarketRecord,
} from "./types.js";

export type StoreQueryRuntime = {
  buildReport?: (params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
  }) => Promise<DailyStoreReport>;
  getDailyReportSnapshot?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<DailyStoreReport | null>;
  listStoreManagerDailyKpiByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreManagerDailyKpiRow[]>;
  listStoreReview7dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreReview7dRow[]>;
  listStoreSummary30dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreSummary30dRow[]>;
  listTechMarketByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechMarketRecord[]>;
  listStoreExternalContextEntries?: (params: {
    orgId: string;
    snapshotDate?: string;
  }) => Promise<HetangStoreExternalContextEntry[]>;
  listCustomerSegments?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
  listCustomerOperatingProfilesDaily?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerOperatingProfileDailyRecord[]>;
  getStoreEnvironmentMemory?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<EnvironmentContextSnapshot | null>;
  listMemberReactivationOutcomeSnapshotsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<MemberReactivationOutcomeSnapshotRecord[]>;
};

export type StoreRuntimeCapabilityId =
  | "store_report_v1"
  | "store_metric_summary_v1"
  | "store_compare_v1"
  | "hq_portfolio_overview_v1"
  | "hq_portfolio_focus_v1"
  | "hq_portfolio_risk_v1"
  | "store_trend_v1"
  | "store_anomaly_v1"
  | "store_ranking_v1"
  | "store_metric_breakdown_runtime_v1"
  | "store_market_breakdown_v1"
  | "store_risk_v1"
  | "store_advice_v1";

export type StoreWindowSummary = {
  orgId: string;
  storeName: string;
  frame: HetangQueryTimeFrame;
  reports: DailyStoreReport[];
  metrics: DailyStoreMetrics;
  complete: boolean;
};

type RiskSeverity = "high" | "medium";

export type StructuredStoreDailySummaryLookupResult = {
  org_id: string;
  store_name: string;
  biz_date: string;
  metrics: {
    revenue: number;
    card_consume: number;
    order_count: number;
    total_clocks: number;
    assign_clocks: number;
    queue_clocks: number;
    point_clock_rate: number | null;
    average_ticket: number | null;
    clock_effect: number | null;
  };
};

export type StructuredStoreRiskScanLookupResult = {
  org_id: string;
  store_name: string;
  window_end_biz_date: string;
  review_7d: {
    revenue_7d: number;
    order_count_7d: number;
    point_clock_rate_7d: number | null;
    add_clock_rate_7d: number | null;
    stored_consume_rate_7d: number | null;
    sleeping_member_rate: number | null;
    renewal_pressure_index_30d: number | null;
  } | null;
  summary_30d: {
    revenue_30d: number;
    order_count_30d: number;
    point_clock_rate_30d: number | null;
    add_clock_rate_30d: number | null;
    stored_consume_rate_30d: number | null;
    sleeping_member_rate: number | null;
    renewal_pressure_index_30d: number | null;
  } | null;
  signals: Array<{
    key: string;
    severity: RiskSeverity;
    title: string;
    detail: string;
    metric_value: number;
    threshold: number;
  }>;
};

const RISK_THRESHOLDS = {
  storedConsumeRate: 0.35,
  addClockRate: 0.1,
  pointClockRate: 0.38,
  sleepingMemberRate: 0.4,
  renewalPressureIndex: 0.6,
} as const;

const LIGHTWEIGHT_DAILY_KPI_METRICS = new Set([
  "serviceRevenue",
  "serviceOrderCount",
  "totalClockCount",
  "clockEffect",
  "pointClockRate",
  "addClockRate",
]);

const SHORT_WINDOW_AUTO_DAILY_BREAKDOWN_METRICS = new Set<HetangSupportedMetricKey>([
  "serviceRevenue",
  "antiServiceRevenue",
  "serviceOrderCount",
  "orderAverageAmount",
  "customerCount",
  "clockEffect",
  "clockRevenue",
  "averageTicket",
  "memberPaymentAmount",
  "memberPaymentShare",
  "cashPaymentAmount",
  "cashPaymentShare",
  "wechatPaymentAmount",
  "wechatPaymentShare",
  "alipayPaymentAmount",
  "alipayPaymentShare",
  "storedConsumeAmount",
  "rechargeCash",
  "rechargeStoredValue",
  "rechargeBonusValue",
  "groupbuyOrderCount",
  "groupbuyOrderShare",
  "groupbuyAmount",
  "groupbuyAmountShare",
  "meituanGroupbuyOrderCount",
  "meituanGroupbuyOrderShare",
  "meituanGroupbuyAmount",
  "meituanGroupbuyAmountShare",
  "douyinGroupbuyOrderCount",
  "douyinGroupbuyOrderShare",
  "douyinGroupbuyAmount",
  "douyinGroupbuyAmountShare",
  "totalClockCount",
  "activeTechCount",
  "onDutyTechCount",
  "techCommission",
  "techCommissionRate",
  "marketRevenue",
  "marketCommission",
  "newMembers",
  "pointClockRate",
  "addClockRate",
  "roomOccupancyRate",
  "roomTurnoverRate",
  "grossMarginRate",
  "netMarginRate",
]);

function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function resolveRiskSignals(params: {
  review?: StoreReview7dRow;
  summary?: StoreSummary30dRow;
}): Array<{
  key: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  metric_value: number;
  threshold: number;
}> {
  const signals: Array<{
    key: string;
    severity: RiskSeverity;
    title: string;
    detail: string;
    metric_value: number;
    threshold: number;
  }> = [];
  const review = params.review;
  const summary = params.summary;

  const pushSignal = (
    key: string,
    severity: RiskSeverity,
    title: string,
    detail: string,
    metricValue: number | null | undefined,
    threshold: number,
  ) => {
    if (metricValue === null || metricValue === undefined) {
      return;
    }
    signals.push({
      key,
      severity,
      title,
      detail,
      metric_value: Number(metricValue),
      threshold,
    });
  };

  if ((summary?.storedConsumeRate30d ?? review?.storedConsumeRate7d ?? 1) < RISK_THRESHOLDS.storedConsumeRate) {
    pushSignal(
      "low_member_store_consume_rate",
      "high",
      "会员消耗占比偏低",
      "门店当前更依赖非会员支付，储值沉淀和后续复购承压。",
      summary?.storedConsumeRate30d ?? review?.storedConsumeRate7d,
      RISK_THRESHOLDS.storedConsumeRate,
    );
  }

  if ((summary?.addClockRate30d ?? review?.addClockRate7d ?? 1) < RISK_THRESHOLDS.addClockRate) {
    pushSignal(
      "weak_addon_rate",
      "high",
      "加钟/副项承接偏弱",
      "到店后延长消费与附加销售不足，容易损失高客单空间。",
      summary?.addClockRate30d ?? review?.addClockRate7d,
      RISK_THRESHOLDS.addClockRate,
    );
  }

  if ((summary?.pointClockRate30d ?? review?.pointClockRate7d ?? 1) < RISK_THRESHOLDS.pointClockRate) {
    pushSignal(
      "weak_point_clock_rate",
      "medium",
      "指定率偏弱",
      "熟客绑定与技师偏好还没充分放大，复购粘性存在空间。",
      summary?.pointClockRate30d ?? review?.pointClockRate7d,
      RISK_THRESHOLDS.pointClockRate,
    );
  }

  if ((summary?.sleepingMemberRate ?? review?.sleepingMemberRate ?? 0) > RISK_THRESHOLDS.sleepingMemberRate) {
    pushSignal(
      "high_sleeping_member_rate",
      "high",
      "沉睡会员占比较高",
      "需要尽快把高价值沉默会员转入主动唤回和生日窗口运营。",
      summary?.sleepingMemberRate ?? review?.sleepingMemberRate,
      RISK_THRESHOLDS.sleepingMemberRate,
    );
  }

  if ((summary?.renewalPressureIndex30d ?? review?.renewalPressureIndex30d ?? 0) > RISK_THRESHOLDS.renewalPressureIndex) {
    pushSignal(
      "high_renewal_pressure",
      "medium",
      "续充压力偏高",
      "余额消耗和沉默节奏叠加，近期要重点盯高价值会员续充。",
      summary?.renewalPressureIndex30d ?? review?.renewalPressureIndex30d,
      RISK_THRESHOLDS.renewalPressureIndex,
    );
  }

  return signals;
}

function toDailySummaryResult(row: StoreManagerDailyKpiRow): StructuredStoreDailySummaryLookupResult {
  return {
    org_id: row.orgId,
    store_name: row.storeName,
    biz_date: row.bizDate,
    metrics: {
      revenue: row.dailyActualRevenue,
      card_consume: row.dailyCardConsume,
      order_count: row.dailyOrderCount,
      total_clocks: row.totalClocks,
      assign_clocks: row.assignClocks,
      queue_clocks: row.queueClocks,
      point_clock_rate: row.pointClockRate,
      average_ticket: row.averageTicket,
      clock_effect: row.clockEffect,
    },
  };
}

function toReviewSnapshot(row: StoreReview7dRow | undefined): StructuredStoreRiskScanLookupResult["review_7d"] {
  if (!row) {
    return null;
  }
  return {
    revenue_7d: row.revenue7d,
    order_count_7d: row.orderCount7d,
    point_clock_rate_7d: row.pointClockRate7d,
    add_clock_rate_7d: row.addClockRate7d,
    stored_consume_rate_7d: row.storedConsumeRate7d,
    sleeping_member_rate: row.sleepingMemberRate,
    renewal_pressure_index_30d: row.renewalPressureIndex30d ?? null,
  };
}

function toSummarySnapshot(row: StoreSummary30dRow | undefined): StructuredStoreRiskScanLookupResult["summary_30d"] {
  if (!row) {
    return null;
  }
  return {
    revenue_30d: row.revenue30d,
    order_count_30d: row.orderCount30d,
    point_clock_rate_30d: row.pointClockRate30d,
    add_clock_rate_30d: row.addClockRate30d,
    stored_consume_rate_30d: row.storedConsumeRate30d,
    sleeping_member_rate: row.sleepingMemberRate,
    renewal_pressure_index_30d: row.renewalPressureIndex30d ?? null,
  };
}

export async function lookupStructuredStoreDailySummary(params: {
  runtime: StoreQueryRuntime;
  config: HetangOpsConfig;
  orgId: string;
  bizDate: string;
}): Promise<StructuredStoreDailySummaryLookupResult | null> {
  if (!params.runtime.listStoreManagerDailyKpiByDateRange) {
    return null;
  }
  const rows = await params.runtime.listStoreManagerDailyKpiByDateRange({
    orgId: params.orgId,
    startBizDate: params.bizDate,
    endBizDate: params.bizDate,
  });
  const row = rows[0];
  if (!row) {
    return null;
  }
  return toDailySummaryResult({
    ...row,
    storeName: row.storeName || getStoreName(params.config, params.orgId),
  });
}

export async function lookupStructuredStoreRiskScan(params: {
  runtime: StoreQueryRuntime;
  config: HetangOpsConfig;
  orgId: string;
  bizDate: string;
}): Promise<StructuredStoreRiskScanLookupResult | null> {
  const [reviewRows, summaryRows] = await Promise.all([
    params.runtime.listStoreReview7dByDateRange
      ? params.runtime.listStoreReview7dByDateRange({
          orgId: params.orgId,
          startBizDate: params.bizDate,
          endBizDate: params.bizDate,
        })
      : Promise.resolve([]),
    params.runtime.listStoreSummary30dByDateRange
      ? params.runtime.listStoreSummary30dByDateRange({
          orgId: params.orgId,
          startBizDate: params.bizDate,
          endBizDate: params.bizDate,
        })
      : Promise.resolve([]),
  ]);
  const review = reviewRows[0];
  const summary = summaryRows[0];
  if (!review && !summary) {
    return null;
  }
  return {
    org_id: params.orgId,
    store_name: review?.storeName ?? summary?.storeName ?? getStoreName(params.config, params.orgId),
    window_end_biz_date: params.bizDate,
    review_7d: toReviewSnapshot(review),
    summary_30d: toSummarySnapshot(summary),
    signals: resolveRiskSignals({ review, summary }),
  };
}

function isStorePriorityTradeoffAsk(text: string): boolean {
  return (
    /(复购|回流|老客).*(储值|续费|开卡)|(储值|续费|开卡).*(复购|回流|老客)/u.test(text) &&
    /(先抓|优先抓|优先做|先做|先盯|该抓|先管)/u.test(text)
  );
}

function resolveStableAnchorBizDate(frame: HetangQueryTimeFrame): string {
  if (frame.kind === "range") {
    return frame.endBizDate;
  }
  return frame.label === "今天" ? shiftBizDate(frame.bizDate, -1) : frame.bizDate;
}

async function loadSingleDayDailyKpiRow(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  bizDate: string;
}): Promise<StoreManagerDailyKpiRow | null> {
  if (!params.runtime.listStoreManagerDailyKpiByDateRange) {
    return null;
  }
  const rows = await params.runtime.listStoreManagerDailyKpiByDateRange({
    orgId: params.orgId,
    startBizDate: params.bizDate,
    endBizDate: params.bizDate,
  });
  return rows.find((entry) => entry.bizDate === params.bizDate) ?? rows[0] ?? null;
}

async function loadSingleDayReport(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  bizDate: string;
  now: Date;
}): Promise<DailyStoreReport | null> {
  const snapshot = params.runtime.getDailyReportSnapshot
    ? await params.runtime.getDailyReportSnapshot({
        orgId: params.orgId,
        bizDate: params.bizDate,
      })
    : null;
  if (snapshot) {
    return snapshot;
  }
  if (!params.runtime.buildReport) {
    return null;
  }
  return await params.runtime.buildReport({
    orgId: params.orgId,
    bizDate: params.bizDate,
    now: params.now,
  });
}

function buildLightweightMetricsFromDailyKpiRow(row: StoreManagerDailyKpiRow): DailyStoreMetrics {
  const upClockRecordCount = Math.max(row.assignClocks + row.queueClocks, 0);
  const addClockRecordCount = Math.max(row.totalClocks - upClockRecordCount, 0);
  return {
    orgId: row.orgId,
    storeName: row.storeName,
    bizDate: row.bizDate,
    serviceRevenue: row.dailyActualRevenue,
    rechargeCash: 0,
    rechargeStoredValue: 0,
    rechargeBonusValue: 0,
    antiServiceRevenue: 0,
    serviceOrderCount: row.dailyOrderCount,
    customerCount: 0,
    averageTicket: row.averageTicket ?? 0,
    totalClockCount: row.totalClocks,
    upClockRecordCount,
    pointClockRecordCount: row.assignClocks,
    pointClockRate: row.pointClockRate,
    addClockRecordCount,
    addClockRate: upClockRecordCount > 0 ? addClockRecordCount / upClockRecordCount : null,
    clockRevenue: 0,
    clockEffect: row.clockEffect ?? 0,
    activeTechCount: 0,
    onDutyTechCount: 0,
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
    storedConsumeAmount: row.dailyCardConsume,
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
    effectiveMembers: 0,
    newMembers: 0,
    sleepingMembers: 0,
    sleepingMemberRate: null,
    currentStoredBalance: 0,
    roomOccupancyRate: null,
    roomTurnoverRate: null,
    grossMarginRate: null,
    netMarginRate: null,
    breakEvenRevenue: null,
    incompleteSync: false,
    unavailableMetrics: [],
  };
}

function buildLightweightReportFromDailyKpiRow(row: StoreManagerDailyKpiRow): DailyStoreReport {
  return {
    orgId: row.orgId,
    storeName: row.storeName,
    bizDate: row.bizDate,
    metrics: buildLightweightMetricsFromDailyKpiRow(row),
    alerts: [],
    suggestions: [],
    markdown: "",
    complete: true,
  };
}

export function enumerateBizDates(frame: HetangQueryTimeFrame): string[] {
  if (frame.kind === "single") {
    return [frame.bizDate];
  }
  const values: string[] = [];
  let cursor = frame.startBizDate;
  while (cursor <= frame.endBizDate) {
    values.push(cursor);
    cursor = shiftBizDate(cursor, 1);
  }
  return values;
}

export function resolvePreviousComparableFrame(frame: HetangQueryTimeFrame): HetangQueryTimeFrame {
  if (frame.kind === "single") {
    return {
      kind: "single",
      bizDate: shiftBizDate(frame.bizDate, -1),
      label: "上一日",
      days: 1,
    };
  }
  return {
    kind: "range",
    startBizDate: shiftBizDate(frame.startBizDate, -frame.days),
    endBizDate: shiftBizDate(frame.endBizDate, -frame.days),
    label: frame.days === 7 ? "上周" : "上一周期",
    days: frame.days,
  };
}

function canUseLightweightDailyKpiSummary(requestedMetrics?: string[]): boolean {
  return (
    Array.isArray(requestedMetrics) &&
    requestedMetrics.length > 0 &&
    requestedMetrics.every((metric) => LIGHTWEIGHT_DAILY_KPI_METRICS.has(metric))
  );
}

function requiresReliableClockBreakdown(requestedMetrics?: string[]): boolean {
  return (
    Array.isArray(requestedMetrics) &&
    requestedMetrics.some((metric) => metric === "pointClockRate" || metric === "addClockRate")
  );
}

function hasReliableDailyKpiClockBreakdown(row: StoreManagerDailyKpiRow): boolean {
  return row.assignClocks + row.queueClocks > 0;
}

function metricNumber(metrics: Partial<DailyStoreMetrics>, key: keyof DailyStoreMetrics): number {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metricNullable(
  metrics: Partial<DailyStoreMetrics>,
  key: keyof DailyStoreMetrics,
): number | null {
  const value = metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createEmptyMetrics(orgId: string, storeName: string, bizDate: string): DailyStoreMetrics {
  return {
    orgId,
    storeName,
    bizDate,
    serviceRevenue: 0,
    rechargeCash: 0,
    rechargeStoredValue: 0,
    rechargeBonusValue: 0,
    antiServiceRevenue: 0,
    serviceOrderCount: 0,
    customerCount: 0,
    averageTicket: 0,
    totalClockCount: 0,
    upClockRecordCount: 0,
    pointClockRecordCount: 0,
    pointClockRate: null,
    addClockRecordCount: 0,
    addClockRate: null,
    clockRevenue: 0,
    clockEffect: 0,
    activeTechCount: 0,
    onDutyTechCount: 0,
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
    effectiveMembers: 0,
    newMembers: 0,
    sleepingMembers: 0,
    sleepingMemberRate: null,
    currentStoredBalance: 0,
    roomOccupancyRate: null,
    roomTurnoverRate: null,
    grossMarginRate: null,
    netMarginRate: null,
    breakEvenRevenue: null,
    incompleteSync: false,
    unavailableMetrics: [],
  };
}

function buildDailyReportFromDailyKpiRow(
  row: StoreManagerDailyKpiRow,
  options: {
    requireReliableClockBreakdown?: boolean;
  } = {},
): DailyStoreReport {
  const metrics = createEmptyMetrics(row.orgId, row.storeName, row.bizDate);
  const upClockRecordCount = Math.max(row.assignClocks + row.queueClocks, 0);
  const reliableClockBreakdown = upClockRecordCount > 0;
  const addClockRecordCount = reliableClockBreakdown
    ? Math.max(row.totalClocks - upClockRecordCount, 0)
    : 0;
  const pointClockRate = reliableClockBreakdown
    ? (row.pointClockRate ?? row.assignClocks / upClockRecordCount)
    : null;
  const addClockRate = reliableClockBreakdown ? addClockRecordCount / upClockRecordCount : null;
  const breakdownMissing =
    options.requireReliableClockBreakdown === true && !hasReliableDailyKpiClockBreakdown(row);

  return {
    orgId: row.orgId,
    storeName: row.storeName,
    bizDate: row.bizDate,
    metrics: {
      ...metrics,
      serviceRevenue: row.dailyActualRevenue,
      storedConsumeAmount: row.dailyCardConsume,
      serviceOrderCount: row.dailyOrderCount,
      averageTicket:
        row.averageTicket ??
        (row.dailyOrderCount > 0 ? round(row.dailyActualRevenue / row.dailyOrderCount, 2) : 0),
      totalClockCount: row.totalClocks,
      upClockRecordCount,
      pointClockRecordCount: row.assignClocks,
      pointClockRate,
      addClockRecordCount,
      addClockRate,
      clockEffect:
        row.clockEffect ??
        (row.totalClocks > 0 ? round(row.dailyActualRevenue / row.totalClocks, 2) : 0),
      incompleteSync: breakdownMissing,
      unavailableMetrics: breakdownMissing ? ["pointClockRate", "addClockRate"] : [],
    },
    alerts: [],
    suggestions: [],
    markdown: "",
    complete: !breakdownMissing,
  };
}

async function buildLightweightDailyKpiReports(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  bizDates: string[];
  requestedMetrics?: string[];
  dailyKpiByDate: Map<string, StoreManagerDailyKpiRow>;
}): Promise<DailyStoreReport[]> {
  const needReliableClockBreakdown = requiresReliableClockBreakdown(params.requestedMetrics);
  const reports = await Promise.all(
    params.bizDates.map(async (bizDate) => {
      const row = params.dailyKpiByDate.get(bizDate);
      if (!row) {
        return null;
      }
      if (
        needReliableClockBreakdown &&
        !hasReliableDailyKpiClockBreakdown(row) &&
        params.runtime.getDailyReportSnapshot
      ) {
        const snapshot = await params.runtime.getDailyReportSnapshot({
          orgId: params.orgId,
          bizDate,
        });
        if (snapshot) {
          return snapshot;
        }
      }
      return buildDailyReportFromDailyKpiRow(row, {
        requireReliableClockBreakdown: needReliableClockBreakdown,
      });
    }),
  );
  return reports.filter((report): report is DailyStoreReport => !!report);
}

function summarizeReportsWindow(params: {
  orgId: string;
  storeName: string;
  frame: HetangQueryTimeFrame;
  reports: DailyStoreReport[];
}): DailyStoreMetrics {
  const lastReport = params.reports[params.reports.length - 1];
  const lastMetrics = (lastReport?.metrics ?? {}) as Partial<DailyStoreMetrics>;
  const base = createEmptyMetrics(
    params.orgId,
    params.storeName,
    params.frame.kind === "single" ? params.frame.bizDate : params.frame.endBizDate,
  );
  const firstMetrics = params.reports.map(
    (entry) => (entry.metrics ?? {}) as Partial<DailyStoreMetrics>,
  );
  const dayCount = Math.max(params.reports.length, 1);
  const sum = (key: keyof DailyStoreMetrics) =>
    round(firstMetrics.reduce((total, metrics) => total + metricNumber(metrics, key), 0), 4);
  const avg = (key: keyof DailyStoreMetrics) => round(sum(key) / dayCount, 2);
  const unionUnavailable = Array.from(
    new Set(params.reports.flatMap((entry) => entry.metrics?.unavailableMetrics ?? [])),
  );

  const platformMap = new Map<string, { orderCount: number; amount: number }>();
  for (const report of params.reports) {
    for (const platform of report.metrics?.groupbuyPlatformBreakdown ?? []) {
      const current = platformMap.get(platform.platform) ?? { orderCount: 0, amount: 0 };
      current.orderCount += platform.orderCount;
      current.amount = round(current.amount + platform.amount);
      platformMap.set(platform.platform, current);
    }
  }

  const serviceRevenue = sum("serviceRevenue");
  const rechargeCash = sum("rechargeCash");
  const serviceOrderCount = sum("serviceOrderCount");
  const totalClockCount = sum("totalClockCount");
  const upClockRecordCount = sum("upClockRecordCount");
  const pointClockRecordCount = sum("pointClockRecordCount");
  const addClockRecordCount = sum("addClockRecordCount");
  const techCommission = sum("techCommission");
  const clockRevenue = sum("clockRevenue");
  const memberPaymentAmount = sum("memberPaymentAmount");
  const cashPaymentAmount = sum("cashPaymentAmount");
  const wechatPaymentAmount = sum("wechatPaymentAmount");
  const alipayPaymentAmount = sum("alipayPaymentAmount");
  const storedConsumeAmount = sum("storedConsumeAmount");
  const groupbuyOrderCount = sum("groupbuyOrderCount");
  const groupbuyAmount = sum("groupbuyAmount");
  const pointClockRate = upClockRecordCount > 0 ? pointClockRecordCount / upClockRecordCount : null;
  const addClockRate = upClockRecordCount > 0 ? addClockRecordCount / upClockRecordCount : null;

  return {
    ...base,
    ...lastMetrics,
    bizDate: params.frame.kind === "single" ? params.frame.bizDate : params.frame.endBizDate,
    serviceRevenue,
    rechargeCash,
    rechargeStoredValue: sum("rechargeStoredValue"),
    rechargeBonusValue: sum("rechargeBonusValue"),
    antiServiceRevenue: sum("antiServiceRevenue"),
    serviceOrderCount,
    customerCount: sum("customerCount"),
    averageTicket: sum("customerCount") > 0 ? round(serviceRevenue / sum("customerCount")) : 0,
    totalClockCount,
    upClockRecordCount,
    pointClockRecordCount,
    pointClockRate,
    addClockRecordCount,
    addClockRate,
    clockRevenue,
    clockEffect: totalClockCount > 0 ? round(serviceRevenue / totalClockCount) : 0,
    activeTechCount: avg("activeTechCount"),
    onDutyTechCount: avg("onDutyTechCount"),
    techCommission,
    techCommissionRate:
      clockRevenue > 0
        ? round(techCommission / clockRevenue, 4)
        : metricNullable(lastMetrics, "techCommissionRate") ?? 0,
    marketRevenue: sum("marketRevenue"),
    marketCommission: sum("marketCommission"),
    memberPaymentAmount,
    memberPaymentShare: serviceRevenue > 0 ? round(memberPaymentAmount / serviceRevenue, 4) : null,
    cashPaymentAmount,
    cashPaymentShare: serviceRevenue > 0 ? round(cashPaymentAmount / serviceRevenue, 4) : null,
    wechatPaymentAmount,
    wechatPaymentShare: serviceRevenue > 0 ? round(wechatPaymentAmount / serviceRevenue, 4) : null,
    alipayPaymentAmount,
    alipayPaymentShare: serviceRevenue > 0 ? round(alipayPaymentAmount / serviceRevenue, 4) : null,
    storedConsumeAmount,
    storedConsumeRate: rechargeCash > 0 ? round(storedConsumeAmount / rechargeCash, 4) : null,
    groupbuyOrderCount,
    groupbuyOrderShare:
      serviceOrderCount > 0 ? round(groupbuyOrderCount / serviceOrderCount, 4) : null,
    groupbuyAmount,
    groupbuyAmountShare: serviceRevenue > 0 ? round(groupbuyAmount / serviceRevenue, 4) : null,
    groupbuyPlatformBreakdown: Array.from(platformMap.entries()).map(([platform, entry]) => ({
      platform,
      orderCount: entry.orderCount,
      orderShare: serviceOrderCount > 0 ? round(entry.orderCount / serviceOrderCount, 4) : null,
      amount: entry.amount,
      amountShare: serviceRevenue > 0 ? round(entry.amount / serviceRevenue, 4) : null,
    })),
    groupbuyCohortCustomerCount: metricNumber(lastMetrics, "groupbuyCohortCustomerCount"),
    groupbuyRevisitCustomerCount: metricNumber(lastMetrics, "groupbuyRevisitCustomerCount"),
    groupbuyRevisitRate: metricNullable(lastMetrics, "groupbuyRevisitRate"),
    groupbuyMemberPayConvertedCustomerCount: metricNumber(
      lastMetrics,
      "groupbuyMemberPayConvertedCustomerCount",
    ),
    groupbuyMemberPayConversionRate: metricNullable(lastMetrics, "groupbuyMemberPayConversionRate"),
    groupbuy7dRevisitCustomerCount: metricNumber(lastMetrics, "groupbuy7dRevisitCustomerCount"),
    groupbuy7dRevisitRate: metricNullable(lastMetrics, "groupbuy7dRevisitRate"),
    groupbuy7dCardOpenedCustomerCount: metricNumber(
      lastMetrics,
      "groupbuy7dCardOpenedCustomerCount",
    ),
    groupbuy7dCardOpenedRate: metricNullable(lastMetrics, "groupbuy7dCardOpenedRate"),
    groupbuy7dStoredValueConvertedCustomerCount: metricNumber(
      lastMetrics,
      "groupbuy7dStoredValueConvertedCustomerCount",
    ),
    groupbuy7dStoredValueConversionRate: metricNullable(
      lastMetrics,
      "groupbuy7dStoredValueConversionRate",
    ),
    groupbuy30dMemberPayConvertedCustomerCount: metricNumber(
      lastMetrics,
      "groupbuy30dMemberPayConvertedCustomerCount",
    ),
    groupbuy30dMemberPayConversionRate: metricNullable(
      lastMetrics,
      "groupbuy30dMemberPayConversionRate",
    ),
    groupbuyFirstOrderCustomerCount: metricNumber(lastMetrics, "groupbuyFirstOrderCustomerCount"),
    groupbuyFirstOrderHighValueMemberCustomerCount: metricNumber(
      lastMetrics,
      "groupbuyFirstOrderHighValueMemberCustomerCount",
    ),
    groupbuyFirstOrderHighValueMemberRate: metricNullable(
      lastMetrics,
      "groupbuyFirstOrderHighValueMemberRate",
    ),
    effectiveMembers: metricNumber(lastMetrics, "effectiveMembers"),
    newMembers: sum("newMembers"),
    sleepingMembers: metricNumber(lastMetrics, "sleepingMembers"),
    sleepingMemberRate: metricNullable(lastMetrics, "sleepingMemberRate"),
    currentStoredBalance: metricNumber(lastMetrics, "currentStoredBalance"),
    roomOccupancyRate: metricNullable(lastMetrics, "roomOccupancyRate"),
    roomTurnoverRate: metricNullable(lastMetrics, "roomTurnoverRate"),
    grossMarginRate: metricNullable(lastMetrics, "grossMarginRate"),
    netMarginRate: metricNullable(lastMetrics, "netMarginRate"),
    breakEvenRevenue: metricNullable(lastMetrics, "breakEvenRevenue"),
    incompleteSync: params.reports.some(
      (entry) => entry.complete === false || entry.metrics?.incompleteSync,
    ),
    unavailableMetrics: unionUnavailable,
  };
}

function applyStoreReview7dRow(
  metrics: DailyStoreMetrics,
  row: StoreReview7dRow,
): DailyStoreMetrics {
  const customerCount7d = row.customerCount7d;
  return {
    ...metrics,
    orgId: row.orgId,
    storeName: row.storeName,
    bizDate: row.windowEndBizDate,
    serviceRevenue: row.revenue7d,
    serviceOrderCount: row.orderCount7d,
    customerCount: customerCount7d,
    averageTicket:
      customerCount7d > 0
        ? round(row.revenue7d / customerCount7d, 2)
        : row.averageTicket7d ?? metrics.averageTicket,
    totalClockCount: row.totalClocks7d,
    clockEffect: row.clockEffect7d ?? metrics.clockEffect,
    pointClockRate: row.pointClockRate7d,
    addClockRate: row.addClockRate7d,
    rechargeCash: row.rechargeCash7d,
    storedConsumeAmount: row.storedConsumeAmount7d,
    storedConsumeRate: row.storedConsumeRate7d,
    onDutyTechCount: row.onDutyTechCount7d ?? metrics.onDutyTechCount,
    groupbuyOrderShare: row.groupbuyOrderShare7d,
    groupbuyCohortCustomerCount: row.groupbuyCohortCustomerCount,
    groupbuy7dRevisitCustomerCount: row.groupbuy7dRevisitCustomerCount,
    groupbuy7dRevisitRate: row.groupbuy7dRevisitRate,
    groupbuy7dCardOpenedCustomerCount: row.groupbuy7dCardOpenedCustomerCount,
    groupbuy7dCardOpenedRate: row.groupbuy7dCardOpenedRate,
    groupbuy7dStoredValueConvertedCustomerCount: row.groupbuy7dStoredValueConvertedCustomerCount,
    groupbuy7dStoredValueConversionRate: row.groupbuy7dStoredValueConversionRate,
    groupbuy30dMemberPayConvertedCustomerCount: row.groupbuy30dMemberPayConvertedCustomerCount,
    groupbuy30dMemberPayConversionRate: row.groupbuy30dMemberPayConversionRate,
    groupbuyFirstOrderCustomerCount: row.groupbuyFirstOrderCustomerCount,
    groupbuyFirstOrderHighValueMemberCustomerCount:
      row.groupbuyFirstOrderHighValueMemberCustomerCount,
    groupbuyFirstOrderHighValueMemberRate: row.groupbuyFirstOrderHighValueMemberRate,
    effectiveMembers: row.effectiveMembers,
    newMembers: row.newMembers7d,
    sleepingMembers: row.sleepingMembers,
    sleepingMemberRate: row.sleepingMemberRate,
    activeTechCount: row.activeTechCount7d ?? metrics.activeTechCount,
    currentStoredBalance: row.currentStoredBalance ?? metrics.currentStoredBalance,
    storedBalanceLifeMonths: row.storedBalanceLifeMonths ?? metrics.storedBalanceLifeMonths,
    renewalPressureIndex30d: row.renewalPressureIndex30d ?? metrics.renewalPressureIndex30d,
    memberRepurchaseBaseCustomerCount7d:
      row.memberRepurchaseBaseCustomerCount7d ?? metrics.memberRepurchaseBaseCustomerCount7d,
    memberRepurchaseReturnedCustomerCount7d:
      row.memberRepurchaseReturnedCustomerCount7d ??
      metrics.memberRepurchaseReturnedCustomerCount7d,
    memberRepurchaseRate7d: row.memberRepurchaseRate7d ?? metrics.memberRepurchaseRate7d,
  };
}

function applyStoreSummary30dRow(
  metrics: DailyStoreMetrics,
  row: StoreSummary30dRow,
): DailyStoreMetrics {
  const customerCount30d = row.customerCount30d;
  return {
    ...metrics,
    orgId: row.orgId,
    storeName: row.storeName,
    bizDate: row.windowEndBizDate,
    serviceRevenue: row.revenue30d,
    serviceOrderCount: row.orderCount30d,
    customerCount: customerCount30d,
    averageTicket:
      customerCount30d > 0
        ? round(row.revenue30d / customerCount30d, 2)
        : row.averageTicket30d ?? metrics.averageTicket,
    totalClockCount: row.totalClocks30d,
    clockEffect: row.clockEffect30d ?? metrics.clockEffect,
    pointClockRate: row.pointClockRate30d,
    addClockRate: row.addClockRate30d,
    rechargeCash: row.rechargeCash30d,
    storedConsumeAmount: row.storedConsumeAmount30d,
    storedConsumeRate: row.storedConsumeRate30d,
    onDutyTechCount: row.onDutyTechCount30d ?? metrics.onDutyTechCount,
    groupbuyOrderShare: row.groupbuyOrderShare30d,
    groupbuyCohortCustomerCount: row.groupbuyCohortCustomerCount,
    groupbuy7dRevisitCustomerCount: row.groupbuy7dRevisitCustomerCount,
    groupbuy7dRevisitRate: row.groupbuy7dRevisitRate,
    groupbuy7dCardOpenedCustomerCount: row.groupbuy7dCardOpenedCustomerCount,
    groupbuy7dCardOpenedRate: row.groupbuy7dCardOpenedRate,
    groupbuy7dStoredValueConvertedCustomerCount: row.groupbuy7dStoredValueConvertedCustomerCount,
    groupbuy7dStoredValueConversionRate: row.groupbuy7dStoredValueConversionRate,
    groupbuy30dMemberPayConvertedCustomerCount: row.groupbuy30dMemberPayConvertedCustomerCount,
    groupbuy30dMemberPayConversionRate: row.groupbuy30dMemberPayConversionRate,
    groupbuyFirstOrderCustomerCount: row.groupbuyFirstOrderCustomerCount,
    groupbuyFirstOrderHighValueMemberCustomerCount:
      row.groupbuyFirstOrderHighValueMemberCustomerCount,
    groupbuyFirstOrderHighValueMemberRate: row.groupbuyFirstOrderHighValueMemberRate,
    effectiveMembers: row.effectiveMembers,
    newMembers: row.newMembers30d,
    sleepingMembers: row.sleepingMembers,
    sleepingMemberRate: row.sleepingMemberRate,
    activeTechCount: row.activeTechCount30d ?? metrics.activeTechCount,
    currentStoredBalance: row.currentStoredBalance ?? metrics.currentStoredBalance,
    storedBalanceLifeMonths: row.storedBalanceLifeMonths ?? metrics.storedBalanceLifeMonths,
    renewalPressureIndex30d: row.renewalPressureIndex30d ?? metrics.renewalPressureIndex30d,
    memberRepurchaseBaseCustomerCount7d:
      row.memberRepurchaseBaseCustomerCount7d ?? metrics.memberRepurchaseBaseCustomerCount7d,
    memberRepurchaseReturnedCustomerCount7d:
      row.memberRepurchaseReturnedCustomerCount7d ??
      metrics.memberRepurchaseReturnedCustomerCount7d,
    memberRepurchaseRate7d: row.memberRepurchaseRate7d ?? metrics.memberRepurchaseRate7d,
  };
}

export async function collectStoreWindowSummary(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  frame: HetangQueryTimeFrame;
  now: Date;
  requestedMetrics?: string[];
}): Promise<StoreWindowSummary> {
  const bizDates = enumerateBizDates(params.frame);
  if (
    canUseLightweightDailyKpiSummary(params.requestedMetrics) &&
    params.runtime.listStoreManagerDailyKpiByDateRange
  ) {
    const dailyKpiRows = await params.runtime.listStoreManagerDailyKpiByDateRange({
      orgId: params.orgId,
      startBizDate: bizDates[0] ?? "",
      endBizDate: bizDates[bizDates.length - 1] ?? "",
    });
    const dailyKpiByDate = new Map(dailyKpiRows.map((row) => [row.bizDate, row]));
    const lightweightReports = await buildLightweightDailyKpiReports({
      runtime: params.runtime,
      orgId: params.orgId,
      bizDates,
      requestedMetrics: params.requestedMetrics,
      dailyKpiByDate,
    });

    if (lightweightReports.length === bizDates.length) {
      const storeName = lightweightReports[lightweightReports.length - 1]?.storeName ?? params.orgId;
      const lightweightMetrics = summarizeReportsWindow({
        orgId: params.orgId,
        storeName,
        frame: params.frame,
        reports: lightweightReports,
      });
      return {
        orgId: params.orgId,
        storeName,
        frame: params.frame,
        reports: lightweightReports,
        metrics: lightweightMetrics,
        complete:
          lightweightReports.every((entry) => entry.complete) &&
          !lightweightMetrics.incompleteSync,
      };
    }
  }

  if (!params.runtime.buildReport) {
    throw new Error("missing-build-report");
  }

  const reviewWindowEndBizDate =
    params.frame.kind === "range" && params.frame.days === 7 ? params.frame.endBizDate : undefined;
  const summaryWindowEndBizDate =
    params.frame.kind === "range" && params.frame.days === 30 ? params.frame.endBizDate : undefined;
  const loadDailyReport = async (bizDate: string): Promise<DailyStoreReport> => {
    if (params.runtime.getDailyReportSnapshot) {
      const snapshot = await params.runtime.getDailyReportSnapshot({
        orgId: params.orgId,
        bizDate,
      });
      if (snapshot) {
        return snapshot;
      }
    }
    return await params.runtime.buildReport!({ orgId: params.orgId, bizDate, now: params.now });
  };
  const [reports, stableReviewRows, stableSummaryRows] = await Promise.all([
    Promise.all(bizDates.map((bizDate) => loadDailyReport(bizDate))),
    reviewWindowEndBizDate && params.runtime.listStoreReview7dByDateRange
      ? params.runtime.listStoreReview7dByDateRange({
          orgId: params.orgId,
          startBizDate: reviewWindowEndBizDate,
          endBizDate: reviewWindowEndBizDate,
        })
      : Promise.resolve([] as StoreReview7dRow[]),
    summaryWindowEndBizDate && params.runtime.listStoreSummary30dByDateRange
      ? params.runtime.listStoreSummary30dByDateRange({
          orgId: params.orgId,
          startBizDate: summaryWindowEndBizDate,
          endBizDate: summaryWindowEndBizDate,
        })
      : Promise.resolve([] as StoreSummary30dRow[]),
  ]);
  const storeName = reports[reports.length - 1]?.storeName ?? params.orgId;
  const baseMetrics = summarizeReportsWindow({
    orgId: params.orgId,
    storeName,
    frame: params.frame,
    reports,
  });
  const stableReviewRow =
    stableReviewRows.find((entry) => entry.windowEndBizDate === reviewWindowEndBizDate) ??
    stableReviewRows[0];
  const stableSummaryRow =
    stableSummaryRows.find((entry) => entry.windowEndBizDate === summaryWindowEndBizDate) ??
    stableSummaryRows[0];
  return {
    orgId: params.orgId,
    storeName,
    frame: params.frame,
    reports,
    metrics: stableSummaryRow
      ? applyStoreSummary30dRow(baseMetrics, stableSummaryRow)
      : stableReviewRow
        ? applyStoreReview7dRow(baseMetrics, stableReviewRow)
        : baseMetrics,
    complete: reports.every((entry) => entry.complete),
  };
}

async function loadReportsForFrame(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  frame: HetangQueryTimeFrame;
  now: Date;
}): Promise<DailyStoreReport[] | null> {
  const bizDates = enumerateBizDates(params.frame);
  if (params.runtime.listStoreManagerDailyKpiByDateRange) {
    const rows = await params.runtime.listStoreManagerDailyKpiByDateRange({
      orgId: params.orgId,
      startBizDate: bizDates[0] ?? "",
      endBizDate: bizDates[bizDates.length - 1] ?? "",
    });
    const rowByDate = new Map(rows.map((row) => [row.bizDate, row]));
    if (bizDates.every((bizDate) => rowByDate.has(bizDate))) {
      return bizDates.map((bizDate) => buildLightweightReportFromDailyKpiRow(rowByDate.get(bizDate)!));
    }
  }

  const reports = await Promise.all(
    bizDates.map((bizDate) =>
      loadSingleDayReport({
        runtime: params.runtime,
        orgId: params.orgId,
        bizDate,
        now: params.now,
      }),
    ),
  );
  return reports.every((report) => !!report) ? (reports as DailyStoreReport[]) : null;
}

function summarizeStoreReports(params: {
  orgId: string;
  frame: HetangQueryTimeFrame;
  reports: DailyStoreReport[];
}): DailyStoreMetrics {
  const lastReport = params.reports[params.reports.length - 1];
  const lastMetrics = lastReport?.metrics;
  const storeName = lastReport?.storeName ?? params.orgId;
  const sum = (selector: (report: DailyStoreReport) => number) =>
    round(params.reports.reduce((total, report) => total + selector(report), 0), 4);
  const avg = (selector: (report: DailyStoreReport) => number) =>
    round(sum(selector) / Math.max(params.reports.length, 1), 2);
  const totalClockCount = sum((report) => report.metrics.totalClockCount ?? 0);
  const serviceRevenue = sum((report) => report.metrics.serviceRevenue ?? 0);

  return {
    ...(lastMetrics ?? buildLightweightMetricsFromDailyKpiRow({
      bizDate: params.frame.kind === "single" ? params.frame.bizDate : params.frame.endBizDate,
      orgId: params.orgId,
      storeName,
      dailyActualRevenue: 0,
      dailyCardConsume: 0,
      dailyOrderCount: 0,
      totalClocks: 0,
      assignClocks: 0,
      queueClocks: 0,
      pointClockRate: null,
      averageTicket: 0,
      clockEffect: 0,
    } as StoreManagerDailyKpiRow)),
    orgId: params.orgId,
    storeName,
    bizDate: params.frame.kind === "single" ? params.frame.bizDate : params.frame.endBizDate,
    serviceRevenue,
    totalClockCount,
    clockEffect: totalClockCount > 0 ? round(serviceRevenue / totalClockCount, 2) : 0,
    activeTechCount: avg((report) => report.metrics.activeTechCount ?? 0),
    incompleteSync: params.reports.some(
      (report) => report.complete === false || report.metrics?.incompleteSync,
    ),
    unavailableMetrics: Array.from(
      new Set(params.reports.flatMap((report) => report.metrics?.unavailableMetrics ?? [])),
    ),
  };
}

function canAnswerWithSingleDayDailyKpi(intent: HetangQueryIntent): boolean {
  if (intent.timeFrame.kind !== "single") {
    return false;
  }
  const resolution = resolveMetricResolution(intent);
  return (
    resolution.supported.length > 0 &&
    resolution.supported.every((metric) => LIGHTWEIGHT_DAILY_KPI_METRICS.has(metric.key))
  );
}

function canAnswerWithLightweightTimelineMetric(intent: HetangQueryIntent): boolean {
  return LIGHTWEIGHT_DAILY_KPI_METRICS.has(pickPrimaryMetric(intent).key);
}

export function wantsExplicitDailyMetricBreakdown(intent: HetangQueryIntent): boolean {
  return (
    intent.kind === "metric" &&
    intent.timeFrame.kind === "range" &&
    !intent.allStoresRequested &&
    intent.explicitOrgIds.length <= 1 &&
    /(每天|每一天|每日|逐天|按天|分天)/u.test(intent.rawText)
  );
}

export function shouldAutoShowShortWindowDailyMetricBreakdown(intent: HetangQueryIntent): boolean {
  return (
    intent.kind === "metric" &&
    intent.timeFrame.kind === "range" &&
    intent.timeFrame.days <= 3 &&
    !intent.allStoresRequested &&
    intent.explicitOrgIds.length <= 1 &&
    intent.metrics.length > 0 &&
    intent.metrics.every((metric) => SHORT_WINDOW_AUTO_DAILY_BREAKDOWN_METRICS.has(metric.key))
  );
}

export function shouldShowDailyMetricBreakdown(intent: HetangQueryIntent): boolean {
  return (
    wantsExplicitDailyMetricBreakdown(intent) ||
    shouldAutoShowShortWindowDailyMetricBreakdown(intent)
  );
}

function classifyMarketCategory(row: TechMarketRecord): "tea" | "meal" | "oil" | "addon" | "service" {
  const itemName = row.itemName ?? "";
  const itemTypeName = row.itemTypeName ?? "";
  if (/(茶|饮|奶|咖啡|可乐|雪碧|椰汁|红牛|果汁|苏打)/u.test(itemName) || /饮/u.test(itemTypeName)) {
    return "tea";
  }
  if (
    /(饭|面|粉|粥|饺|馄饨|小吃|炒饭|米线|套餐|夜宵)/u.test(itemName) ||
    /(餐|食品|小吃)/u.test(itemTypeName)
  ) {
    return "meal";
  }
  if (/精油|油/u.test(itemName)) {
    return "oil";
  }
  if (
    row.itemCategory === 1 ||
    row.itemCategory === 2 ||
    /(足浴类|按摩类|理疗类|明星类|实力类|线上)/u.test(itemTypeName) ||
    /(足道|足疗|spa|加钟|按摩|护理|洗面)/iu.test(itemName)
  ) {
    return "service";
  }
  return "addon";
}

function resolveMarketBreakdownFocus(text: string): "all" | "tea" | "meal" | "oil" {
  if (/(茶饮|饮品|茶)/u.test(text)) {
    return "tea";
  }
  if (/(餐食|小吃|餐品|夜宵)/u.test(text)) {
    return "meal";
  }
  if (/精油/u.test(text)) {
    return "oil";
  }
  return "all";
}

async function renderStoreMarketBreakdownRuntimeText(params: {
  runtime: StoreQueryRuntime;
  config: HetangOpsConfig;
  orgId: string;
  intent: HetangQueryIntent;
}): Promise<string> {
  if (!params.runtime.listTechMarketByDateRange) {
    return "当前环境还未接通副项销售明细查询能力。";
  }

  const frame =
    params.intent.timeFrame.kind === "single"
      ? {
          startBizDate: params.intent.timeFrame.bizDate,
          endBizDate: params.intent.timeFrame.bizDate,
          label: params.intent.timeFrame.bizDate,
        }
      : {
          startBizDate: params.intent.timeFrame.startBizDate,
          endBizDate: params.intent.timeFrame.endBizDate,
          label: params.intent.timeFrame.label,
        };
  const storeName = getStoreName(params.config, params.orgId);
  const focus = resolveMarketBreakdownFocus(params.intent.rawText);

  const rows = await params.runtime.listTechMarketByDateRange({
    orgId: params.orgId,
    startBizDate: frame.startBizDate,
    endBizDate: frame.endBizDate,
  });

  const filtered = rows.filter((row) => {
    const category = classifyMarketCategory(row);
    if (category === "service") {
      return false;
    }
    if (focus === "all") {
      return true;
    }
    return category === focus;
  });

  const titlePrefix =
    focus === "tea" ? "茶饮销售明细" : focus === "meal" ? "餐食销售明细" : focus === "oil" ? "精油销售明细" : "副项销售明细";
  const header = `${storeName} ${frame.label} ${titlePrefix}`;
  if (filtered.length === 0) {
    return `${header}\n- 当前没有识别到对应的独立销售记录。`;
  }

  const itemMap = new Map<string, { count: number; amount: number }>();
  const techMap = new Map<string, { count: number; amount: number }>();
  let totalAmount = 0;
  let totalCount = 0;

  for (const row of filtered) {
    const itemKey = row.itemName?.trim() || row.itemTypeName?.trim() || "未识别项目";
    const techKey = row.personName?.trim() || "未识别技师";
    const count = Math.max(1, Math.round(row.count));
    totalCount += count;
    totalAmount = round(totalAmount + row.afterDisc);

    const itemEntry = itemMap.get(itemKey) ?? { count: 0, amount: 0 };
    itemEntry.count += count;
    itemEntry.amount = round(itemEntry.amount + row.afterDisc);
    itemMap.set(itemKey, itemEntry);

    const techEntry = techMap.get(techKey) ?? { count: 0, amount: 0 };
    techEntry.count += count;
    techEntry.amount = round(techEntry.amount + row.afterDisc);
    techMap.set(techKey, techEntry);
  }

  const items = Array.from(itemMap.entries())
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.amount - left.amount || right.count - left.count || left.name.localeCompare(right.name));
  const techs = Array.from(techMap.entries())
    .map(([name, value]) => ({ name, ...value }))
    .sort((left, right) => right.amount - left.amount || right.count - left.count || left.name.localeCompare(right.name));

  const lines = [
    header,
    `- 总副项营收 ${round(totalAmount, 2).toFixed(2)} 元，共 ${totalCount} 单`,
    `- 项目明细: ${items.slice(0, 5).map((item) => `${item.name} ${item.count} 单 ${item.amount.toFixed(2)} 元`).join("；")}`,
    `- 技师承接: ${techs.slice(0, 5).map((tech) => `${tech.name} ${tech.count} 单 ${tech.amount.toFixed(2)} 元`).join("；")}`,
  ];
  return lines.join("\n");
}

async function renderStoreMetricSummaryRuntimeText(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  const resolution = resolveMetricResolution(params.intent);
  if (canAnswerWithSingleDayDailyKpi(params.intent)) {
    const row = await loadSingleDayDailyKpiRow({
      runtime: params.runtime,
      orgId: params.orgId,
      bizDate: params.intent.timeFrame.kind === "single" ? params.intent.timeFrame.bizDate : "",
    });
    if (row) {
      const report = buildLightweightReportFromDailyKpiRow(row);
      return renderMetricQueryResponse({
        storeName: row.storeName,
        bizDate: row.bizDate,
        metrics: report.metrics,
        complete: report.complete,
        resolution,
        dailyReports: [report],
        showDailyBreakdown: shouldShowDailyMetricBreakdown(params.intent),
      });
    }
  }

  const summary = await collectStoreWindowSummary({
    runtime: params.runtime,
    orgId: params.orgId,
    frame: params.intent.timeFrame,
    now: params.now,
    requestedMetrics: params.intent.metrics.map((metric) => metric.key),
  });
  return renderMetricQueryResponse({
    storeName: summary.storeName,
    bizDate:
      params.intent.timeFrame.kind === "single"
        ? params.intent.timeFrame.bizDate
        : params.intent.timeFrame.label,
    metrics: summary.metrics,
    complete: summary.complete,
    resolution,
    dailyReports: summary.reports,
    showDailyBreakdown: shouldShowDailyMetricBreakdown(params.intent),
  });
}

async function renderStoreCompareRuntimeText(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  orgIds?: string[];
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  const compareMetric = pickPrimaryMetric(params.intent);
  if (canAnswerWithSingleDayDailyKpi(params.intent) && LIGHTWEIGHT_DAILY_KPI_METRICS.has(compareMetric.key)) {
    if (params.intent.explicitOrgIds.length >= 2) {
      const [leftOrgId, rightOrgId] = params.intent.explicitOrgIds;
      if (!leftOrgId || !rightOrgId) {
        return null;
      }
      const [leftRow, rightRow] = await Promise.all([
        loadSingleDayDailyKpiRow({
          runtime: params.runtime,
          orgId: leftOrgId,
          bizDate: params.intent.timeFrame.kind === "single" ? params.intent.timeFrame.bizDate : "",
        }),
        loadSingleDayDailyKpiRow({
          runtime: params.runtime,
          orgId: rightOrgId,
          bizDate: params.intent.timeFrame.kind === "single" ? params.intent.timeFrame.bizDate : "",
        }),
      ]);
      if (leftRow && rightRow) {
        return renderCompareText({
          left: {
            orgId: leftRow.orgId,
            storeName: leftRow.storeName,
            frame: params.intent.timeFrame,
            reports: [buildLightweightReportFromDailyKpiRow(leftRow)],
            metrics: buildLightweightMetricsFromDailyKpiRow(leftRow),
            complete: true,
          },
          right: {
            orgId: rightRow.orgId,
            storeName: rightRow.storeName,
            frame: params.intent.timeFrame,
            reports: [buildLightweightReportFromDailyKpiRow(rightRow)],
            metrics: buildLightweightMetricsFromDailyKpiRow(rightRow),
            complete: true,
          },
          intent: params.intent,
        });
      }
    }

    if (params.intent.comparisonTimeFrame?.kind === "single") {
      const [currentRow, previousRow] = await Promise.all([
        loadSingleDayDailyKpiRow({
          runtime: params.runtime,
          orgId: params.orgId,
          bizDate: params.intent.timeFrame.kind === "single" ? params.intent.timeFrame.bizDate : "",
        }),
        loadSingleDayDailyKpiRow({
          runtime: params.runtime,
          orgId: params.orgId,
          bizDate: params.intent.comparisonTimeFrame.bizDate,
        }),
      ]);
      if (currentRow && previousRow) {
        return renderCompareText({
          left: {
            orgId: currentRow.orgId,
            storeName: currentRow.storeName,
            frame: params.intent.timeFrame,
            reports: [buildLightweightReportFromDailyKpiRow(currentRow)],
            metrics: buildLightweightMetricsFromDailyKpiRow(currentRow),
            complete: true,
          },
          right: {
            orgId: previousRow.orgId,
            storeName: previousRow.storeName,
            frame: params.intent.comparisonTimeFrame,
            reports: [buildLightweightReportFromDailyKpiRow(previousRow)],
            metrics: buildLightweightMetricsFromDailyKpiRow(previousRow),
            complete: true,
          },
          intent: params.intent,
        });
      }
    }
  }

  const explicitOrgIds =
    params.intent.explicitOrgIds.length >= 2
      ? params.intent.explicitOrgIds
      : (params.orgIds ?? []).slice(0, 2);
  if (explicitOrgIds.length >= 2) {
    const [leftOrgId, rightOrgId] = explicitOrgIds;
    if (!leftOrgId || !rightOrgId) {
      return null;
    }
    const [left, right] = await Promise.all([
      collectStoreWindowSummary({
        runtime: params.runtime,
        orgId: leftOrgId,
        frame: params.intent.timeFrame,
        now: params.now,
        requestedMetrics: [compareMetric.key],
      }),
      collectStoreWindowSummary({
        runtime: params.runtime,
        orgId: rightOrgId,
        frame: params.intent.timeFrame,
        now: params.now,
        requestedMetrics: [compareMetric.key],
      }),
    ]);
    return renderCompareText({
      left,
      right,
      intent: params.intent,
    });
  }

  const [current, previous] = await Promise.all([
    collectStoreWindowSummary({
      runtime: params.runtime,
      orgId: params.orgId,
      frame: params.intent.timeFrame,
      now: params.now,
      requestedMetrics: [compareMetric.key],
    }),
    collectStoreWindowSummary({
      runtime: params.runtime,
      orgId: params.orgId,
      frame: params.intent.comparisonTimeFrame ?? resolvePreviousComparableFrame(params.intent.timeFrame),
      now: params.now,
      requestedMetrics: [compareMetric.key],
    }),
  ]);
  return renderCompareText({
    left: current,
    right: previous,
    intent: params.intent,
  });
}

function resolveTrendFrame(intent: HetangQueryIntent): HetangQueryTimeFrame {
  if (intent.timeFrame.kind === "range") {
    return intent.timeFrame;
  }
  return {
    kind: "range",
    startBizDate: shiftBizDate(intent.timeFrame.bizDate, -6),
    endBizDate: intent.timeFrame.bizDate,
    label: "近7天",
    days: 7,
  };
}

function resolveAnomalyComparisonFrame(intent: HetangQueryIntent): HetangQueryTimeFrame {
  if (intent.comparisonTimeFrame) {
    return intent.comparisonTimeFrame;
  }
  return {
    kind: "single",
    bizDate: shiftBizDate(
      intent.timeFrame.kind === "single" ? intent.timeFrame.bizDate : intent.timeFrame.endBizDate,
      -1,
    ),
    label: "对比期",
    days: 1,
  };
}

async function renderStoreTrendRuntimeText(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  const frame = resolveTrendFrame(params.intent);
  const summary = await collectStoreWindowSummary({
    runtime: params.runtime,
    orgId: params.orgId,
    frame,
    now: params.now,
    requestedMetrics: [pickPrimaryMetric(params.intent).key],
  });
  return renderTrendText({
    summary,
    metric: pickPrimaryMetric(params.intent),
  });
}

async function renderStoreAnomalyRuntimeText(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  const currentFrame = params.intent.timeFrame;
  const previousFrame = resolveAnomalyComparisonFrame(params.intent);
  const [current, previous] = await Promise.all([
    collectStoreWindowSummary({
      runtime: params.runtime,
      orgId: params.orgId,
      frame: currentFrame,
      now: params.now,
      requestedMetrics: [pickPrimaryMetric(params.intent).key],
    }),
    collectStoreWindowSummary({
      runtime: params.runtime,
      orgId: params.orgId,
      frame: previousFrame,
      now: params.now,
      requestedMetrics: [pickPrimaryMetric(params.intent).key],
    }),
  ]);
  return renderAnomalyText({
    current,
    previous,
    metric: pickPrimaryMetric(params.intent),
  });
}

export async function renderStoreClockBreakdownRuntimeText(params: {
  runtime: StoreQueryRuntime;
  config?: HetangOpsConfig;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  if (params.intent.timeFrame.kind !== "single") {
    return null;
  }
  const bizDate = params.intent.timeFrame.bizDate;
  const report = await loadSingleDayReport({
    runtime: params.runtime,
    orgId: params.orgId,
    bizDate,
    now: params.now,
  });
  if (!report) {
    return null;
  }
  const dailyKpiRow = await loadSingleDayDailyKpiRow({
    runtime: params.runtime,
    orgId: params.orgId,
    bizDate,
  });

  const storeName =
    report.storeName || (params.config ? getStoreName(params.config, params.orgId) : params.orgId);
  const lines = [`${storeName} ${bizDate} 钟数构成`];
  if (!report.complete || report.metrics?.incompleteSync) {
    lines.push("注意：当前营业日同步尚未完全收口，以下钟数构成仅供参考。");
  }
  lines.push(`- 总钟数: ${formatCount(report.metrics.totalClockCount)} 个`);

  const hasReliableDailyKpiBreakdown =
    !!dailyKpiRow && dailyKpiRow.assignClocks + dailyKpiRow.queueClocks > 0;
  const hasReliableRawBreakdown =
    (report.metrics.upClockRecordCount ?? 0) > 0 &&
    (report.metrics.upClockRecordCount ?? 0) >=
      (report.metrics.pointClockRecordCount ?? 0) + (report.metrics.addClockRecordCount ?? 0);

  if (hasReliableDailyKpiBreakdown && dailyKpiRow) {
    lines.push(`- 点钟: ${formatCount(dailyKpiRow.assignClocks)} 个`);
    lines.push(`- 排钟: ${formatCount(dailyKpiRow.queueClocks)} 个`);
  } else if (hasReliableRawBreakdown) {
    const baseClockCount = Math.max(
      (report.metrics.upClockRecordCount ?? 0) - (report.metrics.addClockRecordCount ?? 0),
      0,
    );
    const queueLikeClockCount = Math.max(
      baseClockCount - (report.metrics.pointClockRecordCount ?? 0),
      0,
    );
    lines.push(`- 点钟: ${formatCount(report.metrics.pointClockRecordCount ?? 0)} 个`);
    lines.push(`- 排钟: ${formatCount(queueLikeClockCount)} 个`);
  } else {
    lines.push(
      `- 当前库里只能稳定确认加钟 ${formatCount(report.metrics.addClockRecordCount ?? 0)} 个，点钟 / 排钟拆分口径今天还不完整。`,
    );
  }

  if (hasReliableDailyKpiBreakdown || hasReliableRawBreakdown) {
    lines.push(`- 加钟: ${formatCount(report.metrics.addClockRecordCount ?? 0)} 个`);
  }
  lines.push(
    "注：当前可稳定拆到点钟 / 排钟 / 加钟；主项 / 采耳 / 小项 / SPA 这类更细结构还要依赖原始钟单明细。",
  );
  return lines.join("\n");
}

export async function renderStoreReportRuntimeText(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  if (shouldUseSingleDayDailyKpiFastPath(params.intent) && params.intent.timeFrame.kind === "single") {
    const row = await loadSingleDayDailyKpiRow({
      runtime: params.runtime,
      orgId: params.orgId,
      bizDate: params.intent.timeFrame.bizDate,
    });
    if (row) {
      return renderSingleDayDailyKpiText(row);
    }
  }

  const [summary, comparisonSummary] = await Promise.all([
    collectStoreWindowSummary({
      runtime: params.runtime,
      orgId: params.orgId,
      frame: params.intent.timeFrame,
      now: params.now,
    }),
    params.intent.timeFrame.kind === "range"
      ? collectStoreWindowSummary({
          runtime: params.runtime,
          orgId: params.orgId,
          frame: resolvePreviousComparableFrame(params.intent.timeFrame),
          now: params.now,
        })
      : Promise.resolve(undefined),
  ]);
  return renderWindowReportText(summary, comparisonSummary);
}

async function renderStoreRiskAdviceRuntimeText(params: {
  runtime: StoreQueryRuntime;
  config: HetangOpsConfig;
  orgId: string;
  orgIds?: string[];
  intent: HetangQueryIntent;
  now: Date;
  analysis?: QueryAnalysisLens;
}): Promise<string | null> {
  const orgIds = params.orgIds ?? [params.orgId];
  if (orgIds.length > 1) {
    const entries = (
      await Promise.all(
        orgIds.map(async (orgId) =>
          buildPortfolioRiskEntry(
            await collectStoreWindowSummary({
              runtime: params.runtime,
              orgId,
              frame: params.intent.timeFrame,
              now: params.now,
            }),
          ),
        ),
      )
    ).sort((left, right) => right.score - left.score);
    return renderPortfolioRiskText({
      label: params.intent.allStoresRequested ? `${orgIds.length}店` : "已授权门店",
      entries,
      intent: params.intent,
    });
  }

  const tradeoffText = await renderStorePriorityTradeoffRuntimeText({
    runtime: params.runtime,
    orgId: params.orgId,
    intent: params.intent,
    now: params.now,
  });
  if (tradeoffText) {
    return tradeoffText;
  }

  const summary = await collectStoreWindowSummary({
    runtime: params.runtime,
    orgId: params.orgId,
    frame: params.intent.timeFrame,
    now: params.now,
  });
  const anchorBizDate = resolveStableAnchorBizDate(params.intent.timeFrame);
  const environmentContext =
    (await params.runtime.getStoreEnvironmentMemory?.({
      orgId: params.orgId,
      bizDate: anchorBizDate,
    })) ??
    {
      ...buildStoreEnvironmentContextSnapshot({
        bizDate: anchorBizDate,
        storeConfig: params.config.stores.find((entry) => entry.orgId === params.orgId),
      }),
      narrativePolicy: undefined,
    };
  const externalContextEntries =
    (await params.runtime.listStoreExternalContextEntries?.({
      orgId: params.orgId,
    })) ?? [];
  const customerOperatingProfiles =
    (await params.runtime.listCustomerOperatingProfilesDaily?.({
      orgId: params.orgId,
      bizDate: anchorBizDate,
    })) ?? [];
  const storeExternalContext = assembleStoreExternalContextForAi({
    orgId: params.orgId,
    entries: externalContextEntries,
    module: "store_advice",
  });
  const worldModelSupplement = renderStoreAdviceWorldModelSupplement({
    orgId: params.orgId,
    bizDate: anchorBizDate,
    environmentContext,
    externalContextEntries,
    customerOperatingProfiles,
  });
  return renderRiskAdviceText({
    summary,
    intent: params.intent,
    analysis: params.analysis,
    environmentContext,
    storeExternalContext,
    worldModelSupplement,
  });
}

function applyTradeoffSummaryMetrics(
  base: DailyStoreMetrics,
  summary: StoreSummary30dRow | undefined,
): DailyStoreMetrics {
  if (!summary) {
    return base;
  }
  return {
    ...base,
    orgId: summary.orgId,
    storeName: summary.storeName,
    bizDate: summary.windowEndBizDate,
    sleepingMembers: summary.sleepingMembers,
    sleepingMemberRate: summary.sleepingMemberRate,
    currentStoredBalance: summary.currentStoredBalance ?? base.currentStoredBalance,
    storedBalanceLifeMonths: summary.storedBalanceLifeMonths ?? base.storedBalanceLifeMonths,
    renewalPressureIndex30d: summary.renewalPressureIndex30d ?? base.renewalPressureIndex30d,
    memberRepurchaseBaseCustomerCount7d:
      summary.memberRepurchaseBaseCustomerCount7d ?? base.memberRepurchaseBaseCustomerCount7d,
    memberRepurchaseReturnedCustomerCount7d:
      summary.memberRepurchaseReturnedCustomerCount7d ??
      base.memberRepurchaseReturnedCustomerCount7d,
    memberRepurchaseRate7d: summary.memberRepurchaseRate7d ?? base.memberRepurchaseRate7d,
  };
}

export async function renderStorePriorityTradeoffRuntimeText(params: {
  runtime: StoreQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
  analysis?: QueryAnalysisLens;
}): Promise<string | null> {
  if (!isStorePriorityTradeoffAsk(params.intent.rawText) || !params.runtime.buildReport) {
    return null;
  }

  const anchorBizDate = resolveStableAnchorBizDate(params.intent.timeFrame);
  const previousAnchorBizDate = shiftBizDate(anchorBizDate, -30);
  const [report, currentSummaryRows, previousSummaryRows] = await Promise.all([
    params.runtime.buildReport({
      orgId: params.orgId,
      bizDate: anchorBizDate,
      now: params.now,
    }),
    params.runtime.listStoreSummary30dByDateRange
      ? params.runtime.listStoreSummary30dByDateRange({
          orgId: params.orgId,
          startBizDate: anchorBizDate,
          endBizDate: anchorBizDate,
        })
      : Promise.resolve([] as StoreSummary30dRow[]),
    params.runtime.listStoreSummary30dByDateRange
      ? params.runtime.listStoreSummary30dByDateRange({
          orgId: params.orgId,
          startBizDate: previousAnchorBizDate,
          endBizDate: previousAnchorBizDate,
        })
      : Promise.resolve([] as StoreSummary30dRow[]),
  ]);

  const currentSummary =
    currentSummaryRows.find((entry) => entry.windowEndBizDate === anchorBizDate) ??
    currentSummaryRows[0];
  const previousSummary =
    previousSummaryRows.find((entry) => entry.windowEndBizDate === previousAnchorBizDate) ??
    previousSummaryRows[0];

  return renderStorePriorityTradeoffText({
    storeName: report.storeName,
    metrics: applyTradeoffSummaryMetrics(report.metrics, currentSummary),
    previousMetrics: previousSummary
      ? applyTradeoffSummaryMetrics(report.metrics, previousSummary)
      : undefined,
  });
}

async function renderStoreRankingRuntimeText(params: {
  runtime: StoreQueryRuntime;
  orgIds: string[];
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  if (params.orgIds.length === 0) {
    return null;
  }
  const frame = params.intent.timeFrame;
  const metric = pickPrimaryMetric(params.intent);
  const rows = await Promise.all(
    params.orgIds.map(async (orgId) => {
      return await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame,
        now: params.now,
        requestedMetrics: [metric.key],
      });
    }),
  );
  const summaries = rows.filter((row): row is NonNullable<typeof row> => !!row);
  if (summaries.length === 0) {
    return null;
  }
  const sorted = [...summaries].sort((left, right) => {
    const leftNumeric = getMetricNumericValue(metric, left.metrics) ?? Number.NEGATIVE_INFINITY;
    const rightNumeric = getMetricNumericValue(metric, right.metrics) ?? Number.NEGATIVE_INFINITY;
    return params.intent.rankingOrder === "asc" ? leftNumeric - rightNumeric : rightNumeric - leftNumeric;
  });
  return renderStoreRankingText({
    label: params.intent.allStoresRequested ? `${sorted.length}店` : "已授权门店",
    metric,
    rows: sorted,
  });
}

export async function renderHqPortfolioRuntimeText(params: {
  capabilityId: "hq_portfolio_overview_v1" | "hq_portfolio_focus_v1" | "hq_portfolio_risk_v1";
  runtime: StoreQueryRuntime;
  orgIds: string[];
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  if (params.intent.kind !== "hq_portfolio" || params.orgIds.length === 0) {
    return null;
  }

  const comparisonFrame = resolvePreviousComparableFrame(params.intent.timeFrame);
  const entries = await Promise.all(
    params.orgIds.map(async (orgId) => {
      const [summary, comparisonSummary] = await Promise.all([
        collectStoreWindowSummary({
          runtime: params.runtime,
          orgId,
          frame: params.intent.timeFrame,
          now: params.now,
        }),
        collectStoreWindowSummary({
          runtime: params.runtime,
          orgId,
          frame: comparisonFrame,
          now: params.now,
        }),
      ]);
      return buildStorePerformanceEntry(summary, comparisonSummary);
    }),
  );

  const label = params.intent.allStoresRequested ? `${params.orgIds.length}店` : "已授权门店";

  if (params.capabilityId === "hq_portfolio_risk_v1") {
    const riskEntries = entries
      .map((entry) => entry.riskEntry)
      .sort((left, right) => right.score - left.score);
    return renderPortfolioRiskText({
      label,
      entries: riskEntries,
      intent: {
        ...params.intent,
        mentionsAdviceKeyword: true,
      },
    });
  }

  if (params.capabilityId === "hq_portfolio_focus_v1") {
    return renderHqPortfolioFocusText({
      label,
      entries,
      intent: params.intent,
    });
  }

  return renderHqPortfolioText({
    label,
    entries,
    intent: params.intent,
  });
}

export async function executeStoreRuntimeQuery(params: {
  capabilityId: StoreRuntimeCapabilityId;
  runtime: StoreQueryRuntime;
  config: HetangOpsConfig;
  orgId: string;
  orgIds?: string[];
  intent: HetangQueryIntent;
  now: Date;
  analysis?: QueryAnalysisLens;
}): Promise<string | null> {
  switch (params.capabilityId) {
    case "store_report_v1":
      return await renderStoreReportRuntimeText(params);
    case "store_metric_summary_v1":
      return await renderStoreMetricSummaryRuntimeText(params);
    case "store_compare_v1":
      return await renderStoreCompareRuntimeText(params);
    case "hq_portfolio_overview_v1":
    case "hq_portfolio_focus_v1":
    case "hq_portfolio_risk_v1":
      return await renderHqPortfolioRuntimeText({
        capabilityId: params.capabilityId,
        runtime: params.runtime,
        orgIds: params.orgIds ?? [params.orgId],
        intent: params.intent,
        now: params.now,
      });
    case "store_trend_v1":
      return await renderStoreTrendRuntimeText(params);
    case "store_anomaly_v1":
      return await renderStoreAnomalyRuntimeText(params);
    case "store_ranking_v1":
      return await renderStoreRankingRuntimeText({
        runtime: params.runtime,
        orgIds: params.orgIds ?? [params.orgId],
        intent: params.intent,
        now: params.now,
      });
    case "store_metric_breakdown_runtime_v1":
      return await renderStoreClockBreakdownRuntimeText(params);
    case "store_market_breakdown_v1":
      return await renderStoreMarketBreakdownRuntimeText({
        runtime: params.runtime,
        config: params.config,
        orgId: params.orgId,
        intent: params.intent,
      });
    case "store_risk_v1":
    case "store_advice_v1":
      return await renderStoreRiskAdviceRuntimeText({
        runtime: params.runtime,
        config: params.config,
        orgId: params.orgId,
        orgIds: params.orgIds,
        intent: params.intent,
        now: params.now,
        analysis: params.analysis,
      });
    default:
      return null;
  }
}
