import { createHash } from "node:crypto";
import type { QueryPlan } from "./query-plan.js";
import type { ServingCapability } from "./capability-registry.js";

export type CompiledServingQuery = {
  capability_id: string;
  sql: string;
  params: unknown[];
  cache_key: string;
  cache_ttl_seconds: number;
};

function hashPlan(plan: QueryPlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

function resolveOrderAverageAmountSql(): string {
  return "COALESCE(ROUND((service_revenue / NULLIF(service_order_count, 0))::numeric, 2), 0)";
}

function resolveMetricColumn(metric: string): string {
  switch (metric) {
    case "riskScore":
      return "risk_score";
    case "serviceOrderCount":
      return "service_order_count";
    case "orderAverageAmount":
      return resolveOrderAverageAmountSql();
    case "customerCount":
      return "customer_count";
    case "totalClockCount":
      return "total_clocks";
    case "averageTicket":
      return "average_ticket";
    case "clockEffect":
      return "clock_effect";
    case "pointClockRate":
      return "point_clock_rate";
    case "addClockRate":
      return "add_clock_rate";
    case "followupScore":
      return "followup_score";
    case "payAmount90d":
      return "pay_amount_90d";
    case "serviceRevenue":
    default:
      return "service_revenue";
  }
}

function resolveSortSql(plan: QueryPlan, fallbackMetric: string): string {
  const metric = plan.sort?.metric ?? plan.metrics[0] ?? fallbackMetric;
  const direction = plan.sort?.order === "asc" ? "ASC" : "DESC";
  return `${resolveMetricColumn(metric)} ${direction}`;
}

export function compileServingQuery(params: {
  plan: QueryPlan;
  capability: ServingCapability;
  servingVersion: string;
}): CompiledServingQuery {
  const { plan, capability } = params;
  const cache_key = `${params.servingVersion}:${hashPlan(plan)}`;

  switch (capability.sql_family) {
    case "summary_by_pk":
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT
            org_id,
            store_name,
            biz_date,
            service_revenue,
            service_order_count,
            ${resolveOrderAverageAmountSql()} AS order_average_amount,
            customer_count,
            total_clocks,
            average_ticket,
            clock_effect,
            point_clock_rate,
            add_clock_rate
          FROM serving_store_day
          WHERE org_id = $1
            AND biz_date = $2
          LIMIT 1
        `,
        params: [plan.scope.org_ids[0], plan.time.biz_date],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    case "day_breakdown":
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT
            org_id,
            store_name,
            biz_date,
            total_clocks,
            assign_clocks,
            queue_clocks,
            add_clock_count,
            up_clock_record_count,
            point_clock_record_count,
            point_clock_rate,
            add_clock_rate
          FROM serving_store_day_breakdown
          WHERE org_id = $1
            AND biz_date = $2
          LIMIT 1
        `,
        params: [plan.scope.org_ids[0], plan.time.biz_date],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    case "window_summary":
      if (
        plan.action === "compare" &&
        plan.compare?.baseline === "previous_window" &&
        plan.compare.end_biz_date &&
        plan.compare.window_days
      ) {
        return {
          capability_id: capability.capability_id,
          sql: `
            WITH current_window AS (
              SELECT
                org_id,
                store_name,
                window_end_biz_date,
                window_days,
                service_revenue,
                service_order_count,
                ${resolveOrderAverageAmountSql()} AS order_average_amount,
                customer_count,
                total_clocks,
                average_ticket,
                clock_effect,
                point_clock_rate,
                add_clock_rate,
                risk_score
              FROM serving_store_window
              WHERE org_id = $1
                AND window_end_biz_date = $2
                AND window_days = $3
              LIMIT 1
            ),
            baseline_window AS (
              SELECT
                org_id,
                store_name,
                window_end_biz_date,
                window_days,
                service_revenue,
                service_order_count,
                ${resolveOrderAverageAmountSql()} AS baseline_order_average_amount,
                customer_count,
                total_clocks,
                average_ticket,
                clock_effect,
                point_clock_rate,
                add_clock_rate,
                risk_score
              FROM serving_store_window
              WHERE org_id = $1
                AND window_end_biz_date = $4
                AND window_days = $5
              LIMIT 1
            )
            SELECT
              current_window.org_id,
              current_window.store_name,
              current_window.window_end_biz_date,
              current_window.window_days,
              current_window.service_revenue,
              current_window.service_order_count,
              current_window.order_average_amount,
              current_window.customer_count,
              current_window.total_clocks,
              current_window.average_ticket,
              current_window.clock_effect,
              current_window.point_clock_rate,
              current_window.add_clock_rate,
              current_window.risk_score,
              baseline_window.window_end_biz_date AS baseline_window_end_biz_date,
              baseline_window.window_days AS baseline_window_days,
              baseline_window.service_revenue AS baseline_service_revenue,
              baseline_window.service_order_count AS baseline_service_order_count,
              baseline_window.baseline_order_average_amount,
              baseline_window.customer_count AS baseline_customer_count,
              baseline_window.total_clocks AS baseline_total_clocks,
              baseline_window.average_ticket AS baseline_average_ticket,
              baseline_window.clock_effect AS baseline_clock_effect,
              baseline_window.point_clock_rate AS baseline_point_clock_rate,
              baseline_window.add_clock_rate AS baseline_add_clock_rate,
              baseline_window.risk_score AS baseline_risk_score
            FROM current_window
            LEFT JOIN baseline_window ON TRUE
            LIMIT 1
          `,
          params: [
            plan.scope.org_ids[0],
            plan.time.end_biz_date,
            plan.time.window_days,
            plan.compare.end_biz_date,
            plan.compare.window_days,
          ],
          cache_key,
          cache_ttl_seconds: capability.cache_ttl_seconds,
        };
      }
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT
            org_id,
            store_name,
            window_end_biz_date,
            window_days,
            service_revenue,
            service_order_count,
            ${resolveOrderAverageAmountSql()} AS order_average_amount,
            customer_count,
            total_clocks,
            average_ticket,
            clock_effect,
            point_clock_rate,
            add_clock_rate,
            risk_score
          FROM serving_store_window
          WHERE org_id = $1
            AND window_end_biz_date = $2
            AND window_days = $3
          LIMIT 1
        `,
        params: [plan.scope.org_ids[0], plan.time.end_biz_date, plan.time.window_days],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    case "compare_lookup": {
      const metricColumn = resolveMetricColumn(plan.metrics[0] ?? "serviceRevenue");
      if (
        plan.time.mode === "day" &&
        plan.compare?.baseline === "peer_group" &&
        plan.scope.org_ids.length >= 2
      ) {
        return {
          capability_id: capability.capability_id,
          sql: `
            WITH current_day AS (
              SELECT
                org_id,
                store_name,
                biz_date,
                ${metricColumn} AS metric_value
              FROM serving_store_day
              WHERE org_id = $1
                AND biz_date = $2
              LIMIT 1
            ),
            baseline_day AS (
              SELECT
                org_id AS baseline_org_id,
                store_name AS baseline_store_name,
                biz_date AS baseline_biz_date,
                ${metricColumn} AS baseline_metric_value
              FROM serving_store_day
              WHERE org_id = $3
                AND biz_date = $4
              LIMIT 1
            )
            SELECT
              current_day.org_id,
              current_day.store_name,
              current_day.biz_date,
              current_day.metric_value,
              baseline_day.baseline_org_id,
              baseline_day.baseline_store_name,
              baseline_day.baseline_biz_date,
              baseline_day.baseline_metric_value
            FROM current_day
            LEFT JOIN baseline_day ON TRUE
            LIMIT 1
          `,
          params: [
            plan.scope.org_ids[0],
            plan.time.biz_date,
            plan.scope.org_ids[1],
            plan.time.biz_date,
          ],
          cache_key,
          cache_ttl_seconds: capability.cache_ttl_seconds,
        };
      }
      if (
        plan.time.mode === "day" &&
        plan.compare?.baseline === "previous_day" &&
        plan.compare.biz_date
      ) {
        return {
          capability_id: capability.capability_id,
          sql: `
            WITH current_day AS (
              SELECT
                org_id,
                store_name,
                biz_date,
                ${metricColumn} AS metric_value
              FROM serving_store_day
              WHERE org_id = $1
                AND biz_date = $2
              LIMIT 1
            ),
            baseline_day AS (
              SELECT
                org_id AS baseline_org_id,
                store_name AS baseline_store_name,
                biz_date AS baseline_biz_date,
                ${metricColumn} AS baseline_metric_value
              FROM serving_store_day
              WHERE org_id = $1
                AND biz_date = $3
              LIMIT 1
            )
            SELECT
              current_day.org_id,
              current_day.store_name,
              current_day.biz_date,
              current_day.metric_value,
              baseline_day.baseline_org_id,
              baseline_day.baseline_store_name,
              baseline_day.baseline_biz_date,
              baseline_day.baseline_metric_value
            FROM current_day
            LEFT JOIN baseline_day ON TRUE
            LIMIT 1
          `,
          params: [plan.scope.org_ids[0], plan.time.biz_date, plan.compare.biz_date],
          cache_key,
          cache_ttl_seconds: capability.cache_ttl_seconds,
        };
      }
      if (
        plan.time.mode === "window" &&
        plan.compare?.baseline === "peer_group" &&
        plan.scope.org_ids.length >= 2
      ) {
        return {
          capability_id: capability.capability_id,
          sql: `
            WITH current_window AS (
              SELECT
                org_id,
                store_name,
                window_end_biz_date,
                window_days,
                ${metricColumn} AS metric_value
              FROM serving_store_window
              WHERE org_id = $1
                AND window_end_biz_date = $2
                AND window_days = $3
              LIMIT 1
            ),
            baseline_window AS (
              SELECT
                org_id AS baseline_org_id,
                store_name AS baseline_store_name,
                window_end_biz_date AS baseline_window_end_biz_date,
                window_days AS baseline_window_days,
                ${metricColumn} AS baseline_metric_value
              FROM serving_store_window
              WHERE org_id = $4
                AND window_end_biz_date = $2
                AND window_days = $3
              LIMIT 1
            )
            SELECT
              current_window.org_id,
              current_window.store_name,
              current_window.window_end_biz_date,
              current_window.window_days,
              current_window.metric_value,
              baseline_window.baseline_org_id,
              baseline_window.baseline_store_name,
              baseline_window.baseline_window_end_biz_date,
              baseline_window.baseline_window_days,
              baseline_window.baseline_metric_value
            FROM current_window
            LEFT JOIN baseline_window ON TRUE
            LIMIT 1
          `,
          params: [
            plan.scope.org_ids[0],
            plan.time.end_biz_date,
            plan.time.window_days,
            plan.scope.org_ids[1],
          ],
          cache_key,
          cache_ttl_seconds: capability.cache_ttl_seconds,
        };
      }
      if (
        plan.time.mode === "window" &&
        plan.compare?.baseline === "previous_window" &&
        plan.compare.end_biz_date &&
        plan.compare.window_days
      ) {
        return {
          capability_id: capability.capability_id,
          sql: `
            WITH current_window AS (
              SELECT
                org_id,
                store_name,
                window_end_biz_date,
                window_days,
                ${metricColumn} AS metric_value
              FROM serving_store_window
              WHERE org_id = $1
                AND window_end_biz_date = $2
                AND window_days = $3
              LIMIT 1
            ),
            baseline_window AS (
              SELECT
                org_id AS baseline_org_id,
                store_name AS baseline_store_name,
                window_end_biz_date AS baseline_window_end_biz_date,
                window_days AS baseline_window_days,
                ${metricColumn} AS baseline_metric_value
              FROM serving_store_window
              WHERE org_id = $1
                AND window_end_biz_date = $4
                AND window_days = $5
              LIMIT 1
            )
            SELECT
              current_window.org_id,
              current_window.store_name,
              current_window.window_end_biz_date,
              current_window.window_days,
              current_window.metric_value,
              baseline_window.baseline_org_id,
              baseline_window.baseline_store_name,
              baseline_window.baseline_window_end_biz_date,
              baseline_window.baseline_window_days,
              baseline_window.baseline_metric_value
            FROM current_window
            LEFT JOIN baseline_window ON TRUE
            LIMIT 1
          `,
          params: [
            plan.scope.org_ids[0],
            plan.time.end_biz_date,
            plan.time.window_days,
            plan.compare.end_biz_date,
            plan.compare.window_days,
          ],
          cache_key,
          cache_ttl_seconds: capability.cache_ttl_seconds,
        };
      }
      break;
    }
    case "ranking":
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT
            org_id,
            store_name,
            window_end_biz_date,
            window_days,
            service_revenue,
            service_order_count,
            ${resolveOrderAverageAmountSql()} AS order_average_amount,
            customer_count,
            total_clocks,
            average_ticket,
            point_clock_rate,
            add_clock_rate,
            sleeping_member_rate,
            renewal_pressure_index_30d,
            member_repurchase_rate_7d,
            risk_score
          FROM serving_hq_portfolio_window
          WHERE org_id = ANY($1)
            AND window_end_biz_date = $2
            AND window_days = $3
          ORDER BY ${resolveSortSql(plan, "riskScore")}
          LIMIT $4
        `,
        params: [plan.scope.org_ids, plan.time.end_biz_date, plan.time.window_days, plan.limit ?? 10],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    case "day_ranking":
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT
            org_id,
            store_name,
            biz_date,
            ${resolveMetricColumn(plan.metrics[0] ?? "serviceRevenue")} AS metric_value
          FROM serving_store_day
          WHERE org_id = ANY($1)
            AND biz_date = $2
          ORDER BY ${resolveSortSql(plan, "serviceRevenue")}
          LIMIT $3
        `,
        params: [plan.scope.org_ids, plan.time.biz_date, plan.limit ?? 10],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    case "window_ranking":
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT
            org_id,
            store_name,
            window_end_biz_date,
            window_days,
            service_revenue,
            service_order_count,
            ${resolveOrderAverageAmountSql()} AS order_average_amount,
            customer_count,
            total_clocks,
            average_ticket,
            clock_effect,
            point_clock_rate,
            add_clock_rate,
            risk_score
          FROM serving_store_window
          WHERE org_id = ANY($1)
            AND window_end_biz_date = $2
            AND window_days = $3
          ORDER BY ${resolveSortSql(plan, "serviceRevenue")}
          LIMIT $4
        `,
        params: [plan.scope.org_ids, plan.time.end_biz_date, plan.time.window_days, plan.limit ?? 10],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    case "profile_lookup": {
      const phoneSuffix = plan.filters.find((filter) => filter.field === "phone_suffix")?.value;
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT *
          FROM serving_customer_profile_asof
          WHERE org_id = $1
            AND as_of_biz_date = $2
            AND phone_suffix = $3
          ORDER BY followup_score DESC NULLS LAST
          LIMIT 1
        `,
        params: [plan.scope.org_ids[0], plan.time.as_of_biz_date, phoneSuffix],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    }
    case "ranked_list_lookup": {
      const followupBucket = plan.filters.find((filter) => filter.field === "followup_bucket")?.value;
      const primarySegment = plan.filters.find((filter) => filter.field === "primary_segment")?.value;
      if (
        plan.response_shape === "ranking_list" &&
        primarySegment !== undefined &&
        plan.dimensions.includes("tech")
      ) {
        return {
          capability_id: capability.capability_id,
          sql: `
            SELECT
              org_id,
              as_of_biz_date,
              primary_segment,
              top_tech_name AS tech_name,
              COUNT(*)::int AS customer_count
            FROM serving_customer_ranked_list_asof
            WHERE org_id = $1
              AND as_of_biz_date = $2
              AND primary_segment = $3
              AND identity_stable = TRUE
              AND top_tech_name IS NOT NULL
            GROUP BY org_id, as_of_biz_date, primary_segment, top_tech_name
            ORDER BY customer_count DESC, tech_name ASC
            LIMIT $4
          `,
          params: [plan.scope.org_ids[0], plan.time.as_of_biz_date, primarySegment, plan.limit ?? 20],
          cache_key,
          cache_ttl_seconds: capability.cache_ttl_seconds,
        };
      }
      if (plan.response_shape === "scalar" && primarySegment !== undefined) {
        return {
          capability_id: capability.capability_id,
          sql: `
            SELECT
              org_id,
              as_of_biz_date,
              $3::text AS primary_segment,
              COUNT(*)::int AS customer_count,
              COUNT(*) FILTER (WHERE tech_loyalty_segment = 'single-tech-loyal')::int AS single_tech_loyal_count,
              COALESCE(SUM(pay_amount_90d), 0) AS pay_amount_90d_total
            FROM serving_customer_ranked_list_asof
            WHERE org_id = $1
              AND as_of_biz_date = $2
              AND primary_segment = $3
            GROUP BY org_id, as_of_biz_date
          `,
          params: [plan.scope.org_ids[0], plan.time.as_of_biz_date, primarySegment],
          cache_key,
          cache_ttl_seconds: capability.cache_ttl_seconds,
        };
      }
      const whereSql =
        followupBucket !== undefined
          ? `
          WHERE org_id = $1
            AND as_of_biz_date = $2
            AND followup_bucket = $3
        `
          : primarySegment !== undefined
            ? `
          WHERE org_id = $1
            AND as_of_biz_date = $2
            AND primary_segment = $3
        `
            : `
          WHERE org_id = $1
            AND as_of_biz_date = $2
        `;
      const limitParamIndex = followupBucket !== undefined || primarySegment !== undefined ? 4 : 3;
      return {
        capability_id: capability.capability_id,
        sql: `
          SELECT *
          FROM serving_customer_ranked_list_asof
          ${whereSql}
          ORDER BY ${resolveSortSql(plan, "followupScore")} NULLS LAST
          LIMIT $${limitParamIndex}
        `,
        params:
          followupBucket !== undefined
            ? [plan.scope.org_ids[0], plan.time.as_of_biz_date, followupBucket, plan.limit ?? 20]
            : primarySegment !== undefined
              ? [plan.scope.org_ids[0], plan.time.as_of_biz_date, primarySegment, plan.limit ?? 20]
              : [plan.scope.org_ids[0], plan.time.as_of_biz_date, plan.limit ?? 20],
        cache_key,
        cache_ttl_seconds: capability.cache_ttl_seconds,
      };
    }
  }

  throw new Error(
    `Unsupported serving sql family: ${String((capability as { sql_family?: unknown }).sql_family ?? "unknown")}`,
  );
}
