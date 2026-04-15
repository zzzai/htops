import { runCommandWithTimeout } from "../src/command-runner.js";
import { HetangOpsRuntime } from "../src/runtime.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "../src/standalone-env.js";
import type { HetangOpsConfig } from "../src/types.js";

async function loadHetangConfig(): Promise<HetangOpsConfig> {
  return await loadStandaloneHetangConfig();
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const config = await loadHetangConfig();
  const runtime = new HetangOpsRuntime({
    config,
    logger: {
      info: (message) => console.log(message),
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
      debug: () => {},
    },
    resolveStateDir: () => resolveStandaloneStateDir(),
    runCommandWithTimeout,
  });

  try {
    const lines = await runtime.runDueJobs(new Date());
    for (const line of lines) {
      console.log(line);
    }
  } finally {
    await runtime.close();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
