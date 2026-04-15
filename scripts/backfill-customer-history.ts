import { Pool } from "pg";
import { rebuildCustomerIntelligenceForDateRange } from "../src/customer-intelligence.js";
import { rebuildMemberDailySnapshotsForDateRange } from "../src/customer-history-backfill.js";
import { rebuildMemberReactivationFeaturesForDateRange } from "../src/reactivation-features.js";
import { rebuildMemberReactivationStrategiesForDateRange } from "../src/reactivation-strategy.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import { syncHetangStore } from "../src/sync.js";
import { resolveOperationalBizDateRangeWindow, shiftBizDate } from "../src/time.js";

type CliOptions = {
  startBizDate: string;
  endBizDate: string;
  orgIds?: string[];
  catalogLookbackDays: number;
  intelligenceChunkDays: number;
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx /root/htops/scripts/backfill-customer-history.ts --start YYYY-MM-DD --end YYYY-MM-DD [--org ORG_ID] [--catalog-lookback-days 365] [--intelligence-chunk-days 14]",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let startBizDate: string | undefined;
  let endBizDate: string | undefined;
  let catalogLookbackDays = 365;
  let intelligenceChunkDays = 14;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--start") {
      startBizDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--end") {
      endBizDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--org") {
      const orgId = argv[index + 1];
      if (!orgId) {
        throw new Error("--org requires an OrgId");
      }
      orgIds.push(orgId);
      index += 1;
      continue;
    }
    if (token === "--catalog-lookback-days") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--catalog-lookback-days must be a positive integer");
      }
      catalogLookbackDays = value;
      index += 1;
      continue;
    }
    if (token === "--intelligence-chunk-days") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--intelligence-chunk-days must be a positive integer");
      }
      intelligenceChunkDays = value;
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!startBizDate || !endBizDate) {
    throw new Error("--start and --end are required");
  }
  if (startBizDate > endBizDate) {
    throw new Error("startBizDate must be on or before endBizDate");
  }

  return {
    startBizDate,
    endBizDate,
    orgIds: orgIds.length > 0 ? orgIds : undefined,
    catalogLookbackDays,
    intelligenceChunkDays,
  };
}

function listBizDates(startBizDate: string, endBizDate: string): string[] {
  const dates: string[] = [];
  for (let cursor = startBizDate; cursor <= endBizDate; cursor = shiftBizDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function listBizDateRanges(
  startBizDate: string,
  endBizDate: string,
  maxDaysPerRange = 7,
): Array<{ startBizDate: string; endBizDate: string }> {
  const bizDates = listBizDates(startBizDate, endBizDate);
  const ranges: Array<{ startBizDate: string; endBizDate: string }> = [];
  for (let index = 0; index < bizDates.length; index += maxDaysPerRange) {
    const chunk = bizDates.slice(index, index + maxDaysPerRange);
    if (chunk.length === 0) {
      continue;
    }
    ranges.push({
      startBizDate: chunk[0],
      endBizDate: chunk[chunk.length - 1],
    });
  }
  return ranges;
}

async function loadHetangConfig() {
  return await loadStandaloneHetangConfig();
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = await loadHetangConfig();
  const orgIds = options.orgIds?.length
    ? options.orgIds
    : config.stores.filter((entry) => entry.isActive).map((entry) => entry.orgId);

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
    await store.ensureAnalyticsViewsReady();

    for (const orgId of orgIds) {
      const storeName = config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
      const catalogStartBizDate = shiftBizDate(
        options.startBizDate,
        -options.catalogLookbackDays,
      );
      const catalogRanges = listBizDateRanges(catalogStartBizDate, options.endBizDate, 30);
      console.log(
        `[${storeName}] member catalog sync ${catalogStartBizDate}..${options.endBizDate} (${catalogRanges.length} slices)`,
      );
      for (const range of catalogRanges) {
        const windowOverride = resolveOperationalBizDateRangeWindow({
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
          cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
        });
        await syncHetangStore({
          config,
          store,
          orgId,
          now: new Date(),
          logger: {
            info: (message) => console.log(message),
            warn: (message) => console.warn(message),
            error: (message) => console.error(message),
          },
          syncPlan: {
            mode: "backfill",
            windowOverride,
            skipEndpoints: ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"],
          },
        });
        console.log(`[${storeName}] member catalog slice ${range.startBizDate}..${range.endBizDate} complete`);
      }

      const snapshotCount = await rebuildMemberDailySnapshotsForDateRange({
        store,
        orgId,
        startBizDate: options.startBizDate,
        endBizDate: options.endBizDate,
      });
      console.log(`[${storeName}] member snapshots rebuilt for ${snapshotCount} days`);

      const intelligenceCount = await rebuildCustomerIntelligenceForDateRange({
        store,
        orgId,
        startBizDate: options.startBizDate,
        endBizDate: options.endBizDate,
        refreshViews: false,
        chunkDays: options.intelligenceChunkDays,
      });
      console.log(`[${storeName}] customer intelligence rebuilt for ${intelligenceCount} days`);

      const reactivationFeatureCount = await rebuildMemberReactivationFeaturesForDateRange({
        store,
        orgId,
        startBizDate: options.startBizDate,
        endBizDate: options.endBizDate,
        refreshViews: false,
      });
      console.log(
        `[${storeName}] member reactivation features rebuilt for ${reactivationFeatureCount} days`,
      );

      const reactivationStrategyCount = await rebuildMemberReactivationStrategiesForDateRange({
        store,
        orgId,
        startBizDate: options.startBizDate,
        endBizDate: options.endBizDate,
        refreshViews: false,
      });
      console.log(
        `[${storeName}] member reactivation strategies rebuilt for ${reactivationStrategyCount} days`,
      );
    }

    await store.forceRebuildAnalyticsViews();
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
