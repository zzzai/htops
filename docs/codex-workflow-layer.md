# Codex Workflow Layer

This repository now ships a repo-local workflow layer inspired by `oh-my-codex`, but intentionally lighter and safer.

## What Is Included

- `AGENTS.md`
- `.omx/README.md`
- `.omx/commands/deep-interview.md`
- `.omx/commands/ralplan.md`
- `.omx/commands/ralph.md`
- `.omx/commands/team.md`
- `.omx/templates/approved-plan-template.md`

## Why This Shape

The goal is to capture the useful parts of `oh-my-codex` without immediately rewriting the global Codex home or hook configuration.

This repo-local layer gives the team:

- a stable clarify flow
- a stable planning flow
- a stable execution flow
- a stable parallelization rule set

## Command Mapping

- `$deep-interview`
  - clarify the request and identify the real target layer
- `$ralplan`
  - write the approved implementation plan into `docs/plans/`
- `$ralph`
  - execute the plan with tests and verification
- `$team`
  - split only independent work

## Repo Check

Run:

```bash
npm run codex:workflow:doctor
```

## Boundary

This is not a full `oh-my-codex` import.

It is a low-risk adaptation layer for this repository only. If later you decide to introduce the full workflow layer globally, this repo-local pack should remain a stable fallback and documentation source.
