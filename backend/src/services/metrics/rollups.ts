import { Prisma, type PrismaClient } from "@prisma/client";

import { env } from "../../config/env.js";
import {
  EVENT_INGEST_ENDPOINT,
  LEAD_INGEST_ENDPOINT,
} from "../../lib/ingest-rejections.js";
import { toPrismaJson } from "../../lib/json.js";
import { toBigInt, toInteger } from "../../lib/coerce.js";
import { tableRef } from "../../lib/sql.js";
import {
  addUtcDays,
  formatIsoDay,
  startOfUtcDay,
} from "../../schemas/metrics.js";

export interface RollupDateRangeInput {
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

const toRequiredJson = (value: unknown): Prisma.InputJsonValue => {
  const parsed = toPrismaJson(value);
  if (parsed === undefined) {
    throw new TypeError("expected JSON value");
  }
  return parsed;
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
  prisma: PrismaClient,
  dayStart: Date,
  propertyId: string,
): Promise<void> => {
  const dayEnd = addUtcDays(dayStart, 1);
  const isDefaultProperty = propertyId === env.ROLLUP_DEFAULT_PROPERTY_ID;

  const eventPropertyFilter = isDefaultProperty
    ? Prisma.empty
    : Prisma.sql`AND e."property_id" = ${propertyId}`;

  const leadPropertyFilter = isDefaultProperty
    ? Prisma.empty
    : Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM ${LEAD_IDENTITIES_TABLE} li
          INNER JOIN ${EVENTS_TABLE} ev ON ev."visitor_id" = li."visitor_id"
          WHERE li."lead_id" = l."id"
            AND ev."property_id" = ${propertyId}
            AND ev."timestamp" <= l."first_captured_at"
        )
      `;

  const leadVisitorPropertyFilter = isDefaultProperty
    ? Prisma.empty
    : Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM ${EVENTS_TABLE} ev
          WHERE ev."visitor_id" = li."visitor_id"
            AND ev."property_id" = ${propertyId}
            AND ev."timestamp" <= l."first_captured_at"
        )
      `;

  const submissionPropertyFilter = isDefaultProperty
    ? Prisma.empty
    : Prisma.sql`
        AND EXISTS (
          SELECT 1
          FROM ${EVENTS_TABLE} ev
          WHERE ev."visitor_id" = fs."visitor_id"
            AND ev."property_id" = ${propertyId}
            AND ev."timestamp" <= fs."submitted_at"
        )
      `;

  const [trafficRows, formRows, leadRows, timeRows, sourceRows, landingRows] =
    await Promise.all([
      prisma.$queryRaw<Array<TrafficTotalsRow>>`
        SELECT
          COUNT(DISTINCT e."visitor_id")::int AS unique_visitors,
          COUNT(DISTINCT e."visitor_id") FILTER (WHERE v."first_seen_at" < ${dayStart})::int AS returning_visitors,
          COUNT(*) FILTER (WHERE e."event_type" = 'page_view')::int AS total_page_views,
          COUNT(*) FILTER (WHERE e."is_entrance")::int AS total_entrances,
          COUNT(*) FILTER (WHERE e."is_exit")::int AS total_exits,
          COUNT(*) FILTER (WHERE e."is_conversion")::int AS total_conversions
        FROM ${EVENTS_TABLE} e
        INNER JOIN ${VISITORS_TABLE} v ON v."id" = e."visitor_id"
        WHERE e."property_id" = ${propertyId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
      `,
      prisma.$queryRaw<Array<FormMetricsRow>>`
        SELECT
          COUNT(*) FILTER (WHERE e."event_type" = 'form_start')::int AS form_starts,
          COUNT(*) FILTER (WHERE e."event_type" = 'form_submit')::int AS form_submits
        FROM ${EVENTS_TABLE} e
        WHERE e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          ${eventPropertyFilter}
      `,
      prisma.$queryRaw<Array<NewLeadsRow>>`
        SELECT COUNT(*)::int AS new_leads
        FROM ${LEADS_TABLE} l
        WHERE l."first_captured_at" >= ${dayStart}
          AND l."first_captured_at" < ${dayEnd}
          ${leadPropertyFilter}
      `,
      prisma.$queryRaw<Array<TimeToCaptureRow>>`
        WITH lead_capture AS (
          SELECT
            l."id" AS lead_id,
            l."first_captured_at" AS first_captured_at,
            MIN(v."first_seen_at") AS first_seen_at
          FROM ${LEADS_TABLE} l
          INNER JOIN ${LEAD_IDENTITIES_TABLE} li ON li."lead_id" = l."id"
          INNER JOIN ${VISITORS_TABLE} v ON v."id" = li."visitor_id"
          WHERE l."first_captured_at" >= ${dayStart}
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
      prisma.$queryRaw<Array<TrafficSourceRow>>`
        SELECT
          e."traffic_source"::text AS source,
          COUNT(*)::int AS count
        FROM ${EVENTS_TABLE} e
        WHERE e."property_id" = ${propertyId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
        GROUP BY e."traffic_source"
      `,
      prisma.$queryRaw<Array<LandingPathRow>>`
        SELECT
          e."path" AS path,
          COUNT(*)::int AS entrances,
          COUNT(*) FILTER (WHERE e."is_conversion")::int AS conversions
        FROM ${EVENTS_TABLE} e
        WHERE e."property_id" = ${propertyId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          AND e."is_entrance" = true
        GROUP BY e."path"
        ORDER BY entrances DESC, conversions DESC, e."path" ASC
        LIMIT 10
      `,
    ]);

  const [eventRows, leadIngestRows, ingestLatencyRows, ingestRejectionRows] =
    await Promise.all([
      prisma.$queryRaw<Array<IngestEventsRow>>`
      SELECT COUNT(*)::int AS events_accepted
      FROM ${EVENTS_TABLE} e
      WHERE e."timestamp" >= ${dayStart}
        AND e."timestamp" < ${dayEnd}
        ${eventPropertyFilter}
    `,
      prisma.$queryRaw<Array<IngestLeadsRow>>`
      SELECT
        COUNT(*) FILTER (WHERE fs."validation_status" = 'accepted')::int AS leads_accepted,
        COUNT(*) FILTER (WHERE fs."validation_status" <> 'accepted')::int AS leads_rejected
      FROM ${FORM_SUBMISSIONS_TABLE} fs
      WHERE fs."submitted_at" >= ${dayStart}
        AND fs."submitted_at" < ${dayEnd}
        ${submissionPropertyFilter}
    `,
      prisma.$queryRaw<Array<IngestLatencyRow>>`
        SELECT
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (
            ORDER BY (e."props"->>'ttfbMs')::int
          ))::int AS p95_ttfb_ms
        FROM ${EVENTS_TABLE} e
        WHERE e."property_id" = ${propertyId}
          AND e."timestamp" >= ${dayStart}
          AND e."timestamp" < ${dayEnd}
          AND e."props"->>'ttfbMs' IS NOT NULL
      `,
      prisma.$queryRaw<Array<IngestRejectionsRow>>`
        SELECT
          COUNT(*) FILTER (WHERE r."endpoint" = ${EVENT_INGEST_ENDPOINT})::int AS events_rejected,
          COUNT(*) FILTER (WHERE r."endpoint" = ${LEAD_INGEST_ENDPOINT})::int AS leads_rejected
        FROM ${INGEST_REJECTIONS_TABLE} r
        WHERE r."property_id" = ${propertyId}
          AND r."occurred_at" >= ${dayStart}
          AND r."occurred_at" < ${dayEnd}
      `,
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

  const metricRollupValues = {
    uniqueVisitors: toInteger(trafficRow?.unique_visitors),
    returningVisitors: toInteger(trafficRow?.returning_visitors),
    totalPageViews: toInteger(trafficRow?.total_page_views),
    totalEntrances: toInteger(trafficRow?.total_entrances),
    totalExits: toInteger(trafficRow?.total_exits),
    totalConversions: toInteger(trafficRow?.total_conversions),
    formStarts: toInteger(formRow?.form_starts),
    formSubmits: toInteger(formRow?.form_submits),
    newLeads: toInteger(leadRow?.new_leads),
    timeToFirstCaptureSumMs: toBigInt(timeRow?.sum_ms),
    timeToFirstCaptureCount: toInteger(timeRow?.count),
    trafficSourceBreakdown: toRequiredJson(trafficSourceBreakdown),
    topLandingPaths: toRequiredJson(topLandingPaths),
  };

  const ingestRollupValues = {
    eventsAccepted: toInteger(eventRow?.events_accepted),
    eventsRejected,
    leadsAccepted: toInteger(leadIngestRow?.leads_accepted),
    leadsRejected,
    p95TtfbMs:
      ingestLatencyRow?.p95_ttfb_ms === null
        ? null
        : toInteger(ingestLatencyRow?.p95_ttfb_ms),
    errorBreakdown: toRequiredJson({
      eventsRejected,
      leadsRejected,
    }),
  };

  await Promise.all([
    prisma.dailyMetricRollup.upsert({
      where: {
        propertyId_day: {
          propertyId,
          day: dayStart,
        },
      },
      update: {
        ...metricRollupValues,
        generatedAt: new Date(),
      },
      create: {
        propertyId,
        day: dayStart,
        ...metricRollupValues,
      },
    }),
    prisma.dailyIngestRollup.upsert({
      where: {
        propertyId_day: {
          propertyId,
          day: dayStart,
        },
      },
      update: {
        ...ingestRollupValues,
        generatedAt: new Date(),
      },
      create: {
        propertyId,
        day: dayStart,
        ...ingestRollupValues,
      },
    }),
  ]);
};

export const rollupDateRange = async (
  prisma: PrismaClient,
  input: RollupDateRangeInput,
): Promise<RollupDateRangeResult> => {
  const propertyId = input.propertyId ?? env.ROLLUP_DEFAULT_PROPERTY_ID;
  const days = buildDays(input.from, input.to);
  const batchSize = Math.max(1, input.batchSize ?? env.ROLLUP_BATCH_DAYS);

  for (let index = 0; index < days.length; index += batchSize) {
    const batch = days.slice(index, index + batchSize);
    await Promise.all(
      batch.map(async (day) => {
        await computeDailyMetrics(prisma, day, propertyId);
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
  prisma: PrismaClient,
  propertyId: string,
): Promise<RollupFreshness> => {
  const latestMetric = await prisma.dailyMetricRollup.findFirst({
    where: { propertyId },
    orderBy: [{ day: "desc" }, { generatedAt: "desc" }],
    select: {
      day: true,
      generatedAt: true,
    },
  });

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
    generatedAt: latestMetric.generatedAt.toISOString(),
    lagDays,
  };
};
