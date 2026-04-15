# Codex Enhancement Pack

This repository now carries a project-local Codex enhancement pack. The goal is not to replace the global Codex installation, but to make the best next-step upgrades explicit, repeatable, and safe.

## What Is Landed In Repo

- `npm run codex:doctor`
  - Checks whether Codex CLI exists.
  - Tries to detect whether Exa MCP is already configured.
  - Verifies that the repo-local enhancement artifacts are present.
- `npm run codex:bootstrap`
  - Prints the staged bootstrap plan.
- `npm run codex:bootstrap -- --apply-exa`
  - Attempts to add Exa MCP to Codex directly on the host machine.
- `npm run codex:workflow:doctor`
  - Checks whether the repo-local workflow layer is fully present.

## Priority Order

1. `exa-mcp-server`
   - Best immediate ROI.
   - Improves search, docs lookup, code lookup, and research-heavy development.
2. `repo-local doctor/bootstrap/docs`
   - Makes the Codex upgrade path visible and operable inside the project.
3. `oh-my-codex`
   - Strong workflow/hook layer, but should be introduced only after the search layer is stable.
4. `everything-claude-code`
   - Use as a pattern library, not as a full overlay.

## Recommended Commands

```bash
npm run codex:doctor
npm run codex:bootstrap
npm run codex:workflow:doctor
```

If you want to install Exa MCP on the host:

```bash
npm run codex:bootstrap -- --apply-exa
```

## Why Exa First

Exa is the cleanest upgrade because it enhances Codex without forcing a new workflow or overwriting existing global prompts/hooks. It acts as an external research layer, which is useful immediately for:

- official documentation lookup
- dependency and SDK verification
- web and company research
- code-search-oriented exploration

## Why Not Install Everything At Once

`oh-my-codex` and `everything-claude-code` are both opinionated. They can be powerful, but they also change how the overall environment behaves. For this project, the safest path is:

1. stabilize search and doctoring first
2. validate the gain in daily development
3. only then add a stronger workflow layer

## Suggested Adoption Policy

- `Exa`: direct
- `oh-my-codex`: staged
- `everything-claude-code`: selective import only
