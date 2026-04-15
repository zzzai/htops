import {
  loadStandaloneHetangConfig,
  loadStandaloneHetangConfigFromFile,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";
import {
  buildCustomerProfileRouteEvalFixtures,
  type CustomerProfileUtteranceSample,
} from "../src/customer-profile-route-eval-fixture-builder.js";
import samples from "../src/customer-profile-utterance-samples.json" with { type: "json" };

type Args = {
  config?: string;
};

function parseArgs(argv: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    switch (current) {
      case "--config":
        if (!next) {
          throw new Error("--config requires a value");
        }
        parsed.config = next;
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
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
  const config = await loadConfig(args);
  const fixtures = buildCustomerProfileRouteEvalFixtures({
    config,
    now: new Date(),
    samples: samples as CustomerProfileUtteranceSample[],
  });
  console.log(JSON.stringify(fixtures, null, 2));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
