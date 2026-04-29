import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildCodexBootstrapPlan,
  listCodexEnhancementRecommendations,
  renderCodexEnhancementDoctorReport,
} from "../src/codex-enhancement.js";
import { renderCodexWorkflowPackDoctorReport } from "../src/codex-workflow-pack.js";

function commandExists(command: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(command, args, {
      stdio: "pipe",
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

function detectExaMcpConfigured(): boolean | null {
  if (!commandExists("codex")) {
    return null;
  }
  try {
    const output = execFileSync("codex", ["mcp", "list"], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return /\bexa\b/i.test(output);
  } catch {
    return null;
  }
}

const repoRoot = process.cwd();
const docsReady = existsSync(path.join(repoRoot, "docs", "codex-enhancement-pack.md"));
const bootstrapReady = existsSync(path.join(repoRoot, "scripts", "codex-bootstrap.ts"));
const doctorReady = existsSync(path.join(repoRoot, "scripts", "codex-doctor.ts"));
const codexCliInstalled = commandExists("codex");
const exaMcpConfigured = detectExaMcpConfigured();
const workflowDoctor = renderCodexWorkflowPackDoctorReport({
  agentsReady: existsSync(path.join(repoRoot, "AGENTS.md")),
  omxRootReady:
    existsSync(path.join(repoRoot, ".omx", "README.md")) &&
    existsSync(path.join(repoRoot, ".omx", ".gitignore")),
  commandPackReady:
    existsSync(path.join(repoRoot, ".omx", "commands", "deep-interview.md")) &&
    existsSync(path.join(repoRoot, ".omx", "commands", "ralplan.md")) &&
    existsSync(path.join(repoRoot, ".omx", "commands", "ralph.md")) &&
    existsSync(path.join(repoRoot, ".omx", "commands", "team.md")),
  architecturePackReady:
    existsSync(path.join(repoRoot, ".omx", "commands", "arch-review.md")) &&
    existsSync(path.join(repoRoot, ".omx", "commands", "arch-design.md")) &&
    existsSync(path.join(repoRoot, ".omx", "commands", "arch-retro.md")),
  templateReady:
    existsSync(path.join(repoRoot, ".omx", "templates", "approved-plan-template.md")) &&
    existsSync(path.join(repoRoot, ".omx", "templates", "architecture-review-template.md")) &&
    existsSync(path.join(repoRoot, ".omx", "templates", "architecture-design-template.md")) &&
    existsSync(path.join(repoRoot, ".omx", "templates", "architecture-retro-template.md")),
  promptPackReady:
    existsSync(path.join(repoRoot, "docs", "prompts", "chief-system-ai-architect.md")) &&
    existsSync(path.join(repoRoot, "docs", "prompts", "project-architecture-rules.md")) &&
    existsSync(path.join(repoRoot, "docs", "prompts", "architecture-context-pack.md")) &&
    existsSync(path.join(repoRoot, "docs", "reviews", "README.md")) &&
    existsSync(path.join(repoRoot, "docs", "adr", "README.md")),
  docsReady: existsSync(path.join(repoRoot, "docs", "codex-workflow-layer.md")),
});

console.log(
  renderCodexEnhancementDoctorReport({
    codexCliInstalled,
    exaMcpConfigured,
    repoDocsReady: docsReady,
    repoBootstrapReady: bootstrapReady,
    repoDoctorReady: doctorReady,
  }),
);

console.log("");
console.log(workflowDoctor);
console.log("");
console.log("Top recommendations:");
listCodexEnhancementRecommendations().forEach((item, index) => {
  console.log(
    `${index + 1}. [${item.priority}] ${item.title} | ${item.sourceProject} | ${item.landingMode} | ${item.whyItMatters}`,
  );
});

console.log("");
const bootstrapPlan = buildCodexBootstrapPlan({
  codexCliInstalled,
  exaMcpConfigured,
});
console.log(`Bootstrap summary: ${bootstrapPlan.summary}`);
bootstrapPlan.commands.forEach((line) => console.log(`- ${line}`));
