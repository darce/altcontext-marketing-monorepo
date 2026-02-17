import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { LinkSource, Prisma } from "@prisma/client";

import { prisma } from "../helpers/prisma.js";
import { closeDatabase, resetDatabase, TEST_TENANT_ID } from "../helpers/db.js";

const OTHER_TENANT_ID = "00000000-0000-4000-a000-000000000002";

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  // Create another tenant for cross-tenant testing
  await prisma.tenant.create({
    data: {
      id: OTHER_TENANT_ID,
      name: "Other Tenant",
      slug: "other-tenant",
    },
  });
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
    "tenants",
    "api_keys",
    "users",
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

test("leads.email_normalized enforces uniqueness per tenant", async () => {
  await prisma.lead.create({
    data: {
      tenantId: TEST_TENANT_ID,
      emailNormalized: "unique@example.com",
    },
  });

  // Duplicate in same tenant should fail
  await assert.rejects(
    prisma.lead.create({
      data: {
        tenantId: TEST_TENANT_ID,
        emailNormalized: "unique@example.com",
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
  );

  // Same email in different tenant should succeed
  await prisma.lead.create({
    data: {
      tenantId: OTHER_TENANT_ID,
      emailNormalized: "unique@example.com",
    },
  });
});

test("visitors.anon_id enforces uniqueness per tenant", async () => {
  await prisma.visitor.create({
    data: {
      tenantId: TEST_TENANT_ID,
      anonId: "anon-unique-visitor",
    },
  });

  // Duplicate in same tenant should fail
  await assert.rejects(
    prisma.visitor.create({
      data: {
        tenantId: TEST_TENANT_ID,
        anonId: "anon-unique-visitor",
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
  );

  // Same anonId in different tenant should succeed
  await prisma.visitor.create({
    data: {
      tenantId: OTHER_TENANT_ID,
      anonId: "anon-unique-visitor",
    },
  });
});

test("lead_identities composite key enforces uniqueness per tenant", async () => {
  const lead = await prisma.lead.create({
    data: {
      tenantId: TEST_TENANT_ID,
      emailNormalized: "identity@example.com",
    },
    select: { id: true },
  });
  const visitor = await prisma.visitor.create({
    data: {
      tenantId: TEST_TENANT_ID,
      anonId: "anon-identity-001",
    },
    select: { id: true },
  });

  await prisma.leadIdentity.create({
    data: {
      tenantId: TEST_TENANT_ID,
      leadId: lead.id,
      visitorId: visitor.id,
      linkSource: LinkSource.form_submit,
      confidence: 1,
    },
  });

  // Duplicate in same tenant should fail
  await assert.rejects(
    prisma.leadIdentity.create({
      data: {
        tenantId: TEST_TENANT_ID,
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

test("events.dedupe_key enforces uniqueness per tenant", async () => {
  const visitor = await prisma.visitor.create({
    data: {
      tenantId: TEST_TENANT_ID,
      anonId: "anon-dedupe-visitor-001",
    },
    select: { id: true },
  });
  const session = await prisma.session.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitor.id,
      startedAt: new Date("2026-02-14T00:00:00.000Z"),
      lastEventAt: new Date("2026-02-14T00:00:00.000Z"),
    },
    select: { id: true },
  });

  const dedupeKey =
    "beecf3f3f96d96f581af596f4f8fc4a000ea5d0302fb05501858be3349f7ebf7";

  await prisma.event.create({
    data: {
      tenantId: TEST_TENANT_ID,
      visitorId: visitor.id,
      sessionId: session.id,
      dedupeKey,
      eventType: "page_view",
      path: "/",
      timestamp: new Date("2026-02-14T00:00:00.000Z"),
    },
  });

  // Duplicate in same tenant should fail
  await assert.rejects(
    prisma.event.create({
      data: {
        tenantId: TEST_TENANT_ID,
        visitorId: visitor.id,
        sessionId: session.id,
        dedupeKey,
        eventType: "page_view",
        path: "/",
        timestamp: new Date("2026-02-14T00:00:01.000Z"),
      },
    }),
    (error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002",
  );

  // Same dedupeKey in different tenant should succeed
  const otherVisitor = await prisma.visitor.create({
    data: {
      tenantId: OTHER_TENANT_ID,
      anonId: "anon-dedupe-visitor-other",
    },
  });

  await prisma.event.create({
    data: {
      tenantId: OTHER_TENANT_ID,
      visitorId: otherVisitor.id,
      dedupeKey,
      eventType: "page_view",
      path: "/",
      timestamp: new Date("2026-02-14T00:00:00.000Z"),
    },
  });
});
