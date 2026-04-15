export type CodexEnhancementPriority = "p0" | "p1" | "p2";

export type CodexEnhancementRecommendation = {
  id: string;
  title: string;
  priority: CodexEnhancementPriority;
  sourceProject: "exa-mcp-server" | "oh-my-codex" | "everything-claude-code" | "repo-local";
  whyItMatters: string;
  landingMode: "direct" | "staged" | "selective";
};

export type CodexDoctorState = {
  codexCliInstalled: boolean;
  exaMcpConfigured: boolean | null;
  repoDocsReady: boolean;
  repoBootstrapReady: boolean;
  repoDoctorReady: boolean;
};

export type CodexBootstrapPlan = {
  summary: string;
  commands: string[];
  followUps: string[];
};

const RECOMMENDATIONS: CodexEnhancementRecommendation[] = [
  {
    id: "exa-mcp-search-layer",
    title: "Exa MCP search layer",
    priority: "p0",
    sourceProject: "exa-mcp-server",
    whyItMatters: "直接增强 Codex 的实时检索、文档查找、代码和公司研究能力。",
    landingMode: "direct",
  },
  {
    id: "repo-local-doctor-and-bootstrap",
    title: "Repo-local doctor and bootstrap",
    priority: "p0",
    sourceProject: "repo-local",
    whyItMatters: "把安装、诊断、升级入口沉淀到仓库里，避免全局环境黑箱化。",
    landingMode: "direct",
  },
  {
    id: "repo-local-operator-docs",
    title: "Repo-local operator docs",
    priority: "p0",
    sourceProject: "repo-local",
    whyItMatters: "把可复用的增强方案、安装路径和边界写成长期文档，便于团队复用。",
    landingMode: "direct",
  },
  {
    id: "omx-workflow-layer",
    title: "oh-my-codex workflow layer",
    priority: "p1",
    sourceProject: "oh-my-codex",
    whyItMatters: "增强 clarify/plan/execute/verify 的工作流和 hooks 能力。",
    landingMode: "staged",
  },
  {
    id: "omx-team-runtime",
    title: "oh-my-codex team runtime",
    priority: "p1",
    sourceProject: "oh-my-codex",
    whyItMatters: "适合较大的并行开发任务，但不应先于基础 doctor/bootstrap 落地。",
    landingMode: "staged",
  },
  {
    id: "ecc-selective-patterns",
    title: "everything-claude-code selective patterns",
    priority: "p1",
    sourceProject: "everything-claude-code",
    whyItMatters: "可选择性借鉴 memory、verification、security、research-first 模式。",
    landingMode: "selective",
  },
  {
    id: "ecc-session-memory-pattern",
    title: "Session memory pattern",
    priority: "p2",
    sourceProject: "everything-claude-code",
    whyItMatters: "适合后续补 session summary / handoff，不适合现在全量接入。",
    landingMode: "selective",
  },
  {
    id: "ecc-verification-hooks",
    title: "Verification hooks pattern",
    priority: "p2",
    sourceProject: "everything-claude-code",
    whyItMatters: "适合把验证前置，但要结合当前仓库已有 test/doctor 体系渐进接入。",
    landingMode: "selective",
  },
  {
    id: "repo-local-research-playbook",
    title: "Research playbook",
    priority: "p2",
    sourceProject: "repo-local",
    whyItMatters: "让检索增强真正进入研发日常，而不是只装一个 MCP 不会用。",
    landingMode: "direct",
  },
  {
    id: "repo-local-upgrade-policy",
    title: "Upgrade policy",
    priority: "p2",
    sourceProject: "repo-local",
    whyItMatters: "明确什么能自动接、什么必须灰度，降低后续增强时的环境风险。",
    landingMode: "direct",
  },
];

export function listCodexEnhancementRecommendations(): CodexEnhancementRecommendation[] {
  return [...RECOMMENDATIONS];
}

function resolveExaStatus(configured: boolean | null): string {
  if (configured === true) {
    return "configured";
  }
  if (configured === false) {
    return "apply needed";
  }
  return "unknown";
}

function resolveRepoPackReady(state: CodexDoctorState): boolean {
  return state.repoDocsReady && state.repoBootstrapReady && state.repoDoctorReady;
}

export function renderCodexEnhancementDoctorReport(state: CodexDoctorState): string {
  return [
    "Codex enhancement doctor",
    `Codex CLI: ${state.codexCliInstalled ? "installed" : "missing"}`,
    `Exa MCP: ${resolveExaStatus(state.exaMcpConfigured)}`,
    `Repo enhancement pack: ${resolveRepoPackReady(state) ? "ready" : "incomplete"}`,
    `Repo docs: ${state.repoDocsReady ? "ready" : "missing"}`,
    `Repo bootstrap: ${state.repoBootstrapReady ? "ready" : "missing"}`,
    `Repo doctor: ${state.repoDoctorReady ? "ready" : "missing"}`,
    "oh-my-codex workflow layer: optional",
    "everything-claude-code patterns: selective import",
  ].join("\n");
}

export function buildCodexBootstrapPlan(params: {
  codexCliInstalled: boolean;
  exaMcpConfigured: boolean | null;
}): CodexBootstrapPlan {
  const commands: string[] = [];
  if (params.codexCliInstalled && params.exaMcpConfigured !== true) {
    commands.push("codex mcp add exa --url https://mcp.exa.ai/mcp");
  } else if (!params.codexCliInstalled) {
    commands.push("先安装 Codex CLI，再执行 Exa MCP 接入。");
  }
  commands.push("阅读 docs/codex-enhancement-pack.md");
  commands.push("npm run codex:doctor");

  return {
    summary: "先完成 Exa 搜索层接入，再决定是否叠加更重的 workflow layer。",
    commands,
    followUps: [
      "先验证 Exa MCP 已被 Codex 识别并能正常检索。",
      "再决定是否引入 oh-my-codex 的 workflow layer。",
      "everything-claude-code 只做 selective patterns，不做整仓覆盖。",
    ],
  };
}

export function renderCodexBootstrapFailure(errorMessage: string): string {
  const normalized = errorMessage.trim();
  if (/\/root\/\.codex\/config\.toml/u.test(normalized) && /read-only file system/iu.test(normalized)) {
    return [
      "无法自动写入全局 Codex 配置。",
      "目标文件: /root/.codex/config.toml",
      "原因: 当前环境把全局 Codex 配置目录挂成只读。",
      "处理方式: 请在主机上解除只读后重试，或手工执行 `codex mcp add exa --url https://mcp.exa.ai/mcp`。",
    ].join("\n");
  }
  return `Codex bootstrap failed: ${normalized}`;
}

export function summarizeCodexBootstrapError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const stderr = "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "").trim() : "";
    if (stderr.length > 0) {
      return stderr;
    }
    const stdout = "stdout" in error ? String((error as { stdout?: unknown }).stdout ?? "").trim() : "";
    if (stdout.length > 0) {
      return stdout;
    }
    const message =
      "message" in error ? String((error as { message?: unknown }).message ?? "").trim() : "";
    if (message.length > 0) {
      return message;
    }
  }
  return String(error ?? "");
}
