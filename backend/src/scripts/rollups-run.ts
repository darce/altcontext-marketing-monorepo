import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { addUtcDays, formatIsoDay, startOfUtcDay } from "../schemas/metrics.js";
import {
  isMaterializedViewMissingError,
  refreshMetricsMaterializedView,
} from "../services/metrics/materialized-view.js";
import { rollupDateRange } from "../services/metrics/rollups.js";

const run = async (): Promise<void> => {
  const to = startOfUtcDay(new Date());
  const from = addUtcDays(to, -(env.ROLLUP_BATCH_DAYS - 1));

  const result = await rollupDateRange(prisma, {
    from,
    to,
    propertyId: env.ROLLUP_DEFAULT_PROPERTY_ID,
    batchSize: env.ROLLUP_BATCH_DAYS,
  });

  console.log(
    `✅ Rollup run complete for ${result.propertyId}: ${formatIsoDay(from)} -> ${formatIsoDay(to)} (${result.dayCount} day(s)).`,
  );

  if (!env.METRICS_USE_MATERIALIZED_VIEW) {
    return;
  }

  try {
    await refreshMetricsMaterializedView(prisma);
    console.log("✅ Materialized view refreshed.");
  } catch (error: unknown) {
    if (isMaterializedViewMissingError(error)) {
      console.warn(
        "⚠️ Materialized view is enabled but not initialized. Run `npm run rollups:mv:init`.",
      );
      return;
    }

    throw error;
  }
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Rollup run failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
