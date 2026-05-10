import { Pool } from "pg";

import { buildStoreExternalEnvironmentFeatureEntries } from "../src/store-external-environment-features.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import type { HetangStoreConfig } from "../src/types.js";

type CliOptions = {
  orgIds?: string[];
  snapshotDate?: string;
  dryRun: boolean;
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/build-store-external-environment-features.ts --dry-run",
      "  node --import tsx scripts/build-store-external-environment-features.ts --write --org 627150985244677",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let snapshotDate: string | undefined;
  let dryRun = true;

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
    if (token === "--date" || token === "--snapshot-date") {
      const value = argv[index + 1];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        throw new Error(`${token} requires YYYY-MM-DD`);
      }
      snapshotDate = value;
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
    snapshotDate,
    dryRun,
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

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
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

  try {
    await store.initialize();
    for (const targetStore of targetStores) {
      const entries = await store.listStoreExternalContextEntries({
        orgId: targetStore.orgId,
        snapshotDate: options.snapshotDate,
      });
      if (entries.length === 0) {
        console.log(`[skip] ${targetStore.storeName} (${targetStore.orgId}) no external context entries`);
        continue;
      }
      const snapshotDate = entries[0]?.snapshotDate ?? options.snapshotDate ?? new Date().toISOString().slice(0, 10);
      const updatedAt = new Date().toISOString();
      const featureEntries = buildStoreExternalEnvironmentFeatureEntries({
        orgId: targetStore.orgId,
        snapshotDate,
        storeName: targetStore.storeName,
        updatedAt,
        entries,
      });
      const summary = featureEntries
        .filter((entry) => entry.metricKey.endsWith("_score_3km") || entry.metricKey.endsWith("_band_3km"))
        .map((entry) => `${entry.metricKey}=${entry.valueNum ?? entry.valueText ?? "N/A"}`)
        .join(", ");
      if (options.dryRun) {
        console.log(`[dry-run] ${targetStore.storeName} (${targetStore.orgId}) features=${featureEntries.length} ${summary}`);
        continue;
      }
      for (const row of featureEntries) {
        await store.upsertStoreExternalContextEntry(row);
      }
      console.log(`[write] ${targetStore.storeName} (${targetStore.orgId}) features=${featureEntries.length} ${summary}`);
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
