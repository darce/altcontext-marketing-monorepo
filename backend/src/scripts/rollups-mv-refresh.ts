import { pool, transaction } from "../lib/db.js";
import {
  isMaterializedViewMissingError,
  refreshMetricsMaterializedView,
} from "../services/metrics/materialized-view.js";

const run = async (): Promise<void> => {
  await transaction(async (tx) => {
    await refreshMetricsMaterializedView(tx);
  });
  console.log("✅ Materialized view refreshed.");
};

void run()
  .catch((error: unknown) => {
    if (isMaterializedViewMissingError(error)) {
      console.error(
        "❌ Materialized view does not exist. Run `npm run rollups:mv:init` first.",
      );
      process.exitCode = 1;
      return;
    }

    console.error("❌ Materialized-view refresh failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
