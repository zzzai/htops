import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerHetangCli } from "./cli.js";

function buildRuntime() {
  return {
    config: {
      stores: [
        { orgId: "1001", storeName: "义乌店", isActive: true },
        { orgId: "1002", storeName: "华美店", isActive: true },
      ],
    },
    resolveControlTowerSettings: vi.fn().mockResolvedValue({}),
    upsertControlTowerSetting: vi.fn().mockImplementation(async (record) => record),
    repairMissingCoverage: vi
      .fn()
      .mockResolvedValue(["义乌店 2026-04-01..2026-04-07: coverage repair complete"]),
    buildReport: vi.fn(),
    buildAllReports: vi.fn(),
    sendReport: vi.fn(),
    renderMiddayBrief: vi.fn(),
    sendMiddayBrief: vi.fn(),
    renderFiveStoreDailyOverview: vi.fn(),
    sendFiveStoreDailyOverview: vi.fn(),
    cancelFiveStoreDailyOverviewSend: vi.fn(),
    confirmFiveStoreDailyOverviewSend: vi.fn(),
    listInboundMessageAudits: vi.fn().mockResolvedValue([]),
    backfillFebruary2026: vi
      .fn()
      .mockResolvedValue(["义乌店 2026-02-01..2026-02-07: backfill complete"]),
  };
}

describe("registerHetangCli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the status, query, and whoami commands on the hetang CLI", () => {
    const program = new Command();

    registerHetangCli({
      program,
      runtime: buildRuntime() as never,
    });

    const hetang = program.commands.find((command) => command.name() === "hetang");
    expect(hetang).toBeDefined();

    const commandNames = hetang?.commands.map((command) => command.name()) ?? [];
    expect(commandNames).toEqual(
      expect.arrayContaining(["status", "query", "whoami", "report", "sync"]),
    );

    const statusCommand = hetang?.commands.find((command) => command.name() === "status");
    expect(statusCommand?.aliases()).toContain("doctor");
  });

  it("does not print a formal report when the CLI report is incomplete", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    runtime.buildReport.mockResolvedValue({
      orgId: "1001",
      storeName: "义乌店",
      bizDate: "2026-03-31",
      metrics: {},
      alerts: [{ severity: "critical", message: "同步尚未覆盖日报所需的 8 个关键接口检查点" }],
      suggestions: [],
      markdown: "# 义乌店 经营日报 2026-03-31",
      complete: false,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(["hetang", "report", "--org", "1001", "--date", "2026-03-31"], {
      from: "user",
    });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("义乌店 2026-03-31 营业日数据尚未完成同步"),
    );
    expect(logSpy).not.toHaveBeenCalledWith("# 义乌店 经营日报 2026-03-31");
  });

  it("registers a fixed February 2026 backfill command for slow stable backfill", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(["hetang", "backfill-february-2026", "--org", "1001"], {
      from: "user",
    });

    expect(runtime.backfillFebruary2026).toHaveBeenCalledWith({
      orgIds: ["1001"],
    });
    expect(logSpy).toHaveBeenCalledWith("义乌店 2026-02-01..2026-02-07: backfill complete");
  });

  it("registers a bounded repair-missing command for daytime gap repair", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      [
        "hetang",
        "repair-missing",
        "--org",
        "1001",
        "--start",
        "2026-04-01",
        "--end",
        "2026-04-13",
        "--max-plans",
        "2",
      ],
      {
        from: "user",
      },
    );

    expect(runtime.repairMissingCoverage).toHaveBeenCalledWith({
      orgIds: ["1001"],
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-13",
      maxPlans: 2,
    });
    expect(logSpy).toHaveBeenCalledWith("义乌店 2026-04-01..2026-04-07: coverage repair complete");
  });

  it("sends midday briefs to an override target when requested", async () => {
    const program = new Command();
    const runtime = buildRuntime();

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      [
        "hetang",
        "midday-brief",
        "--send",
        "--target",
        "龙虾测试群",
        "--date",
        "2026-04-04",
      ],
      {
        from: "user",
      },
    );

    expect(runtime.sendMiddayBrief).toHaveBeenNthCalledWith(1, {
      orgId: "1001",
      bizDate: "2026-04-04",
      notificationOverride: {
        channel: "wecom",
        target: "龙虾测试群",
        accountId: undefined,
        threadId: undefined,
        enabled: true,
      },
    });
    expect(runtime.sendMiddayBrief).toHaveBeenNthCalledWith(2, {
      orgId: "1002",
      bizDate: "2026-04-04",
      notificationOverride: {
        channel: "wecom",
        target: "龙虾测试群",
        accountId: undefined,
        threadId: undefined,
        enabled: true,
      },
    });
  });

  it("supports previewing and confirming the five-store daily overview from the CLI", async () => {
    const program = new Command();
    const runtime = buildRuntime();

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      ["hetang", "five-store-daily-overview", "preview", "--date", "2026-04-22"],
      { from: "user" },
    );
    await program.parseAsync(
      [
        "hetang",
        "five-store-daily-overview",
        "confirm",
        "--date",
        "2026-04-22",
        "--confirmed-by",
        "codex-window",
      ],
      { from: "user" },
    );

    expect(runtime.sendFiveStoreDailyOverview).toHaveBeenCalledWith({
      bizDate: "2026-04-22",
      deliveryMode: "preview",
    });
    expect(runtime.confirmFiveStoreDailyOverviewSend).toHaveBeenCalledWith({
      bizDate: "2026-04-22",
      confirmedBy: "codex-window",
    });
  });

  it("supports cancelling the pending five-store daily overview from the CLI", async () => {
    const program = new Command();
    const runtime = buildRuntime();

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      [
        "hetang",
        "five-store-daily-overview",
        "cancel",
        "--date",
        "2026-04-22",
        "--canceled-by",
        "codex-window",
      ],
      { from: "user" },
    );

    expect(runtime.cancelFiveStoreDailyOverviewSend).toHaveBeenCalledWith({
      bizDate: "2026-04-22",
      canceledBy: "codex-window",
    });
  });

  it("renders the five-store daily overview locally from the CLI without sending", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    runtime.renderFiveStoreDailyOverview.mockResolvedValue("# 荷塘悦色5店昨日经营总览");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      ["hetang", "five-store-daily-overview", "render", "--date", "2026-04-22"],
      { from: "user" },
    );

    expect(runtime.renderFiveStoreDailyOverview).toHaveBeenCalledWith({
      bizDate: "2026-04-22",
    });
    expect(runtime.sendFiveStoreDailyOverview).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("# 荷塘悦色5店昨日经营总览");
  });

  it("allows overriding the final shared target when previewing the five-store daily overview", async () => {
    const program = new Command();
    const runtime = buildRuntime();

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      [
        "hetang",
        "five-store-daily-overview",
        "preview",
        "--date",
        "2026-04-22",
        "--target",
        "龙虾测试群",
        "--account",
        "acct-1",
        "--thread-id",
        "thread-9",
      ],
      { from: "user" },
    );

    expect(runtime.sendFiveStoreDailyOverview).toHaveBeenCalledWith({
      bizDate: "2026-04-22",
      deliveryMode: "preview",
      notificationOverride: {
        channel: "wecom",
        target: "龙虾测试群",
        accountId: "acct-1",
        threadId: "thread-9",
        enabled: true,
      },
    });
  });

  it("registers an inbound-audit command so sender ids can be recovered from persisted inbound traffic", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    runtime.listInboundMessageAudits.mockResolvedValue([
      {
        requestId: "req-audit-1",
        channel: "wecom",
        senderId: "wecom-user-42",
        senderName: "李人培-安阳市区运营总",
        conversationId: "chat-yiwu",
        content: "这几天义乌店的点钟率多少？加钟多少？",
        effectiveContent: "这几天义乌店的点钟率多少？加钟多少？",
        receivedAt: "2026-04-14T00:30:00+08:00",
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      ["hetang", "inbound-audit", "--contains", "义乌店", "--limit", "1"],
      { from: "user" },
    );

    expect(runtime.listInboundMessageAudits).toHaveBeenCalledWith({
      channel: "wecom",
      senderId: undefined,
      conversationId: undefined,
      contains: "义乌店",
      limit: 1,
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("wecom-user-42"),
    );
  });

  it("renders inbound audits as json when requested", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    runtime.listInboundMessageAudits.mockResolvedValue([
      {
        requestId: "req-audit-json-1",
        channel: "wecom",
        senderId: "wecom-user-99",
        senderName: "张震",
        conversationId: "chat-json",
        content: "义乌店尾号7500客户画像",
        effectiveContent: "义乌店尾号7500客户画像",
        receivedAt: "2026-04-14T18:00:00+08:00",
      },
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      ["hetang", "inbound-audit", "--contains", "画像", "--limit", "1", "--json"],
      { from: "user" },
    );

    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        [
          {
            requestId: "req-audit-json-1",
            channel: "wecom",
            senderId: "wecom-user-99",
            senderName: "张震",
            conversationId: "chat-json",
            content: "义乌店尾号7500客户画像",
            effectiveContent: "义乌店尾号7500客户画像",
            receivedAt: "2026-04-14T18:00:00+08:00",
          },
        ],
        null,
        2,
      ),
    );
  });

  it("shows the effective routing mode and semantic canary list", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    runtime.resolveControlTowerSettings.mockResolvedValue({
      "routing.mode": "shadow",
      "routing.semanticCanarySenderIds": "user-1,user-2",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(["hetang", "routing-mode"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith("routing.mode=shadow");
    expect(logSpy).toHaveBeenCalledWith("routing.semanticCanarySenderIds=user-1,user-2");
  });

  it("updates the global routing mode from the CLI", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(["hetang", "routing-mode", "shadow"], { from: "user" });

    expect(runtime.upsertControlTowerSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "global",
        scopeKey: "global",
        settingKey: "routing.mode",
        value: "shadow",
        updatedBy: "cli:hetang-routing-mode",
      }),
    );
    expect(logSpy).toHaveBeenCalledWith("updated routing.mode=shadow");
  });

  it("updates the semantic canary sender list from the CLI", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(
      ["hetang", "routing-canary", "--users", "user-1,user-2,user-1"],
      { from: "user" },
    );

    expect(runtime.upsertControlTowerSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "global",
        scopeKey: "global",
        settingKey: "routing.semanticCanarySenderIds",
        value: "user-1,user-2",
        updatedBy: "cli:hetang-routing-canary",
      }),
    );
    expect(logSpy).toHaveBeenCalledWith("updated routing.semanticCanarySenderIds=user-1,user-2");
  });

  it("clears the semantic canary sender list from the CLI", async () => {
    const program = new Command();
    const runtime = buildRuntime();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    registerHetangCli({
      program,
      runtime: runtime as never,
    });

    await program.parseAsync(["hetang", "routing-canary", "--clear"], { from: "user" });

    expect(runtime.upsertControlTowerSetting).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeType: "global",
        scopeKey: "global",
        settingKey: "routing.semanticCanarySenderIds",
        value: "",
        updatedBy: "cli:hetang-routing-canary",
      }),
    );
    expect(logSpy).toHaveBeenCalledWith("cleared routing.semanticCanarySenderIds");
  });
});
