import { renderSemanticClarificationText } from "./ai-semantic-fallback.js";
import { resolveIntentClarifierDecision } from "./app/intent-clarifier-service.js";
import { resolveHetangQueryIntent, type HetangQueryIntent } from "./query-intent.js";
import { renderQueryClarification } from "./query-engine-router.js";
import { resolveHetangQuerySemanticContext } from "./query-semantics.js";
import { resolveSemanticIntent, resolveUnsupportedPreRouteIntent } from "./semantic-intent.js";
import type { HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

type QueryEntryRuntime = {
  resolveSemanticFallbackIntent?: (params: {
    config: HetangOpsConfig;
    text: string;
    now: Date;
    binding: HetangEmployeeBinding;
    ruleIntent?: HetangQueryIntent | null;
  }) => Promise<
    { intent?: HetangQueryIntent; clarificationText?: string; clarificationReason?: string } | null
  >;
};

export type HetangQueryEntryResolution =
  | {
      kind: "intent";
      intent: HetangQueryIntent;
      source: "rule" | "ai_fallback";
      reason: string;
    }
  | {
      kind: "clarify";
      text: string;
      source: "rule_clarifier" | "ai_fallback";
      reason: string;
    }
  | {
      kind: "unresolved";
      source: "none";
      reason: string;
    };

function resolveUnsupportedQueryEntryReply(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  text: string;
}): { text: string; reason: string } | null {
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text: params.text,
  });
  const unsupported = resolveUnsupportedPreRouteIntent({
    text: params.text,
    semanticContext,
  });
  if (!unsupported) {
    return null;
  }

  const boundStoreName =
    params.binding.scopeOrgIds && params.binding.scopeOrgIds.length === 1
      ? (params.config.stores.find((store) => store.orgId === params.binding.scopeOrgIds?.[0])?.storeName ?? "当前门店")
      : "当前门店";

  switch (unsupported.kind) {
    case "unsupported_realtime_queue":
      return {
        text: `当前还没接入${boundStoreName}等位 / 候钟实时状态，暂时不能严肃回答有没有客人在等位。现在已支持：上钟中技师人数、空闲技师名单。`,
        reason: "unsupported-realtime-queue",
      };
    case "unsupported_pending_settlement":
      return {
        text: `当前还没接入${boundStoreName}待结账 / 待结算实时单据状态，暂时不能严肃回答后台还有几张待结账的单。现在已支持：当前上钟中人数、空闲技师名单。`,
        reason: "unsupported-pending-settlement",
      };
    case "unsupported_customer_satisfaction":
      return {
        text: "当前还没接入顾客评价 / 满意度字段，暂时不能严肃给出满意度结论。你可以先改问点钟率、加钟率、复购或储值转化。",
        reason: "unsupported-customer-satisfaction",
      };
    case "unsupported_schedule_detail":
      return {
        text: "当前还没接入完整班表和预约排班明细，暂时不能直接给出排班表。现在可以先问钟效、点钟率、加钟率和技师画像。",
        reason: "unsupported-schedule-detail",
      };
    case "unsupported_forecast":
      return {
        text: "当前先基于历史经营数据做复盘，还没开放未来客流 / 营收预测口径。",
        reason: "unsupported-forecast",
      };
    default:
      return null;
  }
}

function resolveSemanticGuidanceClarification(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  text: string;
  now: Date;
}): { text: string; reason: "missing-metric" } | null {
  const semanticIntent = resolveSemanticIntent({
    config: params.config,
    text: params.text,
    now: params.now,
    binding: params.binding,
  });
  switch (semanticIntent.kind) {
    case "guidance_store_missing_metric":
    case "guidance_customer_missing_metric":
    case "guidance_tech_missing_metric":
    case "guidance_missing_metric":
      return {
        text: renderSemanticClarificationText({
          reason: "missing_metric",
        }),
        reason: "missing-metric",
      };
    default:
      return null;
  }
}

function looksLikeBusinessQuery(text: string, config: HetangOpsConfig): boolean {
  const context = resolveHetangQuerySemanticContext({
    config,
    text,
  });
  if (resolveUnsupportedPreRouteIntent({ text, semanticContext: context })) {
    return false;
  }
  return (
    context.hasDataKeyword ||
    context.hasStoreContext ||
    context.allStoresRequested ||
    context.metrics.supported.length > 0 ||
    context.metrics.unsupported.length > 0 ||
    context.mentionsAdviceKeyword ||
    context.mentionsRiskKeyword ||
    context.mentionsCustomerSegmentKeyword ||
    context.mentionsCustomerRelationKeyword ||
    context.mentionsMemberMarketingKeyword ||
    context.mentionsRechargeAttributionKeyword ||
    context.mentionsWaitExperienceKeyword ||
    context.mentionsTechProfileKeyword ||
    context.mentionsHqPortfolioKeyword ||
    context.mentionsReportKeyword
  );
}

export async function resolveHetangQueryEntry(params: {
  runtime: QueryEntryRuntime;
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  text: string;
  now: Date;
}): Promise<HetangQueryEntryResolution> {
  const ruleIntent = resolveHetangQueryIntent({
    config: params.config,
    text: params.text,
    now: params.now,
  });
  const clarifierDecision = resolveIntentClarifierDecision({
    config: params.config,
    text: params.text,
    binding: params.binding,
    ruleIntent,
  });
  if (clarifierDecision.kind === "clarify") {
    return {
      kind: "clarify",
      text: clarifierDecision.text,
      source: "rule_clarifier",
      reason: clarifierDecision.reason,
    };
  }
  if (ruleIntent?.requiresClarification) {
    return {
      kind: "clarify",
      text: renderQueryClarification(ruleIntent, params.config),
      source: "rule_clarifier",
      reason: ruleIntent.clarificationReason ?? "rule-intent-clarification",
    };
  }
  const semanticGuidanceClarification = resolveSemanticGuidanceClarification({
    config: params.config,
    binding: params.binding,
    text: params.text,
    now: params.now,
  });
  if (semanticGuidanceClarification) {
    return {
      kind: "clarify",
      text: semanticGuidanceClarification.text,
      source: "rule_clarifier",
      reason: semanticGuidanceClarification.reason,
    };
  }
  const unsupportedReply = resolveUnsupportedQueryEntryReply({
    config: params.config,
    binding: params.binding,
    text: params.text,
  });
  if (unsupportedReply) {
    return {
      kind: "clarify",
      text: unsupportedReply.text,
      source: "rule_clarifier",
      reason: unsupportedReply.reason,
    };
  }
  if (ruleIntent?.routeConfidence === "high") {
    return {
      kind: "intent",
      intent: ruleIntent,
      source: "rule",
      reason: "high-confidence-rule-intent",
    };
  }
  if (
    !params.runtime.resolveSemanticFallbackIntent ||
    !looksLikeBusinessQuery(params.text, params.config)
  ) {
    if (ruleIntent) {
      return {
        kind: "intent",
        intent: ruleIntent,
        source: "rule",
        reason: "fallback-skipped-using-rule-intent",
      };
    }
    return {
      kind: "unresolved",
      source: "none",
      reason: "non-business-or-unsupported",
    };
  }

  const fallback = await params.runtime.resolveSemanticFallbackIntent({
    config: params.config,
    text: params.text,
    now: params.now,
    binding: params.binding,
    ruleIntent,
  });
  if (fallback?.clarificationText) {
    return {
      kind: "clarify",
      text: fallback.clarificationText,
      source: "ai_fallback",
      reason: fallback.clarificationReason ?? "supported-unresolved-query",
    };
  }
  if (fallback?.intent) {
    return {
      kind: "intent",
      intent: fallback.intent,
      source: "ai_fallback",
      reason: "supported-unresolved-query",
    };
  }
  if (ruleIntent) {
    return {
      kind: "intent",
      intent: ruleIntent,
      source: "rule",
      reason: "fallback-null-using-rule-intent",
    };
  }
  return {
    kind: "unresolved",
    source: "none",
    reason: "fallback-null-no-rule-intent",
  };
}
