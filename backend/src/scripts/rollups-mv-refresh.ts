import { prisma } from "../lib/prisma.js";
import {
  isMaterializedViewMissingError,
  refreshMetricsMaterializedView,
} from "../services/metrics/materialized-view.js";

const run = async (): Promise<void> => {
  await refreshMetricsMaterializedView(prisma);
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
    await prisma.$disconnect();
  });
