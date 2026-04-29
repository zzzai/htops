# Codex Workflow Layer Implementation Plan

## Goal

Add a repo-local OMX-style workflow layer with AGENTS guidance, command guides, a plan template, and a doctor script.

## Files

- Create: `AGENTS.md`
- Create: `.omx/README.md`
- Create: `.omx/.gitignore`
- Create: `.omx/commands/deep-interview.md`
- Create: `.omx/commands/ralplan.md`
- Create: `.omx/commands/ralph.md`
- Create: `.omx/commands/team.md`
- Create: `.omx/templates/approved-plan-template.md`
- Create: `docs/codex-workflow-layer.md`
- Create: `scripts/codex-workflow-doctor.ts`
- Modify: `scripts/codex-doctor.ts`
- Modify: `package.json`
- Modify: `README.md`

## Verification

```bash
npm test -- src/codex-workflow-pack.test.ts
npm run codex:workflow:doctor
npm run codex:doctor
```
