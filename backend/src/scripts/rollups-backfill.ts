import { env } from "../config/env.js";
import { pool } from "../lib/db.js";
import { parseRollupCliArgs, getRollupConfig } from "./lib/rollup-cli.js";
import { formatIsoDay } from "../schemas/metrics.js";
import { tryRefreshMetricsMaterializedView } from "../services/metrics/materialized-view.js";
import { rollupDateRange } from "../services/metrics/rollups.js";

const run = async (): Promise<void> => {
  const args = parseRollupCliArgs(process.argv.slice(2));

  const { from, to, propertyId } = getRollupConfig(args);

  const client = await pool.connect();
  let result;
  try {
    result = await rollupDateRange(client, {
      from,
      to,
      propertyId,
      batchSize: env.ROLLUP_BATCH_DAYS,
    });
  } finally {
    client.release();
  }

  console.log(
    `✅ Rolled up ${result.dayCount} day(s) for property ${result.propertyId}: ${formatIsoDay(from)} -> ${formatIsoDay(to)}`,
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
    console.error("❌ Rollup backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
