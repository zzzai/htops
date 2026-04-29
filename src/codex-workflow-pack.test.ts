import { describe, expect, it } from "vitest";
import {
  buildCodexWorkflowInitChecklist,
  listCodexWorkflowPackFiles,
  renderCodexWorkflowPackDoctorReport,
} from "./codex-workflow-pack.js";

describe("codex workflow pack", () => {
  it("declares the repo-local workflow files needed for a low-risk OMX-style layer", () => {
    const files = listCodexWorkflowPackFiles();

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".omx/README.md",
        ".omx/.gitignore",
        ".omx/commands/deep-interview.md",
        ".omx/commands/ralplan.md",
        ".omx/commands/ralph.md",
        ".omx/commands/team.md",
        ".omx/commands/arch-review.md",
        ".omx/commands/arch-design.md",
        ".omx/commands/arch-retro.md",
        ".omx/templates/approved-plan-template.md",
        ".omx/templates/architecture-review-template.md",
        ".omx/templates/architecture-design-template.md",
        ".omx/templates/architecture-retro-template.md",
        "docs/prompts/chief-system-ai-architect.md",
        "docs/prompts/project-architecture-rules.md",
        "docs/prompts/architecture-context-pack.md",
      ]),
    );
  });

  it("renders a workflow doctor report that separates ready items from next actions", () => {
    const text = renderCodexWorkflowPackDoctorReport({
      agentsReady: true,
      omxRootReady: true,
      commandPackReady: true,
      architecturePackReady: true,
      templateReady: true,
      promptPackReady: true,
      docsReady: false,
    });

    expect(text).toContain("Workflow pack: ready");
    expect(text).toContain("AGENTS.md: ready");
    expect(text).toContain("Workflow docs: apply needed");
    expect(text).toContain("Command pack: ready");
    expect(text).toContain("Architecture pack: ready");
    expect(text).toContain("Prompt pack: ready");
  });

  it("builds a checklist that maps OMX commands to repo-local usage", () => {
    const checklist = buildCodexWorkflowInitChecklist();

    expect(checklist.summary).toContain("clarify -> plan -> execute -> verify");
    expect(checklist.steps).toContain(
      "把 `.omx/commands/deep-interview.md` 作为 `$deep-interview` 的项目内说明书。",
    );
    expect(checklist.steps).toContain(
      "把 `.omx/commands/team.md` 作为 `$team` 的并行执行约定，而不是默认全量启用。",
    );
    expect(checklist.steps).toContain(
      "把 `.omx/commands/arch-review.md`、`.omx/commands/arch-design.md`、`.omx/commands/arch-retro.md` 固定为架构治理入口。",
    );
  });
});
