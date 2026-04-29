import { Pool } from "pg";

import {
  parseIndustryContextImportArgs,
  renderIndustryContextImportUsage,
} from "../src/import-industry-context-cli.js";
import { importIndustryContextSnapshot } from "../src/import-industry-context-script.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";

function printUsage(): void {
  console.log(renderIndustryContextImportUsage());
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printUsage();
    return;
  }
  const options = parseIndustryContextImportArgs(argv);
  const config = await loadStandaloneHetangConfig();
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
    for (const inputPath of options.inputPaths) {
      await importIndustryContextSnapshot({
        store,
        filePath: inputPath,
        log: (line) => console.log(line),
      });
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
