import { DataType, newDb as createBaseDb } from "pg-mem";
import { describe, expect, it, vi } from "vitest";

import { importIndustryContextSnapshot } from "./import-industry-context-script.js";
import { HetangOpsStore } from "./store.js";

function newDb() {
  const db = createBaseDb();
  const heldLocks = new Set<number>();
  db.public.registerFunction({
    name: "pg_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      heldLocks.add(Number(lockKey));
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_try_advisory_lock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => {
      const normalized = Number(lockKey);
      if (heldLocks.has(normalized)) {
        return false;
      }
      heldLocks.add(normalized);
      return true;
    },
  });
  db.public.registerFunction({
    name: "pg_advisory_unlock",
    args: [DataType.bigint],
    returns: DataType.bool,
    implementation: (lockKey: number | bigint) => heldLocks.delete(Number(lockKey)),
  });
  db.public.registerFunction({
    name: "right",
    args: [DataType.text, DataType.integer],
    returns: DataType.text,
    implementation: (value: string, count: number) =>
      typeof value === "string" ? value.slice(-Math.max(0, Number(count))) : "",
  });
  return db;
}

describe("importIndustryContextSnapshot", () => {
  it("imports a checked-in industry context snapshot into the store", async () => {
    const upsertIndustryContextSnapshot = vi.fn().mockResolvedValue(undefined);
    const logs: string[] = [];

    const result = await importIndustryContextSnapshot({
      store: {
        upsertIndustryContextSnapshot,
      } as never,
      filePath: "data/industry-context/2026-04-24-initial.json",
      readFile: async () =>
        JSON.stringify({
          snapshotDate: "2026-04-24",
          items: [
            {
              signalKind: "platform_rule",
              signalKey: "meituan_price_mindshare",
              title: "平台价格心智抬升",
              summary: "低价敏感客决策更快，门店更需要差异化承接。",
              confidence: "medium",
              sourceType: "manual_research",
              sourceLabel: "平台观察",
              applicableModules: ["world_model", "hq_narrative"],
              updatedAt: "2026-04-24T09:00:00.000Z",
            },
            {
              signalKind: "city_consumption_trend",
              signalKey: "night_leisure_recovery",
              title: "夜间休闲需求恢复",
              summary: "工作日晚饭后到店决策回暖，但价格敏感仍然明显。",
              confidence: "medium",
              truthBoundary: "weak_signal",
              sourceType: "city_observation",
              sourceLabel: "同城观察",
              applicableModules: ["hq_narrative", "store_diagnosis"],
              note: "仅用于解释，不直接改写门店评分",
              updatedAt: "2026-04-24T09:05:00.000Z",
            },
          ],
        }),
      log: (line) => logs.push(line),
    });

    expect(upsertIndustryContextSnapshot).toHaveBeenCalledTimes(2);
    expect(upsertIndustryContextSnapshot).toHaveBeenNthCalledWith(1, {
      snapshotDate: "2026-04-24",
      signalKind: "platform_rule",
      signalKey: "meituan_price_mindshare",
      title: "平台价格心智抬升",
      summary: "低价敏感客决策更快，门店更需要差异化承接。",
      confidence: "medium",
      truthBoundary: "weak_signal",
      sourceType: "manual_research",
      sourceLabel: "平台观察",
      applicableModules: ["world_model", "hq_narrative"],
      rawJson: JSON.stringify({
        signalKind: "platform_rule",
        signalKey: "meituan_price_mindshare",
        title: "平台价格心智抬升",
        summary: "低价敏感客决策更快，门店更需要差异化承接。",
        confidence: "medium",
        sourceType: "manual_research",
        sourceLabel: "平台观察",
        applicableModules: ["world_model", "hq_narrative"],
        updatedAt: "2026-04-24T09:00:00.000Z",
      }),
      updatedAt: "2026-04-24T09:00:00.000Z",
    });
    expect(result).toEqual({
      snapshotDate: "2026-04-24",
      importedCount: 2,
    });
    expect(logs).toContain(
      "Imported 2 industry context items for snapshot=2026-04-24 from data/industry-context/2026-04-24-initial.json",
    );
  });

  it("imports the checked-in sample file into the industry snapshot store", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [],
    });

    await store.initialize();

    const result = await importIndustryContextSnapshot({
      store,
      filePath: "data/industry-context/2026-04-24-initial.json",
    });

    await expect(store.listIndustryContextSnapshots()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          snapshotDate: "2026-04-24",
          signalKind: "platform_rule",
          signalKey: "meituan_price_mindshare",
          title: "平台价格心智抬升",
        }),
      ]),
    );
    expect(result).toEqual({
      snapshotDate: "2026-04-24",
      importedCount: 3,
    });

    await store.close();
    await pool.end();
  });
});
