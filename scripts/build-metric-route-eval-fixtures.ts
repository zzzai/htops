import {
  loadStandaloneHetangConfig,
  loadStandaloneHetangConfigFromFile,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";
import {
  buildBoundMetricRouteEvalFixtures,
  buildMetricRouteEvalFixtures,
  type MetricUserUtteranceSample,
} from "../src/metric-route-eval-fixture-builder.js";
import samples from "../src/metric-user-utterance-samples.json" with { type: "json" };

type Args = {
  config?: string;
  binding?: "single-store";
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
      case "--binding":
        if (!next) {
          throw new Error("--binding requires a value");
        }
        if (next !== "single-store") {
          throw new Error(`Unsupported binding mode: ${next}`);
        }
        parsed.binding = next;
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
  const fixtures =
    args.binding === "single-store"
      ? (() => {
          const scopedStore = config.stores[0];
          if (!scopedStore) {
            throw new Error("single-store binding export requires at least one configured store");
          }
          return buildBoundMetricRouteEvalFixtures({
            config,
            now: new Date(),
            binding: {
              channel: "wecom",
              senderId: "eval-bound-manager",
              employeeName: `${scopedStore.storeName}店长`,
              role: "manager",
              orgId: scopedStore.orgId,
              scopeOrgIds: [scopedStore.orgId],
              isActive: true,
            },
            samples: samples as MetricUserUtteranceSample[],
          });
        })()
      : buildMetricRouteEvalFixtures({
          config,
          now: new Date(),
          samples: samples as MetricUserUtteranceSample[],
        });
  console.log(JSON.stringify(fixtures, null, 2));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
