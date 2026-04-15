import {
  getCurrentServingVersion as readCurrentServingVersion,
  publishServingManifest as writeServingManifest,
} from "./serving-manifest.js";

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export type ServingQueryStore = {
  publishServingManifest: (
    servingVersion: string,
    publishedAt: string,
    notes?: string,
  ) => Promise<void>;
  getCurrentServingVersion: () => Promise<string | null>;
  executeCompiledServingQuery: (
    sql: string,
    params?: unknown[],
  ) => Promise<Record<string, unknown>[]>;
};

export function createServingQueryStore(queryable: Queryable): ServingQueryStore {
  return {
    publishServingManifest: async (servingVersion, publishedAt, notes) => {
      await writeServingManifest(queryable, servingVersion, publishedAt, notes);
    },
    getCurrentServingVersion: async () => await readCurrentServingVersion(queryable),
    executeCompiledServingQuery: async (sql, params = []) => {
      const result = await queryable.query(sql, params);
      return result.rows as Record<string, unknown>[];
    },
  };
}
