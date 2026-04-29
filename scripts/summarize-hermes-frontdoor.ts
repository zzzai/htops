import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  extractHermesFrontdoorEvent,
  renderHermesFrontdoorSummary,
  summarizeHermesFrontdoorEvents,
} from "../src/hermes-frontdoor-summary.js";

type Args = {
  service: string;
  since?: string;
  until?: string;
  logFile?: string;
  json: boolean;
};

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    service: "hermes-gateway.service",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--":
        break;
      case "--service":
        if (!next) {
          throw new Error("--service requires a value");
        }
        parsed.service = next;
        index += 1;
        break;
      case "--since":
        if (!next) {
          throw new Error("--since requires a value");
        }
        parsed.since = next;
        index += 1;
        break;
      case "--until":
        if (!next) {
          throw new Error("--until requires a value");
        }
        parsed.until = next;
        index += 1;
        break;
      case "--log-file":
        if (!next) {
          throw new Error("--log-file requires a value");
        }
        parsed.logFile = next;
        index += 1;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return parsed;
}

function readJournalLines(args: Args): string[] {
  const journalArgs = ["-u", args.service, "--no-pager"];
  if (args.since) {
    journalArgs.push("--since", args.since);
  }
  if (args.until) {
    journalArgs.push("--until", args.until);
  }
  const output = execFileSync("journalctl", journalArgs, {
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readLogFileLines(logFile: string): string[] {
  return readFileSync(logFile, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const lines = args.logFile ? readLogFileLines(args.logFile) : readJournalLines(args);
  const events = lines
    .map((line) => extractHermesFrontdoorEvent(line))
    .filter((event): event is NonNullable<typeof event> => event !== null);
  const summary = summarizeHermesFrontdoorEvents(events);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(renderHermesFrontdoorSummary(summary));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
