import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { toJsonValue } from "../lib/json.js";
import { normalizeEmail, toEmailDomain } from "../lib/normalize.js";
import type { RequestContext } from "../lib/request-context.js";
import {
  LinkSource,
  ValidationStatus,
  type ConsentStatus,
} from "../lib/schema-enums.js";
import type { Lead as LeadType } from "../lib/types.js";
import { query, sql } from "../lib/db.js";
import { tableRef } from "../lib/sql.js";
import type { LeadCaptureBody } from "../schemas/leads.js";
import { applyConsentStatus, toConsentStatus } from "./consent.js";
import { linkHeuristicVisitors, linkLeadToVisitor } from "./identity.js";
import { ensureVisitorSession } from "./visitors.js";

const LEADS_TABLE = tableRef("leads");
const EVENTS_TABLE = tableRef("events");
const FORM_SUBMISSIONS_TABLE = tableRef("form_submissions");

// Mapper
interface LeadRow {
  id: string;
  email_normalized: string;
  email_domain: string | null;
  consent_status: ConsentStatus;
  first_captured_at: Date;
  last_captured_at: Date;
  source_channel: string | null;
  created_at: Date;
  updated_at: Date;
}

const mapLead = (row: LeadRow): LeadType => ({
  id: row.id,
  emailNormalized: row.email_normalized,
  emailDomain: row.email_domain,
  consentStatus: row.consent_status,
  firstCapturedAt: row.first_captured_at,
  lastCapturedAt: row.last_captured_at,
  sourceChannel: row.source_channel,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export interface LeadCaptureResult {
  leadId: string;
  visitorId: string;
  sessionId: string;
  heuristicLinksCreated: number;
}

export const captureLead = async (
  tx: PoolClient,
  body: LeadCaptureBody,
  context: RequestContext,
): Promise<LeadCaptureResult> => {
  const occurredAt = new Date();
  const { visitor, session } = await ensureVisitorSession(tx, {
    anonId: body.anonId,
    occurredAt,
    request: context,
    path: body.path,
    referrer: body.referrer,
    utm: body.utm,
  });

  const emailNormalized = normalizeEmail(body.email);
  const emailDomain = toEmailDomain(emailNormalized);
  const sourceChannel = body.sourceChannel ?? null;
  const initialConsent = toConsentStatus(body.consentStatus);

  // Upsert Lead
  const { rows: leadRows } = await query<LeadRow>(
    tx,
    sql`
      INSERT INTO ${LEADS_TABLE} (
        "id",
        "email_normalized",
        "email_domain",
        "source_channel",
        "first_captured_at",
        "last_captured_at",
        "consent_status",
        "created_at",
        "updated_at"
      ) VALUES (
        ${randomUUID()},
        ${emailNormalized},
        ${emailDomain},
        ${sourceChannel},
        ${occurredAt},
        ${occurredAt},
        ${initialConsent},
        NOW(),
        NOW()
      )
      ON CONFLICT ("email_normalized") DO UPDATE SET
        "email_domain" = ${emailDomain},
        "source_channel" = ${sourceChannel},
        "last_captured_at" = ${occurredAt},
        "updated_at" = NOW()
      RETURNING *
    `,
  );
  if (!leadRows[0]) throw new Error("Failed to capture lead");
  const lead = mapLead(leadRows[0]);

  // Create Event (form_submit)
  const props = toJsonValue({
    formName: body.formName,
    sourceChannel: body.sourceChannel ?? null,
  });

  await query(
    tx,
    sql`
      INSERT INTO ${EVENTS_TABLE} (
        "id",
        "visitor_id",
        "session_id",
        "event_type",
        "path",
        "timestamp",
        "ip_hash",
        "ua_hash",
        "props"
      ) VALUES (
        ${randomUUID()},
        ${visitor.id},
        ${session.id},
        'form_submit',
        ${body.path ?? "/"},
        ${occurredAt},
        ${context.ipHash},
        ${context.uaHash},
        ${props}
      )
    `,
  );

  const [, heuristicLinksCreated] = await Promise.all([
    linkLeadToVisitor(tx, lead.id, visitor.id, LinkSource.form_submit, 1),
    linkHeuristicVisitors(
      tx,
      lead.id,
      visitor.id,
      context.ipHash,
      context.uaHash,
    ),
  ]);

  // Create FormSubmission
  const payload = toJsonValue(body.payload);
  await query(
    tx,
    sql`
      INSERT INTO ${FORM_SUBMISSIONS_TABLE} (
        "id",
        "lead_id",
        "visitor_id",
        "session_id",
        "form_name",
        "submitted_at",
        "validation_status",
        "payload",
        "created_at"
      ) VALUES (
        ${randomUUID()},
        ${lead.id},
        ${visitor.id},
        ${session.id},
        ${body.formName},
        ${occurredAt},
        ${ValidationStatus.accepted},
        ${payload},
        NOW()
      )
    `,
  );

  await applyConsentStatus(
    tx,
    lead.id,
    body.consentStatus
      ? toConsentStatus(body.consentStatus)
      : lead.consentStatus,
    "form_submit",
    context.ipHash,
    lead.consentStatus,
  );

  return {
    leadId: lead.id,
    visitorId: visitor.id,
    sessionId: session.id,
    heuristicLinksCreated,
  };
};

export const unsubscribeLead = async (
  tx: PoolClient,
  email: string,
  context: RequestContext,
): Promise<{ found: boolean }> => {
  const emailNormalized = normalizeEmail(email);
  const { rows } = await query<{ id: string; consent_status: ConsentStatus }>(
    tx,
    sql`
      SELECT "id", "consent_status"
      FROM ${LEADS_TABLE}
      WHERE "email_normalized" = ${emailNormalized}
    `,
  );
  const lead = rows[0];

  if (!lead) {
    return { found: false };
  }

  await applyConsentStatus(
    tx,
    lead.id,
    toConsentStatus("withdrawn"),
    "unsubscribe",
    context.ipHash,
    lead.consent_status,
  );
  return { found: true };
};

export const deleteLeadByEmail = async (
  tx: PoolClient,
  email: string,
): Promise<{ deleted: boolean }> => {
  const emailNormalized = normalizeEmail(email);
  const { rows } = await query<{ id: string }>(
    tx,
    sql`
      SELECT "id"
      FROM ${LEADS_TABLE}
      WHERE "email_normalized" = ${emailNormalized}
    `,
  );
  const lead = rows[0];

  if (!lead) {
    return { deleted: false };
  }

  await query(
    tx,
    sql`
      UPDATE ${FORM_SUBMISSIONS_TABLE}
      SET "payload" = NULL
      WHERE "lead_id" = ${lead.id}
    `,
  );

  await query(
    tx,
    sql`
      DELETE FROM ${LEADS_TABLE}
      WHERE "id" = ${lead.id}
    `,
  );
  return { deleted: true };
};
