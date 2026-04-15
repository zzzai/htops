import { readFileSync } from "node:fs";
import {
  loadStandaloneHetangConfig,
  loadStandaloneHetangConfigFromFile,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";
import { buildRouteEvalFixturesFromInboundAudits } from "../src/route-eval-fixture-builder.js";
import type { HetangInboundMessageAuditRecord } from "../src/types.js";

type Args = {
  input: string;
  config?: string;
  limit?: number;
};

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    input: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--input":
        if (!next) {
          throw new Error("--input requires a value");
        }
        parsed.input = next;
        index += 1;
        break;
      case "--config":
        if (!next) {
          throw new Error("--config requires a value");
        }
        parsed.config = next;
        index += 1;
        break;
      case "--limit":
        if (!next) {
          throw new Error("--limit requires a value");
        }
        parsed.limit = Number(next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }
  if (!parsed.input) {
    throw new Error("--input is required");
  }
  return parsed;
}

async function loadConfig(args: Args) {
  if (args.config) {
    await loadStandaloneRuntimeEnv();
    return await loadStandaloneHetangConfigFromFile(args.config);
  }
  return await loadStandaloneHetangConfig();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const audits = JSON.parse(readFileSync(args.input, "utf8")) as HetangInboundMessageAuditRecord[];
  const config = await loadConfig(args);
  const fixtures = buildRouteEvalFixturesFromInboundAudits({
    config,
    audits: Number.isFinite(args.limit) ? audits.slice(0, args.limit) : audits,
    now: new Date(),
  });
  console.log(JSON.stringify(fixtures, null, 2));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
