import { readFile } from "node:fs/promises";

import type {
  HetangIndustryContextSignalKind,
  HetangIndustryContextSnapshotRecord,
  HetangStoreExternalContextConfidence,
  OperatingWorldTruthBoundary,
} from "./types.js";

type IndustryContextSnapshotDocument = {
  snapshotDate: string;
  items: HetangIndustryContextSnapshotRecord[];
};

type IndustryContextImportStore = {
  upsertIndustryContextSnapshot: (row: {
    snapshotDate: string;
    signalKind: HetangIndustryContextSignalKind;
    signalKey: string;
    title: string;
    summary: string;
    detailJson?: unknown;
    truthBoundary?: OperatingWorldTruthBoundary;
    confidence: HetangStoreExternalContextConfidence;
    sourceType: string;
    sourceLabel?: string;
    sourceUri?: string;
    applicableModules?: string[];
    note?: string;
    rawJson?: string;
    updatedAt: string;
  }) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function requiredString(
  value: unknown,
  fieldName: string,
  filePath: string,
  index?: number,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof index === "number") {
    throw new Error(`Missing ${fieldName} at index ${index}: ${filePath}`);
  }
  throw new Error(`Missing ${fieldName}: ${filePath}`);
}

function parseConfidence(
  value: unknown,
  filePath: string,
  index: number,
): HetangStoreExternalContextConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  throw new Error(`Invalid confidence at index ${index}: ${filePath}`);
}

function parseTruthBoundary(
  value: unknown,
  filePath: string,
  index: number,
): OperatingWorldTruthBoundary {
  if (value === undefined) {
    return "weak_signal";
  }
  if (value === "hard_fact" || value === "soft_fact" || value === "weak_signal") {
    return value;
  }
  throw new Error(`Invalid truthBoundary at index ${index}: ${filePath}`);
}

function parseSignalKind(
  value: unknown,
  filePath: string,
  index: number,
): HetangIndustryContextSignalKind {
  if (
    value === "industry_climate" ||
    value === "platform_rule" ||
    value === "city_consumption_trend" ||
    value === "capital_market_note"
  ) {
    return value;
  }
  throw new Error(`Invalid signalKind at index ${index}: ${filePath}`);
}

function parseIndustryContextSnapshotDocument(
  value: unknown,
  filePath: string,
): IndustryContextSnapshotDocument {
  if (!isRecord(value)) {
    throw new Error(`Invalid industry context snapshot: ${filePath}`);
  }

  const snapshotDate = requiredString(value.snapshotDate, "snapshotDate", filePath);
  if (!isIsoDate(snapshotDate)) {
    throw new Error(`Invalid snapshotDate: ${filePath}`);
  }

  const rawItems = value.items;
  if (!Array.isArray(rawItems)) {
    throw new Error(`Invalid industry context snapshot header: ${filePath}`);
  }

  return {
    snapshotDate,
    items: rawItems.map((item, index) => {
      if (!isRecord(item)) {
        throw new Error(`Invalid industry context item at index ${index}: ${filePath}`);
      }

      const itemSnapshotDate =
        typeof item.snapshotDate === "string" && item.snapshotDate.length > 0
          ? item.snapshotDate
          : snapshotDate;
      if (!isIsoDate(itemSnapshotDate)) {
        throw new Error(`Invalid snapshotDate at index ${index}: ${filePath}`);
      }

      return {
        snapshotDate: itemSnapshotDate,
        signalKind: parseSignalKind(item.signalKind, filePath, index),
        signalKey: requiredString(item.signalKey, "signalKey", filePath, index),
        title: requiredString(item.title, "title", filePath, index),
        summary: requiredString(item.summary, "summary", filePath, index),
        detailJson: item.detailJson,
        truthBoundary: parseTruthBoundary(item.truthBoundary, filePath, index),
        confidence: parseConfidence(item.confidence, filePath, index),
        sourceType: requiredString(item.sourceType, "sourceType", filePath, index),
        sourceLabel: typeof item.sourceLabel === "string" ? item.sourceLabel : undefined,
        sourceUri: typeof item.sourceUri === "string" ? item.sourceUri : undefined,
        applicableModules: Array.isArray(item.applicableModules)
          ? item.applicableModules.filter((entry): entry is string => typeof entry === "string")
          : [],
        note: typeof item.note === "string" ? item.note : undefined,
        rawJson: typeof item.rawJson === "string" ? item.rawJson : JSON.stringify(item),
        updatedAt: requiredString(item.updatedAt, "updatedAt", filePath, index),
      };
    }),
  };
}

export async function importIndustryContextSnapshot(params: {
  store: IndustryContextImportStore;
  filePath: string;
  readFile?: (filePath: string) => Promise<string>;
  log?: (line: string) => void;
}): Promise<{
  snapshotDate: string;
  importedCount: number;
}> {
  const readText = params.readFile ?? (async (filePath: string) => await readFile(filePath, "utf8"));
  const snapshot = parseIndustryContextSnapshotDocument(
    JSON.parse(await readText(params.filePath)),
    params.filePath,
  );

  for (const item of snapshot.items) {
    await params.store.upsertIndustryContextSnapshot({
      snapshotDate: item.snapshotDate,
      signalKind: item.signalKind,
      signalKey: item.signalKey,
      title: item.title,
      summary: item.summary,
      detailJson: item.detailJson,
      truthBoundary: item.truthBoundary,
      confidence: item.confidence,
      sourceType: item.sourceType,
      sourceLabel: item.sourceLabel,
      sourceUri: item.sourceUri,
      applicableModules: item.applicableModules,
      note: item.note,
      rawJson: item.rawJson,
      updatedAt: item.updatedAt,
    });
  }

  params.log?.(
    `Imported ${snapshot.items.length} industry context items for snapshot=${snapshot.snapshotDate} from ${params.filePath}`,
  );

  return {
    snapshotDate: snapshot.snapshotDate,
    importedCount: snapshot.items.length,
  };
}
