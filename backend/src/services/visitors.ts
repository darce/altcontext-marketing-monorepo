import type { Prisma, Session, Visitor } from "@prisma/client";

import { env } from "../config/env.js";
import type { RequestContext } from "../lib/request-context.js";
import type { UtmInput } from "../schemas/shared.js";

export interface AttributionInput {
  path?: string | undefined;
  referrer?: string | undefined;
  utm?: UtmInput | undefined;
}

interface EnsureVisitorSessionInput extends AttributionInput {
  anonId: string;
  occurredAt: Date;
  request: RequestContext;
}

const normalizeOptional = (value?: string): string | null => {
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
  tx: Prisma.TransactionClient,
  visitorId: string,
  occurredAt: Date,
  input: AttributionInput,
): Promise<Session> =>
  tx.session.create({
    data: {
      visitorId,
      startedAt: occurredAt,
      lastEventAt: occurredAt,
      landingPath: normalizeOptional(input.path),
      referrer: normalizeOptional(input.referrer),
      utmSource: normalizeOptional(input.utm?.source),
      utmMedium: normalizeOptional(input.utm?.medium),
      utmCampaign: normalizeOptional(input.utm?.campaign),
      utmTerm: normalizeOptional(input.utm?.term),
      utmContent: normalizeOptional(input.utm?.content),
    },
  });

const updateSession = async (
  tx: Prisma.TransactionClient,
  sessionId: string,
  occurredAt: Date,
): Promise<Session> =>
  tx.session.update({
    where: { id: sessionId },
    data: {
      lastEventAt: occurredAt,
      endedAt: occurredAt,
    },
  });

export const ensureVisitorSession = async (
  tx: Prisma.TransactionClient,
  input: EnsureVisitorSessionInput,
): Promise<{ visitor: Visitor; session: Session }> => {
  const visitor = await tx.visitor.upsert({
    where: { anonId: input.anonId },
    update: {
      lastSeenAt: input.occurredAt,
      lastIpHash: input.request.ipHash,
      lastUaHash: input.request.uaHash,
    },
    create: {
      anonId: input.anonId,
      firstSeenAt: input.occurredAt,
      lastSeenAt: input.occurredAt,
      firstIpHash: input.request.ipHash,
      lastIpHash: input.request.ipHash,
      firstUaHash: input.request.uaHash,
      lastUaHash: input.request.uaHash,
    },
  });

  const latestSession = await tx.session.findFirst({
    where: { visitorId: visitor.id },
    orderBy: { startedAt: "desc" },
  });

  let session: Session;
  if (shouldStartNewSession(latestSession, input.occurredAt, input.utm)) {
    session = await createSession(tx, visitor.id, input.occurredAt, input);
  } else if (latestSession) {
    session = await updateSession(tx, latestSession.id, input.occurredAt);
  } else {
    session = await createSession(tx, visitor.id, input.occurredAt, input);
  }

  return { visitor, session };
};
