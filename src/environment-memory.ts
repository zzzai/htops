import { buildEnvironmentContextSnapshot } from "./environment-context.js";
import { resolveStoreMasterEnvironmentContext } from "./store-master-profile.js";
import type {
  ChinaHolidayCalendarDayRecord,
  HetangStoreMasterProfile,
  StoreEnvironmentDailySnapshotRecord,
} from "./types.js";

export type StoreEnvironmentWeatherObservation = {
  condition?: string;
  temperatureC?: number | null;
  precipitationMm?: number | null;
  windLevel?: number | null;
  observedAt?: string;
  provider?: string;
  rawJson?: string;
};

export type StoreEnvironmentMemorySource = {
  cityName?: string;
  longitude?: number;
  latitude?: number;
  holidaySourceVersion?: string;
  holidaySourceLabel?: string;
  weatherProvider?: string;
  weatherObservedAt?: string;
  holidayRawJson?: string;
  weatherRawJson?: string;
};

export function buildStoreEnvironmentMemorySnapshot(params: {
  orgId: string;
  bizDate: string;
  collectedAt: string;
  holidayCalendarDay?: ChinaHolidayCalendarDayRecord | null;
  weather?: StoreEnvironmentWeatherObservation | null;
  storeProfile?: HetangStoreMasterProfile | null;
}): {
  snapshot: StoreEnvironmentDailySnapshotRecord;
  source: StoreEnvironmentMemorySource;
} {
  const context = buildEnvironmentContextSnapshot({
    orgId: params.orgId,
    bizDate: params.bizDate,
    calendarContext: params.holidayCalendarDay
      ? {
          holidayTag: params.holidayCalendarDay.holidayTag,
          holidayName: params.holidayCalendarDay.holidayName,
          isAdjustedWorkday: params.holidayCalendarDay.isAdjustedWorkday,
        }
      : undefined,
    weather: params.weather ?? undefined,
    storeContext: params.storeProfile
      ? resolveStoreMasterEnvironmentContext({
          profile: params.storeProfile,
          asOfDate: params.bizDate,
        })
      : undefined,
  });

  const source: StoreEnvironmentMemorySource = {
    cityName: params.storeProfile?.cityName,
    longitude: params.storeProfile?.longitude,
    latitude: params.storeProfile?.latitude,
    holidaySourceVersion: params.holidayCalendarDay?.sourceVersion,
    holidaySourceLabel: params.holidayCalendarDay?.sourceLabel,
    weatherProvider: params.weather?.provider,
    weatherObservedAt: params.weather?.observedAt,
    holidayRawJson: params.holidayCalendarDay?.rawJson,
    weatherRawJson: params.weather?.rawJson,
  };
  const snapshotCore = {
    ...context,
    orgId: params.orgId,
  };

  return {
    snapshot: {
      ...snapshotCore,
      snapshotJson: JSON.stringify(snapshotCore),
      sourceJson: JSON.stringify(source),
      collectedAt: params.collectedAt,
      updatedAt: params.collectedAt,
    },
    source,
  };
}
