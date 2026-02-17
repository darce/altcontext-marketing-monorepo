import type { PoolClient } from "pg";

import { toJsonValue } from "../lib/json.js";
import { normalizeEmail } from "../lib/normalize.js";
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
import { ingestEvent } from "./events.js";
import { linkHeuristicVisitors, linkLeadToVisitor } from "./identity.js";
import { ensureVisitorSession } from "./visitors.js";

const LEADS_TABLE = tableRef("leads");
const FORM_SUBMISSIONS_TABLE = tableRef("form_submissions");

// Mapper
interface LeadRow {
  id: string;
  tenant_id: string;
  email_normalized: string;
  email_domain: string | null;
  consent_status: ConsentStatus;
  first_captured_at: Date;
  last_captured_at: Date;
  source_channel: string | null;
  created_at: Date;
  updated_at: Date;
  is_new?: boolean;
}

const mapLead = (row: LeadRow): LeadType => ({
  id: row.id,
  tenantId: row.tenant_id,
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
  tenantId: string,
  body: LeadCaptureBody,
  context: RequestContext,
): Promise<LeadCaptureResult> => {
  const occurredAt = new Date();
  const { visitor, session } = await ensureVisitorSession(tx, {
    tenantId,
    anonId: body.anonId,
    occurredAt,
    request: context,
    path: body.path,
    referrer: body.referrer,
    utm: body.utm,
  });

  const emailNormalized = normalizeEmail(body.email);
  const sourceChannel = body.sourceChannel ?? null;
  const initialConsent = toConsentStatus(body.consentStatus);

  // Upsert Lead
  const { rows: leadRows } = await query<LeadRow>(
    tx,
    sql`
      INSERT INTO ${LEADS_TABLE} (
        "tenant_id",
        "email_normalized",
        "source_channel",
        "first_captured_at",
        "last_captured_at",
        "consent_status",
        "created_at",
        "updated_at"
      ) VALUES (
        ${tenantId},
        ${emailNormalized},
        ${sourceChannel},
        ${occurredAt},
        ${occurredAt},
        ${initialConsent},
        NOW(),
        NOW()
      )
      ON CONFLICT ("tenant_id", "email_normalized") DO UPDATE SET
        "source_channel" = ${sourceChannel},
        "last_captured_at" = ${occurredAt},
        "updated_at" = NOW()
      RETURNING *, ("xmax" = 0) AS is_new
    `,
  );
  if (!leadRows[0]) throw new Error("Failed to capture lead");
  const lead = mapLead(leadRows[0]);

  // Create Event (form_submit)
  // [B2] call ingestEvent to ensure full enrichment (traffic source, device, dedupe, metrics)
  await ingestEvent(
    tx,
    tenantId,
    {
      anonId: body.anonId,
      eventType: "form_submit",
      path: body.path ?? "/",
      referrer: body.referrer,
      timestamp: occurredAt,
      utm: body.utm,
      traffic: {
        isConversion: true,
      },
      props: {
        formName: body.formName,
        sourceChannel: body.sourceChannel ?? null,
      },
    },
    context,
  );

  const [, heuristicLinksCreated] = await Promise.all([
    linkLeadToVisitor(
      tx,
      tenantId,
      lead.id,
      visitor.id,
      LinkSource.form_submit,
      1,
    ),
    linkHeuristicVisitors(
      tx,
      tenantId,
      lead.id,
      visitor.id,
      context.ipHash,
      context.uaHash,
    ),
  ]);

  // Create FormSubmission
  // [B3] JSON.stringify props and add ::jsonb cast
  const payload = toJsonValue(body.payload);
  const serializedPayload = payload ? JSON.stringify(payload) : null;
  await query(
    tx,
    sql`
      INSERT INTO ${FORM_SUBMISSIONS_TABLE} (
        "tenant_id",
        "lead_id",
        "visitor_id",
        "session_id",
        "form_name",
        "submitted_at",
        "validation_status",
        "payload",
        "created_at"
      ) VALUES (
        ${tenantId},
        ${lead.id},
        ${visitor.id},
        ${session.id},
        ${body.formName},
        ${occurredAt},
        ${ValidationStatus.accepted},
        ${serializedPayload}::jsonb,
        NOW()
      )
    `,
  );

  await applyConsentStatus(
    tx,
    tenantId,
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
  tenantId: string,
  email: string,
  context: RequestContext,
): Promise<{ found: boolean }> => {
  const emailNormalized = normalizeEmail(email);
  const { rows } = await query<{ id: string; consent_status: ConsentStatus }>(
    tx,
    sql`
      SELECT "id", "consent_status"
      FROM ${LEADS_TABLE}
      WHERE "tenant_id" = ${tenantId}
        AND "email_normalized" = ${emailNormalized}
    `,
  );
  const lead = rows[0];

  if (!lead) {
    return { found: false };
  }

  await applyConsentStatus(
    tx,
    tenantId,
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
  tenantId: string,
  email: string,
): Promise<{ deleted: boolean }> => {
  const emailNormalized = normalizeEmail(email);
  const { rows } = await query<{ id: string }>(
    tx,
    sql`
      SELECT "id"
      FROM ${LEADS_TABLE}
      WHERE "tenant_id" = ${tenantId}
        AND "email_normalized" = ${emailNormalized}
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
      WHERE "tenant_id" = ${tenantId}
        AND "lead_id" = ${lead.id}
    `,
  );

  await query(
    tx,
    sql`
      DELETE FROM ${LEADS_TABLE}
      WHERE "tenant_id" = ${tenantId}
        AND "id" = ${lead.id}
    `,
  );
  return { deleted: true };
};
