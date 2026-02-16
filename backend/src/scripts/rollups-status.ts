import { env } from "../config/env.js";
import { pool, query, sql } from "../lib/db.js";
import { tableRef } from "../lib/sql.js";
import { getRollupFreshness } from "../services/metrics/rollups.js";

const METRICS_ROLLUP_TABLE = tableRef("daily_metric_rollups");
const INGEST_ROLLUP_TABLE = tableRef("daily_ingest_rollups");

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
  const client = await pool.connect();

  try {
    const freshness = await getRollupFreshness(client, propertyId);

    const { rows: metricRows } = await query<{ count: number }>(
      client,
      sql`SELECT COUNT(*)::int as count FROM ${METRICS_ROLLUP_TABLE} WHERE "property_id" = ${propertyId}`,
    );
    const totalMetricRows = metricRows[0]?.count ?? 0;

    const { rows: ingestRows } = await query<{ count: number }>(
      client,
      sql`SELECT COUNT(*)::int as count FROM ${INGEST_ROLLUP_TABLE} WHERE "property_id" = ${propertyId}`,
    );
    const totalIngestRows = ingestRows[0]?.count ?? 0;

    console.log(`propertyId: ${propertyId}`);
    console.log(`dailyMetricRollups: ${totalMetricRows}`);
    console.log(`dailyIngestRollups: ${totalIngestRows}`);
    console.log(
      `rolledUpThrough: ${freshness.rolledUpThrough ?? "none"} (lagDays=${freshness.lagDays ?? "n/a"})`,
    );
    console.log(`generatedAt: ${freshness.generatedAt ?? "n/a"}`);
  } finally {
    client.release();
  }
};

void run()
  .catch((error: unknown) => {
    console.error("❌ Rollup status failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
