# arch-retro

Purpose: produce an architecture-focused retro after drift, incident, or failed rollout.

Use this when:

- production behavior diverged from expected architecture
- observability was insufficient to explain a failure
- a subsystem kept regressing despite repeated fixes
- the team needs a post-incident design correction path

Required context:

- incident summary or operator notes
- `AGENTS.md`
- `docs/prompts/chief-system-ai-architect.md`
- `docs/prompts/project-architecture-rules.md`
- affected design docs
- relevant logs, doctor output, queue or scheduler snapshots

Expected output:

- what failed
- why the architecture allowed it
- what truth surfaces were missing or ambiguous
- what minimal structural change prevents recurrence
- what should stay unchanged

Durable artifact:

- save to `docs/reviews/YYYY-MM-DD-<topic>-retro.md`

Rules:

- focus on system causes over individual mistakes
- separate trigger, mechanism, and structural fix
- do not recommend platformization unless the current shape is demonstrably saturated
