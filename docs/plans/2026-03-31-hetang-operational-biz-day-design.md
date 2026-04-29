# Hetang Operational Biz Day Design

## Goal

Make Hetang analytics use an operational business day instead of a natural day so overnight traffic from `00:00` to early morning is attributed to the prior store day.

## Scope

- Define a shared operational day cutoff for sync, storage, reports, and natural-language queries.
- Recompute derived `biz_date` values from source timestamps using the operational day rule.
- Keep raw timestamps unchanged for auditability.
- Prepare the codebase so the March backfill can rewrite historical facts with the new date attribution.

## Decision

- The default operational day cutoff is `05:00` local time.
- Any source timestamp from `00:00:00` through `04:59:59` is attributed to the previous `biz_date`.
- Fact tables and marts continue to use the existing `biz_date` field name, but its semantics become “operational business day”.
- Daily reports use “previous completed operational day”, not “previous natural day”.

## Data Layer Impact

- Transaction facts (`fact_consume_bills`, `fact_recharge_bills`, `fact_user_trades`, `fact_tech_up_clock`, `fact_tech_market`) will write operational `biz_date`.
- Snapshot-style facts (`fact_member_daily_snapshot`, `fact_tech_daily_snapshot`, `fact_tech_commission_snapshot`) will snapshot against the operational day active at sync time.
- Existing raw timestamp columns stay untouched.
- Existing March rows will be corrected by the backfill rerun rather than by ad-hoc SQL patching.

## Analysis Layer Impact

- Daily metric aggregation, previous-day comparisons, and inbound “today/yesterday” resolution switch to operational-day helpers.
- “今日/今天” means the current operational day.
- Report defaults resolve to the most recently completed operational day.

## Risks And Guards

- Old rows already stored under natural-day semantics remain mixed until March backfill completes.
- Snapshot tables may temporarily contain old natural-day rows alongside new operational-day rows; marts and regenerated reports should become authoritative after backfill.
- Tests must lock down cutoff behavior around `00:00-05:00`, previous-day report selection, and overnight transaction attribution.
