import type { PoolClient } from "pg";

import { env } from "../../config/env.js";
import { toBigInt, toInteger } from "../../lib/coerce.js";
import { query, sql } from "../../lib/db.js";
import { tableRef } from "../../lib/sql.js";
import { TrafficSource } from "../../lib/schema-enums.js";
import type { SummaryQuery } from "../../schemas/metrics.js";
import {
  addUtcDays,
  dayDiffInclusive,
  formatIsoDay,
  startOfUtcDay,
} from "../../schemas/metrics.js";
import {
  readMetricsMaterializedViewRows,
  checkMaterializedViewExists,
  type MaterializedSummaryRow,
} from "./materialized-view.js";
import { getRollupFreshness } from "./rollups.js";

const METRICS_ROLLUP_TABLE = tableRef("daily_metric_rollups");
const INGEST_ROLLUP_TABLE = tableRef("daily_ingest_rollups");

interface MetricValue {
  value: number;
  delta: number | null;
}

interface WindowRange {
  from: string;
  to: string;
}

interface TrendPoint {
  day: string;
  uniqueVisitors: number;
  pageViews: number;
  newLeads: number;
}

interface MetricRollupRow {
  day: Date;
  uniqueVisitors: number;
  returningVisitors: number;
  totalPageViews: number;
  totalEntrances: number;
  totalConversions: number;
  formStarts: number;
  formSubmits: number;
  newLeads: number;
  timeToFirstCaptureSumMs: bigint;
  timeToFirstCaptureCount: number;
  trafficSourceBreakdown: unknown;
}

interface IngestRollupRow {
  day: Date;
  eventsAccepted: number;
  eventsRejected: number;
  p95TtfbMs: number | null;
}

interface WindowAggregate {
  uniqueVisitors: number;
  returningVisitors: number;
  totalPageViews: number;
  totalEntrances: number;
  totalConversions: number;
  formStarts: number;
  formSubmits: number;
  newLeads: number;
  timeToFirstCaptureSumMs: bigint;
  timeToFirstCaptureCount: number;
  trafficSourceCounts: Record<string, number>;
  eventsAccepted: number;
  eventsRejected: number;
  p95TtfbMs: number | null;
}

export interface MetricsSummary {
  window: WindowRange;
  compareTo: WindowRange | null;
  freshness: {
    rolledUpThrough: string | null;
    lagDays: number | null;
    generatedAt: string | null;
  };
  metrics: {
    uniqueVisitors: MetricValue;
    returningVisitorsPct: MetricValue;
    totalPageViews: MetricValue;
    leadCaptureRate: MetricValue;
    formCompletionRate: MetricValue;
    landingPageConversionRate: MetricValue;
    avgTimeToFirstCaptureHrs: MetricValue;
    trafficSourceMix: Record<string, number>;
  };
  ingest: {
    successPct: number;
    p95TtfbMs: number | null;
    totalEventsAccepted: number;
    totalEventsRejected: number;
  };
  trend: TrendPoint[];
}

interface SummaryCacheEntry {
  expiresAtMs: number;
  value: MetricsSummary;
}

const summaryCache = new Map<string, SummaryCacheEntry>();

const TRAFFIC_SOURCE_KEYS: TrafficSource[] = [
  TrafficSource.direct,
  TrafficSource.organic_search,
  TrafficSource.paid_search,
  TrafficSource.social,
  TrafficSource.email,
  TrafficSource.referral,
  TrafficSource.campaign,
  TrafficSource.internal,
  TrafficSource.unknown,
];

const safeRatio = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

const toMetricValue = (
  value: number,
  baseline: number | null,
): MetricValue => ({
  value,
  delta:
    baseline === null || baseline === 0 ? null : (value - baseline) / baseline,
});

const toNumber = (value: bigint): number => Number(value);

const parseTrafficSourceCounts = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const counts: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "number") {
      continue;
    }
    counts[key] = entry;
  }

  return counts;
};

const aggregateWindow = (
  metricRows: MetricRollupRow[],
  ingestRows: IngestRollupRow[],
): WindowAggregate => {
  const metricTotals = metricRows.reduce<
    Omit<WindowAggregate, "eventsAccepted" | "eventsRejected" | "p95TtfbMs">
  >(
    (acc, row) => {
      const trafficCounts = parseTrafficSourceCounts(
        row.trafficSourceBreakdown,
      );
      for (const [key, count] of Object.entries(trafficCounts)) {
        acc.trafficSourceCounts[key] =
          (acc.trafficSourceCounts[key] ?? 0) + count;
      }

      return {
        uniqueVisitors: acc.uniqueVisitors + row.uniqueVisitors,
        returningVisitors: acc.returningVisitors + row.returningVisitors,
        totalPageViews: acc.totalPageViews + row.totalPageViews,
        totalEntrances: acc.totalEntrances + row.totalEntrances,
        totalConversions: acc.totalConversions + row.totalConversions,
        formStarts: acc.formStarts + row.formStarts,
        formSubmits: acc.formSubmits + row.formSubmits,
        newLeads: acc.newLeads + row.newLeads,
        timeToFirstCaptureSumMs:
          acc.timeToFirstCaptureSumMs + row.timeToFirstCaptureSumMs,
        timeToFirstCaptureCount:
          acc.timeToFirstCaptureCount + row.timeToFirstCaptureCount,
        trafficSourceCounts: acc.trafficSourceCounts,
      };
    },
    {
      uniqueVisitors: 0,
      returningVisitors: 0,
      totalPageViews: 0,
      totalEntrances: 0,
      totalConversions: 0,
      formStarts: 0,
      formSubmits: 0,
      newLeads: 0,
      timeToFirstCaptureSumMs: 0n,
      timeToFirstCaptureCount: 0,
      trafficSourceCounts: {},
    },
  );

  const ingestAccepted = ingestRows.reduce(
    (sum, row) => sum + row.eventsAccepted,
    0,
  );
  const ingestRejected = ingestRows.reduce(
    (sum, row) => sum + row.eventsRejected,
    0,
  );

  const latencyWeighted = ingestRows.reduce(
    (acc, row) => {
      if (row.p95TtfbMs === null || row.eventsAccepted <= 0) {
        return acc;
      }

      return {
        weightedSum: acc.weightedSum + row.p95TtfbMs * row.eventsAccepted,
        weight: acc.weight + row.eventsAccepted,
      };
    },
    {
      weightedSum: 0,
      weight: 0,
    },
  );

  const p95TtfbMs =
    latencyWeighted.weight > 0
      ? Math.round(latencyWeighted.weightedSum / latencyWeighted.weight)
      : null;

  return {
    ...metricTotals,
    eventsAccepted: ingestAccepted,
    eventsRejected: ingestRejected,
    p95TtfbMs,
  };
};

const buildTrend = (
  from: Date,
  to: Date,
  metricRows: MetricRollupRow[],
): TrendPoint[] => {
  const lookup = new Map<string, MetricRollupRow>(
    metricRows.map((row) => [formatIsoDay(row.day), row]),
  );

  const trend: TrendPoint[] = [];
  for (
    let cursor = startOfUtcDay(from);
    cursor.getTime() <= startOfUtcDay(to).getTime();
    cursor = addUtcDays(cursor, 1)
  ) {
    const day = formatIsoDay(cursor);
    const row = lookup.get(day);
    trend.push({
      day,
      uniqueVisitors: row?.uniqueVisitors ?? 0,
      pageViews: row?.totalPageViews ?? 0,
      newLeads: row?.newLeads ?? 0,
    });
  }

  return trend;
};

const toTrafficSourceMix = (
  trafficSourceCounts: Record<string, number>,
): Record<string, number> => {
  const total = Object.values(trafficSourceCounts).reduce(
    (sum, count) => sum + count,
    0,
  );

  const mix: Record<string, number> = {};
  for (const source of TRAFFIC_SOURCE_KEYS) {
    const count = trafficSourceCounts[source] ?? 0;
    mix[source] = safeRatio(count, total);
  }

  return mix;
};

const toMetricRowsFromView = (
  rows: MaterializedSummaryRow[],
): MetricRollupRow[] =>
  rows.map((row) => ({
    day: row.day,
    uniqueVisitors: toInteger(row.unique_visitors),
    returningVisitors: toInteger(row.returning_visitors),
    totalPageViews: toInteger(row.total_page_views),
    totalEntrances: toInteger(row.total_entrances),
    totalConversions: toInteger(row.total_conversions),
    formStarts: toInteger(row.form_starts),
    formSubmits: toInteger(row.form_submits),
    newLeads: toInteger(row.new_leads),
    timeToFirstCaptureSumMs: toBigInt(row.time_to_first_capture_sum_ms),
    timeToFirstCaptureCount: toInteger(row.time_to_first_capture_count),
    trafficSourceBreakdown: row.traffic_source_breakdown,
  }));

const fetchWindowRowsFromRollups = async (
  tx: PoolClient,
  tenantId: string,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<{
  metricRows: MetricRollupRow[];
  ingestRows: IngestRollupRow[];
}> => {
  const [{ rows: metricRows }, { rows: ingestRows }] = await Promise.all([
    query<MetricRollupRow>(
      tx,
      sql`
        SELECT
          "day",
          "unique_visitors" AS "uniqueVisitors",
          "returning_visitors" AS "returningVisitors",
          "total_page_views" AS "totalPageViews",
          "total_entrances" AS "totalEntrances",
          "total_conversions" AS "totalConversions",
          "form_starts" AS "formStarts",
          "form_submits" AS "formSubmits",
          "new_leads" AS "newLeads",
          "time_to_first_capture_sum_ms" AS "timeToFirstCaptureSumMs",
          "time_to_first_capture_count" AS "timeToFirstCaptureCount",
          "traffic_source_breakdown" AS "trafficSourceBreakdown"
        FROM ${METRICS_ROLLUP_TABLE}
        WHERE "tenant_id" = ${tenantId}
          AND "property_id" = ${propertyId}
          AND "day" >= ${from}
          AND "day" <= ${to}
        ORDER BY "day" ASC
      `,
    ),
    query<IngestRollupRow>(
      tx,
      sql`
        SELECT
          "day",
          "events_accepted" AS "eventsAccepted",
          "events_rejected" AS "eventsRejected",
          "p95_ttfb_ms" AS "p95TtfbMs"
        FROM ${INGEST_ROLLUP_TABLE}
        WHERE "tenant_id" = ${tenantId}
          AND "property_id" = ${propertyId}
          AND "day" >= ${from}
          AND "day" <= ${to}
        ORDER BY "day" ASC
      `,
    ),
  ]);

  return {
    metricRows: metricRows.map((row) => ({
      day: row.day,
      uniqueVisitors: toInteger(row.uniqueVisitors),
      returningVisitors: toInteger(row.returningVisitors),
      totalPageViews: toInteger(row.totalPageViews),
      totalEntrances: toInteger(row.totalEntrances),
      totalConversions: toInteger(row.totalConversions),
      formStarts: toInteger(row.formStarts),
      formSubmits: toInteger(row.formSubmits),
      newLeads: toInteger(row.newLeads),
      timeToFirstCaptureSumMs: toBigInt(row.timeToFirstCaptureSumMs),
      timeToFirstCaptureCount: toInteger(row.timeToFirstCaptureCount),
      trafficSourceBreakdown: row.trafficSourceBreakdown,
    })),
    ingestRows: ingestRows.map((row) => ({
      day: row.day,
      eventsAccepted: toInteger(row.eventsAccepted),
      eventsRejected: toInteger(row.eventsRejected),
      p95TtfbMs: row.p95TtfbMs === null ? null : toInteger(row.p95TtfbMs),
    })),
  };
};

const toIngestRowsFromView = (
  rows: MaterializedSummaryRow[],
): IngestRollupRow[] =>
  rows.map((row) => ({
    day: row.day,
    eventsAccepted: toInteger(row.events_accepted),
    eventsRejected: toInteger(row.events_rejected),
    p95TtfbMs: row.p95_ttfb_ms === null ? null : toInteger(row.p95_ttfb_ms),
  }));

const fetchWindowRows = async (
  tx: PoolClient,
  tenantId: string,
  propertyId: string,
  from: Date,
  to: Date,
): Promise<{
  metricRows: MetricRollupRow[];
  ingestRows: IngestRollupRow[];
}> => {
  if (!env.METRICS_USE_MATERIALIZED_VIEW) {
    return fetchWindowRowsFromRollups(tx, tenantId, propertyId, from, to);
  }

  const viewExists = await checkMaterializedViewExists(tx);
  if (!viewExists) {
    return fetchWindowRowsFromRollups(tx, tenantId, propertyId, from, to);
  }

  const rows = await readMetricsMaterializedViewRows(
    tx,
    tenantId,
    propertyId,
    from,
    to,
  );
  return {
    metricRows: toMetricRowsFromView(rows),
    ingestRows: toIngestRowsFromView(rows),
  };
};

const isSummaryCacheEnabled = (): boolean =>
  env.METRICS_SUMMARY_CACHE_TTL_MS > 0 &&
  env.METRICS_SUMMARY_CACHE_MAX_ENTRIES > 0;

const buildSummaryCacheKey = (query: SummaryQuery): string =>
  [
    query.propertyId,
    formatIsoDay(query.from),
    formatIsoDay(query.to),
    query.compareTo ? "1" : "0",
    env.METRICS_USE_MATERIALIZED_VIEW ? "mv" : "table",
  ].join("|");

const cloneSummary = (value: MetricsSummary): MetricsSummary =>
  structuredClone(value);

const readSummaryCache = (key: string): MetricsSummary | null => {
  if (!isSummaryCacheEnabled()) {
    return null;
  }

  const entry = summaryCache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= Date.now()) {
    summaryCache.delete(key);
    return null;
  }

  // Reinsert on read to keep recent keys near the tail (simple LRU behavior).
  summaryCache.delete(key);
  summaryCache.set(key, entry);
  return cloneSummary(entry.value);
};

const writeSummaryCache = (key: string, value: MetricsSummary): void => {
  if (!isSummaryCacheEnabled()) {
    return;
  }

  const expiresAtMs = Date.now() + env.METRICS_SUMMARY_CACHE_TTL_MS;
  if (
    summaryCache.size >= env.METRICS_SUMMARY_CACHE_MAX_ENTRIES &&
    !summaryCache.has(key)
  ) {
    const oldestKey = summaryCache.keys().next().value;
    if (oldestKey !== undefined) {
      summaryCache.delete(oldestKey);
    }
  }

  summaryCache.set(key, {
    expiresAtMs,
    value: cloneSummary(value),
  });
};

export const fetchMetricsSummary = async (
  tx: PoolClient,
  tenantId: string,
  query: SummaryQuery,
): Promise<MetricsSummary> => {
  const cacheKey = buildSummaryCacheKey(query);
  const cached = readSummaryCache(cacheKey);
  if (cached) {
    return cached;
  }

  const propertyId = query.propertyId;
  const windowFrom = startOfUtcDay(query.from);
  const windowTo = startOfUtcDay(query.to);

  const compareDayCount = dayDiffInclusive(windowFrom, windowTo);
  const compareFrom = addUtcDays(windowFrom, -compareDayCount);
  const compareTo = addUtcDays(windowFrom, -1);

  const [currentRows, freshness, compareRows] = await Promise.all([
    fetchWindowRows(tx, tenantId, propertyId, windowFrom, windowTo),
    getRollupFreshness(tx, tenantId, propertyId),
    query.compareTo
      ? fetchWindowRows(tx, tenantId, propertyId, compareFrom, compareTo)
      : Promise.resolve({
          metricRows: [],
          ingestRows: [],
        }),
  ]);

  const current = aggregateWindow(
    currentRows.metricRows,
    currentRows.ingestRows,
  );
  const comparison = query.compareTo
    ? aggregateWindow(compareRows.metricRows, compareRows.ingestRows)
    : null;

  const currentReturningVisitorsPct = safeRatio(
    current.returningVisitors,
    current.uniqueVisitors,
  );
  const compareReturningVisitorsPct = comparison
    ? safeRatio(comparison.returningVisitors, comparison.uniqueVisitors)
    : null;

  const currentLeadCaptureRate = safeRatio(
    current.newLeads,
    current.uniqueVisitors,
  );
  const compareLeadCaptureRate = comparison
    ? safeRatio(comparison.newLeads, comparison.uniqueVisitors)
    : null;

  const currentFormCompletionRate = safeRatio(
    current.formSubmits,
    current.formStarts,
  );
  const compareFormCompletionRate = comparison
    ? safeRatio(comparison.formSubmits, comparison.formStarts)
    : null;

  const currentLandingConversionRate = safeRatio(
    current.totalConversions,
    current.totalEntrances,
  );
  const compareLandingConversionRate = comparison
    ? safeRatio(comparison.totalConversions, comparison.totalEntrances)
    : null;

  const currentAvgTimeToFirstCaptureHrs =
    safeRatio(
      toNumber(current.timeToFirstCaptureSumMs),
      current.timeToFirstCaptureCount,
    ) /
    (60 * 60 * 1000);
  const compareAvgTimeToFirstCaptureHrs = comparison
    ? safeRatio(
        toNumber(comparison.timeToFirstCaptureSumMs),
        comparison.timeToFirstCaptureCount,
      ) /
      (60 * 60 * 1000)
    : null;

  const trend = buildTrend(windowFrom, windowTo, currentRows.metricRows);

  const summary: MetricsSummary = {
    window: {
      from: formatIsoDay(windowFrom),
      to: formatIsoDay(windowTo),
    },
    compareTo: query.compareTo
      ? {
          from: formatIsoDay(compareFrom),
          to: formatIsoDay(compareTo),
        }
      : null,
    freshness,
    metrics: {
      uniqueVisitors: toMetricValue(
        current.uniqueVisitors,
        comparison?.uniqueVisitors ?? null,
      ),
      returningVisitorsPct: toMetricValue(
        currentReturningVisitorsPct,
        compareReturningVisitorsPct,
      ),
      totalPageViews: toMetricValue(
        current.totalPageViews,
        comparison?.totalPageViews ?? null,
      ),
      leadCaptureRate: toMetricValue(
        currentLeadCaptureRate,
        compareLeadCaptureRate,
      ),
      formCompletionRate: toMetricValue(
        currentFormCompletionRate,
        compareFormCompletionRate,
      ),
      landingPageConversionRate: toMetricValue(
        currentLandingConversionRate,
        compareLandingConversionRate,
      ),
      avgTimeToFirstCaptureHrs: toMetricValue(
        currentAvgTimeToFirstCaptureHrs,
        compareAvgTimeToFirstCaptureHrs,
      ),
      trafficSourceMix: toTrafficSourceMix(current.trafficSourceCounts),
    },
    ingest: {
      successPct: safeRatio(
        current.eventsAccepted,
        current.eventsAccepted + current.eventsRejected,
      ),
      p95TtfbMs: current.p95TtfbMs,
      totalEventsAccepted: current.eventsAccepted,
      totalEventsRejected: current.eventsRejected,
    },
    trend,
  };

  writeSummaryCache(cacheKey, summary);
  return summary;
};
