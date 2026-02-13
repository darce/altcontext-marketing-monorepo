import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { parseRollupCliArgs } from "./lib/rollup-cli.js";
import {
  addUtcDays,
  formatIsoDay,
  parseIsoDay,
  startOfUtcDay,
} from "../schemas/metrics.js";
import {
  isMaterializedViewMissingError,
  refreshMetricsMaterializedView,
} from "../services/metrics/materialized-view.js";
import { rollupDateRange } from "../services/metrics/rollups.js";

const run = async (): Promise<void> => {
  const args = parseRollupCliArgs(process.argv.slice(2));

  const today = startOfUtcDay(new Date());
  const defaultFrom = addUtcDays(today, -(env.ROLLUP_BATCH_DAYS - 1));

  const from = args.from ? parseIsoDay(args.from) : defaultFrom;
  const to = args.to ? parseIsoDay(args.to) : today;
  const propertyId = args.propertyId ?? env.ROLLUP_DEFAULT_PROPERTY_ID;

  if (from.getTime() > to.getTime()) {
    throw new Error("--from must be before or equal to --to");
  }

  const result = await rollupDateRange(prisma, {
    from,
    to,
    propertyId,
    batchSize: env.ROLLUP_BATCH_DAYS,
  });

  console.log(
    `✅ Rolled up ${result.dayCount} day(s) for property ${result.propertyId}: ${formatIsoDay(from)} -> ${formatIsoDay(to)}`,
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
    console.error("❌ Rollup backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
