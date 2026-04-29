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
      { orgId: "1003", storeName: "荷塘悦色华美店" },
      { orgId: "1004", storeName: "荷塘悦色锦苑店" },
      { orgId: "1005", storeName: "荷塘悦色园中园店" },
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
    sendWeeklyChartImage: vi.fn().mockResolvedValue("weekly chart image sent for 2026-04-19"),
  };
}

describe("runHetangCommand weekly chart", () => {
  it("allows hq users to send the 5-store weekly chart on demand", async () => {
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

    const text = await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "chart weekly 2026-04-19",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang chart weekly 2026-04-19",
      now: new Date("2026-04-20T10:00:00+08:00"),
    });

    expect(text).toContain("周经营图表已发送");
    expect(runtime.sendWeeklyChartImage).toHaveBeenCalledWith({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:00:00.000Z"),
    });
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chart",
        decision: "allowed",
      }),
    );
  });

  it("defaults the weekly chart date to the latest report biz date", async () => {
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

    await runHetangCommand({
      runtime: runtime as never,
      config: buildConfig(),
      args: "chart weekly",
      channel: "wecom",
      senderId: "hq-1",
      commandBody: "/hetang chart weekly",
      now: new Date("2026-04-20T10:00:00+08:00"),
    });

    expect(runtime.sendWeeklyChartImage).toHaveBeenCalledWith({
      weekEndBizDate: "2026-04-19",
      now: new Date("2026-04-20T02:00:00.000Z"),
    });
  });

  it("keeps weekly chart sending hq-only", async () => {
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
      args: "chart weekly",
      channel: "wecom",
      senderId: "manager-1",
      commandBody: "/hetang chart weekly",
      now: new Date("2026-04-20T10:00:00+08:00"),
    });

    expect(text).toContain("仅总部账号可用");
    expect(runtime.sendWeeklyChartImage).not.toHaveBeenCalled();
    expect(runtime.recordCommandAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "chart",
        decision: "denied",
      }),
    );
  });
});
