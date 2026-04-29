import { describe, expect, it, vi } from "vitest";

import { runHetangCommand } from "./command.js";
import { resolveHetangOpsConfig } from "./config.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "荷塘悦色迎宾店" },
      { orgId: "1002", storeName: "荷塘悦色义乌店" },
    ],
    reporting: {
      sharedDelivery: {
        channel: "wecom",
        target: "hetang-hq",
        enabled: true,
      },
    },
  });
}

function buildRuntime() {
  return {
    getEmployeeBinding: vi.fn(),
    getCommandUsage: vi.fn(),
    getActionItem: vi.fn(),
    getAnalysisJob: vi.fn(),
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    recordCommandAudit: vi.fn().mockResolvedValue(undefined),
    renderMonthlyReport: vi
      .fn()
      .mockResolvedValue("# 荷塘悦色 2026年3月 月度经营趋势总结"),
  };
}

describe("runHetangCommand monthly report", () => {
  it("allows hq users to render the monthly HQ trend report on demand", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const now = new Date("2026-04-20T10:00:00+08:00");

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report monthly 2026-03",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang report monthly 2026-03",
      now,
    });

    expect(text).toContain("2026年3月 月度经营趋势总结");
    expect(runtime.renderMonthlyReport).toHaveBeenCalledWith({
      month: "2026-03",
      now,
    });
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "report",
        decision: "allowed",
      }),
    );
  });

  it("defaults monthly report commands to the previous natural month", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "hq-1",
      employeeName: "总部甲",
      role: "hq",
      isActive: true,
      scopeOrgIds: [],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });
    const now = new Date("2026-04-20T10:00:00+08:00");

    await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report monthly",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang report monthly",
      now,
    });

    expect(runtime.renderMonthlyReport).toHaveBeenCalledWith({
      month: "2026-03",
      now,
    });
  });

  it("keeps monthly HQ trend reports hq-only", async () => {
    const runtime = buildRuntime();
    runtime.getEmployeeBinding.mockResolvedValue({
      channel: "wecom",
      senderId: "manager-1",
      employeeName: "店长甲",
      role: "manager",
      isActive: true,
      scopeOrgIds: ["1001"],
    });
    runtime.getCommandUsage.mockResolvedValue({ hourlyCount: 0, dailyCount: 0 });

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "report monthly",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang report monthly",
      now: new Date("2026-04-20T10:00:00+08:00"),
    });

    expect(text).toContain("仅总部账号可用");
    expect(runtime.renderMonthlyReport).not.toHaveBeenCalled();
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "report",
        decision: "denied",
        reason: "hq-only",
      }),
    );
  });
});
