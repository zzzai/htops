import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { HetangRuntimeContext } from "./runtime-context.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [{ orgId: "1001", storeName: "迎宾店", isActive: true }],
  });
}

describe("HetangRuntimeContext", () => {
  it("owns lazy pool/store initialization and runtime shell execution", async () => {
    const pool = {
      end: vi.fn().mockResolvedValue(undefined),
    };
    const store = {
      initialize: vi.fn().mockResolvedValue(undefined),
      ensureAnalyticsViewsReady: vi.fn().mockResolvedValue(undefined),
      getCurrentServingVersion: vi.fn().mockResolvedValue("serving-v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([{ value: 1 }]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const createPool = vi.fn().mockReturnValue(pool);
    const createStore = vi.fn().mockReturnValue(store);
    const renderDoctorReport = vi.fn().mockResolvedValue("doctor ok");
    const context = new HetangRuntimeContext({
      config: buildConfig(),
      createPool,
      createStore,
      renderDoctorReport,
    });

    const firstStore = await context.getStore();
    const secondStore = await context.getStore();
    const shell = context.getRuntimeShell();
    const version = await shell.getCurrentServingVersion();
    const rows = await shell.executeCompiledServingQuery({
      sql: "select 1",
      queryParams: [],
    });
    const doctor = await shell.doctor();

    expect(firstStore).toBe(store);
    expect(secondStore).toBe(store);
    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createStore).toHaveBeenCalledTimes(1);
    expect(store.initialize).toHaveBeenCalledTimes(1);
    expect(store.ensureAnalyticsViewsReady).toHaveBeenCalledTimes(1);
    expect(version).toBe("serving-v1");
    expect(rows).toEqual([{ value: 1 }]);
    expect(doctor).toBe("doctor ok");
  });

  it("closes owned resources and recreates them cleanly on the next access", async () => {
    const firstPool = {
      end: vi.fn().mockResolvedValue(undefined),
    };
    const secondPool = {
      end: vi.fn().mockResolvedValue(undefined),
    };
    const firstStore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      ensureAnalyticsViewsReady: vi.fn().mockResolvedValue(undefined),
      getCurrentServingVersion: vi.fn().mockResolvedValue("v1"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const secondStore = {
      initialize: vi.fn().mockResolvedValue(undefined),
      ensureAnalyticsViewsReady: vi.fn().mockResolvedValue(undefined),
      getCurrentServingVersion: vi.fn().mockResolvedValue("v2"),
      executeCompiledServingQuery: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const context = new HetangRuntimeContext({
      config: buildConfig(),
      createPool: vi.fn().mockReturnValueOnce(firstPool).mockReturnValueOnce(secondPool),
      createStore: vi.fn().mockReturnValueOnce(firstStore).mockReturnValueOnce(secondStore),
      renderDoctorReport: vi.fn().mockResolvedValue("doctor ok"),
    });

    await context.getStore();
    await context.close();
    const recreated = await context.getStore();

    expect(firstStore.close).toHaveBeenCalledTimes(1);
    expect(firstPool.end).toHaveBeenCalledTimes(1);
    expect(recreated).toBe(secondStore);
    expect(secondStore.initialize).toHaveBeenCalledTimes(1);
  });
});
