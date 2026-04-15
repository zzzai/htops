import type { HetangQuotaOverrides, HetangEmployeeBinding } from "../types.js";
import type {
  HetangAccessContext,
  HetangAccessContextParams,
  HetangAccessDecisionReason,
} from "./access-types.js";

const ROLE_DEFAULT_LIMITS = {
  hq: { hourly: 15, daily: 80 },
  manager: { hourly: 6, daily: 30 },
  staff: { hourly: 0, daily: 0 },
  disabled: { hourly: 0, daily: 0 },
} as const;

function resolveBindingScopeOrgIds(binding: HetangEmployeeBinding): string[] {
  if (binding.scopeOrgIds && binding.scopeOrgIds.length > 0) {
    return binding.scopeOrgIds;
  }
  return binding.orgId ? [binding.orgId] : [];
}

export function resolveQuotaLimitsFromBinding(
  binding: HetangEmployeeBinding | null,
  overrides?: HetangQuotaOverrides,
): {
  hourlyLimit: number;
  dailyLimit: number;
} {
  if (!binding) {
    return { hourlyLimit: 0, dailyLimit: 0 };
  }
  const defaults = ROLE_DEFAULT_LIMITS[binding.role];
  return {
    hourlyLimit: overrides?.hourlyLimit ?? binding.hourlyQuota ?? defaults.hourly,
    dailyLimit: overrides?.dailyLimit ?? binding.dailyQuota ?? defaults.daily,
  };
}

function buildContext(params: {
  action: HetangAccessContextParams["action"];
  binding: HetangAccessContextParams["binding"];
  usage: HetangAccessContextParams["usage"];
  quotaOverrides?: HetangAccessContextParams["quotaOverrides"];
  requestedOrgId?: string;
  orgIds?: string[];
  scopeKind?: HetangAccessContext["scope"]["scope_kind"];
  effectiveOrgId?: string;
  reason: HetangAccessDecisionReason;
  status: HetangAccessContext["decision"]["status"];
  consumeQuota: boolean;
}): HetangAccessContext {
  const limits = resolveQuotaLimitsFromBinding(params.binding, params.quotaOverrides);
  return {
    action: params.action,
    actor: {
      channel: params.binding?.channel,
      sender_id: params.binding?.senderId,
      employee_name: params.binding?.employeeName,
      role: params.binding?.role,
    },
    scope: {
      org_ids: params.orgIds ?? [],
      effective_org_id: params.effectiveOrgId,
      scope_kind: params.scopeKind ?? "none",
    },
    decision: {
      status: params.status,
      reason: params.reason,
      consume_quota: params.consumeQuota,
    },
    quotas: {
      hourly_limit: limits.hourlyLimit,
      daily_limit: limits.dailyLimit,
      hourly_used: params.usage.hourlyCount,
      daily_used: params.usage.dailyCount,
    },
  };
}

export function buildHetangAccessContext(params: HetangAccessContextParams): HetangAccessContext {
  const consumeQuota =
    params.action === "report" ||
    params.action === "query" ||
    params.action === "status" ||
    params.action === "sync";
  const limits = resolveQuotaLimitsFromBinding(params.binding, params.quotaOverrides);

  if (params.action === "help" || params.action === "whoami") {
    const orgIds = params.binding ? resolveBindingScopeOrgIds(params.binding) : [];
    const scopeKind =
      params.binding?.role === "hq" && orgIds.length === 0
        ? "all"
        : orgIds.length > 1
          ? "multi"
          : orgIds.length === 1
            ? "single"
            : "none";
    return buildContext({
      ...params,
      orgIds,
      scopeKind,
      reason: params.action,
      status: "allow",
      consumeQuota: false,
    });
  }

  if (!params.binding) {
    return buildContext({
      ...params,
      reason: "unbound",
      status: "deny",
      consumeQuota,
    });
  }

  const allowedOrgIds = resolveBindingScopeOrgIds(params.binding);
  const scopeKind =
    params.binding.role === "hq" && allowedOrgIds.length === 0
      ? "all"
      : allowedOrgIds.length > 1
        ? "multi"
        : allowedOrgIds.length === 1
          ? "single"
          : "none";

  if (!params.binding.isActive || params.binding.role === "disabled") {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason: "disabled",
      status: "deny",
      consumeQuota,
    });
  }

  if (params.binding.role === "staff") {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason: "role-denied",
      status: "deny",
      consumeQuota,
    });
  }

  if (
    consumeQuota &&
    (limits.hourlyLimit <= 0 ||
      limits.dailyLimit <= 0 ||
      params.usage.hourlyCount >= limits.hourlyLimit ||
      params.usage.dailyCount >= limits.dailyLimit)
  ) {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason:
        params.usage.hourlyCount >= limits.hourlyLimit
          ? "hourly-quota-exceeded"
          : "daily-quota-exceeded",
      status: "deny",
      consumeQuota,
    });
  }

  if (params.binding.role === "hq") {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      effectiveOrgId: params.requestedOrgId,
      reason: "hq-allowed",
      status: "allow",
      consumeQuota,
    });
  }

  if (
    params.action === "intel" ||
    params.action === "status" ||
    params.action === "sync" ||
    params.action === "tower"
  ) {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason: "hq-only",
      status: "deny",
      consumeQuota,
    });
  }

  if (params.action === "query") {
    if (allowedOrgIds.length === 0) {
      return buildContext({
        ...params,
        orgIds: allowedOrgIds,
        scopeKind,
        reason: "binding-missing-org",
        status: "deny",
        consumeQuota,
      });
    }
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason: "manager-query-scope",
      status: "allow",
      consumeQuota,
    });
  }

  if (allowedOrgIds.length === 0) {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason: "binding-missing-org",
      status: "deny",
      consumeQuota,
    });
  }

  if (!params.requestedOrgId && allowedOrgIds.length > 1) {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason: "manager-multi-store-requires-org",
      status: "deny",
      consumeQuota,
    });
  }

  const effectiveOrgId = params.requestedOrgId ?? allowedOrgIds[0];
  if (!effectiveOrgId || !allowedOrgIds.includes(effectiveOrgId)) {
    return buildContext({
      ...params,
      orgIds: allowedOrgIds,
      scopeKind,
      reason: "manager-cross-store",
      status: "deny",
      consumeQuota,
    });
  }

  return buildContext({
    ...params,
    orgIds: allowedOrgIds,
    scopeKind,
    effectiveOrgId,
    reason: "manager-own-store",
    status: "allow",
    consumeQuota,
  });
}
