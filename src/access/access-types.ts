import type {
  HetangAccessRole,
  HetangCommandUsage,
  HetangEmployeeBinding,
  HetangQuotaOverrides,
} from "../types.js";

export type HetangCommandAction =
  | "action"
  | "analysis"
  | "chart"
  | "help"
  | "intel"
  | "learning"
  | "observation"
  | "queue"
  | "query"
  | "reactivation"
  | "report"
  | "review"
  | "status"
  | "sync"
  | "tower"
  | "whoami";

export type HetangAccessDecisionReason =
  | "help"
  | "whoami"
  | "unbound"
  | "disabled"
  | "role-denied"
  | "hourly-quota-exceeded"
  | "daily-quota-exceeded"
  | "hq-allowed"
  | "hq-only"
  | "binding-missing-org"
  | "manager-query-scope"
  | "manager-multi-store-requires-org"
  | "manager-cross-store"
  | "manager-own-store";

export type HetangAccessDecisionStatus = "allow" | "deny";

export type HetangAccessContext = {
  action: HetangCommandAction;
  actor: {
    channel?: string;
    sender_id?: string;
    employee_name?: string;
    role?: HetangAccessRole;
  };
  scope: {
    org_ids: string[];
    effective_org_id?: string;
    scope_kind: "single" | "multi" | "all" | "none";
  };
  decision: {
    status: HetangAccessDecisionStatus;
    reason: HetangAccessDecisionReason;
    consume_quota: boolean;
  };
  quotas: {
    hourly_limit: number;
    daily_limit: number;
    hourly_used: number;
    daily_used: number;
  };
};

export type HetangAccessContextParams = {
  action: HetangCommandAction;
  binding: HetangEmployeeBinding | null;
  usage: HetangCommandUsage;
  requestedOrgId?: string;
  quotaOverrides?: HetangQuotaOverrides;
};
