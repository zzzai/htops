import { getStoreByOrgId } from "./config.js";
import { resolveAsyncAnalysisCapability } from "./capability-graph.js";
import { resolveHetangQueryIntent } from "./query-intent.js";
import { mentionsConfiguredStore } from "./store-aliases.js";
import type { HetangAnalysisJobType, HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

const DEEP_ANALYSIS_KEYWORDS =
  /(复盘|深度分析|经营诊断|经营分析|问题所在|哪里有问题|有什么问题|全面分析|指导意见|改进建议)/u;
const WEEKLY_DIAGNOSIS_KEYWORDS = /(经营数据|经营情况|周报|周度情况|一周情况)/u;
const CROSS_STORE_SCOPE_KEYWORDS =
  /(五店|5店|5个店|5家店|全部门店|所有门店|各店|所有店|全部店|五家店|五个店|哪家店|哪一家店|哪个店|哪家门店|哪一家门店|哪个门店)/u;
const ANALYSIS_SCOPE_PREFIX = "scope:";
export const HETANG_BINDING_SCOPE_ORG_ID = "__binding_scope__";

export type HetangNaturalLanguageCommand = {
  action: "query";
  args: string;
  commandBody: string;
};

export type HetangNaturalLanguageAnalysis = {
  action: "analysis";
  capabilityId?: string;
  request: {
    jobType: HetangAnalysisJobType;
    orgId: string;
    storeName: string;
    rawText: string;
    timeFrameLabel: string;
    startBizDate: string;
    endBizDate: string;
  };
};

export type HetangNaturalLanguageRoute =
  | HetangNaturalLanguageCommand
  | HetangNaturalLanguageAnalysis;

function resolveActiveStoreOrgIds(config: HetangOpsConfig): string[] {
  return config.stores.filter((store) => store.isActive).map((store) => store.orgId);
}

function resolveBindingScopeOrgIds(
  config: HetangOpsConfig,
  binding: HetangEmployeeBinding | null | undefined,
): string[] {
  if (!binding || binding.isActive === false || binding.role === "disabled") {
    return [];
  }
  if (binding.scopeOrgIds && binding.scopeOrgIds.length > 0) {
    return Array.from(new Set(binding.scopeOrgIds));
  }
  if (binding.orgId) {
    return [binding.orgId];
  }
  if (binding.role === "hq") {
    return resolveActiveStoreOrgIds(config);
  }
  return [];
}

function formatScopeStoreName(orgIds: string[]): string {
  if (orgIds.length === 0) {
    return "多店";
  }
  if (orgIds.length === 1) {
    return orgIds[0] ?? "门店";
  }
  if (orgIds.length === 5) {
    return "五店";
  }
  return `${orgIds.length}店`;
}

export function encodeHetangAnalysisScopeOrgId(orgIds: string[]): string {
  const scopeOrgIds = Array.from(new Set(orgIds.filter(Boolean)));
  if (scopeOrgIds.length <= 1) {
    return scopeOrgIds[0] ?? HETANG_BINDING_SCOPE_ORG_ID;
  }
  return `${ANALYSIS_SCOPE_PREFIX}${scopeOrgIds.join(",")}`;
}

export function decodeHetangAnalysisScopeOrgId(orgId: string): string[] | null {
  if (orgId === "all") {
    return [];
  }
  if (!orgId.startsWith(ANALYSIS_SCOPE_PREFIX)) {
    return null;
  }
  return orgId
    .slice(ANALYSIS_SCOPE_PREFIX.length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function resolveHetangAnalysisStoreName(params: {
  config: HetangOpsConfig;
  orgId: string;
  fallbackScopeOrgIds?: string[];
}): string {
  const decodedScopeOrgIds = decodeHetangAnalysisScopeOrgId(params.orgId);
  if (decodedScopeOrgIds !== null || params.orgId === HETANG_BINDING_SCOPE_ORG_ID) {
    const scopeOrgIds =
      decodedScopeOrgIds && decodedScopeOrgIds.length > 0
        ? decodedScopeOrgIds
        : params.fallbackScopeOrgIds ?? resolveActiveStoreOrgIds(params.config);
    if (scopeOrgIds.length === 1) {
      return getStoreByOrgId(params.config, scopeOrgIds[0] ?? "")?.storeName ?? scopeOrgIds[0]!;
    }
    return formatScopeStoreName(scopeOrgIds);
  }
  return getStoreByOrgId(params.config, params.orgId)?.storeName ?? params.orgId;
}

export function materializeHetangAnalysisRequest(params: {
  config: HetangOpsConfig;
  binding?: HetangEmployeeBinding | null;
  request: HetangNaturalLanguageAnalysis["request"];
}): HetangNaturalLanguageAnalysis["request"] {
  if (params.request.orgId !== HETANG_BINDING_SCOPE_ORG_ID) {
    return params.request;
  }
  const scopeOrgIds = resolveBindingScopeOrgIds(params.config, params.binding);
  const orgId = encodeHetangAnalysisScopeOrgId(scopeOrgIds);
  return {
    ...params.request,
    orgId,
    storeName: resolveHetangAnalysisStoreName({
      config: params.config,
      orgId,
      fallbackScopeOrgIds: scopeOrgIds,
    }),
  };
}

function resolveAnalysisRoute(params: {
  config: HetangOpsConfig;
  text: string;
  now: Date;
  defaultOrgId?: string;
}): HetangNaturalLanguageAnalysis | null {
  const routingText = applyDefaultStoreContext(params.config, params.text, params.defaultOrgId);
  const intent = resolveHetangQueryIntent({
    config: params.config,
    text: routingText,
    now: params.now,
  });
  if (!intent) {
    return null;
  }
  const isPortfolioReview = intent.kind === "hq_portfolio";
  if (!isPortfolioReview && intent.explicitOrgIds.length !== 1) {
    return null;
  }
  if (intent.timeFrame.kind !== "range") {
    return null;
  }
  const explicitDeepAnalysis = DEEP_ANALYSIS_KEYWORDS.test(params.text);
  const weeklyProblemReview =
    WEEKLY_DIAGNOSIS_KEYWORDS.test(params.text) && /(问题|建议|指导)/u.test(params.text);
  // Keep deep review as an explicit opt-in so everyday boss-style asks stay on the fast SQL path.
  if (!explicitDeepAnalysis && !weeklyProblemReview) {
    return null;
  }

  return {
    action: "analysis",
    capabilityId: resolveAsyncAnalysisCapability({
      jobType: "store_review",
      portfolioScope: isPortfolioReview,
    })?.capability_id,
    request: {
      jobType: "store_review",
      orgId: isPortfolioReview
        ? HETANG_BINDING_SCOPE_ORG_ID
        : (getStoreByOrgId(params.config, intent.explicitOrgIds[0] ?? "")?.orgId ?? ""),
      storeName: isPortfolioReview
        ? "五店"
        : (getStoreByOrgId(params.config, intent.explicitOrgIds[0] ?? "")?.storeName ?? "门店"),
      rawText: params.text,
      timeFrameLabel: intent.timeFrame.label,
      startBizDate: intent.timeFrame.startBizDate,
      endBizDate: intent.timeFrame.endBizDate,
    },
  };
}

function applyDefaultStoreContext(
  config: HetangOpsConfig,
  text: string,
  defaultOrgId?: string,
): string {
  if (
    !defaultOrgId ||
    CROSS_STORE_SCOPE_KEYWORDS.test(text) ||
    mentionsConfiguredStore(config, text)
  ) {
    return text;
  }
  const store = getStoreByOrgId(config, defaultOrgId);
  if (!store) {
    return text;
  }
  return `${store.storeName}${text}`;
}

export function resolveHetangNaturalLanguageRoute(params: {
  config: HetangOpsConfig;
  content: string;
  now: Date;
  defaultOrgId?: string;
}): HetangNaturalLanguageRoute | null {
  const text = params.content.trim();
  if (!text || text.startsWith("/")) {
    return null;
  }
  const routingText = applyDefaultStoreContext(params.config, text, params.defaultOrgId);

  const analysis = resolveAnalysisRoute({
    config: params.config,
    text,
    now: params.now,
    defaultOrgId: params.defaultOrgId,
  });
  if (analysis) {
    return analysis;
  }

  const intent = resolveHetangQueryIntent({
    config: params.config,
    text: routingText,
    now: params.now,
  });
  if (!intent) {
    return null;
  }

  return {
    action: "query",
    args: `query ${text}`,
    commandBody: `/hetang query ${text}`,
  };
}
