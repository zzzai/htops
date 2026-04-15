export type HetangToolName =
  | "get_store_daily_summary"
  | "get_store_risk_scan"
  | "get_member_recall_candidates"
  | "get_customer_profile"
  | "explain_metric_definition";

export type HetangToolCallRequest = {
  request_id?: string;
  tool: HetangToolName | string;
  arguments?: Record<string, unknown>;
};

export type HetangToolDescriptor = {
  name: HetangToolName;
  description: string;
};

export type HetangToolsCapabilities = {
  version: "v1";
  tools: HetangToolDescriptor[];
};

export type HetangToolSuccessResponse = {
  ok: true;
  tool: HetangToolName;
  result: Record<string, unknown>;
};

export type HetangToolErrorResponse = {
  ok: false;
  error: string;
  detail?: string;
};

