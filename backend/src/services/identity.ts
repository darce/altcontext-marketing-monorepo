import { LinkSource, type Prisma } from "@prisma/client";

import { env } from "../config/env.js";

export const linkLeadToVisitor = async (
  tx: Prisma.TransactionClient,
  leadId: string,
  visitorId: string,
  linkSource: LinkSource,
  confidence: number,
): Promise<void> => {
  const existing = await tx.leadIdentity.findFirst({
    where: { leadId, visitorId, linkSource },
  });

  if (existing) {
    if (existing.confidence >= confidence) {
      return;
    }
    await tx.leadIdentity.update({
      where: { id: existing.id },
      data: { confidence, linkedAt: new Date() },
    });
    return;
  }

  await tx.leadIdentity.create({
    data: {
      leadId,
      visitorId,
      linkSource,
      confidence,
    },
  });
};

export const linkHeuristicVisitors = async (
  tx: Prisma.TransactionClient,
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
  const heuristicCandidates = await tx.visitor.findMany({
    where: {
      id: { not: primaryVisitorId },
      lastSeenAt: { gte: windowStart },
      lastIpHash: ipHash,
      lastUaHash: uaHash,
    },
    take: 20,
    orderBy: { lastSeenAt: "desc" },
    select: { id: true },
  });

  const candidateVisitorIds = heuristicCandidates.map(({ id }) => id);
  if (candidateVisitorIds.length === 0) {
    return 0;
  }

  await tx.leadIdentity.updateMany({
    where: {
      leadId,
      linkSource: LinkSource.same_ip_ua_window,
      visitorId: { in: candidateVisitorIds },
      confidence: { lt: 0.35 },
    },
    data: {
      confidence: 0.35,
      linkedAt: new Date(),
    },
  });

  await tx.leadIdentity.createMany({
    data: candidateVisitorIds.map((visitorId) => ({
      leadId,
      visitorId,
      linkSource: LinkSource.same_ip_ua_window,
      confidence: 0.35,
    })),
    skipDuplicates: true,
  });

  return candidateVisitorIds.length;
};
