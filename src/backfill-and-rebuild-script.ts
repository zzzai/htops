import { shiftBizDate } from "./time.js";

export type BackfillAndRebuildPublishMode = "rebuild" | "refresh" | "skip";

export type BackfillAndRebuildCliOptions = {
  startBizDate: string;
  endBizDate: string;
  orgIds?: string[];
  skipBackfill: boolean;
  skipRebuild: boolean;
  publishMode: BackfillAndRebuildPublishMode;
  publicationNotes: string;
};

export function renderBackfillAndRebuildUsage(): string {
  return [
    "Usage:",
    "  node --import tsx scripts/backfill-and-rebuild.ts --start YYYY-MM-DD --end YYYY-MM-DD [--org ORG_ID] [--skip-backfill] [--skip-rebuild] [--publish rebuild|refresh|skip] [--notes TEXT]",
  ].join("\n");
}

export function parseBackfillAndRebuildArgs(argv: string[]): BackfillAndRebuildCliOptions {
  const orgIds: string[] = [];
  let startBizDate: string | undefined;
  let endBizDate: string | undefined;
  let skipBackfill = false;
  let skipRebuild = false;
  let publishMode: BackfillAndRebuildPublishMode = "rebuild";
  let publicationNotes = "daily-metrics-range-rebuild";

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
    if (token === "--skip-backfill") {
      skipBackfill = true;
      continue;
    }
    if (token === "--skip-rebuild") {
      skipRebuild = true;
      continue;
    }
    if (token === "--publish") {
      const value = argv[index + 1];
      if (value !== "rebuild" && value !== "refresh" && value !== "skip") {
        throw new Error("--publish must be one of rebuild, refresh, skip");
      }
      publishMode = value;
      index += 1;
      continue;
    }
    if (token === "--notes") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--notes requires a value");
      }
      publicationNotes = value;
      index += 1;
      continue;
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
    skipBackfill,
    skipRebuild,
    publishMode,
    publicationNotes,
  };
}

export function listBackfillAndRebuildBizDates(
  startBizDate: string,
  endBizDate: string,
): string[] {
  if (startBizDate > endBizDate) {
    throw new Error("startBizDate must be on or before endBizDate");
  }

  const dates: string[] = [];
  for (let cursor = startBizDate; cursor <= endBizDate; cursor = shiftBizDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

export function listBackfillAndRebuildBizDateRanges(
  startBizDate: string,
  endBizDate: string,
  maxDaysPerRange = 7,
): Array<{ startBizDate: string; endBizDate: string }> {
  const bizDates = listBackfillAndRebuildBizDates(startBizDate, endBizDate);
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

export function renderBackfillAndRebuildDailyMetricsStart(
  storeCount: number,
  bizDateCount: number,
): string {
  return `Rebuilding daily metrics for ${storeCount} store(s), ${bizDateCount} business day(s).`;
}

export function renderBackfillAndRebuildDailyMetricsProgress(params: {
  storeName: string;
  bizDate: string;
  complete: boolean;
}): string {
  return `${params.storeName} ${params.bizDate}: daily metrics rebuilt (${params.complete ? "complete" : "incomplete"})`;
}
