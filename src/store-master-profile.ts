import type {
  EnvironmentBiasLevel,
  HetangStoreCapacityPrior,
  HetangStoreLifecycleStage,
  HetangStoreMasterDerivedFeatures,
  HetangStoreMasterProfile,
  HetangStoreScaleBand,
} from "./types.js";

type NormalizedWindow = {
  startMinutes: number;
  endMinutes: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseIsoDateParts(value: string | undefined): { year: number; month: number; day: number } | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map((entry) => Number(entry));
  if (![year, month, day].every((entry) => Number.isInteger(entry))) {
    return null;
  }
  return { year, month, day };
}

function diffMonths(startDate: string | undefined, endDate: string): number | null {
  const start = parseIsoDateParts(startDate);
  const end = parseIsoDateParts(endDate);
  if (!start || !end) {
    return null;
  }
  let months = (end.year - start.year) * 12 + (end.month - start.month);
  if (end.day < start.day) {
    months -= 1;
  }
  return months >= 0 ? months : null;
}

function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 29) {
    return null;
  }
  if (minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function normalizeWindow(value: unknown): NormalizedWindow | null {
  if (!isRecord(value)) {
    return null;
  }
  const startMinutes = parseClockMinutes(value.start);
  const endMinutes = parseClockMinutes(value.end);
  if (startMinutes === null || endMinutes === null) {
    return null;
  }
  const overnight = value.overnight === true || endMinutes <= startMinutes;
  return {
    startMinutes,
    endMinutes: overnight ? endMinutes + 24 * 60 : endMinutes,
  };
}

function extractNormalizedWindows(profile: HetangStoreMasterProfile): NormalizedWindow[] {
  const serviceHours = profile.serviceHoursJson;
  if (!isRecord(serviceHours)) {
    return [];
  }
  const rawWindows = serviceHours.windows;
  if (!Array.isArray(rawWindows)) {
    return [];
  }
  return rawWindows
    .map((entry) => normalizeWindow(entry))
    .filter((entry): entry is NormalizedWindow => entry !== null);
}

function overlapMinutes(window: NormalizedWindow, rangeStart: number, rangeEnd: number): number {
  const start = Math.max(window.startMinutes, rangeStart);
  const end = Math.min(window.endMinutes, rangeEnd);
  return Math.max(0, end - start);
}

function resolveLifecycleStage(storeAgeMonths: number | null): HetangStoreLifecycleStage {
  if (storeAgeMonths === null) {
    return "unknown";
  }
  if (storeAgeMonths < 6) {
    return "new";
  }
  if (storeAgeMonths < 18) {
    return "growing";
  }
  if (storeAgeMonths < 48) {
    return "mature";
  }
  return "veteran";
}

function resolveStoreScaleBand(
  areaM2: number | undefined,
  roomCountTotal: number | undefined,
): HetangStoreScaleBand {
  if ((roomCountTotal ?? 0) >= 25 || (areaM2 ?? 0) >= 1800) {
    return "flagship";
  }
  if ((roomCountTotal ?? 0) >= 15 || (areaM2 ?? 0) >= 1000) {
    return "large";
  }
  if ((roomCountTotal ?? 0) >= 8 || (areaM2 ?? 0) >= 500) {
    return "medium";
  }
  if ((roomCountTotal ?? 0) > 0 || (areaM2 ?? 0) > 0) {
    return "small";
  }
  return "unknown";
}

function resolveCapacityPrior(
  areaM2: number | undefined,
  roomCountTotal: number | undefined,
): HetangStoreCapacityPrior {
  if ((roomCountTotal ?? 0) >= 25 || (areaM2 ?? 0) >= 1800) {
    return "very_high";
  }
  if ((roomCountTotal ?? 0) >= 15 || (areaM2 ?? 0) >= 1000) {
    return "high";
  }
  if ((roomCountTotal ?? 0) >= 8 || (areaM2 ?? 0) >= 500) {
    return "medium";
  }
  if ((roomCountTotal ?? 0) > 0 || (areaM2 ?? 0) > 0) {
    return "low";
  }
  return "unknown";
}

function resolveEnvironmentBiasFromScaleBand(
  scaleBand: HetangStoreScaleBand,
): EnvironmentBiasLevel | undefined {
  switch (scaleBand) {
    case "flagship":
    case "large":
      return "high";
    case "medium":
      return "medium";
    case "small":
      return "low";
    default:
      return undefined;
  }
}

export function resolveStoreMasterEnvironmentContext(params: {
  profile: HetangStoreMasterProfile;
  asOfDate: string;
}): {
  lateNightCapable?: boolean;
  storeNightSceneBias?: EnvironmentBiasLevel;
  postDinnerLeisureBias?: EnvironmentBiasLevel;
} {
  const features = buildStoreMasterDerivedFeatures(params);
  const storeNightSceneBias = resolveEnvironmentBiasFromScaleBand(features.storeScaleBand);
  const highCapacity =
    features.capacityPrior === "high" || features.capacityPrior === "very_high";
  const postDinnerLeisureBias =
    features.lateNightCapable && highCapacity
      ? "high"
      : features.lateNightCapable || features.storeScaleBand === "medium"
        ? "medium"
        : storeNightSceneBias
          ? "low"
          : undefined;

  return {
    lateNightCapable: features.lateNightCapable,
    storeNightSceneBias,
    postDinnerLeisureBias,
  };
}

export function buildStoreMasterDerivedFeatures(params: {
  profile: HetangStoreMasterProfile;
  asOfDate: string;
}): HetangStoreMasterDerivedFeatures {
  const windows = extractNormalizedWindows(params.profile);
  const serviceWindowMinutes =
    windows.length > 0
      ? Math.max(...windows.map((entry) => Math.max(0, entry.endMinutes - entry.startMinutes)))
      : null;
  const nightWindowMinutes =
    windows.length > 0
      ? windows.reduce((total, window) => total + overlapMinutes(window, 22 * 60, 30 * 60), 0)
      : null;
  const storeAgeMonths = diffMonths(params.profile.openingDate, params.asOfDate);

  return {
    orgId: params.profile.orgId,
    storeName: params.profile.storeName,
    asOfDate: params.asOfDate,
    storeAgeMonths,
    lifecycleStage: resolveLifecycleStage(storeAgeMonths),
    serviceWindowHours:
      serviceWindowMinutes === null ? null : Number((serviceWindowMinutes / 60).toFixed(2)),
    nightWindowHours:
      nightWindowMinutes === null ? null : Number((nightWindowMinutes / 60).toFixed(2)),
    // Service hours are hard constraints; scale/capacity are only soft priors.
    lateNightCapable: windows.some((window) => window.endMinutes >= 24 * 60 + 30),
    storeScaleBand: resolveStoreScaleBand(params.profile.areaM2, params.profile.roomCountTotal),
    capacityPrior: resolveCapacityPrior(params.profile.areaM2, params.profile.roomCountTotal),
  };
}
