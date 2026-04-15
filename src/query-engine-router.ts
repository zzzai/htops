import { renderSemanticClarificationText } from "./ai-semantic-fallback.js";
import {
  resolveServingCustomerSegmentCountMatch,
  resolveServingCustomerSegmentListMatch,
  resolveServingCustomerSegmentTechBindingRankingMatch,
} from "./customer-query.js";
import type { QueryPlan } from "./query-plan.js";
import type { HetangQueryIntent } from "./query-intent.js";
import type { HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

export function resolveBindingScopeOrgIds(
  binding: HetangEmployeeBinding,
  config: HetangOpsConfig,
): string[] {
  if (
    binding.role === "hq" &&
    (!binding.scopeOrgIds || binding.scopeOrgIds.length === 0) &&
    !binding.orgId
  ) {
    return config.stores.filter((entry) => entry.isActive).map((entry) => entry.orgId);
  }
  if (binding.scopeOrgIds && binding.scopeOrgIds.length > 0) {
    return binding.scopeOrgIds;
  }
  return binding.orgId ? [binding.orgId] : [];
}

export function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

export function renderQueryClarification(
  intent: HetangQueryIntent,
  config: HetangOpsConfig,
): string {
  return renderSemanticClarificationText({
    reason: intent.clarificationReason,
    storeName:
      intent.explicitOrgIds.length === 1
        ? getStoreName(config, intent.explicitOrgIds[0] ?? "")
        : undefined,
  });
}

export function resolveAccessScopeKind(
  binding: HetangEmployeeBinding,
): QueryPlan["scope"]["access_scope_kind"] {
  if (binding.role === "hq") {
    return "hq";
  }
  return "manager";
}

export function renderAmbiguousStoreMessage(
  binding: HetangEmployeeBinding,
  config: HetangOpsConfig,
): string {
  const scopeOrgIds = resolveBindingScopeOrgIds(binding, config);
  const scopeNames = scopeOrgIds.map((orgId) => getStoreName(config, orgId)).join("、");
  return `当前账号已绑定多个门店（${scopeNames}），请在问题里带上门店名，或直接问“昨天各店营收排名”。`;
}

export function resolveEffectiveOrgIds(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding;
  intent: HetangQueryIntent;
}): { ok: true; orgIds: string[] } | { ok: false; text: string } {
  const allowedOrgIds = resolveBindingScopeOrgIds(params.binding, params.config);
  const explicitOrgIds = params.intent.explicitOrgIds;
  if (explicitOrgIds.length > 0) {
    const disallowed = explicitOrgIds.filter((orgId) => !allowedOrgIds.includes(orgId));
    if (disallowed.length > 0) {
      return { ok: false, text: "当前账号仅允许查看绑定门店数据。" };
    }
    return { ok: true, orgIds: explicitOrgIds };
  }

  if (
    params.intent.allStoresRequested ||
    params.intent.kind === "hq_portfolio" ||
    (params.intent.kind === "ranking" && params.intent.rankingTarget === "store")
  ) {
    return { ok: true, orgIds: allowedOrgIds };
  }

  if (allowedOrgIds.length === 1) {
    return { ok: true, orgIds: allowedOrgIds };
  }

  return { ok: false, text: renderAmbiguousStoreMessage(params.binding, params.config) };
}
