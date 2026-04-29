# Fast Accurate Semantic-First Response Architecture And Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Evolve `htops` from a mostly rule-routed query bot into a semantic-first business operations runtime that answers fast, routes correctly, keeps metrics truthful, and separates realtime conversation control from query and analysis execution.

**Architecture:** The project should formally converge on `Text -> Conversation Control Fork/Join -> Semantic Intent (Fast Parse -> Slot Fill -> Intent Clarifier) -> Early Stop Gate -> Lane Select (meta | query | analysis) -> Capability Graph -> Safe Execution -> Reply Guard -> Answer/Action`. `Semantic Intent` is the new primary routing brain; the front door should increasingly use parallel prechecks and early-stop exits; `Capability Graph` should become the unified capability entry for query/serving paths first, then expand further; `Safe Execution` remains the truth layer for business data; `Reply Guard` blocks wrong or template-like answers before delivery. `Query` remains deterministic and auditable. Only `Analysis` may gradually adopt bounded agentic orchestration. `src/runtime.ts` stays a compatibility facade and must not gain new business entry responsibilities.

**Tech Stack:** TypeScript, Vitest, Hermes bridge/runtime, WeCom delivery, deterministic serving queries, safe SQL compilation, capability graph routing, optional AI semantic parsing, optional async CrewAI sidecar for deep analysis only.

---

## Current Status

The project already completed the first live-response hardening layer:

- `conversationQuality` config is in place
- `Intent Clarifier v1` is implemented
- `Reply Guard v1` is implemented
- `Correction Interrupt v1` is implemented
- related tests are already passing

That work fixed the most obvious realtime failures, but it did **not** yet turn the system into a true `semantic-first` runtime. The current route decision is still mostly `rule-first`, with AI semantic fallback only used as a helper.

Also note the codebase already moved one large structural risk out of the way:

- `src/query-engine.ts` has been split into:
  - `src/query-engine-router.ts`
  - `src/query-engine-executor.ts`
  - `src/query-engine-renderer.ts`
  - while keeping `src/query-engine.ts` as the compatibility facade

Important caveat: the targeted realtime suite is green, but the broader compatibility suite is **not** fully green yet. In particular, `src/runtime.test.ts` currently has failing cases around report cache reuse and async analysis/runtime compatibility. Those failures must be treated as a pre-Phase-1 risk, not ignored.

---

## Progress Snapshot As Of 2026-04-14

This section tracks actual implementation status, not just intended architecture.

### Pipeline Status

- `Text` — `90%`
  - raw input, effective input, sender/account/thread metadata, and inbound audit record are already preserved on the bridge entry path
  - remaining gap: no separate replay/debug view yet beyond audit persistence
- `Conversation Control` — `70%`
  - correction interrupt, reply guard v1, non-blocking inbound audit, and early group-noop short-circuit are live
  - remaining gap: the front door is still only partially fork/join; several cheap checks are still evaluated serially
- `Semantic Intent` — `55%`
  - typed semantic contract exists in code, with binding-aware scope handling and fine-grained meta/query/analysis kinds
  - remaining gap: more legacy `src/inbound.ts` pre-routing branches still need to be fully consolidated behind semantic intent
- `Early Stop Gate` — `35%`
  - cheap early exits already exist for group-noop, identity/capability/meta replies, clarification, unsupported boundaries, and some business guidance
  - remaining gap: these exits are still spread across `message-entry-service`, `semantic-intent`, and legacy inbound logic rather than one explicit gate
- `Lane Select` — `65%`
  - explicit `meta | query | analysis` lane decisions exist and are observable in tests and shadow telemetry
  - remaining gap: legacy inbound routing is still partially authoritative, so lane selection is not yet the single source of truth
- `Capability Graph` — `45%`
  - capability graph exists with `serving_sql`, `runtime_render`, and `async_analysis` nodes
  - remaining gap: several high-frequency query families still bypass graph-first ownership through specialized query branches
- `Safe Execution` — `65%`
  - structured plans, serving reads, and safe SQL compilation are in place for the main serving query plane
  - remaining gap: not every query family is normalized into the same safe execution spine yet
- `Reply Guard` — `80%`
  - v1 protection already blocks store mismatch, negative-constraint leakage, template leakage, and generic wrong business replies
  - remaining gap: lane-aware output validation and richer mobile/output control remain Phase 4 work
- `Answer / Action` — `60%`
  - bridge entry can already serve semantic `meta`, `query`, and `analysis` acknowledgements directly
  - remaining gap: output style is not yet fully standardized by lane, and analysis final delivery is not yet upgraded to the target design

### Optimization Track Status

- `Fork/Join Front Door` — `20%`
  - direction is documented and the first hot-path optimizations are done
  - completed so far:
    - inbound audit no longer blocks the immediate reply path
    - group traffic with `was_mentioned = false` now exits before routing-mode lookup and binding hydration
  - remaining gap: routing-mode lookup, binding hydration, semantic fast-parse, and compare-only legacy classification are still not organized as a true fork/join front door
- `Early Stop Gate` — `35%`
  - multiple early-stop behaviors exist in practice
  - remaining gap: they still need to be centralized into one inspectable gate instead of being split across layers
- `Deterministic Query Spine` — `60%`
  - the serving/sql path and capability graph foundation exist
  - remaining gap: semantic query execution still re-enters the legacy `/hetang query ...` command path instead of going through a typed direct execution spine
- `Agentic Analysis Only` — `10%`
  - the lane boundary is correctly defined and analysis already stays async-only
  - remaining gap: there is no deterministic evidence-pack stage or bounded analysis DAG/orchestration layer yet
- `Shadow / Rollback` — `75%`
  - `routing.mode = legacy | shadow | semantic` exists, route comparison logs are emitted, and semantic mode keeps compare-only legacy route snapshots for observability
  - remaining gap: eval-set-driven accuracy review and persistent live route-accuracy tracking are not fully operational yet

### Phase Status

- `Phase 0` — `Completed`
  - realtime protection foundation landed
- `Phase 0.5` — `Partially completed`
  - done:
    - `query-engine` structural split
    - shadow-route telemetry shape
  - remaining:
    - fix or quarantine `src/runtime.test.ts` failures
    - collect real eval set
    - capture latency baseline/runbook
- `Phase 1a` — `Substantially in progress`
  - done:
    - semantic intent contract
    - routing mode switch
    - shadow telemetry
    - compare-only legacy route snapshot
  - remaining:
    - consolidate more inbound pre-routing branches behind semantic intent
- `Phase 1b` — `Early in progress`
  - done:
    - semantic mode can directly serve `meta`, `query`, and `analysis` entry behavior
  - remaining:
    - make semantic routing the single authoritative router
    - promote fork/join front door and explicit early-stop behavior
- `Phase 2` — `Foundation exists, not complete`
  - graph is present, but graph-first ownership is not universal
- `Phase 3` — `Foundation exists, not complete`
  - safe execution spine exists, but not all query families are normalized into it
- `Phase 4` — `Not started beyond v1 guard foundation`
- `Phase 5` — `Boundary defined only`
  - async analysis lane exists, but evidence-pack-first bounded agentic orchestration does not yet exist
- `Phase 6` — `Not started`

### Next Implementation Plan

#### Immediate next batch

- finish the front-door fork/join cutover on the inbound path
  - separate cheap prechecks into explicit stages:
    - routing-mode lookup
    - binding/scope hydration
    - semantic fast parse
    - compare-only legacy classification
  - ensure only true dependencies remain blocking
- centralize the early-stop gate
  - make `meta`, `clarify`, `unsupported`, `generic_unmatched`, and group-noop outcomes terminate through one explicit decision point
- keep adding tests that prove hot-path latency is not blocked by non-critical work

#### Near-term implementation

- continue Phase 1a / 1b consolidation
  - move more legacy inbound pre-routing branches under semantic intent ownership
  - keep fine-grained shadow diffs at `intent kind` level, not only lane level
- upgrade semantic query execution from string re-entry to typed direct execution
  - stop bouncing semantic query traffic back through `/hetang query ...`
  - connect semantic query output more directly to capability selection and safe execution
- complete Phase 0.5 safety work
  - resolve or explicitly quarantine `src/runtime.test.ts` failures
  - capture the first real eval set and latency baseline

#### Mid-term implementation

- complete Phase 2 capability coverage
  - register top-frequency query/report asks as explicit capability nodes first
  - shrink direct special-case branches in query execution
- complete Phase 3 query-spine unification
  - normalize more query families into structured plans + serving/sql execution
  - keep permissions and metric truth fully explicit in code
- start Phase 4 lane-aware output control
  - teach reply guard and renderers to validate output by lane, not just by generic text patterns

#### Later implementation

- build Phase 5 analysis evidence packs
  - deterministic fact bundle first
  - bounded agentic diagnosis/synthesis second
  - safe fallback if analysis sidecars fail
- build Phase 6 continuous improvement loop
  - real conversation eval fixtures
  - route accuracy tracking
  - clarification/repair/latency trend review

---

## Canonical Architecture

The official architecture going forward is:

`Text -> Conversation Control Fork/Join -> Semantic Intent (Fast Parse -> Slot Fill -> Intent Clarifier) -> Early Stop Gate -> Lane Select (meta | query | analysis) -> Capability Graph -> Safe Execution -> Reply Guard -> Answer/Action`

This is the canonical project definition. Any future optimization should strengthen one of these stages rather than add scattered ad-hoc routing.

---

## Target Architecture v2

The refined target architecture is:

`Text -> Conversation Control Fork/Join -> Semantic Intent Join -> Early Stop Gate -> Lane Select (meta | query | analysis) -> Capability Graph -> Safe Execution -> Reply Guard -> Answer/Action`

This is a refinement of the canonical architecture, not a reset. The goal is to make the front door faster and safer while preserving deterministic business truth.

### A. Fork/Join Front Door

Before expensive query or analysis work begins, the bridge entry should increasingly run several cheap checks in parallel:

- correction/noop detection
- binding and scope hydration
- semantic fast parse
- legacy compare-only classification for telemetry
- lightweight policy/input checks

These checks should converge into one inspectable semantic intent decision. They exist to reduce latency, reduce wrong-route blast radius, and make early exits cheap.

### B. Early Stop Gate

After semantic intent is resolved, the system should stop immediately when the request does **not** require business data execution.

Typical early-stop outcomes:

- `meta` identity/capability replies
- concept or method explanation
- clarification for missing store/time/object scope
- unsupported-data boundary replies
- generic unmatched guidance when no executable business ask exists

The core principle is: do not enter query or analysis execution when the system already knows a cheap, correct answer or a single clarification question is enough.

### C. Deterministic Query Spine

`Query` is the fast business-fact lane and must remain deterministic, auditable, and permission-safe.

This means:

- semantic routing may decide that a request is a `query`
- capability selection may refine how the query is served
- but the actual business answer must still come from structured plans, serving reads, or safe SQL
- permissions, org scope, time scope, and metric truth must stay explicit in code

`Query` must **not** be replaced by free-form LLM tool planning or black-box agent loops.

### D. Agentic Analysis Only

`Analysis` is the only lane allowed to gradually adopt bounded agentic orchestration.

That orchestration must sit **after** deterministic fact collection, not instead of it. The recommended direction is:

- deterministic evidence pack first
- agentic diagnosis / synthesis second
- reply guard and output checks last

This allows richer review/advice workflows without letting generated reasoning invent business truth.

### E. Explicit Non-Goals

The project should explicitly avoid the following anti-patterns:

- using LLM-generated tool calls as the primary source of truth for synchronous query execution
- replacing safe SQL / serving reads with RAG-generated factual answers
- introducing ReAct-style loops on the core `query` fast lane
- turning `Reply Guard` into the main inbound router instead of keeping it as the final output-quality gate

---

## Formal Architecture Definition

### 1. Text

User raw input enters with the full delivery context:

- channel
- sender/account/thread identifiers
- employee binding / access scope
- recent correction context
- negative constraints from the current turn

This stage must preserve the original wording. Downstream logic may normalize text, but must always keep the raw question available for repair, replay, and auditing.

**Primary owners:**

- `src/app/message-entry-service.ts`

### 2. Conversation Control Fork/Join

This stage handles realtime conversation safety before business routing becomes authoritative.

It is responsible for:

- recent-turn correction repair
- immediate response/noop framing
- preserving the original user text and the repaired effective text
- final reply interception after business handling

This stage is not the routing brain. It exists to prevent conversational misfires from leaking to users while routing evolves underneath.

As the architecture evolves, this stage should increasingly behave like a cheap fork/join front door:

- start binding/context hydration as early as possible
- run cheap semantic fast-parse work in parallel with context hydration when safe
- keep compare-only route classification available for telemetry
- avoid blocking the immediate path on non-critical audit or telemetry work when the user-facing reply does not depend on it

Its output is not a final business answer. Its job is to cheaply determine whether the request can stop early, needs one clarification, or should continue into `query` / `analysis`.

**Primary owners:**

- `src/app/message-entry-service.ts`
- `src/app/correction-interrupt-service.ts`
- `src/app/reply-guard-service.ts`

### 3. Semantic Intent

This is the routing brain. It should decide what the user actually wants before any data capability is invoked.

It must output a structured intent contract:

- `lane`: `meta | query | analysis`
- `intentKind`
- `scope`: single store / multi-store / HQ / none
- `timeFrame`
- `object`: store / member / tech / wait / recharge / report / concept / assistant
- `action`: explain / query / ranking / compare / breakdown / report / analysis / advice / clarify / control
- `confidence`
- `clarificationNeeded`

Its internal steps are:

- `Fast Parse`
  - cheap deterministic extraction for obvious stores, time ranges, phone suffixes, platform names, negative constraints
- `Slot Fill`
  - fill missing business slots from binding scope, recent turns, and semantic parsing
- `Intent Clarifier`
  - when key slots are missing or scope is mixed, ask one short question instead of routing badly

The current codebase still contains multiple pre-routing branches in `src/inbound.ts`. Phase 1a should not add a second routing brain beside them. Instead, it should consolidate those branches behind one semantic intent contract/resolver so route decisions become inspectable and testable from one place.

**Primary owners:**

- `src/semantic-intent.ts`
- `src/query-intent.ts`
- `src/query-semantics.ts`
- `src/ai-semantic-fallback.ts`
- `src/app/intent-clarifier-service.ts`
- `src/inbound.ts`

### 4. Early Stop Gate And Lane Select

After semantic intent is resolved, the request should first pass an early-stop gate, then explicitly land in one of three lanes if execution is still required.

Early-stop should terminate the request before heavy execution for:

- identity/capability/meta asks
- concept explanation
- unsupported-data boundaries
- clarification asks
- generic unmatched business guidance

Only requests that still require execution should continue into lane selection.

#### Meta Lane

Used for lightweight non-metric conversation handling such as:

- assistant identity / capability questions
- concept or method explanation
- unsupported-data boundary explanation
- correction / clarification / guidance responses

Examples:

- `你是谁`
- `你现在支持什么`
- `什么是复盘`
- `如何复盘`

This lane should stay lightweight. It may answer directly from controlled copy, curated knowledge cards, or clarification text, and should not trigger store data execution unless the user explicitly asks for data.

#### Query Lane

Used for:

- synchronous business metric queries
- breakdowns
- rankings
- comparisons
- daily report generation

Examples:

- `义乌店昨日136个钟怎么构成`
- `迎宾店昨天营收多少`
- `五店昨天排名`

This is the core fast lane and should usually complete in `1-3s`.

This lane must remain deterministic. Semantic routing may classify the request into `query`, but the answer itself must continue to flow through explicit capability selection, structured plans, serving reads, and safe SQL where applicable.

#### Analysis Lane

Used for:

- explicit deep diagnosis
- operating review
- risk synthesis
- action recommendation generation

Examples:

- `义乌店近30天为什么承压`
- `五店最近哪里最危险`
- `给店长一个经营诊断`

This lane is asynchronous by design and may use CrewAI/Hermes sidecars, but only as an analysis enhancer.

This is the only lane allowed to gradually adopt bounded agentic orchestration, and only after deterministic fact collection has already produced a trustworthy evidence base.

**Primary owners:**

- `src/semantic-intent.ts`
- `src/inbound.ts`
- `src/analysis-router.ts`

### 5. Capability Graph

Capability Graph should become the unified capability entry for query/serving paths first. New query/report behavior should extend this layer before adding ad-hoc routing.

Each capability must define:

- what business question it answers
- required slots
- execution mode
- truth source
- output shape
- clarification strategy
- downgrade strategy

This prevents the query-serving surface from growing through scattered `if/else` routing and keeps future expansion observable.

Near-term compatibility note:

- not every `meta` ask needs to go through capability selection in Phase 1a
- Phase 1a should focus on making lane choice explicit and observable
- Phase 2+ should continue expanding capability-graph ownership across more query families

**Primary owner:**

- `src/capability-graph.ts`

### 6. Safe Execution

This is the truth layer. Business facts must come from deterministic serving logic or safe SQL execution, not from free-form agent generation.

Safe execution includes:

- structured query plan generation
- capability-constrained execution
- serving table reads
- safe SQL compilation
- deterministic rendering where needed

The project should keep this as the core source of truth for:

- revenue
- clocks
- membership metrics
- recharge / consumption metrics
- store reports
- cross-store rankings

**Primary owners:**

- `src/query-plan.ts`
- `src/sql-compiler.ts`
- `src/query-engine.ts`
- `src/query-engine-router.ts`
- `src/query-engine-executor.ts`
- `src/query-engine-renderer.ts`
- `src/store/serving-publication-store.ts`

### 7. Reply Guard

Before any answer leaves the bridge, it should pass output-quality protection.

This stage should:

- block store mismatch
- block negative-constraint violations
- block template leakage
- block generic unmatched replies for business asks
- trigger realtime correction when the user immediately says the answer is wrong

This is not the truth layer; it is the last-mile safety and usability layer.

**Primary owners:**

- `src/app/reply-guard-service.ts`
- `src/app/correction-interrupt-service.ts`
- `src/app/message-entry-service.ts`

### 8. Answer / Action

The final output must be lane-aware:

- `Meta Lane`: concise explanation, capability boundary, or one-turn clarification
- `Query Lane`: direct answer, formatted metric block, or mobile-friendly report
- `Analysis Lane`: queue acknowledgement first, final analysis later, optionally plus action items

The user should always see the shortest correct form first. If a clarification is safer than an answer, the system should clarify.

---

## Architecture Guardrails

These are non-negotiable:

- Do not expand `src/runtime.ts` with new business entry responsibilities.
- Do not let CrewAI become the truth engine for metrics.
- Do not let open-ended Text-to-SQL become the default production path.
- Do not ship new query/report behavior by adding scattered one-off branches.
- Do not answer low-confidence business asks with long generic template text.
- Prefer short clarification over wrong confident answer.

---

## What The Project Is Not

To avoid future drift, `htops` is **not**:

- a generic free-form chatbot
- a pure BI SQL bot
- an agent-first autonomous system where the model invents business facts
- a place to keep growing `runtime.ts`

It is a business operations runtime with semantic routing, capability control, and deterministic truth execution.

---

## Rollout Safety Requirements

Before any semantic-first cutover, the project must have:

- a real eval set from WeCom misroutes and wrong answers
- a latency baseline for the current fast lane
- structured route telemetry
- a shadow-routing mode so new routing can be compared against the current path before it serves production answers

The semantic router should not replace the old path in one jump. It should first run in compare-only mode, log old/new route decisions, and prove better accuracy before becoming authoritative.

The routing mode should be controlled explicitly through Control Tower:

- `routing.mode = legacy`
  - old rule-first router serves production traffic
- `routing.mode = shadow`
  - old router still serves production traffic
  - new semantic router runs in compare-only mode
- `routing.mode = semantic`
  - new semantic router becomes authoritative

Rollback must be operationally cheap:

- preferred rollback action: `tower set global routing.mode legacy`
- if the current bridge process does not pick up Control Tower changes on the live path yet, the temporary operational fallback is:
  - update `routing.mode`
  - restart `htops-bridge.service`

Shadow-route logs must remain available after rollback so route diffs can still be reviewed.

Minimum telemetry for the cutover:

- raw question
- old route
- new route
- selected lane
- selected capability id
- clarification fired or not
- reply-guard intervention or not
- latency in milliseconds

Minimum eval fixture schema for route validation:

```ts
{
  rawText: string;
  expectedLane: "meta" | "query" | "analysis";
  expectedIntentKind: string;
  expectedOrgIds?: string[];
  expectedCapabilityId?: string;
  notes?: string;
}
```

---

## Phase Map

### Phase 0: Realtime Protection Foundation

**Status:** Completed

**Objective:** Stop the most damaging live failures before deeper architectural work.

**Delivered:**

- `Intent Clarifier v1`
- `Reply Guard v1`
- `Correction Interrupt v1`
- conversation quality config

**Primary files already landed:**

- `src/app/intent-clarifier-service.ts`
- `src/app/reply-guard-service.ts`
- `src/app/correction-interrupt-service.ts`
- `src/app/message-entry-service.ts`
- `src/query-engine.ts`
- `src/inbound.ts`

**Verification already passed:**

- `pnpm vitest run src/config.test.ts src/app/intent-clarifier-service.test.ts src/app/reply-guard-service.test.ts src/app/correction-interrupt-service.test.ts src/app/message-entry-service.test.ts src/query-engine.test.ts src/inbound.test.ts src/query-semantics.test.ts src/query-route-registry.test.ts src/ai-semantic-fallback.test.ts`
- `python3 -m unittest hermes_overrides.test_htops_router`

### Phase 0.5: Establish Safety Baseline Before Semantic Cutover

**Priority:** Immediate

**Objective:** Do not begin semantic-first routing changes without a measurable baseline, a rollback path, and a trustworthy regression set.

**Deliverables:**

- repair or explicitly isolate the current failing `src/runtime.test.ts` cases
- split `src/query-engine.ts` by responsibility before semantic cutover:
  - `src/query-engine-router.ts`
  - `src/query-engine-executor.ts`
  - `src/query-engine-renderer.ts`
  - keep `src/query-engine.ts` as a thin compatibility facade
- collect `50-100` real WeCom conversation samples covering:
  - concept explanation asks
  - ordinary store metric queries
  - breakdown / compare / ranking asks
  - explicit deep-analysis asks
  - known misroutes and known template-misfire cases
- define a first eval set from those real samples
- capture current latency baseline for the fast lane
  - primary measurement point: bridge inbound entry to immediate reply ready
  - secondary measurement point: query-engine execution duration
- define route telemetry fields and shadow-routing logs

**Primary files:**

- Modify: `src/runtime.test.ts`
- Modify: `src/query-engine.ts`
- Create: `src/query-engine-router.ts`
- Create: `src/query-engine-executor.ts`
- Create: `src/query-engine-renderer.ts`
- Modify: runtime compatibility modules only as needed to restore expected behavior
- Add: eval fixtures / route audit fixtures
- Add: docs/runbook for route telemetry and latency baseline collection

**Exit criteria:**

- current failing compatibility tests are either fixed or explicitly quarantined with documented rationale
- `query-engine.ts` is no longer the single critical-path file for routing, execution, and rendering concerns
- the project has a reusable eval set before routing changes start
- current `P50 / P95` query latency is recorded
- shadow-route telemetry format is defined

### Phase 1a: Define Semantic Intent Contract And Shadow Routing

**Priority:** Immediate next step after Phase 0.5

**Objective:** Introduce the new semantic routing contract safely without cutting production over yet.

**Deliverables:**

- define a formal `semantic intent` contract
- consolidate current inbound pre-routing outputs behind one inspectable semantic intent resolver contract
- introduce explicit `meta | query | analysis` route decision types
- make concept/method questions first-class `meta` intents instead of letting them fall through business query routing
- add a Control Tower routing switch:
  - `routing.mode = legacy | shadow | semantic`
- add shadow-routing mode:
  - old route still serves the answer
  - new route runs in parallel for comparison only
- emit structured route telemetry for old/new decision comparison

**Primary files:**

- Modify: `src/control-tower.ts`
- Create: `src/semantic-intent.ts`
- Modify: `src/query-intent.ts`
- Modify: `src/query-semantics.ts`
- Modify: `src/ai-semantic-fallback.ts`
- Modify: `src/analysis-router.ts`
- Modify: `src/inbound.ts`
- Modify: `src/app/message-entry-service.ts`
- Modify: route logging / telemetry owners
- Test: `src/semantic-intent.test.ts`
- Test: `src/query-intent.test.ts`
- Test: `src/control-tower.test.ts`
- Test: `src/app/message-entry-service.test.ts`
- Test: `src/inbound.test.ts`

**Exit criteria:**

- the semantic intent contract exists as code, tests, and documentation
- `meta | query | analysis` route decisions are observable in logs
- `routing.mode` can switch the live router between `legacy`, `shadow`, and `semantic`
- shadow route runs without serving production output yet
- route diffs can be reviewed against the eval set

### Phase 1b: Promote Semantic Intent To Primary Router

**Priority:** After Phase 1a accuracy review

**Objective:** Stop treating AI semantics as a fallback. Move to `semantic-first`, with rules downgraded to fast parse and safety rails.

**Deliverables:**

- switch route authority from old rule-first routing to semantic-first routing
- promote the front door toward cheap fork/join prechecks and explicit early-stop exits
- move concept/method questions out of business query routing and into `meta`
- let deterministic rules contribute slots, not final intent alone
- reserve clarifier for true missing-slot cases only
- keep rollback available through route flag / shadow mode switch
- start persistent route accuracy tracking on the live path as part of the cutover, not later

**Primary files:**

- Modify: `src/control-tower.ts`
- Modify: `src/query-intent.ts`
- Modify: `src/query-semantics.ts`
- Modify: `src/ai-semantic-fallback.ts`
- Modify: `src/analysis-router.ts`
- Modify: `src/query-engine.ts`
- Test: `src/query-intent.test.ts`
- Test: `src/query-engine.test.ts`
- Test: `src/inbound.test.ts`

**Exit criteria:**

- `什么是复盘，如何复盘` routes to `Meta Lane`
- `义乌店昨日136个钟怎么构成` routes to `Query Lane`
- `义乌店近30天为什么承压` routes to `Analysis Lane`
- route choice is explainable in logs and tests
- semantic-first route accuracy beats the old path on the eval set before full cutover
- live route accuracy tracking is writing comparable route outcomes before and after cutover

### Phase 2: Capability Graph v1 Becomes The Query-Serving Capability Entry

**Priority:** Immediate after Phase 1

**Objective:** Make capability selection explicit and centralized.

**Deliverables:**

- define capability nodes for the highest-frequency asks
- route all new query/report features through capability graph first
- encode required slots and downgrade behavior per capability
- expose capability resolution telemetry

**Primary files:**

- Modify: `src/capability-graph.ts`
- Modify: `src/query-plan.ts`
- Modify: `src/query-engine.ts`
- Add or update: capability graph tests

**Exit criteria:**

- new business ability is added by registering a capability node first
- route-to-capability mapping is inspectable
- fewer ad-hoc route branches remain in query execution
- the query-serving surface keeps shrinking its direct special cases in favor of inspectable capability selection

### Phase 3: Unify Query Lane Around Safe Execution

**Priority:** High

**Objective:** Make all core business answers flow through one truth pipeline.

**Deliverables:**

- normalize high-frequency report/query asks into structured plans
- reduce direct custom rendering branches in query execution
- prefer serving reads over custom ad-hoc data assembly
- keep metric truth in deterministic code or safe SQL only
- do not introduce free-form agent loops or LLM-generated tool plans onto the synchronous query fast lane

**Primary files:**

- Modify: `src/query-plan.ts`
- Modify: `src/sql-compiler.ts`
- Modify: `src/query-engine.ts`
- Modify: `src/store/serving-publication-store.ts`
- Add/update: query plan and sql compiler tests

**Exit criteria:**

- from the eval set, at least `5` paraphrase variants of the same intent family resolve to the same capability node
- those paraphrase variants return the same numeric result payload for deterministic metric queries
- numeric consistency is locked by snapshot or equivalent regression tests
- report generation and breakdowns share the same truth pipeline
- data correctness no longer depends on answer templates

### Phase 4: Upgrade Reply Quality To Product-Level Output Control

**Priority:** High

**Objective:** Make final user-facing replies consistently concise, on-topic, and mobile-friendly.

**Deliverables:**

- expand reply guard from hard blocks to lane-aware output validation
- enforce negative constraints more strictly
- separate explain/query/analysis output styles
- standardize mobile report layouts

**Primary files:**

- Modify: `src/app/reply-guard-service.ts`
- Modify: `src/app/message-entry-service.ts`
- Modify: report rendering modules
- Add/update: reply guard and formatting tests

**Exit criteria:**

- no more capability-menu leakage for business questions
- no more explain/report confusion on concept asks
- mobile WeCom outputs remain readable without manual patching

### Phase 5: Strengthen Analysis Lane Without Polluting The Fast Lane

**Priority:** Medium

**Objective:** Keep deep diagnosis powerful but fully separated from fast query handling.

**Deliverables:**

- preserve async-only deep analysis behavior
- keep explicit deep-analysis triggers
- enrich analysis prompts with capability-selected deterministic evidence packs
- allow bounded agentic orchestration only after the evidence pack is complete
- keep fallback from CrewAI sidecar to scoped query analysis

**Primary files:**

- Modify: `src/analysis-router.ts`
- Modify: `src/app/analysis-service.ts`
- Modify: `src/app/analysis-execution-service.ts`
- Modify: `src/analysis-orchestrator.ts`

**Exit criteria:**

- async analysis is stronger
- ordinary query latency does not regress
- deep analysis failure still yields safe, scoped fallback behavior

### Phase 6: Continuous Improvement Loop

**Priority:** Medium after the live path is stable

**Objective:** Make the system improve against real conversations instead of intuition only.

**Deliverables:**

- build an eval set from real WeCom misfires
- track route accuracy, clarification rate, repair rate, and latency
- mine candidate capabilities from repeated failed asks
- add offline transcript audit only after live routing is stable

**Primary files:**

- `src/app/conversation-quality-service.ts`
- future audit/eval modules
- docs/runbooks for route telemetry and failure review

**Exit criteria:**

- changes are measured against real failure sets
- capability growth is driven by evidence
- quality improvements stop being anecdotal

---

## Execution Order

The recommended implementation order from now on is:

1. `Phase 0.5` — establish safety baseline, eval set, and shadow-route telemetry
2. `Phase 1a` — define semantic intent contract and run shadow routing
3. `Phase 1b` — promote semantic intent to the primary router
4. `Phase 2` — Capability Graph v1 becomes mandatory entry
5. `Phase 3` — Query Lane unifies around Safe Execution
6. `Phase 4` — Reply Quality becomes product-grade
7. `Phase 5` — Analysis Lane deepens safely
8. `Phase 6` — Continuous improvement loop

This order is intentional:

- restore baseline safety first
- validate semantic routing before cutover
- fix route correctness next
- centralize capability control after that
- unify truth execution third
- polish output fourth
- deepen async analysis fifth
- add learning loop last

---

## Success Criteria

The architecture should be considered successful only when all of the following become true:

- ordinary business questions route correctly without manual phrasing tricks
- concept questions stop being misclassified as business reports
- high-frequency business metrics are answered from deterministic truth sources
- deep diagnosis remains powerful but isolated from the fast lane
- template leakage and obvious off-topic answers are blocked before delivery
- latency stays fast on the query lane
- new query/report abilities are added through the capability graph, not scattered branches

---

## Minimal Restart Guidance

If only the semantic/query/reply bridge path changes:

```bash
sudo systemctl restart htops-bridge.service
sudo systemctl restart htops-query-api.service
```

If async analysis lane changes too:

```bash
sudo systemctl restart htops-analysis-worker.service
```

If scheduled telemetry/audit work lands later:

```bash
sudo systemctl restart htops-scheduled-worker.service
```

---

## One-Sentence Project Definition

`htops` is a semantic-first business operations runtime: conversation control keeps live chat stable, semantic intent decides the lane, capability graph selects the query-serving ability, safe execution provides the truth, and reply guard ensures the final answer is correct, concise, and usable.
