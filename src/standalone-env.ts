import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveHetangOpsConfig } from "./config.js";
import type { HetangOpsConfig } from "./types.js";

export const DEFAULT_HTOPS_ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_HTOPS_CONFIG_PATH = path.join(DEFAULT_HTOPS_ROOT_DIR, "htops.json");
export const DEFAULT_HTOPS_STATE_DIR = path.join(os.homedir(), ".htops");
export const DEFAULT_HTOPS_RUNTIME_ENV_PATH = path.join(DEFAULT_HTOPS_ROOT_DIR, ".env.runtime");

function extractHetangConfigCandidate(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("htops config must be an object");
  }
  const record = raw as Record<string, unknown>;
  if ("api" in record && "stores" in record) {
    return record;
  }

  const pluginConfig = (
    record.plugins as { entries?: Record<string, { config?: unknown }> } | undefined
  )?.entries?.["hetang-ops"]?.config;
  if (pluginConfig) {
    return pluginConfig;
  }

  throw new Error("hetang-ops config not found");
}

export function resolveStandaloneRootDir(): string {
  return process.env.HTOPS_ROOT_DIR?.trim() || DEFAULT_HTOPS_ROOT_DIR;
}

export function resolveStandaloneConfigPath(): string {
  return process.env.HTOPS_CONFIG_PATH?.trim() || DEFAULT_HTOPS_CONFIG_PATH;
}

export function resolveStandaloneStateDir(): string {
  return process.env.HTOPS_STATE_DIR?.trim() || DEFAULT_HTOPS_STATE_DIR;
}

export function resolveStandaloneRuntimeEnvPath(): string {
  return process.env.HETANG_RUNTIME_ENV_FILE?.trim() || DEFAULT_HTOPS_RUNTIME_ENV_PATH;
}

function stripOptionalQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveFirstEnvValue(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function applyStandaloneEnvOverrides(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  const record = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
  const api = (
    record.api && typeof record.api === "object" && !Array.isArray(record.api) ? record.api : {}
  ) as Record<string, unknown>;
  const database = (
    record.database && typeof record.database === "object" && !Array.isArray(record.database)
      ? record.database
      : {}
  ) as Record<string, unknown>;

  const apiAppKey = resolveFirstEnvValue(["HETANG_APP_KEY"]);
  const apiAppSecret = resolveFirstEnvValue(["HETANG_APP_SECRET"]);
  const defaultDatabaseUrl = resolveFirstEnvValue([
    "HETANG_DATABASE_URL",
    "HETANG_SYNC_DATABASE_URL",
    "HETANG_QUERY_DATABASE_URL",
    "HETANG_ANALYSIS_DATABASE_URL",
    "DATABASE_URL",
    "QUERY_DATABASE_URL",
  ]);
  const queryDatabaseUrl = resolveFirstEnvValue(["HETANG_QUERY_DATABASE_URL", "QUERY_DATABASE_URL"]);
  const syncDatabaseUrl = resolveFirstEnvValue(["HETANG_SYNC_DATABASE_URL"]);
  const analysisDatabaseUrl = resolveFirstEnvValue(["HETANG_ANALYSIS_DATABASE_URL"]);

  if (apiAppKey) {
    api.appKey = apiAppKey;
  }
  if (apiAppSecret) {
    api.appSecret = apiAppSecret;
  }
  if (defaultDatabaseUrl) {
    database.url = defaultDatabaseUrl;
  }
  if (queryDatabaseUrl) {
    database.queryUrl = queryDatabaseUrl;
  }
  if (syncDatabaseUrl) {
    database.syncUrl = syncDatabaseUrl;
  }
  if (analysisDatabaseUrl) {
    database.analysisUrl = analysisDatabaseUrl;
  }

  if (Object.keys(api).length > 0) {
    record.api = api;
  }
  if (Object.keys(database).length > 0) {
    record.database = database;
  }

  return record;
}

export async function loadStandaloneRuntimeEnv(
  envPath = resolveStandaloneRuntimeEnvPath(),
): Promise<void> {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const rawLine of raw.split(/\r?\n/gu)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      const value = stripOptionalQuotes(line.slice(separatorIndex + 1).trim());
      process.env[key] = value;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function loadStandaloneHetangConfigFromFile(
  configPath: string,
): Promise<HetangOpsConfig> {
  const raw = JSON.parse(await fs.readFile(configPath, "utf8")) as unknown;
  return resolveHetangOpsConfig(applyStandaloneEnvOverrides(extractHetangConfigCandidate(raw)));
}

export async function loadStandaloneHetangConfig(): Promise<HetangOpsConfig> {
  await loadStandaloneRuntimeEnv();
  return await loadStandaloneHetangConfigFromFile(resolveStandaloneConfigPath());
}
