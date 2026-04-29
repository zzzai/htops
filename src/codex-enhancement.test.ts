import { describe, expect, it } from "vitest";
import {
  buildCodexBootstrapPlan,
  listCodexEnhancementRecommendations,
  renderCodexBootstrapFailure,
  summarizeCodexBootstrapError,
  renderCodexEnhancementDoctorReport,
} from "./codex-enhancement.js";

describe("codex enhancement pack", () => {
  it("returns a prioritized top 10 recommendation set with Exa first", () => {
    const items = listCodexEnhancementRecommendations();

    expect(items).toHaveLength(10);
    expect(items[0]).toMatchObject({
      id: "exa-mcp-search-layer",
      priority: "p0",
      sourceProject: "exa-mcp-server",
    });
    expect(items.map((item) => item.id)).toContain("repo-local-doctor-and-bootstrap");
    expect(items.map((item) => item.id)).toContain("omx-workflow-layer");
    expect(items.map((item) => item.id)).toContain("ecc-selective-patterns");
  });

  it("renders a doctor report with landed, apply-needed, and optional buckets", () => {
    const text = renderCodexEnhancementDoctorReport({
      codexCliInstalled: true,
      exaMcpConfigured: false,
      repoDocsReady: true,
      repoBootstrapReady: true,
      repoDoctorReady: true,
    });

    expect(text).toContain("Codex CLI: installed");
    expect(text).toContain("Exa MCP: apply needed");
    expect(text).toContain("Repo enhancement pack: ready");
    expect(text).toContain("oh-my-codex workflow layer: optional");
    expect(text).toContain("everything-claude-code patterns: selective import");
  });

  it("builds bootstrap commands with Exa first and staged follow-up steps", () => {
    const plan = buildCodexBootstrapPlan({
      codexCliInstalled: true,
      exaMcpConfigured: false,
    });

    expect(plan.summary).toContain("Exa");
    expect(plan.commands[0]).toContain("codex mcp add exa --url https://mcp.exa.ai/mcp");
    expect(plan.commands.some((line) => line.includes("docs/codex-enhancement-pack.md"))).toBe(
      true,
    );
    expect(plan.followUps).toContain("再决定是否引入 oh-my-codex 的 workflow layer。");
  });

  it("renders a readable bootstrap failure for read-only global codex config", () => {
    const text = renderCodexBootstrapFailure(
      "failed to persist config.toml at /root/.codex/config.toml: Read-only file system",
    );

    expect(text).toContain("无法自动写入全局 Codex 配置");
    expect(text).toContain("/root/.codex/config.toml");
    expect(text).toContain("只读");
  });

  it("prefers stderr details when summarizing bootstrap command failures", () => {
    const text = summarizeCodexBootstrapError({
      message: "Command failed: codex mcp add exa --url https://mcp.exa.ai/mcp",
      stderr:
        "Error: failed to write MCP servers to /root/.codex\n\nCaused by:\n0: failed to persist config.toml at /root/.codex/config.toml\n1: Read-only file system",
    });

    expect(text).toContain("failed to persist config.toml");
    expect(text).toContain("/root/.codex/config.toml");
  });
});
