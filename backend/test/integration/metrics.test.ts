import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { performance } from "node:perf_hooks";

import type { FastifyInstance } from "fastify";

import { createApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { prisma } from "../helpers/prisma.js";
import { closeDatabase, resetDatabase } from "../helpers/db.js";

const TEST_ADMIN_KEY = "0123456789abcdef01234567";
const originalAdminKey = env.ADMIN_API_KEY;
const originalCacheTtlMs = env.METRICS_SUMMARY_CACHE_TTL_MS;
const originalCacheMaxEntries = env.METRICS_SUMMARY_CACHE_MAX_ENTRIES;
const originalUseMaterializedView = env.METRICS_USE_MATERIALIZED_VIEW;

let app: FastifyInstance;

const seedRollups = async (): Promise<void> => {
  const propertyId = env.ROLLUP_DEFAULT_PROPERTY_ID;

  const currentDays = ["2026-01-10", "2026-01-11", "2026-01-12"];
  const compareDays = ["2026-01-07", "2026-01-08", "2026-01-09"];

  const rows = [
    ...currentDays.map((day, index) => ({
      day,
      uniqueVisitors: [100, 120, 80][index] ?? 0,
      returningVisitors: [30, 40, 28][index] ?? 0,
      totalPageViews: [300, 360, 280][index] ?? 0,
      totalEntrances: [80, 100, 70][index] ?? 0,
      totalConversions: [8, 9, 7][index] ?? 0,
      formStarts: [20, 30, 20][index] ?? 0,
      formSubmits: [10, 12, 8][index] ?? 0,
      newLeads: [4, 5, 3][index] ?? 0,
      timeToFirstCaptureSumMs: [36_000_000, 40_000_000, 26_000_000][index] ?? 0,
      timeToFirstCaptureCount: [4, 5, 3][index] ?? 0,
      trafficSourceBreakdown: {
        direct: 60,
        organic_search: 25,
        social: 10,
        referral: 5,
      },
    })),
    ...compareDays.map((day, index) => ({
      day,
      uniqueVisitors: [50, 55, 45][index] ?? 0,
      returningVisitors: [10, 11, 9][index] ?? 0,
      totalPageViews: [140, 155, 130][index] ?? 0,
      totalEntrances: [35, 38, 30][index] ?? 0,
      totalConversions: [2, 3, 2][index] ?? 0,
      formStarts: [10, 10, 8][index] ?? 0,
      formSubmits: [4, 5, 3][index] ?? 0,
      newLeads: [1, 2, 1][index] ?? 0,
      timeToFirstCaptureSumMs: [15_000_000, 16_000_000, 12_000_000][index] ?? 0,
      timeToFirstCaptureCount: [1, 2, 1][index] ?? 0,
      trafficSourceBreakdown: {
        direct: 30,
        organic_search: 14,
        social: 4,
        referral: 2,
      },
    })),
  ];

  await Promise.all(
    rows.map(async (row) => {
      const day = new Date(`${row.day}T00:00:00.000Z`);
      await prisma.dailyMetricRollup.create({
        data: {
          propertyId,
          day,
          uniqueVisitors: row.uniqueVisitors,
          returningVisitors: row.returningVisitors,
          totalPageViews: row.totalPageViews,
          totalEntrances: row.totalEntrances,
          totalConversions: row.totalConversions,
          formStarts: row.formStarts,
          formSubmits: row.formSubmits,
          newLeads: row.newLeads,
          timeToFirstCaptureSumMs: BigInt(row.timeToFirstCaptureSumMs),
          timeToFirstCaptureCount: row.timeToFirstCaptureCount,
          trafficSourceBreakdown: row.trafficSourceBreakdown,
          topLandingPaths: [
            {
              path: "/pricing",
              entrances: row.totalEntrances,
              conversions: row.totalConversions,
            },
          ],
        },
      });

      await prisma.dailyIngestRollup.create({
        data: {
          propertyId,
          day,
          eventsAccepted: row.totalPageViews,
          eventsRejected: row.day.startsWith("2026-01-1") ? 1 : 0,
          leadsAccepted: row.formSubmits,
          leadsRejected: row.day.startsWith("2026-01-1") ? 0 : 1,
          p95TtfbMs: row.day.startsWith("2026-01-1") ? 42 : 55,
          errorBreakdown: {
            eventsRejected: row.day.startsWith("2026-01-1") ? 1 : 0,
            leadsRejected: row.day.startsWith("2026-01-1") ? 0 : 1,
          },
        },
      });
    }),
  );
};

const seedSequentialRollups = async (
  startDayIso: string,
  dayCount: number,
): Promise<void> => {
  const propertyId = env.ROLLUP_DEFAULT_PROPERTY_ID;
  const start = new Date(`${startDayIso}T00:00:00.000Z`);

  const metricRows = Array.from({ length: dayCount }, (_unused, index) => {
    const day = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
    return {
      propertyId,
      day,
      uniqueVisitors: 100 + index,
      returningVisitors: 40 + Math.floor(index / 2),
      totalPageViews: 300 + index * 2,
      totalEntrances: 120 + index,
      totalExits: 80 + index,
      totalConversions: 12 + Math.floor(index / 3),
      formStarts: 24 + Math.floor(index / 2),
      formSubmits: 10 + Math.floor(index / 4),
      newLeads: 4 + Math.floor(index / 5),
      timeToFirstCaptureSumMs: BigInt((20 + index) * 60 * 60 * 1000),
      timeToFirstCaptureCount: 4 + Math.floor(index / 5),
      trafficSourceBreakdown: {
        direct: 60,
        organic_search: 25,
        social: 10,
        referral: 5,
      },
      topLandingPaths: [
        {
          path: "/pricing",
          entrances: 40 + index,
          conversions: 4 + Math.floor(index / 4),
        },
      ],
    };
  });

  const ingestRows = metricRows.map((row, index) => ({
    propertyId: row.propertyId,
    day: row.day,
    eventsAccepted: row.totalPageViews,
    eventsRejected: index % 3 === 0 ? 1 : 0,
    leadsAccepted: row.formSubmits,
    leadsRejected: index % 7 === 0 ? 1 : 0,
    p95TtfbMs: 35 + (index % 10),
    errorBreakdown: {
      eventsRejected: index % 3 === 0 ? 1 : 0,
      leadsRejected: index % 7 === 0 ? 1 : 0,
    },
  }));

  await prisma.dailyMetricRollup.createMany({
    data: metricRows,
  });
  await prisma.dailyIngestRollup.createMany({
    data: ingestRows,
  });
};

before(async () => {
  app = await createApp();
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  env.ADMIN_API_KEY = TEST_ADMIN_KEY;
  env.METRICS_SUMMARY_CACHE_TTL_MS = originalCacheTtlMs;
  env.METRICS_SUMMARY_CACHE_MAX_ENTRIES = originalCacheMaxEntries;
  env.METRICS_USE_MATERIALIZED_VIEW = originalUseMaterializedView;
});

after(async () => {
  env.ADMIN_API_KEY = originalAdminKey;
  env.METRICS_SUMMARY_CACHE_TTL_MS = originalCacheTtlMs;
  env.METRICS_SUMMARY_CACHE_MAX_ENTRIES = originalCacheMaxEntries;
  env.METRICS_USE_MATERIALIZED_VIEW = originalUseMaterializedView;
  await app.close();
  await closeDatabase();
});

test("GET /v1/metrics/summary rejects missing or invalid admin key", async () => {
  const noKey = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12",
  });
  assert.equal(noKey.statusCode, 401);

  const wrongKey = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12",
    headers: {
      "x-admin-key": "wrong-admin-key",
    },
  });
  assert.equal(wrongKey.statusCode, 401);
});

test("GET /v1/metrics/summary returns 503 when admin auth is not configured", async () => {
  env.ADMIN_API_KEY = undefined;

  const response = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12",
  });

  assert.equal(response.statusCode, 503);
  assert.equal(
    response.json<{ ok: boolean; error: string }>().error,
    "admin_auth_not_configured",
  );
});

test("GET /v1/metrics/summary returns dashboard-ready summary with comparison deltas", async () => {
  await seedRollups();

  const response = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12&compareTo=true",
    headers: {
      "x-admin-key": TEST_ADMIN_KEY,
    },
  });

  assert.equal(response.statusCode, 200);

  const body = response.json<{
    ok: boolean;
    window: { from: string; to: string };
    compareTo: { from: string; to: string } | null;
    freshness: {
      rolledUpThrough: string | null;
      lagDays: number | null;
      generatedAt: string | null;
    };
    metrics: {
      uniqueVisitors: { value: number; delta: number | null };
      leadCaptureRate: { value: number; delta: number | null };
      trafficSourceMix: Record<string, number>;
    };
    ingest: {
      successPct: number;
      p95TtfbMs: number | null;
      totalEventsAccepted: number;
      totalEventsRejected: number;
    };
    trend: Array<{
      day: string;
      uniqueVisitors: number;
      pageViews: number;
      newLeads: number;
    }>;
  }>();

  assert.equal(body.ok, true);
  assert.deepEqual(body.window, {
    from: "2026-01-10",
    to: "2026-01-12",
  });
  assert.deepEqual(body.compareTo, {
    from: "2026-01-07",
    to: "2026-01-09",
  });

  assert.equal(body.metrics.uniqueVisitors.value, 300);
  assert.notEqual(body.metrics.uniqueVisitors.delta, null);
  assert.equal(body.metrics.leadCaptureRate.value > 0, true);
  assert.equal(body.ingest.totalEventsAccepted > 0, true);
  assert.equal(body.ingest.totalEventsRejected > 0, true);
  assert.equal(body.ingest.p95TtfbMs, 42);

  assert.equal(body.trend.length, 3);
  assert.deepEqual(body.trend[0], {
    day: "2026-01-10",
    uniqueVisitors: 100,
    pageViews: 300,
    newLeads: 4,
  });

  assert.equal(typeof body.metrics.trafficSourceMix.direct, "number");
  assert.equal(body.metrics.trafficSourceMix.direct > 0, true);

  assert.equal(body.freshness.rolledUpThrough, "2026-01-12");
  assert.equal(body.freshness.generatedAt !== null, true);
});

test("GET /v1/metrics/summary returns zeroed metrics for empty windows", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-04-01&to=2026-04-03",
    headers: {
      "x-admin-key": TEST_ADMIN_KEY,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json<{
    ok: boolean;
    compareTo: { from: string; to: string } | null;
    metrics: {
      uniqueVisitors: { value: number; delta: number | null };
    };
    trend: Array<{
      day: string;
      uniqueVisitors: number;
      pageViews: number;
      newLeads: number;
    }>;
  }>();

  assert.equal(body.ok, true);
  assert.equal(body.compareTo, null);
  assert.equal(body.metrics.uniqueVisitors.value, 0);
  assert.equal(body.metrics.uniqueVisitors.delta, null);
  assert.equal(body.trend.length, 3);
  assert.deepEqual(body.trend[0], {
    day: "2026-04-01",
    uniqueVisitors: 0,
    pageViews: 0,
    newLeads: 0,
  });
});

test("GET /v1/metrics/summary meets 30-day latency smoke budget", async () => {
  await seedSequentialRollups("2026-03-01", 30);

  const startedAt = performance.now();
  const response = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-03-01&to=2026-03-30",
    headers: {
      "x-admin-key": TEST_ADMIN_KEY,
    },
  });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(response.statusCode, 200);
  assert.equal(elapsedMs < 8000, true);

  const body = response.json<{
    ok: boolean;
    trend: Array<{ day: string }>;
  }>();
  assert.equal(body.ok, true);
  assert.equal(body.trend.length, 30);
});

test("GET /v1/metrics/summary uses cache for hot windows when enabled", async () => {
  await seedRollups();

  env.METRICS_SUMMARY_CACHE_TTL_MS = 60_000;
  env.METRICS_SUMMARY_CACHE_MAX_ENTRIES = 64;

  const firstResponse = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12",
    headers: {
      "x-admin-key": TEST_ADMIN_KEY,
    },
  });
  assert.equal(firstResponse.statusCode, 200);
  const firstBody = firstResponse.json<{
    ok: boolean;
    metrics: { uniqueVisitors: { value: number } };
  }>();
  assert.equal(firstBody.ok, true);

  await prisma.dailyMetricRollup.update({
    where: {
      propertyId_day: {
        propertyId: env.ROLLUP_DEFAULT_PROPERTY_ID,
        day: new Date("2026-01-10T00:00:00.000Z"),
      },
    },
    data: {
      uniqueVisitors: 999,
    },
  });

  const cachedResponse = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12",
    headers: {
      "x-admin-key": TEST_ADMIN_KEY,
    },
  });
  assert.equal(cachedResponse.statusCode, 200);
  const cachedBody = cachedResponse.json<{
    metrics: { uniqueVisitors: { value: number } };
  }>();
  assert.equal(
    cachedBody.metrics.uniqueVisitors.value,
    firstBody.metrics.uniqueVisitors.value,
  );

  env.METRICS_SUMMARY_CACHE_TTL_MS = 0;
  const uncachedResponse = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12",
    headers: {
      "x-admin-key": TEST_ADMIN_KEY,
    },
  });
  assert.equal(uncachedResponse.statusCode, 200);
  const uncachedBody = uncachedResponse.json<{
    metrics: { uniqueVisitors: { value: number } };
  }>();
  assert.notEqual(
    uncachedBody.metrics.uniqueVisitors.value,
    firstBody.metrics.uniqueVisitors.value,
  );
});

test("GET /v1/metrics/summary falls back to rollup tables when materialized view is missing", async () => {
  await seedRollups();
  env.METRICS_USE_MATERIALIZED_VIEW = true;
  env.METRICS_SUMMARY_CACHE_TTL_MS = 0;

  const response = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-01-10&to=2026-01-12",
    headers: {
      "x-admin-key": TEST_ADMIN_KEY,
    },
  });

  assert.equal(response.statusCode, 200);
  const body = response.json<{
    ok: boolean;
    metrics: { uniqueVisitors: { value: number } };
  }>();
  assert.equal(body.ok, true);
  assert.equal(body.metrics.uniqueVisitors.value, 300);
});
