import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, sql } from "../lib/db.js";
import { tableRef } from "../lib/sql.js";
import { ConsentStatus } from "../lib/schema-enums.js";

const LEADS_TABLE = tableRef("leads");
const CONSENT_EVENTS_TABLE = tableRef("consent_events");

const assertNever = (value: never): never => {
  throw new Error(`unexpected consent status: ${String(value)}`);
};

export const toConsentStatus = (
  value: "pending" | "express" | "implied" | "withdrawn" | undefined,
): ConsentStatus => {
  if (!value) {
    return ConsentStatus.pending;
  }
  switch (value) {
    case "pending":
      return ConsentStatus.pending;
    case "express":
      return ConsentStatus.express;
    case "implied":
      return ConsentStatus.implied;
    case "withdrawn":
      return ConsentStatus.withdrawn;
    default:
      return assertNever(value);
  }
};

export const applyConsentStatus = async (
  tx: PoolClient,
  leadId: string,
  nextStatus: ConsentStatus,
  source: string,
  ipHash?: string | null,
  currentStatus?: ConsentStatus,
): Promise<void> => {
  let existingStatus = currentStatus;

  if (!existingStatus) {
    const { rows } = await query<{ consent_status: ConsentStatus }>(
      tx,
      sql`
        SELECT "consent_status"
        FROM ${LEADS_TABLE}
        WHERE "id" = ${leadId}
      `,
    );
    if (rows.length === 0) {
      return;
    }
    if (rows.length > 0 && rows[0] !== undefined) {
      existingStatus = rows[0].consent_status;
    }
  }

  if (existingStatus !== nextStatus) {
    await query(
      tx,
      sql`
        UPDATE ${LEADS_TABLE}
        SET "consent_status" = ${nextStatus}
        WHERE "id" = ${leadId}
      `,
    );
  }

  await query(
    tx,
    sql`
      INSERT INTO ${CONSENT_EVENTS_TABLE} (
        "id",
        "lead_id",
        "status",
        "source",
        "ip_hash"
      ) VALUES (
        ${randomUUID()},
        ${leadId},
        ${nextStatus},
        ${source},
        ${ipHash ?? null}
      )
    `,
  );
};
