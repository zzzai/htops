# arch-design

Purpose: turn a significant architecture need into a durable design before implementation starts.

Use this when:

- a new subsystem is needed
- a cross-cutting refactor is under consideration
- the data model or control plane will change
- AI behavior must be introduced into a deterministic workflow

Required context:

- `AGENTS.md`
- `docs/prompts/chief-system-ai-architect.md`
- `docs/prompts/project-architecture-rules.md`
- `docs/prompts/architecture-context-pack.md`
- existing design docs for adjacent systems
- current owner modules

Expected output:

- business problem summary
- 2 or more architecture options with trade-offs
- recommended option with rationale
- core data model
- module and contract boundaries
- MVP and staged rollout

Durable artifact:

- save to `docs/plans/YYYY-MM-DD-<topic>-design.md`

Rules:

- prefer incremental kernelization over broad rewrites
- keep AI paths bounded by deterministic contracts
- name exact owner modules for the first implementation slice
