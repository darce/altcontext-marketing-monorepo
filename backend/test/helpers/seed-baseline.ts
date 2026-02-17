import { pool, query, sql, withOwnerRole } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import { randomUUID } from "node:crypto";
import { env } from "../../src/config/env.js";

/**
 * Standalone local-dev seeding helper for retention/rollup smoke tests.
 * Not imported by the automated test suite.
 */
const EVENTS_TABLE = tableRef("events");
const SESSIONS_TABLE = tableRef("sessions");
const VISITORS_TABLE = tableRef("visitors");

const run = async () => {
  const tenantId =
    env.BOOTSTRAP_TENANT_ID ?? "00000000-0000-4000-a000-000000000001";

  await withOwnerRole(async (client) => {
    const visitorId = randomUUID();
    const sessionId = randomUUID();
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

    console.log("Seeding visitor...");
    await query(
      client,
      sql`
      INSERT INTO ${VISITORS_TABLE} (id, tenant_id, anon_id, created_at, updated_at)
      VALUES (${visitorId}, ${tenantId}, 'seed-visitor', ${oldDate}, ${oldDate})
    `,
    );

    console.log("Seeding old session and event...");
    await query(
      client,
      sql`
      INSERT INTO ${SESSIONS_TABLE} (id, tenant_id, visitor_id, started_at, updated_at)
      VALUES (${sessionId}, ${tenantId}, ${visitorId}, ${oldDate}, ${oldDate})
    `,
    );
    await query(
      client,
      sql`
      INSERT INTO ${EVENTS_TABLE} (id, tenant_id, visitor_id, session_id, event_type, timestamp, property_id)
      VALUES (${randomUUID()}, ${tenantId}, ${visitorId}, ${sessionId}, 'page_view', ${oldDate}, 'p1')
    `,
    );

    console.log("Seeding recent session and event...");
    const recentSessionId = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${SESSIONS_TABLE} (id, tenant_id, visitor_id, started_at, updated_at)
      VALUES (${recentSessionId}, ${tenantId}, ${visitorId}, ${recentDate}, ${recentDate})
    `,
    );
    await query(
      client,
      sql`
      INSERT INTO ${EVENTS_TABLE} (id, tenant_id, visitor_id, session_id, event_type, timestamp, property_id)
      VALUES (${randomUUID()}, ${tenantId}, ${visitorId}, ${recentSessionId}, 'page_view', ${recentDate}, 'p1')
    `,
    );

    console.log("✅ Seed complete.");
  });
};

run()
  .catch(console.error)
  .finally(() => pool.end());
