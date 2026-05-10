import { describe, expect, test, vi } from "vitest";

import {
  BaiduMapApiError,
  BaiduMapClient,
  normalizeBaiduPlaceResult,
  redactBaiduMapUrl,
} from "./baidu-map-client.js";

describe("BaiduMapClient", () => {
  test("searches nearby places and normalizes Baidu POI fields", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            status: 0,
            message: "ok",
            total: 42,
            results: [
              {
                uid: "poi-1",
                name: "测试酒店",
                address: "测试路 1 号",
                city: "安阳市",
                area: "文峰区",
                telephone: "0372-0000000",
                location: {
                  lat: 36.1,
                  lng: 114.3,
                },
                detail_info: {
                  distance: 316,
                  tag: "酒店;宾馆",
                  type: "hotel",
                  overall_rating: "4.6",
                },
              },
            ],
          };
        },
      } as Response;
    });
    const client = new BaiduMapClient({ ak: "test-secret-ak", fetchImpl });

    const result = await client.searchPlacesNearby({
      query: "酒店$宾馆",
      latitude: 36.1,
      longitude: 114.3,
      radiusMeters: 3000,
      pageNum: 0,
    });

    expect(result.total).toBe(42);
    expect(result.pois).toEqual([
      {
        uid: "poi-1",
        name: "测试酒店",
        address: "测试路 1 号",
        city: "安阳市",
        district: "文峰区",
        telephone: "0372-0000000",
        latitude: 36.1,
        longitude: 114.3,
        distanceMeters: 316,
        type: "hotel",
        tags: ["酒店", "宾馆"],
        overallRating: "4.6",
        raw: expect.any(Object),
      },
    ]);
    const request = new URL(calls[0]!);
    expect(request.origin + request.pathname).toBe("https://api.map.baidu.com/place/v2/search");
    expect(request.searchParams.get("ak")).toBe("test-secret-ak");
    expect(request.searchParams.get("query")).toBe("酒店$宾馆");
    expect(request.searchParams.get("location")).toBe("36.1,114.3");
    expect(request.searchParams.get("radius")).toBe("3000");
    expect(request.searchParams.get("scope")).toBe("2");
    expect(request.searchParams.get("coord_type")).toBe("3");
  });

  test("throws redacted API errors without leaking the AK", async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: true,
        async json() {
          return {
            status: 302,
            message: "AK quota exceeded",
          };
        },
      } as Response;
    });
    const client = new BaiduMapClient({ ak: "sensitive-ak", fetchImpl });

    await expect(
      client.searchPlacesNearby({
        query: "足浴",
        latitude: 36.1,
        longitude: 114.3,
        radiusMeters: 1000,
      }),
    ).rejects.toMatchObject({
      name: "BaiduMapApiError",
      status: 302,
      safeUrl: expect.stringContaining("ak=REDACTED"),
    });

    try {
      await client.searchPlacesNearby({
        query: "足浴",
        latitude: 36.1,
        longitude: 114.3,
        radiusMeters: 1000,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(BaiduMapApiError);
      expect(String(error)).not.toContain("sensitive-ak");
      expect((error as BaiduMapApiError).safeUrl).not.toContain("sensitive-ak");
    }
  });

  test("geocodes address and returns bd09 coordinates", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            status: 0,
            result: {
              precise: 1,
              confidence: 80,
              comprehension: 90,
              level: "门址",
              location: {
                lat: 36.102,
                lng: 114.301,
              },
            },
          };
        },
      } as Response;
    });
    const client = new BaiduMapClient({ ak: "test-secret-ak", fetchImpl });

    await expect(
      client.geocodeAddress({
        address: "荷塘悦色迎宾店",
        city: "安阳",
      }),
    ).resolves.toEqual({
      latitude: 36.102,
      longitude: 114.301,
      precise: 1,
      confidence: 80,
      comprehension: 90,
      level: "门址",
      raw: expect.any(Object),
    });

    const request = new URL(calls[0]!);
    expect(request.origin + request.pathname).toBe("https://api.map.baidu.com/geocoding/v3/");
    expect(request.searchParams.get("address")).toBe("荷塘悦色迎宾店");
    expect(request.searchParams.get("city")).toBe("安阳");
    expect(request.searchParams.get("ret_coordtype")).toBe("bd09ll");
    expect(request.searchParams.get("ak")).toBe("test-secret-ak");
  });

  test("searches places by region for store POI lookup", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return {
        ok: true,
        async json() {
          return {
            status: 0,
            total: 1,
            results: [
              {
                uid: "store-poi",
                name: "荷塘悦色影院式沐足(义乌店)",
                address: "曙光路与明福街交叉口东北角",
                area: "文峰区",
                location: {
                  lat: 36.086407,
                  lng: 114.390299,
                },
                detail_info: {
                  tag: "休闲娱乐;洗浴按摩",
                  overall_rating: "4.5",
                },
              },
            ],
          };
        },
      } as Response;
    });
    const client = new BaiduMapClient({ ak: "test-secret-ak", fetchImpl });

    const result = await client.searchPlacesByRegion({
      query: "荷塘悦色义乌店",
      region: "安阳",
      cityLimit: true,
    });

    expect(result.total).toBe(1);
    expect(result.pois[0]).toMatchObject({
      uid: "store-poi",
      name: "荷塘悦色影院式沐足(义乌店)",
      latitude: 36.086407,
      longitude: 114.390299,
      tags: ["休闲娱乐", "洗浴按摩"],
      overallRating: "4.5",
    });
    const request = new URL(calls[0]!);
    expect(request.searchParams.get("query")).toBe("荷塘悦色义乌店");
    expect(request.searchParams.get("region")).toBe("安阳");
    expect(request.searchParams.get("city_limit")).toBe("true");
    expect(request.searchParams.get("scope")).toBe("2");
  });
});

describe("normalizeBaiduPlaceResult", () => {
  test("tolerates missing optional fields", () => {
    expect(
      normalizeBaiduPlaceResult({
        name: "无坐标 POI",
        detail_info: {
          tag: "餐饮",
        },
      }),
    ).toEqual({
      name: "无坐标 POI",
      tags: ["餐饮"],
      raw: expect.any(Object),
    });
  });
});

describe("redactBaiduMapUrl", () => {
  test("redacts ak query parameter", () => {
    expect(redactBaiduMapUrl("https://api.map.baidu.com/place/v2/search?query=酒店&ak=abc123")).toBe(
      "https://api.map.baidu.com/place/v2/search?query=%E9%85%92%E5%BA%97&ak=REDACTED",
    );
  });
});
