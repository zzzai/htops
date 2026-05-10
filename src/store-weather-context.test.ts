import { describe, expect, test } from "vitest";

import { buildStoreWeatherContextEntries, classifyWeatherImpact } from "./store-weather-context.js";

describe("classifyWeatherImpact", () => {
  test("classifies rain and heat as business-impacting weather", () => {
    expect(classifyWeatherImpact({ weatherCode: 61, precipitationMm: 8, temperatureMaxC: 26 })).toEqual({
      band: "rain",
      score: 70,
      reason: "降雨明显，可能影响自然到店和临时消费。",
    });
    expect(classifyWeatherImpact({ weatherCode: 3, precipitationMm: 0, temperatureMaxC: 36 })).toEqual({
      band: "heat",
      score: 45,
      reason: "高温天气，可能影响白天外出，但晚间放松需求可能上升。",
    });
  });
});

describe("buildStoreWeatherContextEntries", () => {
  test("publishes weather entries for store explanation", () => {
    const rows = buildStoreWeatherContextEntries({
      orgId: "store-1",
      storeName: "测试店",
      snapshotDate: "2026-05-09",
      updatedAt: "2026-05-09T10:00:00.000Z",
      sourceUri: "https://api.open-meteo.com/v1/forecast",
      weather: {
        date: "2026-05-09",
        weatherCode: 61,
        weatherText: "小雨/中雨",
        temperatureMaxC: 24.5,
        temperatureMinC: 15.1,
        precipitationMm: 9.8,
        windSpeedMaxKmh: 16.2,
      },
    });

    expect(rows.map((row) => row.metricKey)).toEqual([
      "weather_condition",
      "temperature_max_c",
      "temperature_min_c",
      "precipitation_mm",
      "wind_speed_max_kmh",
      "weather_impact_band",
      "weather_impact_score",
      "weather_daily_summary",
    ]);
    expect(rows.find((row) => row.metricKey === "weather_condition")).toMatchObject({
      valueText: "小雨/中雨",
      sourceType: "open_meteo_weather_api",
      sourceLabel: "Open-Meteo Forecast API",
      confidence: "medium",
    });
    expect(rows.find((row) => row.metricKey === "weather_impact_band")).toMatchObject({
      valueText: "rain",
    });
  });
});
