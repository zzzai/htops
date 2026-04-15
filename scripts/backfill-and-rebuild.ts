import { createHetangOpsRuntime } from "../src/runtime.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "../src/standalone-env.js";
import { shiftBizDate } from "../src/time.js";

type CliOptions = {
  startBizDate: string;
  endBizDate: string;
  orgIds?: string[];
  skipBackfill: boolean;
  skipRebuild: boolean;
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/backfill-and-rebuild.ts --start YYYY-MM-DD --end YYYY-MM-DD [--org ORG_ID] [--skip-backfill] [--skip-rebuild]",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    skipBackfill: false,
    skipRebuild: false,
  };
  const orgIds: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--start") {
      options.startBizDate = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--end") {
      options.endBizDate = argv[index + 1];
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
    if (token === "--skip-backfill") {
      options.skipBackfill = true;
      continue;
    }
    if (token === "--skip-rebuild") {
      options.skipRebuild = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.startBizDate || !options.endBizDate) {
    throw new Error("--start and --end are required");
  }

  return {
    startBizDate: options.startBizDate,
    endBizDate: options.endBizDate,
    orgIds: orgIds.length > 0 ? orgIds : undefined,
    skipBackfill: options.skipBackfill ?? false,
    skipRebuild: options.skipRebuild ?? false,
  };
}

function listBizDates(startBizDate: string, endBizDate: string): string[] {
  if (startBizDate > endBizDate) {
    throw new Error("startBizDate must be on or before endBizDate");
  }

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
  const bizDates = listBizDates(options.startBizDate, options.endBizDate);
  const bizDateRanges = listBizDateRanges(options.startBizDate, options.endBizDate);
  const runtime = createHetangOpsRuntime({
    config,
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
      console.log(
        `Rebuilding daily reports for ${orgIds.length} store(s), ${bizDates.length} business day(s).`,
      );
      for (const orgId of orgIds) {
        for (const bizDate of bizDates) {
          const report = await runtime.buildReport({ orgId, bizDate });
          console.log(
            `${report.storeName} ${bizDate}: report rebuilt (${report.complete ? "complete" : "incomplete"})`,
          );
        }
      }
    }
  } finally {
    await runtime.close();
  }
}

await main();
