import fs from "node:fs";
import path from "node:path";
import { resolveStoreOrgId } from "./config.js";
import { resolveStandaloneRootDir } from "./standalone-env.js";
import type { HetangAccessRole, HetangEmployeeBinding, HetangOpsConfig } from "./types.js";

type AccessRosterRecord = {
  senderId?: string;
  employeeName?: string;
  matchNames?: string[];
  role?: HetangAccessRole;
  stores?: string[];
  hourlyQuota?: number;
  dailyQuota?: number;
  notes?: string;
};

type AccessRosterFile = {
  entries?: AccessRosterRecord[];
  plannedEntries?: AccessRosterRecord[];
};

function loadJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function loadBuiltInAccessRoster(): AccessRosterFile {
  const rootDir = resolveStandaloneRootDir();
  const candidates = [
    path.join(rootDir, "access", "wecom-access-roster.v1.json"),
    path.join(rootDir, "access", "wecom-access-roster.v1.example.json"),
  ];

  for (const candidate of candidates) {
    const loaded = loadJsonFile<AccessRosterFile>(candidate);
    if (loaded) {
      return loaded;
    }
  }

  return {};
}

const rawRoster = loadBuiltInAccessRoster();
const builtInRoster = [
  ...(Array.isArray(rawRoster.entries) ? rawRoster.entries : []),
  ...(Array.isArray(rawRoster.plannedEntries) ? rawRoster.plannedEntries : []),
];

function normalizeRosterName(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[()（）【】[\]{}《》「」『』]/gu, "")
    .replace(/[\s\-—_·•,，.。;；:：/\\|]/gu, "");
  return normalized.length > 0 ? normalized : null;
}

function resolveRosterMatchNames(entry: AccessRosterRecord): string[] {
  const values = [
    entry.employeeName,
    ...(Array.isArray(entry.matchNames) ? entry.matchNames : []),
  ]
    .map((value) => normalizeRosterName(value))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(values));
}

function canAutoProvision(entry: AccessRosterRecord): boolean {
  if (entry.role === "hq" || entry.role === "staff") {
    return true;
  }
  return entry.role === "manager" && Array.isArray(entry.stores) && entry.stores.length > 0;
}

export function resolveAutoProvisionEmployeeBinding(params: {
  config: HetangOpsConfig;
  channel: string;
  senderId?: string;
  senderName?: string;
}): HetangEmployeeBinding | null {
  const senderId = params.senderId?.trim();
  const normalizedSenderName = normalizeRosterName(params.senderName);
  if (!senderId || !normalizedSenderName) {
    return null;
  }

  const matches = builtInRoster.filter(
    (entry) => canAutoProvision(entry) && resolveRosterMatchNames(entry).includes(normalizedSenderName),
  );
  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0];
  const stores = Array.isArray(match.stores) ? match.stores : [];
  const scopeOrgIds = stores
    .map((token) => resolveStoreOrgId(params.config, token))
    .filter((orgId): orgId is string => Boolean(orgId));
  if (stores.length !== scopeOrgIds.length) {
    return null;
  }
  const employeeName = typeof match.employeeName === "string" ? match.employeeName.trim() : "";
  const role = match.role;
  if (!employeeName || !role) {
    return null;
  }

  return {
    channel: params.channel,
    senderId,
    employeeName,
    role,
    orgId: scopeOrgIds.length === 1 ? scopeOrgIds[0] : undefined,
    scopeOrgIds,
    isActive: true,
    hourlyQuota: match.hourlyQuota,
    dailyQuota: match.dailyQuota,
    notes: match.notes
      ? `${match.notes} [auto-provisioned by senderName roster]`
      : "auto-provisioned by senderName roster",
  };
}
