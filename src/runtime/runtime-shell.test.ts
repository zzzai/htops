import { describe, expect, it, vi } from "vitest";
import { HetangRuntimeShell } from "./runtime-shell.js";

describe("HetangRuntimeShell", () => {
  it("caches compiled serving queries by cache key and ttl", async () => {
    const executeCompiledServingQuery = vi.fn().mockResolvedValue([{ org_id: "1001" }]);
    const shell = new HetangRuntimeShell({
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery,
      renderDoctorReport: vi.fn().mockResolvedValue("doctor ok"),
    });

    await expect(
      shell.executeCompiledServingQuery({
        sql: "select * from serving_store_day where org_id = $1",
        queryParams: ["1001"],
        cacheKey: "serving-v1:key-1",
        ttlSeconds: 60,
      }),
    ).resolves.toEqual([{ org_id: "1001" }]);
    await expect(
      shell.executeCompiledServingQuery({
        sql: "select * from serving_store_day where org_id = $1",
        queryParams: ["1001"],
        cacheKey: "serving-v1:key-1",
        ttlSeconds: 60,
      }),
    ).resolves.toEqual([{ org_id: "1001" }]);

    expect(executeCompiledServingQuery).toHaveBeenCalledTimes(1);
  });

  it("delegates doctor rendering to the injected reporter", async () => {
    const renderDoctorReport = vi.fn().mockResolvedValue("doctor ok");
    const shell = new HetangRuntimeShell({
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([]),
      renderDoctorReport,
    });

    await expect(shell.doctor()).resolves.toBe("doctor ok");
    expect(renderDoctorReport).toHaveBeenCalledTimes(1);
  });
});
