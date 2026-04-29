import { DataType, newDb as createBaseDb } from "pg-mem";
import { describe, expect, it } from "vitest";

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

describe("store reactivation learning snapshots", () => {
  it("persists member reactivation outcome snapshots by date range", async () => {
    const db = newDb();
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const store = new HetangOpsStore({
      pool,
      stores: [{ orgId: "1005", storeName: "迎宾店", rawAliases: [] }],
    });

    await store.initialize();

    const learningStore = store as HetangOpsStore & {
      upsertMemberReactivationOutcomeSnapshot: (row: {
        orgId: string;
        bizDate: string;
        memberId: string;
        customerIdentityKey: string;
        customerDisplayName: string;
        primarySegment: string;
        followupBucket: string;
        priorityBand: string;
        recommendedActionLabel: string;
        feedbackStatus: string;
        contacted: boolean;
        replied: boolean;
        booked: boolean;
        arrived: boolean;
        closed: boolean;
        outcomeLabel: string;
        outcomeScore: number;
        learningJson: string;
        updatedAt: string;
      }) => Promise<void>;
      listMemberReactivationOutcomeSnapshotsByDateRange: (
        orgId: string,
        startBizDate: string,
        endBizDate: string,
      ) => Promise<Array<{ memberId: string; outcomeLabel: string; outcomeScore: number }>>;
    };

    await learningStore.upsertMemberReactivationOutcomeSnapshot({
      orgId: "1005",
      bizDate: "2026-04-18",
      memberId: "M-001",
      customerIdentityKey: "member:M-001",
      customerDisplayName: "王女士",
      primarySegment: "important-reactivation-member",
      followupBucket: "high-value-reactivation",
      priorityBand: "P0",
      recommendedActionLabel: "immediate-1to1",
      feedbackStatus: "booked",
      contacted: true,
      replied: true,
      booked: true,
      arrived: false,
      closed: false,
      outcomeLabel: "booked",
      outcomeScore: 0.82,
      learningJson:
        '{"source":"reactivation-outcome-snapshot-v1","noteSignalLabels":["appointment-window"]}',
      updatedAt: "2026-04-18T15:21:00+08:00",
    });

    await expect(
      learningStore.listMemberReactivationOutcomeSnapshotsByDateRange(
        "1005",
        "2026-04-01",
        "2026-04-18",
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        memberId: "M-001",
        outcomeLabel: "booked",
        outcomeScore: 0.82,
      }),
    ]);

    await store.close();
    await pool.end();
  });
});
