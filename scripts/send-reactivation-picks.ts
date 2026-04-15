import { Pool } from "pg";
import {
  loadLatestCustomerSegmentSnapshot,
  renderReactivationPushMessage,
  selectTopReactivationCandidate,
} from "../src/reactivation-push.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";
import { HetangOpsStore } from "../src/store.js";
import { resolveReportBizDate } from "../src/time.js";
import type { HetangOpsConfig } from "../src/types.js";

type Args = {
  orgIds?: string[];
  bizDate?: string;
  json: boolean;
  messageOnly: boolean;
};

type ReactivationPushOutput = {
  orgId: string;
  storeName: string;
  snapshotBizDate: string;
  message: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    json: false,
    messageOnly: false,
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
      case "--json":
        args.json = true;
        break;
      case "--message-only":
        args.messageOnly = true;
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

function renderNoDataMessage(params: {
  storeName: string;
  targetBizDate: string;
  snapshotBizDate: string;
}): string {
  return [
    `${params.storeName}召回看板｜今天暂未命中可靠召回对象`,
    `- 目标营业日：${params.targetBizDate}｜最近快照：${params.snapshotBizDate}`,
    "- 当前原因：近7天内未形成可用客群快照，今天先不强推具体会员。",
    "- 今日动作：先确认昨晚同步是否完整，再补看沉默会员和团购承接名单。",
  ].join("\n");
}

async function buildOutputs(params: {
  store: HetangOpsStore;
  config: HetangOpsConfig;
  bizDate?: string;
  orgIds?: string[];
}): Promise<ReactivationPushOutput[]> {
  const targetBizDate =
    params.bizDate ??
    resolveReportBizDate({
      now: new Date(),
      timeZone: params.config.timeZone,
      cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
    });
  const stores = params.config.stores.filter(
    (entry) =>
      entry.isActive &&
      (!params.orgIds || params.orgIds.length === 0 || params.orgIds.includes(entry.orgId)),
  );
  const outputs: ReactivationPushOutput[] = [];
  const runtime = {
    listCustomerSegments: async ({ orgId, bizDate }: { orgId: string; bizDate: string }) =>
      await params.store.listCustomerSegments(orgId, bizDate),
    listMemberReactivationFeatures: async ({
      orgId,
      bizDate,
    }: {
      orgId: string;
      bizDate: string;
    }) => await params.store.listMemberReactivationFeatures(orgId, bizDate),
    listMemberReactivationStrategies: async ({
      orgId,
      bizDate,
    }: {
      orgId: string;
      bizDate: string;
    }) => await params.store.listMemberReactivationStrategies(orgId, bizDate),
  };

  for (const store of stores) {
    const snapshot = await loadLatestCustomerSegmentSnapshot({
      runtime,
      orgId: store.orgId,
      targetBizDate,
    });
    const featureRows = await runtime.listMemberReactivationFeatures({
      orgId: store.orgId,
      bizDate: snapshot.bizDate,
    });
    const strategyRows = await runtime.listMemberReactivationStrategies({
      orgId: store.orgId,
      bizDate: snapshot.bizDate,
    });
    const candidate = selectTopReactivationCandidate(snapshot.rows, featureRows, strategyRows);
    outputs.push({
      orgId: store.orgId,
      storeName: store.storeName,
      snapshotBizDate: snapshot.bizDate,
      message: candidate
        ? renderReactivationPushMessage({
            storeName: store.storeName,
            snapshotBizDate: snapshot.bizDate,
            candidate,
          })
        : renderNoDataMessage({
            storeName: store.storeName,
            targetBizDate,
            snapshotBizDate: snapshot.bizDate,
          }),
    });
  }

  return outputs;
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const config = await loadHetangConfig();
  const pool = new Pool({
    connectionString: config.database.url,
    allowExitOnIdle: true,
  });
  const store = new HetangOpsStore({
    pool,
    stores: config.stores.map((entry) => ({
      orgId: entry.orgId,
      storeName: entry.storeName,
      rawAliases: entry.rawAliases,
    })),
  });

  try {
    await store.initialize();
    const outputs = await buildOutputs({
      store,
      config,
      bizDate: args.bizDate,
      orgIds: args.orgIds,
    });
    if (args.json) {
      console.log(JSON.stringify(outputs, null, 2));
      return;
    }

    if (args.messageOnly) {
      if (outputs.length !== 1) {
        throw new Error("--message-only requires exactly one resolved store");
      }
      console.log(outputs[0]?.message ?? "");
      return;
    }

    for (const output of outputs) {
      console.log(`=== ${output.storeName} (${output.orgId}) ===`);
      console.log(output.message);
      console.log("");
    }
  } finally {
    await store.close();
    await pool.end();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
