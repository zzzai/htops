import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildCodexWorkflowInitChecklist,
  listCodexWorkflowPackFiles,
  renderCodexWorkflowPackDoctorReport,
} from "../src/codex-workflow-pack.js";

const repoRoot = process.cwd();
const has = (relativePath: string) => existsSync(path.join(repoRoot, relativePath));

const report = renderCodexWorkflowPackDoctorReport({
  agentsReady: has("AGENTS.md"),
  omxRootReady: has(".omx/README.md") && has(".omx/.gitignore"),
  commandPackReady:
    has(".omx/commands/deep-interview.md") &&
    has(".omx/commands/ralplan.md") &&
    has(".omx/commands/ralph.md") &&
    has(".omx/commands/team.md"),
  architecturePackReady:
    has(".omx/commands/arch-review.md") &&
    has(".omx/commands/arch-design.md") &&
    has(".omx/commands/arch-retro.md"),
  templateReady:
    has(".omx/templates/approved-plan-template.md") &&
    has(".omx/templates/architecture-review-template.md") &&
    has(".omx/templates/architecture-design-template.md") &&
    has(".omx/templates/architecture-retro-template.md"),
  promptPackReady:
    has("docs/prompts/chief-system-ai-architect.md") &&
    has("docs/prompts/project-architecture-rules.md") &&
    has("docs/prompts/architecture-context-pack.md") &&
    has("docs/reviews/README.md") &&
    has("docs/adr/README.md"),
  docsReady: has("docs/codex-workflow-layer.md"),
});

console.log(report);
console.log("");
console.log("Workflow files:");
listCodexWorkflowPackFiles().forEach((file, index) => {
  console.log(`${index + 1}. ${file.path} | ${file.description}`);
});

console.log("");
const checklist = buildCodexWorkflowInitChecklist();
console.log(`Checklist summary: ${checklist.summary}`);
checklist.steps.forEach((step) => console.log(`- ${step}`));
