import { runCommandWithTimeout } from "./command-runner.js";
import { createHetangOpsRuntime } from "./runtime.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "./standalone-env.js";
import type { HetangNotificationTarget, HetangOpsConfig } from "./types.js";

export type MonthlyReportScriptArgs = {
  month?: string;
  channel: string;
  target?: string;
  accountId?: string;
  threadId?: string;
  dryRun: boolean;
};

function isMonthToken(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}$/u.test(value.trim()));
}

export function parseMonthlyReportScriptArgs(argv: string[]): MonthlyReportScriptArgs {
  const args: MonthlyReportScriptArgs = {
    channel: "wecom",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--month":
      case "--date":
        if (!next) {
          throw new Error(`${current} requires a value`);
        }
        if (!isMonthToken(next)) {
          throw new Error("--month must use YYYY-MM");
        }
        args.month = next;
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

export function resolveMonthlyReportNotificationOverride(
  args: MonthlyReportScriptArgs,
): HetangNotificationTarget | undefined {
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

async function loadHetangConfig(): Promise<HetangOpsConfig> {
  return await loadStandaloneHetangConfig();
}

export async function runSendMonthlyReportScript(argv: string[]): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const args = parseMonthlyReportScriptArgs(argv);
  const config = await loadHetangConfig();
  const notificationOverride = resolveMonthlyReportNotificationOverride(args);
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
        await runtime.renderMonthlyReport({
          month: args.month,
          now,
        }),
      );
      return;
    }

    console.log(
      await runtime.sendMonthlyReport({
        month: args.month,
        now,
        notificationOverride,
      }),
    );
  } finally {
    await runtime.close();
  }
}
