import { describe, expect, it } from "vitest";

import { buildStoreEnvironmentMemorySnapshot } from "./environment-memory.js";

describe("buildStoreEnvironmentMemorySnapshot", () => {
  it("builds a quiet workday snapshot with suppressed narrative output", () => {
    const result = buildStoreEnvironmentMemorySnapshot({
      orgId: "1001",
      bizDate: "2026-04-22",
      collectedAt: "2026-04-23T03:00:00.000Z",
      holidayCalendarDay: {
        bizDate: "2026-04-22",
        holidayTag: "workday",
        isAdjustedWorkday: false,
        updatedAt: "2026-04-22T00:00:00.000Z",
      },
      storeProfile: {
        orgId: "1001",
        storeName: "荷塘悦色迎宾店",
        cityName: "安阳",
        longitude: 114.3525,
        latitude: 36.1034,
        roomCountTotal: 18,
        serviceHoursJson: {
          windows: [
            {
              start: "11:00",
              end: "00:30",
              overnight: true,
            },
          ],
        },
        updatedAt: "2026-04-22T00:00:00.000Z",
      },
      weather: {
        condition: "晴",
        temperatureC: 23,
        precipitationMm: 0,
        windLevel: 2,
      },
    });

    expect(result.snapshot).toMatchObject({
      orgId: "1001",
      bizDate: "2026-04-22",
      weekdayLabel: "周三",
      holidayTag: "workday",
      weatherTag: "clear",
      environmentDisturbanceLevel: "none",
      narrativePolicy: "suppress",
    });
    expect(result.source.cityName).toBe("安阳");
  });

  it("escalates to mention on holiday and severe weather days", () => {
    const result = buildStoreEnvironmentMemorySnapshot({
      orgId: "1001",
      bizDate: "2026-05-01",
      collectedAt: "2026-05-02T03:00:00.000Z",
      holidayCalendarDay: {
        bizDate: "2026-05-01",
        holidayTag: "holiday",
        holidayName: "劳动节",
        isAdjustedWorkday: false,
        updatedAt: "2026-05-01T00:00:00.000Z",
      },
      weather: {
        condition: "暴雨",
        temperatureC: 12,
        precipitationMm: 24,
        windLevel: 7,
      },
    });

    expect(result.snapshot).toMatchObject({
      weekdayLabel: "周五",
      holidayTag: "holiday",
      holidayName: "劳动节",
      weatherTag: "storm",
      environmentDisturbanceLevel: "high",
      narrativePolicy: "mention",
    });
  });
});
