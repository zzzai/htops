import { runCommandWithTimeout } from "../src/command-runner.js";
import { createHetangOpsRuntime } from "../src/runtime.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "../src/standalone-env.js";
import type { HetangNotificationTarget, HetangOpsConfig } from "../src/types.js";

type Args = {
  weekEndBizDate?: string;
  channel: string;
  target?: string;
  accountId?: string;
  threadId?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    channel: "wecom",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--date":
        if (!next) {
          throw new Error("--date requires a value");
        }
        args.weekEndBizDate = next;
        index += 1;
        break;
      case "--channel":
        if (!next) {
          throw new Error("--channel requires a value");
        }
        args.channel = next;
        index += 1;
        break;
      case "--target":
        if (!next) {
          throw new Error("--target requires a value");
        }
        args.target = next;
        index += 1;
        break;
      case "--account":
        if (!next) {
          throw new Error("--account requires a value");
        }
        args.accountId = next;
        index += 1;
        break;
      case "--thread-id":
        if (!next) {
          throw new Error("--thread-id requires a value");
        }
        args.threadId = next;
        index += 1;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return args;
}

async function loadHetangConfig(): Promise<HetangOpsConfig> {
  return await loadStandaloneHetangConfig();
}

function resolveNotificationOverride(args: Args): HetangNotificationTarget | undefined {
  if (!args.target) {
    return undefined;
  }
  return {
    channel: args.channel,
    target: args.target,
    accountId: args.accountId,
    threadId: args.threadId,
    enabled: true,
  };
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const config = await loadHetangConfig();
  const notificationOverride = resolveNotificationOverride(args);
  const now = new Date();

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
    poolRole: "sync",
  });

  try {
    if (args.dryRun) {
      console.log(
        await runtime.renderWeeklyReport({
          weekEndBizDate: args.weekEndBizDate,
          now,
        }),
      );
      return;
    }

    console.log(
      await runtime.sendWeeklyReport({
        weekEndBizDate: args.weekEndBizDate,
        now,
        notificationOverride,
      }),
    );
  } finally {
    await runtime.close();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
