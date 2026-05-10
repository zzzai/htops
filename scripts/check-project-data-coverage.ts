import { Pool } from "pg";

import {
  buildProjectDataCoverageReport,
  formatProjectDataCoverageReport,
} from "../src/project-data-coverage.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import { shiftBizDate } from "../src/time.js";
import type { HetangStoreConfig } from "../src/types.js";

type CliOptions = {
  orgIds?: string[];
  startBizDate: string;
  endBizDate: string;
  json: boolean;
};

function defaultEndBizDate(): string {
  return shiftBizDate(new Date().toISOString().slice(0, 10), -1);
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/check-project-data-coverage.ts",
      "  node --import tsx scripts/check-project-data-coverage.ts --start 2025-10-01 --end 2026-05-09",
      "  node --import tsx scripts/check-project-data-coverage.ts --org 627150985244677 --json",
    ].join("\n"),
  );
}

function parseDate(value: string | undefined, flag: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${flag} requires YYYY-MM-DD`);
  }
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let endBizDate = defaultEndBizDate();
  let startBizDate = "2025-10-01";
  let json = false;

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
    if (token === "--start" || token === "--start-biz-date") {
      startBizDate = parseDate(argv[index + 1], token);
      index += 1;
      continue;
    }
    if (token === "--end" || token === "--end-biz-date") {
      endBizDate = parseDate(argv[index + 1], token);
      index += 1;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (startBizDate > endBizDate) {
    throw new Error("--start must be on or before --end");
  }
  return {
    orgIds: orgIds.length > 0 ? orgIds : undefined,
    startBizDate,
    endBizDate,
    json,
  };
}

function resolveTargetStores(stores: HetangStoreConfig[], orgIds?: string[]): HetangStoreConfig[] {
  const activeStores = stores.filter((store) => store.isActive !== false);
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
    const snapshots = await Promise.all(
      targetStores.map((targetStore) =>
        store.getHistoricalCoverageSnapshot({
          orgId: targetStore.orgId,
          startBizDate: options.startBizDate,
          endBizDate: options.endBizDate,
        }),
      ),
    );
    const report = buildProjectDataCoverageReport({
      startBizDate: options.startBizDate,
      endBizDate: options.endBizDate,
      stores: targetStores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
      })),
      snapshots,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : formatProjectDataCoverageReport(report));
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
