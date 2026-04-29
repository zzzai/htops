export type CodexWorkflowPackFile = {
  path: string;
  description: string;
};

export type CodexWorkflowPackDoctorState = {
  agentsReady: boolean;
  omxRootReady: boolean;
  commandPackReady: boolean;
  architecturePackReady: boolean;
  templateReady: boolean;
  promptPackReady: boolean;
  docsReady: boolean;
};

export type CodexWorkflowInitChecklist = {
  summary: string;
  steps: string[];
};

const WORKFLOW_PACK_FILES: CodexWorkflowPackFile[] = [
  {
    path: "AGENTS.md",
    description: "项目级工作约定和本仓库 Codex 协作规则。",
  },
  {
    path: ".omx/README.md",
    description: "Repo-local OMX 风格工作流说明。",
  },
  {
    path: ".omx/.gitignore",
    description: "忽略运行态 state/logs，只保留模板和文档。",
  },
  {
    path: ".omx/commands/deep-interview.md",
    description: "clarify 阶段命令说明。",
  },
  {
    path: ".omx/commands/ralplan.md",
    description: "plan 阶段命令说明。",
  },
  {
    path: ".omx/commands/ralph.md",
    description: "execute 阶段命令说明。",
  },
  {
    path: ".omx/commands/team.md",
    description: "并行执行与分工命令说明。",
  },
  {
    path: ".omx/commands/arch-review.md",
    description: "架构评审命令说明。",
  },
  {
    path: ".omx/commands/arch-design.md",
    description: "架构设计命令说明。",
  },
  {
    path: ".omx/commands/arch-retro.md",
    description: "架构复盘命令说明。",
  },
  {
    path: ".omx/templates/approved-plan-template.md",
    description: "批准后计划模板。",
  },
  {
    path: ".omx/templates/architecture-review-template.md",
    description: "架构评审模板。",
  },
  {
    path: ".omx/templates/architecture-design-template.md",
    description: "架构设计模板。",
  },
  {
    path: ".omx/templates/architecture-retro-template.md",
    description: "架构复盘模板。",
  },
  {
    path: "docs/prompts/chief-system-ai-architect.md",
    description: "架构师角色提示词。",
  },
  {
    path: "docs/prompts/project-architecture-rules.md",
    description: "项目级架构规则提示词。",
  },
  {
    path: "docs/prompts/architecture-context-pack.md",
    description: "架构任务上下文包说明。",
  },
  {
    path: "docs/reviews/README.md",
    description: "架构评审与复盘产物目录说明。",
  },
  {
    path: "docs/adr/README.md",
    description: "架构决策记录目录说明。",
  },
];

export function listCodexWorkflowPackFiles(): CodexWorkflowPackFile[] {
  return [...WORKFLOW_PACK_FILES];
}

function resolveWorkflowPackReady(state: CodexWorkflowPackDoctorState): boolean {
  return (
    state.agentsReady &&
    state.omxRootReady &&
    state.commandPackReady &&
    state.architecturePackReady &&
    state.templateReady &&
    state.promptPackReady
  );
}

export function renderCodexWorkflowPackDoctorReport(
  state: CodexWorkflowPackDoctorState,
): string {
  return [
    "Codex workflow pack doctor",
    `Workflow pack: ${resolveWorkflowPackReady(state) ? "ready" : "apply needed"}`,
    `AGENTS.md: ${state.agentsReady ? "ready" : "missing"}`,
    `.omx root: ${state.omxRootReady ? "ready" : "missing"}`,
    `Command pack: ${state.commandPackReady ? "ready" : "missing"}`,
    `Architecture pack: ${state.architecturePackReady ? "ready" : "missing"}`,
    `Templates: ${state.templateReady ? "ready" : "missing"}`,
    `Prompt pack: ${state.promptPackReady ? "ready" : "missing"}`,
    `Workflow docs: ${state.docsReady ? "ready" : "apply needed"}`,
  ].join("\n");
}

export function buildCodexWorkflowInitChecklist(): CodexWorkflowInitChecklist {
  return {
    summary:
      "把 repo-local workflow layer 固定成 clarify -> plan -> execute -> verify 的稳定路径，并补上架构评审/设计/复盘入口。",
    steps: [
      "把 `.omx/commands/deep-interview.md` 作为 `$deep-interview` 的项目内说明书。",
      "把 `.omx/commands/ralplan.md` 作为 `$ralplan` 的计划收口模板。",
      "把 `.omx/commands/ralph.md` 作为 `$ralph` 的执行入口约定。",
      "把 `.omx/commands/team.md` 作为 `$team` 的并行执行约定，而不是默认全量启用。",
      "把 `.omx/commands/arch-review.md`、`.omx/commands/arch-design.md`、`.omx/commands/arch-retro.md` 固定为架构治理入口。",
      "把 `docs/prompts/` 作为角色提示词、项目规则和上下文包的稳定来源。",
      "所有正式计划仍然沉淀到 `docs/plans/`，避免把运行态状态写成长期文档。",
    ],
  };
}
