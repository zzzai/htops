type HetangRuntimeShellParams = {
  getCurrentServingVersion: () => Promise<string>;
  executeCompiledServingQuery: (
    sql: string,
    queryParams?: unknown[],
  ) => Promise<Record<string, unknown>[]>;
  renderDoctorReport: () => Promise<string>;
};

export class HetangRuntimeShell {
  private compiledServingCache = new Map<
    string,
    {
      expiresAt: number;
      rows: Record<string, unknown>[];
    }
  >();

  constructor(private readonly params: HetangRuntimeShellParams) {}

  async getCurrentServingVersion(): Promise<string> {
    return await this.params.getCurrentServingVersion();
  }

  async executeCompiledServingQuery(params: {
    sql: string;
    queryParams?: unknown[];
    cacheKey?: string;
    ttlSeconds?: number;
  }): Promise<Record<string, unknown>[]> {
    const now = Date.now();
    if (params.cacheKey) {
      const cached = this.compiledServingCache.get(params.cacheKey);
      if (cached && cached.expiresAt > now) {
        return cached.rows;
      }
      if (cached && cached.expiresAt <= now) {
        this.compiledServingCache.delete(params.cacheKey);
      }
    }

    const rows = await this.params.executeCompiledServingQuery(
      params.sql,
      params.queryParams ?? [],
    );
    if (params.cacheKey && (params.ttlSeconds ?? 0) > 0) {
      this.compiledServingCache.set(params.cacheKey, {
        expiresAt: now + (params.ttlSeconds ?? 0) * 1000,
        rows,
      });
    }
    return rows;
  }

  async doctor(): Promise<string> {
    return await this.params.renderDoctorReport();
  }
}
