import { Pool } from "pg";

import {
  BaiduMapApiError,
  BaiduMapClient,
  resolveBaiduMapAkFromEnv,
} from "../src/baidu-map-client.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import {
  persistStoreSurroundingsScan,
  resolveStoreSurroundingsCategories,
} from "../src/store-surroundings-ingestion.js";
import type {
  StoreSurroundingsCategoryScan,
  StoreSurroundingsScanResult,
} from "../src/store-surroundings-ingestion.js";
import type { HetangStoreConfig, HetangStoreMasterProfile } from "../src/types.js";

type CliOptions = {
  orgIds?: string[];
  radiusMeters: number;
  categoryKeys?: string[];
  dryRun: boolean;
  snapshotDate: string;
  pageSize: number;
  pageNum: number;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/import-baidu-store-surroundings.ts --dry-run",
      "  node --import tsx scripts/import-baidu-store-surroundings.ts --write --org 627150985244677 --radius 3000 --categories catering,hotel,competitor",
      "",
      "Environment:",
      "  HETANG_BAIDU_MAP_AK or BAIDU_MAP_AK must be set in .env.runtime or process env.",
    ].join("\n"),
  );
}

function parsePositiveInt(value: string | undefined, fieldName: string): number {
  if (!value) {
    throw new Error(`${fieldName} requires a value`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fieldName: string): number {
  if (!value) {
    throw new Error(`${fieldName} requires a value`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${fieldName}: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let radiusMeters = 3000;
  let categoryKeys: string[] | undefined;
  let dryRun = true;
  let snapshotDate = todayIsoDate();
  let pageSize = 20;
  let pageNum = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--org" || token === "--org-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${token} requires an org id`);
      }
      orgIds.push(value);
      index += 1;
      continue;
    }
    if (token === "--radius") {
      radiusMeters = parsePositiveInt(argv[index + 1], "--radius");
      index += 1;
      continue;
    }
    if (token === "--categories") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--categories requires a comma-separated list");
      }
      categoryKeys = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      index += 1;
      continue;
    }
    if (token === "--date" || token === "--snapshot-date") {
      const value = argv[index + 1];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        throw new Error(`${token} requires YYYY-MM-DD`);
      }
      snapshotDate = value;
      index += 1;
      continue;
    }
    if (token === "--page-size") {
      pageSize = Math.min(parsePositiveInt(argv[index + 1], "--page-size"), 20);
      index += 1;
      continue;
    }
    if (token === "--page-num") {
      pageNum = parseNonNegativeInt(argv[index + 1], "--page-num");
      index += 1;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--write") {
      dryRun = false;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    orgIds: orgIds.length > 0 ? orgIds : undefined,
    radiusMeters,
    categoryKeys,
    dryRun,
    snapshotDate,
    pageSize,
    pageNum,
  };
}

function resolveTargetStores(configStores: HetangStoreConfig[], orgIds?: string[]): HetangStoreConfig[] {
  const activeStores = configStores.filter((store) => store.isActive !== false);
  if (!orgIds || orgIds.length === 0) {
    return activeStores;
  }
  const byOrgId = new Map(activeStores.map((store) => [store.orgId, store]));
  return orgIds.map((orgId) => {
    const store = byOrgId.get(orgId);
    if (!store) {
      throw new Error(`Unknown or inactive org id: ${orgId}`);
    }
    return store;
  });
}

function hasCoordinates(profile: HetangStoreMasterProfile | null): profile is HetangStoreMasterProfile & {
  latitude: number;
  longitude: number;
} {
  return (
    profile !== null &&
    typeof profile.latitude === "number" &&
    Number.isFinite(profile.latitude) &&
    typeof profile.longitude === "number" &&
    Number.isFinite(profile.longitude)
  );
}

async function scanStoreSurroundings(params: {
  client: BaiduMapClient;
  profile: HetangStoreMasterProfile & { latitude: number; longitude: number };
  snapshotDate: string;
  radiusMeters: number;
  categories: ReturnType<typeof resolveStoreSurroundingsCategories>;
  pageSize: number;
  pageNum: number;
}): Promise<StoreSurroundingsScanResult> {
  const capturedAt = new Date().toISOString();
  const categoryScans: StoreSurroundingsCategoryScan[] = [];
  for (const category of params.categories) {
    let result;
    try {
      result = await params.client.searchPlacesNearby({
        query: category.query,
        latitude: params.profile.latitude,
        longitude: params.profile.longitude,
        radiusMeters: params.radiusMeters,
        pageSize: params.pageSize,
        pageNum: params.pageNum,
      });
    } catch (error) {
      if (error instanceof BaiduMapApiError) {
        console.error(
          `[error] ${params.profile.storeName} (${params.profile.orgId}) category=${category.key} Baidu place search failed status=${error.status ?? "unknown"} url=${error.safeUrl}`,
        );
        continue;
      }
      throw error;
    }
    categoryScans.push({
      ...category,
      categoryKey: category.key,
      total: result.total,
      pois: result.pois,
    });
  }

  return {
    provider: "baidu_maps",
    orgId: params.profile.orgId,
    storeName: params.profile.storeName,
    snapshotDate: params.snapshotDate,
    capturedAt,
    radiusMeters: params.radiusMeters,
    coordinateSystem: "bd09ll",
    location: {
      latitude: params.profile.latitude,
      longitude: params.profile.longitude,
    },
    categories: categoryScans,
  };
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const ak = resolveBaiduMapAkFromEnv();
  if (!ak) {
    throw new Error("Missing HETANG_BAIDU_MAP_AK or BAIDU_MAP_AK");
  }
  const config = await loadStandaloneHetangConfig();
  const targetStores = resolveTargetStores(config.stores, options.orgIds);
  const categories = resolveStoreSurroundingsCategories(options.categoryKeys);
  const pool = new Pool({ connectionString: config.database.url });
  const store = new HetangOpsStore({
    pool,
    stores: config.stores.map((entry) => ({
      orgId: entry.orgId,
      storeName: entry.storeName,
      rawAliases: entry.rawAliases,
    })),
  });
  const client = new BaiduMapClient({ ak });

  try {
    await store.initialize();
    for (const targetStore of targetStores) {
      const profile = await store.getStoreMasterProfile(targetStore.orgId);
      if (!hasCoordinates(profile)) {
        console.log(
          `[skip] ${targetStore.storeName} (${targetStore.orgId}) missing latitude/longitude in store_master_profiles`,
        );
        continue;
      }
      const scan = await scanStoreSurroundings({
        client,
        profile,
        snapshotDate: options.snapshotDate,
        radiusMeters: options.radiusMeters,
        categories,
        pageSize: options.pageSize,
        pageNum: options.pageNum,
      });
      const summary = scan.categories
        .map((category) => `${category.categoryKey}=${category.total}`)
        .join(", ");
      if (options.dryRun) {
        console.log(
          `[dry-run] ${scan.storeName} (${scan.orgId}) radius=${scan.radiusMeters}m categories=${summary}`,
        );
        continue;
      }
      const result = await persistStoreSurroundingsScan({ store, scan });
      console.log(
        `[write] ${scan.storeName} (${scan.orgId}) batch=${result.batchId} observations=${result.observationCount} contextEntries=${result.contextEntryCount} categories=${summary}`,
      );
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
