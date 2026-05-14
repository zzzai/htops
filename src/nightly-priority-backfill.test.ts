import { describe, expect, it } from "vitest";
import {
  buildNightlyPriorityBackfillTasks,
  filterNightlyPriorityTasksByExcludedEndpoints,
  filterNightlyPriorityTasksByAvailableEndpoints,
  resolveNightlyPriorityProbeSpec,
  resolvePostWindowBackfillDeadline,
  resolveNightlyPriorityTaskSyncPlan,
  summarizeNightlyPriorityBackfillPlan,
  type NightlyPriorityBackfillCoverage,
} from "./nightly-priority-backfill.js";
import { shiftBizDate } from "./time.js";
import type { HetangStoreConfig } from "./types.js";

function store(orgId: string, storeName: string): HetangStoreConfig {
  return {
    orgId,
    storeName,
    rawAliases: [],
    isActive: true,
  };
}

function coverage(
  orgId: string,
  rawFacts: NightlyPriorityBackfillCoverage["rawFacts"],
  rawAttempts: NightlyPriorityBackfillCoverage["rawAttempts"] = {},
): NightlyPriorityBackfillCoverage {
  return { orgId, rawFacts, rawAttempts };
}

describe("nightly priority backfill planner", () => {
  it("prioritizes recent core and critical user-trade gaps before older core, member backfill, and snapshots", () => {
    const tasks = buildNightlyPriorityBackfillTasks({
      stores: [store("1001", "义乌店")],
      startBizDate: "2026-01-01",
      endBizDate: "2026-01-31",
      nowBizDate: "2026-02-01",
      recentCoreLookbackDays: 7,
      coreSliceDays: 3,
      memberSliceDays: 7,
      userTradeSliceDays: 3,
      snapshotBizDate: "2026-02-01",
      maxTasks: 100,
      coverageByOrgId: new Map([
        [
          "1001",
          coverage("1001", {
            "1.2": new Set(["2026-01-01", "2026-01-02"]),
            "1.3": new Set(["2026-01-29"]),
            "1.6": new Set(["2026-01-29", "2026-01-30", "2026-01-31"]),
            "1.7": new Set(["2026-01-29", "2026-01-30", "2026-01-31"]),
          }),
        ],
      ]),
      candidateCardIdsByOrgId: new Map([["1001", ["card-1", "card-2", "card-3"]]]),
      snapshotAttemptedByOrgId: new Map([["1001", new Set()]]),
    });

    const firstHistoricalCoreIndex = tasks.findIndex(
      (task) => task.priority === "P1_HISTORICAL_CORE",
    );
    expect(firstHistoricalCoreIndex).toBeGreaterThan(0);
    expect(
      tasks
        .slice(0, firstHistoricalCoreIndex)
        .every(
          (task) =>
            task.priority === "P0_RECENT_CORE" ||
            task.priority === "P0_USER_TRADE_CRITICAL",
        ),
    ).toBe(true);
    expect(tasks[0]).toMatchObject({
      orgId: "1001",
      endpoint: "1.4",
      priority: "P0_USER_TRADE_CRITICAL",
      startBizDate: "2026-01-01",
      selectedCardIds: ["card-1", "card-2", "card-3"],
    });
    expect(tasks.find((task) => task.priority === "P0_RECENT_CORE")).toMatchObject({
      orgId: "1001",
      endpoint: "1.2",
      startBizDate: "2026-01-25",
      endBizDate: "2026-01-27",
    });
    expect(tasks.some((task) => task.endpoint === "1.1" && task.priority === "P2_MEMBER")).toBe(
      true,
    );
    expect(
      tasks.some((task) => task.endpoint === "1.5" && task.priority === "P3_SNAPSHOT"),
    ).toBe(true);
    expect(
      tasks.some(
        (task) => task.endpoint === "1.4" && task.priority === "P0_USER_TRADE_CRITICAL",
      ),
    ).toBe(true);
  });

  it("promotes missing user-trade coverage before historical core backfill", () => {
    const allDays = new Set(
      Array.from({ length: 31 }, (_value, index) => shiftBizDate("2026-01-01", index)),
    );
    const tasks = buildNightlyPriorityBackfillTasks({
      stores: [store("1001", "义乌店")],
      startBizDate: "2026-01-01",
      endBizDate: "2026-01-31",
      nowBizDate: "2026-02-01",
      recentCoreLookbackDays: 7,
      coreSliceDays: 7,
      memberSliceDays: 7,
      userTradeSliceDays: 7,
      coverageByOrgId: new Map([
        [
          "1001",
          coverage(
            "1001",
            {
              "1.2": allDays,
              "1.3": allDays,
              "1.6": allDays,
              "1.7": new Set(["2026-01-25", "2026-01-26", "2026-01-27", "2026-01-28"]),
            },
            {
              "1.1": allDays,
            },
          ),
        ],
      ]),
      candidateCardIdsByOrgId: new Map([["1001", ["card-1", "card-2", "card-3"]]]),
      snapshotAttemptedByOrgId: new Map([["1001", new Set(["1.5", "1.8"])]]),
      maxTasks: 100,
    });

    const firstUserTradeIndex = tasks.findIndex((task) => task.endpoint === "1.4");
    const firstHistoricalCoreIndex = tasks.findIndex(
      (task) => task.priority === "P1_HISTORICAL_CORE",
    );

    expect(firstUserTradeIndex).toBeGreaterThanOrEqual(0);
    expect(tasks[firstUserTradeIndex]).toMatchObject({
      priority: "P0_USER_TRADE_CRITICAL",
      endpoint: "1.4",
      startBizDate: "2026-01-01",
      selectedCardIds: ["card-1", "card-2", "card-3"],
    });
    expect(firstHistoricalCoreIndex).toBeGreaterThan(firstUserTradeIndex);
  });

  it("does not starve 1.4 user-trade recovery when maxTasks is tight", () => {
    const tasks = buildNightlyPriorityBackfillTasks({
      stores: [store("1001", "义乌店")],
      startBizDate: "2026-01-01",
      endBizDate: "2026-01-31",
      nowBizDate: "2026-02-01",
      recentCoreLookbackDays: 7,
      coreSliceDays: 3,
      userTradeSliceDays: 7,
      coverageByOrgId: new Map([
        [
          "1001",
          coverage(
            "1001",
            {
              "1.2": new Set(),
              "1.3": new Set(),
              "1.6": new Set(),
              "1.7": new Set(),
            },
            {
            },
          ),
        ],
      ]),
      candidateCardIdsByOrgId: new Map([["1001", ["card-1"]]]),
      snapshotAttemptedByOrgId: new Map([["1001", new Set(["1.5", "1.8"])]]),
      maxTasks: 1,
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        priority: "P0_USER_TRADE_CRITICAL",
        endpoint: "1.4",
        startBizDate: "2026-01-01",
        selectedCardIds: ["card-1"],
      }),
    ]);
  });

  it("does not schedule historical tasks for current-only endpoints once today's snapshot was attempted", () => {
    const tasks = buildNightlyPriorityBackfillTasks({
      stores: [store("1001", "义乌店")],
      startBizDate: "2026-01-01",
      endBizDate: "2026-01-03",
      nowBizDate: "2026-01-04",
      snapshotBizDate: "2026-01-04",
      coverageByOrgId: new Map([
        [
          "1001",
          coverage(
            "1001",
            {
              "1.2": new Set(["2026-01-01", "2026-01-02", "2026-01-03"]),
              "1.3": new Set(["2026-01-01", "2026-01-02", "2026-01-03"]),
              "1.6": new Set(["2026-01-01", "2026-01-02", "2026-01-03"]),
              "1.7": new Set(["2026-01-01", "2026-01-02", "2026-01-03"]),
            },
            {
              "1.1": new Set(["2026-01-01", "2026-01-02", "2026-01-03"]),
              "1.4": new Set(["2026-01-01", "2026-01-02", "2026-01-03"]),
            },
          ),
        ],
      ]),
      snapshotAttemptedByOrgId: new Map([["1001", new Set(["1.5", "1.8"])]]),
      candidateCardIdsByOrgId: new Map([["1001", []]]),
    });

    expect(tasks.map((task) => task.endpoint)).not.toContain("1.5");
    expect(tasks.map((task) => task.endpoint)).not.toContain("1.8");
  });

  it("caps selected user-trade cards and builds an exclusive sync plan for each task", () => {
    const tasks = buildNightlyPriorityBackfillTasks({
      stores: [store("1001", "义乌店")],
      startBizDate: "2026-01-01",
      endBizDate: "2026-01-07",
      nowBizDate: "2026-01-08",
      coverageByOrgId: new Map([
        [
          "1001",
          coverage(
            "1001",
            {
              "1.2": new Set(Array.from({ length: 7 }, (_value, index) => shiftBizDate("2026-01-01", index))),
              "1.3": new Set(Array.from({ length: 7 }, (_value, index) => shiftBizDate("2026-01-01", index))),
              "1.6": new Set(Array.from({ length: 7 }, (_value, index) => shiftBizDate("2026-01-01", index))),
              "1.7": new Set(Array.from({ length: 7 }, (_value, index) => shiftBizDate("2026-01-01", index))),
            },
            {
              "1.1": new Set(Array.from({ length: 7 }, (_value, index) => shiftBizDate("2026-01-01", index))),
            },
          ),
        ],
      ]),
      candidateCardIdsByOrgId: new Map([
        ["1001", ["card-1", "card-2", "card-3", "card-4", "card-5"]],
      ]),
      maxUserTradeCardsPerTask: 2,
      snapshotAttemptedByOrgId: new Map([["1001", new Set(["1.5", "1.8"])]]),
    });

    const userTradeTask = tasks.find((task) => task.endpoint === "1.4");
    expect(userTradeTask?.selectedCardIds).toEqual(["card-1", "card-2"]);

    const syncPlan = resolveNightlyPriorityTaskSyncPlan(userTradeTask!, "03:00");
    expect(syncPlan).toMatchObject({
      mode: "backfill",
      selectedCardIds: ["card-1", "card-2"],
      skipEndpoints: ["1.1", "1.2", "1.3", "1.5", "1.6", "1.7", "1.8"],
      windowOverride: {
        startTime: "2026-01-01 03:00:00",
        endTime: "2026-01-08 02:59:59",
      },
    });
  });

  it("summarizes task counts by priority and endpoint for operator progress checks", () => {
    const summary = summarizeNightlyPriorityBackfillPlan([
      {
        priority: "P0_RECENT_CORE",
        endpoint: "1.2",
        orgId: "1001",
        storeName: "义乌店",
        startBizDate: "2026-01-01",
        endBizDate: "2026-01-03",
      },
      {
        priority: "P0_USER_TRADE_CRITICAL",
        endpoint: "1.4",
        orgId: "1001",
        storeName: "义乌店",
        startBizDate: "2026-01-01",
        endBizDate: "2026-01-07",
      },
    ]);

    expect(summary).toEqual({
      totalTasks: 2,
      byPriority: {
        P0_RECENT_CORE: 1,
        P0_USER_TRADE_CRITICAL: 1,
      },
      byEndpoint: {
        "1.2": 1,
        "1.4": 1,
      },
    });
  });

  it("continues after the configured window only when the upstream probe succeeds", () => {
    const now = new Date("2026-05-13T04:00:30+08:00");
    const deadline = new Date("2026-05-13T04:00:00+08:00");

    expect(
      resolvePostWindowBackfillDeadline({
        now,
        deadline,
        probeOk: false,
        continuationMinutes: 60,
      }),
    ).toEqual({
      shouldContinue: false,
      deadline,
      reason: "post_window_probe_failed",
    });

    const decision = resolvePostWindowBackfillDeadline({
      now,
      deadline,
      probeOk: true,
      continuationMinutes: 60,
    });

    expect(decision).toEqual({
      shouldContinue: true,
      deadline: new Date("2026-05-13T05:00:30+08:00"),
      reason: "post_window_probe_confirmed",
    });
  });

  it("builds a task-aware post-window probe for the first pending endpoint", () => {
    expect(
      resolveNightlyPriorityProbeSpec(
        {
          priority: "P0_USER_TRADE_CRITICAL",
          endpoint: "1.4",
          orgId: "1001",
          storeName: "迎宾店",
          startBizDate: "2025-10-01",
          endBizDate: "2025-10-02",
          selectedCardIds: ["card-001", "card-002"],
        },
        "03:00",
      ),
    ).toEqual({
      endpoint: "1.4",
      orgId: "1001",
      storeName: "迎宾店",
      request: {
        OrgId: "1001",
        Stime: "2025-10-01 03:00:00",
        Etime: "2025-10-02 02:59:59",
        Id: "card-001",
        Type: 1,
      },
    });

    expect(
      resolveNightlyPriorityProbeSpec(
        {
          priority: "P3_SNAPSHOT",
          endpoint: "1.5",
          orgId: "1001",
          storeName: "迎宾店",
          startBizDate: "2026-05-13",
          endBizDate: "2026-05-13",
        },
        "03:00",
      ),
    ).toEqual({
      endpoint: "1.5",
      orgId: "1001",
      storeName: "迎宾店",
      request: {
        OrgId: "1001",
      },
    });
  });

  it("keeps non-1.4 tasks available after the window when 1.4 is closed but other endpoints are open", () => {
    const tasks = [
      {
        priority: "P0_USER_TRADE_CRITICAL",
        endpoint: "1.4",
        orgId: "1001",
        storeName: "迎宾店",
        startBizDate: "2025-10-01",
        endBizDate: "2025-10-02",
      },
      {
        priority: "P0_RECENT_CORE",
        endpoint: "1.2",
        orgId: "1001",
        storeName: "迎宾店",
        startBizDate: "2026-05-01",
        endBizDate: "2026-05-01",
      },
      {
        priority: "P1_HISTORICAL_CORE",
        endpoint: "1.6",
        orgId: "1001",
        storeName: "迎宾店",
        startBizDate: "2026-01-01",
        endBizDate: "2026-01-01",
      },
    ] as const;

    expect(
      filterNightlyPriorityTasksByAvailableEndpoints(tasks, new Set(["1.2", "1.6"])),
    ).toEqual([tasks[1], tasks[2]]);
  });

  it("can exclude 1.4 so daytime backfill uses the remaining open endpoints", () => {
    const tasks = [
      {
        priority: "P0_USER_TRADE_CRITICAL",
        endpoint: "1.4",
        orgId: "1001",
        storeName: "迎宾店",
        startBizDate: "2025-10-01",
        endBizDate: "2025-10-02",
      },
      {
        priority: "P0_RECENT_CORE",
        endpoint: "1.2",
        orgId: "1001",
        storeName: "迎宾店",
        startBizDate: "2026-05-01",
        endBizDate: "2026-05-01",
      },
      {
        priority: "P1_HISTORICAL_CORE",
        endpoint: "1.6",
        orgId: "1001",
        storeName: "迎宾店",
        startBizDate: "2026-01-01",
        endBizDate: "2026-01-01",
      },
    ] as const;

    expect(filterNightlyPriorityTasksByExcludedEndpoints(tasks, new Set(["1.4"]))).toEqual([
      tasks[1],
      tasks[2],
    ]);
  });

  it("applies excluded endpoints before maxTasks so 1.4 does not starve daytime backfill", () => {
    const tasks = buildNightlyPriorityBackfillTasks({
      stores: [store("1001", "义乌店")],
      startBizDate: "2026-01-01",
      endBizDate: "2026-01-31",
      nowBizDate: "2026-02-01",
      recentCoreLookbackDays: 7,
      coreSliceDays: 3,
      userTradeSliceDays: 7,
      coverageByOrgId: new Map([
        [
          "1001",
          coverage("1001", {
            "1.2": new Set(),
            "1.3": new Set(),
            "1.6": new Set(),
            "1.7": new Set(),
          }),
        ],
      ]),
      candidateCardIdsByOrgId: new Map([["1001", ["card-1"]]]),
      snapshotAttemptedByOrgId: new Map([["1001", new Set(["1.5", "1.8"])]]),
      excludedEndpoints: ["1.4"],
      maxTasks: 2,
    });

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.endpoint)).not.toContain("1.4");
    expect(tasks[0]).toMatchObject({
      priority: "P0_RECENT_CORE",
      endpoint: "1.2",
    });
  });
});
