import { Pool } from "pg";
import {
  parseDailyMetricReconciliationArgs,
  reconcileDailyStoreMetrics,
  renderDailyMetricReconciliationReport,
  renderDailyMetricReconciliationUsage,
} from "../src/daily-metric-reconciliation.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneHetangConfigFromFile,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";

async function loadConfig(configPath?: string) {
  if (configPath) {
    await loadStandaloneRuntimeEnv();
    return await loadStandaloneHetangConfigFromFile(configPath);
  }
  return await loadStandaloneHetangConfig();
}

async function main(): Promise<void> {
  const args = parseDailyMetricReconciliationArgs(process.argv.slice(2));
  const config = await loadConfig(args.configPath);
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
    const report = await reconcileDailyStoreMetrics({
      config,
      store,
      orgId: args.orgId,
      bizDate: args.bizDate,
    });

    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(
        renderDailyMetricReconciliationReport(report, {
          showMatches: args.showMatches,
        }),
      );
    }

    if (args.failOnDiff && report.summary.hasDiffs) {
      process.exitCode = 2;
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

void main().catch((error) => {
  if (error instanceof Error && error.message === renderDailyMetricReconciliationUsage()) {
    console.log(error.message);
    process.exitCode = 0;
    return;
  }
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
