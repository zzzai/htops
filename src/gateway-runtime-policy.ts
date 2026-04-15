import path from "node:path";

const DEFAULT_HERMES_GATEWAY_SERVICE = "hermes-gateway.service";
const OPENCLAW_GATEWAY_SERVICE = "openclaw-gateway.service";

export type GatewayRecoveryTarget = {
  serviceName: string;
  checkPath: string;
  mode: "hermes" | "legacy";
};

function normalizeOptionalValue(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function looksLikeOpenClawPath(value?: string): boolean {
  return !!value && /(?:^|\/)openclaw(?:\/|$)/u.test(value);
}

export function summarizeBotId(botId?: string | null): string {
  const normalized = normalizeOptionalValue(botId);
  if (!normalized) {
    return "unknown";
  }
  if (normalized.length <= 8) {
    return normalized;
  }
  return `...${normalized.slice(-7)}`;
}

export function buildHermesGatewayRuntimeSummary(params: {
  runtimeHome: string;
  bridgeUrl: string;
  botId?: string | null;
  wecomReplyMode?: string | null;
}): string[] {
  return [
    `[hermes-gateway] runtime_home=${params.runtimeHome}`,
    `[hermes-gateway] bot_id=${summarizeBotId(params.botId)}`,
    `[hermes-gateway] bridge_url=${params.bridgeUrl}`,
    `[hermes-gateway] wecom_reply_mode=${normalizeOptionalValue(params.wecomReplyMode) ?? "default"}`,
    "[hermes-gateway] route_mode=general_on_hermes,business_on_htops",
    "[hermes-gateway] openclaw_runtime=disabled",
  ];
}

export function resolveGatewayRecoveryTarget(params: {
  rootDir: string;
  serviceName?: string | null;
  distEntry?: string | null;
  gatewayRootDir?: string | null;
}): GatewayRecoveryTarget {
  const serviceName = normalizeOptionalValue(params.serviceName) ?? DEFAULT_HERMES_GATEWAY_SERVICE;
  const distEntry = normalizeOptionalValue(params.distEntry);
  const gatewayRootDir = normalizeOptionalValue(params.gatewayRootDir);

  if (
    serviceName === OPENCLAW_GATEWAY_SERVICE ||
    looksLikeOpenClawPath(distEntry) ||
    looksLikeOpenClawPath(gatewayRootDir)
  ) {
    throw new Error("OpenClaw recovery target is no longer allowed for the active htops runtime.");
  }

  if (serviceName === DEFAULT_HERMES_GATEWAY_SERVICE) {
    return {
      serviceName,
      checkPath: distEntry ?? path.join(params.rootDir, "ops", "hermes-gateway.sh"),
      mode: "hermes",
    };
  }

  return {
    serviceName,
    checkPath: distEntry ?? path.join(params.rootDir, "ops", "hermes-gateway.sh"),
    mode: "legacy",
  };
}
