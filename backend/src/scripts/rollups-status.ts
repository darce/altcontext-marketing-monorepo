import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { getRollupFreshness } from "../services/metrics/rollups.js";

const parsePropertyId = (argv: string[]): string => {
  const propertyArg = argv.find((entry) => entry.startsWith("--property-id="));
  if (!propertyArg) {
    return env.ROLLUP_DEFAULT_PROPERTY_ID;
  }

  const value = propertyArg.split("=", 2)[1]?.trim();
  if (!value) {
    return env.ROLLUP_DEFAULT_PROPERTY_ID;
  }

  return value;
};

const run = async (): Promise<void> => {
  const propertyId = parsePropertyId(process.argv.slice(2));

  const freshness = await getRollupFreshness(prisma, propertyId);
  const totalMetricRows = await prisma.dailyMetricRollup.count({
    where: { propertyId },
  });
  const totalIngestRows = await prisma.dailyIngestRollup.count({
    where: { propertyId },
  });

  console.log(`propertyId: ${propertyId}`);
  console.log(`dailyMetricRollups: ${totalMetricRows}`);
  console.log(`dailyIngestRollups: ${totalIngestRows}`);
  console.log(
    `rolledUpThrough: ${freshness.rolledUpThrough ?? "none"} (lagDays=${freshness.lagDays ?? "n/a"})`,
  );
  console.log(`generatedAt: ${freshness.generatedAt ?? "n/a"}`);
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Rollup status failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
