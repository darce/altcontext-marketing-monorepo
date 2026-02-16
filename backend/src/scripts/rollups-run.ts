import { env } from "../config/env.js";
import { pool } from "../lib/db.js";
import { addUtcDays, formatIsoDay, startOfUtcDay } from "../schemas/metrics.js";
import { tryRefreshMetricsMaterializedView } from "../services/metrics/materialized-view.js";
import { rollupDateRange } from "../services/metrics/rollups.js";

const run = async (): Promise<void> => {
  const to = startOfUtcDay(new Date());
  const from = addUtcDays(to, -(env.ROLLUP_BATCH_DAYS - 1));

  const client = await pool.connect();
  let result;
  try {
    result = await rollupDateRange(client, {
      from,
      to,
      propertyId: env.ROLLUP_DEFAULT_PROPERTY_ID,
      batchSize: env.ROLLUP_BATCH_DAYS,
    });
  } finally {
    client.release();
  }

  console.log(
    `✅ Rollup run complete for ${result.propertyId}: ${formatIsoDay(from)} -> ${formatIsoDay(to)} (${result.dayCount} day(s)).`,
  );

  const refreshClient = await pool.connect();
  try {
    await tryRefreshMetricsMaterializedView(refreshClient);
  } finally {
    refreshClient.release();
  }
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Rollup run failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
