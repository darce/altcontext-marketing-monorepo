import { createHash } from "node:crypto";
import { prisma } from "./prisma.js";
import { getKeyPrefix } from "../../src/services/api-keys.js";

export const TEST_TENANT_ID = "00000000-0000-4000-a000-000000000001";
export const TEST_INGEST_KEY = "akt_test_ingest_key_1234567890";
export const TEST_ADMIN_KEY = "akt_test_admin_key_1234567890";

const hashKey = (key: string): string =>
  createHash("sha256").update(key).digest("hex");

export const resetDatabase = async (): Promise<void> => {
  await prisma.dailyIngestRollup.deleteMany();
  await prisma.dailyMetricRollup.deleteMany();
  await prisma.ingestRejection.deleteMany();
  await prisma.consentEvent.deleteMany();
  await prisma.formSubmission.deleteMany();
  await prisma.event.deleteMany();
  await prisma.leadIdentity.deleteMany();
  await prisma.session.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.visitor.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  // Seed test tenant
  await prisma.tenant.create({
    data: {
      id: TEST_TENANT_ID,
      name: "Test Tenant",
      slug: "test-tenant",
    },
  });

  // Seed test API keys
  await prisma.apiKey.createMany({
    data: [
      {
        id: "00000000-0000-4000-b000-000000000001",
        tenantId: TEST_TENANT_ID,
        keyHash: hashKey(TEST_INGEST_KEY),
        keyPrefix: getKeyPrefix(TEST_INGEST_KEY),
        label: "Test Ingest Key",
        scope: "ingest",
      },
      {
        id: "00000000-0000-4000-b000-000000000002",
        tenantId: TEST_TENANT_ID,
        keyHash: hashKey(TEST_ADMIN_KEY),
        keyPrefix: getKeyPrefix(TEST_ADMIN_KEY),
        label: "Test Admin Key",
        scope: "admin",
      },
    ],
  });
};

export const closeDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
};
