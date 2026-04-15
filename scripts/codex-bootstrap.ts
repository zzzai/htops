import { execFileSync } from "node:child_process";
import {
  buildCodexBootstrapPlan,
  renderCodexBootstrapFailure,
  summarizeCodexBootstrapError,
} from "../src/codex-enhancement.js";

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

function applyExaBootstrap(): void {
  execFileSync("codex", ["mcp", "add", "exa", "--url", "https://mcp.exa.ai/mcp"], {
    stdio: "pipe",
    encoding: "utf8",
  });
}

const shouldApplyExa = process.argv.includes("--apply-exa");
const codexCliInstalled = commandExists("codex");
const exaMcpConfigured = detectExaMcpConfigured();
const plan = buildCodexBootstrapPlan({
  codexCliInstalled,
  exaMcpConfigured,
});

if (shouldApplyExa) {
  if (!codexCliInstalled) {
    console.error("Codex CLI 未安装，无法直接执行 Exa MCP 接入。");
    process.exit(1);
  }
  if (exaMcpConfigured === true) {
    console.log("Exa MCP 已存在，无需重复接入。");
  } else {
    try {
      applyExaBootstrap();
    } catch (error) {
      const message = summarizeCodexBootstrapError(error);
      console.error(renderCodexBootstrapFailure(message));
      process.exit(1);
    }
  }
}

console.log(`Bootstrap summary: ${plan.summary}`);
console.log("Commands:");
plan.commands.forEach((line) => console.log(`- ${line}`));
console.log("Follow-ups:");
plan.followUps.forEach((line) => console.log(`- ${line}`));
