export type BaiduMapFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type BaiduMapPlacePoi = {
  uid?: string;
  name: string;
  address?: string;
  city?: string;
  district?: string;
  telephone?: string;
  latitude?: number;
  longitude?: number;
  distanceMeters?: number;
  type?: string;
  tags?: string[];
  overallRating?: string;
  raw: Record<string, unknown>;
};

export type BaiduMapNearbySearchParams = {
  query: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  pageSize?: number;
  pageNum?: number;
  output?: "json";
};

export type BaiduMapRegionSearchParams = {
  query: string;
  region: string;
  cityLimit?: boolean;
  pageSize?: number;
  pageNum?: number;
  output?: "json";
};

export type BaiduMapNearbySearchResult = {
  status: number;
  message?: string;
  total: number;
  pois: BaiduMapPlacePoi[];
  raw: Record<string, unknown>;
};

export type BaiduMapGeocodeParams = {
  address: string;
  city?: string;
};

export type BaiduMapGeocodeResult = {
  latitude: number;
  longitude: number;
  precise?: number;
  confidence?: number;
  comprehension?: number;
  level?: string;
  raw: Record<string, unknown>;
};

type BaiduMapClientParams = {
  ak: string;
  fetchImpl?: BaiduMapFetch;
  placeSearchEndpoint?: string;
  geocodingEndpoint?: string;
  endpoint?: string;
};

type BaiduPlaceApiResponse = {
  status?: unknown;
  message?: unknown;
  total?: unknown;
  results?: unknown;
};

const DEFAULT_BAIDU_PLACE_SEARCH_ENDPOINT = "https://api.map.baidu.com/place/v2/search";
const DEFAULT_BAIDU_GEOCODING_ENDPOINT = "https://api.map.baidu.com/geocoding/v3/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function parseTags(value: unknown): string[] | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const tags = raw
    .split(/[;,；，]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return tags.length > 0 ? tags : undefined;
}

export function redactBaiduMapUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("ak")) {
      parsed.searchParams.set("ak", "REDACTED");
    }
    return parsed.toString();
  } catch {
    return url.replace(/([?&]ak=)[^&]+/u, "$1REDACTED");
  }
}

export class BaiduMapApiError extends Error {
  readonly status?: number;
  readonly safeUrl: string;

  constructor(message: string, params: { status?: number; safeUrl: string }) {
    super(message);
    this.name = "BaiduMapApiError";
    this.status = params.status;
    this.safeUrl = params.safeUrl;
  }
}

export function normalizeBaiduPlaceResult(value: unknown): BaiduMapPlacePoi {
  if (!isRecord(value)) {
    return {
      name: "unknown",
      raw: {},
    };
  }
  const detailInfo = isRecord(value.detail_info) ? value.detail_info : {};
  const location = isRecord(value.location) ? value.location : {};
  return {
    uid: stringValue(value.uid),
    name: stringValue(value.name) ?? "unknown",
    address: stringValue(value.address),
    city: stringValue(value.city),
    district: stringValue(value.area),
    telephone: stringValue(value.telephone),
    latitude: numberValue(location.lat),
    longitude: numberValue(location.lng),
    distanceMeters: numberValue(detailInfo.distance),
    type: stringValue(detailInfo.type),
    tags: parseTags(detailInfo.tag),
    overallRating: stringValue(detailInfo.overall_rating),
    raw: value,
  };
}

export class BaiduMapClient {
  private readonly ak: string;
  private readonly placeSearchEndpoint: string;
  private readonly geocodingEndpoint: string;
  private readonly fetchImpl: BaiduMapFetch;

  constructor(params: BaiduMapClientParams) {
    const ak = params.ak.trim();
    if (!ak) {
      throw new Error("Baidu Maps AK is required");
    }
    this.ak = ak;
    this.placeSearchEndpoint =
      params.placeSearchEndpoint ?? params.endpoint ?? DEFAULT_BAIDU_PLACE_SEARCH_ENDPOINT;
    this.geocodingEndpoint = params.geocodingEndpoint ?? DEFAULT_BAIDU_GEOCODING_ENDPOINT;
    this.fetchImpl = params.fetchImpl ?? fetch;
  }

  async searchPlacesNearby(params: BaiduMapNearbySearchParams): Promise<BaiduMapNearbySearchResult> {
    const url = new URL(this.placeSearchEndpoint);
    url.searchParams.set("query", params.query);
    url.searchParams.set("location", `${params.latitude},${params.longitude}`);
    url.searchParams.set("radius", String(Math.trunc(params.radiusMeters)));
    url.searchParams.set("output", params.output ?? "json");
    url.searchParams.set("ak", this.ak);
    url.searchParams.set("scope", "2");
    url.searchParams.set("coord_type", "3");
    url.searchParams.set("page_size", String(params.pageSize ?? 20));
    url.searchParams.set("page_num", String(params.pageNum ?? 0));

    const safeUrl = redactBaiduMapUrl(url.toString());
    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new BaiduMapApiError(`Baidu Maps HTTP error: ${response.status}`, {
        status: response.status,
        safeUrl,
      });
    }

    const raw = (await response.json()) as BaiduPlaceApiResponse;
    const status = numberValue(raw.status) ?? -1;
    const message = stringValue(raw.message);
    if (status !== 0) {
      throw new BaiduMapApiError(`Baidu Maps API error ${status}${message ? `: ${message}` : ""}`, {
        status,
        safeUrl,
      });
    }

    return {
      status,
      message,
      total: numberValue(raw.total) ?? 0,
      pois: Array.isArray(raw.results) ? raw.results.map(normalizeBaiduPlaceResult) : [],
      raw: isRecord(raw) ? raw : {},
    };
  }

  async searchPlacesByRegion(params: BaiduMapRegionSearchParams): Promise<BaiduMapNearbySearchResult> {
    const url = new URL(this.placeSearchEndpoint);
    url.searchParams.set("query", params.query);
    url.searchParams.set("region", params.region);
    url.searchParams.set("city_limit", params.cityLimit === false ? "false" : "true");
    url.searchParams.set("output", params.output ?? "json");
    url.searchParams.set("ak", this.ak);
    url.searchParams.set("scope", "2");
    url.searchParams.set("page_size", String(params.pageSize ?? 20));
    url.searchParams.set("page_num", String(params.pageNum ?? 0));

    const safeUrl = redactBaiduMapUrl(url.toString());
    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new BaiduMapApiError(`Baidu Maps HTTP error: ${response.status}`, {
        status: response.status,
        safeUrl,
      });
    }

    const raw = (await response.json()) as BaiduPlaceApiResponse;
    const status = numberValue(raw.status) ?? -1;
    const message = stringValue(raw.message);
    if (status !== 0) {
      throw new BaiduMapApiError(`Baidu Maps API error ${status}${message ? `: ${message}` : ""}`, {
        status,
        safeUrl,
      });
    }

    return {
      status,
      message,
      total: numberValue(raw.total) ?? 0,
      pois: Array.isArray(raw.results) ? raw.results.map(normalizeBaiduPlaceResult) : [],
      raw: isRecord(raw) ? raw : {},
    };
  }

  async geocodeAddress(params: BaiduMapGeocodeParams): Promise<BaiduMapGeocodeResult> {
    const url = new URL(this.geocodingEndpoint);
    url.searchParams.set("address", params.address);
    if (params.city?.trim()) {
      url.searchParams.set("city", params.city.trim());
    }
    url.searchParams.set("output", "json");
    url.searchParams.set("ret_coordtype", "bd09ll");
    url.searchParams.set("ak", this.ak);

    const safeUrl = redactBaiduMapUrl(url.toString());
    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new BaiduMapApiError(`Baidu Maps HTTP error: ${response.status}`, {
        status: response.status,
        safeUrl,
      });
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const status = numberValue(raw.status) ?? -1;
    const message = stringValue(raw.message);
    if (status !== 0) {
      throw new BaiduMapApiError(`Baidu Maps API error ${status}${message ? `: ${message}` : ""}`, {
        status,
        safeUrl,
      });
    }

    const result = isRecord(raw.result) ? raw.result : {};
    const location = isRecord(result.location) ? result.location : {};
    const latitude = numberValue(location.lat);
    const longitude = numberValue(location.lng);
    if (latitude === undefined || longitude === undefined) {
      throw new BaiduMapApiError("Baidu Maps geocoding result missing location", {
        status,
        safeUrl,
      });
    }

    return {
      latitude,
      longitude,
      precise: numberValue(result.precise),
      confidence: numberValue(result.confidence),
      comprehension: numberValue(result.comprehension),
      level: stringValue(result.level),
      raw,
    };
  }
}

export function resolveBaiduMapAkFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.HETANG_BAIDU_MAP_AK?.trim() || env.BAIDU_MAP_AK?.trim() || undefined;
}
