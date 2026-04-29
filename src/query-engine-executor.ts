import {
  isRuntimeRenderCapabilityNode,
  isServingCapabilityNode,
  resolveCapabilityGraphSelection,
} from "./capability-graph.js";
import { executeArrivalProfileQuery } from "./arrival-profile-query.js";
import { executeBirthdayMemberQuery } from "./birthday-query.js";
import { executePhoneSuffixCustomerProfileQuery } from "./customer-growth/profile.js";
import {
  executeCustomerQuery,
  hasRuntimeOnlyCustomerSegmentMatch,
} from "./customer-growth/query.js";
import { executeMemberMarketingQuery } from "./member-marketing-query.js";
import { buildQueryPlanFromIntent } from "./query-plan.js";
import type { HetangQueryIntent } from "./query-intent.js";
import {
  renderServingQueryResult,
} from "./query-engine-renderer.js";
import { resolveAccessScopeKind } from "./query-engine-router.js";
import { executeRechargeAttributionQuery } from "./recharge-attribution-query.js";
import { compileServingQuery } from "./sql-compiler.js";
import {
  executeStoreRuntimeQuery,
  shouldShowDailyMetricBreakdown,
} from "./store-query.js";
import {
  executeTechLeaderboardRankingQuery,
  executeTechCurrentQuery,
  executeTechProfileQuery,
} from "./tech-profile.js";
import type {
  ConsumeBillRecord,
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
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
  TechCurrentRecord,
  TechLeaderboardRow,
  TechMarketRecord,
  TechProfile30dRow,
  TechUpClockRecord,
  HetangSemanticExecutionAuditInput,
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
  listCurrentTech?: (orgId: string) => Promise<TechCurrentRecord[]>;
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
  recordSemanticExecutionAudit?: (record: HetangSemanticExecutionAuditInput) => Promise<void>;
};

function shouldPreferRuntimeHqOverview(intent: HetangQueryIntent): boolean {
  if (intent.kind !== "hq_portfolio") {
    return false;
  }

  return (
    intent.timeFrame.days >= 15 ||
    /(风险在哪|风险排序|风险雷达)/u.test(intent.rawText) ||
    /(重点关注|最该盯|优先关注|整体|盘子|拉升|下周|先抓|动作|复盘|经营情况|经营复盘|为什么|原因)/u.test(
      intent.rawText,
    )
  );
}

export function shouldPreferRuntimeRenderBeforeServing(intent: HetangQueryIntent): boolean {
  return (
    shouldPreferRuntimeHqOverview(intent) ||
    (intent.kind === "customer_segment" && hasRuntimeOnlyCustomerSegmentMatch(intent.rawText)) ||
    shouldShowDailyMetricBreakdown(intent) ||
    (intent.kind === "metric" &&
      intent.timeFrame.kind === "range" &&
      intent.metrics.some((metric) => metric.key === "pointClockRate" || metric.key === "addClockRate"))
  );
}

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
  servingVersionOverride?: string;
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
  const servingVersion = params.servingVersionOverride ?? await params.runtime.getCurrentServingVersion();
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
      return await executeStoreRuntimeQuery({
        capabilityId: "store_metric_summary_v1",
        runtime: params.runtime,
        config: params.config,
        orgId,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "store_metric_breakdown_runtime_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      return await executeStoreRuntimeQuery({
        capabilityId: "store_metric_breakdown_runtime_v1",
        runtime: params.runtime,
        config: params.config,
        orgId,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "store_market_breakdown_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      return await executeStoreRuntimeQuery({
        capabilityId: "store_market_breakdown_v1",
        runtime: params.runtime,
        config: params.config,
        orgId,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "store_compare_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      return await executeStoreRuntimeQuery({
        capabilityId: "store_compare_v1",
        runtime: params.runtime,
        config: params.config,
        orgId,
        orgIds: params.effectiveOrgIds,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "store_ranking_v1": {
      return await executeStoreRuntimeQuery({
        capabilityId: "store_ranking_v1",
        runtime: params.runtime,
        config: params.config,
        orgId: params.effectiveOrgIds[0] ?? "",
        orgIds: params.effectiveOrgIds,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "tech_leaderboard_ranking_v1": {
      return await executeTechLeaderboardRankingQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
      });
    }
    case "tech_current_runtime_v1":
      return await executeTechCurrentQuery({
        runtime: params.runtime,
        config: params.config,
        intent: params.intent,
        effectiveOrgIds: params.effectiveOrgIds,
      });
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
      return await executeStoreRuntimeQuery({
        capabilityId: "store_report_v1",
        runtime: params.runtime,
        config: params.config,
        orgId,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "store_trend_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      return await executeStoreRuntimeQuery({
        capabilityId: "store_trend_v1",
        runtime: params.runtime,
        config: params.config,
        orgId,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "store_anomaly_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      return await executeStoreRuntimeQuery({
        capabilityId: "store_anomaly_v1",
        runtime: params.runtime,
        config: params.config,
        orgId,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "store_risk_v1":
    case "store_advice_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId && params.effectiveOrgIds.length === 0) {
        return null;
      }
      return await executeStoreRuntimeQuery({
        capabilityId: capability.capability_id,
        runtime: params.runtime,
        config: params.config,
        orgId: orgId ?? "",
        orgIds: params.effectiveOrgIds,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    case "hq_portfolio_overview_v1":
    case "hq_portfolio_focus_v1":
    case "hq_portfolio_risk_v1": {
      const [orgId] = params.effectiveOrgIds;
      if (!orgId) {
        return null;
      }
      return await executeStoreRuntimeQuery({
        capabilityId: capability.capability_id,
        runtime: params.runtime,
        config: params.config,
        orgId,
        orgIds: params.effectiveOrgIds,
        intent: params.intent,
        now: params.now,
        analysis: plan.analysis,
      });
    }
    default:
      return null;
  }
}
