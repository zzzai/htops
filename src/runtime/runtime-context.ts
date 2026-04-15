import { Pool } from "pg";
import { HetangRuntimeShell } from "./runtime-shell.js";
import { HetangOpsStore } from "../store.js";
import type { HetangOpsConfig } from "../types.js";

export type HetangRuntimeContextPoolRole = "app" | "query" | "sync" | "analysis";

type RuntimeContextStore = Pick<
  HetangOpsStore,
  | "initialize"
  | "close"
  | "getCurrentServingVersion"
  | "executeCompiledServingQuery"
  | "ensureAnalyticsViewsReady"
>;

type RuntimeContextShell = Pick<
  HetangRuntimeShell,
  "getCurrentServingVersion" | "executeCompiledServingQuery" | "doctor"
>;

type RuntimeContextPool = Pick<Pool, "end">;

export type HetangRuntimeContextParams = {
  config: HetangOpsConfig;
  renderDoctorReport: () => Promise<string>;
  resolveStoreForShell?: () => Promise<Pick<
    HetangOpsStore,
    "getCurrentServingVersion" | "executeCompiledServingQuery"
  >>;
  poolRole?: HetangRuntimeContextPoolRole;
  databaseUrlOverride?: string;
  poolMaxOverride?: number;
  createPool?: (params: { connectionString: string; max: number }) => RuntimeContextPool;
  createStore?: (params: {
    pool: RuntimeContextPool;
    stores: Array<{
      orgId: string;
      storeName: string;
      rawAliases: string[];
    }>;
    deadLetterEnabled: boolean;
  }) => RuntimeContextStore;
  createRuntimeShell?: (params: {
    getCurrentServingVersion: () => Promise<string>;
    executeCompiledServingQuery: (
      params: {
        sql: string;
        queryParams?: unknown[];
        cacheKey?: string;
        ttlSeconds?: number;
      },
    ) => Promise<Record<string, unknown>[]>;
    renderDoctorReport: () => Promise<string>;
  }) => RuntimeContextShell;
};

export type HetangRuntimeDatabaseConnection = {
  url: string;
  poolMax: number;
};

function ensureAnalyticsViewsReady(store: RuntimeContextStore): Promise<void> {
  return typeof store.ensureAnalyticsViewsReady === "function"
    ? store.ensureAnalyticsViewsReady()
    : Promise.resolve();
}

export class HetangRuntimeContext {
  private pool: RuntimeContextPool | null = null;
  private store: RuntimeContextStore | null = null;
  private runtimeShell: RuntimeContextShell | null = null;
  private analyticsViewsVerified = false;

  constructor(private readonly params: HetangRuntimeContextParams) {}

  getDatabaseConnection(): HetangRuntimeDatabaseConnection {
    if (this.params.databaseUrlOverride) {
      return {
        url: this.params.databaseUrlOverride,
        poolMax: this.params.poolMaxOverride ?? this.params.config.database.queryPoolMax,
      };
    }

    switch (this.params.poolRole) {
      case "app":
        return {
          url: this.params.config.database.url,
          poolMax: this.params.poolMaxOverride ?? this.params.config.database.queryPoolMax,
        };
      case "analysis":
        return {
          url: this.params.config.database.analysisUrl ?? this.params.config.database.url,
          poolMax: this.params.poolMaxOverride ?? this.params.config.database.analysisPoolMax,
        };
      case "sync":
        return {
          url: this.params.config.database.syncUrl ?? this.params.config.database.url,
          poolMax: this.params.poolMaxOverride ?? this.params.config.database.syncPoolMax,
        };
      case "query":
      default:
        return {
          url:
            this.params.config.database.queryUrl ??
            this.params.config.database.syncUrl ??
            this.params.config.database.url,
          poolMax: this.params.poolMaxOverride ?? this.params.config.database.queryPoolMax,
        };
    }
  }

  markAnalyticsViewsVerified(): void {
    this.analyticsViewsVerified = true;
  }

  async getStore(): Promise<HetangOpsStore> {
    if (this.store) {
      if (!this.analyticsViewsVerified) {
        await ensureAnalyticsViewsReady(this.store);
        this.analyticsViewsVerified = true;
      }
      return this.store as HetangOpsStore;
    }

    const connection = this.getDatabaseConnection();
    this.pool =
      this.params.createPool?.({
        connectionString: connection.url,
        max: connection.poolMax,
      }) ??
      (new Pool({
        connectionString: connection.url,
        allowExitOnIdle: true,
        max: connection.poolMax,
      }) as RuntimeContextPool);

    this.store =
      this.params.createStore?.({
        pool: this.pool,
        stores: this.params.config.stores.map((entry) => ({
          orgId: entry.orgId,
          storeName: entry.storeName,
          rawAliases: entry.rawAliases,
        })),
        deadLetterEnabled: this.params.config.queue.deadLetterEnabled,
      }) ??
      new HetangOpsStore({
        pool: this.pool as Pool,
        stores: this.params.config.stores.map((entry) => ({
          orgId: entry.orgId,
          storeName: entry.storeName,
          rawAliases: entry.rawAliases,
        })),
        deadLetterEnabled: this.params.config.queue.deadLetterEnabled,
      });

    await this.store.initialize();
    await ensureAnalyticsViewsReady(this.store);
    this.analyticsViewsVerified = true;
    return this.store as HetangOpsStore;
  }

  getRuntimeShell(): RuntimeContextShell {
    if (!this.runtimeShell) {
      const shellParams = {
        getCurrentServingVersion: async () => {
          const store =
            (await this.params.resolveStoreForShell?.()) ?? (await this.getStore());
          return (await store.getCurrentServingVersion()) ?? "bootstrap";
        },
        executeCompiledServingQuery: async (params: {
          sql: string;
          queryParams?: unknown[];
          cacheKey?: string;
          ttlSeconds?: number;
        }) => {
          const store =
            (await this.params.resolveStoreForShell?.()) ?? (await this.getStore());
          return await store.executeCompiledServingQuery(params.sql, params.queryParams ?? []);
        },
        renderDoctorReport: this.params.renderDoctorReport,
      };
      this.runtimeShell =
        this.params.createRuntimeShell?.(shellParams) ??
        new HetangRuntimeShell({
          getCurrentServingVersion: shellParams.getCurrentServingVersion,
          executeCompiledServingQuery: async (sql, queryParams) =>
            await shellParams.executeCompiledServingQuery({
              sql,
              queryParams,
            }),
          renderDoctorReport: shellParams.renderDoctorReport,
        });
    }
    return this.runtimeShell;
  }

  async close(): Promise<void> {
    await this.store?.close();
    await this.pool?.end();
    this.store = null;
    this.pool = null;
    this.runtimeShell = null;
    this.analyticsViewsVerified = false;
  }
}
