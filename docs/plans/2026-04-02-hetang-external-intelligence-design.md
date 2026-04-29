# Hetang External Intelligence Product Design

## 1. Goal

For the current single-brand Hetang deployment, add a high-quality external intelligence layer that helps management improve same-day revenue decisions without turning the project into a generic news product.

The chosen product direction is:

- single brand, deep integration
- management-facing first
- daily same-day revenue support first
- external intelligence first informs HQ judgment, then selectively becomes store action guidance

## 2. Chosen Product Definition

This module should be defined as a `brand external intelligence engine`, not as a generic news crawler and not as a broad "all-data fusion platform".

Its first real product is:

`Daily Dual-Layer Intelligence Brief`

Two fixed layers:

1. `A Layer: General Market Hot Topics`
   - Purpose: tell management what major public and business events matter today.
   - Scope: policy, platform changes, consumption trends, major company moves, public opinion, macro business events.

2. `B Layer: Chain + Strategy Intelligence`
   - Purpose: tell the brand which events may change operating judgment.
   - Scope: chain brand moves, local-services platform rules, pricing actions, store-format moves, organization and strategy changes, service-retail signals.

This module does not initially push full news directly to store managers.

Store managers should eventually receive only a translated output:

`Store Impact Note`

That note should answer:

- what changed outside today
- whether it matters for today’s revenue
- whether the store should do anything differently today

## 3. Core User and Use Cases

### 3.1 Primary User

HQ operator / founder / regional manager

Primary use cases:

- read one high-quality morning brief in 5 minutes
- identify which external changes may affect traffic, conversion, pricing, or local competition
- decide whether to change promotions, staffing, messaging, or platform operations today

### 3.2 Secondary User

Store manager

Secondary use cases:

- receive only the few external signals that change today’s actions
- avoid reading general business news that does not affect store execution

## 4. Product Scope

### 4.1 In Scope for V1

- daily HQ brief
- event-grade collection and normalization
- deduplication and event clustering
- freshness filtering
- source-quality grading
- chain/strategy relevance scoring
- complete paragraph summaries
- one-line "why it matters" judgment

### 4.2 Explicitly Out of Scope for V1

- fully automated store-level action generation from external events
- open-ended natural language search over all external intelligence
- multi-brand benchmark intelligence
- broad macro data ingestion without operating relevance
- weakly sourced social rumor aggregation

## 5. Quality Standard

The current failure mode is a "search-result collage": old items, SEO pages, soft articles, incomplete snippets, and no event consolidation.

V1 quality must instead meet these rules:

1. Every item must be an `event`, not just an article.
2. Every item must have:
   - title
   - event date or clear publication date
   - source
   - complete paragraph summary
   - business relevance label
   - one-line impact statement
3. Default freshness window is `72 hours`.
4. Search or social results can discover leads, but only verified higher-confidence sources can enter Top 10.
5. If there are not 10 qualified items, publish fewer items instead of filling with junk.

## 6. Source Strategy

### 6.1 Source Tiers

- `S Tier`
  - regulators
  - government
  - public companies
  - platform official announcements
  - corporate official pressrooms
  - official accounts
- `A Tier`
  - mainstream financial and business media
  - strong technology and retail media
  - local-services / chain / service-retail trade media
- `B Tier`
  - hot lists
  - search results
  - social discussions
  - reposted articles
  - aggregator pages
- `Blocked`
  - course promotion
  - consulting soft article
  - conference promo
  - SEO aggregation page
  - opinion-only longform without a concrete event

### 6.2 Source Usage Rule

- S and A tier can directly enter the candidate pool.
- B tier can only create a lead and must be backfilled with stronger source confirmation.
- Blocked sources never enter final ranking.

## 7. Event Processing Pipeline

The pipeline should be deterministic before any LLM summarization step.

### 7.1 Collect

Collect full content or high-quality excerpts from approved feeds and sites.

Do not use search-result snippets as final content.

### 7.2 Normalize

Extract:

- source name
- source URL
- headline
- publication time
- event time if available
- main entity
- action verb
- object / counterparty
- region
- raw body text

### 7.3 Hard Filter

Drop items that match:

- promotional education content
- consulting thought leadership
- old news recirculation
- no clear event
- no reliable time
- no readable body

### 7.4 Event Cluster

Merge multiple documents into one `event card`.

Suggested cluster key:

`entity + action + object + time window`

Example:

- "Luckin cuts prices on selected drinks"
- "Luckin responds to pricing change"

These should become one event card, not two separate final items.

### 7.5 Freshness and Progress Detection

Track:

- event happened time
- source published time
- whether today contains a true new development

Only these should qualify for today’s final brief:

- first occurrence in the last 72 hours
- or a material update today on an older event

### 7.6 Theme Classification

Classify every event card into at least one of:

- general hot topic
- chain brand
- strategy and organization
- platform rule
- consumer trend
- policy and regulation
- pricing competition
- regional commerce

### 7.7 Relevance Scoring

Score not by pure internet popularity, but by whether the event is useful for this brand’s judgment.

### 7.8 Summary Generation

Generate a structured paragraph summary:

- what happened
- who did it
- when it happened
- what changed
- why this matters

### 7.9 Brief Assembly

Assemble the daily issue with diversity constraints and quality thresholds.

## 8. Ranking Logic

Start with a simple rule-based score out of 100.

- freshness: 25
- source credibility: 20
- event hardness: 15
- chain relevance: 15
- strategy value: 10
- operating usefulness: 10
- novelty: 5

Suggested penalties:

- likely soft article: -40
- old-news resurfacing: -30
- incomplete information: -20
- same-source redundancy: -15
- same-theme overload: -10

## 9. Final Top 10 Composition Rule

Target composition:

- 4 `General Hot Topics`
- 3 `Chain Brand`
- 3 `Strategy / Organization / Platform`

But composition is a soft target. If one bucket has low-quality items, leave it under-filled.

Diversity rules:

- max 2 items from same source
- max 2 items about same company/entity
- max 3 items from same theme bucket
- at least 3 different theme buckets in final issue

## 10. Output Format

Every final item must contain:

- `Title`
- `Tag`
- `Time`
- `Source`
- `Core Summary`
- `Why It Matters`

### 10.1 HQ Version

`Why It Matters` should answer:

- what this means for brand judgment
- whether it may affect pricing, traffic, conversion, staffing, channel behavior, or brand positioning

### 10.2 Store Translation Version

Later phases may create a translated note:

- what changed outside
- whether it matters today
- whether to change any same-day action

This is not the same as forwarding news.

## 11. Daily Brief Structure

Recommended final brief layout:

1. `Today’s View`
   - 3 to 5 sentences
   - summarize the day’s external picture

2. `Top 3 Must-Read`
   - expanded write-up for the most important 3 events

3. `Top 10 Full Brief`
   - grouped by the three major buckets

4. `Operating Watchpoints`
   - 3 short bullets
   - what to continue watching
   - what may matter for chains
   - whether any signal should be translated into same-day action

## 12. Success Metrics

Product quality should be measured with:

- `true-event rate`
- `freshness rate`
- `complete-summary rate`
- `HQ usefulness score`
- `junk rate`

Business usefulness should be measured later with:

- number of HQ decisions influenced
- number of translated store actions
- number of same-day action experiments triggered
- observed effect on traffic, conversion, or revenue when translated actions are taken

## 13. Recommended Product Evolution

### Phase 1: High-Quality HQ Morning Brief

Deliver a reliable daily dual-layer brief.

### Phase 2: Intelligence to Judgment

Stabilize one-line impact statements and management interpretation.

### Phase 3: Judgment to Action

Selectively translate a few external signals into brand-level or store-level action suggestions.

### Phase 4: Action to Validation

Track whether recommended actions were taken and whether they mattered.

### Phase 5: Brand Intelligence Memory

Build a brand-specific knowledge layer for which external signals reliably predict useful operating moves.

## 14. Strategic Decision

For this project, external intelligence should remain an HQ-first layer.

It should not compete with the core store-manager product.

The core store-manager product remains:

`help the manager improve today’s revenue`

External intelligence supports that product indirectly by improving brand judgment first, then translating a few high-signal external events into store action when confidence is high enough.

## 15. Why This Direction Wins

This design avoids three common failures:

- becoming a low-quality news summarizer
- becoming a vague all-data intelligence platform
- overwhelming store managers with irrelevant information

It creates a tighter product:

- HQ gets a useful morning brief
- the brand builds external sensing capability
- only proven external signals are turned into operational action

That is the correct path for a single-brand, deep-integration strategy.
