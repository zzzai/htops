import { Pool } from "pg";
import { rebuildCustomerIntelligenceForDateRange } from "../src/customer-intelligence.js";
import { rebuildMemberDailySnapshotsForDateRange } from "../src/customer-history-backfill.js";
import {
  importLegacyYingbinData,
  listUncoveredBizDateRanges,
  loadLegacyYingbinDataFromMysql,
} from "../src/legacy-mysql-import.js";
import {
  parseLegacyYingbinImportArgs,
  printLegacyYingbinImportUsage,
  resolveLegacyImportTimeWindow,
  summarizeLegacyImportData,
} from "../src/legacy-mysql-import-cli.js";
import { rebuildMemberReactivationFeaturesForDateRange } from "../src/reactivation-features.js";
import { rebuildMemberReactivationStrategiesForDateRange } from "../src/reactivation-strategy.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  let args;
  try {
    args = parseLegacyYingbinImportArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    printLegacyYingbinImportUsage();
    process.exit(1);
  }

  const config = await loadStandaloneHetangConfig();
  const targetStore =
    config.stores.find((entry) => entry.orgId === args.orgId) ??
    config.stores.find((entry) => entry.storeName.includes("迎宾店"));
  const storeName = targetStore?.storeName ?? "荷塘悦色迎宾店";
  const timeWindow = resolveLegacyImportTimeWindow({
    startBizDate: args.startBizDate,
    endBizDate: args.endBizDate,
    cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
  });

  console.log(
    `[legacy-import] loading ${storeName} from MySQL ${args.mysqlHost}:${args.mysqlPort} (legacy org ${args.legacyOrgId})`,
  );
  const data = await loadLegacyYingbinDataFromMysql({
    host: args.mysqlHost,
    port: args.mysqlPort,
    user: args.mysqlUser,
    password: args.mysqlPassword,
    legacyOrgId: args.legacyOrgId,
    startTime: timeWindow.startTime,
    endTime: timeWindow.endTime,
  });

  const summary = summarizeLegacyImportData(data);
  console.log(
    JSON.stringify(
      {
        storeName,
        orgId: args.orgId,
        dryRun: args.dryRun,
        requestedRange:
          args.startBizDate && args.endBizDate
            ? { startBizDate: args.startBizDate, endBizDate: args.endBizDate }
            : null,
        counts: summary.counts,
        minBizDate: summary.minBizDate,
        maxBizDate: summary.maxBizDate,
        rechargeMinBizDate: summary.rechargeMinBizDate,
        rechargeMaxBizDate: summary.rechargeMaxBizDate,
        consumeMinBizDate: summary.consumeMinBizDate,
        consumeMaxBizDate: summary.consumeMaxBizDate,
        snapshotCoveredDays: summary.snapshotCoveredBizDates.size,
      },
      null,
      2,
    ),
  );

  if (args.dryRun) {
    return;
  }

  const rebuildStartBizDate = args.startBizDate ?? summary.minBizDate;
  const rebuildEndBizDate = args.endBizDate ?? summary.maxBizDate;
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

    await importLegacyYingbinData({
      orgId: args.orgId,
      storeName,
      store,
      refreshViews: false,
      ...data,
    });

    if (rebuildStartBizDate && rebuildEndBizDate && args.rebuildMissingSnapshots) {
      const missingSnapshotRanges = listUncoveredBizDateRanges({
        startBizDate: rebuildStartBizDate,
        endBizDate: rebuildEndBizDate,
        coveredBizDates: summary.snapshotCoveredBizDates,
      });
      console.log(
        `[legacy-import] snapshot-covered days=${summary.snapshotCoveredBizDates.size}, rebuild-missing ranges=${missingSnapshotRanges.length}`,
      );
      for (const range of missingSnapshotRanges) {
        console.log(
          `[legacy-import] rebuilding missing member snapshots ${range.startBizDate}..${range.endBizDate}`,
        );
        await rebuildMemberDailySnapshotsForDateRange({
          store,
          orgId: args.orgId,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
        });
      }
    }

    if (rebuildStartBizDate && rebuildEndBizDate) {
      console.log(
        `[legacy-import] rebuilding intelligence ${rebuildStartBizDate}..${rebuildEndBizDate}`,
      );
      await rebuildCustomerIntelligenceForDateRange({
        store,
        orgId: args.orgId,
        startBizDate: rebuildStartBizDate,
        endBizDate: rebuildEndBizDate,
        refreshViews: false,
        chunkDays: 14,
      });
      console.log(
        `[legacy-import] rebuilding reactivation features ${rebuildStartBizDate}..${rebuildEndBizDate}`,
      );
      await rebuildMemberReactivationFeaturesForDateRange({
        store,
        orgId: args.orgId,
        startBizDate: rebuildStartBizDate,
        endBizDate: rebuildEndBizDate,
        refreshViews: false,
      });
      console.log(
        `[legacy-import] rebuilding reactivation strategies ${rebuildStartBizDate}..${rebuildEndBizDate}`,
      );
      await rebuildMemberReactivationStrategiesForDateRange({
        store,
        orgId: args.orgId,
        startBizDate: rebuildStartBizDate,
        endBizDate: rebuildEndBizDate,
        refreshViews: false,
        storeConfig: config.stores.find((entry) => entry.orgId === args.orgId),
      });
    }

    await store.forceRebuildAnalyticsViews();
    console.log("[legacy-import] complete");
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
