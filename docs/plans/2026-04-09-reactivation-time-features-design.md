# Hetang Reactivation Time-Behavior Features Design

## Goal

Integrate member time-behavior signals into the existing reactivation feature mart and reactivation ranking so the system can prioritize members who have a stable return rhythm and are currently overdue relative to that rhythm.

## Chosen Approach

Add deterministic time features to `mart_member_reactivation_features_daily`, sourced from existing consume bill `optTime` timestamps and distinct visit events.

### Included in this phase

- Daypart preference:
  - dominant visit daypart
  - preferred daypart share
  - late-night visit share
  - overnight visit share
- Weekly rhythm:
  - dominant weekday
  - preferred weekday share
  - weekend visit share
- Monthly rhythm:
  - dominant month phase
  - preferred month phase share
- Return-cycle rhythm:
  - average visit gap
  - visit gap standard deviation
  - cycle deviation score
  - time preference confidence score

## Why this approach

- Uses data already present in the project
- Remains fully explainable and deterministic
- Improves recall ranking without requiring touch logs or ML infrastructure
- Supports future messaging and send-time optimization without blocking the current phase

## Scoring Changes

Keep the current stored-value trajectory score as the base layer, then add time-aware boosts for:

- strong repeatable time preference
- members who are materially overdue versus their own historical revisit rhythm

Avoid boosting specific lifestyles directly. For example, late-night customers are not inherently more important than afternoon customers; only stable and currently overdue patterns should raise recall priority.

## Out of Scope for this phase

- Holiday calendar modeling
- Explicit payout-day assumptions
- ML-based send-time optimization
- Channel strategy optimization

## Verification

- Add unit tests for time feature extraction
- Add score tests proving overdue rhythmic customers rank higher
- Add store persistence coverage for the new columns
- Rebuild recent Yingbin rows and inspect top candidates
