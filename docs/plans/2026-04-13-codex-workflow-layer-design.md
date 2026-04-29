# Codex Workflow Layer Design

## Goal

Land a repo-local workflow layer inspired by `oh-my-codex` without modifying the operator's global Codex setup by default.

## Shape

The workflow layer is represented by:

- `AGENTS.md`
- `.omx/README.md`
- `.omx/commands/`
- `.omx/templates/`
- `scripts/codex-workflow-doctor.ts`

## Why Repo-Local First

This gives the project a stable collaboration protocol immediately while keeping the global Codex environment reversible and low-risk.

## Command Mapping

- `deep-interview` -> clarify
- `ralplan` -> plan
- `ralph` -> execute
- `team` -> controlled parallelism

## Success Criteria

- Workflow files are present in the repo.
- The repo exposes a workflow doctor command.
- The main README and Codex enhancement pack point at the workflow layer.
