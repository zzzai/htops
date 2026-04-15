import http from "node:http";
import type { AddressInfo } from "node:net";
import type { HetangLogger } from "../types.js";
import type {
  HetangBridgeCapabilities,
  HetangBridgeCommandRequest,
  HetangBridgeInboundRequest,
  HetangBridgeResponse,
} from "./contracts.js";

const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000;

function writeJson(
  response: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function normalizeTokenHeader(value: string | string[] | undefined): string | undefined {
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

function cloneBridgeResponse(response: HetangBridgeResponse): HetangBridgeResponse {
  return JSON.parse(JSON.stringify(response)) as HetangBridgeResponse;
}

function resolveDedupeKey(body: Record<string, unknown>): string | undefined {
  const requestId =
    typeof body.request_id === "string" && body.request_id.trim() ? body.request_id.trim() : null;
  if (requestId) {
    return `request:${requestId}`;
  }
  const platformMessageId =
    typeof body.platform_message_id === "string" && body.platform_message_id.trim()
      ? body.platform_message_id.trim()
      : null;
  if (platformMessageId) {
    return `platform:${platformMessageId}`;
  }
  return undefined;
}

export type HetangBridgeRequestContext = {
  ip?: string;
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
};

export type HetangBridgeServer = {
  readonly baseUrl: string;
  listen: () => Promise<void>;
  close: () => Promise<void>;
};

export function createHetangBridgeServer(params: {
  token: string;
  host: string;
  port: number;
  logger: HetangLogger;
  dedupeTtlMs?: number;
  describeCapabilities: () => HetangBridgeCapabilities;
  handleCommandMessage: (
    request: HetangBridgeCommandRequest,
    ctx: HetangBridgeRequestContext,
  ) => Promise<HetangBridgeResponse>;
  handleInboundMessage: (
    request: HetangBridgeInboundRequest,
    ctx: HetangBridgeRequestContext,
  ) => Promise<HetangBridgeResponse>;
}): HetangBridgeServer {
  const dedupeTtlMs = params.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
  const dedupeCache = new Map<string, { expiresAt: number; response: HetangBridgeResponse }>();
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

      const providedToken = normalizeTokenHeader(request.headers["x-htops-bridge-token"]);
      if (!providedToken || providedToken !== params.token) {
        writeJson(response, 401, { ok: false, error: "unauthorized" });
        return;
      }

      if (method === "GET" && path === "/v1/capabilities") {
        writeJson(response, 200, {
          ok: true,
          capabilities: params.describeCapabilities(),
        });
        return;
      }

      if (method !== "POST") {
        writeJson(response, 405, { ok: false, error: "method_not_allowed" });
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
          writeJson(response, 200, cloneBridgeResponse(cached.response) as Record<string, unknown>);
          return;
        }
      }

      const context: HetangBridgeRequestContext = {
        ip: request.socket.remoteAddress,
        method,
        path,
        headers: {
          "content-type": normalizeTokenHeader(request.headers["content-type"]),
          "user-agent": normalizeTokenHeader(request.headers["user-agent"]),
          "x-request-id": normalizeTokenHeader(request.headers["x-request-id"]),
        },
      };

      let result: HetangBridgeResponse;
      if (path === "/v1/messages/command") {
        result = await params.handleCommandMessage(parsed as HetangBridgeCommandRequest, context);
      } else if (path === "/v1/messages/inbound") {
        result = await params.handleInboundMessage(parsed as HetangBridgeInboundRequest, context);
      } else {
        writeJson(response, 404, { ok: false, error: "not_found" });
        return;
      }

      if (dedupeKey) {
        dedupeCache.set(dedupeKey, {
          expiresAt: Date.now() + dedupeTtlMs,
          response: cloneBridgeResponse(result),
        });
      }
      writeJson(response, 200, result as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.error(`hetang-bridge: request failed: ${message}`);
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
          params.logger.info(`hetang-bridge: listening on ${baseUrl}`);
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

export async function closeHetangBridgeServer(server: HetangBridgeServer): Promise<void> {
  await server.close();
}
