# arch-review

Purpose: run a durable architecture review using the repo-local Chief System & AI Architect prompt pack.

Use this when:

- the request spans multiple modules
- you need an architecture assessment before major changes
- production drift or operational ambiguity is suspected
- you need a bounded remediation path, not just observations

Required context:

- `AGENTS.md`
- `docs/prompts/chief-system-ai-architect.md`
- `docs/prompts/project-architecture-rules.md`
- `docs/prompts/architecture-context-pack.md`
- relevant `docs/plans/*`
- owner modules and tests for the subsystem under review

Expected output:

- business insight
- architecture findings ordered by severity
- option comparison and recommendation
- core data model notes
- boundary assessment
- phased corrective actions

Durable artifact:

- save to `docs/reviews/YYYY-MM-DD-<topic>-review.md`

Rules:

- prefer evidence over broad opinions
- distinguish current state from target state
- recommend bounded migrations, not big-bang rewrites
- if there are no findings, say so explicitly and record residual risks
