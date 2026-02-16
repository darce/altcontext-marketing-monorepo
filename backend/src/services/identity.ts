import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { env } from "../config/env.js";
import { query, sql } from "../lib/db.js";
import { tableRef } from "../lib/sql.js";
import { LinkSource } from "../lib/schema-enums.js";

const VISITORS_TABLE = tableRef("visitors");
const LEAD_IDENTITIES_TABLE = tableRef("lead_identities");

export const linkLeadToVisitor = async (
  tx: PoolClient,
  leadId: string,
  visitorId: string,
  linkSource: LinkSource,
  confidence: number,
): Promise<void> => {
  const { rows } = await query<{
    id: string;
    confidence: number;
    link_source: LinkSource;
  }>(
    tx,
    sql`
      SELECT "id", "confidence", "link_source"
      FROM ${LEAD_IDENTITIES_TABLE}
      WHERE "lead_id" = ${leadId}
        AND "visitor_id" = ${visitorId}
        AND "link_source" = ${linkSource}
      LIMIT 1
    `,
  );
  const existing = rows[0];

  if (existing) {
    if (existing.confidence >= confidence) {
      return;
    }
    await query(
      tx,
      sql`
        UPDATE ${LEAD_IDENTITIES_TABLE}
        SET
          "confidence" = ${confidence},
          "linked_at" = NOW()
        WHERE "id" = ${existing.id}
      `,
    );
    return;
  }

  await query(
    tx,
    sql`
      INSERT INTO ${LEAD_IDENTITIES_TABLE} (
        "id",
        "lead_id",
        "visitor_id",
        "link_source",
        "confidence"
      ) VALUES (
        ${randomUUID()},
        ${leadId},
        ${visitorId},
        ${linkSource},
        ${confidence}
      )
    `,
  );
};

export const linkHeuristicVisitors = async (
  tx: PoolClient,
  leadId: string,
  primaryVisitorId: string,
  ipHash: string,
  uaHash: string,
): Promise<number> => {
  if (!env.ENABLE_HEURISTIC_LINKING) {
    return 0;
  }

  const windowStart = new Date(
    Date.now() - env.HEURISTIC_LINK_WINDOW_MINUTES * 60 * 1000,
  );

  const { rows: heuristicCandidates } = await query<{ id: string }>(
    tx,
    sql`
      SELECT "id"
      FROM ${VISITORS_TABLE}
      WHERE "id" != ${primaryVisitorId}
        AND "last_seen_at" >= ${windowStart}
        AND "last_ip_hash" = ${ipHash}
        AND "last_ua_hash" = ${uaHash}
      ORDER BY "last_seen_at" DESC
      LIMIT 20
    `,
  );

  const candidateVisitorIds = heuristicCandidates.map(({ id }) => id);
  if (candidateVisitorIds.length === 0) {
    return 0;
  }

  // updateMany equivalent
  // Update existing links if confidence < 0.35
  await query(
    tx,
    sql`
      UPDATE ${LEAD_IDENTITIES_TABLE}
      SET
        "confidence" = 0.35,
        "linked_at" = NOW()
      WHERE "lead_id" = ${leadId}
        AND "link_source" = ${LinkSource.same_ip_ua_window}
        AND "visitor_id" = ANY(${candidateVisitorIds})
        AND "confidence" < 0.35
    `,
  );

  const linkIds = candidateVisitorIds.map(() => randomUUID());

  // createMany equivalent (skipDuplicates)
  // Insert new links if they don't exist
  // We use UNNEST to bulk insert
  await query(
    tx,
    sql`
      INSERT INTO ${LEAD_IDENTITIES_TABLE} (
        "id",
        "lead_id",
        "visitor_id",
        "link_source",
        "confidence"
      )
      SELECT
        l_id,
        ${leadId},
        v_id,
        ${LinkSource.same_ip_ua_window},
        0.35
      FROM UNNEST(${linkIds}::uuid[], ${candidateVisitorIds}::text[]) AS t(l_id, v_id)
      ON CONFLICT DO NOTHING
    `,
  );

  return candidateVisitorIds.length;
};
