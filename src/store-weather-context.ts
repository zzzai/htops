import type { OpenMeteoDailyWeather } from "./open-meteo-client.js";
import type { HetangStoreExternalContextEntry } from "./types.js";

type WeatherContextEntryWrite = {
  orgId: string;
  snapshotDate: string;
  contextKind: HetangStoreExternalContextEntry["contextKind"];
  metricKey: string;
  valueText?: string;
  valueNum?: number;
  valueJson?: unknown;
  unit?: string;
  truthLevel: HetangStoreExternalContextEntry["truthLevel"];
  confidence: HetangStoreExternalContextEntry["confidence"];
  sourceType: string;
  sourceLabel?: string;
  sourceUri?: string;
  applicableModules?: string[];
  notForScoring?: boolean;
  note?: string;
  rawJson?: string;
  updatedAt: string;
};

const AI_CONTEXT_MODULES = ["analysis_explanation", "store_advice", "daily_report", "pain_signal_diagnosis"];

export type WeatherImpact = {
  band: "normal" | "rain" | "snow" | "storm" | "heat" | "cold" | "wind";
  score: number;
  reason: string;
};

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function classifyWeatherImpact(params: {
  weatherCode: number;
  precipitationMm: number;
  temperatureMaxC: number;
  temperatureMinC?: number;
  windSpeedMaxKmh?: number;
}): WeatherImpact {
  if ([95, 96, 99].includes(params.weatherCode)) {
    return { band: "storm", score: 90, reason: "雷雨天气，对自然到店和临时消费影响较大。" };
  }
  if (params.precipitationMm >= 5 || [61, 63, 65, 66, 67, 80, 81, 82].includes(params.weatherCode)) {
    return { band: "rain", score: 70, reason: "降雨明显，可能影响自然到店和临时消费。" };
  }
  if ([71, 73, 75, 77, 85, 86].includes(params.weatherCode)) {
    return { band: "snow", score: 85, reason: "降雪天气，对交通和到店便利性影响明显。" };
  }
  if (params.temperatureMaxC >= 35) {
    return { band: "heat", score: 45, reason: "高温天气，可能影响白天外出，但晚间放松需求可能上升。" };
  }
  if ((params.temperatureMinC ?? 99) <= -5) {
    return { band: "cold", score: 45, reason: "低温天气可能压制自然客流，但也可能增加热疗/放松需求。" };
  }
  if ((params.windSpeedMaxKmh ?? 0) >= 40) {
    return { band: "wind", score: 35, reason: "大风天气对户外出行有一定影响。" };
  }
  return { band: "normal", score: 0, reason: "天气对经营影响不明显。" };
}

function makeEntry(params: {
  orgId: string;
  snapshotDate: string;
  metricKey: string;
  valueText?: string;
  valueNum?: number;
  valueJson?: unknown;
  unit?: string;
  sourceUri?: string;
  note?: string;
  rawJson?: unknown;
  updatedAt: string;
}): WeatherContextEntryWrite {
  return {
    orgId: params.orgId,
    snapshotDate: params.snapshotDate,
    contextKind: "estimated_market_context",
    metricKey: params.metricKey,
    valueText: params.valueText,
    valueNum: params.valueNum,
    valueJson: params.valueJson,
    unit: params.unit,
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: "open_meteo_weather_api",
    sourceLabel: "Open-Meteo Forecast API",
    sourceUri: params.sourceUri,
    applicableModules: AI_CONTEXT_MODULES,
    notForScoring: true,
    note: params.note,
    rawJson: JSON.stringify(params.rawJson ?? {}),
    updatedAt: params.updatedAt,
  };
}

export function buildStoreWeatherContextEntries(params: {
  orgId: string;
  storeName: string;
  snapshotDate: string;
  updatedAt: string;
  sourceUri?: string;
  weather: OpenMeteoDailyWeather;
}): WeatherContextEntryWrite[] {
  const impact = classifyWeatherImpact({
    weatherCode: params.weather.weatherCode,
    precipitationMm: params.weather.precipitationMm,
    temperatureMaxC: params.weather.temperatureMaxC,
    temperatureMinC: params.weather.temperatureMinC,
    windSpeedMaxKmh: params.weather.windSpeedMaxKmh,
  });
  const rawJson = {
    provider: "open_meteo",
    storeName: params.storeName,
    weather: params.weather,
    impact,
  };

  return [
    makeEntry({
      ...params,
      metricKey: "weather_condition",
      valueText: params.weather.weatherText,
      unit: "text",
      rawJson,
      note: `${params.storeName} 当日天气。`,
    }),
    makeEntry({
      ...params,
      metricKey: "temperature_max_c",
      valueNum: round(params.weather.temperatureMaxC),
      unit: "celsius",
      rawJson,
      note: `${params.storeName} 当日最高气温。`,
    }),
    makeEntry({
      ...params,
      metricKey: "temperature_min_c",
      valueNum: round(params.weather.temperatureMinC),
      unit: "celsius",
      rawJson,
      note: `${params.storeName} 当日最低气温。`,
    }),
    makeEntry({
      ...params,
      metricKey: "precipitation_mm",
      valueNum: round(params.weather.precipitationMm),
      unit: "mm",
      rawJson,
      note: `${params.storeName} 当日降水量。`,
    }),
    makeEntry({
      ...params,
      metricKey: "wind_speed_max_kmh",
      valueNum: round(params.weather.windSpeedMaxKmh),
      unit: "kmh",
      rawJson,
      note: `${params.storeName} 当日最大风速。`,
    }),
    makeEntry({
      ...params,
      metricKey: "weather_impact_band",
      valueText: impact.band,
      unit: "band",
      rawJson,
      note: impact.reason,
    }),
    makeEntry({
      ...params,
      metricKey: "weather_impact_score",
      valueNum: impact.score,
      unit: "score_0_100",
      rawJson,
      note: impact.reason,
    }),
    makeEntry({
      ...params,
      metricKey: "weather_daily_summary",
      valueJson: {
        date: params.weather.date,
        condition: params.weather.weatherText,
        temperatureMaxC: round(params.weather.temperatureMaxC),
        temperatureMinC: round(params.weather.temperatureMinC),
        precipitationMm: round(params.weather.precipitationMm),
        windSpeedMaxKmh: round(params.weather.windSpeedMaxKmh),
        impact,
      },
      unit: "json",
      rawJson,
      note: `${params.storeName} 天气经营解释摘要。`,
    }),
  ];
}
