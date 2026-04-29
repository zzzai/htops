import type { HetangCommandUsage, HetangEmployeeBinding, HetangQuotaOverrides } from "./types.js";
import { buildHetangAccessContext, resolveQuotaLimitsFromBinding } from "./access/access-context.js";
import type { HetangCommandAction } from "./access/access-types.js";

export type HetangCommandAccessResult = {
  allowed: boolean;
  action: HetangCommandAction;
  reason: string;
  effectiveOrgId?: string;
  hourlyLimit: number;
  dailyLimit: number;
  consumeQuota: boolean;
};

export function resolveHetangCommandAction(rawArgs: string): HetangCommandAction {
  const action = rawArgs.split(/\s+/u).filter(Boolean)[0]?.toLowerCase() ?? "help";
  if (
    action === "action" ||
    action === "analysis" ||
    action === "chart" ||
    action === "intel" ||
    action === "learning" ||
    action === "observation" ||
    action === "queue" ||
    action === "report" ||
    action === "reactivation" ||
    action === "review" ||
    action === "query" ||
    action === "status" ||
    action === "sync" ||
    action === "tower" ||
    action === "whoami"
  ) {
    return action;
  }
  return "help";
}

export function resolveQuotaLimits(binding: HetangEmployeeBinding | null): {
  hourlyLimit: number;
  dailyLimit: number;
};
export function resolveQuotaLimits(
  binding: HetangEmployeeBinding | null,
  overrides: HetangQuotaOverrides,
): {
  hourlyLimit: number;
  dailyLimit: number;
};
export function resolveQuotaLimits(
  binding: HetangEmployeeBinding | null,
  overrides?: HetangQuotaOverrides,
): {
  hourlyLimit: number;
  dailyLimit: number;
} {
  return resolveQuotaLimitsFromBinding(binding, overrides);
}

export function authorizeHetangCommand(params: {
  action: HetangCommandAction;
  binding: HetangEmployeeBinding | null;
  usage: HetangCommandUsage;
  requestedOrgId?: string;
  quotaOverrides?: HetangQuotaOverrides;
}): HetangCommandAccessResult {
  const context = buildHetangAccessContext(params);
  return {
    allowed: context.decision.status === "allow",
    action: params.action,
    reason: context.decision.reason,
    effectiveOrgId: context.scope.effective_org_id,
    hourlyLimit: context.quotas.hourly_limit,
    dailyLimit: context.quotas.daily_limit,
    consumeQuota: context.decision.consume_quota,
  };
}
