import {
  isRuntimeRenderCapabilityNode,
  isServingCapabilityNode,
  resolveCapabilityGraphSelection,
} from "./capability-graph.js";
import { executeArrivalProfileQuery } from "./arrival-profile-query.js";
import { executeBirthdayMemberQuery } from "./birthday-query.js";
import { executePhoneSuffixCustomerProfileQuery } from "./customer-profile.js";
import { executeCustomerQuery } from "./customer-query.js";
import { executeMemberMarketingQuery } from "./member-marketing-query.js";
import { buildQueryPlanFromIntent } from "./query-plan.js";
import type { HetangQueryIntent, HetangQueryTimeFrame } from "./query-intent.js";
import {
  buildStorePerformanceEntry,
  buildPortfolioRiskEntry,
  formatCount,
  pickPrimaryMetric,
  renderCompareText,
  renderAnomalyText,
  renderHqPortfolioText,
  renderPortfolioRiskText,
  renderRiskAdviceText,
  renderServingQueryResult,
  renderSingleDayDailyKpiText,
  renderStoreRankingText,
  renderStorePriorityTradeoffText,
  renderTechRankingText,
  renderTrendText,
  renderWindowReportText,
  resolveMetricResolution,
  resolveTechMetricScore,
  shouldUseSingleDayDailyKpiFastPath,
  round,
} from "./query-engine-renderer.js";
import {
  getStoreName,
  resolveAccessScopeKind,
} from "./query-engine-router.js";
import { executeRechargeAttributionQuery } from "./recharge-attribution-query.js";
import { compileServingQuery } from "./sql-compiler.js";
import { executeTechProfileQuery } from "./tech-profile.js";
import { shiftBizDate } from "./time.js";
import {
  getMetricNumericValue,
  renderMetricQueryResponse,
} from "./metric-query.js";
import type {
  ConsumeBillRecord,
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  DailyStoreMetrics,
  DailyStoreReport,
  HetangEmployeeBinding,
  HetangOpsConfig,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  MemberReactivationQueueRecord,
  RechargeBillRecord,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechLeaderboardRow,
  TechMarketRecord,
  TechProfile30dRow,
  TechUpClockRecord,
} from "./types.js";
import { executeWaitExperienceQuery } from "./wait-experience-query.js";

export type HetangQueryRuntime = {
  buildReport: (params: {
    orgId: string;
    bizDate?: string;
    now?: Date;
  }) => Promise<DailyStoreReport>;
  listTechLeaderboard?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechLeaderboardRow[]>;
  listCustomerTechLinks?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listCustomerTechLinksByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listCustomerSegments?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
  listCustomerProfile90dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerProfile90dRow[]>;
  getDailyReportSnapshot?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<DailyStoreReport | null>;
  listMemberReactivationQueue?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationQueueRecord[]>;
  listStoreManagerDailyKpiByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreManagerDailyKpiRow[]>;
  listTechProfile30dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechProfile30dRow[]>;
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
  findCurrentMembersByPhoneSuffix?: (params: {
    orgId: string;
    phoneSuffix: string;
  }) => Promise<MemberCurrentRecord[]>;
  listCurrentMemberCards?: (params: { orgId: string }) => Promise<MemberCardCurrentRecord[]>;
  listCurrentMembers?: (params: { orgId: string }) => Promise<MemberCurrentRecord[]>;
  listConsumeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<ConsumeBillRecord[]>;
  listRechargeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<RechargeBillRecord[]>;
  listTechUpClockByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechUpClockRecord[]>;
  listTechMarketByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechMarketRecord[]>;
  resolveSemanticFallbackIntent?: (params: {
    config: HetangOpsConfig;
    text: string;
    now: Date;
    binding: HetangEmployeeBinding;
    ruleIntent?: HetangQueryIntent | null;
  }) => Promise<{ intent?: HetangQueryIntent; clarificationText?: string } | null>;
  getCurrentServingVersion?: () => Promise<string>;
  executeCompiledServingQuery?: (params: {
    sql: string;
    queryParams?: unknown[];
    cacheKey?: string;
    ttlSeconds?: number;
  }) => Promise<Record<string, unknown>[]>;
};

export type StoreWindowSummary = {
  orgId: string;
  storeName: string;
  frame: HetangQueryTimeFrame;
  reports: DailyStoreReport[];
  metrics: DailyStoreMetrics;
  complete: boolean;
};

function isRecoverableServingQueryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(relation|view|materialized view)\s+".*"\s+does not exist/iu.test(message) ||
    /no such table/iu.test(message);
}

export async function tryExecuteServingQueryPlane(params: {
  runtime: HetangQueryRuntime;
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
}): Promise<string | null> {
  if (!params.runtime.getCurrentServingVersion || !params.runtime.executeCompiledServingQuery) {
    return null;
  }

  const plan = buildQueryPlanFromIntent({
    intent: params.intent,
    effectiveOrgIds: params.effectiveOrgIds,
    accessScopeKind: resolveAccessScopeKind(params.binding),
  });
  const selection = resolveCapabilityGraphSelection({
    plan,
    executionMode: "serving_sql",
  });
  const capability = selection.node;
  if (!capability || !isServingCapabilityNode(capability)) {
    return null;
  }
  const servingVersion = await params.runtime.getCurrentServingVersion();
  const compiled = compileServingQuery({
    plan,
    capability,
    servingVersion,
  });
  let rows: Record<string, unknown>[];
  try {
    rows = await params.runtime.executeCompiledServingQuery({
      sql: compiled.sql,
      queryParams: compiled.params,
      cacheKey: compiled.cache_key,
      ttlSeconds: compiled.cache_ttl_seconds,
    });
  } catch (error) {
    if (isRecoverableServingQueryError(error)) {
      return null;
    }
    throw error;
  }
  if (plan.entity === "customer_profile" && plan.action === "profile" && rows.length === 0) {
    return null;
  }
  return renderServingQueryResult({
    rows,
    plan,
    config: params.config,
  });
}

export async function tryExecuteRuntimeRenderQueryPlane(params: {
  runtime: HetangQueryRuntime;
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
  now: Date;
}): Promise<string | null> {
  const plan = buildQueryPlanFromIntent({
    intent: params.intent,
    effectiveOrgIds: params.effectiveOrgIds,
    accessScopeKind: resolveAccessScopeKind(params.binding),
  });
  const selection = resolveCapabilityGraphSelection({
    plan,
    executionMode: "runtime_render",
  });
  const capability = selection.node;
  if (!capability || !isRuntimeRenderCapabilityNode(capability)) {
    return null;
  }

  switch (capability.capability_id) {
    case "store_metric_summary_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      const summary = await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame: params.intent.timeFrame,
        now: params.now,
      });
      return renderMetricQueryResponse({
        storeName: summary.storeName,
        bizDate:
          params.intent.timeFrame.kind === "single"
            ? params.intent.timeFrame.bizDate
            : params.intent.timeFrame.label,
        metrics: summary.metrics,
        complete: summary.complete,
        resolution: resolveMetricResolution(params.intent),
        dailyReports: summary.reports,
      });
    }
    case "store_metric_breakdown_runtime_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      return renderTotalClockBreakdownText({
        runtime: params.runtime,
        orgId,
        intent: params.intent,
        now: params.now,
      });
    }
    case "store_compare_v1": {
      if (params.effectiveOrgIds.length >= 2) {
        const [leftOrgId, rightOrgId] = params.effectiveOrgIds;
        if (!leftOrgId || !rightOrgId) {
          return null;
        }
        const [left, right] = await Promise.all([
          collectStoreWindowSummary({
            runtime: params.runtime,
            orgId: leftOrgId,
            frame: params.intent.timeFrame,
            now: params.now,
          }),
          collectStoreWindowSummary({
            runtime: params.runtime,
            orgId: rightOrgId,
            frame: params.intent.timeFrame,
            now: params.now,
          }),
        ]);
        return renderCompareText({
          left,
          right,
          intent: params.intent,
        });
      }

      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      const current = await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame: params.intent.timeFrame,
        now: params.now,
      });
      const previous = await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame: params.intent.comparisonTimeFrame ?? resolvePreviousComparableFrame(params.intent.timeFrame),
        now: params.now,
      });
      return renderCompareText({
        left: current,
        right: previous,
        intent: params.intent,
      });
    }
    case "store_ranking_v1": {
      const metric = pickPrimaryMetric(params.intent);
      const summaries = await Promise.all(
        params.effectiveOrgIds.map((orgId) =>
          collectStoreWindowSummary({
            runtime: params.runtime,
            orgId,
            frame: params.intent.timeFrame,
            now: params.now,
          }),
        ),
      );
      const sorted = [...summaries].sort((left, right) => {
        const leftValue = getMetricNumericValue(metric, left.metrics) ?? Number.NEGATIVE_INFINITY;
        const rightValue = getMetricNumericValue(metric, right.metrics) ?? Number.NEGATIVE_INFINITY;
        return params.intent.rankingOrder === "asc" ? leftValue - rightValue : rightValue - leftValue;
      });
      return renderStoreRankingText({
        label: params.intent.allStoresRequested ? `${params.effectiveOrgIds.length}店` : "已授权门店",
        metric,
        rows: sorted,
      });
    }
    case "tech_leaderboard_ranking_v1": {
      if (!params.runtime.listTechLeaderboard) {
        return "当前环境还未接通技师排行榜查询能力。";
      }
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      const metric = pickPrimaryMetric(params.intent);
      const rows = await params.runtime.listTechLeaderboard({
        orgId,
        startBizDate:
          params.intent.timeFrame.kind === "single"
            ? params.intent.timeFrame.bizDate
            : params.intent.timeFrame.startBizDate,
        endBizDate:
          params.intent.timeFrame.kind === "single"
            ? params.intent.timeFrame.bizDate
            : params.intent.timeFrame.endBizDate,
      });
      const sorted = [...rows].sort((left, right) =>
        params.intent.rankingOrder === "asc"
          ? resolveTechMetricScore(metric, left) - resolveTechMetricScore(metric, right)
          : resolveTechMetricScore(metric, right) - resolveTechMetricScore(metric, left),
      );
      return renderTechRankingText({
        storeName: getStoreName(params.config, orgId),
        frame: params.intent.timeFrame,
        metric,
        rows: sorted,
      });
    }
    case "customer_segment_list_v1":
    case "customer_relation_lookup_v1":
      return executeCustomerQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
      });
    case "birthday_member_list_v1":
      return executeBirthdayMemberQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
        now: params.now,
      });
    case "member_marketing_analysis_v1":
      return executeMemberMarketingQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
        now: params.now,
      });
    case "customer_profile_runtime_lookup_v1":
      return executePhoneSuffixCustomerProfileQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
        now: params.now,
      });
    case "tech_profile_lookup_v1":
      return executeTechProfileQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
      });
    case "arrival_profile_timeseries_v1":
      return executeArrivalProfileQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
      });
    case "wait_experience_analysis_v1":
      return executeWaitExperienceQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
      });
    case "recharge_attribution_analysis_v1":
      return executeRechargeAttributionQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
      });
    case "store_report_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      const fastPathText = await tryRenderSingleDayDailyKpiFastPath({
        runtime: params.runtime,
        orgId,
        intent: params.intent,
      });
      if (fastPathText) {
        return fastPathText;
      }
      const [summary, comparisonSummary] = await Promise.all([
        collectStoreWindowSummary({
          runtime: params.runtime,
          orgId,
          frame: params.intent.timeFrame,
          now: params.now,
        }),
        params.intent.timeFrame.kind === "range"
          ? collectStoreWindowSummary({
              runtime: params.runtime,
              orgId,
              frame: resolvePreviousComparableFrame(params.intent.timeFrame),
              now: params.now,
            })
          : Promise.resolve(undefined),
      ]);
      return renderWindowReportText(summary, comparisonSummary);
    }
    case "store_trend_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      const frame =
        params.intent.timeFrame.kind === "range"
          ? params.intent.timeFrame
          : {
              kind: "range" as const,
              startBizDate: shiftBizDate(params.intent.timeFrame.bizDate, -6),
              endBizDate: params.intent.timeFrame.bizDate,
              label: "近7天",
              days: 7,
            };
      const summary = await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame,
        now: params.now,
      });
      return renderTrendText({
        summary,
        metric: pickPrimaryMetric(params.intent),
      });
    }
    case "store_anomaly_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      const current = await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame: params.intent.timeFrame,
        now: params.now,
      });
      const previous = await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame:
          params.intent.comparisonTimeFrame ?? {
            kind: "single",
            bizDate: shiftBizDate(
              params.intent.timeFrame.kind === "single"
                ? params.intent.timeFrame.bizDate
                : params.intent.timeFrame.endBizDate,
              -1,
            ),
            label: "对比期",
            days: 1,
          },
        now: params.now,
      });
      return renderAnomalyText({
        current,
        previous,
        metric: pickPrimaryMetric(params.intent),
      });
    }
    case "store_risk_v1":
    case "store_advice_v1": {
      if (params.effectiveOrgIds.length > 1) {
        const entries = (
          await Promise.all(
            params.effectiveOrgIds.map(async (orgId) =>
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
          label: params.intent.allStoresRequested
            ? `${params.effectiveOrgIds.length}店`
            : "已授权门店",
          entries,
          intent: params.intent,
        });
      }

      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      const tradeoffText = await tryRenderStorePriorityTradeoffText({
        runtime: params.runtime,
        orgId,
        intent: params.intent,
        now: params.now,
      });
      if (tradeoffText) {
        return tradeoffText;
      }
      const summary = await collectStoreWindowSummary({
        runtime: params.runtime,
        orgId,
        frame: params.intent.timeFrame,
        now: params.now,
      });
      return renderRiskAdviceText({
        summary,
        intent: params.intent,
      });
    }
    case "hq_portfolio_overview_v1": {
      const comparisonFrame = resolvePreviousComparableFrame(params.intent.timeFrame);
      const entries = await Promise.all(
        params.effectiveOrgIds.map(async (orgId) => {
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
      return renderHqPortfolioText({
        label: params.intent.allStoresRequested
          ? `${params.effectiveOrgIds.length}店`
          : "已授权门店",
        entries,
        intent: params.intent,
      });
    }
    default:
      return null;
  }
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
    round(
      firstMetrics.reduce((total, metrics) => total + metricNumber(metrics, key), 0),
      4,
    );
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
    averageTicket: serviceOrderCount > 0 ? round(serviceRevenue / serviceOrderCount) : 0,
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
  return {
    ...metrics,
    orgId: row.orgId,
    storeName: row.storeName,
    bizDate: row.windowEndBizDate,
    serviceRevenue: row.revenue7d,
    serviceOrderCount: row.orderCount7d,
    averageTicket: row.averageTicket7d ?? metrics.averageTicket,
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
  return {
    ...metrics,
    orgId: row.orgId,
    storeName: row.storeName,
    bizDate: row.windowEndBizDate,
    serviceRevenue: row.revenue30d,
    serviceOrderCount: row.orderCount30d,
    averageTicket: row.averageTicket30d ?? metrics.averageTicket,
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
  runtime: HetangQueryRuntime;
  orgId: string;
  frame: HetangQueryTimeFrame;
  now: Date;
}): Promise<StoreWindowSummary> {
  const bizDates = enumerateBizDates(params.frame);
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
    return await params.runtime.buildReport({ orgId: params.orgId, bizDate, now: params.now });
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

async function resolveSingleDayDailyKpiRow(params: {
  runtime: HetangQueryRuntime;
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

export async function renderTotalClockBreakdownText(params: {
  runtime: HetangQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string> {
  const summary = await collectStoreWindowSummary({
    runtime: params.runtime,
    orgId: params.orgId,
    frame: params.intent.timeFrame,
    now: params.now,
  });
  const label =
    params.intent.timeFrame.kind === "single"
      ? params.intent.timeFrame.bizDate
      : params.intent.timeFrame.label;
  const lines = [`${summary.storeName} ${label} 钟数构成`];
  if (!summary.complete || summary.metrics.incompleteSync) {
    lines.push("注意：当前营业日同步尚未完全收口，以下钟数构成仅供参考。");
  }
  lines.push(`- 总钟数: ${formatCount(summary.metrics.totalClockCount)} 个`);

  const dailyKpiRow =
    params.intent.timeFrame.kind === "single"
      ? await resolveSingleDayDailyKpiRow({
          runtime: params.runtime,
          orgId: params.orgId,
          bizDate: params.intent.timeFrame.bizDate,
        })
      : null;

  const hasReliableDailyKpiBreakdown =
    !!dailyKpiRow && dailyKpiRow.assignClocks + dailyKpiRow.queueClocks > 0;
  const hasReliableRawBreakdown =
    summary.metrics.upClockRecordCount > 0 &&
    summary.metrics.upClockRecordCount >=
      summary.metrics.pointClockRecordCount + summary.metrics.addClockRecordCount;

  if (hasReliableDailyKpiBreakdown && dailyKpiRow) {
    lines.push(`- 点钟: ${formatCount(dailyKpiRow.assignClocks)} 个`);
    lines.push(`- 排钟: ${formatCount(dailyKpiRow.queueClocks)} 个`);
  } else if (hasReliableRawBreakdown) {
    const baseClockCount = Math.max(
      summary.metrics.upClockRecordCount - summary.metrics.addClockRecordCount,
      0,
    );
    const queueLikeClockCount = Math.max(
      baseClockCount - summary.metrics.pointClockRecordCount,
      0,
    );
    lines.push(`- 点钟: ${formatCount(summary.metrics.pointClockRecordCount)} 个`);
    lines.push(`- 排钟: ${formatCount(queueLikeClockCount)} 个`);
  } else {
    lines.push(
      `- 当前库里只能稳定确认加钟 ${formatCount(summary.metrics.addClockRecordCount)} 个，点钟 / 排钟拆分口径今天还不完整。`,
    );
  }

  if (hasReliableDailyKpiBreakdown || hasReliableRawBreakdown) {
    lines.push(`- 加钟: ${formatCount(summary.metrics.addClockRecordCount)} 个`);
  }
  lines.push(
    "注：当前可稳定拆到点钟 / 排钟 / 加钟；主项 / 采耳 / 小项 / SPA 这类更细结构还要依赖原始钟单明细。",
  );
  return lines.join("\n");
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

export async function tryRenderStorePriorityTradeoffText(params: {
  runtime: HetangQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
  now: Date;
}): Promise<string | null> {
  if (!isStorePriorityTradeoffAsk(params.intent.rawText)) {
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
    metrics: currentSummary
      ? applyStoreSummary30dRow(report.metrics, currentSummary)
      : report.metrics,
    previousMetrics: previousSummary
      ? applyStoreSummary30dRow(report.metrics, previousSummary)
      : undefined,
  });
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

export async function tryRenderSingleDayDailyKpiFastPath(params: {
  runtime: HetangQueryRuntime;
  orgId: string;
  intent: HetangQueryIntent;
}): Promise<string | null> {
  if (
    !shouldUseSingleDayDailyKpiFastPath(params.intent) ||
    !params.runtime.listStoreManagerDailyKpiByDateRange ||
    params.intent.timeFrame.kind !== "single"
  ) {
    return null;
  }
  const bizDate = params.intent.timeFrame.bizDate;
  const rows = await params.runtime.listStoreManagerDailyKpiByDateRange({
    orgId: params.orgId,
    startBizDate: bizDate,
    endBizDate: bizDate,
  });
  const row = rows.find((entry) => entry.bizDate === bizDate) ?? rows[0];
  return row ? renderSingleDayDailyKpiText(row) : null;
}
