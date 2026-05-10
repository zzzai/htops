import { fromFile } from "geotiff";

const EARTH_RADIUS_KM = 6371.0088;

export type RasterWindow = [number, number, number, number];

export type PopulationRasterGrid = {
  width: number;
  height: number;
  origin: [number, number];
  resolution: [number, number];
  noData?: number | null;
  readWindow: (window: RasterWindow) => Promise<ArrayLike<number>>;
};

export type PopulationRasterStats = {
  totalPopulation: number;
  includedPixels: number;
  window: RasterWindow;
};

type GeoTiffImageLike = {
  getWidth: () => number;
  getHeight: () => number;
  getOrigin: () => number[];
  getResolution: () => number[];
  getGDALNoData: () => number | null;
  readRasters: (options: {
    window: RasterWindow;
    samples: number[];
    interleave: true;
  }) => Promise<ArrayLike<number>>;
};

type GeoTiffLike = {
  getImage: () => Promise<GeoTiffImageLike>;
  close?: () => false | Promise<void>;
};

function degreesLatitudeForKm(radiusKm: number): number {
  return (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
}

function degreesLongitudeForKm(latitude: number, radiusKm: number): number {
  const latitudeRadians = (latitude * Math.PI) / 180;
  const cosLatitude = Math.max(0.000001, Math.abs(Math.cos(latitudeRadians)));
  return degreesLatitudeForKm(radiusKm) / cosLatitude;
}

function haversineDistanceKm(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }): number {
  const leftLat = (left.latitude * Math.PI) / 180;
  const rightLat = (right.latitude * Math.PI) / 180;
  const deltaLat = rightLat - leftLat;
  const deltaLng = ((right.longitude - left.longitude) * Math.PI) / 180;
  const sinLat = Math.sin(deltaLat / 2);
  const sinLng = Math.sin(deltaLng / 2);
  const a = sinLat * sinLat + Math.cos(leftLat) * Math.cos(rightLat) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pixelToLongitude(raster: PopulationRasterGrid, x: number): number {
  return raster.origin[0] + (x + 0.5) * raster.resolution[0];
}

function pixelToLatitude(raster: PopulationRasterGrid, y: number): number {
  return raster.origin[1] + (y + 0.5) * raster.resolution[1];
}

function longitudeToPixelEdge(raster: PopulationRasterGrid, longitude: number): number {
  return (longitude - raster.origin[0]) / raster.resolution[0];
}

function latitudeToPixelEdge(raster: PopulationRasterGrid, latitude: number): number {
  return (latitude - raster.origin[1]) / raster.resolution[1];
}

function isNoData(value: number, noData?: number | null): boolean {
  return noData !== undefined && noData !== null && Math.abs(value - noData) < 1e-9;
}

export function resolveRasterWindowForCircle(params: {
  raster: PopulationRasterGrid;
  latitude: number;
  longitude: number;
  radiusKm: number;
}): RasterWindow {
  const latDelta = degreesLatitudeForKm(params.radiusKm);
  const lngDelta = degreesLongitudeForKm(params.latitude, params.radiusKm);
  const leftEdge = longitudeToPixelEdge(params.raster, params.longitude - lngDelta);
  const rightEdge = longitudeToPixelEdge(params.raster, params.longitude + lngDelta);
  const topEdge = latitudeToPixelEdge(params.raster, params.latitude + latDelta);
  const bottomEdge = latitudeToPixelEdge(params.raster, params.latitude - latDelta);

  const minX = clamp(Math.floor(Math.min(leftEdge, rightEdge)), 0, params.raster.width);
  const maxX = clamp(Math.ceil(Math.max(leftEdge, rightEdge)), 0, params.raster.width);
  const minY = clamp(Math.floor(Math.min(topEdge, bottomEdge)), 0, params.raster.height);
  const maxY = clamp(Math.ceil(Math.max(topEdge, bottomEdge)), 0, params.raster.height);

  return [minX, minY, maxX, maxY];
}

export async function calculatePopulationInRadiusFromRaster(params: {
  raster: PopulationRasterGrid;
  latitude: number;
  longitude: number;
  radiusKm: number;
}): Promise<PopulationRasterStats> {
  const window = resolveRasterWindowForCircle(params);
  const [minX, minY, maxX, maxY] = window;
  if (minX >= maxX || minY >= maxY) {
    return {
      totalPopulation: 0,
      includedPixels: 0,
      window,
    };
  }

  const values = await params.raster.readWindow(window);
  const width = maxX - minX;
  let totalPopulation = 0;
  let includedPixels = 0;

  for (let row = minY; row < maxY; row += 1) {
    for (let column = minX; column < maxX; column += 1) {
      const latitude = pixelToLatitude(params.raster, row);
      const longitude = pixelToLongitude(params.raster, column);
      if (
        haversineDistanceKm(
          { latitude: params.latitude, longitude: params.longitude },
          { latitude, longitude },
        ) > params.radiusKm
      ) {
        continue;
      }
      const value = Number(values[(row - minY) * width + (column - minX)]);
      if (!Number.isFinite(value) || value < 0 || isNoData(value, params.raster.noData)) {
        continue;
      }
      totalPopulation += value;
      includedPixels += 1;
    }
  }

  return {
    totalPopulation,
    includedPixels,
    window,
  };
}

export async function openGeoTiffPopulationRaster(filePath: string): Promise<{
  raster: PopulationRasterGrid;
  close: () => Promise<void>;
}> {
  const tiff = (await fromFile(filePath)) as GeoTiffLike;
  const image = await tiff.getImage();
  const origin = image.getOrigin();
  const resolution = image.getResolution();

  return {
    raster: {
      width: image.getWidth(),
      height: image.getHeight(),
      origin: [origin[0]!, origin[1]!],
      resolution: [resolution[0]!, resolution[1]!],
      noData: image.getGDALNoData(),
      async readWindow(window) {
        return image.readRasters({
          window,
          samples: [0],
          interleave: true,
        });
      },
    },
    async close() {
      await tiff.close?.();
    },
  };
}
