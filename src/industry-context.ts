import type { HetangIndustryContextSnapshotRecord } from "./types.js";
import type { OperatingWorldIndustryObservation } from "./world-model/types.js";

export type IndustryContextModule =
  | "hq_narrative"
  | "world_model"
  | "store_diagnosis";

export type IndustryContextPayload = {
  snapshotDate: string | null;
  items: HetangIndustryContextSnapshotRecord[];
  observations: OperatingWorldIndustryObservation[];
  narrativeLines: string[];
};

export type IndustryContextRuntime = {
  listIndustryContextSnapshots?: (params?: {
    snapshotDate?: string;
  }) => Promise<HetangIndustryContextSnapshotRecord[]>;
};

export function toIndustryContextRuntime(params: {
  listIndustryContextSnapshots?: (params?: {
    snapshotDate?: string;
  }) => Promise<HetangIndustryContextSnapshotRecord[]>;
}): IndustryContextRuntime {
  const listIndustryContextSnapshots = params.listIndustryContextSnapshots;
  if (typeof listIndustryContextSnapshots !== "function") {
    return {};
  }
  return {
    listIndustryContextSnapshots: async (runtimeParams) =>
      await listIndustryContextSnapshots({
        snapshotDate: runtimeParams?.snapshotDate,
      }),
  };
}

function shouldIncludeForModule(
  row: HetangIndustryContextSnapshotRecord,
  module: IndustryContextModule | undefined,
): boolean {
  if (!module) {
    return true;
  }
  if (row.applicableModules.length === 0) {
    return true;
  }
  return row.applicableModules.includes(module);
}

export function mapIndustryContextToWorldModelObservations(
  rows: HetangIndustryContextSnapshotRecord[],
): OperatingWorldIndustryObservation[] {
  return rows.map((row) => ({
    key: `${row.signalKind}:${row.signalKey}`,
    summary: `${row.title}：${row.summary}`,
    sourceCategory: "industry_signal",
    truthBoundary: "weak_signal",
    updatedAt: row.updatedAt,
    detail: {
      signalKind: row.signalKind,
      signalKey: row.signalKey,
      confidence: row.confidence,
      sourceType: row.sourceType,
      sourceLabel: row.sourceLabel,
      sourceUri: row.sourceUri,
      note: row.note,
      detailJson: row.detailJson,
    },
  }));
}

export function assembleIndustryContextPayload(params: {
  rows: HetangIndustryContextSnapshotRecord[];
  module?: IndustryContextModule;
}): IndustryContextPayload {
  const items = params.rows.filter((row) =>
    shouldIncludeForModule(row, params.module),
  );
  return {
    snapshotDate: items[0]?.snapshotDate ?? null,
    items,
    observations: mapIndustryContextToWorldModelObservations(items),
    narrativeLines: items.map((row) => `${row.title}：${row.summary}`),
  };
}

export async function loadIndustryContextPayload(params: {
  runtime: IndustryContextRuntime;
  snapshotDate?: string;
  module?: IndustryContextModule;
}): Promise<IndustryContextPayload> {
  const rows =
    (await params.runtime.listIndustryContextSnapshots?.({
      snapshotDate: params.snapshotDate,
    })) ?? [];
  return assembleIndustryContextPayload({
    rows,
    module: params.module,
  });
}
