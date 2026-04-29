import { createHash, randomUUID } from "node:crypto";
import { HetangApiClient } from "./client.js";
import { getStoreByOrgId, hasHetangApiCredentials } from "./config.js";
import {
  normalizeConsumeBillRow,
  normalizeMemberCardRows,
  normalizeMemberRow,
  normalizeRechargeBillRow,
  normalizeTechCommissionRow,
  normalizeTechCurrentRow,
  normalizeTechMarketRow,
  normalizeTechUpClockRow,
  normalizeUserTradeRow,
} from "./normalize.js";
import { HetangOpsStore } from "./store.js";
import { resolveIncrementalWindow, resolveOperationalBizDate } from "./time.js";
import type {
  EndpointCode,
  HetangClientLike,
  HetangLogger,
  HetangOpsConfig,
  SyncWindow,
} from "./types.js";

const REQUEST_DELAY_MS = 1_200;
const BATCH_DELAY_MS = 5_000;
const TECH_ENDPOINT_COOLDOWN_MS = 15_000;
const USER_TRADE_CARD_BATCH_SIZE = 3;
const TECH_CODE_BATCH_SIZE = 5;
const RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 3_000;
const RETRY_MAX_DELAY_MS = 20_000;

type DelayFn = (ms: number) => Promise<void>;
type ExplicitSyncWindow = Pick<SyncWindow, "startTime" | "endTime">;

export type HetangSyncPlan = {
  mode?: "daily" | "backfill";
  windowOverride?: ExplicitSyncWindow;
  skipEndpoints?: EndpointCode[];
  selectedCardIds?: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObjectRows(rows: unknown[]): Array<Record<string, unknown>> {
  return rows.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
  );
}

function filterRowsByOrgId(
  rows: Record<string, unknown>[],
  orgId: string,
): Record<string, unknown>[] {
  return rows.filter((row) => {
    const rowOrgId = row.OrgId;
    return rowOrgId === undefined || rowOrgId === null || String(rowOrgId) === orgId;
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveSyncExecutionLockKey(orgId: string, mode: string): number {
  const digest = createHash("sha1").update(`${mode}:${orgId}`).digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16);
}

export function estimateUserTradeSyncDurationMs(memberCardCount: number): number {
  if (memberCardCount <= 0) {
    return Math.max(0, 11 - 1) * REQUEST_DELAY_MS;
  }
  const batchCount = Math.ceil(memberCardCount / USER_TRADE_CARD_BATCH_SIZE);
  const requestDelayCount = 11 * Math.max(0, memberCardCount - 1);
  const batchDelayCount = 11 * Math.max(0, batchCount - 1);
  return requestDelayCount * REQUEST_DELAY_MS + batchDelayCount * BATCH_DELAY_MS;
}

function isHighFrequencyError(error: unknown): boolean {
  return errorMessage(error).includes("高频查询");
}

function isUserTradeVendorQueryError(error: unknown): boolean {
  return errorMessage(error).includes(
    "The CommandText property has not been properly initialized.",
  );
}

async function withRetry<T>(params: {
  task: () => Promise<T>;
  sleepImpl: DelayFn;
  shouldRetry: (error: unknown) => boolean;
  attempts?: number;
}): Promise<T> {
  const attempts = params.attempts ?? RETRY_ATTEMPTS;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await params.task();
    } catch (error) {
      lastError = error;
      if (!params.shouldRetry(error) || attempt === attempts) {
        break;
      }
      const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
      await params.sleepImpl(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function paceRequest(params: { sleepImpl: DelayFn; isLast: boolean }): Promise<void> {
  if (!params.isLast) {
    await params.sleepImpl(REQUEST_DELAY_MS);
  }
}

async function paceBatch(params: { sleepImpl: DelayFn; isLast: boolean }): Promise<void> {
  if (!params.isLast) {
    await params.sleepImpl(BATCH_DELAY_MS);
  }
}

async function paceTechEndpoint(params: { sleepImpl: DelayFn; isLast: boolean }): Promise<void> {
  if (!params.isLast) {
    await params.sleepImpl(TECH_ENDPOINT_COOLDOWN_MS);
  }
}

function resolveExplicitWindow(windowOverride: ExplicitSyncWindow): SyncWindow {
  return {
    start: new Date(`${windowOverride.startTime.replace(" ", "T")}Z`),
    end: new Date(`${windowOverride.endTime.replace(" ", "T")}Z`),
    startTime: windowOverride.startTime,
    endTime: windowOverride.endTime,
  };
}

async function resolveSyncWindow(params: {
  orgId: string;
  endpoint: EndpointCode;
  config: HetangOpsConfig;
  store: HetangOpsStore;
  now: Date;
  syncPlan?: HetangSyncPlan;
}): Promise<SyncWindow> {
  if (params.syncPlan?.windowOverride) {
    return resolveExplicitWindow(params.syncPlan.windowOverride);
  }

  const lastSuccessAt = await params.store.getEndpointWatermark(params.orgId, params.endpoint);
  return resolveIncrementalWindow({
    now: params.now,
    timeZone: params.config.timeZone,
    lastSuccessAt,
    overlapDays: params.config.sync.overlapDays,
    initialBackfillDays: params.config.sync.initialBackfillDays,
  });
}

async function syncPagedEndpoint(params: {
  endpoint: "1.1" | "1.2" | "1.3";
  orgId: string;
  config: HetangOpsConfig;
  store: HetangOpsStore;
  client: HetangClientLike;
  syncRunId: string;
  now: Date;
  sleepImpl: DelayFn;
  syncPlan?: HetangSyncPlan;
}) {
  const operationalBizDate = resolveOperationalBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const window = await resolveSyncWindow({
    orgId: params.orgId,
    endpoint: params.endpoint,
    config: params.config,
    store: params.store,
    now: params.now,
    syncPlan: params.syncPlan,
  });
  const request = {
    OrgId: params.orgId,
    Stime: window.startTime,
    Etime: window.endTime,
  };
  const rows = asObjectRows(await params.client.fetchPaged(params.endpoint, request));
  const batchId = randomUUID();
  await params.store.recordRawBatch({
    batchId,
    syncRunId: params.syncRunId,
    endpoint: params.endpoint,
    orgId: params.orgId,
    fetchedAt: params.now.toISOString(),
    requestJson: JSON.stringify(request),
    responseJson: JSON.stringify(rows),
    rowCount: rows.length,
  });
  await params.store.recordRawRows({
    endpoint: params.endpoint,
    orgId: params.orgId,
    batchId,
    fetchedAt: params.now.toISOString(),
    rows,
  });

  if (params.endpoint === "1.1") {
    const members = rows
      .map((row) => normalizeMemberRow(row, params.orgId))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const memberCards = rows.flatMap((row) => normalizeMemberCardRows(row, params.orgId));
    await params.store.upsertMemberCurrent(members);
    await params.store.upsertMemberCards(memberCards);
    if (params.syncPlan?.mode !== "backfill") {
      await params.store.snapshotMembers(operationalBizDate, members);
      await params.store.snapshotMemberCards(operationalBizDate, memberCards);
    }
  } else if (params.endpoint === "1.2") {
    const consume = rows
      .map((row) =>
        normalizeConsumeBillRow(
          row,
          params.orgId,
          params.config.timeZone,
          params.now,
          params.config.sync.businessDayCutoffLocalTime,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    await params.store.upsertConsumeBills(consume, { refreshViews: false });
  } else if (params.endpoint === "1.3") {
    const recharge = rows
      .map((row) =>
        normalizeRechargeBillRow(
          row,
          params.orgId,
          params.config.timeZone,
          params.now,
          params.config.sync.businessDayCutoffLocalTime,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    await params.store.upsertRechargeBills(recharge, { refreshViews: false });
  }

  await params.store.setEndpointWatermark({
    orgId: params.orgId,
    endpoint: params.endpoint,
    lastSuccessAt: params.now.toISOString(),
  });
}

async function syncUserTrades(params: {
  orgId: string;
  config: HetangOpsConfig;
  store: HetangOpsStore;
  client: HetangClientLike;
  syncRunId: string;
  now: Date;
  sleepImpl: DelayFn;
  syncPlan?: HetangSyncPlan;
}) {
  const endpoint: EndpointCode = "1.4";
  const window = await resolveSyncWindow({
    orgId: params.orgId,
    endpoint,
    config: params.config,
    store: params.store,
    now: params.now,
    syncPlan: params.syncPlan,
  });
  const rows: Record<string, unknown>[] = [];
  const selectedCardIds = Array.isArray(params.syncPlan?.selectedCardIds)
    ? Array.from(
        new Set(
          params.syncPlan.selectedCardIds
            .map((cardId) => String(cardId ?? "").trim())
            .filter((cardId) => cardId.length > 0),
        ),
      )
    : null;
  const memberCardIds =
    selectedCardIds ?? (await params.store.listMemberCardIds(params.orgId));
  const requestMode =
    selectedCardIds !== null
      ? memberCardIds.length > 0
        ? "selected-member-card"
        : "selected-empty"
      : memberCardIds.length > 0
        ? "member-card"
        : "empty-id";
  const skippedTypeErrors: Array<{ type: number; cardId?: string; error: string }> = [];

  if (selectedCardIds !== null && memberCardIds.length === 0) {
    const batchId = randomUUID();
    await params.store.recordRawBatch({
      batchId,
      syncRunId: params.syncRunId,
      endpoint,
      orgId: params.orgId,
      fetchedAt: params.now.toISOString(),
      requestJson: JSON.stringify({
        OrgId: params.orgId,
        Stime: window.startTime,
        Etime: window.endTime,
        requestMode,
        selectedCardIds: memberCardIds,
        skippedTypeErrors,
      }),
      responseJson: JSON.stringify(rows),
      rowCount: rows.length,
    });
    await params.store.recordRawRows({
      endpoint,
      orgId: params.orgId,
      batchId,
      fetchedAt: params.now.toISOString(),
      rows,
    });
    await params.store.setEndpointWatermark({
      orgId: params.orgId,
      endpoint,
      lastSuccessAt: params.now.toISOString(),
    });
    return;
  }

  for (let type = 1; type <= 11; type += 1) {
    if (memberCardIds.length > 0) {
      const cardBatches = chunk(memberCardIds, USER_TRADE_CARD_BATCH_SIZE);
      for (const [batchIndex, cardBatch] of cardBatches.entries()) {
        for (const [cardIndex, cardId] of cardBatch.entries()) {
          try {
            rows.push(
              ...filterRowsByOrgId(
                asObjectRows(
                  await withRetry({
                    task: async () =>
                      await params.client.fetchUserTrades({
                        OrgId: params.orgId,
                        Stime: window.startTime,
                        Etime: window.endTime,
                        Id: cardId,
                        Type: type,
                      }),
                    sleepImpl: params.sleepImpl,
                    shouldRetry: isHighFrequencyError,
                  }),
                ),
                params.orgId,
              ),
            );
          } catch (error) {
            if (isUserTradeVendorQueryError(error)) {
              skippedTypeErrors.push({
                type,
                cardId,
                error: errorMessage(error),
              });
            } else {
              throw error;
            }
          }
          await paceRequest({
            sleepImpl: params.sleepImpl,
            isLast: batchIndex === cardBatches.length - 1 && cardIndex === cardBatch.length - 1,
          });
        }
        await paceBatch({
          sleepImpl: params.sleepImpl,
          isLast: batchIndex === cardBatches.length - 1,
        });
      }
      continue;
    }

    try {
      rows.push(
        ...filterRowsByOrgId(
          asObjectRows(
            await withRetry({
              task: async () =>
                await params.client.fetchUserTrades({
                  OrgId: params.orgId,
                  Stime: window.startTime,
                  Etime: window.endTime,
                  Id: "",
                  Type: type,
                }),
              sleepImpl: params.sleepImpl,
              shouldRetry: isHighFrequencyError,
            }),
          ),
          params.orgId,
        ),
      );
    } catch (error) {
      if (isUserTradeVendorQueryError(error)) {
        skippedTypeErrors.push({
          type,
          error: errorMessage(error),
        });
      } else {
        throw error;
      }
    }
    await paceRequest({
      sleepImpl: params.sleepImpl,
      isLast: type === 11,
    });
  }

  const batchId = randomUUID();
  await params.store.recordRawBatch({
    batchId,
    syncRunId: params.syncRunId,
    endpoint,
    orgId: params.orgId,
    fetchedAt: params.now.toISOString(),
    requestJson: JSON.stringify({
      OrgId: params.orgId,
      Stime: window.startTime,
      Etime: window.endTime,
      requestMode,
      selectedCardIds: selectedCardIds ?? undefined,
      skippedTypeErrors,
    }),
    responseJson: JSON.stringify(rows),
    rowCount: rows.length,
  });
  await params.store.recordRawRows({
    endpoint,
    orgId: params.orgId,
    batchId,
    fetchedAt: params.now.toISOString(),
    rows,
  });
  await params.store.upsertUserTrades(
    rows
      .map((row) =>
        normalizeUserTradeRow(
          row,
          params.orgId,
          params.config.timeZone,
          params.now,
          params.config.sync.businessDayCutoffLocalTime,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row)),
  );
  await params.store.setEndpointWatermark({
    orgId: params.orgId,
    endpoint,
    lastSuccessAt: params.now.toISOString(),
  });
}

async function syncTechSnapshot(params: {
  orgId: string;
  config: HetangOpsConfig;
  store: HetangOpsStore;
  client: HetangClientLike;
  syncRunId: string;
  now: Date;
  sleepImpl: DelayFn;
}): Promise<string[]> {
  const operationalBizDate = resolveOperationalBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const endpoint: EndpointCode = "1.5";
  const rows = asObjectRows(
    await withRetry({
      task: async () =>
        await params.client.fetchTechList({
          OrgId: params.orgId,
        }),
      sleepImpl: params.sleepImpl,
      shouldRetry: isHighFrequencyError,
    }),
  );
  const batchId = randomUUID();
  await params.store.recordRawBatch({
    batchId,
    syncRunId: params.syncRunId,
    endpoint,
    orgId: params.orgId,
    fetchedAt: params.now.toISOString(),
    requestJson: JSON.stringify({ OrgId: params.orgId }),
    responseJson: JSON.stringify(rows),
    rowCount: rows.length,
  });
  await params.store.recordRawRows({
    endpoint,
    orgId: params.orgId,
    batchId,
    fetchedAt: params.now.toISOString(),
    rows,
  });
  const normalized = rows
    .map((row) => normalizeTechCurrentRow(row, params.orgId))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  await params.store.upsertTechCurrent(normalized);
  await params.store.snapshotTechCurrent(operationalBizDate, normalized);
  await params.store.setEndpointWatermark({
    orgId: params.orgId,
    endpoint,
    lastSuccessAt: params.now.toISOString(),
  });
  return normalized.map((row) => row.techCode);
}

async function syncTechUpClock(params: {
  orgId: string;
  config: HetangOpsConfig;
  store: HetangOpsStore;
  client: HetangClientLike;
  syncRunId: string;
  now: Date;
  techCodes: string[];
  sleepImpl: DelayFn;
  syncPlan?: HetangSyncPlan;
}) {
  const endpoint: EndpointCode = "1.6";
  const window = await resolveSyncWindow({
    orgId: params.orgId,
    endpoint,
    config: params.config,
    store: params.store,
    now: params.now,
    syncPlan: params.syncPlan,
  });
  const rows: Record<string, unknown>[] = [];
  let usedStorewideFetch = false;

  try {
    const storewideRows = asObjectRows(
      await withRetry({
        task: async () =>
          await params.client.fetchTechUpClockList({
            OrgId: params.orgId,
            Code: "",
            Stime: window.startTime,
            Etime: window.endTime,
          }),
        sleepImpl: params.sleepImpl,
        shouldRetry: isHighFrequencyError,
      }),
    );
    if (storewideRows.length > 0) {
      rows.push(...storewideRows);
      usedStorewideFetch = true;
    }
  } catch {
    usedStorewideFetch = false;
  }

  if (!usedStorewideFetch) {
    const techBatches = chunk(params.techCodes, TECH_CODE_BATCH_SIZE);
    for (const [batchIndex, techBatch] of techBatches.entries()) {
      for (const [techIndex, code] of techBatch.entries()) {
        rows.push(
          ...asObjectRows(
            await withRetry({
              task: async () =>
                await params.client.fetchTechUpClockList({
                  OrgId: params.orgId,
                  Code: code,
                  Stime: window.startTime,
                  Etime: window.endTime,
                }),
              sleepImpl: params.sleepImpl,
              shouldRetry: isHighFrequencyError,
            }),
          ),
        );
        await paceRequest({
          sleepImpl: params.sleepImpl,
          isLast: batchIndex === techBatches.length - 1 && techIndex === techBatch.length - 1,
        });
      }
      await paceBatch({
        sleepImpl: params.sleepImpl,
        isLast: batchIndex === techBatches.length - 1,
      });
    }
  }

  const batchId = randomUUID();
  await params.store.recordRawBatch({
    batchId,
    syncRunId: params.syncRunId,
    endpoint,
    orgId: params.orgId,
    fetchedAt: params.now.toISOString(),
    requestJson: JSON.stringify({
      OrgId: params.orgId,
      Stime: window.startTime,
      Etime: window.endTime,
      techCodes: params.techCodes,
      usedStorewideFetch,
    }),
    responseJson: JSON.stringify(rows),
    rowCount: rows.length,
  });
  await params.store.recordRawRows({
    endpoint,
    orgId: params.orgId,
    batchId,
    fetchedAt: params.now.toISOString(),
    rows,
  });
  await params.store.upsertTechUpClockRows(
    rows
      .map((row) =>
        normalizeTechUpClockRow(
          row,
          params.orgId,
          params.config.timeZone,
          params.now,
          params.config.sync.businessDayCutoffLocalTime,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    { refreshViews: false },
  );
  await params.store.setEndpointWatermark({
    orgId: params.orgId,
    endpoint,
    lastSuccessAt: params.now.toISOString(),
  });
}

async function syncTechMarket(params: {
  orgId: string;
  config: HetangOpsConfig;
  store: HetangOpsStore;
  client: HetangClientLike;
  syncRunId: string;
  now: Date;
  techCodes: string[];
  sleepImpl: DelayFn;
  syncPlan?: HetangSyncPlan;
}) {
  const endpoint: EndpointCode = "1.7";
  const window = await resolveSyncWindow({
    orgId: params.orgId,
    endpoint,
    config: params.config,
    store: params.store,
    now: params.now,
    syncPlan: params.syncPlan,
  });

  let rows: Record<string, unknown>[] = [];
  let usedStorewideFetch = false;
  try {
    rows = asObjectRows(
      await withRetry({
        task: async () =>
          await params.client.fetchTechMarketList({
            OrgId: params.orgId,
            Code: "",
            Stime: window.startTime,
            Etime: window.endTime,
          }),
        sleepImpl: params.sleepImpl,
        shouldRetry: isHighFrequencyError,
      }),
    );
    usedStorewideFetch = rows.length > 0;
  } catch {
    usedStorewideFetch = false;
  }

  if (!usedStorewideFetch && rows.length === 0) {
    const techBatches = chunk(params.techCodes, TECH_CODE_BATCH_SIZE);
    for (const [batchIndex, techBatch] of techBatches.entries()) {
      for (const [techIndex, code] of techBatch.entries()) {
        rows.push(
          ...asObjectRows(
            await withRetry({
              task: async () =>
                await params.client.fetchTechMarketList({
                  OrgId: params.orgId,
                  Code: code,
                  Stime: window.startTime,
                  Etime: window.endTime,
                }),
              sleepImpl: params.sleepImpl,
              shouldRetry: isHighFrequencyError,
            }),
          ),
        );
        await paceRequest({
          sleepImpl: params.sleepImpl,
          isLast: batchIndex === techBatches.length - 1 && techIndex === techBatch.length - 1,
        });
      }
      await paceBatch({
        sleepImpl: params.sleepImpl,
        isLast: batchIndex === techBatches.length - 1,
      });
    }
  }

  const batchId = randomUUID();
  await params.store.recordRawBatch({
    batchId,
    syncRunId: params.syncRunId,
    endpoint,
    orgId: params.orgId,
    fetchedAt: params.now.toISOString(),
    requestJson: JSON.stringify({
      OrgId: params.orgId,
      Stime: window.startTime,
      Etime: window.endTime,
      usedStorewideFetch,
    }),
    responseJson: JSON.stringify(rows),
    rowCount: rows.length,
  });
  await params.store.recordRawRows({
    endpoint,
    orgId: params.orgId,
    batchId,
    fetchedAt: params.now.toISOString(),
    rows,
  });
  await params.store.upsertTechMarketRows(
    rows
      .map((row) =>
        normalizeTechMarketRow(
          row,
          params.orgId,
          params.config.timeZone,
          params.now,
          params.config.sync.businessDayCutoffLocalTime,
        ),
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    { refreshViews: false },
  );
  await params.store.setEndpointWatermark({
    orgId: params.orgId,
    endpoint,
    lastSuccessAt: params.now.toISOString(),
  });
}

async function syncTechCommissionSnapshot(params: {
  orgId: string;
  config: HetangOpsConfig;
  store: HetangOpsStore;
  client: HetangClientLike;
  syncRunId: string;
  now: Date;
  sleepImpl: DelayFn;
}) {
  const endpoint: EndpointCode = "1.8";
  const bizDate = resolveOperationalBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const rows = asObjectRows(
    await withRetry({
      task: async () =>
        await params.client.fetchTechCommissionSetList({
          OrgId: params.orgId,
        }),
      sleepImpl: params.sleepImpl,
      shouldRetry: isHighFrequencyError,
    }),
  );
  const batchId = randomUUID();
  await params.store.recordRawBatch({
    batchId,
    syncRunId: params.syncRunId,
    endpoint,
    orgId: params.orgId,
    fetchedAt: params.now.toISOString(),
    requestJson: JSON.stringify({ OrgId: params.orgId }),
    responseJson: JSON.stringify(rows),
    rowCount: rows.length,
  });
  await params.store.recordRawRows({
    endpoint,
    orgId: params.orgId,
    batchId,
    fetchedAt: params.now.toISOString(),
    rows,
  });
  await params.store.upsertTechCommissionSnapshots(
    rows
      .map((row) => normalizeTechCommissionRow(row, params.orgId, bizDate))
      .filter((row): row is NonNullable<typeof row> => Boolean(row)),
  );
  await params.store.setEndpointWatermark({
    orgId: params.orgId,
    endpoint,
    lastSuccessAt: params.now.toISOString(),
  });
}

export async function syncHetangStore(params: {
  config: HetangOpsConfig;
  store: HetangOpsStore;
  orgId: string;
  now?: Date;
  client?: HetangClientLike;
  logger?: HetangLogger;
  sleep?: DelayFn;
  syncPlan?: HetangSyncPlan;
  publishAnalytics?: boolean;
}): Promise<void> {
  const now = params.now ?? new Date();
  if (!hasHetangApiCredentials(params.config)) {
    throw new Error("Hetang API credentials are not configured");
  }
  const client = params.client ?? new HetangApiClient(params.config.api);
  const sleepImpl = params.sleep ?? sleep;
  const mode = params.syncPlan?.mode ?? "daily";
  await params.store.initialize();
  getStoreByOrgId(params.config, params.orgId);
  const syncExecutionLockKey = resolveSyncExecutionLockKey(params.orgId, mode);
  const syncExecutionLockAcquired = await params.store.tryAdvisoryLock(syncExecutionLockKey);
  if (!syncExecutionLockAcquired) {
    throw new Error(`sync already running for ${params.orgId} (${mode})`);
  }
  try {
    const syncRunId = await params.store.beginSyncRun({
      orgId: params.orgId,
      mode,
      startedAt: now.toISOString(),
    });
    const reclaimedSupersededRuns = await params.store.reclaimSupersededSyncRuns({
      orgId: params.orgId,
      mode,
      reclaimedAt: now.toISOString(),
      supersededBySyncRunId: syncRunId,
      supersededByStartedAt: now.toISOString(),
    });
    if (reclaimedSupersededRuns > 0) {
      params.logger?.warn?.(
        `hetang-ops: reclaimed ${reclaimedSupersededRuns} superseded ${mode} sync runs for ${params.orgId}`,
      );
    }
    const errors: Array<{ endpoint: string; error: string }> = [];
    const skippedEndpoints = new Set(params.syncPlan?.skipEndpoints ?? []);
    const scheduledTechEndpoints = (["1.5", "1.6", "1.7", "1.8"] as const).filter(
      (endpoint) => !skippedEndpoints.has(endpoint),
    );
    const shouldPaceAfterTechEndpoint = (endpoint: "1.5" | "1.6" | "1.7" | "1.8") => {
      const endpointIndex = scheduledTechEndpoints.indexOf(endpoint);
      return endpointIndex !== -1 && endpointIndex < scheduledTechEndpoints.length - 1;
    };
    let fatalError: string | undefined;

    const runStep = async (endpoint: string, task: () => Promise<void>) => {
      if (skippedEndpoints.has(endpoint as EndpointCode)) {
        params.logger?.info?.(`hetang-ops: skipped ${params.orgId} endpoint ${endpoint}`);
        return;
      }
      try {
        await task();
        params.logger?.info?.(`hetang-ops: synced ${params.orgId} endpoint ${endpoint}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ endpoint, error: message });
        await params.store.recordSyncError({
          syncRunId,
          orgId: params.orgId,
          endpoint,
          errorAt: new Date().toISOString(),
          errorMessage: message,
        });
        params.logger?.warn?.(
          `hetang-ops: sync failed ${params.orgId} endpoint ${endpoint}: ${message}`,
        );
      }
    };

    try {
      await runStep(
        "1.1",
        async () =>
          await syncPagedEndpoint({
            endpoint: "1.1",
            orgId: params.orgId,
            config: params.config,
            store: params.store,
            client,
            syncRunId,
            now,
            sleepImpl,
            syncPlan: params.syncPlan,
          }),
      );
      await runStep(
        "1.2",
        async () =>
          await syncPagedEndpoint({
            endpoint: "1.2",
            orgId: params.orgId,
            config: params.config,
            store: params.store,
            client,
            syncRunId,
            now,
            sleepImpl,
            syncPlan: params.syncPlan,
          }),
      );
      await runStep(
        "1.3",
        async () =>
          await syncPagedEndpoint({
            endpoint: "1.3",
            orgId: params.orgId,
            config: params.config,
            store: params.store,
            client,
            syncRunId,
            now,
            sleepImpl,
            syncPlan: params.syncPlan,
          }),
      );
      await runStep(
        "1.4",
        async () =>
          await syncUserTrades({
            orgId: params.orgId,
            config: params.config,
            store: params.store,
            client,
            syncRunId,
            now,
            sleepImpl,
            syncPlan: params.syncPlan,
          }),
      );

      let techCodes: string[] = [];
      await runStep("1.5", async () => {
        techCodes = await syncTechSnapshot({
          orgId: params.orgId,
          config: params.config,
          store: params.store,
          client,
          syncRunId,
          now,
          sleepImpl,
        });
      });
      if (shouldPaceAfterTechEndpoint("1.5")) {
        await paceTechEndpoint({ sleepImpl, isLast: false });
      }
      await runStep(
        "1.6",
        async () =>
          await syncTechUpClock({
            orgId: params.orgId,
            config: params.config,
            store: params.store,
            client,
            syncRunId,
            now,
            techCodes:
              techCodes.length > 0 ? techCodes : await params.store.listActiveTechCodes(params.orgId),
            sleepImpl,
            syncPlan: params.syncPlan,
          }),
      );
      if (shouldPaceAfterTechEndpoint("1.6")) {
        await paceTechEndpoint({ sleepImpl, isLast: false });
      }
      await runStep(
        "1.7",
        async () =>
          await syncTechMarket({
            orgId: params.orgId,
            config: params.config,
            store: params.store,
            client,
            syncRunId,
            now,
            techCodes:
              techCodes.length > 0 ? techCodes : await params.store.listActiveTechCodes(params.orgId),
            sleepImpl,
            syncPlan: params.syncPlan,
          }),
      );
      if (shouldPaceAfterTechEndpoint("1.7")) {
        await paceTechEndpoint({ sleepImpl, isLast: false });
      }
      await runStep(
        "1.8",
        async () =>
          await syncTechCommissionSnapshot({
            orgId: params.orgId,
            config: params.config,
            store: params.store,
            client,
            syncRunId,
            now,
            sleepImpl,
          }),
      );
      if (
        params.publishAnalytics !== false &&
        typeof (params.store as { publishAnalyticsViews?: unknown }).publishAnalyticsViews ===
          "function"
      ) {
        await (
          params.store as {
            publishAnalyticsViews: (params?: {
              publishedAt?: string;
              notes?: string;
              servingVersion?: string;
            }) => Promise<string | null>;
          }
        ).publishAnalyticsViews({
          publishedAt: now.toISOString(),
          notes: `sync-run:${syncRunId}:${params.orgId}:${params.syncPlan?.mode ?? "daily"}`,
        });
      }
    } catch (error) {
      fatalError = error instanceof Error ? error.message : String(error);
      await params.store.recordSyncError({
        syncRunId,
        orgId: params.orgId,
        endpoint: "sync",
        errorAt: new Date().toISOString(),
        errorMessage: fatalError,
      });
      throw error;
    } finally {
      await params.store.finishSyncRun({
        syncRunId,
        status: fatalError ? "failed" : errors.length > 0 ? "partial" : "success",
        finishedAt: new Date().toISOString(),
        details: fatalError
          ? {
              fatalError,
              errors,
            }
          : errors.length > 0
            ? { errors }
            : { ok: true },
      });
    }
  } finally {
    await params.store.releaseAdvisoryLock(syncExecutionLockKey);
  }
}
