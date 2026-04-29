import { readFile } from "node:fs/promises";

import type { HetangStoreExternalContextEntry } from "./types.js";

type StoreExternalContextSnapshotDocument = {
  orgId: string;
  storeName?: string;
  snapshotDate: string;
  entries: HetangStoreExternalContextEntry[];
};

type StoreExternalContextImportStore = {
  upsertStoreExternalContextEntry: (row: {
    orgId: string;
    snapshotDate: string;
    contextKind: HetangStoreExternalContextEntry["contextKind"];
    metricKey: string;
    valueText?: string;
    valueNum?: number;
    valueJson?: unknown;
    unit?: string;
    truthLevel: HetangStoreExternalContextEntry["truthLevel"];
    confidence: HetangStoreExternalContextEntry["confidence"];
    sourceType: string;
    sourceLabel?: string;
    sourceUri?: string;
    applicableModules?: string[];
    notForScoring?: boolean;
    note?: string;
    rawJson?: string;
    updatedAt: string;
  }) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStoreExternalContextSnapshotDocument(
  value: unknown,
  filePath: string,
): StoreExternalContextSnapshotDocument {
  if (!isRecord(value)) {
    throw new Error(`Invalid store external context snapshot: ${filePath}`);
  }

  const orgId = value.orgId;
  const snapshotDate = value.snapshotDate;
  const entries = value.entries;
  if (typeof orgId !== "string" || typeof snapshotDate !== "string" || !Array.isArray(entries)) {
    throw new Error(`Invalid store external context snapshot header: ${filePath}`);
  }

  return {
    orgId,
    storeName: typeof value.storeName === "string" ? value.storeName : undefined,
    snapshotDate,
    entries: entries.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`Invalid store external context entry at index ${index}: ${filePath}`);
      }
      return {
        orgId: typeof entry.orgId === "string" ? entry.orgId : orgId,
        snapshotDate: typeof entry.snapshotDate === "string" ? entry.snapshotDate : snapshotDate,
        contextKind: String(entry.contextKind) as HetangStoreExternalContextEntry["contextKind"],
        metricKey: String(entry.metricKey),
        valueText: typeof entry.valueText === "string" ? entry.valueText : undefined,
        valueNum: typeof entry.valueNum === "number" ? entry.valueNum : undefined,
        valueJson: entry.valueJson,
        unit: typeof entry.unit === "string" ? entry.unit : undefined,
        truthLevel: String(entry.truthLevel) as HetangStoreExternalContextEntry["truthLevel"],
        confidence: String(entry.confidence) as HetangStoreExternalContextEntry["confidence"],
        sourceType: String(entry.sourceType),
        sourceLabel: typeof entry.sourceLabel === "string" ? entry.sourceLabel : undefined,
        sourceUri: typeof entry.sourceUri === "string" ? entry.sourceUri : undefined,
        applicableModules: Array.isArray(entry.applicableModules)
          ? entry.applicableModules.filter((item): item is string => typeof item === "string")
          : [],
        notForScoring: entry.notForScoring !== false,
        note: typeof entry.note === "string" ? entry.note : undefined,
        rawJson: typeof entry.rawJson === "string" ? entry.rawJson : JSON.stringify(entry),
        updatedAt: String(entry.updatedAt),
      };
    }),
  };
}

export async function importStoreExternalContextSnapshot(params: {
  store: StoreExternalContextImportStore;
  filePath: string;
  readFile?: (filePath: string) => Promise<string>;
  log?: (line: string) => void;
}): Promise<{
  orgId: string;
  snapshotDate: string;
  importedCount: number;
}> {
  const readText = params.readFile ?? (async (filePath: string) => await readFile(filePath, "utf8"));
  const snapshot = parseStoreExternalContextSnapshotDocument(
    JSON.parse(await readText(params.filePath)),
    params.filePath,
  );

  for (const entry of snapshot.entries) {
    await params.store.upsertStoreExternalContextEntry({
      orgId: entry.orgId,
      snapshotDate: entry.snapshotDate,
      contextKind: entry.contextKind,
      metricKey: entry.metricKey,
      valueText: entry.valueText,
      valueNum: entry.valueNum,
      valueJson: entry.valueJson,
      unit: entry.unit,
      truthLevel: entry.truthLevel,
      confidence: entry.confidence,
      sourceType: entry.sourceType,
      sourceLabel: entry.sourceLabel,
      sourceUri: entry.sourceUri,
      applicableModules: entry.applicableModules,
      notForScoring: entry.notForScoring,
      note: entry.note,
      rawJson: entry.rawJson,
      updatedAt: entry.updatedAt,
    });
  }

  params.log?.(
    `Imported ${snapshot.entries.length} store external context entries for org=${snapshot.orgId} snapshot=${snapshot.snapshotDate} from ${params.filePath}`,
  );

  return {
    orgId: snapshot.orgId,
    snapshotDate: snapshot.snapshotDate,
    importedCount: snapshot.entries.length,
  };
}
