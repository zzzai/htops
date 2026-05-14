import { Pool } from "pg";
import { HetangApiClient } from "../src/client.js";
import { loadStandaloneHetangConfig, loadStandaloneRuntimeEnv } from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import { syncHetangStore } from "../src/sync.js";
import {
  buildNightlyPriorityBackfillTasks,
  filterNightlyPriorityTasksByExcludedEndpoints,
  filterNightlyPriorityTasksByAvailableEndpoints,
  resolvePostWindowBackfillDeadline,
  resolveNightlyPriorityProbeSpec,
  resolveNightlyPriorityTaskSyncPlan,
  summarizeNightlyPriorityBackfillPlan,
  type NightlyPriorityBackfillCoverage,
  type NightlyPriorityProbeSpec,
  type NightlyPriorityBackfillTask,
} from "../src/nightly-priority-backfill.js";
import {
  buildProjectDataCoverageProgressState,
  buildProjectDataCoverageReport,
  formatProjectDataCoverageProgressLine,
  parseProjectDataCoverageProgressState,
} from "../src/project-data-coverage.js";
import {
  resolveLocalDate,
  resolveOperationalBizDateFromTimestamp,
  resolveReportBizDate,
  shiftBizDate,
} from "../src/time.js";
import type { EndpointCode, HetangOpsConfig, HetangStoreConfig } from "../src/types.js";

const SCHEDULED_SYNC_RUNNER_ADVISORY_LOCK_KEY = 42_060_407;
const DEFAULT_START_BIZ_DATE = "2025-10-01";
const DEFAULT_DEADLINE_LOCAL_TIME = "03:56";
const DEFAULT_MAX_TASKS = 24;
const DEFAULT_TASK_GAP_MS = 12_000;
const DEFAULT_STORE_GAP_MS = 30_000;
const DEFAULT_LOCK_WAIT_MS = 10_000;
const DEFAULT_POST_WINDOW_CONTINUATION_MINUTES = 60;
const DEFAULT_RECENT_CORE_LOOKBACK_DAYS = 30;
const DEFAULT_CORE_SLICE_DAYS = 7;
const DEFAULT_MEMBER_SLICE_DAYS = 7;
const DEFAULT_USER_TRADE_SLICE_DAYS = 7;
const DEFAULT_MAX_USER_TRADE_CARDS_PER_TASK = 6;
const FACT_TABLE_BY_ENDPOINT: Partial<Record<EndpointCode, string>> = {
  "1.2": "fact_consume_bills",
  "1.3": "fact_recharge_bills",
  "1.4": "fact_user_trades",
  "1.6": "fact_tech_up_clock",
  "1.7": "fact_tech_market",
};
const RAW_ATTEMPT_ENDPOINTS: EndpointCode[] = ["1.1", "1.4"];
const SNAPSHOT_ENDPOINTS: EndpointCode[] = ["1.5", "1.8"];
const POST_WINDOW_PROBE_ENDPOINTS: EndpointCode[] = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"];

type Params = {
  startBizDate: string;
  endBizDate?: string;
  orgIds?: string[];
  maxTasks: number;
  dryRun: boolean;
  deadlineLocalTime: string;
  taskGapMs: number;
  storeGapMs: number;
  lockWaitMs: number;
  postWindowContinuationMinutes: number;
  recentCoreLookbackDays: number;
  coreSliceDays: number;
  memberSliceDays: number;
  userTradeSliceDays: number;
  maxUserTradeCardsPerTask: number;
  skipLock: boolean;
  excludedEndpoints: EndpointCode[];
};

function parseArgs(argv: string[]): Params {
  const params: Params = {
    startBizDate: process.env.HETANG_PRIORITY_BACKFILL_START_BIZ_DATE ?? DEFAULT_START_BIZ_DATE,
    endBizDate: process.env.HETANG_PRIORITY_BACKFILL_END_BIZ_DATE,
    orgIds: undefined,
    maxTasks: parsePositiveIntEnv("HETANG_PRIORITY_BACKFILL_MAX_TASKS", DEFAULT_MAX_TASKS),
    dryRun: false,
    deadlineLocalTime:
      process.env.HETANG_PRIORITY_BACKFILL_DEADLINE_LOCAL_TIME ?? DEFAULT_DEADLINE_LOCAL_TIME,
    taskGapMs: parsePositiveIntEnv("HETANG_PRIORITY_BACKFILL_TASK_GAP_MS", DEFAULT_TASK_GAP_MS),
    storeGapMs: parsePositiveIntEnv("HETANG_PRIORITY_BACKFILL_STORE_GAP_MS", DEFAULT_STORE_GAP_MS),
    lockWaitMs: parsePositiveIntEnv("HETANG_PRIORITY_BACKFILL_LOCK_WAIT_MS", DEFAULT_LOCK_WAIT_MS),
    postWindowContinuationMinutes: parsePositiveIntEnv(
      "HETANG_PRIORITY_BACKFILL_POST_WINDOW_CONTINUATION_MINUTES",
      DEFAULT_POST_WINDOW_CONTINUATION_MINUTES,
    ),
    recentCoreLookbackDays: parsePositiveIntEnv(
      "HETANG_PRIORITY_BACKFILL_RECENT_CORE_LOOKBACK_DAYS",
      DEFAULT_RECENT_CORE_LOOKBACK_DAYS,
    ),
    coreSliceDays: parsePositiveIntEnv(
      "HETANG_PRIORITY_BACKFILL_CORE_SLICE_DAYS",
      DEFAULT_CORE_SLICE_DAYS,
    ),
    memberSliceDays: parsePositiveIntEnv(
      "HETANG_PRIORITY_BACKFILL_MEMBER_SLICE_DAYS",
      DEFAULT_MEMBER_SLICE_DAYS,
    ),
    userTradeSliceDays: parsePositiveIntEnv(
      "HETANG_PRIORITY_BACKFILL_USER_TRADE_SLICE_DAYS",
      DEFAULT_USER_TRADE_SLICE_DAYS,
    ),
    maxUserTradeCardsPerTask: parsePositiveIntEnv(
      "HETANG_PRIORITY_BACKFILL_MAX_USER_TRADE_CARDS_PER_TASK",
      DEFAULT_MAX_USER_TRADE_CARDS_PER_TASK,
    ),
    skipLock: process.env.HETANG_PRIORITY_BACKFILL_SKIP_LOCK === "1",
    excludedEndpoints: parseEndpointListEnv("HETANG_PRIORITY_BACKFILL_EXCLUDE_ENDPOINTS"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    const next = () => {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${token} requires a value`);
      }
      index += 1;
      return value;
    };
    if (token === "--start") {
      params.startBizDate = next();
    } else if (token === "--end") {
      params.endBizDate = next();
    } else if (token === "--org") {
      params.orgIds = [...(params.orgIds ?? []), next()];
    } else if (token === "--max-tasks") {
      params.maxTasks = parsePositiveInt(next(), token);
    } else if (token === "--deadline-local-time") {
      params.deadlineLocalTime = next();
    } else if (token === "--task-gap-ms") {
      params.taskGapMs = parsePositiveInt(next(), token);
    } else if (token === "--store-gap-ms") {
      params.storeGapMs = parsePositiveInt(next(), token);
    } else if (token === "--lock-wait-ms") {
      params.lockWaitMs = parsePositiveInt(next(), token);
    } else if (token === "--post-window-continuation-minutes") {
      params.postWindowContinuationMinutes = parsePositiveInt(next(), token);
    } else if (token === "--recent-core-lookback-days") {
      params.recentCoreLookbackDays = parsePositiveInt(next(), token);
    } else if (token === "--core-slice-days") {
      params.coreSliceDays = parsePositiveInt(next(), token);
    } else if (token === "--member-slice-days") {
      params.memberSliceDays = parsePositiveInt(next(), token);
    } else if (token === "--user-trade-slice-days") {
      params.userTradeSliceDays = parsePositiveInt(next(), token);
    } else if (token === "--max-user-trade-cards-per-task") {
      params.maxUserTradeCardsPerTask = parsePositiveInt(next(), token);
    } else if (token === "--exclude-endpoint") {
      params.excludedEndpoints = [...params.excludedEndpoints, parseEndpointCode(next(), token)];
    } else if (token === "--dry-run") {
      params.dryRun = true;
    } else if (token === "--skip-lock") {
      params.skipLock = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  assertBizDate(params.startBizDate, "--start");
  if (params.endBizDate) {
    assertBizDate(params.endBizDate, "--end");
    if (params.startBizDate > params.endBizDate) {
      throw new Error("--start must be on or before --end");
    }
  }
  if (!/^\d{2}:\d{2}$/u.test(params.deadlineLocalTime)) {
    throw new Error("--deadline-local-time must be HH:mm");
  }

  return params;
}

function assertBizDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  return parsePositiveInt(value, name);
}

function parsePositiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseEndpointCode(value: string, label: string): EndpointCode {
  if (
    value !== "1.1" &&
    value !== "1.2" &&
    value !== "1.3" &&
    value !== "1.4" &&
    value !== "1.5" &&
    value !== "1.6" &&
    value !== "1.7" &&
    value !== "1.8"
  ) {
    throw new Error(`${label} must be one of: 1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8`);
  }
  return value;
}

function parseEndpointListEnv(name: string): EndpointCode[] {
  const value = process.env[name];
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => parseEndpointCode(entry, name));
}

function logJson(event: string, payload: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...payload }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDeadline(params: {
  now: Date;
  timeZone: string;
  localTime: string;
}): Date {
  const localDate = resolveLocalDate(params.now, params.timeZone);
  const offset = params.timeZone === "Asia/Shanghai" ? "+08:00" : "";
  return new Date(`${localDate}T${params.localTime}:00${offset}`);
}

async function probeUpstreamAvailability(params: {
  config: HetangOpsConfig;
  spec: NightlyPriorityProbeSpec | null;
}): Promise<{ ok: boolean; endpoint: EndpointCode; rowCount?: number; elapsedMs: number; error?: string }> {
  const startedAt = Date.now();
  if (!params.spec) {
    return {
      ok: false,
      endpoint: "1.1",
      elapsedMs: Date.now() - startedAt,
      error: "no pending task for probe",
    };
  }
  const client = new HetangApiClient(params.config.api);
  try {
    const rows = await fetchProbeRows(client, params.spec);
    return {
      ok: true,
      endpoint: params.spec.endpoint,
      rowCount: rows.length,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: params.spec.endpoint,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeAvailableEndpoints(params: {
  config: HetangOpsConfig;
  tasks: NightlyPriorityBackfillTask[];
  cutoffLocalTime: string;
}): Promise<{
  availableEndpoints: Set<EndpointCode>;
  probes: Array<{
    ok: boolean;
    endpoint: EndpointCode;
    orgId?: string;
    storeName?: string;
    rowCount?: number;
    elapsedMs: number;
    error?: string;
  }>;
}> {
  const sampleTaskByEndpoint = new Map<EndpointCode, NightlyPriorityBackfillTask>();
  for (const task of params.tasks) {
    if (!sampleTaskByEndpoint.has(task.endpoint)) {
      sampleTaskByEndpoint.set(task.endpoint, task);
    }
  }

  const availableEndpoints = new Set<EndpointCode>();
  const probes = [];
  for (const endpoint of POST_WINDOW_PROBE_ENDPOINTS) {
    const task = sampleTaskByEndpoint.get(endpoint);
    if (!task) {
      continue;
    }
    const spec = resolveNightlyPriorityProbeSpec(task, params.cutoffLocalTime);
    const probe = await probeUpstreamAvailability({ config: params.config, spec });
    probes.push({
      ...probe,
      orgId: spec.orgId,
      storeName: spec.storeName,
    });
    if (probe.ok) {
      availableEndpoints.add(endpoint);
    }
  }
  return { availableEndpoints, probes };
}

async function fetchProbeRows(
  client: HetangApiClient,
  spec: NightlyPriorityProbeSpec,
): Promise<unknown[]> {
  if (spec.endpoint === "1.1" || spec.endpoint === "1.2" || spec.endpoint === "1.3") {
    return await client.fetchPaged(spec.endpoint, spec.request);
  }
  if (spec.endpoint === "1.4") {
    return await client.fetchUserTrades(spec.request);
  }
  if (spec.endpoint === "1.5") {
    return await client.fetchTechList(spec.request);
  }
  if (spec.endpoint === "1.6") {
    return await client.fetchTechUpClockList(spec.request);
  }
  if (spec.endpoint === "1.7") {
    return await client.fetchTechMarketList(spec.request);
  }
  return await client.fetchTechCommissionSetList(spec.request);
}

function addBizDateRange(target: Set<string>, startBizDate: string, endBizDate: string): void {
  let cursor = startBizDate;
  while (cursor <= endBizDate) {
    target.add(cursor);
    cursor = shiftBizDate(cursor, 1);
  }
}

function parseRequestCoverageWindow(params: {
  requestJson: string;
  timeZone: string;
  cutoffLocalTime: string;
  rangeStartBizDate: string;
  rangeEndBizDate: string;
}): { startBizDate: string; endBizDate: string } | null {
  let request: Record<string, unknown>;
  try {
    const parsed = JSON.parse(params.requestJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    request = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const stime = typeof request.Stime === "string" ? request.Stime : undefined;
  const etime = typeof request.Etime === "string" ? request.Etime : undefined;
  if (!stime || !etime) {
    return null;
  }
  const startBizDate = resolveOperationalBizDateFromTimestamp(
    stime,
    params.timeZone,
    params.cutoffLocalTime,
  );
  const endBizDate = resolveOperationalBizDateFromTimestamp(
    etime,
    params.timeZone,
    params.cutoffLocalTime,
  );
  const clampedStart = startBizDate > params.rangeStartBizDate ? startBizDate : params.rangeStartBizDate;
  const clampedEnd = endBizDate < params.rangeEndBizDate ? endBizDate : params.rangeEndBizDate;
  return clampedStart <= clampedEnd
    ? { startBizDate: clampedStart, endBizDate: clampedEnd }
    : null;
}

async function loadCoreFactCoverage(params: {
  pool: Pool;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
}): Promise<Partial<Record<EndpointCode, Set<string>>>> {
  const entries = Object.entries(FACT_TABLE_BY_ENDPOINT) as Array<[EndpointCode, string]>;
  const unionSql = entries
    .map(
      ([endpoint, tableName]) => `
        SELECT '${endpoint}'::text AS endpoint, biz_date
        FROM ${tableName}
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
      `,
    )
    .join(" UNION ALL ");
  const result = await params.pool.query(
    `
      SELECT endpoint, biz_date
      FROM (${unionSql}) AS coverage
      GROUP BY endpoint, biz_date
    `,
    [params.orgId, params.startBizDate, params.endBizDate],
  );
  const coverage: Partial<Record<EndpointCode, Set<string>>> = {};
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const endpoint = String(row.endpoint) as EndpointCode;
    const bizDate = typeof row.biz_date === "string" ? row.biz_date : undefined;
    if (!bizDate) {
      continue;
    }
    coverage[endpoint] ??= new Set<string>();
    coverage[endpoint]?.add(bizDate);
  }
  return coverage;
}

async function loadRawAttemptCoverage(params: {
  pool: Pool;
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  timeZone: string;
  cutoffLocalTime: string;
}): Promise<Partial<Record<EndpointCode, Set<string>>>> {
  const result = await params.pool.query(
    `
      SELECT endpoint, request_json
      FROM raw_api_batches
      WHERE org_id = $1
        AND endpoint = ANY($2::text[])
        AND request_json IS NOT NULL
        AND request_json <> ''
    `,
    [params.orgId, RAW_ATTEMPT_ENDPOINTS],
  );
  const coverage: Partial<Record<EndpointCode, Set<string>>> = {};
  for (const row of result.rows as Array<Record<string, unknown>>) {
    const endpoint = String(row.endpoint) as EndpointCode;
    const requestJson = typeof row.request_json === "string" ? row.request_json : undefined;
    if (!requestJson) {
      continue;
    }
    const window = parseRequestCoverageWindow({
      requestJson,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime,
      rangeStartBizDate: params.startBizDate,
      rangeEndBizDate: params.endBizDate,
    });
    if (!window) {
      continue;
    }
    coverage[endpoint] ??= new Set<string>();
    addBizDateRange(coverage[endpoint]!, window.startBizDate, window.endBizDate);
  }
  return coverage;
}

async function loadSnapshotAttempts(params: {
  pool: Pool;
  orgId: string;
  localDate: string;
  timeZone: string;
}): Promise<Set<EndpointCode>> {
  const localDayStart =
    params.timeZone === "Asia/Shanghai"
      ? new Date(`${params.localDate}T00:00:00+08:00`).toISOString()
      : `${params.localDate}T00:00:00.000Z`;
  const result = await params.pool.query(
    `
      SELECT DISTINCT endpoint
      FROM raw_api_batches
      WHERE org_id = $1
        AND endpoint = ANY($2::text[])
        AND fetched_at >= $3
    `,
    [params.orgId, SNAPSHOT_ENDPOINTS, localDayStart],
  );
  return new Set(
    (result.rows as Array<Record<string, unknown>>).map((row) => String(row.endpoint) as EndpointCode),
  );
}

async function buildCoverageInputs(params: {
  pool: Pool;
  store: HetangOpsStore;
  config: HetangOpsConfig;
  stores: HetangStoreConfig[];
  startBizDate: string;
  endBizDate: string;
  snapshotBizDate: string;
  maxUserTradeCardsPerTask: number;
}): Promise<{
  coverageByOrgId: Map<string, NightlyPriorityBackfillCoverage>;
  snapshotAttemptedByOrgId: Map<string, Set<EndpointCode>>;
  candidateCardIdsByOrgId: Map<string, string[]>;
}> {
  const coverageByOrgId = new Map<string, NightlyPriorityBackfillCoverage>();
  const snapshotAttemptedByOrgId = new Map<string, Set<EndpointCode>>();
  const candidateCardIdsByOrgId = new Map<string, string[]>();
  for (const storeConfig of params.stores) {
    const [rawFacts, rawAttempts, snapshotAttempts, candidateCardIds, allCardIds] = await Promise.all([
      loadCoreFactCoverage({
        pool: params.pool,
        orgId: storeConfig.orgId,
        startBizDate: params.startBizDate,
        endBizDate: params.endBizDate,
      }),
      loadRawAttemptCoverage({
        pool: params.pool,
        orgId: storeConfig.orgId,
        startBizDate: params.startBizDate,
        endBizDate: params.endBizDate,
        timeZone: params.config.timeZone,
        cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
      }),
      loadSnapshotAttempts({
        pool: params.pool,
        orgId: storeConfig.orgId,
        localDate: params.snapshotBizDate,
        timeZone: params.config.timeZone,
      }),
      params.store.listRecentUserTradeCandidateCardIds({
        orgId: storeConfig.orgId,
        startBizDate: params.startBizDate,
        endBizDate: params.endBizDate,
      }),
      params.store.listMemberCardIds(storeConfig.orgId),
    ]);
    coverageByOrgId.set(storeConfig.orgId, {
      orgId: storeConfig.orgId,
      rawFacts,
      rawAttempts,
    });
    snapshotAttemptedByOrgId.set(storeConfig.orgId, snapshotAttempts);
    const userTradeCardCandidates = candidateCardIds.length > 0 ? candidateCardIds : allCardIds;
    candidateCardIdsByOrgId.set(
      storeConfig.orgId,
      userTradeCardCandidates.slice(0, params.maxUserTradeCardsPerTask),
    );
  }
  return {
    coverageByOrgId,
    snapshotAttemptedByOrgId,
    candidateCardIdsByOrgId,
  };
}

async function acquireScheduledSyncLock(params: {
  store: HetangOpsStore;
  deadline: Date;
  waitMs: number;
  dryRun: boolean;
  skipLock: boolean;
}): Promise<boolean> {
  if (params.skipLock || params.dryRun) {
    return false;
  }
  while (new Date().getTime() < params.deadline.getTime()) {
    const acquired = await params.store.tryAdvisoryLock(SCHEDULED_SYNC_RUNNER_ADVISORY_LOCK_KEY);
    if (acquired) {
      return true;
    }
    logJson("nightly-priority-backfill-lock-wait", {
      lockKey: SCHEDULED_SYNC_RUNNER_ADVISORY_LOCK_KEY,
      waitMs: params.waitMs,
      dryRun: params.dryRun,
    });
    await sleep(Math.min(params.waitMs, Math.max(0, params.deadline.getTime() - Date.now())));
  }
  throw new Error("deadline reached while waiting for scheduled sync lock");
}

async function executeTask(params: {
  config: HetangOpsConfig;
  store: HetangOpsStore;
  task: NightlyPriorityBackfillTask;
  dryRun: boolean;
}): Promise<void> {
  const syncPlan = resolveNightlyPriorityTaskSyncPlan(
    params.task,
    params.config.sync.businessDayCutoffLocalTime,
  );
  logJson("nightly-priority-backfill-task-start", {
    priority: params.task.priority,
    orgId: params.task.orgId,
    storeName: params.task.storeName,
    endpoint: params.task.endpoint,
    startBizDate: params.task.startBizDate,
    endBizDate: params.task.endBizDate,
    selectedCardCount: params.task.selectedCardIds?.length ?? 0,
    dryRun: params.dryRun,
  });
  if (params.dryRun) {
    return;
  }
  const startedAt = new Date().toISOString();
  await syncHetangStore({
    config: params.config,
    store: params.store,
    orgId: params.task.orgId,
    now: new Date(),
    logger: {
      info: (message) => console.log(message),
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
      debug: () => {},
    },
    sleep,
    syncPlan,
    publishAnalytics: false,
  });
  const latestRun = await params.store.getLatestSyncRun({
    orgId: params.task.orgId,
    mode: syncPlan.mode ?? "daily",
    startedAtOrAfter: startedAt,
  });
  if (latestRun && latestRun.status !== "success") {
    const details = latestRun.detailsJson ? ` ${latestRun.detailsJson}` : "";
    throw new Error(`sync task ended with ${latestRun.status}${details}`);
  }
}

async function persistProjectDataCoverageProgress(params: {
  config: HetangOpsConfig;
  store: HetangOpsStore;
  stores: HetangStoreConfig[];
  startBizDate: string;
  endBizDate: string;
  checkedAt: string;
  dryRun: boolean;
}): Promise<void> {
  const snapshots = await Promise.all(
    params.stores.map((storeConfig) =>
      params.store.getHistoricalCoverageSnapshot({
        orgId: storeConfig.orgId,
        startBizDate: params.startBizDate,
        endBizDate: params.endBizDate,
      }),
    ),
  );
  const report = buildProjectDataCoverageReport({
    startBizDate: params.startBizDate,
    endBizDate: params.endBizDate,
    stores: params.stores.map((entry) => ({
      orgId: entry.orgId,
      storeName: entry.storeName,
    })),
    snapshots,
  });
  const previousState = parseProjectDataCoverageProgressState(
    await params.store.getScheduledJobState("project-data-coverage", "latest-progress"),
  );
  const progress = buildProjectDataCoverageProgressState({
    report,
    previousState,
    checkedAt: params.checkedAt,
    focusMetricKey: "1.4",
  });
  logJson("project-data-coverage-progress", {
    focusMetricKey: progress.focusMetricKey,
    focusCoveredDays: progress.focusCoveredDays,
    focusExpectedDays: progress.focusExpectedDays,
    focusCoverageRate: progress.focusCoverageRate,
    noProgressNightCount: progress.noProgressNightCount,
    status: progress.status,
    dryRun: params.dryRun,
  });
  console.log(formatProjectDataCoverageProgressLine(progress));
  if (!params.dryRun) {
    await params.store.setScheduledJobState(
      "project-data-coverage",
      "latest-progress",
      progress as unknown as Record<string, unknown>,
      params.checkedAt,
    );
  }
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const options = parseArgs(process.argv.slice(2));
  const config = await loadStandaloneHetangConfig();
  const now = new Date();
  const endBizDate =
    options.endBizDate ??
    resolveReportBizDate({
      now,
      timeZone: config.timeZone,
      cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
    });
  const deadline = resolveDeadline({
    now,
    timeZone: config.timeZone,
    localTime: options.deadlineLocalTime,
  });
  const selectedOrgIds = options.orgIds ? new Set(options.orgIds) : null;
  const stores = config.stores.filter(
    (storeConfig) =>
      storeConfig.isActive && (!selectedOrgIds || selectedOrgIds.has(storeConfig.orgId)),
  );
  let effectiveDeadline = deadline;
  const pool = new Pool({
    connectionString: config.database.syncUrl ?? config.database.url,
    allowExitOnIdle: true,
    max: Math.max(1, Math.min(config.database.syncPoolMax, 2)),
  });
  const store = new HetangOpsStore({
    pool,
    stores: config.stores.map((entry) => ({
      orgId: entry.orgId,
      storeName: entry.storeName,
      rawAliases: entry.rawAliases,
    })),
    deadLetterEnabled: config.queue.deadLetterEnabled,
  });
  await store.initialize();
  let lockAcquired = false;

  try {
    if (stores.length === 0) {
      throw new Error("No active stores selected");
    }
    const snapshotBizDate = resolveLocalDate(now, config.timeZone);
    const coverageInputs = await buildCoverageInputs({
      pool,
      store,
      config,
      stores,
      startBizDate: options.startBizDate,
      endBizDate,
      snapshotBizDate,
      maxUserTradeCardsPerTask: options.maxUserTradeCardsPerTask,
    });
    let tasks = buildNightlyPriorityBackfillTasks({
      stores,
      startBizDate: options.startBizDate,
      endBizDate,
      nowBizDate: endBizDate,
      recentCoreLookbackDays: options.recentCoreLookbackDays,
      coreSliceDays: options.coreSliceDays,
      memberSliceDays: options.memberSliceDays,
      userTradeSliceDays: options.userTradeSliceDays,
      snapshotBizDate,
      maxUserTradeCardsPerTask: options.maxUserTradeCardsPerTask,
      maxTasks: options.maxTasks,
      excludedEndpoints: options.excludedEndpoints,
      ...coverageInputs,
    });
    tasks = filterNightlyPriorityTasksByExcludedEndpoints(
      tasks,
      new Set(options.excludedEndpoints),
    );
    if (!options.dryRun && now.getTime() >= deadline.getTime()) {
      const probeResult = await probeAvailableEndpoints({
        config,
        tasks,
        cutoffLocalTime: config.sync.businessDayCutoffLocalTime,
      });
      const decision = resolvePostWindowBackfillDeadline({
        now,
        deadline,
        probeOk: probeResult.availableEndpoints.size > 0,
        continuationMinutes: options.postWindowContinuationMinutes,
      });
      tasks = filterNightlyPriorityTasksByAvailableEndpoints(tasks, probeResult.availableEndpoints);
      effectiveDeadline = decision.deadline;
      logJson("nightly-priority-backfill-post-window-probe", {
        ok: probeResult.availableEndpoints.size > 0,
        availableEndpoints: Array.from(probeResult.availableEndpoints),
        probes: probeResult.probes,
        decision: decision.reason,
        effectiveDeadline: effectiveDeadline.toISOString(),
      });
      if (!decision.shouldContinue) {
        await recordExpiredRun({
          config,
          store,
          pool,
          now,
          options,
          deadline,
          reason: decision.reason,
        });
        return;
      }
    }
    const summary = summarizeNightlyPriorityBackfillPlan(tasks);
    if (!options.dryRun) {
      await store.setScheduledJobState(
        "nightly-priority-backfill",
        "latest-plan",
        {
          plannedAt: now.toISOString(),
          startBizDate: options.startBizDate,
          endBizDate,
          deadlineLocalTime: options.deadlineLocalTime,
          effectiveDeadline: effectiveDeadline.toISOString(),
          excludedEndpoints: options.excludedEndpoints,
          dryRun: options.dryRun,
          ...summary,
        },
        now.toISOString(),
      );
    }
    logJson("nightly-priority-backfill-plan", {
      startBizDate: options.startBizDate,
      endBizDate,
      deadlineLocalTime: options.deadlineLocalTime,
      effectiveDeadline: effectiveDeadline.toISOString(),
      excludedEndpoints: options.excludedEndpoints,
      dryRun: options.dryRun,
      ...summary,
    });

    lockAcquired = await acquireScheduledSyncLock({
      store,
      deadline: effectiveDeadline,
      waitMs: options.lockWaitMs,
      dryRun: options.dryRun,
      skipLock: options.skipLock,
    });

    let executedCount = 0;
    let skippedByDeadlineCount = 0;
    const errors: Array<Record<string, unknown>> = [];
    for (const [index, task] of tasks.entries()) {
      if (!options.dryRun && new Date().getTime() >= effectiveDeadline.getTime()) {
        skippedByDeadlineCount = tasks.length - index;
        break;
      }
      try {
        await executeTask({ config, store, task, dryRun: options.dryRun });
        executedCount += 1;
        logJson("nightly-priority-backfill-task-complete", {
          priority: task.priority,
          orgId: task.orgId,
          storeName: task.storeName,
          endpoint: task.endpoint,
          startBizDate: task.startBizDate,
          endBizDate: task.endBizDate,
          executedCount,
          totalTasks: tasks.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({
          priority: task.priority,
          orgId: task.orgId,
          endpoint: task.endpoint,
          startBizDate: task.startBizDate,
          endBizDate: task.endBizDate,
          message,
        });
        logJson("nightly-priority-backfill-task-error", {
          priority: task.priority,
          orgId: task.orgId,
          storeName: task.storeName,
          endpoint: task.endpoint,
          startBizDate: task.startBizDate,
          endBizDate: task.endBizDate,
          message,
        });
      }
      if (!options.dryRun && index < tasks.length - 1) {
        const nextTask = tasks[index + 1]!;
        await sleep(nextTask.orgId === task.orgId ? options.taskGapMs : options.storeGapMs);
      }
    }

    const finishedAt = new Date().toISOString();
    await persistProjectDataCoverageProgress({
      config,
      store,
      stores,
      startBizDate: options.startBizDate,
      endBizDate,
      checkedAt: finishedAt,
      dryRun: options.dryRun,
    });
    if (!options.dryRun) {
      await store.setScheduledJobState(
        "nightly-priority-backfill",
        "latest-run",
        {
          startedAt: now.toISOString(),
          finishedAt,
          startBizDate: options.startBizDate,
          endBizDate,
          deadlineLocalTime: options.deadlineLocalTime,
          effectiveDeadline: effectiveDeadline.toISOString(),
          totalTasks: tasks.length,
          executedCount,
          skippedByDeadlineCount,
          errors,
          dryRun: options.dryRun,
        },
        finishedAt,
      );
    }
    logJson("nightly-priority-backfill-complete", {
      totalTasks: tasks.length,
      executedCount,
      skippedByDeadlineCount,
      errorCount: errors.length,
      dryRun: options.dryRun,
    });
    if (errors.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (lockAcquired) {
      await store.releaseAdvisoryLock(SCHEDULED_SYNC_RUNNER_ADVISORY_LOCK_KEY);
    }
    await store.close();
    await pool.end();
  }
}

async function recordExpiredRun(params: {
  config: HetangOpsConfig;
  store?: HetangOpsStore;
  pool?: Pool;
  now: Date;
  options: Params;
  deadline: Date;
  reason?: string;
}): Promise<void> {
  const ownsStore = !params.store;
  const pool =
    params.pool ??
    new Pool({
      connectionString: params.config.database.syncUrl ?? params.config.database.url,
      allowExitOnIdle: true,
      max: 1,
    });
  const store =
    params.store ??
    new HetangOpsStore({
      pool,
      stores: params.config.stores.map((entry) => ({
        orgId: entry.orgId,
        storeName: entry.storeName,
        rawAliases: entry.rawAliases,
      })),
      deadLetterEnabled: params.config.queue.deadLetterEnabled,
    });
  try {
    if (ownsStore) {
      await store.initialize();
    }
    const finishedAt = new Date().toISOString();
    await store.setScheduledJobState(
      "nightly-priority-backfill",
      "latest-expired-run",
      {
        startedAt: params.now.toISOString(),
        finishedAt,
        startBizDate: params.options.startBizDate,
        endBizDate: params.options.endBizDate,
        deadlineLocalTime: params.options.deadlineLocalTime,
        deadlineAt: params.deadline.toISOString(),
        excludedEndpoints: params.options.excludedEndpoints,
        dryRun: params.options.dryRun,
        reason: params.reason ?? "deadline_already_passed",
      },
      finishedAt,
    );
    logJson("nightly-priority-backfill-expired", {
      startBizDate: params.options.startBizDate,
      endBizDate: params.options.endBizDate,
      deadlineLocalTime: params.options.deadlineLocalTime,
      deadlineAt: params.deadline.toISOString(),
      excludedEndpoints: params.options.excludedEndpoints,
      dryRun: params.options.dryRun,
      reason: params.reason ?? "deadline_already_passed",
    });
  } finally {
    if (ownsStore) {
      await store.close();
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "nightly-priority-backfill-failed",
      at: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});
