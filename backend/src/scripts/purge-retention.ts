import { env } from "../config/env.js";
import { pool, query, sql, withOwnerRole } from "../lib/db.js";
import { tableRef } from "../lib/sql.js";

const RAW_EVENT_RETENTION_DAYS = 90;
const EVENTS_TABLE = tableRef("events");
const SESSIONS_TABLE = tableRef("sessions");
const VISITORS_TABLE = tableRef("visitors");

const run = async (): Promise<void> => {
  const cutoffDate = new Date(
    Date.now() - RAW_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  await withOwnerRole(async (client) => {
    const { rows: eventRows } = await query<{ count: number }>(
      client,
      sql`
      WITH deleted AS (
        DELETE FROM ${EVENTS_TABLE}
        WHERE "timestamp" < ${cutoffDate}
        RETURNING 1
      )
      SELECT COUNT(*)::int as count FROM deleted
    `,
    );
    const eventCount = eventRows[0]?.count ?? 0;

    const { rows: sessionRows } = await query<{ count: number }>(
      client,
      sql`
      WITH deleted AS (
        DELETE FROM ${SESSIONS_TABLE} s
        WHERE NOT EXISTS (SELECT 1 FROM ${EVENTS_TABLE} e WHERE e."session_id" = s."id")
          AND NOT EXISTS (SELECT 1 FROM "form_submissions" fs WHERE fs."session_id" = s."id")
        RETURNING 1
      )
      SELECT COUNT(*)::int as count FROM deleted
    `,
    );
    const sessionCount = sessionRows[0]?.count ?? 0;

    const { rows: visitorRows } = await query<{ count: number }>(
      client,
      sql`
      WITH deleted AS (
        DELETE FROM ${VISITORS_TABLE} v
        WHERE NOT EXISTS (SELECT 1 FROM ${SESSIONS_TABLE} s WHERE s."visitor_id" = v."id")
          AND NOT EXISTS (SELECT 1 FROM ${EVENTS_TABLE} e WHERE e."visitor_id" = v."id")
          AND NOT EXISTS (SELECT 1 FROM "form_submissions" fs WHERE fs."visitor_id" = v."id")
          AND NOT EXISTS (SELECT 1 FROM "lead_identities" li WHERE li."visitor_id" = v."id")
        RETURNING 1
      )
      SELECT COUNT(*)::int as count FROM deleted
    `,
    );
    const visitorCount = visitorRows[0]?.count ?? 0;

    console.log(
      `✅ Retention purge complete. Removed ${eventCount} event rows older than ${cutoffDate.toISOString()}.`,
    );
    console.log(
      `ℹ️ Removed ${sessionCount} orphan sessions and ${visitorCount} orphan visitors.`,
    );
    console.log(
      "ℹ️ Raw IP retention is not applicable because only hashed IP values are stored.",
    );
    console.log(`ℹ️ Privacy contact: ${env.PRIVACY_CONTACT_EMAIL}`);
  });
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Retention purge failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
