export type WorldPopFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type WorldPopFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, unknown>;
    geometry: {
      type: "Polygon";
      coordinates: number[][][];
    };
  }>;
};

export type WorldPopStatsParams = {
  geojson: WorldPopFeatureCollection;
  dataset?: string;
  year?: number;
};

export type WorldPopStatsResult = {
  totalPopulation: number;
  raw: Record<string, unknown>;
};

export type WorldPopRasterCatalogEntry = {
  alias: string;
  iso3: string;
  year: number;
  fileUri: string;
  catalogId?: string;
  releaseDate?: string;
  doi?: string;
};

export type WorldPopDatasetProfileKey = "wpgppop-2020" | "global2-r2025a-2025";

export type WorldPopDatasetProfile = {
  key: WorldPopDatasetProfileKey;
  dataset: string;
  year: number;
  sourceLabel: string;
  sourceVersion: string;
  supportsStatsApi: boolean;
  iso3?: string;
  downloadUri?: string;
  releaseUri?: string;
};

type WorldPopClientParams = {
  fetchImpl?: WorldPopFetch;
  endpoint?: string;
  catalogEndpoint?: string;
};

const DEFAULT_WORLDPOP_STATS_ENDPOINT = "https://api.worldpop.org/v1/services/stats";
const DEFAULT_WORLDPOP_CATALOG_ENDPOINT = "https://hub.worldpop.org/rest/data/pop";
const EARTH_RADIUS_KM = 6371.0088;
const WORLDPOP_GLOBAL2_R2025A_ZIP_URL =
  "https://data.worldpop.org/repo/prj/Global_2015_2030/R2025A/population_estimates/v1/population_G2_R2025A_v1.zip";
const WORLDPOP_GLOBAL2_R2025A_RELEASE_URL =
  "https://data.worldpop.org/repo/prj/Global_2015_2030/R2025A/population_estimates/v1/Release_Statement_G2_R2025A_v1.pdf";

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

export function calculateCircleAreaKm2(radiusKm: number): number {
  return Math.PI * radiusKm * radiusKm;
}

export function buildCircleFeatureCollection(params: {
  latitude: number;
  longitude: number;
  radiusKm: number;
  segments?: number;
}): WorldPopFeatureCollection {
  const segments = Math.max(8, Math.trunc(params.segments ?? 48));
  const centerLat = (params.latitude * Math.PI) / 180;
  const centerLng = (params.longitude * Math.PI) / 180;
  const angularDistance = params.radiusKm / EARTH_RADIUS_KM;
  const coordinates: number[][] = [];

  for (let index = 0; index < segments; index += 1) {
    const bearing = (2 * Math.PI * index) / segments;
    const lat = Math.asin(
      Math.sin(centerLat) * Math.cos(angularDistance) +
        Math.cos(centerLat) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lng =
      centerLng +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centerLat),
        Math.cos(angularDistance) - Math.sin(centerLat) * Math.sin(lat),
      );
    coordinates.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI]);
  }
  coordinates.push(coordinates[0]!);

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [coordinates],
        },
      },
    ],
  };
}

export class WorldPopApiError extends Error {
  readonly status?: number;
  readonly taskId?: string;
  readonly safeUrl?: string;

  constructor(message: string, params: { status?: number; taskId?: string; safeUrl?: string } = {}) {
    super(message);
    this.name = "WorldPopApiError";
    this.status = params.status;
    this.taskId = params.taskId;
    this.safeUrl = params.safeUrl;
  }
}

export function resolveWorldPopDatasetProfile(key: WorldPopDatasetProfileKey): WorldPopDatasetProfile {
  if (key === "global2-r2025a-2025") {
    return {
      key,
      dataset: "G2_CN_POP_R25A_1km",
      year: 2025,
      sourceLabel: "WorldPop Global2 R2025A 2025",
      sourceVersion: "worldpop_global2_r2025a_2025",
      supportsStatsApi: false,
      iso3: "CHN",
      downloadUri: WORLDPOP_GLOBAL2_R2025A_ZIP_URL,
      releaseUri: WORLDPOP_GLOBAL2_R2025A_RELEASE_URL,
    };
  }
  return {
    key: "wpgppop-2020",
    dataset: "wpgppop",
    year: 2020,
    sourceLabel: "WorldPop wpgppop 2020",
    sourceVersion: "worldpop_wpgppop_2020",
    supportsStatsApi: true,
  };
}

export class WorldPopClient {
  private readonly endpoint: string;
  private readonly catalogEndpoint: string;
  private readonly fetchImpl: WorldPopFetch;

  constructor(params: WorldPopClientParams = {}) {
    this.endpoint = params.endpoint ?? DEFAULT_WORLDPOP_STATS_ENDPOINT;
    this.catalogEndpoint = params.catalogEndpoint ?? DEFAULT_WORLDPOP_CATALOG_ENDPOINT;
    this.fetchImpl = params.fetchImpl ?? fetch;
  }

  async fetchPopulationStats(params: WorldPopStatsParams): Promise<WorldPopStatsResult> {
    const url = new URL(this.endpoint);
    url.searchParams.set("dataset", params.dataset ?? "wpgppop");
    url.searchParams.set("year", String(params.year ?? 2020));
    url.searchParams.set("runasync", "false");
    url.searchParams.set("geojson", JSON.stringify(params.geojson));

    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new WorldPopApiError(`WorldPop HTTP error: ${response.status}`, {
        status: response.status,
        safeUrl: url.toString(),
      });
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const taskId = stringValue(raw.taskid);
    const data = isRecord(raw.data) ? raw.data : undefined;
    const totalPopulation =
      numberValue(data?.total_population) ??
      numberValue(data?.totalPopulation) ??
      numberValue(data?.sum) ??
      numberValue(raw.total_population);
    if (totalPopulation === undefined) {
      throw new WorldPopApiError("WorldPop response did not contain synchronous population data", {
        status: numberValue(raw.status_code),
        taskId,
        safeUrl: url.toString(),
      });
    }
    return {
      totalPopulation,
      raw,
    };
  }

  async fetchRasterCatalogEntry(params: {
    alias: string;
    iso3: string;
    year: number;
  }): Promise<WorldPopRasterCatalogEntry> {
    const url = new URL(`${this.catalogEndpoint.replace(/\/$/u, "")}/${encodeURIComponent(params.alias)}`);
    url.searchParams.set("iso3", params.iso3);

    const response = await this.fetchImpl(url.toString());
    if (!response.ok) {
      throw new WorldPopApiError(`WorldPop catalog HTTP error: ${response.status}`, {
        status: response.status,
        safeUrl: url.toString(),
      });
    }

    const raw = (await response.json()) as Record<string, unknown>;
    const rows = Array.isArray(raw.data) ? raw.data.filter(isRecord) : [];
    const row = rows.find((entry) => numberValue(entry.popyear) === params.year);
    const files = row && Array.isArray(row.files) ? row.files : [];
    const fileUri = files.map(stringValue).find((entry): entry is string => Boolean(entry));
    if (!row || !fileUri) {
      throw new WorldPopApiError(
        `WorldPop catalog did not contain a raster file for ${params.alias} ${params.iso3} ${params.year}`,
        {
          safeUrl: url.toString(),
        },
      );
    }

    const catalogIdNumber = numberValue(row.id);
    return {
      alias: params.alias,
      iso3: params.iso3,
      year: params.year,
      fileUri,
      catalogId: catalogIdNumber === undefined ? stringValue(row.id) : String(catalogIdNumber),
      releaseDate: stringValue(row.date),
      doi: stringValue(row.doi),
    };
  }
}
