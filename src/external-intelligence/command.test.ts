import { describe, expect, it, vi } from "vitest";
import { runHetangCommand } from "../command.js";
import { resolveHetangOpsConfig } from "../config.js";

function buildConfig(overrides: Record<string, unknown> = {}) {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    externalIntelligence: {
      enabled: true,
      hqDelivery: {
        channel: "wecom",
        target: "hetang-hq-intel",
      },
      sources: [
        { sourceId: "luckin-ir", displayName: "瑞幸官方", tier: "s" },
        { sourceId: "jiemian", displayName: "界面新闻", tier: "a" },
        { sourceId: "hot-list", displayName: "热榜聚合", tier: "b" },
      ],
    },
    stores: [
      { orgId: "1001", storeName: "一号店" },
      { orgId: "1002", storeName: "二号店" },
      { orgId: "1003", storeName: "三号店" },
      { orgId: "1004", storeName: "四号店" },
      { orgId: "1005", storeName: "五号店" },
    ],
    ...overrides,
  });
}

function buildRuntime() {
  return {
    getEmployeeBinding: vi.fn(),
    getCommandUsage: vi.fn(),
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    recordCommandAudit: vi.fn().mockResolvedValue(undefined),
    buildExternalBriefIssue: vi.fn().mockResolvedValue({
      issueId: "ext-brief-2026-04-03",
      markdown: "何棠 HQ 外部情报简报\n\n1. 瑞幸价格带调整进入执行期",
      delivered: false,
      itemCount: 1,
    }),
    renderLatestExternalBriefIssue: vi
      .fn()
      .mockResolvedValue("何棠 HQ 外部情报简报\n\n1. 最新一期"),
    renderExternalBriefIssueById: vi.fn().mockResolvedValue("何棠 HQ 外部情报简报\n\n1. 指定期数"),
  };
}

function buildHqBinding() {
  return {
    channel: "wecom",
    senderId: "hq-user",
    employeeName: "总部运营",
    role: "hq",
    isActive: true,
    hourlyQuota: 15,
    dailyQuota: 80,
  };
}

describe("runHetangCommand intel", () => {
  it("allows HQ to run a manual intelligence rebuild", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(buildHqBinding());
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "intel run",
      channel: "wecom",
      senderId: "hq-user",
      commandBody: "/hetang intel run",
      now: new Date("2026-04-03T09:40:00+08:00"),
    });

    expect(runtime.buildExternalBriefIssue).toHaveBeenCalledWith({
      now: new Date("2026-04-03T09:40:00+08:00"),
      deliver: false,
    });
    expect(text).toContain("何棠 HQ 外部情报简报");
    expect(text).toContain("瑞幸价格带调整进入执行期");
  });

  it("allows HQ to fetch the latest saved issue", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(buildHqBinding());
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "intel latest",
      channel: "wecom",
      senderId: "hq-user",
      commandBody: "/hetang intel latest",
      now: new Date("2026-04-03T09:40:00+08:00"),
    });

    expect(runtime.renderLatestExternalBriefIssue).toHaveBeenCalledTimes(1);
    expect(text).toContain("最新一期");
  });

  it("allows HQ to inspect a specific issue", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(buildHqBinding());
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "intel issue ext-brief-2026-04-03",
      channel: "wecom",
      senderId: "hq-user",
      commandBody: "/hetang intel issue ext-brief-2026-04-03",
      now: new Date("2026-04-03T09:40:00+08:00"),
    });

    expect(runtime.renderExternalBriefIssueById).toHaveBeenCalledWith("ext-brief-2026-04-03");
    expect(text).toContain("指定期数");
  });

  it("shows configured intelligence sources for HQ", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue(buildHqBinding());
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "intel sources",
      channel: "wecom",
      senderId: "hq-user",
      commandBody: "/hetang intel sources",
      now: new Date("2026-04-03T09:40:00+08:00"),
    });

    expect(text).toContain("HQ 外部情报源");
    expect(text).toContain("瑞幸官方 [s]");
    expect(text).toContain("界面新闻 [a]");
    expect(text).toContain("热榜聚合 [b]");
  });

  it("denies store managers from using the HQ intel command surface", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      scopeOrgIds: ["1001"],
      hourlyQuota: 6,
      dailyQuota: 30,
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "intel latest",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang intel latest",
      now: new Date("2026-04-03T09:40:00+08:00"),
    });

    expect(text).toContain("仅总部账号可用");
    expect(runtime.renderLatestExternalBriefIssue).not.toHaveBeenCalled();
  });
});
