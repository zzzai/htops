# 2026-04-13 Intent Hardening And Fallback Tightening

## Background

Recent WeCom bot behavior showed two concrete defects:

1. Real boss-style wording like `义乌店最值得召回的顾客是哪个` was not being recognized as a customer follow-up / reactivation ask.
2. When intent parsing failed or confidence was weak, `src/inbound.ts` often replied with long capability templates (`当前已支持 ...`), which made the bot feel mechanical and off-topic.

The immediate goal is not to redesign the whole stack. It is to make the current front door behave like a focused operating assistant:

`Text -> Semantic Intent -> Capability Graph / Query Path -> Short Clarification when needed`

## Root Cause

### 1. Recall wording gap

The semantic layer and customer query layer were strongly tuned for:

- `跟进`
- `唤回`
- `高价值待唤回`

But real operator wording often uses:

- `召回`
- `最值得召回的顾客`
- `最值得唤回的顾客`

That gap caused valid customer follow-up asks to miss the `customer_segment` route and fall through to generic unmatched handling.

### 2. Over-eager template fallback

`src/inbound.ts` had business fallback branches that were too willing to emit capability menus and rephrase guidance. Those replies are acceptable for explicit capability asks, but harmful for:

- correction messages like `又乱回了，别套模板`
- partial strategy asks
- borderline business asks that only need one missing dimension

## Changes

### Semantic / intent layer

- Extend customer follow-up recognition to include `召回` and `唤回` wording variants.
- Treat `最值得召回的顾客是哪个` and `最值得唤回的顾客是哪个` as `customer_segment` + `followup`.

### Customer query layer

- Expand follow-up candidate detection so recall-style asks use the same customer follow-up / reactivation path as `跟进` asks.
- Keep execution-queue preference when reactivation queue data exists.

### Inbound layer

- Add a short correction-mode reply for messages like `乱回` / `别套模板`.
- Replace generic business fallback menus with short clarification replies.
- Keep long capability menus only for explicit capability questions, not as the default fallback.
- When query execution still returns the generic unmatched text, replace it with a short clarification instead of capability spray.

## Expected Product Effect

After this change:

- `义乌店最值得召回的顾客是哪个`
  should route to customer follow-up / reactivation handling instead of unmatched fallback.
- `又乱回了，别套模板`
  should get a short repair reply instead of a capability list.
- vague strategy asks should get a short “missing dimension” clarification, not a wall of supported features.

## Verification

Targeted verification commands:

```bash
pnpm vitest run src/query-intent.test.ts src/query-engine.test.ts src/inbound.test.ts src/query-semantics.test.ts src/query-route-registry.test.ts
```

Python-side Hermes router smoke:

```bash
python3 -m unittest hermes_overrides.test_htops_router
```

Note: `pytest` is not installed in the current environment, so `python3 -m pytest ...` is not available.

## Rollout

This change only affects htops code paths, so the minimal production restart is:

```bash
sudo systemctl restart htops-bridge.service
```

If the running environment has hot-linked `query` handling inside another process, also restart:

```bash
sudo systemctl restart htops-query-api.service
```
