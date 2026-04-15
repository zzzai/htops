import { Command } from "commander";
import { registerHetangCli } from "./cli.js";
import { runCommandWithTimeout } from "./command-runner.js";
import { createHetangOpsRuntime } from "./runtime.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "./standalone-env.js";

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
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
    poolRole: "app",
  });

  const program = new Command();
  program.name("htops").description("Hetang standalone operations runtime");
  registerHetangCli({ program, runtime });

  try {
    const argv =
      process.argv[2] === "--"
        ? [process.argv[0], process.argv[1], ...process.argv.slice(3)]
        : process.argv;
    await program.parseAsync(argv);
  } finally {
    await runtime.close();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
