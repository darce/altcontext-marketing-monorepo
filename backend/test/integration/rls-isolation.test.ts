import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  pool,
  query,
  sql,
  withTenant,
  withOwnerRole,
} from "../../src/lib/db.js";
import { randomUUID } from "node:crypto";

describe("RLS Isolation", () => {
  const tenantA = "00000000-0000-4000-a000-00000000000a";
  const tenantB = "00000000-0000-4000-a000-00000000000b";
  const visitorA = randomUUID();
  const visitorB = randomUUID();
  const sessionA = randomUUID();
  const sessionB = randomUUID();
  const leadA = randomUUID();
  const leadB = randomUUID();
  const leadIdentityA = randomUUID();
  const leadIdentityB = randomUUID();
  const eventA = randomUUID();
  const eventB = randomUUID();

  const seedTenantData = async (
    tenantId: string,
    visitorId: string,
    sessionId: string,
    leadId: string,
    leadIdentityId: string,
    eventId: string,
    email: string,
    anonId: string,
  ): Promise<void> => {
    await withTenant(tenantId, async (tx) => {
      await query(
        tx,
        sql`INSERT INTO visitors (id, tenant_id, anon_id, updated_at) VALUES (${visitorId}, ${tenantId}, ${anonId}, now())`,
      );
      await query(
        tx,
        sql`INSERT INTO sessions (id, tenant_id, visitor_id, started_at, updated_at) VALUES (${sessionId}, ${tenantId}, ${visitorId}, now(), now())`,
      );
      await query(
        tx,
        sql`INSERT INTO leads (id, tenant_id, email_normalized, updated_at) VALUES (${leadId}, ${tenantId}, ${email}, now())`,
      );
      await query(
        tx,
        sql`INSERT INTO lead_identities (id, tenant_id, lead_id, visitor_id) VALUES (${leadIdentityId}, ${tenantId}, ${leadId}, ${visitorId})`,
      );
      await query(
        tx,
        sql`INSERT INTO events (id, tenant_id, visitor_id, session_id, event_type, property_id) VALUES (${eventId}, ${tenantId}, ${visitorId}, ${sessionId}, 'page_view', 'rls-test')`,
      );
    });
  };

  before(async () => {
    // Ensure tenants exist (run as owner to bypass RLS)
    await withOwnerRole(async (client) => {
      await client.query(
        "INSERT INTO tenants (id, name, slug, updated_at) VALUES ($1, 'Tenant A', 'tenant-a', now()) ON CONFLICT (id) DO NOTHING",
        [tenantA],
      );
      await client.query(
        "INSERT INTO tenants (id, name, slug, updated_at) VALUES ($1, 'Tenant B', 'tenant-b', now()) ON CONFLICT (id) DO NOTHING",
        [tenantB],
      );
    });

    await seedTenantData(
      tenantA,
      visitorA,
      sessionA,
      leadA,
      leadIdentityA,
      eventA,
      "tenant-a@example.com",
      "anon-a",
    );
    await seedTenantData(
      tenantB,
      visitorB,
      sessionB,
      leadB,
      leadIdentityB,
      eventB,
      "tenant-b@example.com",
      "anon-b",
    );
  });

  after(async () => {
    await withOwnerRole(async (client) => {
      await client.query("DELETE FROM events WHERE tenant_id IN ($1, $2)", [
        tenantA,
        tenantB,
      ]);
      await client.query(
        "DELETE FROM lead_identities WHERE tenant_id IN ($1, $2)",
        [tenantA, tenantB],
      );
      await client.query("DELETE FROM leads WHERE tenant_id IN ($1, $2)", [
        tenantA,
        tenantB,
      ]);
      await client.query("DELETE FROM sessions WHERE tenant_id IN ($1, $2)", [
        tenantA,
        tenantB,
      ]);
      await client.query("DELETE FROM visitors WHERE tenant_id IN ($1, $2)", [
        tenantA,
        tenantB,
      ]);
      // Keep tenants for other tests or cleanup if needed
    });
  });

  it("Tenant A cannot see Tenant B data across visitors, leads, and events", async () => {
    await withTenant(tenantA, async (tx) => {
      const { rows } = await query(
        tx,
        sql`SELECT id FROM visitors WHERE tenant_id = ${tenantA}`,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, visitorA);

      const { rows: allRows } = await query(tx, sql`SELECT id FROM visitors`);
      assert.equal(allRows.length, 1);
      assert.equal(allRows[0].id, visitorA);

      const { rows: leadRows } = await query(
        tx,
        sql`SELECT id FROM leads WHERE tenant_id = ${tenantA}`,
      );
      assert.equal(leadRows.length, 1);
      assert.equal(leadRows[0].id, leadA);

      const { rows: leadIdentityRows } = await query(
        tx,
        sql`SELECT id FROM lead_identities`,
      );
      assert.equal(leadIdentityRows.length, 1);
      assert.equal(leadIdentityRows[0].id, leadIdentityA);

      const { rows: eventRows } = await query(tx, sql`SELECT id FROM events`);
      assert.equal(eventRows.length, 1);
      assert.equal(eventRows[0].id, eventA);
    });
  });

  it("Tenant B cannot see Tenant A data across visitors, leads, and events", async () => {
    await withTenant(tenantB, async (tx) => {
      const { rows: visitorRows } = await query(
        tx,
        sql`SELECT id FROM visitors`,
      );
      assert.equal(visitorRows.length, 1);
      assert.equal(visitorRows[0].id, visitorB);

      const { rows: leadRows } = await query(tx, sql`SELECT id FROM leads`);
      assert.equal(leadRows.length, 1);
      assert.equal(leadRows[0].id, leadB);

      const { rows: leadIdentityRows } = await query(
        tx,
        sql`SELECT id FROM lead_identities`,
      );
      assert.equal(leadIdentityRows.length, 1);
      assert.equal(leadIdentityRows[0].id, leadIdentityB);

      const { rows: eventRows } = await query(tx, sql`SELECT id FROM events`);
      assert.equal(eventRows.length, 1);
      assert.equal(eventRows[0].id, eventB);
    });
  });

  it("Queries without tenant context return zero rows for RLS-enabled tables", async () => {
    // Current pool connection automatically SET ROLE app_user.
    // Bare queries without SET LOCAL app.current_tenant_id should return 0 rows.
    const client = await pool.connect();
    try {
      const { rows } = await client.query("SELECT id FROM visitors");
      assert.equal(rows.length, 0);
    } finally {
      client.release();
    }
  });

  it("api_keys lookup works without tenant context (permissive policy)", async () => {
    const keyPrefix = "test-rls-" + Math.random().toString(36).substring(7);
    const keyId = randomUUID();
    const keyHash = "rls-test-" + randomUUID();

    // Seed as owner
    await withOwnerRole(async (client) => {
      await client.query(
        "INSERT INTO api_keys (id, tenant_id, key_prefix, key_hash, scope, updated_at) VALUES ($1, $2, $3, $4, 'ingest', now())",
        [keyId, tenantA, keyPrefix, keyHash],
      );
    });

    // Lookup as app_user (default pool) without tenant context
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        "SELECT tenant_id FROM api_keys WHERE key_prefix = $1",
        [keyPrefix],
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].tenant_id, tenantA);
    } finally {
      client.release();
    }
  });
});
