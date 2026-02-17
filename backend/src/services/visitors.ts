import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { env } from "../config/env.js";
import { query, sql } from "../lib/db.js";
import { tableRef } from "../lib/sql.js";
import type { RequestContext } from "../lib/request-context.js";
import type { Session, Visitor } from "../lib/types.js";
import type { UtmInput } from "../schemas/shared.js";

const VISITORS_TABLE = tableRef("visitors");
const SESSIONS_TABLE = tableRef("sessions");

export interface AttributionInput {
  path?: string | undefined;
  referrer?: string | undefined;
  utm?: UtmInput | undefined;
}

interface EnsureVisitorSessionInput extends AttributionInput {
  tenantId: string;
  anonId: string;
  occurredAt: Date;
  request: RequestContext;
}

// Map snake_case DB rows to camelCase domain objects
interface VisitorRow {
  id: string;
  tenant_id: string;
  anon_id: string;
  first_seen_at: Date;
  last_seen_at: Date;
  first_ip_hash: string;
  last_ip_hash: string;
  first_ua_hash: string;
  last_ua_hash: string;
  created_at: Date;
  updated_at: Date;
}

interface SessionRow {
  id: string;
  tenant_id: string;
  visitor_id: string;
  started_at: Date;
  ended_at: Date | null;
  last_event_at: Date;
  landing_path: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  created_at: Date;
  updated_at: Date;
}

const mapVisitor = (row: VisitorRow): Visitor => ({
  id: row.id,
  tenantId: row.tenant_id,
  anonId: row.anon_id,
  firstSeenAt: row.first_seen_at,
  lastSeenAt: row.last_seen_at,
  firstIpHash: row.first_ip_hash,
  lastIpHash: row.last_ip_hash,
  firstUaHash: row.first_ua_hash,
  lastUaHash: row.last_ua_hash,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapSession = (row: SessionRow): Session => ({
  id: row.id,
  tenantId: row.tenant_id,
  visitorId: row.visitor_id,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  lastEventAt: row.last_event_at,
  landingPath: row.landing_path,
  referrer: row.referrer,
  utmSource: row.utm_source,
  utmMedium: row.utm_medium,
  utmCampaign: row.utm_campaign,
  utmTerm: row.utm_term,
  utmContent: row.utm_content,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeOptional = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const hasUtmChanged = (
  session: Session,
  utm?: AttributionInput["utm"],
): boolean => {
  const next = {
    source: normalizeOptional(utm?.source),
    medium: normalizeOptional(utm?.medium),
    campaign: normalizeOptional(utm?.campaign),
    term: normalizeOptional(utm?.term),
    content: normalizeOptional(utm?.content),
  };

  return (
    session.utmSource !== next.source ||
    session.utmMedium !== next.medium ||
    session.utmCampaign !== next.campaign ||
    session.utmTerm !== next.term ||
    session.utmContent !== next.content
  );
};

const shouldStartNewSession = (
  existingSession: Session | null,
  occurredAt: Date,
  utm?: AttributionInput["utm"],
): boolean => {
  if (!existingSession) {
    return true;
  }

  const inactivityMs = env.SESSION_INACTIVITY_MINUTES * 60 * 1000;
  const elapsedMs =
    occurredAt.getTime() - existingSession.lastEventAt.getTime();
  if (elapsedMs > inactivityMs) {
    return true;
  }

  return hasUtmChanged(existingSession, utm);
};

const createSession = async (
  tx: PoolClient,
  tenantId: string,
  visitorId: string,
  occurredAt: Date,
  input: AttributionInput,
): Promise<Session> => {
  const { rows } = await query<SessionRow>(
    tx,
    sql`
      INSERT INTO ${SESSIONS_TABLE} (
        "id",
        "tenant_id",
        "visitor_id",
        "started_at",
        "last_event_at",
        "landing_path",
        "referrer",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "created_at",
        "updated_at"
      ) VALUES (
        ${randomUUID()},
        ${tenantId},
        ${visitorId},
        ${occurredAt},
        ${occurredAt},
        ${normalizeOptional(input.path)},
        ${normalizeOptional(input.referrer)},
        ${normalizeOptional(input.utm?.source)},
        ${normalizeOptional(input.utm?.medium)},
        ${normalizeOptional(input.utm?.campaign)},
        ${normalizeOptional(input.utm?.term)},
        ${normalizeOptional(input.utm?.content)},
        NOW(),
        NOW()
      ) RETURNING *
    `,
  );
  if (!rows[0]) throw new Error("Failed to create session");
  return mapSession(rows[0]);
};

const updateSession = async (
  tx: PoolClient,
  sessionId: string,
  occurredAt: Date,
): Promise<Session> => {
  const { rows } = await query<SessionRow>(
    tx,
    sql`
      UPDATE ${SESSIONS_TABLE}
      SET
        "last_event_at" = ${occurredAt},
        "ended_at" = ${occurredAt},
        "updated_at" = NOW()
      WHERE "id" = ${sessionId}
      RETURNING *
    `,
  );
  if (!rows[0]) throw new Error("Failed to update session");
  return mapSession(rows[0]);
};

export const ensureVisitorSession = async (
  tx: PoolClient,
  input: EnsureVisitorSessionInput,
): Promise<{ visitor: Visitor; session: Session }> => {
  // Visitor upsert
  const { rows: visitorRows } = await query<VisitorRow>(
    tx,
    sql`
      INSERT INTO ${VISITORS_TABLE} (
        "id",
        "tenant_id",
        "anon_id",
        "first_seen_at",
        "last_seen_at",
        "first_ip_hash",
        "last_ip_hash",
        "first_ua_hash",
        "last_ua_hash",
        "created_at",
        "updated_at"
      ) VALUES (
        ${randomUUID()},
        ${input.tenantId},
        ${input.anonId},
        ${input.occurredAt},
        ${input.occurredAt},
        ${input.request.ipHash},
        ${input.request.ipHash},
        ${input.request.uaHash},
        ${input.request.uaHash},
        NOW(),
        NOW()
      )
      ON CONFLICT ("tenant_id", "anon_id") DO UPDATE SET
        "last_seen_at" = ${input.occurredAt},
        "last_ip_hash" = ${input.request.ipHash},
        "last_ua_hash" = ${input.request.uaHash},
        "updated_at" = NOW()
      RETURNING *
    `,
  );
  if (!visitorRows[0]) throw new Error("Failed to ensure visitor");
  const visitor = mapVisitor(visitorRows[0]);

  // Find latest session
  const { rows: sessionRows } = await query<SessionRow>(
    tx,
    sql`
      SELECT * FROM ${SESSIONS_TABLE}
      WHERE "tenant_id" = ${input.tenantId}
        AND "visitor_id" = ${visitor.id}
      ORDER BY "started_at" DESC
      LIMIT 1
    `,
  );
  const latestSession =
    sessionRows.length > 0 && sessionRows[0]
      ? mapSession(sessionRows[0])
      : null;

  let session: Session;
  if (shouldStartNewSession(latestSession, input.occurredAt, input.utm)) {
    if (latestSession && latestSession.endedAt === null) {
      await query(
        tx,
        sql`
          UPDATE ${SESSIONS_TABLE}
          SET "ended_at" = ${latestSession.lastEventAt}
          WHERE "id" = ${latestSession.id}
        `,
      );
    }
    session = await createSession(
      tx,
      input.tenantId,
      visitor.id,
      input.occurredAt,
      input,
    );
  } else if (latestSession) {
    session = await updateSession(tx, latestSession.id, input.occurredAt);
  } else {
    // Fallback if no latestSession but shouldStartNewSession returned false (logic guard)
    session = await createSession(
      tx,
      input.tenantId,
      visitor.id,
      input.occurredAt,
      input,
    );
  }

  return { visitor, session };
};
