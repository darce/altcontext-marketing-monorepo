import { pool, query, sql } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import { randomUUID } from "node:crypto";

const EVENTS_TABLE = tableRef("events");
const SESSIONS_TABLE = tableRef("sessions");
const VISITORS_TABLE = tableRef("visitors");

const run = async () => {
  const client = await pool.connect();
  try {
    const visitorId = randomUUID();
    const sessionId = randomUUID();
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
    const recentDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago

    console.log("Seeding visitor...");
    await query(
      client,
      sql`
      INSERT INTO ${VISITORS_TABLE} (id, anon_id, created_at, updated_at)
      VALUES (${visitorId}, 'seed-visitor', ${oldDate}, ${oldDate})
    `,
    );

    console.log("Seeding old session and event...");
    await query(
      client,
      sql`
      INSERT INTO ${SESSIONS_TABLE} (id, visitor_id, started_at, updated_at)
      VALUES (${sessionId}, ${visitorId}, ${oldDate}, ${oldDate})
    `,
    );
    await query(
      client,
      sql`
      INSERT INTO ${EVENTS_TABLE} (id, visitor_id, session_id, event_type, timestamp, property_id)
      VALUES (${randomUUID()}, ${visitorId}, ${sessionId}, 'page_view', ${oldDate}, 'p1')
    `,
    );

    console.log("Seeding recent session and event...");
    const recentSessionId = randomUUID();
    await query(
      client,
      sql`
      INSERT INTO ${SESSIONS_TABLE} (id, visitor_id, started_at, updated_at)
      VALUES (${recentSessionId}, ${visitorId}, ${recentDate}, ${recentDate})
    `,
    );
    await query(
      client,
      sql`
      INSERT INTO ${EVENTS_TABLE} (id, visitor_id, session_id, event_type, timestamp, property_id)
      VALUES (${randomUUID()}, ${visitorId}, ${recentSessionId}, 'page_view', ${recentDate}, 'p1')
    `,
    );

    console.log("✅ Seed complete.");
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch(console.error);
