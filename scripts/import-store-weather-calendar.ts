import { Pool } from "pg";

import { OpenMeteoClient, OpenMeteoError } from "../src/open-meteo-client.js";
import { buildHolidayContextEntries, parseManualHolidayOverrides } from "../src/store-calendar-context.js";
import { buildStoreWeatherContextEntries } from "../src/store-weather-context.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import type { HetangStoreConfig, HetangStoreMasterProfile } from "../src/types.js";

type CliOptions = {
  orgIds?: string[];
  dryRun: boolean;
  snapshotDate: string;
  holidayDates?: string;
  workdayDates?: string;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  node --import tsx scripts/import-store-weather-calendar.ts --dry-run",
      "  node --import tsx scripts/import-store-weather-calendar.ts --write --date 2026-05-09",
      "  node --import tsx scripts/import-store-weather-calendar.ts --write --holiday-dates 2026-05-04:青年节活动 --workday-dates 2026-05-09:调休工作日",
      "",
      "Notes:",
      "  Weather source: Open-Meteo Forecast API.",
      "  Holiday source: fixed China calendar rules plus optional manual overrides.",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): CliOptions {
  const orgIds: string[] = [];
  let dryRun = true;
  let snapshotDate = todayIsoDate();
  let holidayDates: string | undefined;
  let workdayDates: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--org" || token === "--org-id") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${token} requires an org id`);
      }
      orgIds.push(value);
      index += 1;
      continue;
    }
    if (token === "--date" || token === "--snapshot-date") {
      const value = argv[index + 1];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
        throw new Error(`${token} requires YYYY-MM-DD`);
      }
      snapshotDate = value;
      index += 1;
      continue;
    }
    if (token === "--holiday-dates") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--holiday-dates requires comma-separated YYYY-MM-DD:label values");
      }
      holidayDates = value;
      index += 1;
      continue;
    }
    if (token === "--workday-dates") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--workday-dates requires comma-separated YYYY-MM-DD:label values");
      }
      workdayDates = value;
      index += 1;
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--write") {
      dryRun = false;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    orgIds: orgIds.length > 0 ? orgIds : undefined,
    dryRun,
    snapshotDate,
    holidayDates,
    workdayDates,
  };
}

function resolveTargetStores(configStores: HetangStoreConfig[], orgIds?: string[]): HetangStoreConfig[] {
  const activeStores = configStores.filter((store) => store.isActive !== false);
  if (!orgIds || orgIds.length === 0) {
    return activeStores;
  }
  const byOrgId = new Map(activeStores.map((store) => [store.orgId, store]));
  return orgIds.map((orgId) => {
    const store = byOrgId.get(orgId);
    if (!store) {
      throw new Error(`Unknown or inactive org id: ${orgId}`);
    }
    return store;
  });
}

function hasCoordinates(profile: HetangStoreMasterProfile | null): profile is HetangStoreMasterProfile & {
  latitude: number;
  longitude: number;
} {
  return (
    profile !== null &&
    typeof profile.latitude === "number" &&
    Number.isFinite(profile.latitude) &&
    typeof profile.longitude === "number" &&
    Number.isFinite(profile.longitude)
  );
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = await loadStandaloneHetangConfig();
  const targetStores = resolveTargetStores(config.stores, options.orgIds);
  const pool = new Pool({ connectionString: config.database.url });
  const store = new HetangOpsStore({
    pool,
    stores: config.stores.map((entry) => ({
      orgId: entry.orgId,
      storeName: entry.storeName,
      rawAliases: entry.rawAliases,
    })),
  });
  const client = new OpenMeteoClient();
  const updatedAt = new Date().toISOString();

  try {
    await store.initialize();

    const holidayRows = buildHolidayContextEntries({
      stores: targetStores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
      })),
      snapshotDate: options.snapshotDate,
      updatedAt,
      overrides: parseManualHolidayOverrides({
        holidayDates: options.holidayDates,
        workdayDates: options.workdayDates,
      }),
    });
    if (options.dryRun) {
      console.log(`[dry-run] calendar rows=${holidayRows.length} date=${options.snapshotDate}`);
    } else {
      for (const row of holidayRows) {
        await store.upsertStoreExternalContextEntry(row);
      }
      console.log(`[write] calendar rows=${holidayRows.length} date=${options.snapshotDate}`);
    }

    for (const targetStore of targetStores) {
      const profile = await store.getStoreMasterProfile(targetStore.orgId);
      if (!hasCoordinates(profile)) {
        console.log(`[skip] ${targetStore.storeName} (${targetStore.orgId}) missing coordinates`);
        continue;
      }
      try {
        const weather = await client.fetchDailyWeather({
          latitude: profile.latitude,
          longitude: profile.longitude,
          startDate: options.snapshotDate,
          endDate: options.snapshotDate,
        });
        const day = weather.days.find((entry) => entry.date === options.snapshotDate) ?? weather.days[0];
        if (!day) {
          console.log(`[skip] ${profile.storeName} (${profile.orgId}) no weather day returned`);
          continue;
        }
        const rows = buildStoreWeatherContextEntries({
          orgId: profile.orgId,
          storeName: profile.storeName,
          snapshotDate: options.snapshotDate,
          updatedAt,
          sourceUri: "https://api.open-meteo.com/v1/forecast",
          weather: day,
        });
        const summary = `${day.weatherText} ${day.temperatureMinC}-${day.temperatureMaxC}C rain=${day.precipitationMm}mm`;
        if (options.dryRun) {
          console.log(`[dry-run] ${profile.storeName} (${profile.orgId}) weather rows=${rows.length} ${summary}`);
          continue;
        }
        for (const row of rows) {
          await store.upsertStoreExternalContextEntry(row);
        }
        console.log(`[write] ${profile.storeName} (${profile.orgId}) weather rows=${rows.length} ${summary}`);
      } catch (error) {
        if (error instanceof OpenMeteoError) {
          console.error(
            `[error] ${profile.storeName} (${profile.orgId}) Open-Meteo failed status=${error.status ?? "unknown"} url=${error.safeUrl}`,
          );
          continue;
        }
        throw error;
      }
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

await main();
