import { createServingQueryStore } from "../data-platform/serving/serving-query-store.js";

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export type PublishAnalyticsViewsParams = {
  rebuild?: boolean;
  force?: boolean;
  publishedAt?: string;
  servingVersion?: string;
  notes?: string;
};

export function resolveGeneratedServingVersion(publishedAt: string): string {
  const compact = publishedAt.replace(/[-:.TZ+]/gu, "");
  return `serving-${compact.slice(0, 14) || Date.now().toString()}`;
}

export class HetangServingPublicationStore {
  constructor(
    private readonly params: {
      queryable: Queryable;
      requiredRelations: readonly string[];
      isInitialized: () => boolean;
      isMaterialized: () => boolean;
      isDirty: () => boolean;
      markClean: () => void;
      rebuildAnalyticsViews: () => Promise<void>;
    },
  ) {}

  async refreshAnalyticsViews(): Promise<void> {
    if (!this.params.isInitialized() || !this.params.isMaterialized()) {
      return;
    }
    await this.params.queryable.query(`
      REFRESH MATERIALIZED VIEW mv_store_manager_daily_kpi;
      REFRESH MATERIALIZED VIEW mv_tech_profile_30d;
      REFRESH MATERIALIZED VIEW mv_customer_profile_90d;
      REFRESH MATERIALIZED VIEW mv_store_review_7d;
      REFRESH MATERIALIZED VIEW mv_store_summary_30d;
    `);
  }

  async relationExists(name: string): Promise<boolean> {
    const result = await this.params.queryable.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM pg_class AS relation
          INNER JOIN pg_namespace AS namespace
            ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'public'
            AND relation.relname = $1
            AND relation.relkind IN ('v', 'm')
        ) AS exists
      `,
      [name],
    );
    if (Boolean(result.rows[0]?.exists)) {
      return true;
    }
    if (!/^[a-z_][a-z0-9_]*$/u.test(name)) {
      return false;
    }
    try {
      await this.params.queryable.query(`SELECT 1 FROM ${name} LIMIT 0`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const normalizedMessage = message.toLowerCase();
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
      if (code === "42P01" || normalizedMessage.includes("does not exist")) {
        return false;
      }
      throw error;
    }
  }

  async ensureAnalyticsViewsReady(): Promise<void> {
    if (!this.params.isInitialized()) {
      return;
    }
    for (const relation of this.params.requiredRelations) {
      if (!(await this.relationExists(relation))) {
        await this.params.rebuildAnalyticsViews();
        this.params.markClean();
        return;
      }
    }
  }

  async publishAnalyticsViews(
    params: PublishAnalyticsViewsParams = {},
  ): Promise<string | null> {
    if (!this.params.isInitialized() || !this.params.isMaterialized()) {
      return null;
    }

    let needsRefresh = params.force === true || params.rebuild === true || this.params.isDirty();
    if (!needsRefresh) {
      for (const relation of this.params.requiredRelations) {
        if (!(await this.relationExists(relation))) {
          needsRefresh = true;
          params.rebuild = true;
          break;
        }
      }
    }

    if (needsRefresh) {
      if (params.rebuild) {
        await this.params.rebuildAnalyticsViews();
      } else {
        await this.refreshAnalyticsViews();
      }
      this.params.markClean();
    }

    const shouldPublishManifest =
      typeof params.publishedAt === "string" ||
      typeof params.servingVersion === "string" ||
      typeof params.notes === "string";
    if (!shouldPublishManifest) {
      return null;
    }

    const publishedAt = params.publishedAt ?? new Date().toISOString();
    const servingVersion = params.servingVersion ?? resolveGeneratedServingVersion(publishedAt);
    const servingStore = createServingQueryStore(this.params.queryable);
    await servingStore.publishServingManifest(servingVersion, publishedAt, params.notes);
    return servingVersion;
  }

  async forceRebuildAnalyticsViews(): Promise<void> {
    await this.publishAnalyticsViews({
      rebuild: true,
      force: true,
    });
  }

  async publishServingManifest(
    servingVersion: string,
    publishedAt: string,
    notes?: string,
  ): Promise<void> {
    const servingStore = createServingQueryStore(this.params.queryable);
    await servingStore.publishServingManifest(servingVersion, publishedAt, notes);
  }

  async getCurrentServingVersion(): Promise<string | null> {
    const servingStore = createServingQueryStore(this.params.queryable);
    return await servingStore.getCurrentServingVersion();
  }

  async executeCompiledServingQuery(
    sql: string,
    params: unknown[] = [],
  ): Promise<Record<string, unknown>[]> {
    const servingStore = createServingQueryStore(this.params.queryable);
    return await servingStore.executeCompiledServingQuery(sql, params);
  }
}
