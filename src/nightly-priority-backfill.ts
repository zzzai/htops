import { resolveOperationalBizDateRangeWindow, shiftBizDate } from "./time.js";
import type { EndpointCode, HetangStoreConfig } from "./types.js";
import type { HetangSyncPlan } from "./sync.js";

export type NightlyPriorityBackfillPriority =
  | "P0_RECENT_CORE"
  | "P0_USER_TRADE_CRITICAL"
  | "P1_HISTORICAL_CORE"
  | "P2_MEMBER"
  | "P3_SNAPSHOT"
  | "P4_USER_TRADE";

export type NightlyPriorityBackfillTask = {
  priority: NightlyPriorityBackfillPriority;
  endpoint: EndpointCode;
  orgId: string;
  storeName: string;
  startBizDate: string;
  endBizDate: string;
  selectedCardIds?: string[];
};

export type NightlyPriorityBackfillCoverage = {
  orgId: string;
  rawFacts: Partial<Record<EndpointCode, Set<string>>>;
  rawAttempts?: Partial<Record<EndpointCode, Set<string>>>;
};

export type NightlyPriorityBackfillSummary = {
  totalTasks: number;
  byPriority: Partial<Record<NightlyPriorityBackfillPriority, number>>;
  byEndpoint: Partial<Record<EndpointCode, number>>;
};

export type NightlyPriorityProbeSpec = {
  endpoint: EndpointCode;
  orgId: string;
  storeName: string;
  request: Record<string, unknown>;
};

export type PostWindowBackfillDeadlineDecision = {
  shouldContinue: boolean;
  deadline: Date;
  reason: "within_window" | "post_window_probe_confirmed" | "post_window_probe_failed";
};

export type BuildNightlyPriorityBackfillTasksParams = {
  stores: HetangStoreConfig[];
  startBizDate: string;
  endBizDate: string;
  nowBizDate: string;
  coverageByOrgId: Map<string, NightlyPriorityBackfillCoverage>;
  rawAttemptCoverageByOrgId?: Map<string, Partial<Record<EndpointCode, Set<string>>>>;
  snapshotAttemptedByOrgId?: Map<string, Set<EndpointCode>>;
  candidateCardIdsByOrgId?: Map<string, string[]>;
  recentCoreLookbackDays?: number;
  coreSliceDays?: number;
  memberSliceDays?: number;
  userTradeSliceDays?: number;
  snapshotBizDate?: string;
  maxUserTradeCardsPerTask?: number;
  maxTasks?: number;
  excludedEndpoints?: EndpointCode[];
};

const CORE_FACT_ENDPOINTS: EndpointCode[] = ["1.2", "1.3", "1.6", "1.7"];
const CURRENT_ONLY_ENDPOINTS: EndpointCode[] = ["1.5", "1.8"];
const ALL_ENDPOINTS: EndpointCode[] = [
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.5",
  "1.6",
  "1.7",
  "1.8",
];

const DEFAULT_RECENT_CORE_LOOKBACK_DAYS = 30;
const DEFAULT_CORE_SLICE_DAYS = 7;
const DEFAULT_MEMBER_SLICE_DAYS = 7;
const DEFAULT_USER_TRADE_SLICE_DAYS = 7;
const DEFAULT_MAX_USER_TRADE_CARDS_PER_TASK = 6;

export function resolvePostWindowBackfillDeadline(params: {
  now: Date;
  deadline: Date;
  probeOk: boolean;
  continuationMinutes: number;
}): PostWindowBackfillDeadlineDecision {
  if (params.now.getTime() < params.deadline.getTime()) {
    return {
      shouldContinue: true,
      deadline: params.deadline,
      reason: "within_window",
    };
  }
  if (!params.probeOk) {
    return {
      shouldContinue: false,
      deadline: params.deadline,
      reason: "post_window_probe_failed",
    };
  }
  return {
    shouldContinue: true,
    deadline: new Date(params.now.getTime() + Math.max(1, params.continuationMinutes) * 60_000),
    reason: "post_window_probe_confirmed",
  };
}

function maxBizDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function minBizDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function listMissingRanges(params: {
  startBizDate: string;
  endBizDate: string;
  presentDays?: Set<string>;
}): Array<{ startBizDate: string; endBizDate: string }> {
  const ranges: Array<{ startBizDate: string; endBizDate: string }> = [];
  let cursor = params.startBizDate;
  let openStart: string | null = null;
  let previousMissing: string | null = null;

  while (cursor <= params.endBizDate) {
    if (params.presentDays?.has(cursor)) {
      if (openStart && previousMissing) {
        ranges.push({ startBizDate: openStart, endBizDate: previousMissing });
      }
      openStart = null;
      previousMissing = null;
    } else {
      openStart ??= cursor;
      previousMissing = cursor;
    }
    cursor = shiftBizDate(cursor, 1);
  }

  if (openStart && previousMissing) {
    ranges.push({ startBizDate: openStart, endBizDate: previousMissing });
  }

  return ranges;
}

function sliceRanges(
  ranges: Array<{ startBizDate: string; endBizDate: string }>,
  sliceDays: number,
): Array<{ startBizDate: string; endBizDate: string }> {
  const sliced: Array<{ startBizDate: string; endBizDate: string }> = [];
  for (const range of ranges) {
    let cursor = range.startBizDate;
    while (cursor <= range.endBizDate) {
      const endBizDate = minBizDate(shiftBizDate(cursor, sliceDays - 1), range.endBizDate);
      sliced.push({ startBizDate: cursor, endBizDate });
      cursor = shiftBizDate(endBizDate, 1);
    }
  }
  return sliced;
}

function addEndpointGapTasks(params: {
  tasks: NightlyPriorityBackfillTask[];
  priority: NightlyPriorityBackfillPriority;
  store: HetangStoreConfig;
  endpoint: EndpointCode;
  startBizDate: string;
  endBizDate: string;
  presentDays?: Set<string>;
  sliceDays: number;
  selectedCardIds?: string[];
}): void {
  if (params.startBizDate > params.endBizDate) {
    return;
  }
  const missingRanges = listMissingRanges({
    startBizDate: params.startBizDate,
    endBizDate: params.endBizDate,
    presentDays: params.presentDays,
  });
  for (const range of sliceRanges(missingRanges, params.sliceDays)) {
    params.tasks.push({
      priority: params.priority,
      endpoint: params.endpoint,
      orgId: params.store.orgId,
      storeName: params.store.storeName,
      startBizDate: range.startBizDate,
      endBizDate: range.endBizDate,
      selectedCardIds: params.selectedCardIds,
    });
  }
}

function resolveRawAttemptDays(params: {
  coverage?: NightlyPriorityBackfillCoverage;
  rawAttemptCoverageByOrgId?: Map<string, Partial<Record<EndpointCode, Set<string>>>>;
  orgId: string;
  endpoint: EndpointCode;
}): Set<string> | undefined {
  return (
    params.rawAttemptCoverageByOrgId?.get(params.orgId)?.[params.endpoint] ??
    params.coverage?.rawAttempts?.[params.endpoint]
  );
}

export function buildNightlyPriorityBackfillTasks(
  params: BuildNightlyPriorityBackfillTasksParams,
): NightlyPriorityBackfillTask[] {
  const coreSliceDays = normalizePositiveInteger(params.coreSliceDays, DEFAULT_CORE_SLICE_DAYS);
  const memberSliceDays = normalizePositiveInteger(
    params.memberSliceDays,
    DEFAULT_MEMBER_SLICE_DAYS,
  );
  const userTradeSliceDays = normalizePositiveInteger(
    params.userTradeSliceDays,
    DEFAULT_USER_TRADE_SLICE_DAYS,
  );
  const recentCoreLookbackDays = normalizePositiveInteger(
    params.recentCoreLookbackDays,
    DEFAULT_RECENT_CORE_LOOKBACK_DAYS,
  );
  const snapshotBizDate = params.snapshotBizDate ?? params.nowBizDate;
  const maxUserTradeCardsPerTask = normalizePositiveInteger(
    params.maxUserTradeCardsPerTask,
    DEFAULT_MAX_USER_TRADE_CARDS_PER_TASK,
  );
  const recentStartBizDate = maxBizDate(
    params.startBizDate,
    shiftBizDate(params.endBizDate, -(recentCoreLookbackDays - 1)),
  );
  const historicalEndBizDate = shiftBizDate(recentStartBizDate, -1);
  const activeStores = params.stores.filter((store) => store.isActive);
  const excludedEndpoints = new Set(params.excludedEndpoints ?? []);
  const tasks: NightlyPriorityBackfillTask[] = [];

  if (!excludedEndpoints.has("1.4")) {
    for (const store of activeStores) {
      const coverage = params.coverageByOrgId.get(store.orgId);
      const selectedCardIds = Array.from(
        new Set(
          (params.candidateCardIdsByOrgId?.get(store.orgId) ?? [])
            .map((cardId) => String(cardId ?? "").trim())
            .filter((cardId) => cardId.length > 0),
        ),
      ).slice(0, maxUserTradeCardsPerTask);
      if (selectedCardIds.length === 0) {
        continue;
      }
      addEndpointGapTasks({
        tasks,
        priority: "P0_USER_TRADE_CRITICAL",
        store,
        endpoint: "1.4",
        startBizDate: params.startBizDate,
        endBizDate: params.endBizDate,
        presentDays: coverage?.rawFacts["1.4"],
        sliceDays: userTradeSliceDays,
        selectedCardIds,
      });
    }
  }

  for (const store of activeStores) {
    const coverage = params.coverageByOrgId.get(store.orgId);
    for (const endpoint of CORE_FACT_ENDPOINTS) {
      if (excludedEndpoints.has(endpoint)) {
        continue;
      }
      addEndpointGapTasks({
        tasks,
        priority: "P0_RECENT_CORE",
        store,
        endpoint,
        startBizDate: recentStartBizDate,
        endBizDate: params.endBizDate,
        presentDays: coverage?.rawFacts[endpoint],
        sliceDays: coreSliceDays,
      });
    }
  }

  for (const store of activeStores) {
    const coverage = params.coverageByOrgId.get(store.orgId);
    for (const endpoint of CORE_FACT_ENDPOINTS) {
      if (excludedEndpoints.has(endpoint)) {
        continue;
      }
      addEndpointGapTasks({
        tasks,
        priority: "P1_HISTORICAL_CORE",
        store,
        endpoint,
        startBizDate: params.startBizDate,
        endBizDate: historicalEndBizDate,
        presentDays: coverage?.rawFacts[endpoint],
        sliceDays: coreSliceDays,
      });
    }
  }

  for (const store of activeStores) {
    if (excludedEndpoints.has("1.1")) {
      continue;
    }
    const coverage = params.coverageByOrgId.get(store.orgId);
    addEndpointGapTasks({
      tasks,
      priority: "P2_MEMBER",
      store,
      endpoint: "1.1",
      startBizDate: params.startBizDate,
      endBizDate: params.endBizDate,
      presentDays: resolveRawAttemptDays({
        coverage,
        rawAttemptCoverageByOrgId: params.rawAttemptCoverageByOrgId,
        orgId: store.orgId,
        endpoint: "1.1",
      }),
      sliceDays: memberSliceDays,
    });
  }

  for (const store of activeStores) {
    const attempted = params.snapshotAttemptedByOrgId?.get(store.orgId) ?? new Set<EndpointCode>();
    for (const endpoint of CURRENT_ONLY_ENDPOINTS) {
      if (attempted.has(endpoint) || excludedEndpoints.has(endpoint)) {
        continue;
      }
      tasks.push({
        priority: "P3_SNAPSHOT",
        endpoint,
        orgId: store.orgId,
        storeName: store.storeName,
        startBizDate: snapshotBizDate,
        endBizDate: snapshotBizDate,
      });
    }
  }

  return typeof params.maxTasks === "number" && Number.isFinite(params.maxTasks)
    ? tasks.slice(0, Math.max(0, Math.floor(params.maxTasks)))
    : tasks;
}

export function resolveNightlyPriorityTaskSyncPlan(
  task: NightlyPriorityBackfillTask,
  cutoffLocalTime: string,
): HetangSyncPlan {
  const skipEndpoints = ALL_ENDPOINTS.filter((endpoint) => endpoint !== task.endpoint);
  if (task.endpoint === "1.5" || task.endpoint === "1.8") {
    return {
      mode: "daily",
      skipEndpoints,
      selectedCardIds: task.selectedCardIds,
    };
  }
  return {
    mode: "backfill",
    windowOverride: resolveOperationalBizDateRangeWindow({
      startBizDate: task.startBizDate,
      endBizDate: task.endBizDate,
      cutoffLocalTime,
    }),
    skipEndpoints,
    selectedCardIds: task.selectedCardIds,
  };
}

export function resolveNightlyPriorityProbeSpec(
  task: NightlyPriorityBackfillTask,
  cutoffLocalTime: string,
): NightlyPriorityProbeSpec {
  const window =
    task.endpoint === "1.5" || task.endpoint === "1.8"
      ? undefined
      : resolveOperationalBizDateRangeWindow({
          startBizDate: task.startBizDate,
          endBizDate: task.startBizDate,
          cutoffLocalTime,
        });
  const baseRequest: Record<string, unknown> = {
    OrgId: task.orgId,
  };
  if (window) {
    baseRequest.Stime = window.startTime;
    baseRequest.Etime = window.endTime;
  }
  if (task.endpoint === "1.4") {
    baseRequest.Id = task.selectedCardIds?.[0] ?? "";
    baseRequest.Type = 1;
  } else if (task.endpoint === "1.6" || task.endpoint === "1.7") {
    baseRequest.Code = "";
  }
  return {
    endpoint: task.endpoint,
    orgId: task.orgId,
    storeName: task.storeName,
    request: baseRequest,
  };
}

export function filterNightlyPriorityTasksByAvailableEndpoints<
  T extends Pick<NightlyPriorityBackfillTask, "endpoint">,
>(tasks: readonly T[], availableEndpoints: ReadonlySet<EndpointCode>): T[] {
  return tasks.filter((task) => availableEndpoints.has(task.endpoint));
}

export function filterNightlyPriorityTasksByExcludedEndpoints<
  T extends Pick<NightlyPriorityBackfillTask, "endpoint">,
>(tasks: readonly T[], excludedEndpoints: ReadonlySet<EndpointCode>): T[] {
  if (excludedEndpoints.size <= 0) {
    return [...tasks];
  }
  return tasks.filter((task) => !excludedEndpoints.has(task.endpoint));
}

export function summarizeNightlyPriorityBackfillPlan(
  tasks: NightlyPriorityBackfillTask[],
): NightlyPriorityBackfillSummary {
  const summary: NightlyPriorityBackfillSummary = {
    totalTasks: tasks.length,
    byPriority: {},
    byEndpoint: {},
  };
  for (const task of tasks) {
    summary.byPriority[task.priority] = (summary.byPriority[task.priority] ?? 0) + 1;
    summary.byEndpoint[task.endpoint] = (summary.byEndpoint[task.endpoint] ?? 0) + 1;
  }
  return summary;
}
