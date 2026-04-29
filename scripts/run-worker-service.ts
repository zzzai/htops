import { runCommandWithTimeout } from "../src/command-runner.js";
import { createHetangOpsRuntime } from "../src/runtime.js";
import { createHetangOpsService } from "../src/service.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "../src/standalone-env.js";
import type { HetangServiceWorkerMode } from "../src/types.js";

type Args = {
  mode: HetangServiceWorkerMode;
};

function parseArgs(argv: string[]): Args {
  let mode: HetangServiceWorkerMode = "all";
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--mode":
        if (!next) {
          throw new Error("--mode requires a value");
        }
        if (next !== "all" && next !== "scheduled" && next !== "analysis") {
          throw new Error("--mode must be one of: all, scheduled, analysis");
        }
        mode = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }
  return { mode };
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const config = await loadStandaloneHetangConfig();
  const runtime = createHetangOpsRuntime({
    config,
    logger: {
      info: (message) => console.log(message),
      warn: (message) => console.warn(message),
      error: (message) => console.error(message),
      debug: () => {},
    },
    resolveStateDir: () => resolveStandaloneStateDir(),
    runCommandWithTimeout,
    poolRole: args.mode === "analysis" ? "analysis" : "sync",
  });
  const service = createHetangOpsService(runtime, {
    mode: args.mode,
    schedulePollIntervalMs: config.service.scheduledPollIntervalMs,
    analysisPollIntervalMs: config.service.analysisPollIntervalMs,
    unrefTimers: false,
  });

  if (!service.start) {
    throw new Error("worker service start handler is unavailable");
  }
  await service.start();
  console.log(
    `[hetang-worker] started mode=${args.mode} schedulePoll=${config.service.scheduledPollIntervalMs}ms analysisPoll=${config.service.analysisPollIntervalMs}ms`,
  );

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[hetang-worker] received ${signal}, stopping`);
    await service.stop?.();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
