import {
  LinkSource,
  Prisma,
  ValidationStatus,
  type Prisma as PrismaTypes,
} from "@prisma/client";

import { toPrismaJson } from "../lib/json.js";
import { normalizeEmail, toEmailDomain } from "../lib/normalize.js";
import type { RequestContext } from "../lib/request-context.js";
import type { LeadCaptureBody } from "../schemas/leads.js";
import { applyConsentStatus, toConsentStatus } from "./consent.js";
import { linkHeuristicVisitors, linkLeadToVisitor } from "./identity.js";
import { ensureVisitorSession } from "./visitors.js";

export interface LeadCaptureResult {
  leadId: string;
  visitorId: string;
  sessionId: string;
  heuristicLinksCreated: number;
}

export const captureLead = async (
  tx: PrismaTypes.TransactionClient,
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
  const lead = await tx.lead.upsert({
    where: { emailNormalized },
    update: {
      emailDomain: toEmailDomain(emailNormalized),
      sourceChannel: body.sourceChannel ?? null,
      lastCapturedAt: occurredAt,
    },
    create: {
      emailNormalized,
      emailDomain: toEmailDomain(emailNormalized),
      sourceChannel: body.sourceChannel ?? null,
      firstCapturedAt: occurredAt,
      lastCapturedAt: occurredAt,
      consentStatus: toConsentStatus(body.consentStatus),
    },
  });

  const eventData: PrismaTypes.EventCreateInput = {
    visitor: { connect: { id: visitor.id } },
    session: { connect: { id: session.id } },
    eventType: "form_submit",
    path: body.path ?? "/",
    timestamp: occurredAt,
    ipHash: context.ipHash,
    uaHash: context.uaHash,
  };
  const props = toPrismaJson({
    formName: body.formName,
    sourceChannel: body.sourceChannel ?? null,
  });
  if (props !== undefined) {
    eventData.props = props;
  }

  await tx.event.create({
    data: eventData,
  });

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

  const submissionData: PrismaTypes.FormSubmissionCreateInput = {
    lead: { connect: { id: lead.id } },
    visitor: { connect: { id: visitor.id } },
    session: { connect: { id: session.id } },
    formName: body.formName,
    submittedAt: occurredAt,
    validationStatus: ValidationStatus.accepted,
  };
  const payload = toPrismaJson(body.payload);
  if (payload !== undefined) {
    submissionData.payload = payload;
  }

  await tx.formSubmission.create({ data: submissionData });

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
  tx: PrismaTypes.TransactionClient,
  email: string,
  context: RequestContext,
): Promise<{ found: boolean }> => {
  const emailNormalized = normalizeEmail(email);
  const lead = await tx.lead.findUnique({
    where: { emailNormalized },
    select: { id: true, consentStatus: true },
  });
  if (!lead) {
    return { found: false };
  }

  await applyConsentStatus(
    tx,
    lead.id,
    toConsentStatus("withdrawn"),
    "unsubscribe",
    context.ipHash,
    lead.consentStatus,
  );
  return { found: true };
};

export const deleteLeadByEmail = async (
  tx: PrismaTypes.TransactionClient,
  email: string,
): Promise<{ deleted: boolean }> => {
  const emailNormalized = normalizeEmail(email);
  const lead = await tx.lead.findUnique({
    where: { emailNormalized },
    select: { id: true },
  });
  if (!lead) {
    return { deleted: false };
  }

  await tx.formSubmission.updateMany({
    where: { leadId: lead.id },
    data: { payload: Prisma.DbNull },
  });
  await tx.lead.delete({ where: { id: lead.id } });
  return { deleted: true };
};
