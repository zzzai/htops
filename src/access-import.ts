import { readFile } from "node:fs/promises";
import { resolveStoreOrgId } from "./config.js";
import type { HetangAccessRole, HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

type AccessImportEntry = {
  senderId?: unknown;
  employeeName?: unknown;
  role?: unknown;
  stores?: unknown;
  hourlyQuota?: unknown;
  dailyQuota?: unknown;
  notes?: unknown;
  isActive?: unknown;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return value.trim();
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return numeric;
}

function parseRole(value: unknown): HetangAccessRole {
  const role = requireString(value, "role").toLowerCase();
  if (role !== "hq" && role !== "manager" && role !== "staff" && role !== "disabled") {
    throw new Error("role must be one of: hq, manager, staff, disabled");
  }
  return role;
}

function parseStores(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("stores must be an array");
  }
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0),
    ),
  );
}

function parseEntries(value: unknown): AccessImportEntry[] {
  if (Array.isArray(value)) {
    return value as AccessImportEntry[];
  }
  const raw = asRecord(value, "access import file");
  if (!Array.isArray(raw.entries)) {
    throw new Error("access import file must be an array or an object with entries");
  }
  return raw.entries as AccessImportEntry[];
}

export async function readAccessImportFile(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function resolveAccessImportBindings(params: {
  config: HetangOpsConfig;
  channel: string;
  entries: unknown;
}): HetangEmployeeBinding[] {
  const entries = parseEntries(params.entries);
  return entries.map((entry, index) => {
    const record = asRecord(entry, `access import entry ${index + 1}`);
    const role = parseRole(record.role);
    const senderId = requireString(record.senderId, `entries[${index}].senderId`);
    const stores = parseStores(record.stores);
    if (role === "manager" && stores.length === 0) {
      throw new Error(`entries[${index}].stores are required for role ${role}`);
    }
    if (role === "hq" && stores.length > 0) {
      throw new Error(`entries[${index}].stores are not supported for hq`);
    }
    const scopeOrgIds = stores.map((token) => {
      const orgId = resolveStoreOrgId(params.config, token);
      if (!orgId) {
        throw new Error(`Unknown store token in entries[${index}]: ${token}`);
      }
      return orgId;
    });
    return {
      channel: params.channel,
      senderId,
      employeeName: optionalString(record.employeeName),
      role,
      orgId: scopeOrgIds.length === 1 ? scopeOrgIds[0] : undefined,
      scopeOrgIds,
      isActive: record.isActive !== false,
      hourlyQuota: optionalNumber(record.hourlyQuota, `entries[${index}].hourlyQuota`),
      dailyQuota: optionalNumber(record.dailyQuota, `entries[${index}].dailyQuota`),
      notes: optionalString(record.notes),
    };
  });
}
