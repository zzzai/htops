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

export type HetangBridgeCapabilities = {
  version: "v1";
  entries: Array<"command" | "inbound">;
  query_graph_version?: string;
  serving_capability_count?: number;
  runtime_render_capability_count?: number;
  async_analysis_capability_count?: number;
  capability_node_count?: number;
};
