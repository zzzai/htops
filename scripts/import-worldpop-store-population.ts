import { Pool } from "pg";
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import {
  WorldPopApiError,
  WorldPopClient,
  buildCircleFeatureCollection,
  resolveWorldPopDatasetProfile,
} from "../src/worldpop-client.js";
import { buildStoreExternalEnvironmentFeatureEntries } from "../src/store-external-environment-features.js";
import { buildStorePopulationContextEntries } from "../src/store-population-ingestion.js";
import {
  calculatePopulationInRadiusFromRaster,
  openGeoTiffPopulationRaster,
} from "../src/worldpop-raster-stats.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import type { HetangStoreConfig, HetangStoreMasterProfile } from "../src/types.js";
import type { WorldPopDatasetProfile, WorldPopDatasetProfileKey } from "../src/worldpop-client.js";

type CliOptions = {
  orgIds?: string[];
  radiiKm: number[];
  dryRun: boolean;
  snapshotDate: string;
  datasetProfileKey: WorldPopDatasetProfileKey;
  cacheDir: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/import-worldpop-store-population.ts --dry-run",
      "  node --import tsx scripts/import-worldpop-store-population.ts --write --org 627150985244677 --radii 1,3,5 --dataset wpgppop-2020",
      "  node --import tsx scripts/import-worldpop-store-population.ts --dataset global2-r2025a-2025",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let radiiKm = [1, 3, 5];
  let dryRun = true;
  let snapshotDate = todayIsoDate();
  let datasetProfileKey: WorldPopDatasetProfileKey = "wpgppop-2020";
  let cacheDir = "data/external/worldpop";

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
    if (token === "--radii") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--radii requires comma-separated km values");
      }
      radiiKm = value.split(",").map((entry) => {
        const parsed = Number(entry.trim());
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid radius: ${entry}`);
        }
        return parsed;
      });
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
    if (token === "--dataset") {
      const value = argv[index + 1];
      if (value !== "wpgppop-2020" && value !== "global2-r2025a-2025") {
        throw new Error("--dataset must be wpgppop-2020 or global2-r2025a-2025");
      }
      datasetProfileKey = value;
      index += 1;
      continue;
    }
    if (token === "--cache-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cache-dir requires a local path");
      }
      cacheDir = value;
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
    radiiKm,
    dryRun,
    snapshotDate,
    datasetProfileKey,
    cacheDir,
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

function basenameFromUri(uri: string): string {
  const parsed = new URL(uri);
  const fileName = path.basename(parsed.pathname);
  if (!fileName.endsWith(".tif")) {
    throw new Error(`WorldPop catalog file is not a GeoTIFF: ${uri}`);
  }
  return fileName;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

async function downloadFileIfMissing(params: {
  uri: string;
  filePath: string;
  dryRun: boolean;
}): Promise<void> {
  if (await fileExists(params.filePath)) {
    console.log(`[cache] ${params.filePath}`);
    return;
  }
  if (params.dryRun) {
    console.log(`[dry-run] would download ${params.uri} -> ${params.filePath}`);
    return;
  }
  await mkdir(path.dirname(params.filePath), { recursive: true });
  const response = await fetch(params.uri);
  if (!response.ok || response.body === null) {
    throw new Error(`Failed to download WorldPop raster: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(params.filePath));
  console.log(`[download] ${params.filePath}`);
}

async function importViaStatsApi(params: {
  options: CliOptions;
  datasetProfile: WorldPopDatasetProfile;
  targetStores: HetangStoreConfig[];
  store: HetangOpsStore;
  client: WorldPopClient;
}): Promise<void> {
  for (const targetStore of params.targetStores) {
    const profile = await params.store.getStoreMasterProfile(targetStore.orgId);
    if (!hasCoordinates(profile)) {
      console.log(`[skip] ${targetStore.storeName} (${targetStore.orgId}) missing coordinates`);
      continue;
    }
    const rings = [];
    for (const radiusKm of params.options.radiiKm) {
      try {
        const result = await params.client.fetchPopulationStats({
          dataset: params.datasetProfile.dataset,
          year: params.datasetProfile.year,
          geojson: buildCircleFeatureCollection({
            latitude: profile.latitude,
            longitude: profile.longitude,
            radiusKm,
          }),
        });
        rings.push({
          radiusKm,
          totalPopulation: result.totalPopulation,
          rawJson: {
            provider: "worldpop",
            dataset: params.datasetProfile.dataset,
            year: params.datasetProfile.year,
            radiusKm,
            response: result.raw,
          },
        });
      } catch (error) {
        if (error instanceof WorldPopApiError) {
          console.error(
            `[error] ${profile.storeName} (${profile.orgId}) WorldPop radius=${radiusKm}km failed task=${error.taskId ?? "none"} status=${error.status ?? "unknown"}`,
          );
          continue;
        }
        throw error;
      }
    }
    await writePopulationEntries({
      store: params.store,
      profile,
      rings,
      options: params.options,
      updatedAt: new Date().toISOString(),
      source: {
        provider: "worldpop",
        sourceType: "worldpop_stats_api",
        sourceLabel: params.datasetProfile.sourceLabel,
        sourceVersion: params.datasetProfile.sourceVersion,
        sourceUri: "https://api.worldpop.org/v1/services/stats",
      },
    });
  }
}

async function importViaR2025ARaster(params: {
  options: CliOptions;
  datasetProfile: WorldPopDatasetProfile;
  targetStores: HetangStoreConfig[];
  store: HetangOpsStore;
  client: WorldPopClient;
}): Promise<void> {
  const catalogEntry = await params.client.fetchRasterCatalogEntry({
    alias: params.datasetProfile.dataset,
    iso3: params.datasetProfile.iso3 ?? "CHN",
    year: params.datasetProfile.year,
  });
  const filePath = path.resolve(params.options.cacheDir, basenameFromUri(catalogEntry.fileUri));
  console.log(`[catalog] ${catalogEntry.alias} ${catalogEntry.iso3} ${catalogEntry.year} ${catalogEntry.fileUri}`);
  await downloadFileIfMissing({
    uri: catalogEntry.fileUri,
    filePath,
    dryRun: params.options.dryRun,
  });
  if (params.options.dryRun && !(await fileExists(filePath))) {
    return;
  }

  const opened = await openGeoTiffPopulationRaster(filePath);
  try {
    for (const targetStore of params.targetStores) {
      const profile = await params.store.getStoreMasterProfile(targetStore.orgId);
      if (!hasCoordinates(profile)) {
        console.log(`[skip] ${targetStore.storeName} (${targetStore.orgId}) missing coordinates`);
        continue;
      }
      const rings = [];
      for (const radiusKm of params.options.radiiKm) {
        const result = await calculatePopulationInRadiusFromRaster({
          raster: opened.raster,
          latitude: profile.latitude,
          longitude: profile.longitude,
          radiusKm,
        });
        rings.push({
          radiusKm,
          totalPopulation: result.totalPopulation,
          rawJson: {
            provider: "worldpop",
            dataset: params.datasetProfile.dataset,
            year: params.datasetProfile.year,
            radiusKm,
            catalogId: catalogEntry.catalogId,
            doi: catalogEntry.doi,
            releaseDate: catalogEntry.releaseDate,
            fileUri: catalogEntry.fileUri,
            raster: {
              window: result.window,
              includedPixels: result.includedPixels,
            },
          },
        });
      }
      await writePopulationEntries({
        store: params.store,
        profile,
        rings,
        options: params.options,
        updatedAt: new Date().toISOString(),
        source: {
          provider: "worldpop",
          sourceType: "worldpop_global2_r2025a_raster",
          sourceLabel: params.datasetProfile.sourceLabel,
          sourceVersion: params.datasetProfile.sourceVersion,
          sourceUri: catalogEntry.fileUri,
        },
      });
    }
  } finally {
    await opened.close();
  }
}

async function writePopulationEntries(params: {
  store: HetangOpsStore;
  profile: HetangStoreMasterProfile;
  rings: Array<{
    radiusKm: number;
    totalPopulation: number;
    rawJson: unknown;
  }>;
  options: CliOptions;
  updatedAt: string;
  source: Parameters<typeof buildStorePopulationContextEntries>[0]["source"];
}): Promise<void> {
  if (params.rings.length === 0) {
    console.log(`[skip] ${params.profile.storeName} (${params.profile.orgId}) no population rings fetched`);
    return;
  }
  const populationEntries = buildStorePopulationContextEntries({
    orgId: params.profile.orgId,
    snapshotDate: params.options.snapshotDate,
    storeName: params.profile.storeName,
    updatedAt: params.updatedAt,
    source: params.source,
    rings: params.rings,
  });
  const summary = populationEntries.map((entry) => `${entry.metricKey}=${entry.valueNum}`).join(", ");
  if (params.options.dryRun) {
    console.log(`[dry-run] ${params.profile.storeName} (${params.profile.orgId}) ${summary}`);
    return;
  }
  for (const row of populationEntries) {
    await params.store.upsertStoreExternalContextEntry(row);
  }
  const contextEntries = await params.store.listStoreExternalContextEntries({
    orgId: params.profile.orgId,
    snapshotDate: params.options.snapshotDate,
  });
  const featureEntries = buildStoreExternalEnvironmentFeatureEntries({
    orgId: params.profile.orgId,
    snapshotDate: params.options.snapshotDate,
    storeName: params.profile.storeName,
    updatedAt: params.updatedAt,
    entries: contextEntries,
  });
  for (const row of featureEntries) {
    await params.store.upsertStoreExternalContextEntry(row);
  }
  console.log(
    `[write] ${params.profile.storeName} (${params.profile.orgId}) ${summary}; featureEntries=${featureEntries.length}`,
  );
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const datasetProfile = resolveWorldPopDatasetProfile(options.datasetProfileKey);
  const config = await loadStandaloneHetangConfig();
  const targetStores = resolveTargetStores(config.stores, options.orgIds);
  const pool = new Pool({ connectionString: config.database.url });
  const store = new HetangOpsStore({
    pool,
    stores: config.stores.map((entry) => ({
      orgId: entry.orgId,
      storeName: entry.storeName,
      rawAliases: entry.rawAliases,
    })),
  });
  const client = new WorldPopClient();

  try {
    await store.initialize();
    if (datasetProfile.supportsStatsApi) {
      await importViaStatsApi({
        options,
        datasetProfile,
        targetStores,
        store,
        client,
      });
    } else {
      await importViaR2025ARaster({
        options,
        datasetProfile,
        targetStores,
        store,
        client,
      });
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
