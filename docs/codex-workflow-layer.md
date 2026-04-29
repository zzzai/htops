# Codex Workflow Layer

This repository now ships a repo-local workflow layer inspired by `oh-my-codex`, but intentionally lighter and safer.

## What Is Included

- `AGENTS.md`
- `.omx/README.md`
- `.omx/commands/deep-interview.md`
- `.omx/commands/ralplan.md`
- `.omx/commands/ralph.md`
- `.omx/commands/team.md`
- `.omx/commands/arch-review.md`
- `.omx/commands/arch-design.md`
- `.omx/commands/arch-retro.md`
- `.omx/templates/approved-plan-template.md`
- `.omx/templates/architecture-review-template.md`
- `.omx/templates/architecture-design-template.md`
- `.omx/templates/architecture-retro-template.md`
- `docs/prompts/chief-system-ai-architect.md`
- `docs/prompts/project-architecture-rules.md`
- `docs/prompts/architecture-context-pack.md`

## Why This Shape

The goal is to capture the useful parts of `oh-my-codex` without immediately rewriting the global Codex home or hook configuration.

This repo-local layer gives the team:

- a stable clarify flow
- a stable planning flow
- a stable execution flow
- a stable parallelization rule set
- a stable architecture review and design entrypoint

## Command Mapping

- `$deep-interview`
  - clarify the request and identify the real target layer
- `$ralplan`
  - write the approved implementation plan into `docs/plans/`
- `$ralph`
  - execute the plan with tests and verification
- `$team`
  - split only independent work
- `$arch-review`
  - produce a durable architecture review in `docs/reviews/`
- `$arch-design`
  - produce a durable architecture design in `docs/plans/`
- `$arch-retro`
  - produce a durable architecture retro in `docs/reviews/`

## Repo Check

Run:

```bash
npm run codex:workflow:doctor
```

## Boundary

This is not a full `oh-my-codex` import.

It is a low-risk adaptation layer for this repository only. If later you decide to introduce the full workflow layer globally, this repo-local pack should remain a stable fallback and documentation source.
