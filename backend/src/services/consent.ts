import { ConsentStatus, type Prisma } from "@prisma/client";

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
  tx: Prisma.TransactionClient,
  leadId: string,
  nextStatus: ConsentStatus,
  source: string,
  ipHash?: string,
  currentStatus?: ConsentStatus,
): Promise<void> => {
  let existingStatus = currentStatus;
  if (!existingStatus) {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { consentStatus: true },
    });
    if (!lead) {
      return;
    }
    existingStatus = lead.consentStatus;
  }

  if (existingStatus !== nextStatus) {
    await tx.lead.update({
      where: { id: leadId },
      data: { consentStatus: nextStatus },
    });
  }

  await tx.consentEvent.create({
    data: {
      leadId,
      status: nextStatus,
      source,
      ipHash: ipHash ?? null,
    },
  });
};
