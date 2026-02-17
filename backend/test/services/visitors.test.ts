import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";

import { env } from "../../src/config/env.js";
import { pool, query, sql, withTenant } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import { ensureVisitorSession } from "../../src/services/visitors.js";
import { resetDatabase } from "../helpers/db.js";

const VISITORS_TABLE = tableRef("visitors");
const SESSIONS_TABLE = tableRef("sessions");

const TEST_TENANT_ID = "00000000-0000-4000-a000-000000000001";

const mockContext = {
  ipHash: "test-ip-hash",
  uaHash: "test-ua-hash",
  host: "localhost",
  userAgent: "test-ua",
  requestIp: "127.0.0.1",
};

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await pool.end();
});

test("ensureVisitorSession creates a new visitor and session on first see", async () => {
  await withTenant(TEST_TENANT_ID, async (client) => {
    const anonId = "anon-123";
    const occurredAt = new Date();

    const { visitor, session } = await ensureVisitorSession(client, {
      tenantId: TEST_TENANT_ID,
      anonId,
      occurredAt,
      request: mockContext,
      path: "/home",
    });

    assert.ok(visitor.id);
    assert.equal(visitor.anonId, anonId);
    assert.ok(session.id);
    assert.equal(session.visitorId, visitor.id);
    assert.equal(session.landingPath, "/home");

    // Verify DB
    const { rows: vRows } = await query(
      client,
      sql`SELECT * FROM ${VISITORS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "id" = ${visitor.id}`,
    );
    const { rows: sRows } = await query(
      client,
      sql`SELECT * FROM ${SESSIONS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "id" = ${session.id}`,
    );
    assert.ok(vRows[0]);
    assert.ok(sRows[0]);
  });
});

test("ensureVisitorSession starts a new session after inactivity timeout", async () => {
  await withTenant(TEST_TENANT_ID, async (client) => {
    const anonId = "anon-timeout";
    const firstOccurredAt = new Date("2026-02-16T10:00:00Z");

    // 1. Initial session
    const { session: session1 } = await ensureVisitorSession(client, {
      tenantId: TEST_TENANT_ID,
      anonId,
      occurredAt: firstOccurredAt,
      request: mockContext,
    });

    // 2. Second event after 31 minutes (default limit 30)
    const secondOccurredAt = new Date(
      firstOccurredAt.getTime() + 31 * 60 * 1000,
    );
    const { session: session2 } = await ensureVisitorSession(client, {
      tenantId: TEST_TENANT_ID,
      anonId,
      occurredAt: secondOccurredAt,
      request: mockContext,
    });

    assert.notEqual(session1.id, session2.id);

    // Verify first session was ended
    const { rows: s1Rows } = await query<any>(
      client,
      sql`SELECT * FROM ${SESSIONS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "id" = ${session1.id}`,
    );
    const endedSession1 = s1Rows[0];
    assert.ok(endedSession1?.ended_at);
    assert.equal(
      new Date(endedSession1.ended_at).getTime(),
      firstOccurredAt.getTime(),
    );
  });
});

test("ensureVisitorSession rotates session on UTM change", async () => {
  await withTenant(TEST_TENANT_ID, async (client) => {
    const anonId = "anon-utm";

    // 1. Session with UTM source 'google'
    const { session: session1 } = await ensureVisitorSession(client, {
      tenantId: TEST_TENANT_ID,
      anonId,
      occurredAt: new Date(),
      request: mockContext,
      utm: { source: "google", medium: "cpc" },
    });

    // 2. Session with UTM source 'bing' (same visitor, no timeout)
    const { session: session2 } = await ensureVisitorSession(client, {
      tenantId: TEST_TENANT_ID,
      anonId,
      occurredAt: new Date(),
      request: mockContext,
      utm: { source: "bing", medium: "cpc" },
    });

    assert.notEqual(session1.id, session2.id);
    assert.equal(session2.utmSource, "bing");
  });
});

test("ensureVisitorSession updates existing session within activity window", async () => {
  await withTenant(TEST_TENANT_ID, async (client) => {
    const anonId = "anon-active";
    const firstTime = new Date();

    const { session: session1 } = await ensureVisitorSession(client, {
      tenantId: TEST_TENANT_ID,
      anonId,
      occurredAt: firstTime,
      request: mockContext,
    });

    const secondTime = new Date(firstTime.getTime() + 5 * 60 * 1000); // 5 mins later
    const { session: session2 } = await ensureVisitorSession(client, {
      tenantId: TEST_TENANT_ID,
      anonId,
      occurredAt: secondTime,
      request: mockContext,
    });

    assert.equal(session1.id, session2.id);
    assert.equal(session2.lastEventAt.getTime(), secondTime.getTime());
  });
});
