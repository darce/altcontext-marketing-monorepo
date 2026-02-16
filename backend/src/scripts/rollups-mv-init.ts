import { pool, transaction } from "../lib/db.js";
import {
  ensureMetricsMaterializedView,
  refreshMetricsMaterializedView,
} from "../services/metrics/materialized-view.js";

const parseShouldRefresh = (argv: string[]): boolean =>
  argv.some((entry) =>
    ["--refresh", "--refresh=true", "--refresh=1"].includes(entry),
  );

const run = async (): Promise<void> => {
  const shouldRefresh = parseShouldRefresh(process.argv.slice(2));

  await transaction(async (tx) => {
    await ensureMetricsMaterializedView(tx);
    console.log("✅ Materialized view initialized.");

    if (shouldRefresh) {
      await refreshMetricsMaterializedView(tx);
      console.log("✅ Materialized view refreshed.");
    }
  });
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Materialized-view init failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
