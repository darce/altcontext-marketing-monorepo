import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";

import { pool, query, sql } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import {
  applyConsentStatus,
  toConsentStatus,
} from "../../src/services/consent.js";
import { resetDatabase } from "../helpers/db.js";
import { ConsentStatus } from "../../src/lib/schema-enums.js";

const LEADS_TABLE = tableRef("leads");
const CONSENT_EVENTS_TABLE = tableRef("consent_events");

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
  const client = await pool.connect();
  try {
    // 1. Create lead
    const leadId = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${LEADS_TABLE} ("id", "email_normalized", "consent_status", "updated_at")
      VALUES (${leadId}, 'consent-test@example.com', ${ConsentStatus.pending}, NOW())
    `,
    );

    // 2. Apply express consent
    await applyConsentStatus(
      client,
      leadId,
      ConsentStatus.express,
      "form_submit",
      "test-ip-hash",
    );

    // 3. Verify lead update
    const { rows: leadRows } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "id" = ${leadId}`,
    );
    assert.equal(leadRows[0]?.consent_status, ConsentStatus.express);

    // 4. Verify consent event
    const { rows: eventRows } = await query<any>(
      client,
      sql`SELECT * FROM ${CONSENT_EVENTS_TABLE} WHERE "lead_id" = ${leadId}`,
    );
    const event = eventRows[0];
    assert.ok(event);
    assert.equal(event.status, ConsentStatus.express);
    assert.equal(event.source, "form_submit");
    assert.equal(event.ip_hash, "test-ip-hash");
  } finally {
    client.release();
  }
});

test("applyConsentStatus transition: pending -> express -> withdrawn", async () => {
  const client = await pool.connect();
  try {
    const leadId = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${LEADS_TABLE} ("id", "email_normalized", "consent_status", "updated_at")
      VALUES (${leadId}, 'transition-test@example.com', ${ConsentStatus.pending}, NOW())
    `,
    );

    // pending -> express
    await applyConsentStatus(client, leadId, ConsentStatus.express, "manual");
    const { rows: r1 } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "id" = ${leadId}`,
    );
    assert.equal(r1[0]?.consent_status, ConsentStatus.express);

    // express -> withdrawn
    await applyConsentStatus(
      client,
      leadId,
      ConsentStatus.withdrawn,
      "unsubscribe",
    );
    const { rows: r2 } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "id" = ${leadId}`,
    );
    assert.equal(r2[0]?.consent_status, ConsentStatus.withdrawn);

    // Check events
    const { rows: countRows } = await query<{ count: string }>(
      client,
      sql`SELECT count(*)::text as count FROM ${CONSENT_EVENTS_TABLE} WHERE "lead_id" = ${leadId}`,
    );
    assert.equal(countRows[0]?.count, "2");

    // withdrawn -> pending (should be rejected/ignored)
    await applyConsentStatus(client, leadId, ConsentStatus.pending, "manual");
    const { rows: r3 } = await query<any>(
      client,
      sql`SELECT * FROM ${LEADS_TABLE} WHERE "id" = ${leadId}`,
    );
    assert.equal(r3[0]?.consent_status, ConsentStatus.withdrawn);
  } finally {
    client.release();
  }
});
