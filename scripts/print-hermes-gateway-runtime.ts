import fs from "node:fs/promises";

import {
  buildHermesGatewayRuntimeSummary,
  extractHermesGatewayRuntimeConfigSummary,
} from "../src/gateway-runtime-policy.js";
import { loadStandaloneRuntimeEnv, resolveStandaloneRootDir } from "../src/standalone-env.js";

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();

  const rootDir = resolveStandaloneRootDir();
  const runtimeHome =
    process.env.HETANG_HERMES_HOME_DIR?.trim() || `${rootDir}/.hermes-runtime`;
  const bridgeUrl =
    process.env.HETANG_BRIDGE_URL?.trim() ||
    `http://${process.env.HETANG_BRIDGE_HOST?.trim() || "127.0.0.1"}:${process.env.HETANG_BRIDGE_PORT?.trim() || "18891"}`;
  const botId = process.env.WECOM_BOT_ID?.trim() || process.env.HETANG_WECOM_BOT_ID?.trim();
  const explicitReplyMode = process.env.HETANG_WECOM_REPLY_MODE?.trim();
  const wecomReplyMode = explicitReplyMode
    ? explicitReplyMode
    : process.env.HETANG_WECOM_FORCE_PROACTIVE_REPLY?.trim() === "true"
      ? "proactive-send"
      : "passive-text";
  const runtimeConfigPath = `${runtimeHome}/config.yaml`;
  let runtimeConfig = undefined;
  try {
    runtimeConfig = extractHermesGatewayRuntimeConfigSummary(
      await fs.readFile(runtimeConfigPath, "utf8"),
    );
  } catch {
    runtimeConfig = undefined;
  }

  for (const line of buildHermesGatewayRuntimeSummary({
    runtimeHome,
    bridgeUrl,
    botId,
    wecomReplyMode,
    runtimeConfigPath,
    runtimeConfig,
  })) {
    console.log(line);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
