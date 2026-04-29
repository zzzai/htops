import { readFileSync } from "node:fs";
import { Client } from "pg";
import { listInboundAuditsReadOnly } from "../src/inbound-audit-reader.js";
import { buildPhase1bEvalSet } from "../src/phase1b-eval-set.js";
import {
  loadStandaloneHetangConfig,
  loadStandaloneHetangConfigFromFile,
  loadStandaloneRuntimeEnv,
} from "../src/standalone-env.js";
import type { HetangInboundMessageAuditRecord, HetangOpsConfig } from "../src/types.js";

type Args = {
  input?: string;
  config?: string;
  channel?: string;
  sender?: string;
  conversation?: string;
  contains?: string;
  limit: number;
  fetchLimit: number;
  includeUnmentionedGroupMessages: boolean;
};

function parseArgs(argv: string[]): Args {
  const parsed: Args = {
    channel: "wecom",
    limit: 50,
    fetchLimit: 200,
    includeUnmentionedGroupMessages: false,
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
      case "--channel":
        if (!next) {
          throw new Error("--channel requires a value");
        }
        parsed.channel = next;
        index += 1;
        break;
      case "--sender":
        if (!next) {
          throw new Error("--sender requires a value");
        }
        parsed.sender = next;
        index += 1;
        break;
      case "--conversation":
        if (!next) {
          throw new Error("--conversation requires a value");
        }
        parsed.conversation = next;
        index += 1;
        break;
      case "--contains":
        if (!next) {
          throw new Error("--contains requires a value");
        }
        parsed.contains = next;
        index += 1;
        break;
      case "--limit":
        if (!next) {
          throw new Error("--limit requires a value");
        }
        parsed.limit = Number(next);
        index += 1;
        break;
      case "--fetch-limit":
        if (!next) {
          throw new Error("--fetch-limit requires a value");
        }
        parsed.fetchLimit = Number(next);
        index += 1;
        break;
      case "--include-unmentioned-group-messages":
        parsed.includeUnmentionedGroupMessages = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) {
    throw new Error("--limit must be a positive number");
  }
  if (!Number.isFinite(parsed.fetchLimit) || parsed.fetchLimit <= 0) {
    throw new Error("--fetch-limit must be a positive number");
  }

  return parsed;
}

async function loadConfig(args: Args): Promise<HetangOpsConfig> {
  if (args.config) {
    await loadStandaloneRuntimeEnv();
    return await loadStandaloneHetangConfigFromFile(args.config);
  }
  return await loadStandaloneHetangConfig();
}

async function loadAudits(args: Args, config: HetangOpsConfig): Promise<HetangInboundMessageAuditRecord[]> {
  if (args.input) {
    return JSON.parse(readFileSync(args.input, "utf8")) as HetangInboundMessageAuditRecord[];
  }

  const client = new Client({
    connectionString: config.database.queryUrl ?? config.database.url,
  });
  try {
    await client.connect();
    return await listInboundAuditsReadOnly(client, {
      channel: args.channel,
      senderId: args.sender,
      conversationId: args.conversation,
      contains: args.contains,
      limit: args.fetchLimit,
    });
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  await loadStandaloneRuntimeEnv();
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args);
  const audits = await loadAudits(args, config);
  const evalSet = buildPhase1bEvalSet({
    config,
    audits,
    now: new Date(),
    includeUnmentionedGroupMessages: args.includeUnmentionedGroupMessages,
    limit: args.limit,
  });
  console.log(JSON.stringify(evalSet, null, 2));
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
