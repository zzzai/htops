import { resolveStoreOrgId } from "../config.js";
import {
  executeControlledDataExplorer,
  type ControlledDataExplorerFilter,
  type ControlledDataExplorerRequest,
} from "../controlled-data-explorer.js";
import { lookupStructuredCustomerProfile } from "../customer-growth/profile.js";
import { lookupStructuredMemberRecallCandidates } from "../customer-growth/query.js";
import {
  lookupStructuredStoreDailySummary,
  lookupStructuredStoreRiskScan,
} from "../store-query.js";
import {
  findSupportedMetricDefinition,
  type HetangSupportedMetricKey,
} from "../metric-query.js";
import { searchOperatingKnowledgeCatalog } from "../semantic-operating-contract.js";
import { resolveLocalDate } from "../time.js";
import type {
  ConsumeBillRecord,
  CustomerOperatingProfileDailyRecord,
  CustomerOperatingSignalRecord,
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerServiceObservationRecord,
  CustomerTechLinkRecord,
  HetangLogger,
  HetangOpsConfig,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechMarketRecord,
  TechUpClockRecord,
} from "../types.js";
import {
  buildHetangToolsCapabilities,
  listHetangToolDescriptors,
} from "./contracts.js";
import type { HetangToolCallRequest, HetangToolName } from "./contracts.js";

type HetangToolsRuntime = {
  listStoreManagerDailyKpiByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreManagerDailyKpiRow[]>;
  listStoreReview7dByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreReview7dRow[]>;
  listStoreSummary30dByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreSummary30dRow[]>;
  listMemberReactivationQueue: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationQueueRecord[]>;
  listMemberReactivationFeatures: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationFeatureRecord[]>;
  listMemberReactivationStrategies: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationStrategyRecord[]>;
  findCurrentMembersByPhoneSuffix: (params: {
    orgId: string;
    phoneSuffix: string;
  }) => Promise<MemberCurrentRecord[]>;
  listCurrentMembers: (params: { orgId: string }) => Promise<MemberCurrentRecord[]>;
  listCurrentMemberCards?: (params: { orgId: string }) => Promise<MemberCardCurrentRecord[]>;
  listConsumeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<ConsumeBillRecord[]>;
  listCustomerTechLinks?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listCustomerTechLinksByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listTechUpClockByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechUpClockRecord[]>;
  listTechMarketByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechMarketRecord[]>;
  listCustomerSegments?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
  listCustomerProfile90dByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerProfile90dRow[]>;
  listCustomerOperatingProfilesDaily?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerOperatingProfileDailyRecord[]>;
  listCustomerOperatingSignals?: (params: {
    orgId: string;
    memberId?: string;
    customerIdentityKey?: string;
    signalDomain?: string;
    limit?: number;
  }) => Promise<CustomerOperatingSignalRecord[]>;
  listCustomerServiceObservations?: (params: {
    orgId: string;
    memberId?: string;
    customerIdentityKey?: string;
    signalDomain?: string;
    limit?: number;
  }) => Promise<CustomerServiceObservationRecord[]>;
  executeCompiledServingQuery: (params: {
    sql: string;
    queryParams?: unknown[];
    cacheKey?: string;
    ttlSeconds?: number;
  }) => Promise<Record<string, unknown>[]>;
};

const TOOL_DESCRIPTORS = listHetangToolDescriptors();

export class HetangToolError extends Error {
  statusCode: number;
  errorCode: string;

  constructor(statusCode: number, errorCode: string, message?: string) {
    super(message ?? errorCode);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function resolveBizDate(
  config: HetangOpsConfig,
  args: Record<string, unknown>,
  now: () => Date,
): string {
  return readString(args.biz_date) ?? resolveLocalDate(now(), config.timeZone);
}

function resolveStoreContext(config: HetangOpsConfig, args: Record<string, unknown>) {
  const explicitOrgId = readString(args.org_id);
  const orgId = explicitOrgId ?? resolveStoreOrgId(config, readString(args.store) ?? "");
  if (!orgId) {
    throw new HetangToolError(400, "store_required", "Missing store/org selector.");
  }
  const store = config.stores.find((entry) => entry.orgId === orgId);
  if (!store) {
    throw new HetangToolError(404, "store_not_found", `Unknown store org_id: ${orgId}`);
  }
  return {
    orgId,
    storeName: store.storeName,
  };
}

function requireToolName(value: string): HetangToolName {
  if (TOOL_DESCRIPTORS.some((entry) => entry.name === value)) {
    return value as HetangToolName;
  }
  throw new HetangToolError(404, "unknown_tool", `Unknown tool: ${value}`);
}

async function getStoreDailySummary(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const result = await lookupStructuredStoreDailySummary({
    runtime: params.runtime,
    config: params.config,
    orgId: store.orgId,
    bizDate,
  });
  if (!result) {
    throw new HetangToolError(404, "store_daily_summary_not_found");
  }
  return result;
}

async function getStoreRiskScan(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const result = await lookupStructuredStoreRiskScan({
    runtime: params.runtime,
    config: params.config,
    orgId: store.orgId,
    bizDate,
  });
  if (!result) {
    throw new HetangToolError(404, "store_risk_scan_not_found");
  }
  return result;
}

async function getMemberRecallCandidates(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const limit = clampInteger(readNumber(params.args.limit) ?? 10, 1, 50);
  return lookupStructuredMemberRecallCandidates({
    runtime: params.runtime,
    config: params.config,
    orgId: store.orgId,
    bizDate,
    limit,
  });
}

async function getCustomerProfile(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const phoneSuffix = readString(params.args.phone_suffix);
  const memberId = readString(params.args.member_id);
  if (!phoneSuffix && !memberId) {
    throw new HetangToolError(
      400,
      "customer_selector_required",
      "Provide phone_suffix or member_id.",
    );
  }
  const result = await lookupStructuredCustomerProfile({
    runtime: params.runtime,
    config: params.config,
    orgId: store.orgId,
    bizDate,
    phoneSuffix,
    memberId,
    now: params.now(),
  });
  if (!result) {
    throw new HetangToolError(404, "customer_not_found");
  }
  return result;
}

function explainMetricDefinition(args: Record<string, unknown>) {
  const metric =
    readString(args.metric) ??
    readString(args.metric_key) ??
    readString(args.metric_label) ??
    readString(args.text);
  if (!metric) {
    throw new HetangToolError(400, "metric_required", "Missing metric selector.");
  }
  const definition = findSupportedMetricDefinition(metric);
  if (!definition) {
    throw new HetangToolError(404, "metric_not_found");
  }
  return {
    key: definition.key satisfies HetangSupportedMetricKey,
    label: definition.label,
    aliases: definition.aliases,
  };
}

function searchOperatingKnowledge(args: Record<string, unknown>) {
  const query = readString(args.query);
  if (!query) {
    throw new HetangToolError(400, "query_required", "Missing knowledge search query.");
  }
  const limit = clampInteger(readNumber(args.limit) ?? 5, 1, 20);
  return searchOperatingKnowledgeCatalog({
    query,
    domain: readString(args.domain),
    limit,
  });
}

function requestExternalResearchContext(args: Record<string, unknown>) {
  const topic = readString(args.topic);
  if (!topic) {
    throw new HetangToolError(400, "topic_required", "Missing external research topic.");
  }
  return {
    scope: "hq_external_research_lane",
    status: "boundary_only",
    lane: "meta",
    topic,
    query: readString(args.query) ?? topic,
    guidance:
      "Use HQ 外部情报 / 外部研究 lane. Do not redirect this request to store facts or serving surfaces.",
  };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value
    .map((entry) => readString(entry))
    .filter((entry): entry is string => Boolean(entry));
  return values.length === value.length ? values : undefined;
}

function readExplorerFilters(value: unknown): ControlledDataExplorerFilter[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new HetangToolError(
      400,
      "controlled_data_explorer_invalid_request",
      "filters must be an array.",
    );
  }
  return value.map((entry) => {
    const filter = asRecord(entry);
    const field = readString(filter.field);
    const op = readString(filter.op);
    if (!field || !op || !("value" in filter)) {
      throw new HetangToolError(
        400,
        "controlled_data_explorer_invalid_request",
        "Each filter must include field, op, and value.",
      );
    }
    return {
      field,
      op,
      value: filter.value as ControlledDataExplorerFilter["value"],
    } as ControlledDataExplorerFilter;
  });
}

function readExplorerOrderBy(value: unknown): ControlledDataExplorerRequest["orderBy"] {
  if (value === undefined) {
    return undefined;
  }
  const orderBy = asRecord(value);
  const field = readString(orderBy.field);
  if (!field) {
    throw new HetangToolError(
      400,
      "controlled_data_explorer_invalid_request",
      "order_by.field is required when order_by is provided.",
    );
  }
  const direction = readString(orderBy.direction);
  return {
    field,
    direction: direction === "asc" ? "asc" : "desc",
  };
}

function buildControlledDataExplorerRequest(
  args: Record<string, unknown>,
): ControlledDataExplorerRequest {
  const surface = readString(args.surface);
  const select = readStringArray(args.select);
  if (!surface || !select || select.length === 0) {
    throw new HetangToolError(
      400,
      "controlled_data_explorer_invalid_request",
      "surface and non-empty select are required.",
    );
  }

  return {
    surface,
    select,
    filters: readExplorerFilters(args.filters),
    orderBy: readExplorerOrderBy(args.order_by ?? args.orderBy),
    limit: readNumber(args.limit),
  };
}

async function controlledDataExplorer(params: {
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
}) {
  try {
    return await executeControlledDataExplorer({
      request: buildControlledDataExplorerRequest(params.args),
      executeQuery: params.runtime.executeCompiledServingQuery,
    });
  } catch (error) {
    if (error instanceof HetangToolError) {
      throw error;
    }
    throw new HetangToolError(
      400,
      "controlled_data_explorer_invalid_request",
      error instanceof Error ? error.message : "Invalid controlled data explorer request.",
    );
  }
}

export function createHetangToolsService(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  logger: HetangLogger;
  now?: () => Date;
}) {
  const now = params.now ?? (() => new Date());

  return {
    describeCapabilities() {
      return buildHetangToolsCapabilities();
    },

    async handleToolCall(request: HetangToolCallRequest): Promise<{
      ok: true;
      tool: HetangToolName;
      result: Record<string, unknown>;
    }> {
      const tool = requireToolName(request.tool);
      const args = asRecord(request.arguments);

      params.logger.debug?.(`htops-tools: call tool=${tool}`);

      switch (tool) {
        case "get_store_daily_summary":
          return {
            ok: true,
            tool,
            result: await getStoreDailySummary({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "get_store_risk_scan":
          return {
            ok: true,
            tool,
            result: await getStoreRiskScan({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "get_member_recall_candidates":
          return {
            ok: true,
            tool,
            result: await getMemberRecallCandidates({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "get_customer_profile":
          return {
            ok: true,
            tool,
            result: await getCustomerProfile({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "explain_metric_definition":
          return {
            ok: true,
            tool,
            result: explainMetricDefinition(args),
          };
        case "search_operating_knowledge":
          return {
            ok: true,
            tool,
            result: searchOperatingKnowledge(args),
          };
        case "request_external_research_context":
          return {
            ok: true,
            tool,
            result: requestExternalResearchContext(args),
          };
        case "controlled_data_explorer":
          return {
            ok: true,
            tool,
            result: await controlledDataExplorer({
              runtime: params.runtime,
              args,
            }),
          };
      }
    },
  };
}
