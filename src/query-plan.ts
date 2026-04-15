import type { HetangQueryIntent } from "./query-intent.js";
import {
  resolveFollowUpBucketAlias,
  resolveServingCustomerSegmentCountMatch,
  resolveServingCustomerSegmentListMatch,
  resolveServingCustomerSegmentTechBindingRankingMatch,
} from "./customer-query.js";

export type QueryPlan = {
  plan_version: "v1";
  request_id: string;
  entity: "store" | "hq" | "customer_profile" | "tech";
  scope: {
    org_ids: string[];
    scope_kind: "single" | "multi" | "all";
    access_scope_kind: "manager" | "hq" | "regional";
  };
  time: {
    mode: "day" | "window" | "as_of" | "timeseries";
    biz_date?: string;
    start_biz_date?: string;
    end_biz_date?: string;
    window_days?: number;
    as_of_biz_date?: string;
    grain?: "day" | "week" | "month" | "hour_bucket";
  };
  action:
    | "summary"
    | "ranking"
    | "compare"
    | "profile"
    | "list"
    | "breakdown"
    | "report"
    | "trend"
    | "anomaly"
    | "risk"
    | "advice";
  metrics: string[];
  dimensions: string[];
  filters: Array<{
    field: string;
    op: "=" | "in" | "between";
    value: string | number | boolean | Array<string | number>;
  }>;
  compare?: {
    baseline: "previous_day" | "previous_window" | "peer_group";
    label?: string;
    biz_date?: string;
    start_biz_date?: string;
    end_biz_date?: string;
    window_days?: number;
  };
  sort?: {
    metric: string;
    order: "asc" | "desc";
  };
  limit?: number;
  response_shape:
    | "scalar"
    | "table"
    | "ranking_list"
    | "timeseries"
    | "profile_card"
    | "narrative";
  planner_meta: {
    confidence: number;
    source: "rule" | "rule+ai" | "ai";
    normalized_question: string;
    clarification_needed: boolean;
  };
};

function randomRequestId(intent: HetangQueryIntent): string {
  return `${intent.kind}:${intent.rawText}`.slice(0, 128);
}

function metricKey(intent: HetangQueryIntent): string {
  if (intent.kind === "hq_portfolio" || intent.kind === "risk" || intent.kind === "advice") {
    return "riskScore";
  }
  return intent.metrics[0]?.key ?? "serviceRevenue";
}

function resolveScopeKind(orgIds: string[], allStoresRequested: boolean): QueryPlan["scope"]["scope_kind"] {
  if (allStoresRequested) {
    return "all";
  }
  if (orgIds.length <= 1) {
    return "single";
  }
  return "multi";
}

function resolveConfidence(intent: HetangQueryIntent): number {
  if (intent.routeConfidence === "high") {
    return 0.95;
  }
  if (intent.routeConfidence === "medium") {
    return 0.8;
  }
  if (intent.routeConfidence === "low") {
    return 0.6;
  }
  return 0.85;
}

function resolveFollowUpBucketFilter(text: string): string | null {
  return resolveFollowUpBucketAlias(text);
}

function wantsMetricBreakdown(intent: HetangQueryIntent): boolean {
  return (
    intent.kind === "metric" &&
    intent.metrics.some((metric) => metric.key === "totalClockCount") &&
    /(构成|组成|拆开|拆分|拆解|由什么构成|怎么构成|分别是多少|分别多少)/u.test(
      intent.rawText,
    )
  );
}

function resolveAsOfBizDate(intent: HetangQueryIntent): string {
  return intent.timeFrame.kind === "single" ? intent.timeFrame.bizDate : intent.timeFrame.endBizDate;
}

function resolveWaitExperienceDimension(text: string): string {
  if (/(哪个技师|哪位技师|技师)/u.test(text)) {
    return "tech";
  }
  if (/(哪个房间|哪间房|房间)/u.test(text)) {
    return "room";
  }
  if (/(点钟|排钟)/u.test(text)) {
    return "clock_kind";
  }
  return "time_bucket";
}

function resolveMemberMarketingDimension(text: string): string {
  if (/(客服|前台|销售|营销人)/u.test(text)) {
    return "marketer";
  }
  if (/标签/u.test(text)) {
    return "label";
  }
  return "source";
}

function resolveRechargeAttributionDimension(text: string): string {
  if (/(客服|前台|销售)/u.test(text)) {
    return "sales";
  }
  return "card_type";
}

function resolveCompareMeta(params: {
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
}): QueryPlan["compare"] | undefined {
  if (params.intent.kind !== "compare") {
    return undefined;
  }
  if (params.effectiveOrgIds.length > 1 || params.intent.explicitOrgIds.length > 1) {
    return {
      baseline: "peer_group",
      label: "同口径门店",
    };
  }
  if (!params.intent.comparisonTimeFrame) {
    return undefined;
  }
  if (params.intent.comparisonTimeFrame.kind === "single") {
    return {
      baseline: "previous_day",
      biz_date: params.intent.comparisonTimeFrame.bizDate,
      label: params.intent.comparisonTimeFrame.label,
    };
  }
  return {
    baseline: "previous_window",
    start_biz_date: params.intent.comparisonTimeFrame.startBizDate,
    end_biz_date: params.intent.comparisonTimeFrame.endBizDate,
    window_days: params.intent.comparisonTimeFrame.days,
    label: params.intent.comparisonTimeFrame.label,
  };
}

export function buildQueryPlanFromIntent(params: {
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
  accessScopeKind: QueryPlan["scope"]["access_scope_kind"];
}): QueryPlan {
  const { intent } = params;
  const scope_kind = resolveScopeKind(params.effectiveOrgIds, intent.allStoresRequested);
  const planner_meta: QueryPlan["planner_meta"] = {
    confidence: resolveConfidence(intent),
    source: "rule",
    normalized_question: intent.rawText.trim(),
    clarification_needed: intent.requiresClarification === true,
  };
  const compare = resolveCompareMeta({
    intent,
    effectiveOrgIds: params.effectiveOrgIds,
  });
  const followupBucket = intent.kind === "customer_segment" ? resolveFollowUpBucketFilter(intent.rawText) : null;

  if (intent.kind === "customer_profile") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time: {
        mode: "as_of",
        as_of_biz_date:
          intent.timeFrame.kind === "single" ? intent.timeFrame.bizDate : intent.timeFrame.endBizDate,
      },
      action: "profile",
      metrics: [],
      dimensions: [],
      filters: intent.phoneSuffix
        ? [
            {
              field: "phone_suffix",
              op: "=",
              value: intent.phoneSuffix,
            },
          ]
        : [],
      response_shape: "profile_card",
      planner_meta,
    };
  }

  const servingSegment =
    intent.kind === "customer_segment" ? resolveServingCustomerSegmentListMatch(intent.rawText) : null;
  const servingSegmentCount =
    intent.kind === "customer_segment" ? resolveServingCustomerSegmentCountMatch(intent.rawText) : null;
  const servingSegmentTechBinding =
    intent.kind === "customer_segment"
      ? resolveServingCustomerSegmentTechBindingRankingMatch(intent.rawText)
      : null;
  if (intent.kind === "customer_segment" && servingSegmentTechBinding && !followupBucket) {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time: {
        mode: "as_of",
        as_of_biz_date: resolveAsOfBizDate(intent),
      },
      action: "list",
      metrics: [],
      dimensions: ["segment", "tech"],
      filters: [
        {
          field: "primary_segment",
          op: "=",
          value: servingSegmentTechBinding.key,
        },
      ],
      response_shape: "ranking_list",
      planner_meta,
    };
  }
  if (intent.kind === "customer_segment" && servingSegmentCount && !followupBucket) {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time: {
        mode: "as_of",
        as_of_biz_date: resolveAsOfBizDate(intent),
      },
      action: "list",
      metrics: [],
      dimensions: ["segment"],
      filters: [
        {
          field: "primary_segment",
          op: "=",
          value: servingSegmentCount.key,
        },
      ],
      response_shape: "scalar",
      planner_meta,
    };
  }
  if (intent.kind === "customer_segment" && servingSegment && !followupBucket) {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time: {
        mode: "as_of",
        as_of_biz_date: resolveAsOfBizDate(intent),
      },
      action: "list",
      metrics: [],
      dimensions: ["segment"],
      filters: [
        {
          field: "primary_segment",
          op: "=",
          value: servingSegment.key,
        },
      ],
      sort: {
        metric: "payAmount90d",
        order: "desc",
      },
      limit: 20,
      response_shape: "ranking_list",
      planner_meta,
    };
  }

  if (intent.kind === "customer_segment" && intent.semanticSlots.action !== "followup") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time: {
        mode: "as_of",
        as_of_biz_date: resolveAsOfBizDate(intent),
      },
      action: "list",
      metrics: [],
      dimensions: ["segment"],
      filters: [],
      response_shape: "ranking_list",
      planner_meta,
    };
  }

  if (intent.kind === "customer_segment" && intent.semanticSlots.action === "followup") {
    const rankingMetric = followupBucket ? "riskScore" : "followupScore";
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time: {
        mode: "as_of",
        as_of_biz_date:
          intent.timeFrame.kind === "single" ? intent.timeFrame.bizDate : intent.timeFrame.endBizDate,
      },
      action: "list",
      metrics: [rankingMetric],
      dimensions: [],
      filters: followupBucket
        ? [
            {
              field: "followup_bucket",
              op: "=",
              value: followupBucket,
            },
          ]
        : [],
      sort: {
        metric: rankingMetric,
        order: "desc",
      },
      limit: 12,
      response_shape: "ranking_list",
      planner_meta,
    };
  }

  if (intent.kind === "customer_relation") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time:
        intent.timeFrame.kind === "single"
          ? {
              mode: "day",
              biz_date: intent.timeFrame.bizDate,
            }
          : {
              mode: "window",
              start_biz_date: intent.timeFrame.startBizDate,
              end_biz_date: intent.timeFrame.endBizDate,
              window_days: intent.timeFrame.days,
            },
      action: "profile",
      metrics: [],
      dimensions: [/(技师)/u.test(intent.rawText) ? "tech" : "customer"],
      filters: [],
      response_shape: "narrative",
      planner_meta,
    };
  }

  if (intent.kind === "birthday_members") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time:
        intent.timeFrame.kind === "single"
          ? {
              mode: "day",
              biz_date: intent.timeFrame.bizDate,
            }
          : {
              mode: "window",
              start_biz_date: intent.timeFrame.startBizDate,
              end_biz_date: intent.timeFrame.endBizDate,
              window_days: intent.timeFrame.days,
            },
      action: "list",
      metrics: [],
      dimensions: [],
      filters: [],
      response_shape: "ranking_list",
      planner_meta,
    };
  }

  if (intent.kind === "member_marketing") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "customer_profile",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time: {
        mode: "as_of",
        as_of_biz_date: resolveAsOfBizDate(intent),
      },
      action: "ranking",
      metrics: [],
      dimensions: [resolveMemberMarketingDimension(intent.rawText)],
      filters: [],
      response_shape: "ranking_list",
      planner_meta,
    };
  }

  if (intent.kind === "tech_profile") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "tech",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time:
        intent.timeFrame.kind === "single"
          ? {
              mode: "day",
              biz_date: intent.timeFrame.bizDate,
            }
          : {
              mode: "window",
              start_biz_date: intent.timeFrame.startBizDate,
              end_biz_date: intent.timeFrame.endBizDate,
              window_days: intent.timeFrame.days,
            },
      action: "profile",
      metrics: [],
      dimensions: [],
      filters: [],
      response_shape: "profile_card",
      planner_meta,
    };
  }

  if (intent.kind === "arrival_profile") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "store",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time:
        intent.timeFrame.kind === "single"
          ? {
              mode: "day",
              biz_date: intent.timeFrame.bizDate,
            }
          : {
              mode: "window",
              start_biz_date: intent.timeFrame.startBizDate,
              end_biz_date: intent.timeFrame.endBizDate,
              window_days: intent.timeFrame.days,
            },
      action: "trend",
      metrics: [],
      dimensions: ["hour_bucket"],
      filters: [],
      response_shape: "timeseries",
      planner_meta,
    };
  }

  if (intent.kind === "wait_experience") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "store",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time:
        intent.timeFrame.kind === "single"
          ? {
              mode: "day",
              biz_date: intent.timeFrame.bizDate,
            }
          : {
              mode: "window",
              start_biz_date: intent.timeFrame.startBizDate,
              end_biz_date: intent.timeFrame.endBizDate,
              window_days: intent.timeFrame.days,
            },
      action: "anomaly",
      metrics: [],
      dimensions: [resolveWaitExperienceDimension(intent.rawText)],
      filters: [],
      response_shape: "narrative",
      planner_meta,
    };
  }

  if (intent.kind === "recharge_attribution") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "store",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time:
        intent.timeFrame.kind === "single"
          ? {
              mode: "day",
              biz_date: intent.timeFrame.bizDate,
            }
          : {
              mode: "window",
              start_biz_date: intent.timeFrame.startBizDate,
              end_biz_date: intent.timeFrame.endBizDate,
              window_days: intent.timeFrame.days,
            },
      action: "ranking",
      metrics: [],
      dimensions: [resolveRechargeAttributionDimension(intent.rawText)],
      filters: [],
      response_shape: "ranking_list",
      planner_meta,
    };
  }

  if (intent.kind === "hq_portfolio") {
    return {
      plan_version: "v1",
      request_id: randomRequestId(intent),
      entity: "hq",
      scope: {
        org_ids: params.effectiveOrgIds,
        scope_kind,
        access_scope_kind: params.accessScopeKind,
      },
      time:
        intent.timeFrame.kind === "single"
          ? {
              mode: "day",
              biz_date: intent.timeFrame.bizDate,
            }
          : {
              mode: "window",
              end_biz_date: intent.timeFrame.endBizDate,
              start_biz_date: intent.timeFrame.startBizDate,
              window_days: intent.timeFrame.days,
            },
      action: "ranking",
      metrics: ["riskScore"],
      dimensions: ["store"],
      filters: [],
      sort: {
        metric: "riskScore",
        order: "desc",
      },
      limit: Math.max(5, params.effectiveOrgIds.length),
      response_shape: "ranking_list",
      planner_meta,
    };
  }

  return {
    plan_version: "v1",
    request_id: randomRequestId(intent),
    entity: intent.kind === "ranking" && intent.rankingTarget === "tech" ? "tech" : "store",
    scope: {
      org_ids: params.effectiveOrgIds,
      scope_kind,
      access_scope_kind: params.accessScopeKind,
    },
    time:
      intent.timeFrame.kind === "single"
        ? {
            mode: "day",
            biz_date: intent.timeFrame.bizDate,
          }
        : {
            mode: "window",
            start_biz_date: intent.timeFrame.startBizDate,
            end_biz_date: intent.timeFrame.endBizDate,
            window_days: intent.timeFrame.days,
          },
    action: wantsMetricBreakdown(intent)
      ? "breakdown"
      : intent.kind === "ranking"
        ? "ranking"
        : intent.kind === "compare"
          ? "compare"
          : intent.kind === "report"
            ? "report"
            : intent.kind === "trend"
              ? "trend"
              : intent.kind === "anomaly"
                ? "anomaly"
                : intent.kind === "risk"
                  ? "risk"
                  : intent.kind === "advice"
                    ? "advice"
                    : "summary",
    metrics: [metricKey(intent)],
    dimensions: wantsMetricBreakdown(intent) ? ["clock_type"] : [],
    filters: [],
    compare,
    sort:
      intent.kind === "ranking"
        ? {
            metric: metricKey(intent),
            order: intent.rankingOrder === "asc" ? "asc" : "desc",
          }
        : undefined,
    limit: intent.kind === "ranking" ? Math.max(params.effectiveOrgIds.length, 5) : undefined,
    response_shape: wantsMetricBreakdown(intent)
      ? "table"
      : intent.kind === "ranking"
        ? "ranking_list"
        : intent.kind === "trend"
          ? "timeseries"
          : intent.kind === "report" ||
              intent.kind === "anomaly" ||
              intent.kind === "risk" ||
              intent.kind === "advice"
            ? "narrative"
            : "scalar",
    planner_meta,
  };
}
