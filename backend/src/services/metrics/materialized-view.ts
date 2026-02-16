import type { PoolClient } from "pg";

import { env } from "../../config/env.js";
import { query, rawSql, sql } from "../../lib/db.js";
import { quoteIdentifier, tableRef } from "../../lib/sql.js";

const databaseSchema = process.env.DATABASE_SCHEMA || "public";

export interface MaterializedSummaryRow {
  day: Date;
  unique_visitors: unknown;
  returning_visitors: unknown;
  total_page_views: unknown;
  total_entrances: unknown;
  total_conversions: unknown;
  form_starts: unknown;
  form_submits: unknown;
  new_leads: unknown;
  time_to_first_capture_sum_ms: unknown;
  time_to_first_capture_count: unknown;
  traffic_source_breakdown: unknown;
  events_accepted: unknown;
  events_rejected: unknown;
  p95_ttfb_ms: unknown;
}

const metricsRollupTableRef = tableRef("daily_metric_rollups");
const ingestRollupTableRef = tableRef("daily_ingest_rollups");
const metricsViewTableRef = tableRef(env.METRICS_MATERIALIZED_VIEW_NAME);

const metricsViewIndexName = `${env.METRICS_MATERIALIZED_VIEW_NAME.slice(0, 48)}_property_day_key`;

export const isMaterializedViewMissingError = (error: unknown): boolean => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    return code === "42P01"; // undefined_table
  }
  return false;
};

export const checkMaterializedViewExists = async (
  tx: PoolClient,
): Promise<boolean> => {
  const { rows } = await query(
    tx,
    sql`
      SELECT 1
      FROM pg_matviews
      WHERE schemaname = ${databaseSchema}
        AND matviewname = ${env.METRICS_MATERIALIZED_VIEW_NAME}
    `,
  );
  return rows.length > 0;
};

export const ensureMetricsMaterializedView = async (
  tx: PoolClient,
): Promise<void> => {
  await query(
    tx,
    sql`
    CREATE MATERIALIZED VIEW IF NOT EXISTS ${metricsViewTableRef} AS
      SELECT
        m."property_id" AS property_id,
        m."day" AS day,
        m."unique_visitors" AS unique_visitors,
        m."returning_visitors" AS returning_visitors,
        m."total_page_views" AS total_page_views,
        m."total_entrances" AS total_entrances,
        m."total_conversions" AS total_conversions,
        m."form_starts" AS form_starts,
        m."form_submits" AS form_submits,
        m."new_leads" AS new_leads,
        m."time_to_first_capture_sum_ms" AS time_to_first_capture_sum_ms,
        m."time_to_first_capture_count" AS time_to_first_capture_count,
        m."traffic_source_breakdown" AS traffic_source_breakdown,
        COALESCE(i."events_accepted", 0)::int AS events_accepted,
        COALESCE(i."events_rejected", 0)::int AS events_rejected,
        i."p95_ttfb_ms" AS p95_ttfb_ms
      FROM ${metricsRollupTableRef} m
      LEFT JOIN ${ingestRollupTableRef} i
        ON i."property_id" = m."property_id"
       AND i."day" = m."day"
    WITH NO DATA
  `,
  );

  const indexName = quoteIdentifier(metricsViewIndexName);
  const schemaName = quoteIdentifier(databaseSchema);
  const viewName = quoteIdentifier(env.METRICS_MATERIALIZED_VIEW_NAME);

  const createIndexSql = rawSql(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${schemaName}.${viewName} (property_id, day)`,
  );

  await query(tx, createIndexSql);
};

export const refreshMetricsMaterializedView = async (
  tx: PoolClient,
): Promise<void> => {
  await query(tx, sql`REFRESH MATERIALIZED VIEW ${metricsViewTableRef}`);
};

export const readMetricsMaterializedViewRows = async (
  tx: PoolClient,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<MaterializedSummaryRow[]> => {
  const { rows } = await query<MaterializedSummaryRow>(
    tx,
    sql`
    SELECT
      day,
      unique_visitors,
      returning_visitors,
      total_page_views,
      total_entrances,
      total_conversions,
      form_starts,
      form_submits,
      new_leads,
      time_to_first_capture_sum_ms,
      time_to_first_capture_count,
      traffic_source_breakdown,
      events_accepted,
      events_rejected,
      p95_ttfb_ms
    FROM ${metricsViewTableRef}
    WHERE property_id = ${propertyId}
      AND day >= ${from}
      AND day <= ${to}
    ORDER BY day ASC
  `,
  );
  return rows;
};

export const tryRefreshMetricsMaterializedView = async (
  tx: PoolClient,
): Promise<void> => {
  if (!env.METRICS_USE_MATERIALIZED_VIEW) {
    return;
  }

  try {
    await refreshMetricsMaterializedView(tx);
    console.log("✅ Materialized view refreshed.");
  } catch (error: unknown) {
    if (isMaterializedViewMissingError(error)) {
      console.warn(
        "⚠️ Materialized view is enabled but not initialized. Run `npm run rollups:mv:init`.",
      );
      return;
    }

    throw error;
  }
};
