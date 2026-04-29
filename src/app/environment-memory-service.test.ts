import { describe, expect, it, vi } from "vitest";

import { HetangEnvironmentMemoryService } from "./environment-memory-service.js";

describe("HetangEnvironmentMemoryService", () => {
  it("builds and persists environment memory from store profile, holiday, and weather inputs", async () => {
    const persistedSnapshots: Array<Record<string, unknown>> = [];
    const store = {
      getStoreEnvironmentDailySnapshot: vi.fn().mockResolvedValue(null),
      getStoreMasterProfile: vi.fn().mockResolvedValue({
        orgId: "1001",
        storeName: "荷塘悦色迎宾店",
        cityName: "安阳",
        longitude: 114.3525,
        latitude: 36.1034,
        roomCountTotal: 20,
        serviceHoursJson: {
          windows: [
            {
              start: "11:00",
              end: "01:00",
              overnight: true,
            },
          ],
        },
        updatedAt: "2026-04-22T00:00:00.000Z",
      }),
      getHolidayCalendarDay: vi.fn().mockResolvedValue({
        bizDate: "2026-04-22",
        holidayTag: "workday",
        isAdjustedWorkday: false,
        updatedAt: "2026-04-22T00:00:00.000Z",
      }),
      upsertStoreEnvironmentDailySnapshot: vi
        .fn()
        .mockImplementation(async (row: Record<string, unknown>) => {
          persistedSnapshots.push(row);
        }),
    };
    const loadHistoricalWeather = vi.fn().mockResolvedValue({
      condition: "晴",
      temperatureC: 22,
      precipitationMm: 0,
      windLevel: 2,
      provider: "mock-weather",
    });
    const service = new HetangEnvironmentMemoryService({
      getStore: async () => store as never,
      loadHistoricalWeather,
    });

    const snapshot = await service.ensureStoreEnvironmentMemory({
      orgId: "1001",
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:00:00.000Z"),
    });

    expect(loadHistoricalWeather).toHaveBeenCalledWith({
      orgId: "1001",
      bizDate: "2026-04-22",
      cityName: "安阳",
      longitude: 114.3525,
      latitude: 36.1034,
    });
    expect(store.upsertStoreEnvironmentDailySnapshot).toHaveBeenCalledTimes(1);
    expect(persistedSnapshots[0]).toMatchObject({
      orgId: "1001",
      bizDate: "2026-04-22",
      weatherTag: "clear",
      narrativePolicy: "suppress",
    });
    expect(snapshot.weekdayLabel).toBe("周三");
  });

  it("returns the persisted snapshot without rebuilding when one already exists", async () => {
    const existingSnapshot = {
      orgId: "1001",
      bizDate: "2026-04-22",
      weekdayLabel: "周三",
      holidayTag: "workday",
      weatherTag: "clear",
      narrativePolicy: "suppress",
      snapshotJson: "{}",
      collectedAt: "2026-04-23T03:00:00.000Z",
      updatedAt: "2026-04-23T03:00:00.000Z",
    };
    const store = {
      getStoreEnvironmentDailySnapshot: vi.fn().mockResolvedValue(existingSnapshot),
      getStoreMasterProfile: vi.fn(),
      getHolidayCalendarDay: vi.fn(),
      upsertStoreEnvironmentDailySnapshot: vi.fn(),
    };
    const loadHistoricalWeather = vi.fn();
    const service = new HetangEnvironmentMemoryService({
      getStore: async () => store as never,
      loadHistoricalWeather,
    });

    const snapshot = await service.ensureStoreEnvironmentMemory({
      orgId: "1001",
      bizDate: "2026-04-22",
      now: new Date("2026-04-23T03:00:00.000Z"),
    });

    expect(snapshot).toBe(existingSnapshot);
    expect(loadHistoricalWeather).not.toHaveBeenCalled();
    expect(store.getStoreMasterProfile).not.toHaveBeenCalled();
    expect(store.upsertStoreEnvironmentDailySnapshot).not.toHaveBeenCalled();
  });
});
