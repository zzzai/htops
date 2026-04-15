import { resolveGatewayRecoveryTarget } from "../src/gateway-runtime-policy.js";
import { loadStandaloneRuntimeEnv, resolveStandaloneRootDir } from "../src/standalone-env.js";

function shellEscape(value: string): string {
  return `'${value.replace(/'/gu, `'\\''`)}'`;
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();

  const rootDir = resolveStandaloneRootDir();
  const target = resolveGatewayRecoveryTarget({
    rootDir,
    serviceName: process.env.HETANG_GATEWAY_SERVICE_NAME,
    distEntry: process.env.HETANG_GATEWAY_DIST_ENTRY,
    gatewayRootDir: process.env.HETANG_GATEWAY_ROOT_DIR,
  });

  console.log(`SERVICE_NAME=${shellEscape(target.serviceName)}`);
  console.log(`CHECK_PATH=${shellEscape(target.checkPath)}`);
  console.log(`RECOVERY_MODE=${shellEscape(target.mode)}`);
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
