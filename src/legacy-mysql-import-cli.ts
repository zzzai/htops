import { resolveOperationalBizDateRangeWindow, resolveOperationalBizDateFromTimestamp } from "./time.js";
import type {
  LegacyMysqlImportData,
  LegacyRechargeRow,
  LegacyConsumeItemRow,
  LegacySettlementDetailRow,
  LegacySnapshotCardRow,
} from "./legacy-mysql-import.js";

const DEFAULT_TARGET_ORG_ID = "627149864218629";
const DEFAULT_LEGACY_SOURCE_ORG_ID = 214001;
const DEFAULT_MYSQL_HOST = "127.0.0.1";
const DEFAULT_MYSQL_PORT = 13307;
const DEFAULT_BIZDAY_CUTOFF = "03:00";

export type ParsedLegacyYingbinImportArgs = {
  mysqlHost: string;
  mysqlPort: number;
  mysqlUser: string;
  mysqlPassword?: string;
  orgId: string;
  legacyOrgId: number;
  startBizDate?: string;
  endBizDate?: string;
  dryRun: boolean;
  rebuildMissingSnapshots: boolean;
};

export function printLegacyYingbinImportUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/import-legacy-yingbin.ts --mysql-user root [options]",
      "",
      "Options:",
      "  --mysql-host HOST                     default 127.0.0.1",
      "  --mysql-port PORT                     default 13307",
      "  --mysql-user USER                     required",
      "  --mysql-password PASSWORD             optional",
      "  --org-id ORG_ID                       default 627149864218629",
      "  --legacy-org-id LEGACY_ORG_ID         default 214001",
      "  --start YYYY-MM-DD                    optional biz-date start",
      "  --end YYYY-MM-DD                      optional biz-date end",
      "  --dry-run                             only inspect counts and coverage",
      "  --no-rebuild-missing-snapshots        skip snapshot reconstruction for uncovered days",
      "  --help                                show this usage",
    ].join("\n"),
  );
}

export function parseLegacyYingbinImportArgs(argv: string[]): ParsedLegacyYingbinImportArgs {
  let mysqlHost = DEFAULT_MYSQL_HOST;
  let mysqlPort = DEFAULT_MYSQL_PORT;
  let mysqlUser: string | undefined;
  let mysqlPassword: string | undefined;
  let orgId = DEFAULT_TARGET_ORG_ID;
  let legacyOrgId = DEFAULT_LEGACY_SOURCE_ORG_ID;
  let startBizDate: string | undefined;
  let endBizDate: string | undefined;
  let dryRun = false;
  let rebuildMissingSnapshots = true;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mysql-host") {
      mysqlHost = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--mysql-port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--mysql-port must be a positive integer");
      }
      mysqlPort = value;
      index += 1;
      continue;
    }
    if (token === "--mysql-user") {
      mysqlUser = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--mysql-password") {
      mysqlPassword = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === "--org-id") {
      orgId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (token === "--legacy-org-id") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--legacy-org-id must be a positive integer");
      }
      legacyOrgId = value;
      index += 1;
      continue;
    }
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
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--no-rebuild-missing-snapshots") {
      rebuildMissingSnapshots = false;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printLegacyYingbinImportUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!mysqlUser?.trim()) {
    throw new Error("--mysql-user is required");
  }
  if ((startBizDate && !endBizDate) || (!startBizDate && endBizDate)) {
    throw new Error("--start and --end must be provided together");
  }
  if (startBizDate && endBizDate && startBizDate > endBizDate) {
    throw new Error("--start must be on or before --end");
  }

  return {
    mysqlHost,
    mysqlPort,
    mysqlUser,
    mysqlPassword,
    orgId,
    legacyOrgId,
    startBizDate,
    endBizDate,
    dryRun,
    rebuildMissingSnapshots,
  };
}

export function resolveLegacyImportTimeWindow(params: {
  startBizDate?: string;
  endBizDate?: string;
  cutoffLocalTime?: string;
}): { startTime?: string; endTime?: string } {
  if (!params.startBizDate || !params.endBizDate) {
    return {};
  }
  return resolveOperationalBizDateRangeWindow({
    startBizDate: params.startBizDate,
    endBizDate: params.endBizDate,
    cutoffLocalTime: params.cutoffLocalTime ?? DEFAULT_BIZDAY_CUTOFF,
  });
}

function collectBizDatesFromTimestampRows<T>(
  rows: T[],
  selector: (row: T) => string | undefined,
): string[] {
  return rows
    .map((row) => selector(row))
    .filter((value): value is string => Boolean(value))
    .map((value) =>
      resolveOperationalBizDateFromTimestamp(value, "Asia/Shanghai", DEFAULT_BIZDAY_CUTOFF),
    );
}

function minMaxBizDates(dates: string[]): { minBizDate?: string; maxBizDate?: string } {
  const ordered = dates.filter(Boolean).sort((left, right) => left.localeCompare(right));
  return {
    minBizDate: ordered[0],
    maxBizDate: ordered[ordered.length - 1],
  };
}

export function summarizeLegacyImportData(data: LegacyMysqlImportData): {
  counts: Record<string, number>;
  snapshotCoveredBizDates: Set<string>;
  minBizDate?: string;
  maxBizDate?: string;
  rechargeMinBizDate?: string;
  rechargeMaxBizDate?: string;
  consumeMinBizDate?: string;
  consumeMaxBizDate?: string;
} {
  const snapshotDates = collectBizDatesFromTimestampRows<LegacySnapshotCardRow>(
    data.snapshotCardRows,
    (row) => row.BAKDATETIME ?? row.BAKEXEDATETIME ?? undefined,
  );
  const rechargeDates = collectBizDatesFromTimestampRows<LegacyRechargeRow>(
    data.rechargeRows,
    (row) => row.OPTIME ?? undefined,
  );
  const consumeDates = collectBizDatesFromTimestampRows<LegacyConsumeItemRow>(
    data.consumeRows,
    (row) => row.SETTLEMENT_TIME ?? undefined,
  );
  const settlementDates = collectBizDatesFromTimestampRows<LegacySettlementDetailRow>(
    data.settlementRows,
    (row) => row.SETTLETIME ?? undefined,
  );
  const allDates = [...snapshotDates, ...rechargeDates, ...consumeDates, ...settlementDates];

  return {
    counts: {
      currentCardRows: data.currentCardRows.length,
      snapshotCardRows: data.snapshotCardRows.length,
      rechargeRows: data.rechargeRows.length,
      consumeRows: data.consumeRows.length,
      settlementRows: data.settlementRows.length,
    },
    snapshotCoveredBizDates: new Set(snapshotDates),
    ...minMaxBizDates(allDates),
    ...Object.fromEntries(
      Object.entries({
        rechargeMinBizDate: minMaxBizDates(rechargeDates).minBizDate,
        rechargeMaxBizDate: minMaxBizDates(rechargeDates).maxBizDate,
        consumeMinBizDate: minMaxBizDates(consumeDates).minBizDate,
        consumeMaxBizDate: minMaxBizDates(consumeDates).maxBizDate,
      }).filter(([, value]) => value !== undefined),
    ),
  };
}
