import type { HetangQueryIntent } from "../query-intent.js";
import { resolveHetangQuerySemanticContext } from "../query-semantics.js";
import type { HetangEmployeeBinding, HetangOpsConfig } from "../types.js";

const EXPLICIT_TIME_SCOPE_KEYWORDS =
  /(今天|今日|昨天|昨日|明天|前天|前日|前一日|前一天|上一日|上一天|本周|本月|上周|上月|下周|下月|最近|近期|这几天|近几天|最近这几天|前几天|未来\d+[天周月年]|近\d+[天周月年]|最近\d+[天周月年]|过去\d+[天周月年]|\d{4}-\d{2}-\d{2}|\d{4}年\s*\d{1,2}月(?:份)?|\d{4}年\s*\d{1,2}月\s*\d{1,2}日|\d{1,2}月(?:份)?|\d{1,2}月\s*\d{1,2}日)/u;
const GENERIC_TIME_REQUIRED_KEYWORDS =
  /(怎么样|如何|咋样|稳不稳|有没有问题|哪里有问题|哪儿有问题|怎么了|怎么看|日报|复盘|报告|风险|预警|建议|动作)/u;
const BUSINESS_DOMAIN_KEYWORDS =
  /(营收|收入|营业额|流水|经营|业绩|门店|店|会员|客户|顾客|技师|召回|唤回|跟进|复购|储值|开卡|沉默|团购|来源|充值|排班|钟效|点钟|加钟|等待|生日)/u;

export type ClarifierDecision =
  | { kind: "continue" }
  | {
      kind: "clarify";
      text: string;
      reason: "missing-store" | "missing-time" | "mixed-scope" | "missing-object-scope";
    };

function resolveAllowedOrgIds(
  binding: HetangEmployeeBinding | null | undefined,
  config: HetangOpsConfig,
): string[] {
  if (!binding || binding.isActive === false || binding.role === "disabled") {
    return [];
  }
  if (binding.scopeOrgIds && binding.scopeOrgIds.length > 0) {
    return binding.scopeOrgIds;
  }
  if (binding.orgId) {
    return [binding.orgId];
  }
  if (binding.role === "hq") {
    return config.stores.filter((store) => store.isActive !== false).map((store) => store.orgId);
  }
  return [];
}

function resolveStoreName(config: HetangOpsConfig, orgId: string): string | undefined {
  return config.stores.find((store) => store.orgId === orgId)?.storeName;
}

function resolveExampleStoreName(params: {
  config: HetangOpsConfig;
  explicitOrgIds: string[];
  allowedOrgIds: string[];
}): string {
  return (
    params.explicitOrgIds.map((orgId) => resolveStoreName(params.config, orgId)).find(Boolean) ??
    params.allowedOrgIds.map((orgId) => resolveStoreName(params.config, orgId)).find(Boolean) ??
    params.config.stores[0]?.storeName ??
    "义乌店"
  );
}

function looksBusinessLike(params: {
  ruleIntent?: HetangQueryIntent | null;
  semanticContext: ReturnType<typeof resolveHetangQuerySemanticContext>;
}): boolean {
  const context = params.semanticContext;
  if (BUSINESS_DOMAIN_KEYWORDS.test(context.semanticText)) {
    return true;
  }
  return (
    context.hasDataKeyword ||
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
    context.mentionsHqPortfolioKeyword
  );
}

function shouldClarifyMissingTime(params: {
  text: string;
  ruleIntent?: HetangQueryIntent | null;
  semanticContext: ReturnType<typeof resolveHetangQuerySemanticContext>;
  scopedStoreName?: string;
}): { text: string; reason: "missing-time" | "missing-object-scope" } | null {
  if (!params.scopedStoreName || EXPLICIT_TIME_SCOPE_KEYWORDS.test(params.text)) {
    return null;
  }

  const ruleKind = params.ruleIntent?.kind;
  if (
    GENERIC_TIME_REQUIRED_KEYWORDS.test(params.text) &&
    (ruleKind === "report" ||
      ruleKind === "metric" ||
      ruleKind === "risk" ||
      ruleKind === "hq_portfolio" ||
      BUSINESS_DOMAIN_KEYWORDS.test(params.text))
  ) {
    return {
      reason: "missing-time",
      text: `你要看${params.scopedStoreName}昨天、近7天还是近30天？`,
    };
  }

  return null;
}

export function resolveIntentClarifierDecision(params: {
  config: HetangOpsConfig;
  text: string;
  binding?: HetangEmployeeBinding | null;
  ruleIntent?: HetangQueryIntent | null;
}): ClarifierDecision {
  if (!params.config.conversationQuality.intentClarifier.enabled) {
    return { kind: "continue" };
  }

  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text: params.text,
  });
  if (!looksBusinessLike({ ruleIntent: params.ruleIntent, semanticContext })) {
    return { kind: "continue" };
  }

  const allowedOrgIds = resolveAllowedOrgIds(params.binding, params.config);
  const effectiveExplicitOrgIds = params.ruleIntent?.explicitOrgIds ?? semanticContext.explicitOrgIds;
  const effectiveAllStoresRequested =
    params.ruleIntent?.allStoresRequested ?? semanticContext.allStoresRequested;
  const exampleStoreName = resolveExampleStoreName({
    config: params.config,
    explicitOrgIds: effectiveExplicitOrgIds,
    allowedOrgIds,
  });

  if (
    semanticContext.routeSignals.hqStoreMixedScope ||
    params.ruleIntent?.clarificationReason === "mixed-hq-and-single-store" ||
    (effectiveAllStoresRequested &&
      effectiveExplicitOrgIds.length === 1 &&
      /(先看|再看|一起看|同时看)/u.test(params.text))
  ) {
    return {
      kind: "clarify",
      reason: "mixed-scope",
      text: `你是先看五店全景，还是先看${exampleStoreName}？拆成两句我会答得最准。`,
    };
  }

  if (
    !effectiveAllStoresRequested &&
    effectiveExplicitOrgIds.length === 0 &&
    allowedOrgIds.length !== 1 &&
    BUSINESS_DOMAIN_KEYWORDS.test(semanticContext.semanticText)
  ) {
    return {
      kind: "clarify",
      reason: "missing-store",
      text: `你是看哪家店？比如：${exampleStoreName}昨天营收多少。`,
    };
  }

  const scopedStoreName =
    (effectiveExplicitOrgIds.length === 1
      ? resolveStoreName(params.config, effectiveExplicitOrgIds[0])
      : undefined) ??
    (allowedOrgIds.length === 1 ? resolveStoreName(params.config, allowedOrgIds[0]) : undefined);
  const missingTimeDecision = shouldClarifyMissingTime({
    text: params.text,
    ruleIntent: params.ruleIntent,
    semanticContext,
    scopedStoreName,
  });
  if (missingTimeDecision) {
    return {
      kind: "clarify",
      reason: missingTimeDecision.reason,
      text: missingTimeDecision.text,
    };
  }

  return { kind: "continue" };
}
