import { describe, expect, it } from "vitest";

import {
  buildHermesGatewayRuntimeSummary,
  extractHermesGatewayRuntimeConfigSummary,
  resolveGatewayRecoveryTarget,
  summarizeBotId,
} from "./gateway-runtime-policy.js";

describe("resolveGatewayRecoveryTarget", () => {
  it("defaults the active recovery target to hermes-gateway.service", () => {
    expect(
      resolveGatewayRecoveryTarget({
        rootDir: "/root/htops",
      }),
    ).toEqual({
      serviceName: "hermes-gateway.service",
      checkPath: "/root/htops/ops/hermes-gateway.sh",
      mode: "hermes",
    });
  });

  it("rejects stale openclaw recovery targets", () => {
    expect(() =>
      resolveGatewayRecoveryTarget({
        rootDir: "/root/htops",
        serviceName: "openclaw-gateway.service",
        distEntry: "/root/openclaw/dist/index.js",
      }),
    ).toThrow(/OpenClaw recovery target is no longer allowed/u);
  });

  it("keeps explicit hermes recovery targets", () => {
    expect(
      resolveGatewayRecoveryTarget({
        rootDir: "/root/htops",
        serviceName: "hermes-gateway.service",
        distEntry: "/root/htops/ops/hermes-gateway.sh",
      }),
    ).toEqual({
      serviceName: "hermes-gateway.service",
      checkPath: "/root/htops/ops/hermes-gateway.sh",
      mode: "hermes",
    });
  });
});

describe("summarizeBotId", () => {
  it("returns a stable suffix-only bot summary", () => {
    expect(summarizeBotId("aibIuOS-LnHFuu1WkuuJcELLusRx7mhVvcy")).toBe("...7mhVvcy");
  });

  it("returns unknown when the bot id is absent", () => {
    expect(summarizeBotId(undefined)).toBe("unknown");
  });
});

describe("buildHermesGatewayRuntimeSummary", () => {
  it("renders a normalized startup summary for operators", () => {
    expect(
      buildHermesGatewayRuntimeSummary({
        runtimeHome: "/root/htops/.hermes-runtime",
        bridgeUrl: "http://127.0.0.1:18891",
        botId: "aibIuOS-LnHFuu1WkuuJcELLusRx7mhVvcy",
        wecomReplyMode: "proactive-send",
        runtimeConfigPath: "/root/htops/.hermes-runtime/config.yaml",
        runtimeConfig: {
          smartModelRoutingEnabled: true,
          cheapModel: "gpt-5.4-mini",
          reasoningEffort: "low",
          compressionSummaryModel: "gpt-5.4-mini",
          sessionResetIdleMinutes: 120,
        },
      }),
    ).toEqual([
      "[hermes-gateway] runtime_home=/root/htops/.hermes-runtime",
      "[hermes-gateway] config_file=/root/htops/.hermes-runtime/config.yaml",
      "[hermes-gateway] bot_id=...7mhVvcy",
      "[hermes-gateway] bridge_url=http://127.0.0.1:18891",
      "[hermes-gateway] wecom_reply_mode=proactive-send",
      "[hermes-gateway] smart_model_routing=enabled cheap_model=gpt-5.4-mini",
      "[hermes-gateway] reasoning_effort=low compression_summary_model=gpt-5.4-mini session_reset_idle_minutes=120",
      "[hermes-gateway] route_mode=general_on_hermes,business_on_htops",
      "[hermes-gateway] openclaw_runtime=disabled",
    ]);
  });
});

describe("extractHermesGatewayRuntimeConfigSummary", () => {
  it("extracts the active routing and latency-relevant knobs from runtime config yaml", () => {
    expect(
      extractHermesGatewayRuntimeConfigSummary(`
model:
  default: gpt-5.4
agent:
  reasoning_effort: low
compression:
  summary_model: gpt-5.4-mini
smart_model_routing:
  enabled: true
  cheap_model:
    provider: main
    model: gpt-5.4-mini
session_reset:
  idle_minutes: 120
`),
    ).toEqual({
      smartModelRoutingEnabled: true,
      cheapModel: "gpt-5.4-mini",
      reasoningEffort: "low",
      compressionSummaryModel: "gpt-5.4-mini",
      sessionResetIdleMinutes: 120,
    });
  });
});
