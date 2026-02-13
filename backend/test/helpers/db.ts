import { prisma } from "../../src/lib/prisma.js";

export const resetDatabase = async (): Promise<void> => {
  await prisma.webTrafficLog.deleteMany();
  await prisma.consentEvent.deleteMany();
  await prisma.formSubmission.deleteMany();
  await prisma.event.deleteMany();
  await prisma.leadIdentity.deleteMany();
  await prisma.session.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.visitor.deleteMany();
};

export const closeDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
