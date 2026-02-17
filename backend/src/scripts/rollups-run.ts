import { env } from "../config/env.js";
import { pool, withOwnerRole } from "../lib/db.js";
import { addUtcDays, formatIsoDay, startOfUtcDay } from "../schemas/metrics.js";
import { tryRefreshMetricsMaterializedView } from "../services/metrics/materialized-view.js";
import { rollupDateRange } from "../services/metrics/rollups.js";

const run = async (): Promise<void> => {
  const to = startOfUtcDay(new Date());
  const from = addUtcDays(to, -(env.ROLLUP_BATCH_DAYS - 1));
  const tenantId =
    env.BOOTSTRAP_TENANT_ID ?? "00000000-0000-4000-a000-000000000001";

  const result = await withOwnerRole((client) =>
    rollupDateRange(client, {
      tenantId,
      from,
      to,
      propertyId: env.ROLLUP_DEFAULT_PROPERTY_ID,
      batchSize: env.ROLLUP_BATCH_DAYS,
    }),
  );

  console.log(
    `✅ Rollup run complete for ${result.propertyId}: ${formatIsoDay(from)} -> ${formatIsoDay(to)} (${result.dayCount} day(s)).`,
  );

  await withOwnerRole((client) => tryRefreshMetricsMaterializedView(client));
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Rollup run failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
