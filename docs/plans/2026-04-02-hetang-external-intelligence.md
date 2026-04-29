# Hetang External Intelligence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a first HQ-facing external intelligence engine that produces a high-quality daily dual-layer brief for Hetang instead of low-quality search-result summaries.

**Architecture:** Keep the first implementation inside `extensions/hetang-ops` so the same plugin can own collection state, filtering, ranking, scheduling, and delivery. Use a deterministic pipeline first: collect -> normalize -> filter -> cluster -> score -> assemble -> deliver. Keep LLM use constrained to paragraph summarization and "why it matters" generation after source grading and event clustering are complete.

**Tech Stack:** TypeScript, Vitest, PostgreSQL (`pg` + `pg-mem`), existing `HetangOpsRuntime` / `HetangOpsStore`, OpenClaw plugin service loop, optional external fetch sources.

---

### Task 1: Define the external intelligence domain model

**Files:**

- Modify: `extensions/hetang-ops/src/types.ts`
- Modify: `extensions/hetang-ops/src/config.ts`
- Modify: `extensions/hetang-ops/openclaw.plugin.json`
- Test: `extensions/hetang-ops/src/config.test.ts`

**Step 1: Write failing config tests**

Add tests for:

- an `externalIntelligence` config block
- source tier enums (`s`, `a`, `b`, `blocked`)
- daily brief composition targets
- HQ delivery target config
- freshness window defaults

Example assertions:

```ts
expect(config.externalIntelligence.enabled).toBe(true);
expect(config.externalIntelligence.freshnessHours).toBe(72);
expect(config.externalIntelligence.briefComposition.generalHotTopic).toBe(4);
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/config.test.ts`
Expected: FAIL because `externalIntelligence` schema does not exist.

**Step 3: Add minimal domain types**

Add types for:

- `HetangExternalSourceConfig`
- `HetangExternalSourceTier`
- `HetangExternalIntelligenceConfig`
- `HetangExternalEventCandidate`
- `HetangExternalEventCard`
- `HetangExternalBriefIssue`
- `HetangExternalBriefItem`

Add config parsing with defaults like:

```ts
externalIntelligence: {
  enabled: false,
  freshnessHours: 72,
  maxItemsPerIssue: 10,
  briefComposition: {
    generalHotTopic: 4,
    chainBrand: 3,
    strategyPlatform: 3,
  }
}
```

**Step 4: Update plugin schema**

Expose the new config block in `extensions/hetang-ops/openclaw.plugin.json`.

**Step 5: Run test to verify it passes**

Run: `pnpm test -- extensions/hetang-ops/src/config.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
scripts/committer "Hetang Ops: add external intelligence config model" \
  extensions/hetang-ops/src/types.ts \
  extensions/hetang-ops/src/config.ts \
  extensions/hetang-ops/openclaw.plugin.json \
  extensions/hetang-ops/src/config.test.ts
```

### Task 2: Add PostgreSQL persistence for source docs, event cards, and issues

**Files:**

- Modify: `extensions/hetang-ops/src/store.ts`
- Test: `extensions/hetang-ops/src/store.test.ts`

**Step 1: Write failing store tests**

Cover:

- inserting raw source documents
- inserting normalized event candidates
- clustering candidates into a single event card
- saving a brief issue and ordered brief items
- listing event cards by date and theme

Example structures to test:

```ts
await store.insertExternalSourceDocument({...});
await store.upsertExternalEventCandidate({...});
await store.upsertExternalEventCard({...});
await store.createExternalBriefIssue({...});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`
Expected: FAIL because the tables and methods do not exist.

**Step 3: Add minimal schema**

Create tables like:

- `external_source_documents`
- `external_event_candidates`
- `external_event_cards`
- `external_brief_issues`
- `external_brief_items`

Keep normalized columns for:

- source tier
- source URL
- published time
- event time
- entity
- action
- object
- theme
- score
- blocked reason

**Step 4: Add CRUD helpers**

Add methods for:

- raw document insert
- candidate upsert
- event card upsert
- issue create
- issue item insert/list
- freshness queries

**Step 5: Run tests to verify they pass**

Run: `pnpm test -- extensions/hetang-ops/src/store.test.ts`
Expected: PASS.

**Step 6: Commit**

```bash
scripts/committer "Hetang Ops: add external intelligence persistence" \
  extensions/hetang-ops/src/store.ts \
  extensions/hetang-ops/src/store.test.ts
```

### Task 3: Build deterministic filtering and classification rules

**Files:**

- Create: `extensions/hetang-ops/src/external-intelligence/filter.ts`
- Create: `extensions/hetang-ops/src/external-intelligence/classify.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/filter.test.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/classify.test.ts`

**Step 1: Write failing filter tests**

Cover:

- reject course-promo titles
- reject consulting soft articles
- reject old-news resurfacing without new development
- reject documents without reliable time

Example:

```ts
expect(filterExternalCandidate(doc).decision).toEqual({
  accepted: false,
  reason: "blocked-soft-article",
});
```

**Step 2: Write failing classify tests**

Cover:

- `全网热点`
- `连锁品牌`
- `战略组织`
- `平台规则`
- `价格竞争`

**Step 3: Run the tests and verify failure**

Run:

- `pnpm test -- extensions/hetang-ops/src/external-intelligence/filter.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/classify.test.ts`

Expected: FAIL because the modules do not exist.

**Step 4: Implement the minimal rule engine**

Add:

- blocklist keyword rules
- source-tier gates
- freshness-window checks
- theme classifier by source + entity + keywords

Keep the rules deterministic and inspectable.

**Step 5: Run the tests and verify pass**

Expected: PASS.

**Step 6: Commit**

```bash
scripts/committer "Hetang Ops: add external intelligence filtering rules" \
  extensions/hetang-ops/src/external-intelligence/filter.ts \
  extensions/hetang-ops/src/external-intelligence/classify.ts \
  extensions/hetang-ops/src/external-intelligence/filter.test.ts \
  extensions/hetang-ops/src/external-intelligence/classify.test.ts
```

### Task 4: Build event clustering and freshness resolution

**Files:**

- Create: `extensions/hetang-ops/src/external-intelligence/cluster.ts`
- Create: `extensions/hetang-ops/src/external-intelligence/freshness.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/cluster.test.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/freshness.test.ts`

**Step 1: Write failing clustering tests**

Cover:

- two articles from different sources about the same pricing action merge into one event card
- same entity but different action stays split

**Step 2: Write failing freshness tests**

Cover:

- event inside 72h qualifies
- old event with no new progress is rejected
- old event with a material update today qualifies

**Step 3: Run tests and verify failure**

Run:

- `pnpm test -- extensions/hetang-ops/src/external-intelligence/cluster.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/freshness.test.ts`

**Step 4: Implement minimal cluster and freshness logic**

Use a simple event key builder:

```ts
`${entity}|${action}|${object}|${timeBucket}`;
```

Keep time buckets coarse enough to merge duplicated reports but narrow enough to avoid false merges.

**Step 5: Run tests and verify pass**

Expected: PASS.

**Step 6: Commit**

```bash
scripts/committer "Hetang Ops: add external intelligence event clustering" \
  extensions/hetang-ops/src/external-intelligence/cluster.ts \
  extensions/hetang-ops/src/external-intelligence/freshness.ts \
  extensions/hetang-ops/src/external-intelligence/cluster.test.ts \
  extensions/hetang-ops/src/external-intelligence/freshness.test.ts
```

### Task 5: Add scoring and Top 10 brief assembly

**Files:**

- Create: `extensions/hetang-ops/src/external-intelligence/score.ts`
- Create: `extensions/hetang-ops/src/external-intelligence/assemble.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/score.test.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/assemble.test.ts`

**Step 1: Write failing scoring tests**

Cover:

- fresh S-tier event scores above weak B-tier event
- soft-article penalty pushes score below final threshold

**Step 2: Write failing assembly tests**

Cover:

- target composition 4/3/3
- max two items from same source
- max two items from same entity
- under-filled output when quality is insufficient

**Step 3: Run tests and verify failure**

Run:

- `pnpm test -- extensions/hetang-ops/src/external-intelligence/score.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/assemble.test.ts`

**Step 4: Implement minimal scorer and assembler**

Implement:

- weighted scoring
- penalties
- diversity constraints
- quality threshold
- ordered issue item generation

**Step 5: Run tests and verify pass**

Expected: PASS.

**Step 6: Commit**

```bash
scripts/committer "Hetang Ops: add external intelligence ranking and assembly" \
  extensions/hetang-ops/src/external-intelligence/score.ts \
  extensions/hetang-ops/src/external-intelligence/assemble.ts \
  extensions/hetang-ops/src/external-intelligence/score.test.ts \
  extensions/hetang-ops/src/external-intelligence/assemble.test.ts
```

### Task 6: Add summary rendering and HQ brief formatting

**Files:**

- Create: `extensions/hetang-ops/src/external-intelligence/render.ts`
- Create: `extensions/hetang-ops/src/external-intelligence/llm.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/render.test.ts`
- Test: `extensions/hetang-ops/src/external-intelligence/llm.test.ts`

**Step 1: Write failing render tests**

Cover final item format:

- title
- tag
- time
- source
- paragraph summary
- why-it-matters line

**Step 2: Write failing LLM seam tests**

Cover:

- LLM is used only after deterministic scoring/assembly
- empty LLM output falls back to rule-based summary

**Step 3: Run tests and verify failure**

Run:

- `pnpm test -- extensions/hetang-ops/src/external-intelligence/render.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/llm.test.ts`

**Step 4: Implement minimal render layer**

Keep a fallback renderer:

```ts
function renderFallbackSummary(card: HetangExternalEventCard): string {
  return `${card.entity} 于 ${card.eventDateLabel} 发生了 ${card.actionLabel} ...`;
}
```

Use the LLM seam only for:

- paragraph expansion
- "why it matters" wording

Do not let the LLM decide source quality, freshness, or ranking.

**Step 5: Run tests and verify pass**

Expected: PASS.

**Step 6: Commit**

```bash
scripts/committer "Hetang Ops: add external intelligence rendering" \
  extensions/hetang-ops/src/external-intelligence/render.ts \
  extensions/hetang-ops/src/external-intelligence/llm.ts \
  extensions/hetang-ops/src/external-intelligence/render.test.ts \
  extensions/hetang-ops/src/external-intelligence/llm.test.ts
```

### Task 7: Wire runtime, service schedule, and HQ delivery

**Files:**

- Modify: `extensions/hetang-ops/src/runtime.ts`
- Modify: `extensions/hetang-ops/src/service.ts`
- Modify: `extensions/hetang-ops/src/notify.ts`
- Test: `extensions/hetang-ops/src/runtime.test.ts`
- Test: `extensions/hetang-ops/src/service.test.ts`

**Step 1: Write failing runtime tests**

Cover:

- collect/process/build one brief issue
- skip blocked and stale candidates
- persist final issue and item ordering
- deliver HQ brief to configured target

**Step 2: Write failing service test**

Cover:

- scheduler invokes external intelligence run on its configured schedule
- intelligence failures do not kill the rest of `hetang-ops`

**Step 3: Run tests and verify failure**

Run:

- `pnpm test -- extensions/hetang-ops/src/runtime.test.ts`
- `pnpm test -- extensions/hetang-ops/src/service.test.ts`

**Step 4: Implement runtime methods**

Add methods like:

- `ingestExternalSourceDocuments()`
- `buildExternalBriefIssue()`
- `deliverExternalBriefIssue()`

Hook them into the service loop with an HQ-facing daily schedule.

**Step 5: Run tests and verify pass**

Expected: PASS.

**Step 6: Commit**

```bash
scripts/committer "Hetang Ops: wire external intelligence runtime and delivery" \
  extensions/hetang-ops/src/runtime.ts \
  extensions/hetang-ops/src/service.ts \
  extensions/hetang-ops/src/notify.ts \
  extensions/hetang-ops/src/runtime.test.ts \
  extensions/hetang-ops/src/service.test.ts
```

### Task 8: Expose management command surface

**Files:**

- Modify: `extensions/hetang-ops/src/access.ts`
- Modify: `extensions/hetang-ops/src/command.ts`
- Test: `extensions/hetang-ops/src/command.test.ts`

**Step 1: Write failing command tests**

Cover commands like:

- `/hetang intel run`
- `/hetang intel latest`
- `/hetang intel issue <issueId>`
- `/hetang intel sources`

HQ only.

**Step 2: Run tests and verify failure**

Run: `pnpm test -- extensions/hetang-ops/src/command.test.ts`
Expected: FAIL because the action and subcommands do not exist.

**Step 3: Implement minimal command surface**

Add:

- HQ-only access rules
- issue inspection text
- rerun trigger for manual rebuild

**Step 4: Run tests and verify pass**

Expected: PASS.

**Step 5: Commit**

```bash
scripts/committer "Hetang Ops: add external intelligence commands" \
  extensions/hetang-ops/src/access.ts \
  extensions/hetang-ops/src/command.ts \
  extensions/hetang-ops/src/command.test.ts
```

### Task 9: Add docs and operator guidance

**Files:**

- Modify: `docs/plans/2026-03-31-hetang-ops-operations-runbook.md`
- Modify: `docs/plans/2026-03-31-hetang-ops-troubleshooting.md`
- Create: `docs/plans/2026-04-02-hetang-external-intelligence-ops.md`

**Step 1: Document runbook actions**

Add:

- how to verify collection
- how to inspect blocked sources
- how to inspect issue composition
- how to rerun daily issue generation

**Step 2: Document failure modes**

Add:

- source unreachable
- weak-source-only day
- stale-item contamination
- summary generation fallback

**Step 3: Review docs for consistency**

Check terminology:

- use "external intelligence"
- use "brief issue"
- use "event card"

**Step 4: Commit**

```bash
scripts/committer "Docs: add external intelligence operator guidance" \
  docs/plans/2026-03-31-hetang-ops-operations-runbook.md \
  docs/plans/2026-03-31-hetang-ops-troubleshooting.md \
  docs/plans/2026-04-02-hetang-external-intelligence-ops.md
```

### Task 10: Verify the vertical slice

**Files:**

- Test: `extensions/hetang-ops/src/**/*.test.ts`

**Step 1: Run targeted tests**

Run:

- `pnpm test -- extensions/hetang-ops/src/config.test.ts`
- `pnpm test -- extensions/hetang-ops/src/store.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/filter.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/classify.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/cluster.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/freshness.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/score.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/assemble.test.ts`
- `pnpm test -- extensions/hetang-ops/src/external-intelligence/render.test.ts`
- `pnpm test -- extensions/hetang-ops/src/runtime.test.ts`
- `pnpm test -- extensions/hetang-ops/src/service.test.ts`
- `pnpm test -- extensions/hetang-ops/src/command.test.ts`

**Step 2: Run the full plugin suite**

Run: `pnpm test -- extensions/hetang-ops/src`

**Step 3: Run build**

Run: `pnpm build`

**Step 4: Spot-check issue generation**

Run a manual intelligence build with at least:

- one accepted S-tier event
- one accepted A-tier event
- one blocked course-promo source
- one stale duplicated item

Verify:

- blocked items do not appear
- stale items do not appear
- final issue may contain fewer than 10 items if quality is weak
- final message renders as a complete HQ brief

**Step 5: Final commit**

```bash
scripts/committer "Hetang Ops: add HQ external intelligence brief pipeline" \
  extensions/hetang-ops/src/types.ts \
  extensions/hetang-ops/src/config.ts \
  extensions/hetang-ops/openclaw.plugin.json \
  extensions/hetang-ops/src/store.ts \
  extensions/hetang-ops/src/runtime.ts \
  extensions/hetang-ops/src/service.ts \
  extensions/hetang-ops/src/notify.ts \
  extensions/hetang-ops/src/access.ts \
  extensions/hetang-ops/src/command.ts \
  extensions/hetang-ops/src/config.test.ts \
  extensions/hetang-ops/src/store.test.ts \
  extensions/hetang-ops/src/runtime.test.ts \
  extensions/hetang-ops/src/service.test.ts \
  extensions/hetang-ops/src/command.test.ts \
  extensions/hetang-ops/src/external-intelligence/filter.ts \
  extensions/hetang-ops/src/external-intelligence/filter.test.ts \
  extensions/hetang-ops/src/external-intelligence/classify.ts \
  extensions/hetang-ops/src/external-intelligence/classify.test.ts \
  extensions/hetang-ops/src/external-intelligence/cluster.ts \
  extensions/hetang-ops/src/external-intelligence/cluster.test.ts \
  extensions/hetang-ops/src/external-intelligence/freshness.ts \
  extensions/hetang-ops/src/external-intelligence/freshness.test.ts \
  extensions/hetang-ops/src/external-intelligence/score.ts \
  extensions/hetang-ops/src/external-intelligence/score.test.ts \
  extensions/hetang-ops/src/external-intelligence/assemble.ts \
  extensions/hetang-ops/src/external-intelligence/assemble.test.ts \
  extensions/hetang-ops/src/external-intelligence/render.ts \
  extensions/hetang-ops/src/external-intelligence/render.test.ts \
  extensions/hetang-ops/src/external-intelligence/llm.ts \
  extensions/hetang-ops/src/external-intelligence/llm.test.ts \
  docs/plans/2026-04-02-hetang-external-intelligence-ops.md \
  docs/plans/2026-03-31-hetang-ops-operations-runbook.md \
  docs/plans/2026-03-31-hetang-ops-troubleshooting.md
```

Plan complete and saved to `docs/plans/2026-04-02-hetang-external-intelligence.md`. Two execution options:

**1. Subagent-Driven (this session)** - dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - open a new session with `executing-plans`, batch execution with checkpoints
