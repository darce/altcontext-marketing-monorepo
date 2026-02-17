import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { env } from "../../src/config/env.js";
import { pool, withOwnerRole } from "../../src/lib/db.js";
import { prisma } from "../helpers/prisma.js";
import { rollupDateRange } from "../../src/services/metrics/rollups.js";
import { closeDatabase, resetDatabase, TEST_TENANT_ID } from "../helpers/db.js";

const PROPERTY_ID = env.ROLLUP_DEFAULT_PROPERTY_ID;

const createBaseTraffic = async (day: string): Promise<void> => {
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayMid = new Date(`${day}T12:00:00.000Z`);
  const previousDay = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);

  const visitorOne = await prisma.visitor.create({
    data: {
      tenantId: TEST_TENANT_ID,
      anonId: `anon-rollup-1-${day}`,
      firstSeenAt: previousDay,
      lastSeenAt: dayMid,
    },
  });

  const visitorTwo = await prisma.visitor.create({
    data: {
      tenantId: TEST_TENANT_ID,
      anonId: `anon-rollup-2-${day}`,
      firstSeenAt: dayStart,
      lastSeenAt: dayMid,
    },
  });

  const sessionOne = await prisma.session.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitorOne.id,
      startedAt: dayStart,
      lastEventAt: dayMid,
      endedAt: dayMid,
      landingPath: "/pricing",
    },
  });

  const sessionTwo = await prisma.session.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitorTwo.id,
      startedAt: dayStart,
      lastEventAt: dayMid,
      endedAt: dayMid,
      landingPath: "/",
    },
  });

  await prisma.event.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitorOne.id,
      sessionId: sessionOne.id,
      eventType: "page_view",
      path: "/pricing",
      timestamp: dayStart,
      propertyId: PROPERTY_ID,
      trafficSource: "organic_search",
      isEntrance: true,
      isConversion: true,
    },
  });

  await prisma.event.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitorOne.id,
      sessionId: sessionOne.id,
      eventType: "form_start",
      path: "/pricing",
      timestamp: dayMid,
      propertyId: PROPERTY_ID,
    },
  });

  await prisma.event.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitorOne.id,
      sessionId: sessionOne.id,
      eventType: "form_submit",
      path: "/pricing",
      timestamp: dayMid,
      propertyId: PROPERTY_ID,
    },
  });

  await prisma.event.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitorTwo.id,
      sessionId: sessionTwo.id,
      eventType: "page_view",
      path: "/",
      timestamp: dayMid,
      propertyId: PROPERTY_ID,
      trafficSource: "direct",
      isEntrance: true,
      isConversion: false,
    },
  });

  const lead = await prisma.lead.create({
    data: {
      tenantId: TEST_TENANT_ID,
      emailNormalized: `rollup-${day}@example.com`,
      firstCapturedAt: dayMid,
      lastCapturedAt: dayMid,
      sourceChannel: "website",
    },
  });

  await prisma.leadIdentity.create({
    data: {
      tenantId: TEST_TENANT_ID,
      leadId: lead.id,
      visitorId: visitorOne.id,
      linkSource: "form_submit",
      confidence: 1,
      linkedAt: dayMid,
    },
  });

  await prisma.formSubmission.create({
    data: {
      tenantId: TEST_TENANT_ID,
      leadId: lead.id,
      visitorId: visitorOne.id,
      sessionId: sessionOne.id,
      formName: "newsletter_signup",
      submittedAt: dayMid,
      validationStatus: "accepted",
    },
  });
};

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
  await pool.end();
});

test("rollupDateRange upserts daily rows idempotently", async () => {
  const day = "2026-01-20";
  await createBaseTraffic(day);

  const range = {
    tenantId: TEST_TENANT_ID,
    from: new Date(`${day}T00:00:00.000Z`),
    to: new Date(`${day}T00:00:00.000Z`),
    propertyId: PROPERTY_ID,
    batchSize: 2,
  };

  await withOwnerRole(async (client) => {
    await rollupDateRange(client, range);
  });

  const firstMetric = await prisma.dailyMetricRollup.findUnique({
    where: {
      tenantId_propertyId_day: {
        tenantId: TEST_TENANT_ID,
        propertyId: PROPERTY_ID,
        day: range.from,
      },
    },
  });
  assert.ok(firstMetric);
  assert.equal(firstMetric.uniqueVisitors, 2);
  assert.equal(firstMetric.totalPageViews, 2);
  assert.equal(firstMetric.formStarts, 1);
  assert.equal(firstMetric.formSubmits, 1);
  assert.equal(firstMetric.newLeads, 1);

  const metricCountAfterFirstRun = await prisma.dailyMetricRollup.count({
    where: { tenantId: TEST_TENANT_ID, propertyId: PROPERTY_ID },
  });
  assert.equal(metricCountAfterFirstRun, 1);

  await withOwnerRole(async (client2) => {
    await rollupDateRange(client2, range);
  });

  const metricCountAfterSecondRun = await prisma.dailyMetricRollup.count({
    where: { tenantId: TEST_TENANT_ID, propertyId: PROPERTY_ID },
  });
  assert.equal(metricCountAfterSecondRun, 1);

  const ingestCount = await prisma.dailyIngestRollup.count({
    where: { tenantId: TEST_TENANT_ID, propertyId: PROPERTY_ID },
  });
  assert.equal(ingestCount, 1);
});

test("rollupDateRange recomputes updated values for an existing day", async () => {
  const day = "2026-01-21";
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  await createBaseTraffic(day);

  await withOwnerRole(async (client) => {
    await rollupDateRange(client, {
      tenantId: TEST_TENANT_ID,
      from: dayDate,
      to: dayDate,
      propertyId: PROPERTY_ID,
      batchSize: 1,
    });
  });

  const before = await prisma.dailyMetricRollup.findUnique({
    where: {
      tenantId_propertyId_day: {
        tenantId: TEST_TENANT_ID,
        propertyId: PROPERTY_ID,
        day: dayDate,
      },
    },
    select: {
      totalPageViews: true,
    },
  });
  assert.ok(before);

  const visitor = await prisma.visitor.create({
    data: {
      tenantId: TEST_TENANT_ID,
      anonId: `anon-rollup-extra-${day}`,
      firstSeenAt: dayDate,
      lastSeenAt: dayDate,
    },
  });
  const session = await prisma.session.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitor.id,
      startedAt: dayDate,
      lastEventAt: dayDate,
      endedAt: dayDate,
      landingPath: "/blog",
    },
  });
  await prisma.event.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitor.id,
      sessionId: session.id,
      eventType: "page_view",
      path: "/blog",
      timestamp: dayDate,
      propertyId: PROPERTY_ID,
      trafficSource: "referral",
      isEntrance: true,
    },
  });

  await withOwnerRole(async (client2) => {
    await rollupDateRange(client2, {
      tenantId: TEST_TENANT_ID,
      from: dayDate,
      to: dayDate,
      propertyId: PROPERTY_ID,
      batchSize: 1,
    });
  });

  const afterMetric = await prisma.dailyMetricRollup.findUnique({
    where: {
      tenantId_propertyId_day: {
        tenantId: TEST_TENANT_ID,
        propertyId: PROPERTY_ID,
        day: dayDate,
      },
    },
    select: {
      totalPageViews: true,
      uniqueVisitors: true,
    },
  });
  assert.ok(afterMetric);

  assert.equal(afterMetric.totalPageViews > before.totalPageViews, true);
  assert.equal(afterMetric.uniqueVisitors, 3);
});

test("rollupDateRange handles multi-day windows deterministically", async () => {
  await createBaseTraffic("2026-01-22");
  await createBaseTraffic("2026-01-23");

  let result;
  await withOwnerRole(async (client) => {
    result = await rollupDateRange(client, {
      tenantId: TEST_TENANT_ID,
      from: new Date("2026-01-22T00:00:00.000Z"),
      to: new Date("2026-01-23T00:00:00.000Z"),
      propertyId: PROPERTY_ID,
      batchSize: 2,
    });
  });

  assert.equal(result.dayCount, 2);
  assert.deepEqual(result.rolledUpDays, ["2026-01-22", "2026-01-23"]);

  const rows = await prisma.dailyMetricRollup.findMany({
    where: { tenantId: TEST_TENANT_ID, propertyId: PROPERTY_ID },
    orderBy: { day: "asc" },
    select: { day: true, uniqueVisitors: true },
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.day.toISOString().slice(0, 10)),
    ["2026-01-22", "2026-01-23"],
  );
  assert.deepEqual(
    rows.map((row) => row.uniqueVisitors),
    [2, 2],
  );
});

test("rollupDateRange respects UTC day boundaries", async () => {
  const occurredAtOne = new Date("2026-01-24T23:59:59.999Z");
  const occurredAtTwo = new Date("2026-01-25T00:00:00.000Z");

  const createBoundaryEvent = async (
    anonId: string,
    occurredAt: Date,
    path: string,
  ): Promise<void> => {
    const visitor = await prisma.visitor.create({
      data: {
        tenantId: TEST_TENANT_ID,
        anonId,
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
      },
    });
    const session = await prisma.session.create({
      data: {
        tenantId: TEST_TENANT_ID,
        visitorId: visitor.id,
        startedAt: occurredAt,
        lastEventAt: occurredAt,
        endedAt: occurredAt,
        landingPath: path,
      },
    });
    await prisma.event.create({
      data: {
        tenantId: TEST_TENANT_ID,
        visitorId: visitor.id,
        sessionId: session.id,
        eventType: "page_view",
        path,
        timestamp: occurredAt,
        propertyId: PROPERTY_ID,
        trafficSource: "direct",
        isEntrance: true,
      },
    });
  };

  await createBoundaryEvent("anon-boundary-1", occurredAtOne, "/late");
  await createBoundaryEvent("anon-boundary-2", occurredAtTwo, "/early");

  await withOwnerRole(async (client) => {
    await rollupDateRange(client, {
      tenantId: TEST_TENANT_ID,
      from: new Date("2026-01-24T00:00:00.000Z"),
      to: new Date("2026-01-25T00:00:00.000Z"),
      propertyId: PROPERTY_ID,
      batchSize: 2,
    });
  });

  const rows = await prisma.dailyMetricRollup.findMany({
    where: {
      tenantId: TEST_TENANT_ID,
      propertyId: PROPERTY_ID,
      day: {
        gte: new Date("2026-01-24T00:00:00.000Z"),
        lte: new Date("2026-01-25T00:00:00.000Z"),
      },
    },
    orderBy: { day: "asc" },
    select: {
      day: true,
      uniqueVisitors: true,
      totalPageViews: true,
    },
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.day.toISOString().slice(0, 10)),
    ["2026-01-24", "2026-01-25"],
  );
  assert.deepEqual(
    rows.map((row) => row.uniqueVisitors),
    [1, 1],
  );
  assert.deepEqual(
    rows.map((row) => row.totalPageViews),
    [1, 1],
  );
});
