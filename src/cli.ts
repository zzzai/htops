import { resolve } from "node:path";
import type { Command } from "commander";
import { readAccessImportFile, resolveAccessImportBindings } from "./access-import.js";
import { runHetangCommand } from "./command.js";
import { HetangOpsRuntime } from "./runtime.js";
import type { DailyStoreReport } from "./types.js";
import type { HetangAccessRole } from "./types.js";
import type { HetangControlTowerSettingRecord } from "./types.js";

function print(lines: string[]): void {
  for (const line of lines) {
    console.log(line);
  }
}

function formatCliReportOutput(report: DailyStoreReport): string {
  if (report.complete) {
    return report.markdown;
  }
  return [
    `${report.storeName} ${report.bizDate} 营业日数据尚未完成同步，当前不输出正式日报。`,
    ...report.alerts.map((alert) => `- ${alert.message}`),
  ].join("\n");
}

function parseQuota(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseRole(value: string): HetangAccessRole {
  const normalized = value.trim().toLowerCase();
  if (
    normalized !== "hq" &&
    normalized !== "manager" &&
    normalized !== "staff" &&
    normalized !== "disabled"
  ) {
    throw new Error("role must be one of: hq, manager, staff, disabled");
  }
  return normalized;
}

function parseOrgIds(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const values = Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
  return values.length > 0 ? values : undefined;
}

function parseDedupedStringList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );
}

function buildControlTowerSetting(params: {
  settingKey: string;
  value: string | number | boolean;
  updatedBy: string;
}): HetangControlTowerSettingRecord {
  return {
    scopeType: "global",
    scopeKey: "global",
    settingKey: params.settingKey,
    value: params.value,
    updatedAt: new Date().toISOString(),
    updatedBy: params.updatedBy,
  };
}

export function registerHetangCli(params: { program: Command; runtime: HetangOpsRuntime }): void {
  const root = params.program.command("hetang").description("Hetang store operations");

  root
    .command("status")
    .alias("doctor")
    .description("Show hetang-ops configuration and sync status")
    .action(async () => {
      console.log(await params.runtime.doctor());
    });

  root
    .command("sync")
    .description("Run incremental sync for all stores or a single OrgId")
    .option("--org <orgId>", "Sync a single store OrgId")
    .action(async (options: { org?: string }) => {
      const lines = await params.runtime.syncStores({
        orgIds: options.org ? [options.org] : undefined,
      });
      print(lines);
    });

  root
    .command("backfill")
    .description("Run a slow business-day backfill for one store or all stores")
    .requiredOption("--start <YYYY-MM-DD>", "First business day to backfill")
    .requiredOption("--end <YYYY-MM-DD>", "Last business day to backfill")
    .option("--org <orgId>", "Backfill a single store OrgId")
    .action(async (options: { start: string; end: string; org?: string }) => {
      print(
        await params.runtime.backfillStores({
          orgIds: options.org ? [options.org] : undefined,
          startBizDate: options.start,
          endBizDate: options.end,
        }),
      );
    });

  root
    .command("backfill-february-2026")
    .description("Run the slow stable February 2026 backfill for one store or all stores")
    .option("--org <orgId>", "Backfill a single store OrgId")
    .action(async (options: { org?: string }) => {
      print(
        await params.runtime.backfillFebruary2026({
          orgIds: options.org ? [options.org] : undefined,
        }),
      );
    });

  root
    .command("repair-missing")
    .description("Repair only the missing local coverage in bounded daytime batches")
    .option("--org <orgId>", "Repair a single store OrgId")
    .option("--start <YYYY-MM-DD>", "First business day to inspect for missing coverage")
    .option("--end <YYYY-MM-DD>", "Last business day to inspect for missing coverage")
    .option(
      "--max-plans <count>",
      "Execute at most N coverage repair plans in this run",
      (value: string) => parsePositiveInteger(value, "max-plans"),
    )
    .action(
      async (options: {
        org?: string;
        start?: string;
        end?: string;
        maxPlans?: number;
      }) => {
        print(
          await params.runtime.repairMissingCoverage({
            orgIds: options.org ? [options.org] : undefined,
            startBizDate: options.start,
            endBizDate: options.end,
            maxPlans: options.maxPlans,
          }),
        );
      },
    );

  root
    .command("report")
    .description("Build daily report for one store or all stores")
    .option("--org <orgId>", "Build a single store report")
    .option("--date <YYYY-MM-DD>", "Report date, defaults to previous local day")
    .option("--send", "Send the report after building", false)
    .action(async (options: { org?: string; date?: string; send?: boolean }) => {
      if (options.org) {
        const report = await params.runtime.buildReport({
          orgId: options.org,
          bizDate: options.date,
        });
        console.log(formatCliReportOutput(report));
        if (options.send) {
          console.log(
            await params.runtime.sendReport({ orgId: options.org, bizDate: options.date }),
          );
        }
        return;
      }

      const reports = await params.runtime.buildAllReports({ bizDate: options.date });
      for (const report of reports) {
        console.log(formatCliReportOutput(report));
        console.log("");
      }
      if (options.send) {
        for (const report of reports) {
          console.log(
            await params.runtime.sendReport({ orgId: report.orgId, bizDate: report.bizDate }),
          );
        }
      }
    });

  root
    .command("midday-brief")
    .description("Render or send the manager midday brief for one store or all stores")
    .option("--org <orgId>", "Send a single store midday brief")
    .option("--date <YYYY-MM-DD>", "Brief date, defaults to previous business day")
    .option("--send", "Send the midday brief instead of printing", false)
    .option("--channel <channel>", "Override channel for sends", "wecom")
    .option("--target <target>", "Override target for sends")
    .option("--account <accountId>", "Override account id for sends")
    .option("--thread-id <threadId>", "Override thread id for sends")
    .action(
      async (options: {
        org?: string;
        date?: string;
        send?: boolean;
        channel: string;
        target?: string;
        account?: string;
        threadId?: string;
      }) => {
        const notificationOverride = options.target
          ? {
              channel: options.channel,
              target: options.target,
              accountId: options.account,
              threadId: options.threadId,
              enabled: true,
            }
          : undefined;

        if (options.org) {
          if (options.send) {
            console.log(
              await params.runtime.sendMiddayBrief({
                orgId: options.org,
                bizDate: options.date,
                notificationOverride,
              }),
            );
            return;
          }
          console.log(
            await params.runtime.renderMiddayBrief({
              orgId: options.org,
              bizDate: options.date,
            }),
          );
          return;
        }

        for (const entry of params.runtime.config.stores.filter((store) => store.isActive !== false)) {
          if (options.send) {
            console.log(
              await params.runtime.sendMiddayBrief({
                orgId: entry.orgId,
                bizDate: options.date,
                notificationOverride,
              }),
            );
            continue;
          }
          console.log(
            await params.runtime.renderMiddayBrief({
              orgId: entry.orgId,
              bizDate: options.date,
            }),
          );
          console.log("");
        }
      },
    );

  root
    .command("query <question...>")
    .description("Run a deterministic Hetang query as a bound channel user")
    .requiredOption("--user <senderId>", "Channel sender id")
    .option("--channel <channel>", "Channel id", "wecom")
    .action(async (question: string[], options: { user: string; channel: string }) => {
      const text = question.join(" ").trim();
      console.log(
        await runHetangCommand({
          runtime: params.runtime,
          config: params.runtime.config,
          args: `query ${text}`,
          channel: options.channel,
          senderId: options.user,
          commandBody: `/hetang query ${text}`,
        }),
      );
    });

  root
    .command("whoami")
    .description("Show the Hetang binding and quota for a bound channel user")
    .requiredOption("--user <senderId>", "Channel sender id")
    .option("--channel <channel>", "Channel id", "wecom")
    .action(async (options: { user: string; channel: string }) => {
      console.log(
        await runHetangCommand({
          runtime: params.runtime,
          config: params.runtime.config,
          args: "whoami",
          channel: options.channel,
          senderId: options.user,
          commandBody: "/hetang whoami",
        }),
      );
    });

  root
    .command("inbound-audit")
    .description("Query persisted inbound message audits for sender and conversation recovery")
    .option("--channel <channel>", "Channel id", "wecom")
    .option("--sender <senderId>", "Channel sender id")
    .option("--conversation <conversationId>", "Conversation id")
    .option("--contains <text>", "Search text in sender name or content")
    .option("--limit <n>", "Max rows to print", "20")
    .option("--json", "Print JSON instead of table rows", false)
    .action(
      async (options: {
        channel: string;
        sender?: string;
        conversation?: string;
        contains?: string;
        limit: string;
        json?: boolean;
      }) => {
        const rows = await params.runtime.listInboundMessageAudits({
          channel: options.channel,
          senderId: options.sender,
          conversationId: options.conversation,
          contains: options.contains,
          limit: parsePositiveInteger(options.limit, "limit"),
        });
        if (options.json) {
          console.log(JSON.stringify(rows, null, 2));
          return;
        }
        print(
          rows.map((row) =>
            [
              row.receivedAt,
              row.channel,
              row.senderId ?? "-",
              row.senderName ?? "-",
              row.conversationId ?? "-",
              row.requestId,
              row.content,
            ].join(" | "),
          ),
        );
      },
    );

  root
    .command("routing-mode [mode]")
    .description("Show or update the global routing.mode control tower setting")
    .action(async (mode?: string) => {
      if (!mode) {
        const settings = await params.runtime.resolveControlTowerSettings({});
        const resolvedMode =
          settings["routing.mode"] === "shadow" || settings["routing.mode"] === "semantic"
            ? String(settings["routing.mode"])
            : "legacy";
        const canary = String(settings["routing.semanticCanarySenderIds"] ?? "");
        console.log(`routing.mode=${resolvedMode}`);
        console.log(`routing.semanticCanarySenderIds=${canary}`);
        return;
      }
      if (mode !== "legacy" && mode !== "shadow" && mode !== "semantic") {
        throw new Error("routing mode must be one of: legacy, shadow, semantic");
      }
      await params.runtime.upsertControlTowerSetting(
        buildControlTowerSetting({
          settingKey: "routing.mode",
          value: mode,
          updatedBy: "cli:hetang-routing-mode",
        }),
      );
      console.log(`updated routing.mode=${mode}`);
    });

  root
    .command("routing-canary")
    .description("Show or update the global semantic canary sender allowlist")
    .option("--users <senderIds>", "Comma-separated sender ids")
    .option("--clear", "Clear the semantic canary sender list", false)
    .action(async (options: { users?: string; clear?: boolean }) => {
      if (!options.users && !options.clear) {
        const settings = await params.runtime.resolveControlTowerSettings({});
        console.log(
          `routing.semanticCanarySenderIds=${String(settings["routing.semanticCanarySenderIds"] ?? "")}`,
        );
        return;
      }
      if (options.clear) {
        await params.runtime.upsertControlTowerSetting(
          buildControlTowerSetting({
            settingKey: "routing.semanticCanarySenderIds",
            value: "",
            updatedBy: "cli:hetang-routing-canary",
          }),
        );
        console.log("cleared routing.semanticCanarySenderIds");
        return;
      }
      const users = parseDedupedStringList(options.users);
      await params.runtime.upsertControlTowerSetting(
        buildControlTowerSetting({
          settingKey: "routing.semanticCanarySenderIds",
          value: users.join(","),
          updatedBy: "cli:hetang-routing-canary",
        }),
      );
      console.log(`updated routing.semanticCanarySenderIds=${users.join(",")}`);
    });

  root
    .command("run-due")
    .description("Run any due scheduled jobs immediately")
    .action(async () => {
      print(await params.runtime.runDueJobs(new Date()));
    });

  root
    .command("repair-views")
    .description("Force rebuild analytics views and materialized surfaces")
    .action(async () => {
      console.log(await params.runtime.repairAnalyticsViews());
    });

  const access = root.command("access").description("Manage Hetang access bindings");

  access
    .command("list")
    .description("List active employee bindings")
    .option("--channel <channel>", "Channel id", "wecom")
    .action(async (options: { channel: string }) => {
      const bindings = await params.runtime.listEmployeeBindings(options.channel);
      print(
        bindings.map((binding) =>
          [
            binding.channel,
            binding.senderId,
            binding.employeeName ?? "-",
            binding.role,
            binding.scopeOrgIds && binding.scopeOrgIds.length > 0
              ? binding.scopeOrgIds.join(",")
              : binding.role === "hq"
                ? "ALL"
                : (binding.orgId ?? "HQ"),
            `hour=${binding.hourlyQuota ?? "-"}`,
            `day=${binding.dailyQuota ?? "-"}`,
          ].join(" | "),
        ),
      );
    });

  access
    .command("import")
    .description("Import employee bindings from a JSON file")
    .requiredOption("--file <path>", "JSON file path")
    .option("--channel <channel>", "Channel id", "wecom")
    .option("--dry-run", "Validate and print without writing", false)
    .action(async (options: { file: string; channel: string; dryRun?: boolean }) => {
      const filePath = resolve(options.file);
      const payload = await readAccessImportFile(filePath);
      const bindings = resolveAccessImportBindings({
        config: params.runtime.config,
        channel: options.channel,
        entries: payload,
      });
      if (options.dryRun) {
        print(
          bindings.map((binding) =>
            [
              binding.channel,
              binding.senderId,
              binding.employeeName ?? "-",
              binding.role,
              binding.scopeOrgIds && binding.scopeOrgIds.length > 0
                ? binding.scopeOrgIds.join(",")
                : "ALL",
            ].join(" | "),
          ),
        );
        console.log(`dry-run ok: ${bindings.length} bindings`);
        return;
      }
      for (const binding of bindings) {
        await params.runtime.grantEmployeeBinding(binding);
      }
      console.log(`imported ${bindings.length} bindings from ${filePath}`);
    });

  access
    .command("grant")
    .description("Grant or update a user binding")
    .requiredOption("--user <senderId>", "Channel sender id")
    .requiredOption("--role <role>", "Role: hq|manager|staff|disabled")
    .option("--channel <channel>", "Channel id", "wecom")
    .option("--org <orgId>", "Bound store org id")
    .option("--orgs <orgIds>", "Comma-separated allowed store org ids")
    .option("--name <employeeName>", "Employee display name")
    .option("--hourly <count>", "Override hourly quota")
    .option("--daily <count>", "Override daily quota")
    .option("--notes <notes>", "Operator notes")
    .action(
      async (options: {
        user: string;
        role: HetangAccessRole;
        channel: string;
        org?: string;
        orgs?: string;
        name?: string;
        hourly?: string;
        daily?: string;
        notes?: string;
      }) => {
        const scopeOrgIds = parseOrgIds(options.orgs) ?? (options.org ? [options.org] : undefined);
        await params.runtime.grantEmployeeBinding({
          channel: options.channel,
          senderId: options.user,
          employeeName: options.name,
          role: parseRole(options.role),
          orgId: scopeOrgIds?.length === 1 ? scopeOrgIds[0] : undefined,
          scopeOrgIds,
          isActive: true,
          hourlyQuota: parseQuota(options.hourly, "hourly"),
          dailyQuota: parseQuota(options.daily, "daily"),
          notes: options.notes,
        });
        console.log(`binding saved for ${options.channel}:${options.user}`);
      },
    );

  access
    .command("revoke")
    .description("Disable a user binding")
    .requiredOption("--user <senderId>", "Channel sender id")
    .option("--channel <channel>", "Channel id", "wecom")
    .action(async (options: { user: string; channel: string }) => {
      await params.runtime.revokeEmployeeBinding({
        channel: options.channel,
        senderId: options.user,
      });
      console.log(`binding revoked for ${options.channel}:${options.user}`);
    });
}
