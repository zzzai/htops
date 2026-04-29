import type { HetangStoreConfig } from "./types.js";
import { rebuildCustomerIntelligenceForDateRange } from "./customer-intelligence.js";
import { rebuildMemberDailySnapshotsForDateRange } from "./customer-history-backfill.js";
import { rebuildMemberReactivationFeaturesForDateRange } from "./reactivation-features.js";
import { rebuildMemberReactivationQueueForDateRange } from "./reactivation-queue.js";
import { rebuildMemberReactivationStrategiesForDateRange } from "./reactivation-strategy.js";
import type { HetangOpsStore } from "./store.js";

type StoreDescriptor = Pick<
  HetangStoreConfig,
  "orgId" | "storeName" | "customerGrowth" | "roomCount" | "operatingHoursPerDay"
>;

export async function runLocalCustomerHistoryCatchup(params: {
  store: Pick<HetangOpsStore, "forceRebuildAnalyticsViews">;
  stores: StoreDescriptor[];
  orgIds: string[];
  range: {
    startBizDate: string;
    endBizDate: string;
  };
  intelligenceChunkDays: number;
  log: (line: string) => void;
  rebuildMemberDailySnapshotsForDateRange?: typeof rebuildMemberDailySnapshotsForDateRange;
  rebuildCustomerIntelligenceForDateRange?: typeof rebuildCustomerIntelligenceForDateRange;
  rebuildMemberReactivationFeaturesForDateRange?: typeof rebuildMemberReactivationFeaturesForDateRange;
  rebuildMemberReactivationStrategiesForDateRange?: typeof rebuildMemberReactivationStrategiesForDateRange;
  rebuildMemberReactivationQueueForDateRange?: typeof rebuildMemberReactivationQueueForDateRange;
}): Promise<void> {
  const rebuildSnapshots =
    params.rebuildMemberDailySnapshotsForDateRange ?? rebuildMemberDailySnapshotsForDateRange;
  const rebuildIntelligence =
    params.rebuildCustomerIntelligenceForDateRange ?? rebuildCustomerIntelligenceForDateRange;
  const rebuildFeatures =
    params.rebuildMemberReactivationFeaturesForDateRange ??
    rebuildMemberReactivationFeaturesForDateRange;
  const rebuildStrategies =
    params.rebuildMemberReactivationStrategiesForDateRange ??
    rebuildMemberReactivationStrategiesForDateRange;
  const rebuildQueue =
    params.rebuildMemberReactivationQueueForDateRange ?? rebuildMemberReactivationQueueForDateRange;

  params.log(
    `Starting local customer history catchup for ${params.orgIds.length} store(s): ${params.range.startBizDate}..${params.range.endBizDate}`,
  );

  for (const orgId of params.orgIds) {
    const storeName = params.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;

    const snapshotCount = await rebuildSnapshots({
      store: params.store as HetangOpsStore,
      orgId,
      startBizDate: params.range.startBizDate,
      endBizDate: params.range.endBizDate,
    });
    params.log(`[${storeName}] member snapshots rebuilt for ${snapshotCount} days`);

    const intelligenceCount = await rebuildIntelligence({
      store: params.store as HetangOpsStore,
      orgId,
      startBizDate: params.range.startBizDate,
      endBizDate: params.range.endBizDate,
      refreshViews: false,
      chunkDays: params.intelligenceChunkDays,
      storeConfig: params.stores.find((entry) => entry.orgId === orgId) as HetangStoreConfig | undefined,
    });
    params.log(`[${storeName}] customer intelligence rebuilt for ${intelligenceCount} days`);

    const reactivationFeatureCount = await rebuildFeatures({
      store: params.store as HetangOpsStore,
      orgId,
      startBizDate: params.range.startBizDate,
      endBizDate: params.range.endBizDate,
      refreshViews: false,
    });
    params.log(`[${storeName}] member reactivation features rebuilt for ${reactivationFeatureCount} days`);

    const reactivationStrategyCount = await rebuildStrategies({
      store: params.store as HetangOpsStore,
      orgId,
      startBizDate: params.range.startBizDate,
      endBizDate: params.range.endBizDate,
      refreshViews: false,
      storeConfig: params.stores.find((entry) => entry.orgId === orgId),
    });
    params.log(
      `[${storeName}] member reactivation strategies rebuilt for ${reactivationStrategyCount} days`,
    );

    const reactivationQueueCount = await rebuildQueue({
      store: params.store as HetangOpsStore,
      orgId,
      startBizDate: params.range.startBizDate,
      endBizDate: params.range.endBizDate,
      refreshViews: false,
      storeConfig: params.stores.find((entry) => entry.orgId === orgId),
    });
    params.log(`[${storeName}] member reactivation queue rebuilt for ${reactivationQueueCount} days`);
  }

  await params.store.forceRebuildAnalyticsViews();
  params.log("Local customer history catchup complete");
}
