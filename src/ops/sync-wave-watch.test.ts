import { describe, expect, it } from "vitest";

import {
  buildRunningSyncWaveRows,
  decideSyncWaveWatchAction,
} from "./sync-wave-watch.js";

describe("sync-wave-watch", () => {
  it("marks the wave complete when no running rows remain", () => {
    const rows = buildRunningSyncWaveRows([], new Date("2026-04-17T04:20:00.000Z"));

    expect(
      decideSyncWaveWatchAction({
        rows,
        maxAgeMinutes: 30,
        restartCount: 0,
        maxRestarts: 1,
      }),
    ).toEqual({
      action: "complete",
      summary: "no running sync waves remain",
    });
  });

  it("keeps waiting while the oldest running wave is still within the safe threshold", () => {
    const rows = buildRunningSyncWaveRows(
      [
        {
          syncRunId: "sync-run-1",
          orgId: "1001",
          mode: "daily",
          startedAt: "2026-04-17T04:00:00.000Z",
        },
      ],
      new Date("2026-04-17T04:20:00.000Z"),
    );

    expect(
      decideSyncWaveWatchAction({
        rows,
        maxAgeMinutes: 30,
        restartCount: 0,
        maxRestarts: 1,
      }),
    ).toEqual({
      action: "wait",
      summary: "running 1 | oldestAge=20.0m | latest=2026-04-17T04:00:00.000Z",
    });
  });

  it("requests one controlled restart when a running wave exceeds the safe threshold", () => {
    const rows = buildRunningSyncWaveRows(
      [
        {
          syncRunId: "sync-run-1",
          orgId: "1001",
          mode: "daily",
          startedAt: "2026-04-17T03:20:00.000Z",
        },
      ],
      new Date("2026-04-17T04:00:00.000Z"),
    );

    expect(
      decideSyncWaveWatchAction({
        rows,
        maxAgeMinutes: 30,
        restartCount: 0,
        maxRestarts: 1,
      }),
    ).toEqual({
      action: "restart",
      summary:
        "running 1 | oldestAge=40.0m | latest=2026-04-17T03:20:00.000Z | exceeds 30.0m threshold",
    });
  });

  it("gives up after the restart budget is exhausted and the wave is still over threshold", () => {
    const rows = buildRunningSyncWaveRows(
      [
        {
          syncRunId: "sync-run-1",
          orgId: "1001",
          mode: "daily",
          startedAt: "2026-04-17T03:20:00.000Z",
        },
      ],
      new Date("2026-04-17T04:00:00.000Z"),
    );

    expect(
      decideSyncWaveWatchAction({
        rows,
        maxAgeMinutes: 30,
        restartCount: 1,
        maxRestarts: 1,
      }),
    ).toEqual({
      action: "give_up",
      summary:
        "running 1 | oldestAge=40.0m | latest=2026-04-17T03:20:00.000Z | exceeds 30.0m threshold after 1 restart attempts",
    });
  });
});
