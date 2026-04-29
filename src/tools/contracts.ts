import {
  resolveCapabilityGraphSelection,
  type CapabilityExecutionMode,
} from "../capability-graph.js";
import type { QueryPlan } from "../query-plan.js";

export type HetangToolName =
  | "get_store_daily_summary"
  | "get_store_risk_scan"
  | "get_member_recall_candidates"
  | "get_customer_profile"
  | "explain_metric_definition"
  | "search_operating_knowledge";

export const HETANG_TOOLS_CONTRACT_VERSION = "2026-04-29.tools.v2" as const;

export type HetangToolCallRequest = {
  request_id?: string;
  tool: HetangToolName | string;
  arguments?: Record<string, unknown>;
};

export type HetangToolLane = "query" | "meta";
export type HetangToolOwnerSurface = "tool_facade" | "metric_registry" | "knowledge_registry";

export type HetangToolArgumentSchemaProperty = {
  type: "string" | "integer";
  description: string;
  minimum?: number;
  maximum?: number;
};

export type HetangToolArgumentSchema = {
  type: "object";
  additionalProperties: false;
  properties: Record<string, HetangToolArgumentSchemaProperty>;
  required: string[];
};

export type HetangToolDescriptor = {
  name: HetangToolName;
  description: string;
  entry_role: "function_call_entry_adapter";
  lane: HetangToolLane;
  owner_surface: HetangToolOwnerSurface;
  semantic_capability_ids: string[];
  arguments_schema: HetangToolArgumentSchema;
  input_contract_notes?: string[];
};

export type HetangToolsCapabilities = {
  version: "v1";
  contract_version: typeof HETANG_TOOLS_CONTRACT_VERSION;
  execution_boundary: {
    entry_role: "function_call_entry_adapter";
    access_mode: "read_only";
    business_logic_owner: "owner_modules";
  };
  request_dedupe?: {
    scope: "tools_http";
    key_fields: Array<"request_id">;
    ttl_ms: number;
  };
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

function buildToolQueryPlan(params: {
  entity: QueryPlan["entity"];
  action: QueryPlan["action"];
  time: QueryPlan["time"];
  metrics: string[];
  dimensions: string[];
  responseShape: QueryPlan["response_shape"];
}): QueryPlan {
  return {
    plan_version: "v1",
    request_id: `tool-contract:${params.entity}:${params.action}`,
    entity: params.entity,
    scope: {
      org_ids: ["tool-contract-org"],
      scope_kind: "single",
      access_scope_kind: "manager",
    },
    time: params.time,
    action: params.action,
    metrics: params.metrics,
    dimensions: params.dimensions,
    filters: [],
    response_shape: params.responseShape,
    planner_meta: {
      confidence: 1,
      source: "rule",
      normalized_question: "tool contract capability binding",
      clarification_needed: false,
    },
  };
}

function collectCapabilityIdsFromPlan(
  plan: QueryPlan,
  executionModes: CapabilityExecutionMode[],
): string[] {
  const ids: string[] = [];
  for (const executionMode of executionModes) {
    const capabilityId = resolveCapabilityGraphSelection({
      plan,
      executionMode,
    }).node?.capability_id;
    if (capabilityId && !ids.includes(capabilityId)) {
      ids.push(capabilityId);
    }
  }
  return ids;
}

function resolveToolSemanticCapabilityIds(toolName: HetangToolName): string[] {
  switch (toolName) {
    case "get_store_daily_summary":
      return collectCapabilityIdsFromPlan(
        buildToolQueryPlan({
          entity: "store",
          action: "summary",
          time: {
            mode: "day",
            biz_date: "2026-04-16",
          },
          metrics: ["serviceRevenue"],
          dimensions: [],
          responseShape: "scalar",
        }),
        ["serving_sql"],
      );
    case "get_store_risk_scan":
      return collectCapabilityIdsFromPlan(
        buildToolQueryPlan({
          entity: "store",
          action: "risk",
          time: {
            mode: "window",
            start_biz_date: "2026-04-10",
            end_biz_date: "2026-04-16",
            window_days: 7,
          },
          metrics: ["riskScore"],
          dimensions: [],
          responseShape: "narrative",
        }),
        ["runtime_render"],
      );
    case "get_member_recall_candidates":
      return collectCapabilityIdsFromPlan(
        buildToolQueryPlan({
          entity: "customer_profile",
          action: "list",
          time: {
            mode: "as_of",
            as_of_biz_date: "2026-04-16",
          },
          metrics: ["followupScore"],
          dimensions: [],
          responseShape: "ranking_list",
        }),
        ["serving_sql", "runtime_render"],
      );
    case "get_customer_profile":
      return collectCapabilityIdsFromPlan(
        buildToolQueryPlan({
          entity: "customer_profile",
          action: "profile",
          time: {
            mode: "as_of",
            as_of_biz_date: "2026-04-16",
          },
          metrics: [],
          dimensions: [],
          responseShape: "profile_card",
        }),
        ["serving_sql", "runtime_render"],
      );
    case "explain_metric_definition":
    case "search_operating_knowledge":
      return [];
  }
}

const HETANG_TOOL_DESCRIPTORS: HetangToolDescriptor[] = [
  {
    name: "get_store_daily_summary",
    description: "Return one store's daily KPI snapshot for a single business date.",
    entry_role: "function_call_entry_adapter",
    lane: "query",
    owner_surface: "tool_facade",
    semantic_capability_ids: resolveToolSemanticCapabilityIds("get_store_daily_summary"),
    arguments_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        store: {
          type: "string",
          description: "Store name or alias. Provide this or org_id.",
        },
        org_id: {
          type: "string",
          description: "Store org_id. Provide this or store.",
        },
        biz_date: {
          type: "string",
          description: "Business date in YYYY-MM-DD. Defaults to today's local business date.",
        },
      },
      required: [],
    },
    input_contract_notes: ["Provide at least one of: store, org_id."],
  },
  {
    name: "get_store_risk_scan",
    description: "Return rule-based 7d/30d operating risk signals for a store.",
    entry_role: "function_call_entry_adapter",
    lane: "query",
    owner_surface: "tool_facade",
    semantic_capability_ids: resolveToolSemanticCapabilityIds("get_store_risk_scan"),
    arguments_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        store: {
          type: "string",
          description: "Store name or alias. Provide this or org_id.",
        },
        org_id: {
          type: "string",
          description: "Store org_id. Provide this or store.",
        },
        biz_date: {
          type: "string",
          description: "Window end business date in YYYY-MM-DD. Defaults to today's local business date.",
        },
      },
      required: [],
    },
    input_contract_notes: ["Provide at least one of: store, org_id."],
  },
  {
    name: "get_member_recall_candidates",
    description: "Return ranked member recall candidates with feature and strategy hints.",
    entry_role: "function_call_entry_adapter",
    lane: "query",
    owner_surface: "tool_facade",
    semantic_capability_ids: resolveToolSemanticCapabilityIds("get_member_recall_candidates"),
    arguments_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        store: {
          type: "string",
          description: "Store name or alias. Provide this or org_id.",
        },
        org_id: {
          type: "string",
          description: "Store org_id. Provide this or store.",
        },
        biz_date: {
          type: "string",
          description: "Snapshot business date in YYYY-MM-DD. Defaults to today's local business date.",
        },
        limit: {
          type: "integer",
          description: "Maximum candidate rows to return. Defaults to 10.",
          minimum: 1,
          maximum: 50,
        },
      },
      required: [],
    },
    input_contract_notes: [
      "Provide at least one of: store, org_id.",
      "limit is clamped to the range 1..50.",
    ],
  },
  {
    name: "get_customer_profile",
    description: "Return a deterministic customer/member profile lookup for one store.",
    entry_role: "function_call_entry_adapter",
    lane: "query",
    owner_surface: "tool_facade",
    semantic_capability_ids: resolveToolSemanticCapabilityIds("get_customer_profile"),
    arguments_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        store: {
          type: "string",
          description: "Store name or alias. Provide this or org_id.",
        },
        org_id: {
          type: "string",
          description: "Store org_id. Provide this or store.",
        },
        biz_date: {
          type: "string",
          description: "Snapshot business date in YYYY-MM-DD. Defaults to today's local business date.",
        },
        phone_suffix: {
          type: "string",
          description: "Customer/member phone suffix for deterministic lookup.",
        },
        member_id: {
          type: "string",
          description: "Member id for deterministic lookup.",
        },
      },
      required: [],
    },
    input_contract_notes: [
      "Provide at least one of: store, org_id.",
      "Provide at least one of: phone_suffix, member_id.",
    ],
  },
  {
    name: "explain_metric_definition",
    description: "Return the canonical metric definition and aliases for one KPI.",
    entry_role: "function_call_entry_adapter",
    lane: "meta",
    owner_surface: "metric_registry",
    semantic_capability_ids: resolveToolSemanticCapabilityIds("explain_metric_definition"),
    arguments_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        metric: {
          type: "string",
          description: "Metric selector text. Provide this or a more explicit selector below.",
        },
        metric_key: {
          type: "string",
          description: "Exact metric key when known.",
        },
        metric_label: {
          type: "string",
          description: "Chinese metric label when known.",
        },
        text: {
          type: "string",
          description: "Original natural language metric phrase.",
        },
      },
      required: [],
    },
    input_contract_notes: ["Provide at least one of: metric, metric_key, metric_label, text."],
  },
  {
    name: "search_operating_knowledge",
    description: "Search the bounded knowledge registry for rules, SOPs, and metric/report definitions.",
    entry_role: "function_call_entry_adapter",
    lane: "meta",
    owner_surface: "knowledge_registry",
    semantic_capability_ids: resolveToolSemanticCapabilityIds("search_operating_knowledge"),
    arguments_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "Natural-language search phrase such as 营收口径, 优惠券规则, or 运行SOP.",
        },
        domain: {
          type: "string",
          description: "Optional knowledge domain filter such as metric_definition or store_sop.",
        },
        limit: {
          type: "integer",
          description: "Maximum document hits to return. Defaults to 5.",
          minimum: 1,
          maximum: 20,
        },
      },
      required: ["query"],
    },
    input_contract_notes: [
      "Only searches bounded knowledge domains such as metric definitions, SOPs, and policy/rule docs.",
      "Does not search structured business facts or raw operating流水.",
    ],
  },
];

export function listHetangToolDescriptors(): HetangToolDescriptor[] {
  return HETANG_TOOL_DESCRIPTORS.map((descriptor) => ({
    ...descriptor,
    semantic_capability_ids: [...descriptor.semantic_capability_ids],
    arguments_schema: {
      ...descriptor.arguments_schema,
      properties: { ...descriptor.arguments_schema.properties },
      required: [...descriptor.arguments_schema.required],
    },
    input_contract_notes: descriptor.input_contract_notes
      ? [...descriptor.input_contract_notes]
      : undefined,
  }));
}

export function buildHetangToolsCapabilities(): HetangToolsCapabilities {
  return {
    version: "v1",
    contract_version: HETANG_TOOLS_CONTRACT_VERSION,
    execution_boundary: {
      entry_role: "function_call_entry_adapter",
      access_mode: "read_only",
      business_logic_owner: "owner_modules",
    },
    tools: listHetangToolDescriptors(),
  };
}
