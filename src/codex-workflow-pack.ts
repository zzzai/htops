export type CodexWorkflowPackFile = {
  path: string;
  description: string;
};

export type CodexWorkflowPackDoctorState = {
  agentsReady: boolean;
  omxRootReady: boolean;
  commandPackReady: boolean;
  templateReady: boolean;
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
    path: ".omx/templates/approved-plan-template.md",
    description: "批准后计划模板。",
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
    state.templateReady
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
    `Plan template: ${state.templateReady ? "ready" : "missing"}`,
    `Workflow docs: ${state.docsReady ? "ready" : "apply needed"}`,
  ].join("\n");
}

export function buildCodexWorkflowInitChecklist(): CodexWorkflowInitChecklist {
  return {
    summary: "把 repo-local workflow layer 固定成 clarify -> plan -> execute -> verify 的稳定路径。",
    steps: [
      "把 `.omx/commands/deep-interview.md` 作为 `$deep-interview` 的项目内说明书。",
      "把 `.omx/commands/ralplan.md` 作为 `$ralplan` 的计划收口模板。",
      "把 `.omx/commands/ralph.md` 作为 `$ralph` 的执行入口约定。",
      "把 `.omx/commands/team.md` 作为 `$team` 的并行执行约定，而不是默认全量启用。",
      "所有正式计划仍然沉淀到 `docs/plans/`，避免把运行态状态写成长期文档。",
    ],
  };
}
