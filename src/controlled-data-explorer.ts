import { createHash } from "node:crypto";

export type ControlledDataExplorerSurface =
  | "serving_store_day"
  | "serving_store_window"
  | "serving_tech_current"
  | "serving_customer_profile_asof"
  | "serving_customer_ranked_list_asof";

export type ControlledDataExplorerFieldType = "string" | "number" | "date" | "boolean";

export type ControlledDataExplorerField = {
  name: string;
  type: ControlledDataExplorerFieldType;
  filterable: boolean;
  sortable: boolean;
};

export type ControlledDataExplorerSurfaceCatalog = {
  surface: ControlledDataExplorerSurface;
  description: string;
  fields: ControlledDataExplorerField[];
};

export type ControlledDataExplorerFilter = {
  field: string;
  op: "eq" | "in" | "between" | "gte" | "lte";
  value: string | number | boolean | Array<string | number | boolean>;
};

export type ControlledDataExplorerRequest = {
  surface: string;
  select: string[];
  filters?: ControlledDataExplorerFilter[];
  orderBy?: {
    field: string;
    direction?: "asc" | "desc";
  };
  limit?: number;
};

export type CompiledControlledDataExplorerQuery = {
  surface: ControlledDataExplorerSurface;
  columns: string[];
  sql: string;
  params: Array<string | number | boolean>;
  limit: number;
};

const MAX_LIMIT = 100;

const SURFACE_CATALOG: ControlledDataExplorerSurfaceCatalog[] = [
  {
    surface: "serving_store_day",
    description: "Single-store daily serving KPI rows.",
    fields: [
      { name: "org_id", type: "string", filterable: true, sortable: true },
      { name: "biz_date", type: "date", filterable: true, sortable: true },
      { name: "store_name", type: "string", filterable: true, sortable: true },
      { name: "service_revenue", type: "number", filterable: true, sortable: true },
      { name: "service_order_count", type: "number", filterable: true, sortable: true },
      { name: "customer_count", type: "number", filterable: true, sortable: true },
      { name: "total_clocks", type: "number", filterable: true, sortable: true },
      { name: "average_ticket", type: "number", filterable: true, sortable: true },
      { name: "clock_effect", type: "number", filterable: true, sortable: true },
      { name: "point_clock_rate", type: "number", filterable: true, sortable: true },
      { name: "add_clock_rate", type: "number", filterable: true, sortable: true },
    ],
  },
  {
    surface: "serving_store_window",
    description: "Single-store 7d/30d serving KPI windows.",
    fields: [
      { name: "org_id", type: "string", filterable: true, sortable: true },
      { name: "window_end_biz_date", type: "date", filterable: true, sortable: true },
      { name: "window_days", type: "number", filterable: true, sortable: true },
      { name: "store_name", type: "string", filterable: true, sortable: true },
      { name: "service_revenue", type: "number", filterable: true, sortable: true },
      { name: "service_order_count", type: "number", filterable: true, sortable: true },
      { name: "customer_count", type: "number", filterable: true, sortable: true },
      { name: "total_clocks", type: "number", filterable: true, sortable: true },
      { name: "average_ticket", type: "number", filterable: true, sortable: true },
      { name: "clock_effect", type: "number", filterable: true, sortable: true },
      { name: "point_clock_rate", type: "number", filterable: true, sortable: true },
      { name: "add_clock_rate", type: "number", filterable: true, sortable: true },
      { name: "risk_score", type: "number", filterable: true, sortable: true },
    ],
  },
  {
    surface: "serving_tech_current",
    description: "Current technician floor status with raw payload and sensitive fields hidden.",
    fields: [
      { name: "org_id", type: "string", filterable: true, sortable: true },
      { name: "store_name", type: "string", filterable: true, sortable: true },
      { name: "tech_code", type: "string", filterable: true, sortable: true },
      { name: "tech_name", type: "string", filterable: true, sortable: true },
      { name: "is_work", type: "boolean", filterable: true, sortable: true },
      { name: "is_job", type: "boolean", filterable: true, sortable: true },
      { name: "state_name", type: "string", filterable: true, sortable: true },
      { name: "state_kind", type: "string", filterable: true, sortable: true },
      { name: "point_clock_num", type: "number", filterable: true, sortable: true },
      { name: "wheel_clock_num", type: "number", filterable: true, sortable: true },
    ],
  },
  {
    surface: "serving_customer_profile_asof",
    description: "Customer profile snapshots with sensitive direct identifiers hidden.",
    fields: [
      { name: "org_id", type: "string", filterable: true, sortable: true },
      { name: "as_of_biz_date", type: "date", filterable: true, sortable: true },
      { name: "customer_identity_key", type: "string", filterable: true, sortable: true },
      { name: "customer_display_name", type: "string", filterable: true, sortable: true },
      { name: "member_id", type: "string", filterable: true, sortable: true },
      { name: "member_card_no", type: "string", filterable: true, sortable: true },
      { name: "phone_suffix", type: "string", filterable: true, sortable: true },
      { name: "identity_stable", type: "boolean", filterable: true, sortable: true },
      { name: "primary_segment", type: "string", filterable: true, sortable: true },
      { name: "payment_segment", type: "string", filterable: true, sortable: true },
      { name: "tech_loyalty_segment", type: "string", filterable: true, sortable: true },
      { name: "visit_count_30d", type: "number", filterable: true, sortable: true },
      { name: "visit_count_90d", type: "number", filterable: true, sortable: true },
      { name: "pay_amount_30d", type: "number", filterable: true, sortable: true },
      { name: "pay_amount_90d", type: "number", filterable: true, sortable: true },
      { name: "current_stored_amount", type: "number", filterable: true, sortable: true },
      { name: "current_silent_days", type: "number", filterable: true, sortable: true },
      { name: "top_tech_name", type: "string", filterable: true, sortable: true },
      { name: "followup_score", type: "number", filterable: true, sortable: true },
      { name: "risk_score", type: "number", filterable: true, sortable: true },
    ],
  },
  {
    surface: "serving_customer_ranked_list_asof",
    description: "Ranked customer list snapshots with sensitive direct identifiers hidden.",
    fields: [
      { name: "org_id", type: "string", filterable: true, sortable: true },
      { name: "as_of_biz_date", type: "date", filterable: true, sortable: true },
      { name: "customer_identity_key", type: "string", filterable: true, sortable: true },
      { name: "customer_display_name", type: "string", filterable: true, sortable: true },
      { name: "member_id", type: "string", filterable: true, sortable: true },
      { name: "member_card_no", type: "string", filterable: true, sortable: true },
      { name: "phone_suffix", type: "string", filterable: true, sortable: true },
      { name: "primary_segment", type: "string", filterable: true, sortable: true },
      { name: "followup_bucket", type: "string", filterable: true, sortable: true },
      { name: "payment_segment", type: "string", filterable: true, sortable: true },
      { name: "tech_loyalty_segment", type: "string", filterable: true, sortable: true },
      { name: "visit_count_30d", type: "number", filterable: true, sortable: true },
      { name: "visit_count_90d", type: "number", filterable: true, sortable: true },
      { name: "pay_amount_30d", type: "number", filterable: true, sortable: true },
      { name: "pay_amount_90d", type: "number", filterable: true, sortable: true },
      { name: "current_stored_amount", type: "number", filterable: true, sortable: true },
      { name: "current_silent_days", type: "number", filterable: true, sortable: true },
      { name: "top_tech_name", type: "string", filterable: true, sortable: true },
      { name: "followup_score", type: "number", filterable: true, sortable: true },
      { name: "risk_score", type: "number", filterable: true, sortable: true },
      { name: "priority_band", type: "string", filterable: true, sortable: true },
      { name: "recommended_action_label", type: "string", filterable: true, sortable: true },
    ],
  },
];

export function listControlledDataExplorerSurfaces(): ControlledDataExplorerSurfaceCatalog[] {
  return SURFACE_CATALOG.map((surface) => ({
    ...surface,
    fields: surface.fields.map((field) => ({ ...field })),
  }));
}

function resolveSurface(surface: string): ControlledDataExplorerSurfaceCatalog {
  const matched = SURFACE_CATALOG.find((entry) => entry.surface === surface);
  if (!matched) {
    throw new Error(`Surface is not allowed: ${surface}`);
  }
  return matched;
}

function resolveField(
  surface: ControlledDataExplorerSurfaceCatalog,
  fieldName: string,
): ControlledDataExplorerField {
  const field = surface.fields.find((entry) => entry.name === fieldName);
  if (!field) {
    throw new Error(`Unknown field for ${surface.surface}: ${fieldName}`);
  }
  return field;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/gu, '""')}"`;
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? 50)) {
    return 50;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? 50)));
}

function asScalar(value: ControlledDataExplorerFilter["value"]): string | number | boolean {
  if (Array.isArray(value)) {
    throw new Error("Filter operator requires a scalar value.");
  }
  return value;
}

function asArray(value: ControlledDataExplorerFilter["value"]): Array<string | number | boolean> {
  if (!Array.isArray(value)) {
    throw new Error("Filter operator requires an array value.");
  }
  return value;
}

function compileFilterSql(params: {
  surface: ControlledDataExplorerSurfaceCatalog;
  filter: ControlledDataExplorerFilter;
  values: Array<string | number | boolean>;
}): string {
  const field = resolveField(params.surface, params.filter.field);
  if (!field.filterable) {
    throw new Error(`Field is not filterable: ${params.filter.field}`);
  }
  const column = quoteIdentifier(field.name);
  switch (params.filter.op) {
    case "eq": {
      params.values.push(asScalar(params.filter.value));
      return `${column} = $${params.values.length}`;
    }
    case "gte": {
      params.values.push(asScalar(params.filter.value));
      return `${column} >= $${params.values.length}`;
    }
    case "lte": {
      params.values.push(asScalar(params.filter.value));
      return `${column} <= $${params.values.length}`;
    }
    case "between": {
      const values = asArray(params.filter.value);
      if (values.length !== 2) {
        throw new Error("between operator requires exactly two values.");
      }
      params.values.push(values[0]!, values[1]!);
      return `${column} BETWEEN $${params.values.length - 1} AND $${params.values.length}`;
    }
    case "in": {
      const values = asArray(params.filter.value);
      if (values.length === 0 || values.length > 50) {
        throw new Error("in operator requires 1..50 values.");
      }
      const placeholders = values.map((value) => {
        params.values.push(value);
        return `$${params.values.length}`;
      });
      return `${column} IN (${placeholders.join(", ")})`;
    }
    default:
      throw new Error(`Unsupported filter operator: ${String(params.filter.op)}`);
  }
}

function hashQuery(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

export function compileControlledDataExplorerQuery(
  request: ControlledDataExplorerRequest,
): CompiledControlledDataExplorerQuery {
  const surface = resolveSurface(request.surface);
  const columns = request.select.length > 0 ? request.select : surface.fields.slice(0, 10).map((field) => field.name);
  const selectedFields = columns.map((fieldName) => resolveField(surface, fieldName));
  const values: Array<string | number | boolean> = [];
  const whereSql = (request.filters ?? []).map((filter) =>
    compileFilterSql({ surface, filter, values }),
  );
  const limit = normalizeLimit(request.limit);

  let sql = `SELECT ${selectedFields.map((field) => quoteIdentifier(field.name)).join(", ")} FROM ${quoteIdentifier(surface.surface)}`;
  if (whereSql.length > 0) {
    sql += ` WHERE ${whereSql.join(" AND ")}`;
  }
  if (request.orderBy) {
    const orderField = resolveField(surface, request.orderBy.field);
    if (!orderField.sortable) {
      throw new Error(`Field is not sortable: ${request.orderBy.field}`);
    }
    sql += ` ORDER BY ${quoteIdentifier(orderField.name)} ${
      request.orderBy.direction === "asc" ? "ASC" : "DESC"
    }`;
  }
  sql += ` LIMIT ${limit}`;

  return {
    surface: surface.surface,
    columns: selectedFields.map((field) => field.name),
    sql,
    params: values,
    limit,
  };
}

export async function executeControlledDataExplorer(params: {
  request: ControlledDataExplorerRequest;
  executeQuery: (query: {
    sql: string;
    queryParams?: unknown[];
    cacheKey?: string;
    ttlSeconds?: number;
  }) => Promise<Record<string, unknown>[]>;
}): Promise<{
  scope: "controlled_data_explorer_v1";
  surface: ControlledDataExplorerSurface;
  columns: string[];
  rowCount: number;
  limit: number;
  rows: Record<string, unknown>[];
}> {
  const compiled = compileControlledDataExplorerQuery(params.request);
  const rows = await params.executeQuery({
    sql: compiled.sql,
    queryParams: compiled.params,
    cacheKey: `controlled_data_explorer_v1:${hashQuery(compiled)}`,
    ttlSeconds: 60,
  });

  return {
    scope: "controlled_data_explorer_v1",
    surface: compiled.surface,
    columns: compiled.columns,
    rowCount: rows.length,
    limit: compiled.limit,
    rows,
  };
}
