import { runCommandWithTimeout } from "../src/command-runner.js";
import { createHetangOpsRuntime } from "../src/runtime.js";
import { createHetangToolsServer } from "../src/tools/server.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "../src/standalone-env.js";

type Args = {
  host: string;
  port: number;
  token?: string;
  help: boolean;
};

function formatHelp(): string {
  return [
    "Usage: node --import tsx scripts/run-tools-service.ts [options]",
    "",
    "Options:",
    "  --host <host>    Tool facade bind host (default: 127.0.0.1 or HETANG_TOOLS_HOST)",
    "  --port <port>    Tool facade bind port (default: 18892 or HETANG_TOOLS_PORT)",
    "  --token <token>  Tool facade auth token (or HETANG_TOOLS_TOKEN / HETANG_BRIDGE_TOKEN)",
    "  --help           Show this help",
  ].join("\n");
}

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    host: process.env.HETANG_TOOLS_HOST?.trim() || "127.0.0.1",
    port: Number(process.env.HETANG_TOOLS_PORT?.trim() || "18892"),
    token:
      process.env.HETANG_TOOLS_TOKEN?.trim() || process.env.HETANG_BRIDGE_TOKEN?.trim() || undefined,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--host":
        if (!next) {
          throw new Error("--host requires a value");
        }
        parsed.host = next;
        index += 1;
        break;
      case "--port":
        if (!next) {
          throw new Error("--port requires a value");
        }
        parsed.port = Number(next);
        index += 1;
        break;
      case "--token":
        if (!next) {
          throw new Error("--token requires a value");
        }
        parsed.token = next;
        index += 1;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  if (!Number.isFinite(parsed.port) || parsed.port <= 0) {
    throw new Error("--port must be a positive number");
  }
  return parsed;
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(formatHelp());
    return;
  }
  if (!args.token) {
    throw new Error(
      "Missing tools token. Set HETANG_TOOLS_TOKEN / HETANG_BRIDGE_TOKEN or pass --token.",
    );
  }

  const config = await loadStandaloneHetangConfig();
  const logger = {
    info: (message: string) => console.log(message),
    warn: (message: string) => console.warn(message),
    error: (message: string) => console.error(message),
    debug: () => {},
  };
  const runtime = createHetangOpsRuntime({
    config,
    logger,
    resolveStateDir: () => resolveStandaloneStateDir(),
    runCommandWithTimeout,
    poolRole: "app",
  });
  const server = createHetangToolsServer({
    token: args.token,
    host: args.host,
    port: args.port,
    config,
    runtime,
    logger,
  });

  await server.listen();
  console.log(`[htops-tools] started ${server.baseUrl}`);

  const shutdown = async (signal: NodeJS.Signals) => {
    console.log(`[htops-tools] received ${signal}, stopping`);
    await server.close();
    await runtime.close();
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
