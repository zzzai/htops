import { afterEach, describe, expect, it } from "vitest";
import {
  closeHetangBridgeServer,
  createHetangBridgeServer,
  type HetangBridgeRequestContext,
} from "./server.js";

const activeServers: Array<{ close: () => Promise<void> }> = [];
const describeLocalhost =
  process.env.HTOPS_ENABLE_LOCALHOST_TESTS === "1" ? describe : describe.skip;

afterEach(async () => {
  while (activeServers.length > 0) {
    const current = activeServers.pop();
    if (current) {
      await current.close();
    }
  }
});

async function startServer() {
  let commandCalls = 0;
  let inboundCalls = 0;
  const server = createHetangBridgeServer({
    token: "bridge-secret",
    host: "127.0.0.1",
    port: 0,
    dedupeTtlMs: 42_000,
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
    describeCapabilities: () => ({
      version: "v1",
      entries: ["command", "inbound"],
    }),
    handleCommandMessage: async () => {
      commandCalls += 1;
      return {
        ok: true,
        handled: true,
        reply: { mode: "immediate", text: "command ok" },
        job: null,
        audit: { entry: "command" },
      };
    },
    handleInboundMessage: async (_body, _ctx: HetangBridgeRequestContext) => {
      inboundCalls += 1;
      return {
        ok: true,
        handled: true,
        reply: { mode: "immediate", text: "inbound ok" },
        job: null,
        audit: { entry: "inbound" },
      };
    },
  });

  await server.listen();
  activeServers.push(server);
  return {
    server,
    counts: {
      get command() {
        return commandCalls;
      },
      get inbound() {
        return inboundCalls;
      },
    },
  };
}

describeLocalhost("createHetangBridgeServer", () => {
  it("rejects protected requests without the bridge token", async () => {
    const { server } = await startServer();

    const response = await fetch(`${server.baseUrl}/v1/capabilities`);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "unauthorized",
    });
  });

  it("returns capabilities and command replies when the token is valid", async () => {
    const { server, counts } = await startServer();

    const capabilitiesResponse = await fetch(`${server.baseUrl}/v1/capabilities`, {
      headers: {
        "X-Htops-Bridge-Token": "bridge-secret",
      },
    });
    const capabilities = await capabilitiesResponse.json();

    expect(capabilitiesResponse.status).toBe(200);
    expect(capabilities).toMatchObject({
      ok: true,
      capabilities: {
        version: "v1",
        request_dedupe: {
          scope: "bridge_http",
          key_fields: ["request_id", "platform_message_id"],
          ttl_ms: 42_000,
        },
      },
    });

    const commandResponse = await fetch(`${server.baseUrl}/v1/messages/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Htops-Bridge-Token": "bridge-secret",
      },
      body: JSON.stringify({
        request_id: "req-command-1",
        channel: "wecom",
        sender_id: "user-1",
        conversation_id: "conv-1",
        is_group: true,
        content: "/hetang help",
        received_at: "2026-04-10T20:00:00+08:00",
        command_name: "hetang",
        args: "help",
      }),
    });
    const body = await commandResponse.json();

    expect(commandResponse.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      reply: {
        text: "command ok",
      },
    });
    expect(counts.command).toBe(1);
  });

  it("deduplicates repeated inbound requests by request_id", async () => {
    const { server, counts } = await startServer();

    const payload = {
      request_id: "req-inbound-dup",
      channel: "wecom",
      sender_id: "user-1",
      conversation_id: "conv-1",
      is_group: false,
      content: "你是谁",
      received_at: "2026-04-10T20:00:00+08:00",
    };

    const first = await fetch(`${server.baseUrl}/v1/messages/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Htops-Bridge-Token": "bridge-secret",
      },
      body: JSON.stringify(payload),
    });
    const second = await fetch(`${server.baseUrl}/v1/messages/inbound`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Htops-Bridge-Token": "bridge-secret",
      },
      body: JSON.stringify(payload),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      reply: { text: "inbound ok" },
    });
    await expect(second.json()).resolves.toMatchObject({
      reply: { text: "inbound ok" },
    });
    expect(counts.inbound).toBe(1);
  });
});
