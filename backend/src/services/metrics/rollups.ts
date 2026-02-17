import type { PoolClient } from "pg";

import { env } from "../../config/env.js";
import {
  EVENT_INGEST_ENDPOINT,
  LEAD_INGEST_ENDPOINT,
} from "../../lib/ingest-rejections.js";
import { toJsonValue } from "../../lib/json.js";
import { toBigInt, toInteger } from "../../lib/coerce.js";
import { tableRef } from "../../lib/sql.js";
import {
  addUtcDays,
  formatIsoDay,
  startOfUtcDay,
} from "../../schemas/metrics.js";
import { emptySql, query, sql, type SqlQuery } from "../../lib/db.js";

export interface RollupDateRangeInput {
  tenantId: string;
  from: Date;
  to: Date;
  propertyId?: string;
  batchSize?: number;
}

export interface RollupDateRangeResult {
  propertyId: string;
  dayCount: number;
  rolledUpDays: string[];
}

interface TrafficTotalsRow {
  unique_visitors: unknown;
  returning_visitors: unknown;
  total_page_views: unknown;
  total_entrances: unknown;
  total_exits: unknown;
  total_conversions: unknown;
}

interface FormMetricsRow {
  form_starts: unknown;
  form_submits: unknown;
}

interface NewLeadsRow {
  new_leads: unknown;
}

interface TimeToCaptureRow {
  sum_ms: unknown;
  count: unknown;
}

interface TrafficSourceRow {
  source: string;
  count: unknown;
}

interface LandingPathRow {
  path: string;
  entrances: unknown;
  conversions: unknown;
}

interface IngestEventsRow {
  events_accepted: unknown;
}

interface IngestLeadsRow {
  leads_accepted: unknown;
  leads_rejected: unknown;
}

interface IngestLatencyRow {
  p95_ttfb_ms: unknown;
}

interface IngestRejectionsRow {
  events_rejected: unknown;
  leads_rejected: unknown;
}

const VISITORS_TABLE = tableRef("visitors");
const EVENTS_TABLE = tableRef("events");
const LEADS_TABLE = tableRef("leads");
const LEAD_IDENTITIES_TABLE = tableRef("lead_identities");
const FORM_SUBMISSIONS_TABLE = tableRef("form_submissions");
const INGEST_REJECTIONS_TABLE = tableRef("ingest_rejections");
const METRICS_ROLLUP_TABLE = tableRef("daily_metric_rollups");
const INGEST_ROLLUP_TABLE = tableRef("daily_ingest_rollups");

const toRequiredJson = (value: unknown): string => {
  const parsed = toJsonValue(value);
  if (parsed === undefined) {
    throw new TypeError("expected JSON value");
  }
  // Pre-stringify so the pg driver sends a JSON string rather than
  // attempting PostgreSQL array serialisation for JS arrays.
  return JSON.stringify(parsed);
};

const buildDays = (from: Date, to: Date): Date[] => {
  const normalizedFrom = startOfUtcDay(from);
  const normalizedTo = startOfUtcDay(to);
  const days: Date[] = [];

  for (
    let cursor = normalizedFrom;
    cursor.getTime() <= normalizedTo.getTime();
    cursor = addUtcDays(cursor, 1)
  ) {
    days.push(cursor);
  }

  return days;
};

const computeDailyMetrics = async (
  tx: PoolClient,
  tenantId: string,
  dayStart: Date,
  propertyId: string,
): Promise<void> => {
  const dayEnd = addUtcDays(dayStart, 1);
  const isDefaultProperty = propertyId === env.ROLLUP_DEFAULT_PROPERTY_ID;

  const eventPropertyFilter: SqlQuery = isDefaultProperty
    ? emptySql()
    : sql`AND e."property_id" = ${propertyId}`;

  const leadPropertyFilter: SqlQuery = isDefaultProperty
    ? emptySql()
    : sql`
        AND EXISTS (
          SELECT 1
          FROM ${LEAD_IDENTITIES_TABLE} li
          INNER JOIN ${EVENTS_TABLE} ev ON ev."visitor_id" = li."visitor_id"
          WHERE li."tenant_id" = l."tenant_id"
            AND li."lead_id" = l."id"
            AND ev."tenant_id" = l."tenant_id"
            AND ev."property_id" = ${propertyId}
            AND ev."timestamp" <= l."first_captured_at"
        )
      `;

  const leadVisitorPropertyFilter: SqlQuery = isDefaultProperty
    ? emptySql()
    : sql`
        AND EXISTS (
          SELECT 1
          FROM ${EVENTS_TABLE} ev
          WHERE ev."tenant_id" = li."tenant_id"
            AND ev."visitor_id" = li."visitor_id"
            AND ev."property_id" = ${propertyId}
            AND ev."timestamp" <= l."first_captured_at"
        )
      `;

  const submissionPropertyFilter: SqlQuery = isDefaultProperty
    ? emptySql()
    : sql`
        AND EXISTS (
          SELECT 1
          FROM ${EVENTS_TABLE} ev
          WHERE ev."tenant_id" = fs."tenant_id"
            AND ev."visitor_id" = fs."visitor_id"
            AND ev."property_id" = ${propertyId}
            AND ev."timestamp" <= fs."submitted_at"
        )
      `;

  const [
    { rows: trafficRows },
    { rows: formRows },
    { rows: leadRows },
    { rows: timeRows },
    { rows: sourceRows },
    { rows: landingRows },
  ] = await Promise.all([
    query<TrafficTotalsRow>(
      tx,
      sql`
        SELECT
          COUNT(DISTINCT e."visitor_id")::int AS unique_visitors,
          COUNT(DISTINCT e."visitor_id") FILTER (WHERE v."first_seen_at" < ${dayStart})::int AS returning_visitors,
          COUNT(*) FILTER (WHERE e."event_type" = 'page_view')::int AS total_page_views,
          COUNT(*) FILTER (WHERE e."is_entrance")::int AS total_entrances,
          COUNT(*) FILTER (WHERE e."is_exit")::int AS total_exits,
          COUNT(*) FILTER (WHERE e."is_conversion")::int AS total_conversions
        FROM ${EVENTS_TABLE} e
        INNER JOIN ${VISITORS_TABLE} v ON v."id" = e."visitor_id" AND v."tenant_id" = e."tenant_id"
        WHERE e."tenant_id" = ${tenantId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          ${eventPropertyFilter}
      `,
    ),
    query<FormMetricsRow>(
      tx,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE e."event_type" = 'form_start')::int AS form_starts,
          COUNT(*) FILTER (WHERE e."event_type" = 'form_submit')::int AS form_submits
        FROM ${EVENTS_TABLE} e
        WHERE e."tenant_id" = ${tenantId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          ${eventPropertyFilter}
      `,
    ),
    query<NewLeadsRow>(
      tx,
      sql`
        SELECT COUNT(*)::int AS new_leads
        FROM ${LEADS_TABLE} l
        WHERE l."tenant_id" = ${tenantId}
          AND l."first_captured_at" >= ${dayStart}
          AND l."first_captured_at" < ${dayEnd}
          ${leadPropertyFilter}
      `,
    ),
    query<TimeToCaptureRow>(
      tx,
      sql`
        WITH lead_capture AS (
          SELECT
            l."id" AS lead_id,
            l."first_captured_at" AS first_captured_at,
            MIN(v."first_seen_at") AS first_seen_at
          FROM ${LEADS_TABLE} l
          INNER JOIN ${LEAD_IDENTITIES_TABLE} li ON li."lead_id" = l."id" AND li."tenant_id" = l."tenant_id"
          INNER JOIN ${VISITORS_TABLE} v ON v."id" = li."visitor_id" AND v."tenant_id" = li."tenant_id"
          WHERE l."tenant_id" = ${tenantId}
            AND l."first_captured_at" >= ${dayStart}
            AND l."first_captured_at" < ${dayEnd}
            ${leadVisitorPropertyFilter}
          GROUP BY l."id", l."first_captured_at"
        )
        SELECT
          COALESCE(
            SUM(
              GREATEST(
                0,
                FLOOR(
                  EXTRACT(EPOCH FROM (first_captured_at - first_seen_at)) * 1000
                )
              )
            )::bigint,
            0
          ) AS sum_ms,
          COUNT(*)::int AS count
        FROM lead_capture
        WHERE first_seen_at IS NOT NULL
      `,
    ),
    query<TrafficSourceRow>(
      tx,
      sql`
        SELECT
          e."traffic_source"::text AS source,
          COUNT(*)::int AS count
        FROM ${EVENTS_TABLE} e
        WHERE e."tenant_id" = ${tenantId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          ${eventPropertyFilter}
        GROUP BY e."traffic_source"
      `,
    ),
    query<LandingPathRow>(
      tx,
      sql`
         SELECT
          e."path" AS path,
          COUNT(*)::int AS entrances,
          COUNT(*) FILTER (WHERE e."is_conversion")::int AS conversions
        FROM ${EVENTS_TABLE} e
        WHERE e."tenant_id" = ${tenantId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          AND e."is_entrance" = true
          ${eventPropertyFilter}
        GROUP BY e."path"
        ORDER BY entrances DESC, conversions DESC, e."path" ASC
        LIMIT 10
      `,
    ),
  ]);

  const [
    { rows: eventRows },
    { rows: leadIngestRows },
    { rows: ingestLatencyRows },
    { rows: ingestRejectionRows },
  ] = await Promise.all([
    query<IngestEventsRow>(
      tx,
      sql`
      SELECT COUNT(*)::int AS events_accepted
      FROM ${EVENTS_TABLE} e
      WHERE e."timestamp" >= ${dayStart}
        AND e."timestamp" < ${dayEnd}
        ${eventPropertyFilter}
    `,
    ),
    query<IngestLeadsRow>(
      tx,
      sql`
      SELECT
        COUNT(*) FILTER (WHERE fs."validation_status" = 'accepted')::int AS leads_accepted,
        COUNT(*) FILTER (WHERE fs."validation_status" <> 'accepted')::int AS leads_rejected
      FROM ${FORM_SUBMISSIONS_TABLE} fs
      WHERE fs."submitted_at" >= ${dayStart}
        AND fs."submitted_at" < ${dayEnd}
        ${submissionPropertyFilter}
    `,
    ),
    query<IngestLatencyRow>(
      tx,
      sql`
        SELECT
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
            ORDER BY (e."props"->>'ttfbMs')::int
          ))::int AS p95_ttfb_ms
        FROM ${EVENTS_TABLE} e
        WHERE e."tenant_id" = ${tenantId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          AND e."props"->>'ttfbMs' IS NOT NULL
          ${eventPropertyFilter}
      `,
    ),
    query<IngestRejectionsRow>(
      tx,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE r."endpoint" = ${EVENT_INGEST_ENDPOINT})::int AS events_rejected,
          COUNT(*) FILTER (WHERE r."endpoint" = ${LEAD_INGEST_ENDPOINT})::int AS leads_rejected
        FROM ${INGEST_REJECTIONS_TABLE} r
        WHERE r."tenant_id" = ${tenantId}
          AND r."occurred_at" >= ${dayStart}
          AND r."occurred_at" < ${dayEnd}
          ${env.ROLLUP_DEFAULT_PROPERTY_ID ? sql`AND r."property_id" = ${propertyId}` : emptySql()} 
      `,
    ),
  ]);

  const trafficRow = trafficRows[0];
  const formRow = formRows[0];
  const leadRow = leadRows[0];
  const timeRow = timeRows[0];
  const eventRow = eventRows[0];
  const leadIngestRow = leadIngestRows[0];
  const ingestLatencyRow = ingestLatencyRows[0];
  const ingestRejectionRow = ingestRejectionRows[0];

  const trafficSourceBreakdown = Object.fromEntries(
    sourceRows.map((row) => [row.source, toInteger(row.count)]),
  );

  const topLandingPaths = landingRows.map((row) => {
    const entrances = toInteger(row.entrances);
    const conversions = toInteger(row.conversions);
    return {
      path: row.path,
      entrances,
      conversions,
      conversionRate: entrances > 0 ? conversions / entrances : 0,
    };
  });

  const eventsRejected = toInteger(ingestRejectionRow?.events_rejected);
  const leadsRejected =
    toInteger(leadIngestRow?.leads_rejected) +
    toInteger(ingestRejectionRow?.leads_rejected);

  const uniqueVisitors = toInteger(trafficRow?.unique_visitors);
  const returningVisitors = toInteger(trafficRow?.returning_visitors);
  const totalPageViews = toInteger(trafficRow?.total_page_views);
  const totalEntrances = toInteger(trafficRow?.total_entrances);
  const totalExits = toInteger(trafficRow?.total_exits);
  const totalConversions = toInteger(trafficRow?.total_conversions);
  const formStarts = toInteger(formRow?.form_starts);
  const formSubmits = toInteger(formRow?.form_submits);
  const newLeads = toInteger(leadRow?.new_leads);
  const timeToFirstCaptureSumMs = toBigInt(timeRow?.sum_ms);
  const timeToFirstCaptureCount = toInteger(timeRow?.count);
  const trafficSourceBreakdownJson = toRequiredJson(trafficSourceBreakdown);
  const topLandingPathsJson = toRequiredJson(topLandingPaths);

  const eventsAccepted = toInteger(eventRow?.events_accepted);
  const leadsAccepted = toInteger(leadIngestRow?.leads_accepted);
  const p95TtfbMs =
    ingestLatencyRow?.p95_ttfb_ms === null
      ? null
      : toInteger(ingestLatencyRow?.p95_ttfb_ms);
  const errorBreakdownJson = toRequiredJson({ eventsRejected, leadsRejected });

  const metricsInsertSql = sql`
        INSERT INTO ${METRICS_ROLLUP_TABLE} (
          "id",
          "tenant_id",
          "property_id",
          "day",
          "unique_visitors",
          "returning_visitors",
          "total_page_views",
          "total_entrances",
          "total_exits",
          "total_conversions",
          "form_starts",
          "form_submits",
          "new_leads",
          "time_to_first_capture_sum_ms",
          "time_to_first_capture_count",
          "traffic_source_breakdown",
          "top_landing_paths",
          "generated_at",
          "updated_at"
        ) VALUES (
          ${crypto.randomUUID()},
          ${tenantId},
          ${propertyId},
          ${dayStart},
          ${uniqueVisitors},
          ${returningVisitors},
          ${totalPageViews},
          ${totalEntrances},
          ${totalExits},
          ${totalConversions},
          ${formStarts},
          ${formSubmits},
          ${newLeads},
          ${timeToFirstCaptureSumMs},
          ${timeToFirstCaptureCount},
          ${trafficSourceBreakdownJson},
          ${topLandingPathsJson},
          NOW(),
          NOW()
        )
        ON CONFLICT ("tenant_id", "property_id", "day") DO UPDATE SET
          "unique_visitors" = EXCLUDED.unique_visitors,
          "returning_visitors" = EXCLUDED.returning_visitors,
          "total_page_views" = EXCLUDED.total_page_views,
          "total_entrances" = EXCLUDED.total_entrances,
          "total_exits" = EXCLUDED.total_exits,
          "total_conversions" = EXCLUDED.total_conversions,
          "form_starts" = EXCLUDED.form_starts,
          "form_submits" = EXCLUDED.form_submits,
          "new_leads" = EXCLUDED.new_leads,
          "time_to_first_capture_sum_ms" = EXCLUDED.time_to_first_capture_sum_ms,
          "time_to_first_capture_count" = EXCLUDED.time_to_first_capture_count,
          "traffic_source_breakdown" = EXCLUDED.traffic_source_breakdown,
          "top_landing_paths" = EXCLUDED.top_landing_paths,
          "generated_at" = NOW(),
          "updated_at" = NOW()
      `;

  const ingestInsertSql = sql`
        INSERT INTO ${INGEST_ROLLUP_TABLE} (
          "id",
          "tenant_id",
          "property_id",
          "day",
          "events_accepted",
          "events_rejected",
          "leads_accepted",
          "leads_rejected",
          "p95_ttfb_ms",
          "error_breakdown",
          "generated_at",
          "updated_at"
        ) VALUES (
          ${crypto.randomUUID()},
          ${tenantId},
          ${propertyId},
          ${dayStart},
          ${eventsAccepted},
          ${eventsRejected},
          ${leadsAccepted},
          ${leadsRejected},
          ${p95TtfbMs},
          ${errorBreakdownJson},
          NOW(),
          NOW()
        )
        ON CONFLICT ("tenant_id", "property_id", "day") DO UPDATE SET
          "events_accepted" = EXCLUDED.events_accepted,
          "events_rejected" = EXCLUDED.events_rejected,
          "leads_accepted" = EXCLUDED.leads_accepted,
          "leads_rejected" = EXCLUDED.leads_rejected,
          "p95_ttfb_ms" = EXCLUDED.p95_ttfb_ms,
          "error_breakdown" = EXCLUDED.error_breakdown,
          "generated_at" = NOW(),
          "updated_at" = NOW()
      `;

  await Promise.all([query(tx, metricsInsertSql), query(tx, ingestInsertSql)]);
};

export const rollupDateRange = async (
  tx: PoolClient,
  input: RollupDateRangeInput,
): Promise<RollupDateRangeResult> => {
  const propertyId = input.propertyId ?? env.ROLLUP_DEFAULT_PROPERTY_ID;
  const days = buildDays(input.from, input.to);
  const batchSize = Math.max(1, input.batchSize ?? env.ROLLUP_BATCH_DAYS);

  for (let index = 0; index < days.length; index += batchSize) {
    const batch = days.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (day) => {
        await computeDailyMetrics(tx, input.tenantId, day, propertyId);
      }),
    );
  }

  return {
    propertyId,
    dayCount: days.length,
    rolledUpDays: days.map((day) => formatIsoDay(day)),
  };
};

export interface RollupFreshness {
  rolledUpThrough: string | null;
  generatedAt: string | null;
  lagDays: number | null;
}

export const getRollupFreshness = async (
  tx: PoolClient,
  tenantId: string,
  propertyId: string,
): Promise<RollupFreshness> => {
  const { rows } = await query<{ day: Date; generated_at: Date }>(
    tx,
    sql`
      SELECT "day", "generated_at"
      FROM ${METRICS_ROLLUP_TABLE}
      WHERE "tenant_id" = ${tenantId}
        AND "property_id" = ${propertyId}
      ORDER BY "day" DESC, "generated_at" DESC
      LIMIT 1
    `,
  );
  const latestMetric = rows[0];

  if (!latestMetric) {
    return {
      rolledUpThrough: null,
      generatedAt: null,
      lagDays: null,
    };
  }

  const today = startOfUtcDay(new Date());
  const lagDays = Math.floor(
    (today.getTime() - startOfUtcDay(latestMetric.day).getTime()) /
      (24 * 60 * 60 * 1000),
  );

  return {
    rolledUpThrough: formatIsoDay(latestMetric.day),
    generatedAt: latestMetric.generated_at.toISOString(),
    lagDays,
  };
};
