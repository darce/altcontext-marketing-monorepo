import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { LinkSource, Prisma } from "@prisma/client";

import { prisma } from "../../src/lib/prisma.js";
import { closeDatabase, resetDatabase } from "../helpers/db.js";

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

test("migration tables exist in the active schema", async () => {
  const configuredSchema = (() => {
    const datasourceUrl = process.env.DATABASE_URL;
    if (!datasourceUrl) {
      return undefined;
    }

    try {
      const parsed = new URL(datasourceUrl);
      const schema = parsed.searchParams.get("schema")?.trim();
      return schema && schema.length > 0 ? schema : undefined;
    } catch {
      return undefined;
    }
  })();

  const resolvedSchema =
    configuredSchema ??
    (
      await prisma.$queryRaw<Array<{ schema_name: string }>>`
        SELECT current_schema() AS schema_name
      `
    )[0]?.schema_name ??
    "public";

  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ${resolvedSchema}
  `;
  const tableNames = new Set(tables.map((entry) => entry.table_name));

  for (const expected of [
    "_prisma_migrations",
    "visitors",
    "sessions",
    "events",
    "ingest_rejections",
    "leads",
    "lead_identities",
    "form_submissions",
    "consent_events",
    "daily_metric_rollups",
    "daily_ingest_rollups",
  ]) {
    assert.equal(
      tableNames.has(expected),
      true,
      `missing table in schema: ${expected}`,
    );
  }
});

test("leads.email_normalized enforces uniqueness", async () => {
  await prisma.lead.create({
    data: {
      emailNormalized: "unique@example.com",
    },
  });

  await assert.rejects(
    prisma.lead.create({
      data: {
        emailNormalized: "unique@example.com",
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
  );
});

test("visitors.anon_id enforces uniqueness", async () => {
  await prisma.visitor.create({
    data: {
      anonId: "anon-unique-visitor",
    },
  });

  await assert.rejects(
    prisma.visitor.create({
      data: {
        anonId: "anon-unique-visitor",
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
  );
});

test("lead_identities composite key enforces uniqueness", async () => {
  const lead = await prisma.lead.create({
    data: {
      emailNormalized: "identity@example.com",
    },
    select: { id: true },
  });
  const visitor = await prisma.visitor.create({
    data: {
      anonId: "anon-identity-001",
    },
    select: { id: true },
  });

  await prisma.leadIdentity.create({
    data: {
      leadId: lead.id,
      visitorId: visitor.id,
      linkSource: LinkSource.form_submit,
      confidence: 1,
    },
  });

  await assert.rejects(
    prisma.leadIdentity.create({
      data: {
        leadId: lead.id,
        visitorId: visitor.id,
        linkSource: LinkSource.form_submit,
        confidence: 0.4,
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
  );
});

test("events.dedupe_key enforces uniqueness when populated", async () => {
  const visitor = await prisma.visitor.create({
    data: {
      anonId: "anon-dedupe-visitor-001",
    },
    select: { id: true },
  });
  const session = await prisma.session.create({
    data: {
      visitorId: visitor.id,
      startedAt: new Date("2026-02-14T00:00:00.000Z"),
      lastEventAt: new Date("2026-02-14T00:00:00.000Z"),
    },
    select: { id: true },
  });

  await prisma.event.create({
    data: {
      visitorId: visitor.id,
      sessionId: session.id,
      dedupeKey:
        "beecf3f3f96d96f581af596f4f8fc4a000ea5d0302fb05501858be3349f7ebf7",
      eventType: "page_view",
      path: "/",
      timestamp: new Date("2026-02-14T00:00:00.000Z"),
    },
  });

  await assert.rejects(
    prisma.event.create({
      data: {
        visitorId: visitor.id,
        sessionId: session.id,
        dedupeKey:
          "beecf3f3f96d96f581af596f4f8fc4a000ea5d0302fb05501858be3349f7ebf7",
        eventType: "page_view",
        path: "/",
        timestamp: new Date("2026-02-14T00:00:01.000Z"),
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
  );
});
