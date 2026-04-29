import { Pool } from "pg";

import { importStoreMasterProfiles } from "../src/import-store-master-profiles-script.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";

type CliOptions = {
  inputPaths: string[];
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/import-store-master-profiles.ts --input data/store-master-profiles/hetang-five-stores.initial.json",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const inputPaths: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--input") {
      const inputPath = argv[index + 1];
      if (!inputPath) {
        throw new Error("--input requires a path");
      }
      inputPaths.push(inputPath);
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (inputPaths.length === 0) {
    throw new Error("At least one --input path is required");
  }

  return {
    inputPaths,
  };
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
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
      await importStoreMasterProfiles({
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
