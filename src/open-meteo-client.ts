export type OpenMeteoFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type OpenMeteoDailyWeather = {
  date: string;
  weatherCode: number;
  weatherText: string;
  temperatureMaxC: number;
  temperatureMinC: number;
  precipitationMm: number;
  windSpeedMaxKmh: number;
};

export type OpenMeteoDailyWeatherResult = {
  latitude?: number;
  longitude?: number;
  timezone?: string;
  days: OpenMeteoDailyWeather[];
  raw: Record<string, unknown>;
};

type OpenMeteoClientParams = {
  fetchImpl?: OpenMeteoFetch;
  endpoint?: string;
};

const DEFAULT_OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function describeOpenMeteoWeatherCode(code: number): string {
  if (code === 0) return "晴";
  if ([1, 2].includes(code)) return "多云";
  if (code === 3) return "阴";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "小雨/中雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "降雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return `天气代码${code}`;
}

export class OpenMeteoError extends Error {
  readonly status?: number;
  readonly safeUrl: string;

  constructor(message: string, params: { status?: number; safeUrl: string }) {
    super(message);
    this.name = "OpenMeteoError";
    this.status = params.status;
    this.safeUrl = params.safeUrl;
  }
}

export class OpenMeteoClient {
  private readonly endpoint: string;
  private readonly fetchImpl: OpenMeteoFetch;

  constructor(params: OpenMeteoClientParams = {}) {
    this.endpoint = params.endpoint ?? DEFAULT_OPEN_METEO_ENDPOINT;
    this.fetchImpl = params.fetchImpl ?? fetch;
  }

  async fetchDailyWeather(params: {
    latitude: number;
    longitude: number;
    startDate: string;
    endDate: string;
  }): Promise<OpenMeteoDailyWeatherResult> {
    const url = new URL(this.endpoint);
    url.searchParams.set("latitude", String(params.latitude));
    url.searchParams.set("longitude", String(params.longitude));
    url.searchParams.set(
      "daily",
      [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "wind_speed_10m_max",
      ].join(","),
    );
    url.searchParams.set("timezone", "Asia/Shanghai");
    url.searchParams.set("start_date", params.startDate);
    url.searchParams.set("end_date", params.endDate);

    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new OpenMeteoError(`Open-Meteo HTTP error: ${response.status}`, {
        status: response.status,
        safeUrl: url.toString(),
      });
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const daily = isRecord(raw.daily) ? raw.daily : {};
    const dates = arrayValue(daily.time);
    const weatherCodes = arrayValue(daily.weather_code);
    const maxTemps = arrayValue(daily.temperature_2m_max);
    const minTemps = arrayValue(daily.temperature_2m_min);
    const precipitations = arrayValue(daily.precipitation_sum);
    const winds = arrayValue(daily.wind_speed_10m_max);

    const days: OpenMeteoDailyWeather[] = [];
    for (let index = 0; index < dates.length; index += 1) {
      const date = stringValue(dates[index]);
      const weatherCode = numberValue(weatherCodes[index]);
      const temperatureMaxC = numberValue(maxTemps[index]);
      const temperatureMinC = numberValue(minTemps[index]);
      const precipitationMm = numberValue(precipitations[index]);
      const windSpeedMaxKmh = numberValue(winds[index]);
      if (
        !date ||
        weatherCode === undefined ||
        temperatureMaxC === undefined ||
        temperatureMinC === undefined ||
        precipitationMm === undefined ||
        windSpeedMaxKmh === undefined
      ) {
        continue;
      }
      days.push({
        date,
        weatherCode,
        weatherText: describeOpenMeteoWeatherCode(weatherCode),
        temperatureMaxC,
        temperatureMinC,
        precipitationMm,
        windSpeedMaxKmh,
      });
    }

    return {
      latitude: numberValue(raw.latitude),
      longitude: numberValue(raw.longitude),
      timezone: stringValue(raw.timezone),
      days,
      raw,
    };
  }
}
