import { runCommandWithTimeout } from "../src/command-runner.js";
import { runHermesSend } from "../src/hermes-send.js";
import { loadStandaloneRuntimeEnv, resolveStandaloneRootDir } from "../src/standalone-env.js";

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const result = await runHermesSend(process.argv.slice(2), {
    runCommandWithTimeout,
    cwd: resolveStandaloneRootDir(),
    projectRoot: resolveStandaloneRootDir(),
  });
  if (result.stdout?.trim()) {
    console.log(result.stdout.trim());
  }
  if (result.stderr?.trim()) {
    console.error(result.stderr.trim());
  }
  process.exitCode = result.code;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
