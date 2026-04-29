import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHetangToolsService, HetangToolError } from "./handlers.js";
import type { HetangLogger, HetangOpsConfig } from "../types.js";
import type {
  HetangToolCallRequest,
  HetangToolsCapabilities,
  HetangToolErrorResponse,
  HetangToolSuccessResponse,
} from "./contracts.js";

const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;
const TOOLS_REQUEST_DEDUPE_KEY_FIELDS = ["request_id"] as const;

function writeJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizeHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]?.trim();
  }
  return value?.trim();
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveDedupeKey(body: Record<string, unknown>): string | undefined {
  const requestId =
    typeof body.request_id === "string" && body.request_id.trim() ? body.request_id.trim() : null;
  return requestId ? `request:${requestId}` : undefined;
}

export type HetangToolsServer = {
  readonly baseUrl: string;
  listen: () => Promise<void>;
  close: () => Promise<void>;
};

export type { HetangToolCallRequest } from "./contracts.js";

export function createHetangToolsServer(params: {
  token: string;
  host: string;
  port: number;
  config: HetangOpsConfig;
  runtime: Parameters<typeof createHetangToolsService>[0]["runtime"];
  logger: HetangLogger;
  now?: () => Date;
  dedupeTtlMs?: number;
}): HetangToolsServer {
  const tools = createHetangToolsService({
    config: params.config,
    runtime: params.runtime,
    logger: params.logger,
    now: params.now,
  });
  const dedupeTtlMs = params.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
  const dedupeCache = new Map<
    string,
    { expiresAt: number; response: HetangToolSuccessResponse | HetangToolErrorResponse }
  >();
  let baseUrl = `http://${params.host}:${params.port}`;

  const cleanupDedupeCache = () => {
    const now = Date.now();
    for (const [key, entry] of dedupeCache.entries()) {
      if (entry.expiresAt <= now) {
        dedupeCache.delete(key);
      }
    }
  };

  const server = http.createServer(async (request, response) => {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", baseUrl);
      const path = url.pathname;

      if (method === "GET" && path === "/health") {
        writeJson(response, 200, { ok: true });
        return;
      }

      const providedToken = normalizeHeader(request.headers["x-htops-tools-token"]);
      if (!providedToken || providedToken !== params.token) {
        writeJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }

      if (method === "GET" && path === "/v1/tools/capabilities") {
        const capabilities = tools.describeCapabilities();
        writeJson(response, 200, {
          ok: true,
          capabilities: {
            ...capabilities,
            request_dedupe: {
              scope: "tools_http",
              key_fields: Array.from(TOOLS_REQUEST_DEDUPE_KEY_FIELDS),
              ttl_ms: dedupeTtlMs,
            },
          } satisfies HetangToolsCapabilities,
        });
        return;
      }

      if (method !== "POST" || path !== "/v1/tools/call") {
        writeJson(response, 404, { ok: false, error: "not_found" });
        return;
      }

      const parsed = await readJsonBody(request);
      if (!isRecord(parsed)) {
        writeJson(response, 400, { ok: false, error: "invalid_json_body" });
        return;
      }

      cleanupDedupeCache();
      const dedupeKey = resolveDedupeKey(parsed);
      if (dedupeKey) {
        const cached = dedupeCache.get(dedupeKey);
        if (cached) {
          const statusCode = cached.response.ok ? 200 : 400;
          writeJson(response, statusCode, cloneJson(cached.response) as Record<string, unknown>);
          return;
        }
      }

      const result = await tools.handleToolCall(parsed as HetangToolCallRequest);
      if (dedupeKey) {
        dedupeCache.set(dedupeKey, {
          expiresAt: Date.now() + dedupeTtlMs,
          response: cloneJson(result),
        });
      }
      writeJson(response, 200, result as Record<string, unknown>);
    } catch (error) {
      if (error instanceof HetangToolError) {
        writeJson(response, error.statusCode, {
          ok: false,
          error: error.errorCode,
          detail: error.message,
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      params.logger.error(`htops-tools: request failed: ${message}`);
      writeJson(response, 500, { ok: false, error: "internal_error" });
    }
  });

  return {
    get baseUrl() {
      return baseUrl;
    },
    async listen() {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(params.port, params.host, () => {
          server.off("error", reject);
          const address = server.address() as AddressInfo | null;
          if (address) {
            baseUrl = `http://${address.address}:${address.port}`;
          }
          params.logger.info(`htops-tools: listening on ${baseUrl}`);
          resolve();
        });
      });
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

export async function closeHetangToolsServer(server: HetangToolsServer): Promise<void> {
  await server.close();
}
