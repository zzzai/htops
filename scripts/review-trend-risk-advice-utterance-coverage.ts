import { readFileSync } from "node:fs";
import {
  loadStandaloneHetangConfig,
  loadStandaloneHetangConfigFromFile,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";
import {
  buildTrendRiskAdviceUtteranceCoverageFromInboundAudits,
  filterTrendRiskAdviceUtteranceCoverage,
} from "../src/trend-risk-advice-utterance-coverage-builder.js";
import samples from "../src/trend-risk-advice-utterance-samples.json" with { type: "json" };
import type { TrendRiskAdviceUtteranceSample } from "../src/trend-risk-advice-route-eval-fixture-builder.js";
import type { HetangInboundMessageAuditRecord } from "../src/types.js";

type Args = {
  input: string;
  config?: string;
  filter: "all" | "covered" | "uncovered";
};

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    input: "",
    filter: "uncovered",
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
      case "--filter":
        if (!next) {
          throw new Error("--filter requires a value");
        }
        if (!["all", "covered", "uncovered"].includes(next)) {
          throw new Error(`Unsupported filter: ${next}`);
        }
        parsed.filter = next as Args["filter"];
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
  const coverage = buildTrendRiskAdviceUtteranceCoverageFromInboundAudits({
    config,
    now: new Date(),
    audits,
    samples: samples as TrendRiskAdviceUtteranceSample[],
  });
  console.log(JSON.stringify(filterTrendRiskAdviceUtteranceCoverage(coverage, args.filter), null, 2));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
