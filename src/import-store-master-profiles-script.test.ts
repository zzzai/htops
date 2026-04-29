import { DataType, newDb as createBaseDb } from "pg-mem";
import { describe, expect, it } from "vitest";

import { importStoreMasterProfiles } from "./import-store-master-profiles-script.js";
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

describe("importStoreMasterProfiles", () => {
  it("imports five store master profiles into the store", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [
        { orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] },
        { orgId: "627150985244677", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
        { orgId: "627152412155909", storeName: "荷塘悦色华美店", rawAliases: ["华美店"] },
        { orgId: "627152677269509", storeName: "荷塘悦色锦苑店", rawAliases: ["锦苑店"] },
        { orgId: "627153074147333", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
      ],
    });
    const masterStore = store as HetangOpsStore & {
      getStoreMasterProfile: (orgId: string) => Promise<Record<string, unknown> | null>;
      listStoreMasterProfileSnapshots: (orgId: string) => Promise<Array<Record<string, unknown>>>;
    };

    await store.initialize();

    const result = await importStoreMasterProfiles({
      store,
      filePath: "data/store-master-profiles/hetang-five-stores.initial.json",
      readFile: async () =>
        JSON.stringify({
          snapshotDate: "2026-04-21",
          profiles: [
            {
              orgId: "627149864218629",
              storeName: "荷塘悦色迎宾店",
              brandName: "荷塘悦色",
              cityName: "安阳",
              districtName: "文峰区",
              openingDate: "2018-07-18",
              areaM2: 2000,
              roomCountTotal: 33,
              serviceHoursJson: {
                windows: [{ start: "11:30", end: "02:00", overnight: true }],
              },
              longitude: 114.3921,
              latitude: 36.0972,
              storeFormat: "cinema_foot_bath",
              updatedAt: "2026-04-21T10:00:00.000Z",
            },
            {
              orgId: "627150985244677",
              storeName: "荷塘悦色义乌店",
              cityName: "安阳",
              openingDate: "2020-06-01",
              areaM2: 1200,
              roomCountTotal: 18,
              serviceHoursJson: {
                windows: [{ start: "11:30", end: "01:30", overnight: true }],
              },
              longitude: 114.3701,
              latitude: 36.1099,
              updatedAt: "2026-04-21T10:00:00.000Z",
            },
            {
              orgId: "627152412155909",
              storeName: "荷塘悦色华美店",
              cityName: "安阳",
              openingDate: "2021-05-01",
              areaM2: 950,
              roomCountTotal: 12,
              serviceHoursJson: {
                windows: [{ start: "12:00", end: "01:00", overnight: true }],
              },
              longitude: 114.3521,
              latitude: 36.0977,
              updatedAt: "2026-04-21T10:00:00.000Z",
            },
            {
              orgId: "627152677269509",
              storeName: "荷塘悦色锦苑店",
              cityName: "安阳",
              openingDate: "2021-09-01",
              areaM2: 860,
              roomCountTotal: 11,
              serviceHoursJson: {
                windows: [{ start: "12:00", end: "00:30", overnight: true }],
              },
              longitude: 114.3608,
              latitude: 36.0816,
              updatedAt: "2026-04-21T10:00:00.000Z",
            },
            {
              orgId: "627153074147333",
              storeName: "荷塘悦色园中园店",
              cityName: "安阳",
              openingDate: "2022-03-01",
              areaM2: 780,
              roomCountTotal: 10,
              serviceHoursJson: {
                windows: [{ start: "12:00", end: "00:00", overnight: false }],
              },
              longitude: 114.3812,
              latitude: 36.1123,
              updatedAt: "2026-04-21T10:00:00.000Z",
            },
          ],
        }),
    });

    await expect(masterStore.getStoreMasterProfile("627149864218629")).resolves.toEqual(
      expect.objectContaining({
        storeName: "荷塘悦色迎宾店",
        openingDate: "2018-07-18",
        areaM2: 2000,
        cityName: "安阳",
        longitude: 114.3921,
        latitude: 36.0972,
        serviceHoursJson: {
          windows: [{ start: "11:30", end: "02:00", overnight: true }],
        },
      }),
    );
    await expect(masterStore.listStoreMasterProfileSnapshots("627149864218629")).resolves.toEqual([
      expect.objectContaining({
        snapshotDate: "2026-04-21",
        storeName: "荷塘悦色迎宾店",
      }),
    ]);
    expect(result).toEqual({
      snapshotDate: "2026-04-21",
      importedCount: 5,
    });

    await store.close();
    await pool.end();
  });
});
