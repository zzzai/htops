import path from "node:path";

import type { CommandRunner } from "./notify.js";
import { resolveStandaloneRootDir } from "./standalone-env.js";
import { resolveWeComTargetAlias } from "./wecom-target-directory.js";

export type HermesSendArgs = {
  help: boolean;
  channel?: string;
  target?: string;
  message?: string;
  accountId?: string;
  threadId?: string;
};

export type HermesSendDispatch = {
  argv: string[];
  env?: Record<string, string>;
};

type RunHermesSendDeps = {
  runCommandWithTimeout: CommandRunner;
  cwd?: string;
  projectRoot?: string;
};

export function formatHermesSendHelp(): string {
  return [
    "Usage:",
    "  hermes-send message send --channel <channel> --target <target> --message <text> [--account <id>] [--thread-id <id>]",
    "",
    "Supported channels:",
    "  wecom",
  ].join("\n");
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${flag} requires a value.\n\n${formatHermesSendHelp()}`);
  }
  return value;
}

export function parseHermesSendArgs(argv: string[]): HermesSendArgs {
  const parsed: HermesSendArgs = {
    help: false,
  };

  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    parsed.help = true;
    return parsed;
  }

  if (argv[0] !== "message" || argv[1] !== "send") {
    throw new Error(`Usage mismatch.\n\n${formatHermesSendHelp()}`);
  }

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--channel":
        parsed.channel = requireValue("--channel", next);
        index += 1;
        break;
      case "--target":
        parsed.target = requireValue("--target", next);
        index += 1;
        break;
      case "--message":
        parsed.message = requireValue("--message", next);
        index += 1;
        break;
      case "--account":
      case "--account-id":
        parsed.accountId = requireValue(current, next);
        index += 1;
        break;
      case "--thread-id":
        parsed.threadId = requireValue("--thread-id", next);
        index += 1;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}\n\n${formatHermesSendHelp()}`);
    }
  }

  if (parsed.help) {
    return parsed;
  }
  if (!parsed.channel || !parsed.target || !parsed.message) {
    throw new Error(`Missing required flags.\n\n${formatHermesSendHelp()}`);
  }
  return parsed;
}

export function buildHermesSendDispatch(
  args: HermesSendArgs,
  options: {
    projectRoot?: string;
  } = {},
): HermesSendDispatch {
  if (args.help) {
    throw new Error("help does not produce a dispatch plan");
  }
  const projectRoot = options.projectRoot || resolveStandaloneRootDir();
  const normalizedChannel = args.channel?.trim().toLowerCase();

  if (normalizedChannel === "wecom") {
    const resolvedTarget = resolveWeComTargetAlias(args.target!);
    return {
      argv: [
        process.execPath,
        path.join(projectRoot, "ops", "wecom-send-group.mjs"),
        resolvedTarget,
        args.message!,
      ],
      env: {
        ...(args.accountId ? { HETANG_OUTBOUND_ACCOUNT_ID: args.accountId } : {}),
        ...(args.threadId ? { HETANG_OUTBOUND_THREAD_ID: args.threadId } : {}),
      },
    };
  }

  throw new Error(`Unsupported outbound channel: ${args.channel}`);
}

export async function runHermesSend(
  argv: string[],
  deps: RunHermesSendDeps,
): Promise<{ code: number; stdout?: string; stderr?: string }> {
  let parsed: HermesSendArgs;
  try {
    parsed = parseHermesSendArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      stderr: message,
    };
  }

  if (parsed.help) {
    return {
      code: 0,
      stdout: formatHermesSendHelp(),
    };
  }

  let dispatch: HermesSendDispatch;
  try {
    dispatch = buildHermesSendDispatch(parsed, {
      projectRoot: deps.projectRoot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      stderr: message,
    };
  }

  const result = await deps.runCommandWithTimeout(dispatch.argv, {
    timeoutMs: 60_000,
    cwd: deps.cwd ?? deps.projectRoot ?? resolveStandaloneRootDir(),
    env: dispatch.env,
  });
  return {
    code: result.code ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
