import { Prisma, type PrismaClient } from "@prisma/client";

import { env } from "../../config/env.js";
import { databaseSchema } from "../../lib/prisma.js";
import { quoteIdentifier, tableRef } from "../../lib/sql.js";

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
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2021"
  ) {
    return true;
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== "P2010") {
    return false;
  }

  const code =
    typeof error.meta?.code === "string"
      ? error.meta.code
      : typeof error.meta?.sqlState === "string"
        ? error.meta.sqlState
        : null;
  if (code === "42P01") {
    return true;
  }

  const metaMessage =
    typeof error.meta?.message === "string" ? error.meta.message : "";
  const errorMessage = error.message;
  const combined = `${metaMessage} ${errorMessage}`.toLowerCase();
  return (
    combined.includes("does not exist") &&
    combined.includes(env.METRICS_MATERIALIZED_VIEW_NAME.toLowerCase())
  );
};

export const ensureMetricsMaterializedView = async (
  prisma: PrismaClient,
): Promise<void> => {
  await prisma.$executeRaw`
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
  `;

  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdentifier(metricsViewIndexName)} ON ${quoteIdentifier(databaseSchema)}.${quoteIdentifier(env.METRICS_MATERIALIZED_VIEW_NAME)} (property_id, day)`,
  );
};

export const refreshMetricsMaterializedView = async (
  prisma: PrismaClient,
): Promise<void> => {
  await prisma.$executeRaw`REFRESH MATERIALIZED VIEW ${metricsViewTableRef}`;
};

export const readMetricsMaterializedViewRows = async (
  prisma: PrismaClient,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<MaterializedSummaryRow[]> =>
  prisma.$queryRaw<Array<MaterializedSummaryRow>>`
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
  `;
