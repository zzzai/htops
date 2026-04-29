export type SyncWaveWatchRow = {
  syncRunId: string;
  orgId: string;
  mode: string;
  startedAt: string;
  ageMinutes: number;
};

export type SyncWaveWatchDecision = {
  action: "complete" | "wait" | "restart" | "give_up";
  summary: string;
};

export function buildRunningSyncWaveRows(
  rows: Array<{
    syncRunId: string;
    orgId: string;
    mode: string;
    startedAt: string;
  }>,
  now: Date,
): SyncWaveWatchRow[] {
  return rows
    .map((row) => {
      const startedAtMs = Date.parse(row.startedAt);
      const ageMinutes =
        Number.isFinite(startedAtMs) && startedAtMs <= now.getTime()
          ? (now.getTime() - startedAtMs) / 60_000
          : 0;
      return {
        ...row,
        ageMinutes: roundMinutes(ageMinutes),
      };
    })
    .sort(
      (left, right) =>
        right.startedAt.localeCompare(left.startedAt) || left.syncRunId.localeCompare(right.syncRunId),
    );
}

export function decideSyncWaveWatchAction(params: {
  rows: SyncWaveWatchRow[];
  maxAgeMinutes: number;
  restartCount: number;
  maxRestarts: number;
}): SyncWaveWatchDecision {
  if (params.rows.length === 0) {
    return {
      action: "complete",
      summary: "no running sync waves remain",
    };
  }

  const latest = params.rows[0]!;
  const oldestAgeMinutes = Math.max(...params.rows.map((row) => row.ageMinutes));
  const baseSummary = [
    `running ${params.rows.length}`,
    `oldestAge=${oldestAgeMinutes.toFixed(1)}m`,
    `latest=${latest.startedAt}`,
  ].join(" | ");

  if (oldestAgeMinutes <= params.maxAgeMinutes) {
    return {
      action: "wait",
      summary: baseSummary,
    };
  }

  if (params.restartCount < params.maxRestarts) {
    return {
      action: "restart",
      summary: `${baseSummary} | exceeds ${params.maxAgeMinutes.toFixed(1)}m threshold`,
    };
  }

  return {
    action: "give_up",
    summary: `${baseSummary} | exceeds ${params.maxAgeMinutes.toFixed(1)}m threshold after ${params.restartCount} restart attempts`,
  };
}

function roundMinutes(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
