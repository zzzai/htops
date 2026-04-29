import { readFile } from "node:fs/promises";

import type {
  HetangStoreMasterProfile,
  HetangStoreOperatingStatus,
  HetangStoreParkingConvenienceLevel,
} from "./types.js";

type StoreMasterProfilesDocument = {
  snapshotDate?: string;
  profiles: Array<
    HetangStoreMasterProfile & {
      snapshotDate?: string;
      snapshotCapturedAt?: string;
    }
  >;
};

type StoreMasterProfileImportStore = {
  upsertStoreMasterProfile: (row: HetangStoreMasterProfile) => Promise<void>;
  insertStoreMasterProfileSnapshot: (row: HetangStoreMasterProfile & {
    snapshotDate: string;
    snapshotCapturedAt: string;
  }) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function assertIsoDate(value: string | undefined, fieldName: string, filePath: string): void {
  if (value !== undefined && !isIsoDate(value)) {
    throw new Error(`Invalid ${fieldName} in ${filePath}: ${value}`);
  }
}

function assertFiniteNumber(
  value: number | undefined,
  fieldName: string,
  filePath: string,
  allowZero = true,
): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value) || (!allowZero && value <= 0)) {
    throw new Error(`Invalid ${fieldName} in ${filePath}: ${value}`);
  }
}

function isParkingConvenienceLevel(
  value: unknown,
): value is HetangStoreParkingConvenienceLevel {
  return value === "high" || value === "medium" || value === "low" || value === "unknown";
}

function isOperatingStatus(value: unknown): value is HetangStoreOperatingStatus {
  return (
    value === "planning" ||
    value === "trial" ||
    value === "operating" ||
    value === "renovating" ||
    value === "closed"
  );
}

function parseProfile(
  value: unknown,
  index: number,
  filePath: string,
  defaultSnapshotDate?: string,
): HetangStoreMasterProfile & {
  snapshotDate?: string;
  snapshotCapturedAt?: string;
} {
  if (!isRecord(value)) {
    throw new Error(`Invalid store master profile at index ${index}: ${filePath}`);
  }

  const orgId = value.orgId;
  const storeName = value.storeName;
  const updatedAt = value.updatedAt;
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    throw new Error(`Missing orgId at index ${index}: ${filePath}`);
  }
  if (typeof storeName !== "string" || storeName.trim().length === 0) {
    throw new Error(`Missing storeName at index ${index}: ${filePath}`);
  }
  if (typeof updatedAt !== "string" || updatedAt.trim().length === 0) {
    throw new Error(`Missing updatedAt at index ${index}: ${filePath}`);
  }

  const openingDate = typeof value.openingDate === "string" ? value.openingDate : undefined;
  const renovationDate = typeof value.renovationDate === "string" ? value.renovationDate : undefined;
  const snapshotDate =
    typeof value.snapshotDate === "string"
      ? value.snapshotDate
      : defaultSnapshotDate ?? updatedAt.slice(0, 10);
  const snapshotCapturedAt =
    typeof value.snapshotCapturedAt === "string" ? value.snapshotCapturedAt : updatedAt;
  const longitude = typeof value.longitude === "number" ? value.longitude : undefined;
  const latitude = typeof value.latitude === "number" ? value.latitude : undefined;
  const areaM2 = typeof value.areaM2 === "number" ? value.areaM2 : undefined;
  const roomCountTotal = typeof value.roomCountTotal === "number" ? value.roomCountTotal : undefined;

  assertIsoDate(openingDate, "openingDate", filePath);
  assertIsoDate(renovationDate, "renovationDate", filePath);
  assertIsoDate(snapshotDate, "snapshotDate", filePath);
  assertFiniteNumber(areaM2, "areaM2", filePath, false);
  assertFiniteNumber(roomCountTotal, "roomCountTotal", filePath, false);
  assertFiniteNumber(longitude, "longitude", filePath);
  assertFiniteNumber(latitude, "latitude", filePath);

  if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
    throw new Error(`Invalid longitude in ${filePath}: ${longitude}`);
  }
  if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
    throw new Error(`Invalid latitude in ${filePath}: ${latitude}`);
  }
  if (
    value.serviceHoursJson !== undefined &&
    (!isRecord(value.serviceHoursJson) || Array.isArray(value.serviceHoursJson))
  ) {
    throw new Error(`Invalid serviceHoursJson at index ${index}: ${filePath}`);
  }

  return {
    orgId,
    storeName,
    brandName: typeof value.brandName === "string" ? value.brandName : undefined,
    cityName: typeof value.cityName === "string" ? value.cityName : undefined,
    districtName: typeof value.districtName === "string" ? value.districtName : undefined,
    addressText: typeof value.addressText === "string" ? value.addressText : undefined,
    longitude,
    latitude,
    openingDate,
    renovationDate,
    areaM2,
    roomCountTotal,
    roomMixJson: isRecord(value.roomMixJson) ? value.roomMixJson : undefined,
    serviceHoursJson: isRecord(value.serviceHoursJson) ? value.serviceHoursJson : undefined,
    storeFormat: typeof value.storeFormat === "string" ? value.storeFormat : undefined,
    businessScene: typeof value.businessScene === "string" ? value.businessScene : undefined,
    parkingAvailable:
      typeof value.parkingAvailable === "boolean" ? value.parkingAvailable : undefined,
    parkingConvenienceLevel: isParkingConvenienceLevel(value.parkingConvenienceLevel)
      ? value.parkingConvenienceLevel
      : undefined,
    operatingStatus: isOperatingStatus(value.operatingStatus) ? value.operatingStatus : undefined,
    sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : undefined,
    verifiedAt: typeof value.verifiedAt === "string" ? value.verifiedAt : undefined,
    rawJson: typeof value.rawJson === "string" ? value.rawJson : JSON.stringify(value),
    updatedAt,
    snapshotDate,
    snapshotCapturedAt,
  };
}

function parseStoreMasterProfilesDocument(
  value: unknown,
  filePath: string,
): StoreMasterProfilesDocument {
  if (!isRecord(value)) {
    throw new Error(`Invalid store master profiles document: ${filePath}`);
  }
  const rawProfiles = value.profiles;
  if (!Array.isArray(rawProfiles)) {
    throw new Error(`Invalid store master profiles payload: ${filePath}`);
  }

  const snapshotDate = typeof value.snapshotDate === "string" ? value.snapshotDate : undefined;
  assertIsoDate(snapshotDate, "snapshotDate", filePath);

  const seenOrgIds = new Set<string>();
  const profiles = rawProfiles.map((entry, index) => {
    const parsed = parseProfile(entry, index, filePath, snapshotDate);
    if (seenOrgIds.has(parsed.orgId)) {
      throw new Error(`Duplicated orgId in ${filePath}: ${parsed.orgId}`);
    }
    seenOrgIds.add(parsed.orgId);
    return parsed;
  });

  return {
    snapshotDate,
    profiles,
  };
}

export async function importStoreMasterProfiles(params: {
  store: StoreMasterProfileImportStore;
  filePath: string;
  readFile?: (filePath: string) => Promise<string>;
  log?: (line: string) => void;
}): Promise<{
  snapshotDate: string;
  importedCount: number;
}> {
  const readText = params.readFile ?? (async (filePath: string) => await readFile(filePath, "utf8"));
  const document = parseStoreMasterProfilesDocument(
    JSON.parse(await readText(params.filePath)),
    params.filePath,
  );

  for (const profile of document.profiles) {
    await params.store.upsertStoreMasterProfile(profile);
    await params.store.insertStoreMasterProfileSnapshot({
      ...profile,
      snapshotDate: profile.snapshotDate ?? document.snapshotDate ?? profile.updatedAt.slice(0, 10),
      snapshotCapturedAt: profile.snapshotCapturedAt ?? profile.updatedAt,
    });
  }

  const resolvedSnapshotDate =
    document.snapshotDate ?? document.profiles[0]?.snapshotDate ?? new Date().toISOString().slice(0, 10);

  params.log?.(
    `Imported ${document.profiles.length} store master profiles for snapshot=${resolvedSnapshotDate} from ${params.filePath}`,
  );

  return {
    snapshotDate: resolvedSnapshotDate,
    importedCount: document.profiles.length,
  };
}
