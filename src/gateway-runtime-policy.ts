import path from "node:path";

const DEFAULT_HERMES_GATEWAY_SERVICE = "hermes-gateway.service";
const OPENCLAW_GATEWAY_SERVICE = "openclaw-gateway.service";

export type GatewayRecoveryTarget = {
  serviceName: string;
  checkPath: string;
  mode: "hermes" | "legacy";
};

export type HermesGatewayRuntimeConfigSummary = {
  smartModelRoutingEnabled?: boolean;
  cheapModel?: string;
  reasoningEffort?: string;
  compressionSummaryModel?: string;
  sessionResetIdleMinutes?: number;
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
  runtimeConfigPath?: string | null;
  runtimeConfig?: HermesGatewayRuntimeConfigSummary | null;
}): string[] {
  const lines = [
    `[hermes-gateway] runtime_home=${params.runtimeHome}`,
    `[hermes-gateway] config_file=${normalizeOptionalValue(params.runtimeConfigPath) ?? path.join(params.runtimeHome, "config.yaml")}`,
    `[hermes-gateway] bot_id=${summarizeBotId(params.botId)}`,
    `[hermes-gateway] bridge_url=${params.bridgeUrl}`,
    `[hermes-gateway] wecom_reply_mode=${normalizeOptionalValue(params.wecomReplyMode) ?? "default"}`,
  ];

  const runtimeConfig = params.runtimeConfig;
  if (runtimeConfig) {
    if (runtimeConfig.smartModelRoutingEnabled !== undefined || runtimeConfig.cheapModel) {
      lines.push(
        `[hermes-gateway] smart_model_routing=${runtimeConfig.smartModelRoutingEnabled ? "enabled" : "disabled"} cheap_model=${normalizeOptionalValue(runtimeConfig.cheapModel) ?? "unset"}`,
      );
    }
    if (
      runtimeConfig.reasoningEffort ||
      runtimeConfig.compressionSummaryModel ||
      runtimeConfig.sessionResetIdleMinutes !== undefined
    ) {
      lines.push(
        `[hermes-gateway] reasoning_effort=${normalizeOptionalValue(runtimeConfig.reasoningEffort) ?? "default"} compression_summary_model=${normalizeOptionalValue(runtimeConfig.compressionSummaryModel) ?? "default"} session_reset_idle_minutes=${runtimeConfig.sessionResetIdleMinutes ?? "default"}`,
      );
    }
  }

  lines.push(
    "[hermes-gateway] route_mode=general_on_hermes,business_on_htops",
    "[hermes-gateway] openclaw_runtime=disabled",
  );
  return lines;
}

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseBooleanLiteral(value: string): boolean | undefined {
  const normalized = stripOptionalQuotes(value).toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return undefined;
}

function parseIntegerLiteral(value: string): number | undefined {
  const normalized = stripOptionalQuotes(value);
  if (!/^-?\d+$/u.test(normalized)) {
    return undefined;
  }
  return Number.parseInt(normalized, 10);
}

export function extractHermesGatewayRuntimeConfigSummary(
  rawConfig: string,
): HermesGatewayRuntimeConfigSummary {
  const summary: HermesGatewayRuntimeConfigSummary = {};
  let section: string | undefined;
  let subsection: string | undefined;

  for (const rawLine of rawConfig.split(/\r?\n/gu)) {
    const line = rawLine.replace(/\s+#.*$/u, "").replace(/\t/gu, "    ");
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const indent = line.match(/^\s*/u)?.[0].length ?? 0;
    const sectionMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*$/u);
    const keyValueMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.+)$/u);
    if (!sectionMatch && !keyValueMatch) {
      continue;
    }

    if (indent === 0 && sectionMatch) {
      section = sectionMatch[1];
      subsection = undefined;
      continue;
    }

    if (!section) {
      continue;
    }

    if (indent === 2 && sectionMatch) {
      subsection = sectionMatch[1];
      continue;
    }

    if (!keyValueMatch) {
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    const value = stripOptionalQuotes(rawValue);

    if (indent === 2) {
      subsection = undefined;
      if (section === "agent" && key === "reasoning_effort") {
        summary.reasoningEffort = value;
      } else if (section === "compression" && key === "summary_model") {
        summary.compressionSummaryModel = value;
      } else if (section === "smart_model_routing" && key === "enabled") {
        summary.smartModelRoutingEnabled = parseBooleanLiteral(value);
      } else if (section === "session_reset" && key === "idle_minutes") {
        summary.sessionResetIdleMinutes = parseIntegerLiteral(value);
      }
      continue;
    }

    if (indent === 4 && section === "smart_model_routing" && subsection === "cheap_model" && key === "model") {
      summary.cheapModel = value;
    }
  }

  return summary;
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
