import { Pool } from "pg";

import { createHetangOpsRuntime } from "../src/runtime.js";
import {
  listBackfillAndRebuildBizDateRanges,
  listBackfillAndRebuildBizDates,
  parseBackfillAndRebuildArgs,
  renderBackfillAndRebuildDailyMetricsProgress,
  renderBackfillAndRebuildDailyMetricsStart,
  renderBackfillAndRebuildUsage,
} from "../src/backfill-and-rebuild-script.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";

async function loadHetangConfig() {
  return await loadStandaloneHetangConfig();
}

async function publishServingViews(params: {
  config: Awaited<ReturnType<typeof loadHetangConfig>>;
  publishMode: "rebuild" | "refresh";
  publicationNotes: string;
}): Promise<void> {
  const pool = new Pool({
    connectionString: params.config.database.url,
    allowExitOnIdle: true,
    max: 1,
  });
  const store = new HetangOpsStore({
    pool,
    stores: params.config.stores.map((entry) => ({
      orgId: entry.orgId,
      storeName: entry.storeName,
      rawAliases: entry.rawAliases,
    })),
    deadLetterEnabled: params.config.queue.deadLetterEnabled,
  });

  try {
    await store.initialize();
    await store.ensureAnalyticsViewsReady();
    const servingVersion = await store.publishAnalyticsViews({
      force: true,
      rebuild: params.publishMode === "rebuild",
      notes: params.publicationNotes,
    });
    console.log(
      `Serving publication complete: mode=${params.publishMode}${servingVersion ? ` | version=${servingVersion}` : ""}`,
    );
  } finally {
    await store.close();
    await pool.end();
  }
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(renderBackfillAndRebuildUsage());
    process.exit(0);
  }
  const options = parseBackfillAndRebuildArgs(process.argv.slice(2));
  const config = await loadHetangConfig();
  const orgIds = options.orgIds?.length
    ? options.orgIds
    : config.stores.filter((entry) => entry.isActive).map((entry) => entry.orgId);
  const bizDates = listBackfillAndRebuildBizDates(options.startBizDate, options.endBizDate);
  const bizDateRanges = listBackfillAndRebuildBizDateRanges(options.startBizDate, options.endBizDate);
  const runtime = createHetangOpsRuntime({
    config,
    poolRole: "app",
    logger: {
      info: (message) => console.log(message),
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
    },
    resolveStateDir: () => resolveStandaloneStateDir(),
    runCommandWithTimeout: async () => ({
      code: 1,
      stdout: "",
      stderr: "runCommandWithTimeout is not available in the backfill script",
      timedOut: false,
      signal: null,
      pid: 0,
      ok: false,
      durationMs: 0,
    }),
  });

  try {
    if (!options.skipBackfill) {
      console.log(
        `Starting Hetang backfill for ${orgIds.length} store(s), ${bizDateRanges.length} weekly slice(s), ${bizDates.length} business day(s).`,
      );
      for (const line of await runtime.backfillStores({
        orgIds,
        startBizDate: options.startBizDate,
        endBizDate: options.endBizDate,
      })) {
        console.log(line);
      }
    }

    if (!options.skipRebuild) {
      console.log(renderBackfillAndRebuildDailyMetricsStart(orgIds.length, bizDates.length));
      for (const orgId of orgIds) {
        for (const bizDate of bizDates) {
          const report = await runtime.buildReport({ orgId, bizDate });
          console.log(
            renderBackfillAndRebuildDailyMetricsProgress({
              storeName: report.storeName,
              bizDate,
              complete: report.complete,
            }),
          );
        }
      }
    }

    if (options.publishMode !== "skip") {
      console.log(
        `Publishing analytics views after rebuild window ${options.startBizDate}..${options.endBizDate} with mode=${options.publishMode}.`,
      );
      await publishServingViews({
        config,
        publishMode: options.publishMode,
        publicationNotes: options.publicationNotes,
      });
    }
  } finally {
    await runtime.close();
  }
}

await main();
