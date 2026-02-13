import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

const RAW_EVENT_RETENTION_DAYS = 90;

const run = async (): Promise<void> => {
  const cutoffDate = new Date(
    Date.now() - RAW_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  const result = await prisma.event.deleteMany({
    where: {
      timestamp: {
        lt: cutoffDate,
      },
    },
  });

  const orphanSessions = await prisma.session.deleteMany({
    where: {
      events: { none: {} },
      formSubmissions: { none: {} },
    },
  });

  const orphanVisitors = await prisma.visitor.deleteMany({
    where: {
      sessions: { none: {} },
      events: { none: {} },
      formSubmissions: { none: {} },
      leadIdentities: { none: {} },
    },
  });

  console.log(
    `✅ Retention purge complete. Removed ${result.count} event rows older than ${cutoffDate.toISOString()}.`,
  );
  console.log(
    `ℹ️ Removed ${orphanSessions.count} orphan sessions and ${orphanVisitors.count} orphan visitors.`,
  );
  console.log(
    "ℹ️ Raw IP retention is not applicable because only hashed IP values are stored.",
  );
  console.log(`ℹ️ Privacy contact: ${env.PRIVACY_CONTACT_EMAIL}`);
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Retention purge failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
