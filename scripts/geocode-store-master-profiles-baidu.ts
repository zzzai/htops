import { Pool } from "pg";

import {
  BaiduMapApiError,
  BaiduMapClient,
  resolveBaiduMapAkFromEnv,
} from "../src/baidu-map-client.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import type { HetangStoreConfig, HetangStoreMasterProfile } from "../src/types.js";
import type { BaiduMapGeocodeResult, BaiduMapPlacePoi } from "../src/baidu-map-client.js";

type CliOptions = {
  orgIds?: string[];
  dryRun: boolean;
  overwrite: boolean;
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/geocode-store-master-profiles-baidu.ts --dry-run",
      "  node --import tsx scripts/geocode-store-master-profiles-baidu.ts --write --org 627150985244677",
      "",
      "Environment:",
      "  HETANG_BAIDU_MAP_AK or BAIDU_MAP_AK must be set in .env.runtime or process env.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let dryRun = true;
  let overwrite = false;

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
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--write") {
      dryRun = false;
      continue;
    }
    if (token === "--overwrite") {
      overwrite = true;
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
    dryRun,
    overwrite,
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

function hasCoordinates(profile: HetangStoreMasterProfile | null): boolean {
  return (
    profile !== null &&
    typeof profile.latitude === "number" &&
    Number.isFinite(profile.latitude) &&
    typeof profile.longitude === "number" &&
    Number.isFinite(profile.longitude)
  );
}

function resolveGeocodeAddress(profile: HetangStoreMasterProfile, configStore: HetangStoreConfig): string {
  const address = profile.addressText?.trim();
  if (address) {
    return address.includes(profile.storeName) ? address : `${profile.storeName} ${address}`;
  }
  const city = profile.cityName?.trim();
  return city ? `${city}${profile.storeName}` : configStore.storeName;
}

function normalizeMatchText(value: string): string {
  return value
    .replace(/^荷塘悦色/u, "")
    .replace(/[（）()影院式沐足足浴足疗店\s]/gu, "")
    .toLowerCase();
}

function scoreStorePoiMatch(params: {
  poi: BaiduMapPlacePoi;
  profile: HetangStoreMasterProfile;
  configStore: HetangStoreConfig;
}): number {
  const poiName = normalizeMatchText(params.poi.name);
  const candidates = [
    params.profile.storeName,
    params.configStore.storeName,
    ...(params.configStore.rawAliases ?? []),
  ]
    .map(normalizeMatchText)
    .filter(Boolean);
  let score = params.poi.name.includes("荷塘悦色") ? 30 : 0;
  if ((params.poi.tags ?? []).some((tag) => /洗浴|按摩|足浴|足疗|休闲娱乐/u.test(tag))) {
    score += 20;
  }
  if (params.profile.districtName && params.poi.district === params.profile.districtName) {
    score += 10;
  }
  for (const candidate of candidates) {
    if (candidate && poiName.includes(candidate)) {
      score += 50 + Math.min(candidate.length * 3, 20);
    }
  }
  return score;
}

async function resolveStoreCoordinate(params: {
  client: BaiduMapClient;
  profile: HetangStoreMasterProfile;
  configStore: HetangStoreConfig;
}): Promise<{
  latitude: number;
  longitude: number;
  sourceLabel: string;
  confidenceLabel: string;
  raw: Record<string, unknown>;
}> {
  const region = params.profile.cityName ?? "安阳";
  try {
    const placeResult = await params.client.searchPlacesByRegion({
      query: params.configStore.storeName,
      region,
      cityLimit: true,
      pageSize: 20,
    });
    const ranked = placeResult.pois
      .filter((poi) => typeof poi.latitude === "number" && typeof poi.longitude === "number")
      .map((poi) => ({
        poi,
        score: scoreStorePoiMatch({
          poi,
          profile: params.profile,
          configStore: params.configStore,
        }),
      }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (best && best.score >= 60 && best.poi.latitude !== undefined && best.poi.longitude !== undefined) {
      return {
        latitude: best.poi.latitude,
        longitude: best.poi.longitude,
        sourceLabel: "baidu_maps_place_v2",
        confidenceLabel: `place-score-${best.score}`,
        raw: {
          provider: "baidu_maps",
          method: "place_search",
          query: params.configStore.storeName,
          region,
          selected: {
            uid: best.poi.uid,
            name: best.poi.name,
            address: best.poi.address,
            district: best.poi.district,
            latitude: best.poi.latitude,
            longitude: best.poi.longitude,
            tags: best.poi.tags,
            overallRating: best.poi.overallRating,
            score: best.score,
          },
          candidates: ranked.slice(0, 5).map((entry) => ({
            uid: entry.poi.uid,
            name: entry.poi.name,
            address: entry.poi.address,
            district: entry.poi.district,
            latitude: entry.poi.latitude,
            longitude: entry.poi.longitude,
            tags: entry.poi.tags,
            overallRating: entry.poi.overallRating,
            score: entry.score,
          })),
        },
      };
    }
  } catch (error) {
    if (error instanceof BaiduMapApiError) {
      console.error(
        `[warn] ${params.profile.storeName} (${params.profile.orgId}) Baidu place search failed status=${error.status ?? "unknown"} url=${error.safeUrl}`,
      );
    } else {
      throw error;
    }
  }

  const address = resolveGeocodeAddress(params.profile, params.configStore);
  let geocodeResult: BaiduMapGeocodeResult;
  try {
    geocodeResult = await params.client.geocodeAddress({
      address,
      city: params.profile.cityName,
    });
  } catch (error) {
    if (error instanceof BaiduMapApiError) {
      throw error;
    }
    throw error;
  }
  return {
    latitude: geocodeResult.latitude,
    longitude: geocodeResult.longitude,
    sourceLabel: "baidu_maps_geocoding_v3",
    confidenceLabel: `geocode-confidence-${geocodeResult.confidence ?? "unknown"}-${geocodeResult.level ?? "unknown"}`,
    raw: {
      provider: "baidu_maps",
      method: "geocoding",
      address,
      city: params.profile.cityName,
      precise: geocodeResult.precise,
      confidence: geocodeResult.confidence,
      comprehension: geocodeResult.comprehension,
      level: geocodeResult.level,
    },
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
      if (!profile) {
        console.log(`[skip] ${targetStore.storeName} (${targetStore.orgId}) missing store_master_profile`);
        continue;
      }
      if (hasCoordinates(profile) && !options.overwrite) {
        console.log(`[skip] ${profile.storeName} (${profile.orgId}) already has coordinates`);
        continue;
      }
      let result;
      try {
        result = await resolveStoreCoordinate({
          client,
          profile,
          configStore: targetStore,
        });
      } catch (error) {
        if (error instanceof BaiduMapApiError) {
          console.error(
            `[error] ${profile.storeName} (${profile.orgId}) Baidu coordinate lookup failed status=${error.status ?? "unknown"} url=${error.safeUrl}`,
          );
          continue;
        }
        throw error;
      }
      const nextProfile: HetangStoreMasterProfile = {
        ...profile,
        latitude: result.latitude,
        longitude: result.longitude,
        sourceLabel: result.sourceLabel,
        verifiedAt: new Date().toISOString(),
        rawJson: JSON.stringify({
          ...(profile.rawJson ? { previousRawJson: profile.rawJson } : {}),
          coordinateLookup: result.raw,
        }),
        updatedAt: new Date().toISOString(),
      };
      const summary = `${profile.storeName} (${profile.orgId}) lat=${result.latitude} lng=${result.longitude} source=${result.sourceLabel} confidence=${result.confidenceLabel}`;
      if (options.dryRun) {
        console.log(`[dry-run] ${summary}`);
        continue;
      }
      await store.upsertStoreMasterProfile(nextProfile);
      console.log(`[write] ${summary}`);
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
