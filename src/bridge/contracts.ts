export type HetangBridgeReplyMode = "immediate" | "accepted" | "noop";

export type HetangBridgeReply = {
  mode: HetangBridgeReplyMode;
  text?: string;
};

export type HetangBridgeAudit = {
  entry: "command" | "inbound";
};

export type HetangBridgeResponse = {
  ok: boolean;
  handled: boolean;
  reply: HetangBridgeReply;
  job: { job_id: string } | null;
  audit: HetangBridgeAudit;
};

export type HetangBridgeMessageRequest = {
  request_id: string;
  channel: string;
  account_id?: string;
  sender_id?: string;
  sender_name?: string;
  conversation_id?: string;
  thread_id?: string;
  is_group: boolean;
  was_mentioned?: boolean;
  platform_message_id?: string;
  content: string;
  received_at: string;
};

export type HetangBridgeCommandRequest = HetangBridgeMessageRequest & {
  command_name?: string;
  args?: string;
  reply_target?: string;
};

export type HetangBridgeInboundRequest = HetangBridgeMessageRequest;

export type HetangBridgeAuditSurface = {
  entry: "command" | "inbound";
  sink: "command_audit_logs" | "inbound_message_audit_logs";
  persistence: "required" | "best_effort";
};

export type HetangBridgeObservabilityStream =
  | "route_compare_log"
  | "command_audit_log"
  | "inbound_audit_log";

export type HetangBridgeRequestDedupePolicy = {
  scope: "bridge_http";
  key_fields: Array<"request_id" | "platform_message_id">;
  ttl_ms: number;
};

export type HetangBridgeCapabilities = {
  version: "v1";
  entries: Array<"command" | "inbound">;
  audit_surfaces?: HetangBridgeAuditSurface[];
  observability_streams?: HetangBridgeObservabilityStream[];
  request_dedupe?: HetangBridgeRequestDedupePolicy;
  control_plane_contract_version?: string;
  tool_contract_version?: string;
  query_graph_version?: string;
  tool_count?: number;
  serving_capability_count?: number;
  runtime_render_capability_count?: number;
  async_analysis_capability_count?: number;
  capability_node_count?: number;
};
