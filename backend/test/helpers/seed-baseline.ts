import { pool, query, sql, withOwnerRole } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
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
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

    console.log("Seeding visitor...");
    const { rows: visitorRows } = await query<{ id: string }>(
      client,
      sql`
      INSERT INTO ${VISITORS_TABLE} (tenant_id, anon_id, created_at, updated_at)
      VALUES (${tenantId}, 'seed-visitor', ${oldDate}, ${oldDate})
      RETURNING id
    `,
    );
    const visitorId = visitorRows[0]?.id;
    if (!visitorId) throw new Error("Failed to seed visitor");

    console.log("Seeding old session and event...");
    const { rows: sessionRows } = await query<{ id: string }>(
      client,
      sql`
      INSERT INTO ${SESSIONS_TABLE} (tenant_id, visitor_id, started_at, updated_at)
      VALUES (${tenantId}, ${visitorId}, ${oldDate}, ${oldDate})
      RETURNING id
    `,
    );
    const sessionId = sessionRows[0]?.id;
    if (!sessionId) throw new Error("Failed to seed old session");
    await query(
      client,
      sql`
      INSERT INTO ${EVENTS_TABLE} (tenant_id, visitor_id, session_id, event_type, timestamp, property_id)
      VALUES (${tenantId}, ${visitorId}, ${sessionId}, 'page_view', ${oldDate}, 'p1')
    `,
    );

    console.log("Seeding recent session and event...");
    const { rows: recentSessionRows } = await query<{ id: string }>(
      client,
      sql`
      INSERT INTO ${SESSIONS_TABLE} (tenant_id, visitor_id, started_at, updated_at)
      VALUES (${tenantId}, ${visitorId}, ${recentDate}, ${recentDate})
      RETURNING id
    `,
    );
    const recentSessionId = recentSessionRows[0]?.id;
    if (!recentSessionId) throw new Error("Failed to seed recent session");
    await query(
      client,
      sql`
      INSERT INTO ${EVENTS_TABLE} (tenant_id, visitor_id, session_id, event_type, timestamp, property_id)
      VALUES (${tenantId}, ${visitorId}, ${recentSessionId}, 'page_view', ${recentDate}, 'p1')
    `,
    );

    console.log("✅ Seed complete.");
  });
};

run()
  .catch(console.error)
  .finally(() => pool.end());
