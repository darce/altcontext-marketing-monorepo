import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";

import { env } from "../../src/config/env.js";
import { pool, query, sql } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import {
  linkLeadToVisitor,
  linkHeuristicVisitors,
} from "../../src/services/identity.js";
import { resetDatabase } from "../helpers/db.js";
import { LinkSource } from "../../src/lib/schema-enums.js";

const VISITORS_TABLE = tableRef("visitors");
const LEAD_IDENTITIES_TABLE = tableRef("lead_identities");
const LEADS_TABLE = tableRef("leads");

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await pool.end();
});

test("linkLeadToVisitor creates a strong link", async () => {
  const client = await pool.connect();
  try {
    const leadId = randomUUID();
    const visitorId = randomUUID();
    await query(
      client,
      sql`INSERT INTO ${VISITORS_TABLE} ("id", "anon_id", "updated_at") VALUES (${visitorId}, 'visitor-1', NOW())`,
    );
    await query(
      client,
      sql`INSERT INTO ${LEADS_TABLE} ("id", "email_normalized", "updated_at") VALUES (${leadId}, 'lead-1@test.com', NOW())`,
    );

    await linkLeadToVisitor(
      client,
      leadId,
      visitorId,
      LinkSource.form_submit,
      1.0,
    );

    const { rows: linkRows } = await query<any>(
      client,
      sql`SELECT * FROM ${LEAD_IDENTITIES_TABLE} WHERE "lead_id" = ${leadId} AND "visitor_id" = ${visitorId}`,
    );
    const link = linkRows[0];
    assert.ok(link);
    assert.equal(Number(link.confidence), 1.0);
    assert.equal(link.link_source, LinkSource.form_submit);
  } finally {
    client.release();
  }
});

test("linkHeuristicVisitors links based on shared IP/UA", async () => {
  const client = await pool.connect();
  try {
    const ipHash = "shared-ip";
    const uaHash = "shared-ua";
    const now = new Date();

    // 1. Existing visitor seen recently with same IP/UA
    const v1Id = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${VISITORS_TABLE} ("id", "anon_id", "last_ip_hash", "last_ua_hash", "last_seen_at", "updated_at")
      VALUES (${v1Id}, 'anon-1', ${ipHash}, ${uaHash}, ${new Date(now.getTime() - 2 * 60 * 1000)}, NOW())
    `,
    );

    // 2. Primary visitor (just captured)
    const primaryVId = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${VISITORS_TABLE} ("id", "anon_id", "last_ip_hash", "last_ua_hash", "last_seen_at", "updated_at")
      VALUES (${primaryVId}, 'anon-primary', ${ipHash}, ${uaHash}, ${now}, NOW())
    `,
    );

    const leadId = randomUUID();
    await query(
      client,
      sql`INSERT INTO ${LEADS_TABLE} ("id", "email_normalized", "updated_at") VALUES (${leadId}, 'lead-h@test.com', NOW())`,
    );

    // Enable heuristic linking
    const originalEnable = env.ENABLE_HEURISTIC_LINKING;
    (env as any).ENABLE_HEURISTIC_LINKING = true;

    try {
      const linksCreated = await linkHeuristicVisitors(
        client,
        leadId,
        primaryVId,
        ipHash,
        uaHash,
      );
      assert.equal(linksCreated, 1);

      const { rows: linkRows } = await query<any>(
        client,
        sql`SELECT * FROM ${LEAD_IDENTITIES_TABLE} WHERE "lead_id" = ${leadId} AND "visitor_id" = ${v1Id}`,
      );
      const hLink = linkRows[0];
      assert.ok(hLink);
      assert.equal(Number(hLink.confidence), 0.35);
      assert.equal(hLink.link_source, LinkSource.same_ip_ua_window);
      assert.equal(Number(hLink.confidence), 0.35);
    } finally {
      (env as any).ENABLE_HEURISTIC_LINKING = originalEnable;
    }

    // 4. Test heuristic disabled
    const lead2Id = randomUUID();
    await query(
      client,
      sql`INSERT INTO ${LEADS_TABLE} ("id", "email_normalized", "updated_at") VALUES (${lead2Id}, 'lead-h2@test.com', NOW())`,
    );
    (env as any).ENABLE_HEURISTIC_LINKING = false;
    try {
      const linksCreated = await linkHeuristicVisitors(
        client,
        lead2Id,
        primaryVId,
        ipHash,
        uaHash,
      );
      assert.equal(linksCreated, 0);
      const { rows: linkRows } = await query<any>(
        client,
        sql`SELECT * FROM ${LEAD_IDENTITIES_TABLE} WHERE "lead_id" = ${lead2Id}`,
      );
      assert.equal(linkRows.length, 0);
    } finally {
      (env as any).ENABLE_HEURISTIC_LINKING = originalEnable;
    }
  } finally {
    client.release();
  }
});
