import { resolveCapabilityGraphSelection } from "./capability-graph.js";
import { resolveIntentClarifierDecision } from "./app/intent-clarifier-service.js";
import { resolveHetangNaturalLanguageRoute } from "./analysis-router.js";
import { buildQueryPlanFromIntent, type QueryPlan } from "./query-plan.js";
import { resolveAccessScopeKind } from "./query-engine-router.js";
import {
  resolveConversationSemanticEffectiveText,
  resolveHetangQueryIntent,
  type HetangQueryIntent,
} from "./query-intent.js";
import {
  normalizeHetangSemanticText,
  resolveHetangQuerySemanticContext,
  type HetangQuerySemanticContext,
  type HetangSemanticObject as HetangQuerySemanticObject,
} from "./query-semantics.js";
import type {
  HetangAnalysisJobType,
  HetangConversationSemanticStateSnapshot,
  HetangEmployeeBinding,
  HetangOpsConfig,
} from "./types.js";

const IDENTITY_ASK_KEYWORDS =
  /(你是谁|你是干嘛的|你能做什么|你可以做什么|你是什么角色|介绍一下你自己|自我介绍一下|你主要负责什么)/u;
const CAPABILITY_ASK_KEYWORDS =
  /(支持哪些能力|支持什么能力|现在支持哪些能力|你现在支持哪些能力|能查什么|现在能问什么|支持哪些问题|能做哪些查询)/u;
const BUSINESS_CORRECTION_KEYWORDS =
  /(乱回|乱答|乱回复|瞎回|瞎回复|答非所问|没听懂|没理解|理解错|不是这个意思|别套模板|不要模板|别给模板|别发清单|别发能力清单|重新回答|重答)/u;
const BUSINESS_DOMAIN_KEYWORDS =
  /(营收|业绩|经营|复盘|顾客|会员|客户|技师|总部|门店|团购|储值|开卡|复购|留存|流失|唤回|跟进|名单|画像|点钟|加钟|钟效|人效|排班|风险|危险|盘子|大盘)/u;
const CONCEPT_EXPLAIN_KEYWORDS =
  /(什么是|什么意思|是什么意思|如何复盘|怎么复盘|如何做复盘|怎么做复盘|点钟率是什么意思|加钟率是什么意思|钟效是什么意思|人效是什么意思)/u;
const TIME_SCOPE_HINT_KEYWORDS =
  /(今天|今日|昨天|昨日|明天|本周|本月|上周|上月|下周|下月|最近|近期|这几天|近几天|最近这几天|前几天|近\d+[天周月年]|过去\d+[天周月年]|最近\d+[天周月年]|\d{4}-\d{2}-\d{2}|\d{4}年\s*\d{1,2}月\s*\d{1,2}日|\d{1,2}月\s*\d{1,2}日)/u;
const BUSINESS_GUIDANCE_PROMPT_KEYWORDS =
  /(怎么样|如何|哪里有问题|重点看什么|该看什么|看什么指标|什么情况|有啥问题|有什么问题|重点抓什么|该抓什么|盘里收了多少|盘里收|收了多少|搞了多少|做了多少)/u;
const NEGATIVE_REPORT_CONSTRAINT_KEYWORDS =
  /(不要|别|不用).*(经营复盘|复盘)|不是.*(经营复盘|复盘)/u;
const CUSTOMER_SATISFACTION_LOOKUP_KEYWORDS = /(满意度|满意率|好评率|差评率|评价|口碑)/u;
const SCHEDULE_DETAIL_LOOKUP_KEYWORDS =
  /(排班表|排班明细|班表|班次安排|明天排班|下周排班|预约排班|出勤安排)/u;
const FORECAST_LOOKUP_KEYWORDS =
  /(预测|预估|预计|估计|明天客流|下周客流|明天营收|下周营收|明天单数|下周单数)/u;
const REALTIME_QUEUE_LOOKUP_KEYWORDS = /(等位|排队|候钟|等钟)/u;
const PENDING_SETTLEMENT_LOOKUP_KEYWORDS = /(待结账|未结账|待结算|未结算)/u;

export type HetangSemanticLane = "meta" | "query" | "analysis";

export type HetangSemanticIntentKind =
  | "identity"
  | "capability"
  | "business_correction"
  | "unsupported_customer_satisfaction"
  | "unsupported_schedule_detail"
  | "unsupported_forecast"
  | "unsupported_realtime_queue"
  | "unsupported_pending_settlement"
  | "structured_report_draft"
  | "negative_constraint"
  | "concept_explain"
  | "clarify"
  | "clarify_missing_store"
  | "clarify_missing_time"
  | "clarify_mixed_scope"
  | "clarify_missing_object_scope"
  | "unsupported_lookup"
  | "guidance_strategy_open_question"
  | "guidance_customer_missing_store"
  | "guidance_store_missing_time_range"
  | "guidance_customer_missing_time_range"
  | "guidance_tech_missing_time_range"
  | "guidance_missing_time_range"
  | "guidance_store_missing_metric"
  | "guidance_customer_missing_metric"
  | "guidance_tech_missing_metric"
  | "guidance_missing_metric"
  | "business_guidance"
  | "generic_unmatched"
  | "query"
  | "analysis";

export type HetangSemanticIntentObject = HetangQuerySemanticObject | "report" | "concept" | "assistant";

export type HetangSemanticIntentAction =
  | "explain"
  | "summary"
  | "compare"
  | "ranking"
  | "trend"
  | "anomaly"
  | "risk"
  | "advice"
  | "profile"
  | "list"
  | "breakdown"
  | "report"
  | "analysis"
  | "clarify"
  | "control";

export type HetangRouteSnapshot = {
  lane: HetangSemanticLane;
  kind: HetangSemanticIntentKind;
  action?: HetangSemanticIntentAction;
  capabilityId?: string;
};

export type HetangSemanticIntent = HetangRouteSnapshot & {
  confidence: "high" | "medium" | "low";
  scope: {
    orgIds: string[];
    allStores: boolean;
  };
  object: HetangSemanticIntentObject;
  action: HetangSemanticIntentAction;
  clarificationNeeded: boolean;
  clarificationText?: string;
  timeFrameLabel?: string;
  analysisRequest?: {
    jobType: HetangAnalysisJobType;
    orgId: string;
    storeName: string;
    rawText: string;
    timeFrameLabel: string;
    startBizDate: string;
    endBizDate: string;
  };
  reason: string;
};

type HetangUnsupportedPreRouteResolution =
  | {
      kind:
        | "unsupported_customer_satisfaction"
        | "unsupported_schedule_detail"
        | "unsupported_forecast"
        | "unsupported_realtime_queue"
        | "unsupported_pending_settlement";
      object: HetangSemanticIntentObject;
      action: HetangSemanticIntentAction;
      clarificationNeeded: boolean;
      reason: string;
    }
  | {
      kind: "clarify_mixed_scope";
      object: HetangSemanticIntentObject;
      action: HetangSemanticIntentAction;
      clarificationNeeded: boolean;
      reason: string;
    };

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function resolveStructuredReportDraftIntent(text: string): boolean {
  return (
    /(我需要一份|整理成一份|生成一份|写一份)/u.test(text) &&
    /(日报|经营数据报告)/u.test(text) &&
    text.includes("\n")
  );
}

function resolveIntentObject(
  object: HetangQuerySemanticObject,
  fallback: HetangSemanticIntentObject = "store",
): HetangSemanticIntentObject {
  return object === "unknown" ? fallback : object;
}

function resolveGuidanceMissingTimeKind(
  object: HetangSemanticIntentObject,
): Extract<
  HetangSemanticIntentKind,
  | "guidance_store_missing_time_range"
  | "guidance_customer_missing_time_range"
  | "guidance_tech_missing_time_range"
> {
  switch (object) {
    case "customer":
      return "guidance_customer_missing_time_range";
    case "tech":
      return "guidance_tech_missing_time_range";
    default:
      return "guidance_store_missing_time_range";
  }
}

function resolveGuidanceMissingMetricKind(
  object: HetangSemanticIntentObject,
): Extract<
  HetangSemanticIntentKind,
  | "guidance_store_missing_metric"
  | "guidance_customer_missing_metric"
  | "guidance_tech_missing_metric"
> {
  switch (object) {
    case "customer":
      return "guidance_customer_missing_metric";
    case "tech":
      return "guidance_tech_missing_metric";
    default:
      return "guidance_store_missing_metric";
  }
}

function resolveBindingScopedOrgIds(binding?: HetangEmployeeBinding | null): string[] {
  if (!binding || binding.isActive === false || binding.role === "disabled") {
    return [];
  }
  if (binding.scopeOrgIds && binding.scopeOrgIds.length > 0) {
    return binding.scopeOrgIds;
  }
  return binding.orgId ? [binding.orgId] : [];
}

export function resolveBusinessGuidanceIntent(params: {
  config: HetangOpsConfig;
  text: string;
  binding?: HetangEmployeeBinding | null;
}): {
  kind: Extract<
    HetangSemanticIntentKind,
    | "guidance_strategy_open_question"
    | "guidance_customer_missing_store"
    | "guidance_store_missing_time_range"
    | "guidance_customer_missing_time_range"
    | "guidance_tech_missing_time_range"
    | "guidance_missing_time_range"
    | "guidance_store_missing_metric"
    | "guidance_customer_missing_metric"
    | "guidance_tech_missing_metric"
    | "guidance_missing_metric"
    | "business_guidance"
  >;
  object: HetangSemanticIntentObject;
  action: "clarify";
  scopeOrgIds: string[];
  allStores: boolean;
  reason: string;
} | null {
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text: params.text,
  });
  const semanticContent = normalizeHetangSemanticText(params.text);
  const strategyLikeAsk = /(策略|打法|方向|方案|抓手|怎么抓|怎么推|怎么落|怎么安排)/u.test(
    semanticContent,
  );
  const guidancePromptLikeAsk = BUSINESS_GUIDANCE_PROMPT_KEYWORDS.test(semanticContent);
  if (
    !semanticContext.hasDataKeyword &&
    !BUSINESS_DOMAIN_KEYWORDS.test(semanticContent) &&
    !strategyLikeAsk &&
    !(guidancePromptLikeAsk && (semanticContext.hasStoreContext || semanticContext.allStoresRequested))
  ) {
    return null;
  }

  const scopedOrgIds = resolveBindingScopedOrgIds(params.binding);
  const hasStoreScope = semanticContext.hasStoreContext || scopedOrgIds.length === 1;
  const hasResolvedScope = hasStoreScope || semanticContext.allStoresRequested;
  const hasTimeScope = TIME_SCOPE_HINT_KEYWORDS.test(params.text);
  const customerLikeAsk =
    semanticContext.semanticSlots.object === "customer" ||
    /(会员|客户|顾客|客人|召回|唤回|跟进)/u.test(semanticContent);
  const defaultObject = customerLikeAsk
    ? "customer"
    : resolveIntentObject(semanticContext.semanticSlots.object, "store");

  if (strategyLikeAsk && !semanticContext.hasDataKeyword) {
    return {
      kind: "guidance_strategy_open_question",
      object: resolveIntentObject(semanticContext.semanticSlots.object, "store"),
      action: "clarify",
      scopeOrgIds: semanticContext.explicitOrgIds,
      allStores: semanticContext.allStoresRequested,
      reason: "guidance-strategy-open-question",
    };
  }

  if (customerLikeAsk && !hasStoreScope) {
    return {
      kind: "guidance_customer_missing_store",
      object: "customer",
      action: "clarify",
      scopeOrgIds: semanticContext.explicitOrgIds,
      allStores: semanticContext.allStoresRequested,
      reason: "guidance-customer-missing-store",
    };
  }

  if (hasResolvedScope && !hasTimeScope) {
    return {
      kind: resolveGuidanceMissingTimeKind(defaultObject),
      object: defaultObject,
      action: "clarify",
      scopeOrgIds:
        semanticContext.explicitOrgIds.length > 0 ? semanticContext.explicitOrgIds : scopedOrgIds,
      allStores: semanticContext.allStoresRequested,
      reason: "guidance-missing-time-range",
    };
  }

  if (
    hasResolvedScope &&
    hasTimeScope &&
    guidancePromptLikeAsk &&
    !semanticContext.hasDataKeyword &&
    semanticContext.metrics.supported.length === 0 &&
    semanticContext.metrics.unsupported.length === 0
  ) {
    return {
      kind: resolveGuidanceMissingMetricKind(defaultObject),
      object: defaultObject,
      action: "clarify",
      scopeOrgIds:
        semanticContext.explicitOrgIds.length > 0 ? semanticContext.explicitOrgIds : scopedOrgIds,
      allStores: semanticContext.allStoresRequested,
      reason: "guidance-missing-metric",
    };
  }

  return {
    kind: "business_guidance",
    object: defaultObject,
    action: "clarify",
    scopeOrgIds:
      semanticContext.explicitOrgIds.length > 0 ? semanticContext.explicitOrgIds : scopedOrgIds,
    allStores: semanticContext.allStoresRequested,
    reason: "business-guidance-fallback",
  };
}

function buildMetaIntent(
  kind: Exclude<HetangSemanticIntentKind, "query" | "analysis">,
  params: {
    confidence?: HetangSemanticIntent["confidence"];
    object?: HetangSemanticIntentObject;
    action?: HetangSemanticIntentAction;
    clarificationNeeded?: boolean;
    clarificationText?: string;
    scopeOrgIds?: string[];
    allStores?: boolean;
    reason: string;
  },
): HetangSemanticIntent {
  return {
    lane: "meta",
    kind,
    confidence: params.confidence ?? "high",
    scope: {
      orgIds: params.scopeOrgIds ?? [],
      allStores: params.allStores ?? false,
    },
    object: params.object ?? "assistant",
    action: params.action ?? "control",
    clarificationNeeded: params.clarificationNeeded ?? false,
    clarificationText: params.clarificationText,
    reason: params.reason,
  };
}

function resolveSemanticScopeOrgIds(params: {
  explicitOrgIds: string[];
  allStores: boolean;
  binding?: HetangEmployeeBinding | null;
  defaultOrgId?: string;
  fallbackOrgIds?: string[];
}): string[] {
  if (params.explicitOrgIds.length > 0) {
    return params.explicitOrgIds;
  }
  const boundScopeOrgIds = resolveBindingScopedOrgIds(params.binding);
  if (params.allStores) {
    return boundScopeOrgIds.length > 0 ? boundScopeOrgIds : (params.fallbackOrgIds ?? []);
  }
  if (params.defaultOrgId) {
    return [params.defaultOrgId];
  }
  if (boundScopeOrgIds.length === 1) {
    return boundScopeOrgIds;
  }
  return params.fallbackOrgIds ?? [];
}

function resolveSemanticQueryCapabilityId(params: {
  queryIntent: HetangQueryIntent;
  effectiveOrgIds: string[];
  binding?: HetangEmployeeBinding | null;
}): string | undefined {
  const plan = buildQueryPlanFromIntent({
    intent: params.queryIntent,
    effectiveOrgIds: params.effectiveOrgIds,
    accessScopeKind: params.binding ? resolveAccessScopeKind(params.binding) : "manager",
  });
  return (
    resolveCapabilityGraphSelection({
      plan,
      executionMode: "serving_sql",
    }).node?.capability_id ??
    resolveCapabilityGraphSelection({
      plan,
      executionMode: "runtime_render",
    }).node?.capability_id ??
    resolveCapabilityGraphSelection({
      plan,
      executionMode: "async_analysis",
    }).node?.capability_id
  );
}

export function resolveSemanticQueryExecutionInfo(params: {
  queryIntent: HetangQueryIntent;
  binding?: HetangEmployeeBinding | null;
  defaultOrgId?: string;
  fallbackOrgIds?: string[];
}): {
  scopeOrgIds: string[];
  planAction: QueryPlan["action"];
  capabilityId?: string;
} {
  const scopeOrgIds = resolveSemanticScopeOrgIds({
    explicitOrgIds: params.queryIntent.explicitOrgIds,
    allStores: params.queryIntent.allStoresRequested,
    binding: params.binding,
    defaultOrgId: params.defaultOrgId,
    fallbackOrgIds: params.fallbackOrgIds,
  });
  const plan = buildQueryPlanFromIntent({
    intent: params.queryIntent,
    effectiveOrgIds: scopeOrgIds,
    accessScopeKind: params.binding ? resolveAccessScopeKind(params.binding) : "manager",
  });
  return {
    scopeOrgIds,
    planAction: plan.action,
    capabilityId: resolveSemanticQueryCapabilityId({
      queryIntent: params.queryIntent,
      effectiveOrgIds: scopeOrgIds,
      binding: params.binding,
    }),
  };
}

export function formatHetangRouteSnapshot(route: HetangRouteSnapshot | null | undefined): string {
  if (!route) {
    return "unhandled";
  }
  if ((route.lane === "query" || route.lane === "analysis") && route.action) {
    return `${route.lane}:${route.action}`;
  }
  return `${route.lane}:${route.kind}`;
}

export function resolveClarifierIntentKind(reason: {
  reason: "missing-store" | "missing-time" | "mixed-scope" | "missing-object-scope";
}): Extract<
  HetangSemanticIntentKind,
  | "clarify_missing_store"
  | "clarify_missing_time"
  | "clarify_mixed_scope"
  | "clarify_missing_object_scope"
> {
  switch (reason.reason) {
    case "missing-store":
      return "clarify_missing_store";
    case "missing-time":
      return "clarify_missing_time";
    case "mixed-scope":
      return "clarify_mixed_scope";
    case "missing-object-scope":
      return "clarify_missing_object_scope";
  }
}

export function resolveUnsupportedPreRouteIntent(params: {
  text: string;
  semanticContext: HetangQuerySemanticContext;
}): HetangUnsupportedPreRouteResolution | null {
  const semanticText = normalizeHetangSemanticText(params.text);

  if (
    CUSTOMER_SATISFACTION_LOOKUP_KEYWORDS.test(params.text) &&
    /(顾客|客户|会员|服务)/u.test(params.text)
  ) {
    return {
      kind: "unsupported_customer_satisfaction",
      object: "customer",
      action: "clarify",
      clarificationNeeded: false,
      reason: "unsupported-customer-satisfaction",
    };
  }

  if (SCHEDULE_DETAIL_LOOKUP_KEYWORDS.test(params.text)) {
    return {
      kind: "unsupported_schedule_detail",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
      reason: "unsupported-schedule-detail",
    };
  }

  if (FORECAST_LOOKUP_KEYWORDS.test(params.text)) {
    return {
      kind: "unsupported_forecast",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
      reason: "unsupported-forecast",
    };
  }

  if (REALTIME_QUEUE_LOOKUP_KEYWORDS.test(params.text)) {
    return {
      kind: "unsupported_realtime_queue",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
      reason: "unsupported-realtime-queue",
    };
  }

  if (PENDING_SETTLEMENT_LOOKUP_KEYWORDS.test(params.text)) {
    return {
      kind: "unsupported_pending_settlement",
      object: "store",
      action: "clarify",
      clarificationNeeded: false,
      reason: "unsupported-pending-settlement",
    };
  }

  if (params.semanticContext.routeSignals.hqStoreMixedScope) {
    return {
      kind: "clarify_mixed_scope",
      object: resolveIntentObject(params.semanticContext.semanticSlots.object, "store"),
      action: "clarify",
      clarificationNeeded: true,
      reason: "mixed-hq-and-single-store",
    };
  }

  return null;
}

export function resolveSemanticIntent(params: {
  config: HetangOpsConfig;
  text: string;
  now: Date;
  binding?: HetangEmployeeBinding | null;
  defaultOrgId?: string;
  semanticState?: HetangConversationSemanticStateSnapshot | null;
}): HetangSemanticIntent {
  const rawText = resolveConversationSemanticEffectiveText({
    config: params.config,
    text: params.text,
    now: params.now,
    semanticState: params.semanticState,
  }).effectiveText;
  const normalized = normalizeText(rawText);
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text: rawText,
  });

  if (IDENTITY_ASK_KEYWORDS.test(normalized)) {
    return buildMetaIntent("identity", {
      object: "assistant",
      action: "explain",
      reason: "identity-keyword",
    });
  }

  if (CAPABILITY_ASK_KEYWORDS.test(normalized)) {
    return buildMetaIntent("capability", {
      object: "assistant",
      action: "control",
      reason: "capability-keyword",
    });
  }

  if (BUSINESS_CORRECTION_KEYWORDS.test(rawText)) {
    return buildMetaIntent("business_correction", {
      object: "assistant",
      action: "control",
      reason: "business-correction-keyword",
    });
  }

  const unsupportedPreRouteIntent = resolveUnsupportedPreRouteIntent({
    text: rawText,
    semanticContext,
  });
  if (unsupportedPreRouteIntent) {
    return buildMetaIntent(unsupportedPreRouteIntent.kind, {
      object: unsupportedPreRouteIntent.object,
      action: unsupportedPreRouteIntent.action,
      clarificationNeeded: unsupportedPreRouteIntent.clarificationNeeded,
      scopeOrgIds: semanticContext.explicitOrgIds,
      allStores: semanticContext.allStoresRequested,
      reason: unsupportedPreRouteIntent.reason,
    });
  }

  if (resolveStructuredReportDraftIntent(rawText)) {
    return buildMetaIntent("structured_report_draft", {
      object: "report",
      action: "control",
      reason: "structured-report-draft",
    });
  }

  if (NEGATIVE_REPORT_CONSTRAINT_KEYWORDS.test(rawText)) {
    return buildMetaIntent("negative_constraint", {
      object: "report",
      action: "control",
      reason: "negative-report-constraint",
    });
  }

  const semanticText = normalizeHetangSemanticText(rawText);
  const looksConceptExplain =
    CONCEPT_EXPLAIN_KEYWORDS.test(semanticText) &&
    BUSINESS_DOMAIN_KEYWORDS.test(semanticText) &&
    !semanticContext.hasStoreContext &&
    !TIME_SCOPE_HINT_KEYWORDS.test(rawText);
  if (looksConceptExplain) {
    return buildMetaIntent("concept_explain", {
      object: "concept",
      action: "explain",
      reason: "concept-explain-keyword",
    });
  }

  const queryIntent = resolveHetangQueryIntent({
    config: params.config,
    text: rawText,
    now: params.now,
  });
  const clarifierDecision = resolveIntentClarifierDecision({
    config: params.config,
    text: rawText,
    binding: params.binding,
    ruleIntent: queryIntent,
  });
  if (
    clarifierDecision.kind === "clarify" &&
    queryIntent &&
    (queryIntent.routeConfidence === "high" || queryIntent.requiresClarification)
  ) {
    return buildMetaIntent(resolveClarifierIntentKind(clarifierDecision), {
      confidence: queryIntent.routeConfidence ?? "high",
      object: resolveIntentObject(semanticContext.semanticSlots.object, "store"),
      action: "clarify",
      clarificationNeeded: true,
      clarificationText: clarifierDecision.text,
      scopeOrgIds: queryIntent.explicitOrgIds,
      allStores: queryIntent.allStoresRequested,
      reason: `clarifier:${clarifierDecision.reason}`,
    });
  }

  const route = resolveHetangNaturalLanguageRoute({
    config: params.config,
    content: rawText,
    now: params.now,
    defaultOrgId: params.defaultOrgId,
  });

  if (route?.action === "analysis") {
    return {
      lane: "analysis",
      kind: "analysis",
      confidence: queryIntent?.routeConfidence ?? "high",
      scope: {
        orgIds: resolveSemanticScopeOrgIds({
          explicitOrgIds: queryIntent?.explicitOrgIds ?? semanticContext.explicitOrgIds,
          allStores: queryIntent?.allStoresRequested ?? semanticContext.allStoresRequested,
          binding: params.binding,
          defaultOrgId: params.defaultOrgId,
          fallbackOrgIds: semanticContext.explicitOrgIds,
        }),
        allStores: queryIntent?.allStoresRequested ?? semanticContext.allStoresRequested,
      },
      object: resolveIntentObject(semanticContext.semanticSlots.object, "store"),
      action: "analysis",
      clarificationNeeded: false,
      timeFrameLabel: route.request.timeFrameLabel,
      analysisRequest: route.request,
      capabilityId: route.capabilityId,
      reason: "analysis-router",
    };
  }

  if (queryIntent) {
    const queryExecution = resolveSemanticQueryExecutionInfo({
      queryIntent,
      binding: params.binding,
      defaultOrgId: params.defaultOrgId,
      fallbackOrgIds: queryIntent.allStoresRequested
        ? params.config.stores.filter((store) => store.isActive).map((store) => store.orgId)
        : semanticContext.explicitOrgIds,
    });
    return {
      lane: "query",
      kind: "query",
      confidence: queryIntent.routeConfidence ?? "high",
      scope: {
        orgIds: queryExecution.scopeOrgIds,
        allStores: queryIntent.allStoresRequested,
      },
      object:
        queryIntent.kind === "hq_portfolio"
          ? "hq"
          : resolveIntentObject(semanticContext.semanticSlots.object, "store"),
      action: queryExecution.planAction,
      clarificationNeeded: false,
      timeFrameLabel: queryIntent.timeFrame.label,
      capabilityId: queryExecution.capabilityId,
      reason: "query-intent",
    };
  }

  const businessGuidanceIntent = resolveBusinessGuidanceIntent({
    config: params.config,
    text: rawText,
    binding: params.binding,
  });
  if (businessGuidanceIntent) {
    return buildMetaIntent(businessGuidanceIntent.kind, {
      confidence: "medium",
      object: businessGuidanceIntent.object,
      action: businessGuidanceIntent.action,
      scopeOrgIds: businessGuidanceIntent.scopeOrgIds,
      allStores: businessGuidanceIntent.allStores,
      reason: businessGuidanceIntent.reason,
    });
  }

  return buildMetaIntent("generic_unmatched", {
    confidence: "low",
    object: "assistant",
    action: "clarify",
    reason: "generic-unmatched",
  });
}
