import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";

import { pool, query, sql, withTenant } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import {
  applyConsentStatus,
  toConsentStatus,
} from "../../src/services/consent.js";
import { resetDatabase } from "../helpers/db.js";
import { ConsentStatus } from "../../src/lib/schema-enums.js";

const LEADS_TABLE = tableRef("leads");
const CONSENT_EVENTS_TABLE = tableRef("consent_events");

const TEST_TENANT_ID = "00000000-0000-4000-a000-000000000001";

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await pool.end();
});

test("applyConsentStatus updates lead and logs event", async () => {
  await withTenant(TEST_TENANT_ID, async (client) => {
    // 1. Create lead
    const leadId = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${LEADS_TABLE} ("id", "tenant_id", "email_normalized", "consent_status", "updated_at")
      VALUES (${leadId}, ${TEST_TENANT_ID}, 'consent-test@example.com', ${ConsentStatus.pending}, NOW())
    `,
    );

    // 2. Apply express consent
    await applyConsentStatus(
      client,
      TEST_TENANT_ID,
      leadId,
      ConsentStatus.express,
      "form_submit",
      "test-ip-hash",
    );

    // 3. Verify lead update
    const { rows: leadRows } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "id" = ${leadId}`,
    );
    assert.equal(leadRows[0]?.consent_status, ConsentStatus.express);

    // 4. Verify consent event
    const { rows: eventRows } = await query<any>(
      client,
      sql`SELECT * FROM ${CONSENT_EVENTS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "lead_id" = ${leadId}`,
    );
    const event = eventRows[0];
    assert.ok(event);
    assert.equal(event.status, ConsentStatus.express);
    assert.equal(event.source, "form_submit");
    assert.equal(event.ip_hash, "test-ip-hash");
  });
});

test("applyConsentStatus transition: pending -> express -> withdrawn", async () => {
  await withTenant(TEST_TENANT_ID, async (client) => {
    const leadId = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${LEADS_TABLE} ("id", "tenant_id", "email_normalized", "consent_status", "updated_at")
      VALUES (${leadId}, ${TEST_TENANT_ID}, 'transition-test@example.com', ${ConsentStatus.pending}, NOW())
    `,
    );

    // pending -> express
    await applyConsentStatus(
      client,
      TEST_TENANT_ID,
      leadId,
      ConsentStatus.express,
      "manual",
    );
    const { rows: r1 } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "id" = ${leadId}`,
    );
    assert.equal(r1[0]?.consent_status, ConsentStatus.express);

    // express -> withdrawn
    await applyConsentStatus(
      client,
      TEST_TENANT_ID,
      leadId,
      ConsentStatus.withdrawn,
      "unsubscribe",
    );
    const { rows: r2 } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "id" = ${leadId}`,
    );
    assert.equal(r2[0]?.consent_status, ConsentStatus.withdrawn);

    // Check events
    const { rows: countRows } = await query<{ count: string }>(
      client,
      sql`SELECT count(*)::text as count FROM ${CONSENT_EVENTS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "lead_id" = ${leadId}`,
    );
    assert.equal(countRows[0]?.count, "2");

    // withdrawn -> pending (should be rejected/ignored)
    await applyConsentStatus(
      client,
      TEST_TENANT_ID,
      leadId,
      ConsentStatus.pending,
      "manual",
    );
    const { rows: r3 } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "tenant_id" = ${TEST_TENANT_ID} AND "id" = ${leadId}`,
    );
    assert.equal(r3[0]?.consent_status, ConsentStatus.withdrawn);
  });
});
