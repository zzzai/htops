import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Pool } from "pg";

import {
  buildRunningSyncWaveRows,
  decideSyncWaveWatchAction,
} from "../src/ops/sync-wave-watch.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";

const execFileAsync = promisify(execFile);

type Args = {
  mode: "daily" | "backfill";
  pollMs: number;
  maxAgeMinutes: number;
  maxRestarts: number;
  restartCooldownMs: number;
  maxRuntimeMinutes: number;
  service: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    mode: "daily",
    pollMs: 60_000,
    maxAgeMinutes: 30,
    maxRestarts: 1,
    restartCooldownMs: 20_000,
    maxRuntimeMinutes: 180,
    service: "htops-scheduled-worker.service",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--mode":
        if (next !== "daily" && next !== "backfill") {
          throw new Error("--mode must be one of: daily, backfill");
        }
        args.mode = next;
        index += 1;
        break;
      case "--poll-ms":
        args.pollMs = parsePositiveInteger(next, "--poll-ms");
        index += 1;
        break;
      case "--max-age-minutes":
        args.maxAgeMinutes = parsePositiveNumber(next, "--max-age-minutes");
        index += 1;
        break;
      case "--max-restarts":
        args.maxRestarts = parseNonNegativeInteger(next, "--max-restarts");
        index += 1;
        break;
      case "--restart-cooldown-ms":
        args.restartCooldownMs = parsePositiveInteger(next, "--restart-cooldown-ms");
        index += 1;
        break;
      case "--max-runtime-minutes":
        args.maxRuntimeMinutes = parsePositiveNumber(next, "--max-runtime-minutes");
        index += 1;
        break;
      case "--service":
        if (!next?.trim()) {
          throw new Error("--service requires a value");
        }
        args.service = next.trim();
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return args;
}

function parsePositiveInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, flag: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveNumber(value: string | undefined, flag: string): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[sync-wave-watch] ${new Date().toISOString()} ${message}`);
}

async function listRunningSyncRows(pool: Pool, mode: "daily" | "backfill", now: Date) {
  const result = await pool.query(
    `
      SELECT sync_run_id, org_id, mode, started_at
      FROM sync_runs
      WHERE status = 'running'
        AND mode = $1
      ORDER BY started_at DESC, sync_run_id DESC
    `,
    [mode],
  );
  return buildRunningSyncWaveRows(
    result.rows.map((row: Record<string, unknown>) => ({
      syncRunId: String(row.sync_run_id),
      orgId: String(row.org_id),
      mode: String(row.mode),
      startedAt: String(row.started_at),
    })),
    now,
  );
}

async function restartService(service: string): Promise<void> {
  log(`restarting ${service}`);
  await execFileAsync("systemctl", ["restart", service]);
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const config = await loadStandaloneHetangConfig();
  const pool = new Pool({
    connectionString: config.database.syncUrl ?? config.database.url,
    max: 1,
  });
  const deadlineAtMs = Date.now() + args.maxRuntimeMinutes * 60_000;
  let restartCount = 0;

  try {
    for (;;) {
      const now = new Date();
      const rows = await listRunningSyncRows(pool, args.mode, now);
      const decision = decideSyncWaveWatchAction({
        rows,
        maxAgeMinutes: args.maxAgeMinutes,
        restartCount,
        maxRestarts: args.maxRestarts,
      });

      if (decision.action === "complete") {
        log(decision.summary);
        return;
      }

      if (decision.action === "restart") {
        log(decision.summary);
        await restartService(args.service);
        restartCount += 1;
        await sleep(args.restartCooldownMs);
        continue;
      }

      if (decision.action === "give_up") {
        throw new Error(decision.summary);
      }

      log(decision.summary);
      if (Date.now() >= deadlineAtMs) {
        throw new Error(
          `watchdog exceeded ${args.maxRuntimeMinutes.toFixed(1)}m max runtime while waiting`,
        );
      }
      await sleep(args.pollMs);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[sync-wave-watch] ${new Date().toISOString()} ${message}`);
  process.exitCode = 1;
});
