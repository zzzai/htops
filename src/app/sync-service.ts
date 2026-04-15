import { HetangApiClient } from "../client.js";
import { getStoreByOrgId } from "../config.js";
import { rebuildMemberDailySnapshotsForDateRange } from "../customer-history-backfill.js";
import { rebuildCustomerIntelligenceForDateRange } from "../customer-intelligence.js";
import { resolveHistoryCatchupOrgIds, resolveHistoryCatchupRange } from "../history-catchup.js";
import { rebuildMemberReactivationFeaturesForDateRange } from "../reactivation-features.js";
import { rebuildMemberReactivationQueueForDateRange } from "../reactivation-queue.js";
import { rebuildMemberReactivationStrategiesForDateRange } from "../reactivation-strategy.js";
import { HetangOpsStore } from "../store.js";
import {
  estimateUserTradeSyncDurationMs,
  syncHetangStore,
  type HetangSyncPlan,
} from "../sync.js";
import {
  resolveLocalDate,
  resolveLocalDayStartIso,
  resolveOperationalBizDateRangeWindow,
  resolveReportBizDate,
  shiftBizDate,
} from "../time.js";
import type {
  EndpointCode,
  HetangClientLike,
  HetangHistoricalCoverageSnapshot,
  HetangLogger,
  HetangOpsConfig,
} from "../types.js";

const STORE_SYNC_GAP_MS = 3_000;
const BACKFILL_WINDOW_GAP_MS = 5_000;
const BACKFILL_SKIP_ENDPOINTS = ["1.5", "1.8"] as const;
const COVERAGE_BACKFILL_ALWAYS_SKIP_ENDPOINTS = ["1.1", "1.5", "1.8"] as const;
const COVERAGE_BACKFILL_FAST_SLICE_DAYS = 21;
const DAILY_SYNC_USER_TRADE_DEFER_CARD_THRESHOLD = 200;
const DAILY_SYNC_USER_TRADE_START_BUFFER_MIN_MS = 15_000;
const DAILY_SYNC_USER_TRADE_START_BUFFER_MAX_MS = 45_000;
const NIGHTLY_SYNC_ENDPOINT_ORDER: EndpointCode[] = ["1.1", "1.2", "1.3", "1.5", "1.6", "1.7", "1.8"];
const NIGHTLY_SYNC_PRIORITY_STORE_MATCHERS = ["迎宾"] as const;
const NIGHTLY_USER_TRADE_LOOKBACK_DAYS = 30;
const NIGHTLY_SYNC_RESERVED_BACKFILL_MS = 10 * 60_000;
const NIGHTLY_SYNC_RESERVED_PROBE_MS = 4 * 60_000;
const NIGHTLY_API_DEPTH_PROBE_JOB_TYPE = "nightly-api-depth-probe";
const NIGHTLY_API_DEPTH_PROBE_STATE_KEY = "latest";
const NIGHTLY_API_DEPTH_PROBE_LOOKBACK_DAYS = [540, 365, 270, 180, 90, 30] as const;
const NIGHTLY_API_DEPTH_PROBE_WINDOW_DAYS = 7;
const NIGHTLY_API_DEPTH_PROBE_MIN_REMAINING_MS = NIGHTLY_SYNC_RESERVED_PROBE_MS;
const NIGHTLY_API_DEPTH_PROBE_REQUEST_GAP_MS = 300;
const ALL_SYNC_ENDPOINTS: EndpointCode[] = [
  "1.1",
  "1.2",
  "1.3",
  "1.4",
  "1.5",
  "1.6",
  "1.7",
  "1.8",
];
const LOCAL_HISTORY_CATCHUP_INTELLIGENCE_CHUNK_DAYS = 14;
const NIGHTLY_HISTORY_BACKFILL_JOB_TYPE = "nightly-history-backfill";
const NIGHTLY_HISTORY_BACKFILL_STATE_KEY = "default";
const FEBRUARY_2026_BACKFILL_RANGE = {
  startBizDate: "2026-02-01",
  endBizDate: "2026-02-28",
} as const;

type NightlyHistoryBackfillStoreCursor = {
  orgId: string;
  nextStartBizDate: string;
  completedAt?: string;
  lastCompletedEndBizDate?: string;
};

type NightlyHistoryBackfillState = {
  anchorStartBizDate: string;
  anchorEndBizDate: string;
  sliceDays: number;
  stores: NightlyHistoryBackfillStoreCursor[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

type CustomerHistoryCatchupState = {
  completedAtByOrgId: Record<string, string>;
  updatedAt: string;
};

type NightlyHistoryBackfillPlan = {
  orgId: string;
  startBizDate: string;
  endBizDate: string;
  skipEndpoints: EndpointCode[];
  selectedCardIds?: string[];
};

type NightlyApiDepthProbeEndpointState = {
  status: "confirmed" | "no-data" | "current-only" | "card-scoped" | "error" | "skipped";
  confirmedLookbackDays?: number;
  windowStartBizDate?: string;
  windowEndBizDate?: string;
  error?: string;
};

type NightlyApiDepthProbeState = {
  probedAt: string;
  orgId: string;
  storeName: string;
  anchorBizDate: string;
  endpoints: Partial<Record<EndpointCode, NightlyApiDepthProbeEndpointState>>;
  summary: string;
};

type BizDateRange = {
  startBizDate: string;
  endBizDate: string;
};

type SyncStoreLike = Pick<
  HetangOpsStore,
  "getScheduledJobState" | "setScheduledJobState" | "publishAnalyticsViews" | "forceRebuildAnalyticsViews"
> & {
  listRecentUserTradeCandidateCardIds?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<string[]>;
  listMemberCardIds?: (orgId: string) => Promise<string[]>;
  getHistoricalCoverageSnapshot?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<HetangHistoricalCoverageSnapshot>;
  getServingPublicationStore?: () => {
    publishAnalyticsViews?: (params?: {
      publishedAt?: string;
      notes?: string;
      servingVersion?: string;
      rebuild?: boolean;
      force?: boolean;
    }) => Promise<string | null>;
    forceRebuildAnalyticsViews?: () => Promise<void>;
  };
};

type NightlyApiDepthProbeClient = Pick<
  HetangClientLike,
  "fetchPaged" | "fetchTechUpClockList" | "fetchTechMarketList"
>;

function summarizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function minBizDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function listBizDates(startBizDate: string, endBizDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(startBizDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(endBizDate)) {
    throw new Error("biz_date must use YYYY-MM-DD format");
  }
  if (startBizDate > endBizDate) {
    throw new Error("startBizDate must be on or before endBizDate");
  }

  const dates: string[] = [];
  for (let cursor = startBizDate; cursor <= endBizDate; cursor = shiftBizDate(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

function listBizDateRanges(
  startBizDate: string,
  endBizDate: string,
  maxDaysPerRange = 7,
): BizDateRange[] {
  const bizDates = listBizDates(startBizDate, endBizDate);
  const ranges: BizDateRange[] = [];
  for (let index = 0; index < bizDates.length; index += maxDaysPerRange) {
    const chunk = bizDates.slice(index, index + maxDaysPerRange);
    if (chunk.length === 0) {
      continue;
    }
    ranges.push({
      startBizDate: chunk[0],
      endBizDate: chunk[chunk.length - 1],
    });
  }
  return ranges;
}

function hasCoverageHelper(store: SyncStoreLike): store is SyncStoreLike & {
  getHistoricalCoverageSnapshot: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<HetangHistoricalCoverageSnapshot>;
} {
  return typeof store.getHistoricalCoverageSnapshot === "function";
}

function spanCoversRange(
  span:
    | {
        minBizDate?: string;
        maxBizDate?: string;
        rowCount: number;
        dayCount?: number;
      }
    | null
    | undefined,
  startBizDate: string,
  endBizDate: string,
): boolean {
  const start = new Date(`${startBizDate}T00:00:00Z`);
  const end = new Date(`${endBizDate}T00:00:00Z`);
  const expectedDayCount = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
  );
  return Boolean(
    span &&
      span.rowCount > 0 &&
      (span.dayCount ?? 0) >= expectedDayCount &&
      typeof span.minBizDate === "string" &&
      typeof span.maxBizDate === "string" &&
      span.minBizDate <= startBizDate &&
      span.maxBizDate >= endBizDate,
  );
}

function resolveCoverageGapStart(
  span:
    | {
        minBizDate?: string;
        maxBizDate?: string;
        rowCount: number;
        dayCount?: number;
        firstMissingBizDate?: string;
      }
    | null
    | undefined,
  startBizDate: string,
  endBizDate: string,
): string | null {
  if (!span || span.rowCount <= 0) {
    return startBizDate;
  }
  if (span.firstMissingBizDate && span.firstMissingBizDate >= startBizDate) {
    return span.firstMissingBizDate <= endBizDate ? span.firstMissingBizDate : null;
  }
  if (!span.minBizDate || span.minBizDate > startBizDate) {
    return startBizDate;
  }
  const start = new Date(`${startBizDate}T00:00:00Z`);
  const end = new Date(`${endBizDate}T00:00:00Z`);
  const expectedDayCount = Math.max(
    0,
    Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1,
  );
  if ((span.dayCount ?? 0) < expectedDayCount) {
    return startBizDate;
  }
  if (span.maxBizDate && span.maxBizDate < endBizDate) {
    return shiftBizDate(span.maxBizDate, 1);
  }
  return null;
}

function formatNightlyApiDepthProbeSummary(params: {
  storeName: string;
  endpoints: Partial<Record<EndpointCode, NightlyApiDepthProbeEndpointState>>;
}): string {
  const orderedEndpoints: EndpointCode[] = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8"];
  const details = orderedEndpoints
    .map((endpoint) => {
      const entry = params.endpoints[endpoint];
      if (!entry) {
        return null;
      }
      if (entry.status === "confirmed") {
        return `${endpoint}>=${entry.confirmedLookbackDays ?? "?"}d`;
      }
      if (entry.status === "current-only") {
        return `${endpoint}=current-only`;
      }
      if (entry.status === "card-scoped") {
        return `${endpoint}=card-scoped`;
      }
      if (entry.status === "no-data") {
        return `${endpoint}=no-data`;
      }
      if (entry.status === "skipped") {
        return `${endpoint}=skipped`;
      }
      return `${endpoint}=error`;
    })
    .filter((value): value is string => Boolean(value));
  return `API历史探针 ${params.storeName}: ${details.join(", ")}`;
}

export class HetangSyncService {
  constructor(
    private readonly deps: {
      config: HetangOpsConfig;
      logger: HetangLogger;
      getStore: () => Promise<HetangOpsStore>;
      resolveNow?: () => Date;
      sleep?: (ms: number) => Promise<void>;
      syncStore?: typeof syncHetangStore;
      createApiClient?: (
        apiConfig: HetangOpsConfig["api"],
      ) => NightlyApiDepthProbeClient;
      markAnalyticsViewsVerified?: () => void;
    },
  ) {}

  private resolveNow(): Date {
    return this.deps.resolveNow?.() ?? new Date();
  }

  private resolveSyncAccessWindowEnd(now: Date): Date {
    const dayStartIso = resolveLocalDayStartIso(now, this.deps.config.timeZone);
    const localDate = resolveLocalDate(now, this.deps.config.timeZone);
    const offset = dayStartIso.match(/(Z|[+-]\d{2}:\d{2})$/u)?.[1] ?? "Z";
    return new Date(`${localDate}T${this.deps.config.sync.accessWindowEndLocalTime}:00${offset}`);
  }

  private resolveNightlySyncPhaseDeadline(now: Date): Date {
    return new Date(
      this.resolveSyncAccessWindowEnd(now).getTime() -
        NIGHTLY_SYNC_RESERVED_BACKFILL_MS -
        NIGHTLY_SYNC_RESERVED_PROBE_MS,
    );
  }

  private resolveNightlyBackfillDeadline(now: Date): Date {
    return new Date(this.resolveSyncAccessWindowEnd(now).getTime() - NIGHTLY_SYNC_RESERVED_PROBE_MS);
  }

  private resolveDynamicUserTradeStartBufferMs(estimatedDurationMs: number): number {
    return clamp(
      Math.round(estimatedDurationMs * 0.2),
      DAILY_SYNC_USER_TRADE_START_BUFFER_MIN_MS,
      DAILY_SYNC_USER_TRADE_START_BUFFER_MAX_MS,
    );
  }

  private async getStore(): Promise<SyncStoreLike> {
    return (await this.deps.getStore()) as SyncStoreLike;
  }

  private resolveServingPublicationStore(store: SyncStoreLike) {
    return typeof store.getServingPublicationStore === "function"
      ? store.getServingPublicationStore()
      : store;
  }

  private markAnalyticsViewsVerified(): void {
    this.deps.markAnalyticsViewsVerified?.();
  }

  private normalizeCustomerHistoryCatchupState(
    rawState: Record<string, unknown> | null,
  ): CustomerHistoryCatchupState {
    const completedAtByOrgId =
      rawState && rawState.completedAtByOrgId && typeof rawState.completedAtByOrgId === "object"
        ? Object.fromEntries(
            Object.entries(rawState.completedAtByOrgId as Record<string, unknown>).filter(
              ([orgId, completedAt]) =>
                typeof orgId === "string" &&
                orgId.trim().length > 0 &&
                typeof completedAt === "string" &&
                completedAt.trim().length > 0,
            ),
          )
        : {};
    const updatedAt =
      rawState && typeof rawState.updatedAt === "string" && rawState.updatedAt.trim().length > 0
        ? rawState.updatedAt
        : new Date().toISOString();
    return {
      completedAtByOrgId: completedAtByOrgId as Record<string, string>,
      updatedAt,
    };
  }

  private async getCustomerHistoryCatchupState(
    store: SyncStoreLike,
    runKey: string,
  ): Promise<CustomerHistoryCatchupState> {
    return this.normalizeCustomerHistoryCatchupState(
      await store.getScheduledJobState("run-customer-history-catchup", runKey),
    );
  }

  private async persistCustomerHistoryCatchupState(
    store: SyncStoreLike,
    runKey: string,
    state: CustomerHistoryCatchupState,
  ): Promise<void> {
    await store.setScheduledJobState(
      "run-customer-history-catchup",
      runKey,
      state as unknown as Record<string, unknown>,
      state.updatedAt,
    );
  }

  private async listCurrentMemberCardCounts(
    store: SyncStoreLike,
    orgIds: string[],
  ): Promise<Map<string, number> | null> {
    if (typeof store.listMemberCardIds !== "function") {
      return null;
    }
    const counts = await Promise.all(
      orgIds.map(async (orgId) => ({
        orgId,
        count: (await store.listMemberCardIds!(orgId)).length,
      })),
    );
    return new Map(counts.map((entry) => [entry.orgId, entry.count]));
  }

  private resolveNightlyStoreOrder(orgIds: string[]): string[] {
    const requestedOrgIds = Array.from(new Set(orgIds));
    const requestedSet = new Set(requestedOrgIds);
    const priorityOrgIds = this.deps.config.stores
      .filter((entry) =>
        NIGHTLY_SYNC_PRIORITY_STORE_MATCHERS.some((matcher) => entry.storeName.includes(matcher)),
      )
      .map((entry) => entry.orgId);
    const configuredOrder = this.deps.config.stores.map((entry) => entry.orgId);
    const prioritizedConfiguredOrder = [
      ...priorityOrgIds,
      ...configuredOrder.filter((orgId) => !priorityOrgIds.includes(orgId)),
    ];
    const orderedOrgIds = prioritizedConfiguredOrder.filter((orgId) => requestedSet.has(orgId));
    const remainingOrgIds = requestedOrgIds.filter((orgId) => !orderedOrgIds.includes(orgId));
    return [...orderedOrgIds, ...remainingOrgIds];
  }

  private buildSkipEndpointsForExclusiveRun(endpoint: EndpointCode): EndpointCode[] {
    return ALL_SYNC_ENDPOINTS.filter((candidate) => candidate !== endpoint);
  }

  private async resolveNightlyUserTradeCandidateCardIds(params: {
    store: SyncStoreLike;
    orgId: string;
    now: Date;
  }): Promise<string[]> {
    const endBizDate = resolveReportBizDate({
      now: params.now,
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const startBizDate = shiftBizDate(endBizDate, -(NIGHTLY_USER_TRADE_LOOKBACK_DAYS - 1));
    if (typeof params.store.listRecentUserTradeCandidateCardIds === "function") {
      return await params.store.listRecentUserTradeCandidateCardIds({
        orgId: params.orgId,
        startBizDate,
        endBizDate,
      });
    }
    if (typeof params.store.listMemberCardIds === "function") {
      return await params.store.listMemberCardIds(params.orgId);
    }
    return [];
  }

  private async runSyncWave(params: {
    store: SyncStoreLike;
    orgIds: string[];
    now: Date;
    syncStore: typeof syncHetangStore;
    sleepImpl: typeof sleep;
    resolveSyncPlan: (
      orgId: string,
    ) => Promise<HetangSyncPlan | null | undefined> | HetangSyncPlan | null | undefined;
  }): Promise<Map<string, string>> {
    const failedOrgErrors = new Map<string, string>();
    const runnableEntries = (
      await Promise.all(
        params.orgIds.map(async (orgId) => ({
          orgId,
          syncPlan: await params.resolveSyncPlan(orgId),
        })),
      )
    ).filter(
      (entry): entry is { orgId: string; syncPlan: HetangSyncPlan | undefined } =>
        entry.syncPlan !== null,
    );

    for (const [index, entry] of runnableEntries.entries()) {
      try {
        await params.syncStore({
          config: this.deps.config,
          store: params.store as unknown as HetangOpsStore,
          orgId: entry.orgId,
          now: params.now,
          logger: this.deps.logger,
          syncPlan: entry.syncPlan ?? undefined,
          publishAnalytics: false,
        });
      } catch (error) {
        const message = summarizeUnknownError(error);
        failedOrgErrors.set(entry.orgId, message);
        const storeConfig = getStoreByOrgId(this.deps.config, entry.orgId);
        this.deps.logger.warn(
          `hetang-ops: store sync failed for ${storeConfig.storeName} (${entry.orgId}): ${message}`,
        );
      }
      if (index < runnableEntries.length - 1) {
        await params.sleepImpl(STORE_SYNC_GAP_MS);
      }
    }
    return failedOrgErrors;
  }

  private async resolveDeferredUserTradeOrgIds(params: {
    store: SyncStoreLike;
    orgIds: string[];
  }): Promise<Set<string>> {
    const counts = await this.listCurrentMemberCardCounts(params.store, params.orgIds);
    if (!counts) {
      return new Set();
    }
    return new Set(
      params.orgIds.filter(
        (orgId) => (counts.get(orgId) ?? 0) > DAILY_SYNC_USER_TRADE_DEFER_CARD_THRESHOLD,
      ),
    );
  }

  private async publishAnalyticsViewsOnce(params: {
    store: SyncStoreLike;
    publishedAt: string;
    notes: string;
  }): Promise<void> {
    const publicationStore = this.resolveServingPublicationStore(params.store);
    if (typeof publicationStore.publishAnalyticsViews !== "function") {
      return;
    }
    await publicationStore.publishAnalyticsViews({
      publishedAt: params.publishedAt,
      notes: params.notes,
    });
    this.markAnalyticsViewsVerified();
  }

  async syncStores(
    params: { orgIds?: string[]; now?: Date; publishAnalytics?: boolean } = {},
  ): Promise<string[]> {
    const store = await this.getStore();
    const orgIds = this.resolveNightlyStoreOrder(
      params.orgIds?.length
        ? params.orgIds
        : this.deps.config.stores.map((entry) => entry.orgId),
    );
    const now = params.now ?? new Date();
    const syncStore = this.deps.syncStore ?? syncHetangStore;
    const sleepImpl = this.deps.sleep ?? sleep;
    const failedOrgErrors = new Map<string, string>();
    let activeOrgIds = [...orgIds];
    const deferredTradeOrgIds = new Set<string>();

    for (const endpoint of NIGHTLY_SYNC_ENDPOINT_ORDER) {
      const phaseFailures = await this.runSyncWave({
        store,
        orgIds: activeOrgIds,
        now,
        syncStore,
        sleepImpl,
        resolveSyncPlan: () => ({
          mode: "daily",
          skipEndpoints: this.buildSkipEndpointsForExclusiveRun(endpoint),
        }),
      });
      for (const [orgId, message] of phaseFailures.entries()) {
        failedOrgErrors.set(orgId, message);
      }
      activeOrgIds = activeOrgIds.filter((orgId) => !failedOrgErrors.has(orgId));
    }

    const syncPhaseDeadlineMs = this.resolveNightlySyncPhaseDeadline(now).getTime();
    const candidateCardIdsByOrgId = new Map<string, string[]>();
    for (const orgId of activeOrgIds) {
      candidateCardIdsByOrgId.set(
        orgId,
        await this.resolveNightlyUserTradeCandidateCardIds({
          store,
          orgId,
          now,
        }),
      );
    }

    const tradeFailures = await this.runSyncWave({
      store,
      orgIds: activeOrgIds,
      now,
      syncStore,
      sleepImpl,
      resolveSyncPlan: (orgId) => {
        const candidateCardIds = candidateCardIdsByOrgId.get(orgId) ?? [];
        if (candidateCardIds.length === 0) {
          return null;
        }
        const remainingMs = syncPhaseDeadlineMs - this.resolveNow().getTime();
        const estimatedDurationMs = estimateUserTradeSyncDurationMs(candidateCardIds.length);
        const startBufferMs = this.resolveDynamicUserTradeStartBufferMs(estimatedDurationMs);
        if (remainingMs < estimatedDurationMs + startBufferMs) {
          deferredTradeOrgIds.add(orgId);
          return null;
        }
        return {
          mode: "daily",
          skipEndpoints: this.buildSkipEndpointsForExclusiveRun("1.4"),
          selectedCardIds: candidateCardIds,
        };
      },
    });
    for (const [orgId, message] of tradeFailures.entries()) {
      failedOrgErrors.set(orgId, message);
    }

    if (params.publishAnalytics !== false) {
      await this.publishAnalyticsViewsOnce({
        store,
        publishedAt: now.toISOString(),
        notes: `nightly-sync:${now.toISOString()}`,
      });
    }

    return orgIds.map((orgId) => {
      const storeConfig = getStoreByOrgId(this.deps.config, orgId);
      const failure = failedOrgErrors.get(orgId);
      if (failure) {
        return `${storeConfig.storeName}: sync failed - ${failure}`;
      }
      return deferredTradeOrgIds.has(orgId)
        ? `${storeConfig.storeName}: sync partial - user trades deferred`
        : `${storeConfig.storeName}: sync complete`;
    });
  }

  private async probeNightlyApiDepthForEndpoint(params: {
    client: NightlyApiDepthProbeClient;
    orgId: string;
    endpoint: "1.1" | "1.2" | "1.3" | "1.6" | "1.7";
    anchorBizDate: string;
    accessWindowEnd: Date;
  }): Promise<NightlyApiDepthProbeEndpointState> {
    const sleepImpl = this.deps.sleep ?? sleep;
    for (const [index, lookbackDays] of NIGHTLY_API_DEPTH_PROBE_LOOKBACK_DAYS.entries()) {
      if (
        params.accessWindowEnd.getTime() - this.resolveNow().getTime() <
        NIGHTLY_API_DEPTH_PROBE_MIN_REMAINING_MS / 2
      ) {
        return { status: "skipped" };
      }
      const startBizDate = shiftBizDate(params.anchorBizDate, -lookbackDays);
      const endBizDate = shiftBizDate(startBizDate, NIGHTLY_API_DEPTH_PROBE_WINDOW_DAYS - 1);
      const window = resolveOperationalBizDateRangeWindow({
        startBizDate,
        endBizDate,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
      try {
        const rows =
          params.endpoint === "1.1" || params.endpoint === "1.2" || params.endpoint === "1.3"
            ? await params.client.fetchPaged(params.endpoint, {
                OrgId: params.orgId,
                Stime: window.startTime,
                Etime: window.endTime,
              })
            : params.endpoint === "1.6"
              ? await params.client.fetchTechUpClockList({
                  OrgId: params.orgId,
                  Code: "",
                  Stime: window.startTime,
                  Etime: window.endTime,
                })
              : await params.client.fetchTechMarketList({
                  OrgId: params.orgId,
                  Code: "",
                  Stime: window.startTime,
                  Etime: window.endTime,
                });
        if (rows.length > 0) {
          return {
            status: "confirmed",
            confirmedLookbackDays: lookbackDays,
            windowStartBizDate: startBizDate,
            windowEndBizDate: endBizDate,
          };
        }
      } catch (error) {
        return {
          status: "error",
          error: summarizeUnknownError(error),
        };
      }
      if (index < NIGHTLY_API_DEPTH_PROBE_LOOKBACK_DAYS.length - 1) {
        await sleepImpl(NIGHTLY_API_DEPTH_PROBE_REQUEST_GAP_MS);
      }
    }
    return { status: "no-data" };
  }

  async runNightlyApiHistoryDepthProbe(now: Date): Promise<string[]> {
    const store = await this.getStore();
    const activeStore = this.deps.config.stores.find((entry) => entry.isActive);
    if (!activeStore) {
      return [];
    }
    const accessWindowEnd = this.resolveSyncAccessWindowEnd(now);
    const remainingMs = accessWindowEnd.getTime() - this.resolveNow().getTime();
    const anchorBizDate = resolveReportBizDate({
      now,
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const endpoints: Partial<Record<EndpointCode, NightlyApiDepthProbeEndpointState>> = {
      "1.4": { status: "card-scoped" },
      "1.5": { status: "current-only" },
      "1.8": { status: "current-only" },
    };

    if (remainingMs < NIGHTLY_API_DEPTH_PROBE_MIN_REMAINING_MS) {
      endpoints["1.1"] = { status: "skipped" };
      endpoints["1.2"] = { status: "skipped" };
      endpoints["1.3"] = { status: "skipped" };
      endpoints["1.6"] = { status: "skipped" };
      endpoints["1.7"] = { status: "skipped" };
      const summary = formatNightlyApiDepthProbeSummary({
        storeName: activeStore.storeName,
        endpoints,
      });
      await store.setScheduledJobState(
        NIGHTLY_API_DEPTH_PROBE_JOB_TYPE,
        NIGHTLY_API_DEPTH_PROBE_STATE_KEY,
        {
          probedAt: now.toISOString(),
          orgId: activeStore.orgId,
          storeName: activeStore.storeName,
          anchorBizDate,
          endpoints,
          summary,
        },
        now.toISOString(),
      );
      return [summary];
    }

    const client =
      this.deps.createApiClient?.(this.deps.config.api) ?? new HetangApiClient(this.deps.config.api);
    for (const endpoint of ["1.1", "1.2", "1.3", "1.6", "1.7"] as const) {
      endpoints[endpoint] = await this.probeNightlyApiDepthForEndpoint({
        client,
        orgId: activeStore.orgId,
        endpoint,
        anchorBizDate,
        accessWindowEnd,
      });
    }

    const summary = formatNightlyApiDepthProbeSummary({
      storeName: activeStore.storeName,
      endpoints,
    });
    const state: NightlyApiDepthProbeState = {
      probedAt: now.toISOString(),
      orgId: activeStore.orgId,
      storeName: activeStore.storeName,
      anchorBizDate,
      endpoints,
      summary,
    };
    await store.setScheduledJobState(
      NIGHTLY_API_DEPTH_PROBE_JOB_TYPE,
      NIGHTLY_API_DEPTH_PROBE_STATE_KEY,
      state as unknown as Record<string, unknown>,
      now.toISOString(),
    );
    return [summary];
  }

  private buildInitialNightlyHistoryBackfillState(now: Date): NightlyHistoryBackfillState {
    const anchorEndBizDate = resolveReportBizDate({
      now,
      timeZone: this.deps.config.timeZone,
      cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
    });
    const anchorStartBizDate = shiftBizDate(
      anchorEndBizDate,
      -(this.deps.config.sync.historyBackfillDays - 1),
    );
    const createdAt = now.toISOString();
    return {
      anchorStartBizDate,
      anchorEndBizDate,
      sliceDays: this.deps.config.sync.historyBackfillSliceDays,
      stores: this.deps.config.stores
        .filter((entry) => entry.isActive)
        .map((entry) => ({
          orgId: entry.orgId,
          nextStartBizDate: anchorStartBizDate,
        })),
      createdAt,
      updatedAt: createdAt,
    };
  }

  private normalizeNightlyHistoryBackfillState(
    raw: Record<string, unknown> | null,
  ): NightlyHistoryBackfillState | null {
    if (!raw) {
      return null;
    }
    const anchorStartBizDate =
      typeof raw.anchorStartBizDate === "string" ? raw.anchorStartBizDate : undefined;
    const anchorEndBizDate =
      typeof raw.anchorEndBizDate === "string" ? raw.anchorEndBizDate : undefined;
    if (!anchorStartBizDate || !anchorEndBizDate) {
      return null;
    }

    const configuredSliceDays = this.deps.config.sync.historyBackfillSliceDays;
    const rawStores = Array.isArray(raw.stores) ? raw.stores : [];
    const rawCursorMap = new Map(
      rawStores
        .filter(
          (entry): entry is Record<string, unknown> =>
            Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
        )
        .map((entry) => [
          typeof entry.orgId === "string" ? entry.orgId : "",
          {
            orgId: typeof entry.orgId === "string" ? entry.orgId : "",
            nextStartBizDate:
              typeof entry.nextStartBizDate === "string"
                ? entry.nextStartBizDate
                : anchorStartBizDate,
            completedAt: typeof entry.completedAt === "string" ? entry.completedAt : undefined,
            lastCompletedEndBizDate:
              typeof entry.lastCompletedEndBizDate === "string"
                ? entry.lastCompletedEndBizDate
                : undefined,
          } satisfies NightlyHistoryBackfillStoreCursor,
        ]),
    );

    return {
      anchorStartBizDate,
      anchorEndBizDate,
      sliceDays:
        typeof raw.sliceDays === "number" && Number.isFinite(raw.sliceDays) && raw.sliceDays > 0
          ? Math.floor(raw.sliceDays)
          : configuredSliceDays,
      stores: this.deps.config.stores
        .filter((entry) => entry.isActive)
        .map(
          (entry) =>
            rawCursorMap.get(entry.orgId) ?? {
              orgId: entry.orgId,
              nextStartBizDate: anchorStartBizDate,
            },
        ),
      createdAt:
        typeof raw.createdAt === "string" && raw.createdAt.trim().length > 0
          ? raw.createdAt
          : new Date().toISOString(),
      updatedAt:
        typeof raw.updatedAt === "string" && raw.updatedAt.trim().length > 0
          ? raw.updatedAt
          : new Date().toISOString(),
      completedAt: typeof raw.completedAt === "string" ? raw.completedAt : undefined,
    };
  }

  private async getNightlyHistoryBackfillState(
    store: SyncStoreLike,
    now: Date,
  ): Promise<NightlyHistoryBackfillState | null> {
    if (!this.deps.config.sync.historyBackfillEnabled) {
      return null;
    }
    const existing = this.normalizeNightlyHistoryBackfillState(
      await store.getScheduledJobState(
        NIGHTLY_HISTORY_BACKFILL_JOB_TYPE,
        NIGHTLY_HISTORY_BACKFILL_STATE_KEY,
      ),
    );
    if (existing) {
      return existing;
    }
    const initial = this.buildInitialNightlyHistoryBackfillState(now);
    await store.setScheduledJobState(
      NIGHTLY_HISTORY_BACKFILL_JOB_TYPE,
      NIGHTLY_HISTORY_BACKFILL_STATE_KEY,
      initial as unknown as Record<string, unknown>,
      initial.updatedAt,
    );
    return initial;
  }

  private async persistNightlyHistoryBackfillState(
    store: SyncStoreLike,
    state: NightlyHistoryBackfillState,
  ): Promise<void> {
    await store.setScheduledJobState(
      NIGHTLY_HISTORY_BACKFILL_JOB_TYPE,
      NIGHTLY_HISTORY_BACKFILL_STATE_KEY,
      state as unknown as Record<string, unknown>,
      state.updatedAt,
    );
  }

  private isNightlyHistoryBackfillPending(state: NightlyHistoryBackfillState): boolean {
    return state.stores.some(
      (entry) => !entry.completedAt && entry.nextStartBizDate <= state.anchorEndBizDate,
    );
  }

  private async buildCoverageAwareNightlyHistoryBackfillPlans(params: {
    store: SyncStoreLike;
    startBizDate: string;
    endBizDate: string;
  }): Promise<NightlyHistoryBackfillPlan[] | null> {
    if (!hasCoverageHelper(params.store)) {
      return null;
    }

    const rawEndpoints: EndpointCode[] = ["1.2", "1.3", "1.4", "1.6", "1.7"];
    const alwaysSkippedEndpoints = new Set<EndpointCode>(COVERAGE_BACKFILL_ALWAYS_SKIP_ENDPOINTS);
    const plans: NightlyHistoryBackfillPlan[] = [];
    const largeStoreDeferredUserTrades = await this.resolveDeferredUserTradeOrgIds({
      store: params.store,
      orgIds: this.deps.config.stores
        .filter((storeEntry) => storeEntry.isActive)
        .map((storeEntry) => storeEntry.orgId),
    });
    const priorityOrgId = this.deps.config.stores.find((storeEntry) => storeEntry.isActive)?.orgId;
    const recentPriorityStartBizDate = shiftBizDate(
      params.endBizDate,
      -(NIGHTLY_USER_TRADE_LOOKBACK_DAYS - 1),
    );
    const clippedRecentPriorityStartBizDate =
      recentPriorityStartBizDate < params.startBizDate
        ? params.startBizDate
        : recentPriorityStartBizDate;

    for (const entry of this.deps.config.stores.filter((storeEntry) => storeEntry.isActive)) {
      const candidateRanges =
        entry.orgId === priorityOrgId
          ? [
              {
                startBizDate: clippedRecentPriorityStartBizDate,
                endBizDate: params.endBizDate,
              },
              {
                startBizDate: params.startBizDate,
                endBizDate: params.endBizDate,
              },
            ]
          : [
              {
                startBizDate: clippedRecentPriorityStartBizDate,
                endBizDate: params.endBizDate,
              },
            ];

      let selectedRange: { startBizDate: string; endBizDate: string } | null = null;
      let selectedSnapshot: HetangHistoricalCoverageSnapshot | null = null;
      let requiredEndpoints: EndpointCode[] = [];
      for (const range of candidateRanges) {
        const snapshot = await params.store.getHistoricalCoverageSnapshot({
          orgId: entry.orgId,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
        });
        const missingEndpoints = rawEndpoints.filter((endpoint) => {
          if (
            endpoint === "1.4" &&
            largeStoreDeferredUserTrades.has(entry.orgId) &&
            range.startBizDate !== clippedRecentPriorityStartBizDate
          ) {
            return false;
          }
          return !spanCoversRange(
            snapshot.rawFacts[endpoint],
            range.startBizDate,
            range.endBizDate,
          );
        });
        if (missingEndpoints.length === 0) {
          continue;
        }
        selectedRange = range;
        selectedSnapshot = snapshot;
        requiredEndpoints = missingEndpoints;
        break;
      }

      if (requiredEndpoints.length === 0 || !selectedSnapshot) {
        continue;
      }

      let selectedCardIds: string[] | undefined;
      if (requiredEndpoints.includes("1.4") && largeStoreDeferredUserTrades.has(entry.orgId)) {
        const candidateCardIds =
          typeof params.store.listRecentUserTradeCandidateCardIds === "function"
            ? await params.store.listRecentUserTradeCandidateCardIds({
                orgId: entry.orgId,
                startBizDate: selectedRange?.startBizDate ?? clippedRecentPriorityStartBizDate,
                endBizDate: selectedRange?.endBizDate ?? params.endBizDate,
              })
            : [];
        const normalizedCandidateCardIds = Array.from(
          new Set(
            candidateCardIds
              .map((cardId) => String(cardId ?? "").trim())
              .filter((cardId) => cardId.length > 0),
          ),
        );
        if (normalizedCandidateCardIds.length === 0) {
          requiredEndpoints = requiredEndpoints.filter((endpoint) => endpoint !== "1.4");
          if (requiredEndpoints.length === 0) {
            continue;
          }
        } else {
          selectedCardIds = normalizedCandidateCardIds;
        }
      }

      const gapStarts = requiredEndpoints
        .map((endpoint) =>
          resolveCoverageGapStart(
            selectedSnapshot.rawFacts[endpoint],
            selectedRange?.startBizDate ?? params.startBizDate,
            selectedRange?.endBizDate ?? params.endBizDate,
          ),
        )
        .filter((value): value is string => typeof value === "string");
      const startBizDate = gapStarts.sort((left, right) => left.localeCompare(right))[0];
      if (!startBizDate) {
        continue;
      }
      const sliceDays = requiredEndpoints.every(
        (endpoint) => endpoint === "1.4" || endpoint === "1.7",
      )
        ? Math.max(
            this.deps.config.sync.historyBackfillSliceDays,
            COVERAGE_BACKFILL_FAST_SLICE_DAYS,
          )
        : this.deps.config.sync.historyBackfillSliceDays;
      const rangeEndBizDate = selectedRange?.endBizDate ?? params.endBizDate;
      const endBizDate = minBizDate(shiftBizDate(startBizDate, sliceDays - 1), rangeEndBizDate);
      const skipEndpoints = ALL_SYNC_ENDPOINTS.filter(
        (endpoint) => alwaysSkippedEndpoints.has(endpoint) || !requiredEndpoints.includes(endpoint),
      );
      plans.push({
        orgId: entry.orgId,
        startBizDate,
        endBizDate,
        skipEndpoints,
        selectedCardIds,
      });
    }

    return plans;
  }

  private async runNightlyHistoryBackfillPass(params: {
    now: Date;
    store: SyncStoreLike;
    state: NightlyHistoryBackfillState;
    publishAnalytics?: boolean;
  }): Promise<string[]> {
    const syncStore = this.deps.syncStore ?? syncHetangStore;
    const sleepImpl = this.deps.sleep ?? sleep;
    const lines: string[] = [];
    const activeStoreOrgIds = this.deps.config.stores
      .filter((entry) => entry.isActive)
      .map((entry) => entry.orgId);
    const pendingStoreOrgIds = activeStoreOrgIds.filter((orgId) => {
      const cursor = params.state.stores.find((entry) => entry.orgId === orgId);
      return Boolean(
        cursor && !cursor.completedAt && cursor.nextStartBizDate <= params.state.anchorEndBizDate,
      );
    });
    let processedStoreCount = 0;

    for (const orgId of activeStoreOrgIds) {
      const cursor = params.state.stores.find((entry) => entry.orgId === orgId);
      if (
        !cursor ||
        cursor.completedAt ||
        cursor.nextStartBizDate > params.state.anchorEndBizDate
      ) {
        continue;
      }

      const startBizDate = cursor.nextStartBizDate;
      const endBizDate = minBizDate(
        shiftBizDate(startBizDate, params.state.sliceDays - 1),
        params.state.anchorEndBizDate,
      );
      await syncStore({
        config: this.deps.config,
        store: params.store as unknown as HetangOpsStore,
        orgId,
        now: params.now,
        logger: this.deps.logger,
        syncPlan: {
          mode: "backfill",
          windowOverride: resolveOperationalBizDateRangeWindow({
            startBizDate,
            endBizDate,
            cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
          }),
          skipEndpoints: [...BACKFILL_SKIP_ENDPOINTS],
        },
        publishAnalytics: false,
      });

      cursor.lastCompletedEndBizDate = endBizDate;
      cursor.nextStartBizDate = shiftBizDate(endBizDate, 1);
      if (cursor.nextStartBizDate > params.state.anchorEndBizDate) {
        cursor.completedAt = params.now.toISOString();
      }
      params.state.updatedAt = params.now.toISOString();
      await this.persistNightlyHistoryBackfillState(params.store, params.state);

      const storeConfig = getStoreByOrgId(this.deps.config, orgId);
      lines.push(
        `${storeConfig.storeName} ${startBizDate}..${endBizDate}: nightly backfill complete`,
      );

      processedStoreCount += 1;
      if (processedStoreCount < pendingStoreOrgIds.length) {
        await sleepImpl(STORE_SYNC_GAP_MS);
      }
    }

    if (!this.isNightlyHistoryBackfillPending(params.state)) {
      params.state.completedAt ??= params.now.toISOString();
      params.state.updatedAt = params.now.toISOString();
      await this.persistNightlyHistoryBackfillState(params.store, params.state);
    }

    if (lines.length > 0 && params.publishAnalytics !== false) {
      await this.publishAnalyticsViewsOnce({
        store: params.store,
        publishedAt: params.now.toISOString(),
        notes: `nightly-history-backfill:${params.now.toISOString()}`,
      });
    }

    return lines;
  }

  async runNightlyHistoryBackfill(
    now: Date,
    options: { publishAnalytics?: boolean } = {},
  ): Promise<string[]> {
    const store = await this.getStore();
    const backfillDeadline = this.resolveNightlyBackfillDeadline(now);
    if (this.deps.config.sync.historyBackfillEnabled && hasCoverageHelper(store)) {
      const sleepImpl = this.deps.sleep ?? sleep;
      const lines: string[] = [];
      const anchorEndBizDate = resolveReportBizDate({
        now,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
      const anchorStartBizDate = shiftBizDate(
        anchorEndBizDate,
        -(this.deps.config.sync.historyBackfillDays - 1),
      );
      const maxPasses = Math.max(
        1,
        Math.ceil(
          this.deps.config.sync.historyBackfillDays /
            this.deps.config.sync.historyBackfillSliceDays,
        ),
      );

      for (let pass = 0; pass < maxPasses; pass += 1) {
        if (this.resolveNow().getTime() >= backfillDeadline.getTime()) {
          break;
        }
        const plans = await this.buildCoverageAwareNightlyHistoryBackfillPlans({
          store,
          startBizDate: anchorStartBizDate,
          endBizDate: anchorEndBizDate,
        });
        if (!plans || plans.length === 0) {
          break;
        }

        const syncStore = this.deps.syncStore ?? syncHetangStore;
        for (const [index, plan] of plans.entries()) {
          await syncStore({
            config: this.deps.config,
            store: store as unknown as HetangOpsStore,
            orgId: plan.orgId,
            now,
            logger: this.deps.logger,
            syncPlan: {
              mode: "backfill",
              windowOverride: resolveOperationalBizDateRangeWindow({
                startBizDate: plan.startBizDate,
                endBizDate: plan.endBizDate,
                cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
              }),
              skipEndpoints: [...plan.skipEndpoints],
              selectedCardIds: plan.selectedCardIds,
            },
            publishAnalytics: false,
          });

          const storeConfig = getStoreByOrgId(this.deps.config, plan.orgId);
          lines.push(
            `${storeConfig.storeName} ${plan.startBizDate}..${plan.endBizDate}: nightly backfill complete`,
          );

          if (index < plans.length - 1) {
            await sleepImpl(STORE_SYNC_GAP_MS);
          }
        }

        if (lines.length > 0 && options.publishAnalytics !== false) {
          await this.publishAnalyticsViewsOnce({
            store,
            publishedAt: now.toISOString(),
            notes: `nightly-history-backfill:${now.toISOString()}:coverage-aware`,
          });
        }

        if (this.resolveNow().getTime() >= backfillDeadline.getTime()) {
          break;
        }
        await sleepImpl(BACKFILL_WINDOW_GAP_MS);
      }

      return lines;
    }

    const state = await this.getNightlyHistoryBackfillState(store, now);
    if (!state || state.completedAt) {
      return [];
    }

    const sleepImpl = this.deps.sleep ?? sleep;
    const lines: string[] = [];
    const maxPasses = Math.max(1, Math.ceil(this.deps.config.sync.historyBackfillDays / state.sliceDays));

    for (let pass = 0; pass < maxPasses; pass += 1) {
      if (!this.isNightlyHistoryBackfillPending(state) || state.completedAt) {
        break;
      }
      if (this.resolveNow().getTime() >= backfillDeadline.getTime()) {
        break;
      }

      const passLines = await this.runNightlyHistoryBackfillPass({
        now,
        store,
        state,
        publishAnalytics: options.publishAnalytics,
      });
      lines.push(...passLines);

      if (
        passLines.length === 0 ||
        !this.isNightlyHistoryBackfillPending(state) ||
        state.completedAt
      ) {
        break;
      }
      if (this.resolveNow().getTime() >= backfillDeadline.getTime()) {
        break;
      }

      await sleepImpl(BACKFILL_WINDOW_GAP_MS);
    }

    return lines;
  }

  async backfillStores(params: {
    orgIds?: string[];
    startBizDate: string;
    endBizDate: string;
    now?: Date;
  }): Promise<string[]> {
    const orgIds = params.orgIds?.length
      ? params.orgIds
      : this.deps.config.stores.map((entry) => entry.orgId);
    const syncStore = this.deps.syncStore ?? syncHetangStore;
    const sleepImpl = this.deps.sleep ?? sleep;
    const now = params.now ?? new Date();
    const bizDateRanges = listBizDateRanges(params.startBizDate, params.endBizDate);
    const lines: string[] = [];
    const store = await this.getStore();

    for (const [storeIndex, orgId] of orgIds.entries()) {
      const storeConfig = getStoreByOrgId(this.deps.config, orgId);
      for (const [rangeIndex, range] of bizDateRanges.entries()) {
        await syncStore({
          config: this.deps.config,
          store: store as unknown as HetangOpsStore,
          orgId,
          now,
          logger: this.deps.logger,
          syncPlan: {
            mode: "backfill",
            windowOverride: resolveOperationalBizDateRangeWindow({
              startBizDate: range.startBizDate,
              endBizDate: range.endBizDate,
              cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
            }),
            skipEndpoints: [...BACKFILL_SKIP_ENDPOINTS],
          },
        });
        lines.push(
          `${storeConfig.storeName} ${range.startBizDate}..${range.endBizDate}: backfill complete`,
        );

        if (rangeIndex < bizDateRanges.length - 1) {
          await sleepImpl(BACKFILL_WINDOW_GAP_MS);
        }
      }

      if (storeIndex < orgIds.length - 1) {
        await sleepImpl(STORE_SYNC_GAP_MS);
      }
    }

    return lines;
  }

  async repairMissingCoverage(
    params: {
      orgIds?: string[];
      startBizDate?: string;
      endBizDate?: string;
      maxPlans?: number;
      now?: Date;
      publishAnalytics?: boolean;
    } = {},
  ): Promise<string[]> {
    const store = await this.getStore();
    if (!hasCoverageHelper(store)) {
      return [];
    }

    const now = params.now ?? new Date();
    const endBizDate =
      params.endBizDate ??
      resolveReportBizDate({
        now,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      });
    const startBizDate =
      params.startBizDate ??
      shiftBizDate(endBizDate, -(this.deps.config.sync.historyBackfillDays - 1));
    const allowedOrgIds = params.orgIds?.length ? new Set(params.orgIds) : null;
    const maxPlans =
      typeof params.maxPlans === "number" && Number.isFinite(params.maxPlans)
        ? Math.max(1, Math.floor(params.maxPlans))
        : undefined;
    const allPlans = await this.buildCoverageAwareNightlyHistoryBackfillPlans({
      store,
      startBizDate,
      endBizDate,
    });
    const selectedPlans = [];
    for (const plan of (allPlans ?? []).filter(
      (candidatePlan) => !allowedOrgIds || allowedOrgIds.has(candidatePlan.orgId),
    )) {
      let selectedCardIds = plan.selectedCardIds;
      if (
        !selectedCardIds &&
        !plan.skipEndpoints.includes("1.4") &&
        typeof store.listRecentUserTradeCandidateCardIds === "function"
      ) {
        const candidateCardIds = await store.listRecentUserTradeCandidateCardIds({
          orgId: plan.orgId,
          startBizDate: plan.startBizDate,
          endBizDate: plan.endBizDate,
        });
        const normalizedCandidateCardIds = Array.from(
          new Set(
            candidateCardIds
              .map((cardId) => String(cardId ?? "").trim())
              .filter((cardId) => cardId.length > 0),
          ),
        );
        if (normalizedCandidateCardIds.length > 0) {
          selectedCardIds = normalizedCandidateCardIds;
        }
      }
      selectedPlans.push({
        ...plan,
        selectedCardIds,
      });
    }
    const boundedPlans = selectedPlans.slice(0, maxPlans);
    if (boundedPlans.length === 0) {
      return [];
    }

    const syncStore = this.deps.syncStore ?? syncHetangStore;
    const sleepImpl = this.deps.sleep ?? sleep;
    const lines: string[] = [];

    for (const [index, plan] of boundedPlans.entries()) {
      await syncStore({
        config: this.deps.config,
        store: store as unknown as HetangOpsStore,
        orgId: plan.orgId,
        now,
        logger: this.deps.logger,
        syncPlan: {
          mode: "backfill",
          windowOverride: resolveOperationalBizDateRangeWindow({
            startBizDate: plan.startBizDate,
            endBizDate: plan.endBizDate,
            cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
          }),
          skipEndpoints: [...plan.skipEndpoints],
          selectedCardIds: plan.selectedCardIds,
        },
        publishAnalytics: false,
      });

      const storeConfig = getStoreByOrgId(this.deps.config, plan.orgId);
      lines.push(
        `${storeConfig.storeName} ${plan.startBizDate}..${plan.endBizDate}: coverage repair complete`,
      );

      if (index < boundedPlans.length - 1) {
        await sleepImpl(STORE_SYNC_GAP_MS);
      }
    }

    if (params.publishAnalytics !== false) {
      await this.publishAnalyticsViewsOnce({
        store,
        publishedAt: now.toISOString(),
        notes: `coverage-repair:${startBizDate}..${endBizDate}:${now.toISOString()}`,
      });
    }

    return lines;
  }

  async backfillFebruary2026(params: { orgIds?: string[]; now?: Date } = {}): Promise<string[]> {
    return await this.backfillStores({
      orgIds: params.orgIds,
      startBizDate: FEBRUARY_2026_BACKFILL_RANGE.startBizDate,
      endBizDate: FEBRUARY_2026_BACKFILL_RANGE.endBizDate,
      now: params.now,
    });
  }

  private async getCoverageAwareCustomerHistoryCatchupTargets(params: {
    store: SyncStoreLike;
    startBizDate: string;
    endBizDate: string;
    orgIds: string[];
  }): Promise<Map<string, "rebuild" | "complete" | "blocked"> | null> {
    if (!hasCoverageHelper(params.store)) {
      return null;
    }

    const statuses = new Map<string, "rebuild" | "complete" | "blocked">();
    for (const orgId of params.orgIds) {
      const snapshot = await params.store.getHistoricalCoverageSnapshot({
        orgId,
        startBizDate: params.startBizDate,
        endBizDate: params.endBizDate,
      });
      const rawReady = ["1.2", "1.3", "1.6"].every((endpoint) =>
        spanCoversRange(
          snapshot.rawFacts[endpoint as EndpointCode],
          params.startBizDate,
          params.endBizDate,
        ),
      );
      const derivedReady =
        spanCoversRange(
          snapshot.derivedLayers.factMemberDailySnapshot,
          params.startBizDate,
          params.endBizDate,
        ) &&
        spanCoversRange(
          snapshot.derivedLayers.martCustomerSegments,
          params.startBizDate,
          params.endBizDate,
        ) &&
        spanCoversRange(
          snapshot.derivedLayers.martCustomerConversionCohorts,
          params.startBizDate,
          params.endBizDate,
        ) &&
        spanCoversRange(
          snapshot.derivedLayers.mvCustomerProfile90d,
          params.startBizDate,
          params.endBizDate,
        );

      if (!rawReady) {
        statuses.set(orgId, "blocked");
        continue;
      }
      if (derivedReady) {
        statuses.set(orgId, "complete");
        continue;
      }
      statuses.set(orgId, "rebuild");
    }
    return statuses;
  }

  async runCustomerHistoryCatchup(
    params: {
      bizDate?: string;
      now?: Date;
      orgIds?: string[];
    } = {},
  ): Promise<{ lines: string[]; allComplete: boolean }> {
    const store = await this.getStore();
    const range = params.bizDate
      ? {
          startBizDate: shiftBizDate(
            params.bizDate,
            -(this.deps.config.sync.historyBackfillDays - 1),
          ),
          endBizDate: params.bizDate,
        }
      : resolveHistoryCatchupRange({
          now: params.now ?? new Date(),
          timeZone: this.deps.config.timeZone,
          cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
          historyBackfillDays: this.deps.config.sync.historyBackfillDays,
        });
    const runKey = range.endBizDate;
    const state = await this.getCustomerHistoryCatchupState(store, runKey);
    const orgIds = resolveHistoryCatchupOrgIds(this.deps.config, params.orgIds);
    const coverageAwareStatuses = await this.getCoverageAwareCustomerHistoryCatchupTargets({
      store,
      startBizDate: range.startBizDate,
      endBizDate: range.endBizDate,
      orgIds,
    });
    const lines: string[] = [];
    let allComplete = true;
    let rebuiltAny = false;

    for (const orgId of orgIds) {
      const storeConfig = getStoreByOrgId(this.deps.config, orgId);
      if (state.completedAtByOrgId[orgId]) {
        lines.push(
          `${storeConfig.storeName}: customer history catchup already complete (${range.startBizDate}..${range.endBizDate})`,
        );
        continue;
      }
      const coverageStatus = coverageAwareStatuses?.get(orgId);
      if (coverageStatus === "complete") {
        state.completedAtByOrgId[orgId] = new Date().toISOString();
        state.updatedAt = state.completedAtByOrgId[orgId]!;
        await this.persistCustomerHistoryCatchupState(store, runKey, state);
        lines.push(
          `${storeConfig.storeName}: customer history catchup already complete (${range.startBizDate}..${range.endBizDate})`,
        );
        continue;
      }
      if (coverageStatus === "blocked") {
        allComplete = false;
        lines.push(
          `${storeConfig.storeName}: customer history catchup waiting for raw facts (${range.startBizDate}..${range.endBizDate})`,
        );
        continue;
      }
      try {
        await rebuildMemberDailySnapshotsForDateRange({
          store: store as unknown as HetangOpsStore,
          orgId,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
        });
        await rebuildCustomerIntelligenceForDateRange({
          store: store as unknown as HetangOpsStore,
          orgId,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
          refreshViews: false,
          chunkDays: LOCAL_HISTORY_CATCHUP_INTELLIGENCE_CHUNK_DAYS,
        });
        await rebuildMemberReactivationFeaturesForDateRange({
          store: store as unknown as HetangOpsStore,
          orgId,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
          refreshViews: false,
        });
        await rebuildMemberReactivationStrategiesForDateRange({
          store: store as unknown as HetangOpsStore,
          orgId,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
          refreshViews: false,
        });
        await rebuildMemberReactivationQueueForDateRange({
          store: store as unknown as HetangOpsStore,
          orgId,
          startBizDate: range.startBizDate,
          endBizDate: range.endBizDate,
          refreshViews: false,
        });
        rebuiltAny = true;
        state.completedAtByOrgId[orgId] = new Date().toISOString();
        state.updatedAt = state.completedAtByOrgId[orgId]!;
        await this.persistCustomerHistoryCatchupState(store, runKey, state);
        lines.push(
          `${storeConfig.storeName}: customer history catchup complete (${range.startBizDate}..${range.endBizDate})`,
        );
      } catch (error) {
        allComplete = false;
        const message = summarizeUnknownError(error);
        this.deps.logger.warn(
          `hetang-ops: customer history catchup failed for ${storeConfig.storeName}: ${message}`,
        );
        lines.push(`${storeConfig.storeName}: customer history catchup failed - ${message}`);
      }
    }

    if (rebuiltAny) {
      const publicationStore = this.resolveServingPublicationStore(store);
      if (typeof publicationStore.forceRebuildAnalyticsViews === "function") {
        await publicationStore.forceRebuildAnalyticsViews();
        this.markAnalyticsViewsVerified();
      }
    }

    return {
      lines,
      allComplete:
        allComplete && orgIds.every((orgId) => typeof state.completedAtByOrgId[orgId] === "string"),
    };
  }

  async repairAnalyticsViews(): Promise<string> {
    const store = await this.getStore();
    const publicationStore = this.resolveServingPublicationStore(store);
    if (typeof publicationStore.forceRebuildAnalyticsViews === "function") {
      await publicationStore.forceRebuildAnalyticsViews();
      this.markAnalyticsViewsVerified();
    }
    return "analytics views rebuilt";
  }

  async publishNightlyServingViews(now: Date): Promise<void> {
    const store = await this.getStore();
    await this.publishAnalyticsViewsOnce({
      store,
      publishedAt: now.toISOString(),
      notes: `nightly-api-window:${now.toISOString()}`,
    });
  }
}
