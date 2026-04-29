import type {
  EnvironmentBiasLevel,
  EnvironmentContextSnapshot,
  EnvironmentDisturbanceLevel,
  EnvironmentHolidayTag,
  EnvironmentNarrativePolicy,
  EnvironmentPenaltyLevel,
  EnvironmentPrecipitationTag,
  EnvironmentSeasonTag,
  EnvironmentSolarTerm,
  EnvironmentTemperatureBand,
  EnvironmentWeatherTag,
  EnvironmentWindTag,
  HetangStoreConfig,
} from "../types.js";

type EnvironmentContextInput = {
  orgId?: string;
  bizDate: string;
  cityCode?: string;
  calendarContext?: {
    holidayTag?: EnvironmentHolidayTag;
    holidayName?: string;
    isAdjustedWorkday?: boolean;
  };
  weather?: {
    condition?: string;
    temperatureC?: number | null;
    precipitationMm?: number | null;
    windLevel?: number | null;
  };
  cityContext?: {
    citySeasonalPattern?: string;
    nightlifeSeasonality?: string;
    northCityEveningLeisureBias?: boolean;
  };
  storeContext?: {
    lateNightCapable?: boolean;
    storeNightSceneBias?: EnvironmentBiasLevel;
    postDinnerLeisureBias?: EnvironmentBiasLevel;
  };
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveSeasonTag(bizDate: string): EnvironmentSeasonTag {
  const month = Number(bizDate.slice(5, 7));
  if (month >= 3 && month <= 5) {
    return "spring";
  }
  if (month >= 6 && month <= 8) {
    return "summer";
  }
  if (month >= 9 && month <= 11) {
    return "autumn";
  }
  return "winter";
}

function resolveIsWeekend(bizDate: string): boolean {
  const day = new Date(`${bizDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function resolveWeekdayIndex(bizDate: string): number {
  return new Date(`${bizDate}T00:00:00Z`).getUTCDay();
}

function resolveWeekdayLabel(weekdayIndex: number): string {
  return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekdayIndex] ?? "未知";
}

const SOLAR_TERM_STARTS: Array<{ term: EnvironmentSolarTerm; monthDay: number }> = [
  { term: "xiaohan", monthDay: 106 },
  { term: "dahan", monthDay: 120 },
  { term: "lichun", monthDay: 204 },
  { term: "yushui", monthDay: 219 },
  { term: "jingzhe", monthDay: 306 },
  { term: "chunfen", monthDay: 321 },
  { term: "qingming", monthDay: 405 },
  { term: "guyu", monthDay: 420 },
  { term: "lixia", monthDay: 506 },
  { term: "xiaoman", monthDay: 521 },
  { term: "mangzhong", monthDay: 606 },
  { term: "xiazhi", monthDay: 621 },
  { term: "xiaoshu", monthDay: 707 },
  { term: "dashu", monthDay: 723 },
  { term: "liqiu", monthDay: 808 },
  { term: "chushu", monthDay: 823 },
  { term: "bailu", monthDay: 908 },
  { term: "qiufen", monthDay: 923 },
  { term: "hanlu", monthDay: 1008 },
  { term: "shuangjiang", monthDay: 1024 },
  { term: "lidong", monthDay: 1108 },
  { term: "xiaoxue", monthDay: 1122 },
  { term: "daxue", monthDay: 1207 },
  { term: "dongzhi", monthDay: 1222 },
];

function resolveSolarTerm(bizDate: string): EnvironmentSolarTerm {
  const monthDay = Number(`${bizDate.slice(5, 7)}${bizDate.slice(8, 10)}`);
  let resolved: EnvironmentSolarTerm = "dongzhi";
  for (const entry of SOLAR_TERM_STARTS) {
    if (monthDay >= entry.monthDay) {
      resolved = entry.term;
      continue;
    }
    break;
  }
  return resolved;
}

function normalizeCondition(condition: string | undefined): string {
  return condition?.trim().toLowerCase() ?? "";
}

function resolveWeatherTag(condition: string | undefined): EnvironmentWeatherTag {
  const normalized = normalizeCondition(condition);
  if (!normalized) {
    return "unknown";
  }
  if (normalized.includes("雷") || normalized.includes("暴")) {
    return "storm";
  }
  if (normalized.includes("雪")) {
    return "snow";
  }
  if (normalized.includes("雨")) {
    return "rain";
  }
  if (
    normalized.includes("阴") ||
    normalized.includes("云") ||
    normalized.includes("多云") ||
    normalized.includes("cloud")
  ) {
    return "cloudy";
  }
  if (normalized.includes("晴") || normalized.includes("clear")) {
    return "clear";
  }
  return "unknown";
}

function resolveTemperatureBand(temperatureC: number | null | undefined): EnvironmentTemperatureBand {
  if (temperatureC === null || temperatureC === undefined || !Number.isFinite(temperatureC)) {
    return "unknown";
  }
  if (temperatureC < 5) {
    return "cold";
  }
  if (temperatureC < 15) {
    return "cool";
  }
  if (temperatureC < 25) {
    return "mild";
  }
  if (temperatureC < 32) {
    return "warm";
  }
  return "hot";
}

function resolvePrecipitationTag(
  precipitationMm: number | null | undefined,
): EnvironmentPrecipitationTag {
  if (precipitationMm === null || precipitationMm === undefined || !Number.isFinite(precipitationMm)) {
    return "unknown";
  }
  if (precipitationMm <= 0) {
    return "none";
  }
  if (precipitationMm < 5) {
    return "light";
  }
  if (precipitationMm < 15) {
    return "moderate";
  }
  return "heavy";
}

function resolveWindTag(windLevel: number | null | undefined): EnvironmentWindTag {
  if (windLevel === null || windLevel === undefined || !Number.isFinite(windLevel)) {
    return "unknown";
  }
  if (windLevel >= 6) {
    return "high";
  }
  if (windLevel >= 3) {
    return "medium";
  }
  return "low";
}

function resolveBiasScore(level: EnvironmentBiasLevel | undefined, fallback: number): number {
  if (level === "high") {
    return 0.85;
  }
  if (level === "medium") {
    return 0.55;
  }
  if (level === "low") {
    return 0.25;
  }
  return fallback;
}

function resolveBiasLevelFromScore(score: number): EnvironmentBiasLevel {
  if (score >= 0.72) {
    return "high";
  }
  if (score >= 0.42) {
    return "medium";
  }
  return "low";
}

function resolveSolarTermPostDinnerDelta(solarTerm: EnvironmentSolarTerm): number {
  if (["chunfen", "qingming", "guyu", "lixia"].includes(solarTerm)) {
    return 0.2;
  }
  if (["xiaoshu", "dashu"].includes(solarTerm)) {
    return -0.04;
  }
  if (["shuangjiang", "lidong", "xiaoxue", "daxue", "xiaohan", "dahan"].includes(solarTerm)) {
    return -0.14;
  }
  return 0;
}

function resolveSolarTermEveningDelta(solarTerm: EnvironmentSolarTerm): number {
  if (["chunfen", "qingming", "guyu", "lixia"].includes(solarTerm)) {
    return 0.08;
  }
  if (["xiaoshu", "dashu"].includes(solarTerm)) {
    return -0.04;
  }
  if (["shuangjiang", "lidong", "xiaoxue", "daxue", "xiaohan", "dahan"].includes(solarTerm)) {
    return -0.08;
  }
  return 0;
}

function resolveBadWeatherTouchPenalty(params: {
  weatherTag: EnvironmentWeatherTag;
  temperatureBand: EnvironmentTemperatureBand;
  precipitationTag: EnvironmentPrecipitationTag;
  windTag: EnvironmentWindTag;
}): EnvironmentPenaltyLevel {
  if (
    params.weatherTag === "storm" ||
    params.weatherTag === "snow" ||
    params.precipitationTag === "heavy" ||
    params.windTag === "high"
  ) {
    return "high";
  }
  if (
    params.weatherTag === "rain" ||
    params.precipitationTag === "moderate" ||
    params.temperatureBand === "cold"
  ) {
    return "medium";
  }
  if (
    params.weatherTag === "cloudy" ||
    params.precipitationTag === "light" ||
    params.temperatureBand === "cool" ||
    params.windTag === "medium"
  ) {
    return "low";
  }
  return "none";
}

function resolveEnvironmentDisturbanceLevel(params: {
  holidayTag: EnvironmentHolidayTag;
  badWeatherTouchPenalty: EnvironmentPenaltyLevel;
}): EnvironmentDisturbanceLevel {
  if (
    params.holidayTag === "holiday" ||
    params.holidayTag === "adjusted_workday" ||
    params.badWeatherTouchPenalty === "high"
  ) {
    return "high";
  }
  if (
    params.holidayTag === "pre_holiday" ||
    params.holidayTag === "post_holiday" ||
    params.badWeatherTouchPenalty === "medium"
  ) {
    return "medium";
  }
  if (params.holidayTag === "weekend" || params.badWeatherTouchPenalty === "low") {
    return "low";
  }
  return "none";
}

function resolveNarrativePolicy(
  disturbanceLevel: EnvironmentDisturbanceLevel,
): EnvironmentNarrativePolicy {
  if (disturbanceLevel === "high") {
    return "mention";
  }
  if (disturbanceLevel === "medium") {
    return "hint";
  }
  return "suppress";
}

function resolveEveningOutingLikelihood(params: {
  seasonTag: EnvironmentSeasonTag;
  solarTerm: EnvironmentSolarTerm;
  isWeekend: boolean;
  weatherTag: EnvironmentWeatherTag;
  temperatureBand: EnvironmentTemperatureBand;
  badWeatherTouchPenalty: EnvironmentPenaltyLevel;
  northCityEveningLeisureBias?: boolean;
  lateNightCapable?: boolean;
  storeNightSceneBias?: EnvironmentBiasLevel;
  postDinnerLeisureBias?: EnvironmentBiasLevel;
}): EnvironmentBiasLevel {
  let score = 0.35;
  if (params.postDinnerLeisureBias === "high") {
    score += 0.22;
  } else if (params.postDinnerLeisureBias === "medium") {
    score += 0.1;
  }
  if (params.storeNightSceneBias === "high") {
    score += 0.14;
  } else if (params.storeNightSceneBias === "medium") {
    score += 0.07;
  }
  if (params.lateNightCapable) {
    score += 0.1;
  }
  if (params.isWeekend) {
    score += 0.08;
  }
  if (
    params.northCityEveningLeisureBias &&
    (params.seasonTag === "spring" || params.seasonTag === "autumn" || params.seasonTag === "summer")
  ) {
    score += 0.12;
  }
  if (
    params.weatherTag === "clear" &&
    (params.temperatureBand === "mild" || params.temperatureBand === "warm")
  ) {
    score += 0.1;
  }
  score += resolveSolarTermEveningDelta(params.solarTerm);
  if (params.badWeatherTouchPenalty === "high") {
    score -= 0.35;
  } else if (params.badWeatherTouchPenalty === "medium") {
    score -= 0.18;
  } else if (params.badWeatherTouchPenalty === "low") {
    score -= 0.06;
  }
  score = clamp(score, 0, 1);
  if (score >= 0.72) {
    return "high";
  }
  if (score >= 0.4) {
    return "medium";
  }
  return "low";
}

export function buildEnvironmentContextSnapshot(
  params: EnvironmentContextInput,
): EnvironmentContextSnapshot {
  const weekdayIndex = resolveWeekdayIndex(params.bizDate);
  const weekdayLabel = resolveWeekdayLabel(weekdayIndex);
  const seasonTag = resolveSeasonTag(params.bizDate);
  const solarTerm = resolveSolarTerm(params.bizDate);
  const isWeekend = resolveIsWeekend(params.bizDate);
  const holidayTag = params.calendarContext?.holidayTag ?? (isWeekend ? "weekend" : "workday");
  const weatherTag = resolveWeatherTag(params.weather?.condition);
  const temperatureBand = resolveTemperatureBand(params.weather?.temperatureC);
  const precipitationTag = resolvePrecipitationTag(params.weather?.precipitationMm);
  const windTag = resolveWindTag(params.weather?.windLevel);
  const badWeatherTouchPenalty = resolveBadWeatherTouchPenalty({
    weatherTag,
    temperatureBand,
    precipitationTag,
    windTag,
  });
  const postDinnerLeisureBias = resolveBiasLevelFromScore(
    clamp(
      resolveBiasScore(params.storeContext?.postDinnerLeisureBias, 0.25) +
        resolveSolarTermPostDinnerDelta(solarTerm),
      0,
      1,
    ),
  );
  const eveningOutingLikelihood = resolveEveningOutingLikelihood({
    seasonTag,
    solarTerm,
    isWeekend,
    weatherTag,
    temperatureBand,
    badWeatherTouchPenalty,
    northCityEveningLeisureBias: params.cityContext?.northCityEveningLeisureBias,
    lateNightCapable: params.storeContext?.lateNightCapable,
    storeNightSceneBias: params.storeContext?.storeNightSceneBias,
    postDinnerLeisureBias,
  });
  const environmentDisturbanceLevel = resolveEnvironmentDisturbanceLevel({
    holidayTag,
    badWeatherTouchPenalty,
  });
  const narrativePolicy = resolveNarrativePolicy(environmentDisturbanceLevel);

  return {
    orgId: params.orgId,
    bizDate: params.bizDate,
    cityCode: params.cityCode,
    weekdayIndex,
    weekdayLabel,
    seasonTag,
    monthTag: params.bizDate.slice(5, 7),
    solarTerm,
    isWeekend,
    holidayTag,
    holidayName: params.calendarContext?.holidayName,
    isAdjustedWorkday: params.calendarContext?.isAdjustedWorkday,
    weatherConditionRaw: params.weather?.condition,
    temperatureC: params.weather?.temperatureC ?? null,
    precipitationMm: params.weather?.precipitationMm ?? null,
    windLevel: params.weather?.windLevel ?? null,
    weatherTag,
    temperatureBand,
    precipitationTag,
    windTag,
    citySeasonalPattern: params.cityContext?.citySeasonalPattern,
    nightlifeSeasonality: params.cityContext?.nightlifeSeasonality,
    postDinnerLeisureBias,
    eveningOutingLikelihood,
    badWeatherTouchPenalty,
    environmentDisturbanceLevel,
    narrativePolicy,
    contextJson: JSON.stringify({
      calendarContext: params.calendarContext ?? null,
      solarTerm,
      weather: params.weather ?? null,
      cityContext: params.cityContext ?? null,
      storeContext: params.storeContext ?? null,
    }),
  };
}

type EnvironmentStoreConfig = Pick<
  HetangStoreConfig,
  "orgId" | "storeName" | "roomCount" | "operatingHoursPerDay"
>;

function resolveInferredStoreContext(
  storeConfig: EnvironmentStoreConfig | undefined,
): EnvironmentContextInput["storeContext"] | undefined {
  if (!storeConfig) {
    return undefined;
  }
  const roomCount = storeConfig.roomCount;
  const operatingHoursPerDay = storeConfig.operatingHoursPerDay;
  const isCinemaStyle = /影院/u.test(storeConfig.storeName);

  const lateNightCapable =
    operatingHoursPerDay === undefined ? undefined : operatingHoursPerDay >= 14;
  const storeNightSceneBias =
    isCinemaStyle
      ? "high"
      : roomCount === undefined
        ? undefined
        : roomCount >= 24
          ? "high"
          : roomCount >= 14
            ? "medium"
            : "low";
  const postDinnerLeisureBias =
    isCinemaStyle || (lateNightCapable && (roomCount ?? 0) >= 20)
      ? "high"
      : lateNightCapable || (roomCount ?? 0) >= 12
        ? "medium"
        : roomCount !== undefined || operatingHoursPerDay !== undefined
          ? "low"
          : undefined;

  if (
    lateNightCapable === undefined &&
    storeNightSceneBias === undefined &&
    postDinnerLeisureBias === undefined
  ) {
    return undefined;
  }
  return {
    lateNightCapable,
    storeNightSceneBias,
    postDinnerLeisureBias,
  };
}

export function buildStoreEnvironmentContextSnapshot(params: {
  bizDate: string;
  storeConfig?: EnvironmentStoreConfig;
  weather?: EnvironmentContextInput["weather"];
}): EnvironmentContextSnapshot {
  return buildEnvironmentContextSnapshot({
    orgId: params.storeConfig?.orgId,
    bizDate: params.bizDate,
    weather: params.weather,
    storeContext: resolveInferredStoreContext(params.storeConfig),
  });
}
