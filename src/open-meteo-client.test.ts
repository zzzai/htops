import { describe, expect, test, vi } from "vitest";

import { OpenMeteoClient, OpenMeteoError } from "./open-meteo-client.js";

describe("OpenMeteoClient", () => {
  test("fetches daily weather for a coordinate and date range", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            latitude: 36.1,
            longitude: 114.4,
            timezone: "Asia/Shanghai",
            daily: {
              time: ["2026-05-09", "2026-05-10"],
              weather_code: [61, 3],
              temperature_2m_max: [24.5, 29.2],
              temperature_2m_min: [15.1, 18.6],
              precipitation_sum: [9.8, 0],
              wind_speed_10m_max: [16.2, 12.3],
            },
          };
        },
      } as Response;
    });
    const client = new OpenMeteoClient({ fetchImpl });

    const result = await client.fetchDailyWeather({
      latitude: 36.1,
      longitude: 114.4,
      startDate: "2026-05-09",
      endDate: "2026-05-10",
    });

    expect(result.days).toEqual([
      {
        date: "2026-05-09",
        weatherCode: 61,
        weatherText: "小雨/中雨",
        temperatureMaxC: 24.5,
        temperatureMinC: 15.1,
        precipitationMm: 9.8,
        windSpeedMaxKmh: 16.2,
      },
      {
        date: "2026-05-10",
        weatherCode: 3,
        weatherText: "阴",
        temperatureMaxC: 29.2,
        temperatureMinC: 18.6,
        precipitationMm: 0,
        windSpeedMaxKmh: 12.3,
      },
    ]);
    const url = new URL(calls[0]!);
    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("36.1");
    expect(url.searchParams.get("longitude")).toBe("114.4");
    expect(url.searchParams.get("timezone")).toBe("Asia/Shanghai");
    expect(url.searchParams.get("daily")).toContain("precipitation_sum");
  });

  test("throws a typed error for failed weather responses", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 429 } as Response));
    const client = new OpenMeteoClient({ fetchImpl });

    await expect(
      client.fetchDailyWeather({
        latitude: 36.1,
        longitude: 114.4,
        startDate: "2026-05-09",
        endDate: "2026-05-09",
      }),
    ).rejects.toBeInstanceOf(OpenMeteoError);
  });
});
