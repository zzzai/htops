import type { HetangQueryIntentKind } from "./query-intent.js";
import type { HetangQuerySemanticContext } from "./query-semantics.js";

export type HetangIntentRouteResolution = {
  kind: HetangQueryIntentKind;
  confidence: "high" | "medium" | "low";
  requiresClarification?: boolean;
  clarificationReason?: string;
  mentionsCompareKeyword: boolean;
  mentionsRankingKeyword: boolean;
  mentionsTrendKeyword: boolean;
  mentionsAnomalyKeyword: boolean;
  mentionsRiskKeyword: boolean;
  mentionsAdviceKeyword: boolean;
  mentionsReportKeyword: boolean;
  rankingTarget?: "store" | "tech";
  rankingOrder?: "asc" | "desc";
};

type RouteDefinition = {
  id: string;
  when: (context: HetangQuerySemanticContext) => boolean;
  resolve: (context: HetangQuerySemanticContext) => HetangIntentRouteResolution;
};

function hasBusinessFactContext(context: HetangQuerySemanticContext): boolean {
  return (
    context.hasDataKeyword ||
    context.metrics.supported.length > 0 ||
    context.metrics.unsupported.length > 0
  );
}

function resolveBaseRoute(
  context: HetangQuerySemanticContext,
  kind: HetangQueryIntentKind,
  overrides: Partial<HetangIntentRouteResolution> = {},
): HetangIntentRouteResolution {
  return {
    kind,
    confidence: "high",
    mentionsCompareKeyword: context.mentionsCompareKeyword,
    mentionsRankingKeyword: context.mentionsRankingKeyword,
    mentionsTrendKeyword: context.mentionsTrendKeyword,
    mentionsAnomalyKeyword: context.mentionsAnomalyKeyword,
    mentionsRiskKeyword: context.mentionsRiskKeyword,
    mentionsAdviceKeyword: context.mentionsAdviceKeyword,
    mentionsReportKeyword: context.mentionsReportKeyword,
    ...overrides,
  };
}

function hasHqPortfolioScope(context: HetangQuerySemanticContext): boolean {
  return (
    context.allStoresRequested ||
    context.explicitOrgIds.length > 1 ||
    /总部|全局|全盘|大盘|哪家/u.test(context.rawText)
  );
}

const ROUTE_REGISTRY: RouteDefinition[] = [
  {
    id: "hq-portfolio",
    when: (context) => context.mentionsHqPortfolioKeyword && hasHqPortfolioScope(context),
    resolve: (context) =>
      resolveBaseRoute(
        context,
        "hq_portfolio",
        context.routeSignals.hqStoreMixedScope
          ? {
              confidence: "low",
              requiresClarification: true,
              clarificationReason: "mixed-hq-and-single-store",
            }
          : {},
      ),
  },
  {
    id: "birthday-members",
    when: (context) => context.mentionsBirthdayKeyword,
    resolve: (context) => resolveBaseRoute(context, "birthday_members"),
  },
  {
    id: "arrival-profile",
    when: (context) => context.mentionsArrivalProfileKeyword,
    resolve: (context) => resolveBaseRoute(context, "arrival_profile"),
  },
  {
    id: "wait-experience",
    when: (context) => context.mentionsWaitExperienceKeyword,
    resolve: (context) => resolveBaseRoute(context, "wait_experience"),
  },
  {
    id: "recharge-attribution",
    when: (context) => context.mentionsRechargeAttributionKeyword,
    resolve: (context) => resolveBaseRoute(context, "recharge_attribution"),
  },
  {
    id: "member-marketing",
    when: (context) =>
      context.mentionsMemberMarketingKeyword && !context.routeSignals.rechargeCustomerHybrid,
    resolve: (context) => resolveBaseRoute(context, "member_marketing"),
  },
  {
    id: "customer-profile",
    when: (context) => context.mentionsPhoneSuffixKeyword,
    resolve: (context) => resolveBaseRoute(context, "customer_profile"),
  },
  {
    id: "customer-relation",
    when: (context) => context.mentionsCustomerRelationKeyword,
    resolve: (context) => resolveBaseRoute(context, "customer_relation"),
  },
  {
    id: "customer-segment",
    when: (context) =>
      context.semanticSlots.object === "customer" &&
      context.semanticSlots.action === "followup" &&
      !context.customerSegmentShouldYieldToMetric,
    resolve: (context) => resolveBaseRoute(context, "customer_segment"),
  },
  {
    id: "tech-profile",
    when: (context) => context.mentionsTechProfileKeyword,
    resolve: (context) => resolveBaseRoute(context, "tech_profile"),
  },
  {
    id: "tech-current",
    when: (context) => context.mentionsTechCurrentKeyword,
    resolve: (context) => resolveBaseRoute(context, "tech_current"),
  },
  {
    id: "tech-followup-ranking",
    when: (context) =>
      context.semanticSlots.object === "tech" &&
      context.semanticSlots.action === "followup" &&
      context.mentionsRankingKeyword,
    resolve: (context) => resolveBaseRoute(context, "customer_segment"),
  },
  {
    id: "ranking",
    when: (context) => context.mentionsRankingKeyword && hasBusinessFactContext(context),
    resolve: (context) => ({
      ...resolveBaseRoute(context, "ranking"),
      rankingTarget: /技师/u.test(context.semanticText) ? "tech" : "store",
      rankingOrder: /(最低|倒数|最差|末位)/u.test(context.semanticText) ? "asc" : "desc",
    }),
  },
  {
    id: "anomaly",
    when: (context) =>
      (context.mentionsAnomalyKeyword && hasBusinessFactContext(context)) ||
      (context.routeSignals.compareNeedsAttribution && context.hasStoreContext),
    resolve: (context) => resolveBaseRoute(context, "anomaly"),
  },
  {
    id: "compare",
    when: (context) => context.mentionsCompareKeyword && hasBusinessFactContext(context),
    resolve: (context) => resolveBaseRoute(context, "compare"),
  },
  {
    id: "risk",
    when: (context) => context.mentionsRiskKeyword && hasBusinessFactContext(context),
    resolve: (context) => resolveBaseRoute(context, "risk"),
  },
  {
    id: "report",
    when: (context) =>
      (context.mentionsReportKeyword || context.routeSignals.reportAdviceHybrid) &&
      hasBusinessFactContext(context),
    resolve: (context) => resolveBaseRoute(context, "report"),
  },
  {
    id: "advice",
    when: (context) =>
      context.mentionsAdviceKeyword &&
      !context.routeSignals.reportAdviceHybrid &&
      (hasBusinessFactContext(context) || context.hasStoreContext),
    resolve: (context) => resolveBaseRoute(context, "advice"),
  },
  {
    id: "trend",
    when: (context) =>
      context.mentionsTrendKeyword && context.hasStoreContext && hasBusinessFactContext(context),
    resolve: (context) => resolveBaseRoute(context, "trend"),
  },
  {
    id: "trend-with-metric",
    when: (context) =>
      context.mentionsTrendKeyword &&
      context.metrics.supported.length > 0 &&
      hasBusinessFactContext(context),
    resolve: (context) => resolveBaseRoute(context, "trend"),
  },
  {
    id: "metric",
    when: (context) => context.hasDataKeyword,
    resolve: (context) => resolveBaseRoute(context, "metric"),
  },
];

export function resolveHetangIntentRoute(
  context: HetangQuerySemanticContext,
): HetangIntentRouteResolution | null {
  for (const route of ROUTE_REGISTRY) {
    if (route.when(context)) {
      return route.resolve(context);
    }
  }
  return null;
}
