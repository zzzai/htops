import { runCommandWithTimeout } from "../src/command-runner.js";
import { HetangOpsRuntime } from "../src/runtime.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
  resolveStandaloneStateDir,
} from "../src/standalone-env.js";
import { resolveLocalTime } from "../src/time.js";
import type { HetangNotificationTarget, HetangOpsConfig } from "../src/types.js";

type Args = {
  orgIds?: string[];
  bizDate?: string;
  channel: string;
  target?: string;
  accountId?: string;
  threadId?: string;
  dryRun: boolean;
  lateUntil?: string;
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
      case "--org":
        if (!next) {
          throw new Error("--org requires a value");
        }
        args.orgIds = [next];
        index += 1;
        break;
      case "--orgs":
        if (!next) {
          throw new Error("--orgs requires a value");
        }
        args.orgIds = next
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        index += 1;
        break;
      case "--date":
        if (!next) {
          throw new Error("--date requires a value");
        }
        args.bizDate = next;
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
      case "--late-until":
        if (!next) {
          throw new Error("--late-until requires a value");
        }
        args.lateUntil = next;
        index += 1;
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
  if (args.lateUntil) {
    const nowTime = resolveLocalTime(now, config.timeZone);
    if (nowTime > args.lateUntil) {
      console.log(`skip: current local time ${nowTime} is later than late-until ${args.lateUntil}`);
      return;
    }
  }
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
    const activeOrgIds = config.stores.filter((entry) => entry.isActive).map((entry) => entry.orgId);
    const storeOrgIds = args.orgIds && args.orgIds.length > 0 ? args.orgIds : activeOrgIds;

    if (!args.dryRun && notificationOverride && storeOrgIds.length === activeOrgIds.length) {
      const result = await runtime.sendAllMiddayBriefs({
        bizDate: args.bizDate,
        now,
        notificationOverride,
      });
      for (const line of result.lines) {
        console.log(line);
      }
      if (!result.allSent) {
        process.exitCode = 1;
      }
      return;
    }

    for (const orgId of storeOrgIds) {
      if (args.dryRun) {
        console.log(
          await runtime.renderMiddayBrief({
            orgId,
            bizDate: args.bizDate,
            now,
          }),
        );
        console.log("");
        continue;
      }

      console.log(
        await runtime.sendMiddayBrief({
          orgId,
          bizDate: args.bizDate,
          now,
          notificationOverride,
        }),
      );
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
