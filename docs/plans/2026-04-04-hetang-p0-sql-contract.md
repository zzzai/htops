# Hetang P0 SQL Contract

## Purpose

This contract guarantees that the first batch of SQL surfaces exposes a predictable set of fields that the runtime and agents can rely on. It describes the expected columns, their source tables/fields, aggregation rules, and how nulls are handled for:

- `mv_store_manager_daily_kpi`
- `mv_tech_profile_30d`
- `mv_store_review_7d`

Each field below must exist in the view definition before the implementation plan moves to Task 2.

## mv_store_manager_daily_kpi

| Field                  | Source                                                                    | Aggregation Rule                   | Null Behavior                                      |
| ---------------------- | ------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
| `biz_date`             | `fact_consume_bills.biz_date` (aliased from current biz day table)        | `GROUP BY biz_date`                | Not nullable (view filtered to non-null biz dates) |
| `org_id`               | `fact_consume_bills.org_id`                                               | `GROUP BY org_id`                  | Not nullable (view limited to configured stores)   |
| `store_name`           | `dim_store.store_name`                                                    | `MAX()`                            | Non-null (serves as label)                         |
| `daily_actual_revenue` | `fact_consume_bills.pay_amount` filtered by `anti_flag = false`           | `SUM(pay_amount)`                  | `0` when no rows                                   |
| `daily_card_consume`   | `fact_consume_bills.consume_amount - pay_amount` with `anti_flag = false` | `SUM(consume_amount - pay_amount)` | `0` when no rows                                   |
| `daily_order_count`    | `fact_consume_bills.settle_no`                                            | `COUNT(DISTINCT settle_no)`        | `0` when no distinct settle_no                     |
| `total_clocks`         | `fact_tech_up_clock.count`                                                | `SUM(count)`                       | `0` when no tech rows                              |
| `assign_clocks`        | `fact_tech_up_clock.count` filtered `clock_type = '点钟'`                 | `SUM(count)`                       | `0` when no matching clock_type                    |
| `queue_clocks`         | `fact_tech_up_clock.count` filtered `clock_type = '排钟'`                 | `SUM(count)`                       | `0` when no matching clock_type                    |
| `point_clock_rate`     | `assign_clocks` / `total_clocks`                                          | computed; guard divide by zero     | `NULL` when `total_clocks = 0`                     |
| `average_ticket`       | `daily_actual_revenue` / `daily_order_count`                              | computed; guard divide by zero     | `NULL` when `daily_order_count = 0`                |
| `clock_effect`         | `daily_actual_revenue` / `total_clocks`                                   | computed; guard divide by zero     | `NULL` when `total_clocks = 0`                     |

## mv_tech_profile_30d

| Field                       | Source                                                                 | Aggregation Rule                                                | Null Behavior                      |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| `org_id`                    | `fact_tech_up_clock.org_id`                                            | `GROUP BY org_id`                                               | Not nullable                       |
| `window_end_biz_date`       | `fact_tech_up_clock.biz_date` (rolled to end-date)                     | `MAX(biz_date)` over last 30 days                               | Not nullable                       |
| `tech_code`                 | `fact_tech_up_clock.person_code`                                       | `GROUP BY`                                                      | Not nullable                       |
| `tech_name`                 | `fact_tech_up_clock.person_name`                                       | `MAX(person_name)`                                              | Non-null (fallback to `tech_code`) |
| `served_customer_count_30d` | `mart_customer_tech_links.customer_identity_key` for rows in window    | `COUNT(DISTINCT customer_identity_key)`                         | `0` when no links                  |
| `served_order_count_30d`    | grouped by `settle_id` (mart customer tech links)                      | `COUNT(DISTINCT settle_id)`                                     | `0`                                |
| `service_day_count_30d`     | number of distinct `biz_date` per tech                                 | `COUNT(DISTINCT biz_date)`                                      | `0`                                |
| `total_clock_count_30d`     | `fact_tech_up_clock.count` window                                      | `SUM(count)`                                                    | `0`                                |
| `point_clock_count_30d`     | filtered `clock_type = '点钟'`                                         | `SUM(count)`                                                    | `0`                                |
| `queue_clock_count_30d`     | filtered `clock_type = '排钟'`                                         | `SUM(count)`                                                    | `0`                                |
| `point_clock_rate_30d`      | `point_clock_count_30d / total_clock_count_30d`                        | computed with guard                                             | `NULL` when denominator zero       |
| `add_clock_rate_30d`        | `sum(change where raw_json indicates add clock) / total_upclock_count` | aggregated indicator derived from `fact_tech_up_clock.raw_json` | `NULL` when data absent            |
| `turnover_30d`              | `fact_tech_up_clock.turnover`                                          | `SUM(turnover)`                                                 | `0`                                |
| `commission_30d`            | `fact_tech_up_clock.comm`                                              | `SUM(comm)`                                                     | `0`                                |
| `market_revenue_30d`        | `fact_tech_market.after_disc` filtered by tech                         | `SUM(after_disc)`                                               | `0`                                |
| `active_days_30d`           | distinct `biz_date` with `count > 0`                                   | `COUNT(DISTINCT biz_date)`                                      | `0`                                |

## mv_store_review_7d

| Field                                      | Source                                                     | Aggregation Rule                           | Null Behavior                |
| ------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------ | ---------------------------- |
| `org_id`                                   | `fact_consume_bills.org_id`                                | `GROUP BY org_id`                          | Not nullable                 |
| `window_end_biz_date`                      | latest `biz_date` within 7-day range                       | `MAX(biz_date)`                            | Not nullable                 |
| `revenue_7d`                               | `fact_consume_bills.pay_amount`                            | `SUM(pay_amount)` with `anti_flag = false` | `0`                          |
| `order_count_7d`                           | `COUNT(DISTINCT settle_no)`                                | `COUNT(DISTINCT settle_no)`                | `0`                          |
| `total_clocks_7d`                          | `fact_tech_up_clock.count` in window                       | `SUM(count)`                               | `0`                          |
| `clock_effect_7d`                          | `revenue_7d / total_clocks_7d`                             | computed guard divide                      | `NULL` when denominator zero |
| `average_ticket_7d`                        | `revenue_7d / order_count_7d`                              | computed guard divide                      | `NULL` when denominator zero |
| `point_clock_rate_7d`                      | filtered `point` counts                                    | `SUM(point clocks) / total_clocks_7d`      | `NULL` if no clocks          |
| `add_clock_rate_7d`                        | filtered add-clock indicator                               | derived ratio                              | `NULL` when undefined        |
| `groupbuy_order_share_7d`                  | `groupbuy order count / order_count_7d`                    | ratio from `mart_daily_store_metrics`      | `NULL` when denominator zero |
| `groupbuy_7d_revisit_rate`                 | `mart_daily_store_metrics.metrics_json` entry              | take stored ratio (0-1)                    | `NULL` when entry missing    |
| `groupbuy_7d_card_open_rate`               | same source                                                | copied ratio                               | `NULL` when missing          |
| `groupbuy_7d_stored_value_conversion_rate` | same source                                                | copied ratio                               | `NULL` when missing          |
| `groupbuy_30d_member_pay_conversion_rate`  | `mart_daily_store_metrics` entry                           | copied ratio                               | `NULL` when missing          |
| `sleeping_member_rate`                     | `mart_daily_store_metrics.metrics_json.sleepingMemberRate` | copied ratio                               | `NULL` when missing          |
| `active_tech_count_7d`                     | `mart_daily_store_metrics.metrics_json.activeTechCount`    | copied count                               | `NULL` when missing          |
