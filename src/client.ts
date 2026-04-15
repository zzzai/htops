import { randomUUID } from "node:crypto";
import { createApiSign } from "./sign.js";
import type { EndpointCode, HetangApiConfig, HetangClientLike } from "./types.js";

const ENDPOINT_PATHS: Record<EndpointCode, string> = {
  "1.1": "GetCustomersList",
  "1.2": "GetConsumeBillList",
  "1.3": "GetRechargeBillList",
  "1.4": "GetUserTradeList",
  "1.5": "GetPersonList",
  "1.6": "GetTechUpClockList",
  "1.7": "GetTechMarketList",
  "1.8": "GetTechCommissionSetList",
};

function isArrayOfObjects(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("Unexpected API payload shape");
  }
  const record = payload as Record<string, unknown>;
  for (const key of ["Data", "data", "Result", "result", "Rows", "rows", "Items", "items"]) {
    if (isArrayOfObjects(record[key])) {
      return record[key];
    }
  }
  if (record.Success === false || record.success === false) {
    throw new Error(String(record.Message ?? record.message ?? "API request failed"));
  }
  if (normalizeStatusCode(record) !== 0 && normalizeStatusCode(record) !== 200) {
    const message = String(record.Message ?? record.message ?? record.Msg ?? "API request failed");
    if (message && message !== "undefined") {
      throw new Error(message);
    }
  }
  if (record.RetData !== undefined) {
    return extractRows(record.RetData);
  }
  return [];
}

function normalizeStatusCode(record: Record<string, unknown>): number {
  const value = record.Code ?? record.code ?? record.Status ?? record.status ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function retry<T>(attempts: number, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (index === attempts - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, (index + 1) * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export class HetangApiClient implements HetangClientLike {
  constructor(
    private readonly config: HetangApiConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private buildUrl(endpoint: EndpointCode): string {
    return `${this.config.baseUrl.replace(/\/+$/u, "")}/${ENDPOINT_PATHS[endpoint]}`;
  }

  private async post(endpoint: EndpointCode, params: Record<string, unknown>): Promise<unknown[]> {
    if (!this.config.appSecret) {
      throw new Error("Hetang API credentials are not configured");
    }
    const signedParams = {
      ...params,
      Sign: createApiSign(params, this.config.appSecret),
    };
    const payload = await retry(this.config.maxRetries, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await this.fetchImpl(this.buildUrl(endpoint), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json;charset=UTF-8",
            "x-request-id": randomUUID(),
          },
          body: JSON.stringify(signedParams),
          signal: controller.signal,
        });
        const text = await response.text();
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
        }
        return text.length > 0 ? JSON.parse(text) : [];
      } finally {
        clearTimeout(timer);
      }
    });

    return extractRows(payload);
  }

  async fetchPaged(
    endpoint: "1.1" | "1.2" | "1.3",
    params: Record<string, unknown>,
  ): Promise<unknown[]> {
    const rows: unknown[] = [];
    let pageIndex = 1;
    for (;;) {
      const pageRows = await this.post(endpoint, {
        ...params,
        PageIndex: pageIndex,
        PageSize: this.config.pageSize,
      });
      rows.push(...pageRows);
      if (pageRows.length < this.config.pageSize) {
        break;
      }
      pageIndex += 1;
      if (pageIndex > 10_000) {
        throw new Error(`Paged endpoint ${endpoint} exceeded safety page limit`);
      }
    }
    return rows;
  }

  fetchUserTrades(params: Record<string, unknown>): Promise<unknown[]> {
    return this.post("1.4", params);
  }

  fetchTechList(params: Record<string, unknown>): Promise<unknown[]> {
    return this.post("1.5", params);
  }

  fetchTechUpClockList(params: Record<string, unknown>): Promise<unknown[]> {
    return this.post("1.6", params);
  }

  fetchTechMarketList(params: Record<string, unknown>): Promise<unknown[]> {
    return this.post("1.7", params);
  }

  fetchTechCommissionSetList(params: Record<string, unknown>): Promise<unknown[]> {
    return this.post("1.8", params);
  }
}
