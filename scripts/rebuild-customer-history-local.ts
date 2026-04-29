import { Pool } from "pg";
import { resolveHistoryCatchupOrgIds, resolveHistoryCatchupRange } from "../src/history-catchup.js";
import { runLocalCustomerHistoryCatchup } from "../src/rebuild-customer-history-local-script.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";

type CliOptions = {
  startBizDate?: string;
  endBizDate?: string;
  orgIds?: string[];
  intelligenceChunkDays: number;
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/rebuild-customer-history-local.ts [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--org ORG_ID] [--intelligence-chunk-days 14]",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let startBizDate: string | undefined;
  let endBizDate: string | undefined;
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

  if ((startBizDate && !endBizDate) || (!startBizDate && endBizDate)) {
    throw new Error("--start and --end must be used together");
  }
  if (startBizDate && endBizDate && startBizDate > endBizDate) {
    throw new Error("startBizDate must be on or before endBizDate");
  }

  return {
    startBizDate,
    endBizDate,
    orgIds: orgIds.length > 0 ? orgIds : undefined,
    intelligenceChunkDays,
  };
}

async function loadHetangConfig() {
  return await loadStandaloneHetangConfig();
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = await loadHetangConfig();
  const range =
    options.startBizDate && options.endBizDate
      ? {
          startBizDate: options.startBizDate,
          endBizDate: options.endBizDate,
        }
      : resolveHistoryCatchupRange({
          now: new Date(),
          timeZone: config.timeZone,
          cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
          historyBackfillDays: config.sync.historyBackfillDays,
        });
  const orgIds = resolveHistoryCatchupOrgIds(config, options.orgIds);

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
    await runLocalCustomerHistoryCatchup({
      store,
      stores: config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        roomCount: entry.roomCount,
        operatingHoursPerDay: entry.operatingHoursPerDay,
      })),
      orgIds,
      range,
      intelligenceChunkDays: options.intelligenceChunkDays,
      log: (line) => console.log(line),
    });
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
