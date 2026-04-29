import { buildStoreEnvironmentMemorySnapshot, type StoreEnvironmentWeatherObservation } from "../environment-memory.js";
import { HetangOpsStore } from "../store.js";
import type { HetangStoreMasterProfile, StoreEnvironmentDailySnapshotRecord } from "../types.js";

type EnvironmentMemoryStore = Pick<
  HetangOpsStore,
  | "getHolidayCalendarDay"
  | "getStoreEnvironmentDailySnapshot"
  | "getStoreMasterProfile"
  | "upsertStoreEnvironmentDailySnapshot"
>;

export class HetangEnvironmentMemoryService {
  constructor(
    private readonly deps: {
      getStore: () => Promise<HetangOpsStore>;
      loadHistoricalWeather?: (params: {
        orgId: string;
        bizDate: string;
        cityName?: string;
        longitude?: number;
        latitude?: number;
      }) => Promise<StoreEnvironmentWeatherObservation | null>;
    },
  ) {}

  private async getStore(): Promise<EnvironmentMemoryStore> {
    return (await this.deps.getStore()) as EnvironmentMemoryStore;
  }

  private async loadWeather(
    params: {
      orgId: string;
      bizDate: string;
      storeProfile: HetangStoreMasterProfile | null;
    },
  ): Promise<StoreEnvironmentWeatherObservation | null> {
    if (!this.deps.loadHistoricalWeather) {
      return null;
    }
    return await this.deps.loadHistoricalWeather({
      orgId: params.orgId,
      bizDate: params.bizDate,
      cityName: params.storeProfile?.cityName,
      longitude: params.storeProfile?.longitude,
      latitude: params.storeProfile?.latitude,
    });
  }

  async buildStoreEnvironmentMemory(params: {
    orgId: string;
    bizDate: string;
    now?: Date;
  }): Promise<StoreEnvironmentDailySnapshotRecord> {
    const store = await this.getStore();
    const [storeProfile, holidayCalendarDay] = await Promise.all([
      store.getStoreMasterProfile(params.orgId),
      store.getHolidayCalendarDay(params.bizDate),
    ]);
    const weather = await this.loadWeather({
      orgId: params.orgId,
      bizDate: params.bizDate,
      storeProfile,
    });
    const built = buildStoreEnvironmentMemorySnapshot({
      orgId: params.orgId,
      bizDate: params.bizDate,
      collectedAt: (params.now ?? new Date()).toISOString(),
      holidayCalendarDay,
      weather,
      storeProfile,
    });
    await store.upsertStoreEnvironmentDailySnapshot(built.snapshot);
    return built.snapshot;
  }

  async ensureStoreEnvironmentMemory(params: {
    orgId: string;
    bizDate: string;
    now?: Date;
  }): Promise<StoreEnvironmentDailySnapshotRecord> {
    const store = await this.getStore();
    const existing = await store.getStoreEnvironmentDailySnapshot(params.orgId, params.bizDate);
    if (existing) {
      return existing;
    }
    return await this.buildStoreEnvironmentMemory(params);
  }

  async getStoreEnvironmentMemory(params: {
    orgId: string;
    bizDate: string;
    ensure?: boolean;
    now?: Date;
  }): Promise<StoreEnvironmentDailySnapshotRecord | null> {
    if (params.ensure) {
      return await this.ensureStoreEnvironmentMemory(params);
    }
    const store = await this.getStore();
    return await store.getStoreEnvironmentDailySnapshot(params.orgId, params.bizDate);
  }
}
