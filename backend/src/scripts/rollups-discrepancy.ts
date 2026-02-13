import { Prisma } from "@prisma/client";

import { env } from "../config/env.js";
import { EVENT_INGEST_ENDPOINT } from "../lib/ingest-rejections.js";
import { toInteger } from "../lib/coerce.js";
import { prisma } from "../lib/prisma.js";
import { tableRef } from "../lib/sql.js";
import {
  addUtcDays,
  formatIsoDay,
  parseIsoDay,
  startOfUtcDay,
} from "../schemas/metrics.js";
import { parseRollupCliArgs } from "./lib/rollup-cli.js";

interface RawEventsRow {
  day: unknown;
  raw_events_accepted: unknown;
}

interface RawRejectionsRow {
  day: unknown;
  raw_events_rejected: unknown;
}

interface RawPageViewsRow {
  day: unknown;
  raw_page_views: unknown;
}

interface RollupRow {
  day: unknown;
  rollup_events_accepted: unknown;
  rollup_events_rejected: unknown;
  rollup_page_views: unknown;
}

const EVENTS_TABLE = tableRef("events");
const DAILY_METRIC_ROLLUPS_TABLE = tableRef("daily_metric_rollups");
const DAILY_INGEST_ROLLUPS_TABLE = tableRef("daily_ingest_rollups");
const INGEST_REJECTIONS_TABLE = tableRef("ingest_rejections");

const toIsoDay = (value: unknown): string => {
  if (value instanceof Date) {
    return formatIsoDay(value);
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  throw new TypeError("unexpected day value in SQL result");
};

const buildDays = (from: Date, to: Date): string[] => {
  const days: string[] = [];

  for (
    let cursor = startOfUtcDay(from);
    cursor.getTime() <= startOfUtcDay(to).getTime();
    cursor = addUtcDays(cursor, 1)
  ) {
    days.push(formatIsoDay(cursor));
  }

  return days;
};

const run = async (): Promise<void> => {
  const args = parseRollupCliArgs(process.argv.slice(2));

  const today = startOfUtcDay(new Date());
  const defaultFrom = addUtcDays(today, -(env.ROLLUP_BATCH_DAYS - 1));
  const from = args.from ? parseIsoDay(args.from) : defaultFrom;
  const to = args.to ? parseIsoDay(args.to) : today;
  const propertyId = args.propertyId ?? env.ROLLUP_DEFAULT_PROPERTY_ID;

  if (from.getTime() > to.getTime()) {
    throw new Error("--from must be before or equal to --to");
  }

  const toExclusive = addUtcDays(to, 1);
  const isDefaultProperty = propertyId === env.ROLLUP_DEFAULT_PROPERTY_ID;
  const eventPropertyFilter = isDefaultProperty
    ? Prisma.empty
    : Prisma.sql`AND e."property_id" = ${propertyId}`;

  const [rawEventsRows, rawRejectionRows, rawPageViewsRows, rollupRows] =
    await Promise.all([
      prisma.$queryRaw<Array<RawEventsRow>>`
        SELECT
          DATE_TRUNC('day', e."timestamp")::date AS day,
          COUNT(*)::int AS raw_events_accepted
        FROM ${EVENTS_TABLE} e
        WHERE e."timestamp" >= ${from}
          AND e."timestamp" < ${toExclusive}
          ${eventPropertyFilter}
        GROUP BY DATE_TRUNC('day', e."timestamp")::date
      `,
      prisma.$queryRaw<Array<RawRejectionsRow>>`
        SELECT
          DATE_TRUNC('day', r."occurred_at")::date AS day,
          COUNT(*) FILTER (WHERE r."endpoint" = ${EVENT_INGEST_ENDPOINT})::int AS raw_events_rejected
        FROM ${INGEST_REJECTIONS_TABLE} r
        WHERE r."property_id" = ${propertyId}
          AND r."occurred_at" >= ${from}
          AND r."occurred_at" < ${toExclusive}
        GROUP BY DATE_TRUNC('day', r."occurred_at")::date
      `,
      prisma.$queryRaw<Array<RawPageViewsRow>>`
        SELECT
          DATE_TRUNC('day', e."timestamp")::date AS day,
          COUNT(*) FILTER (WHERE e."event_type" = 'page_view')::int AS raw_page_views
        FROM ${EVENTS_TABLE} e
        WHERE e."property_id" = ${propertyId}
          AND e."timestamp" >= ${from}
          AND e."timestamp" < ${toExclusive}
        GROUP BY DATE_TRUNC('day', e."timestamp")::date
      `,
      prisma.$queryRaw<Array<RollupRow>>`
        SELECT
          m."day"::date AS day,
          COALESCE(i."events_accepted", 0)::int AS rollup_events_accepted,
          COALESCE(i."events_rejected", 0)::int AS rollup_events_rejected,
          m."total_page_views"::int AS rollup_page_views
        FROM ${DAILY_METRIC_ROLLUPS_TABLE} m
        LEFT JOIN ${DAILY_INGEST_ROLLUPS_TABLE} i
          ON i."property_id" = m."property_id"
         AND i."day" = m."day"
        WHERE m."property_id" = ${propertyId}
          AND m."day" >= ${from}
          AND m."day" <= ${to}
      `,
    ]);

  const rawEventsByDay = new Map(
    rawEventsRows.map((row) => [
      toIsoDay(row.day),
      toInteger(row.raw_events_accepted),
    ]),
  );
  const rawRejectionsByDay = new Map(
    rawRejectionRows.map((row) => [
      toIsoDay(row.day),
      toInteger(row.raw_events_rejected),
    ]),
  );
  const rawPageViewsByDay = new Map(
    rawPageViewsRows.map((row) => [
      toIsoDay(row.day),
      toInteger(row.raw_page_views),
    ]),
  );
  const rollupsByDay = new Map(
    rollupRows.map((row) => [
      toIsoDay(row.day),
      {
        eventsAccepted: toInteger(row.rollup_events_accepted),
        eventsRejected: toInteger(row.rollup_events_rejected),
        pageViews: toInteger(row.rollup_page_views),
      },
    ]),
  );

  const mismatches: string[] = [];
  for (const day of buildDays(from, to)) {
    const rawEventsAccepted = rawEventsByDay.get(day) ?? 0;
    const rawEventsRejected = rawRejectionsByDay.get(day) ?? 0;
    const rawPageViews = rawPageViewsByDay.get(day) ?? 0;
    const rollup = rollupsByDay.get(day) ?? {
      eventsAccepted: 0,
      eventsRejected: 0,
      pageViews: 0,
    };

    if (rawEventsAccepted !== rollup.eventsAccepted) {
      mismatches.push(
        `${day} eventsAccepted raw=${rawEventsAccepted} rollup=${rollup.eventsAccepted}`,
      );
    }

    if (rawEventsRejected !== rollup.eventsRejected) {
      mismatches.push(
        `${day} eventsRejected raw=${rawEventsRejected} rollup=${rollup.eventsRejected}`,
      );
    }

    if (rawPageViews !== rollup.pageViews) {
      mismatches.push(
        `${day} totalPageViews raw=${rawPageViews} rollup=${rollup.pageViews}`,
      );
    }
  }

  console.log(
    `propertyId=${propertyId} window=${formatIsoDay(from)}..${formatIsoDay(to)} days=${buildDays(from, to).length}`,
  );

  if (mismatches.length === 0) {
    console.log("✅ No rollup discrepancies detected.");
    return;
  }

  console.log(`❌ Found ${mismatches.length} discrepancy(s):`);
  for (const mismatch of mismatches) {
    console.log(`- ${mismatch}`);
  }
  process.exitCode = 2;
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Rollup discrepancy check failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
