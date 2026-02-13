import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEnvironment } from "../../src/config/env.js";

const baseEnv: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://example@localhost:5432/example",
  IP_HASH_PEPPER: "0123456789abcdef0123456789abcdef",
};

test("parseEnvironment applies defaults for optional values", () => {
  const parsed = parseEnvironment(baseEnv);

  assert.equal(parsed.NODE_ENV, "development");
  assert.equal(parsed.HOST, "0.0.0.0");
  assert.equal(parsed.PORT, 3000);
  assert.equal(parsed.LOG_LEVEL, "info");
  assert.equal(parsed.RATE_LIMIT_MAX, 120);
  assert.equal(parsed.RATE_LIMIT_TIME_WINDOW, "1 minute");
  assert.equal(parsed.SESSION_INACTIVITY_MINUTES, 30);
  assert.equal(parsed.HEURISTIC_LINK_WINDOW_MINUTES, 15);
  assert.equal(parsed.ENABLE_HEURISTIC_LINKING, true);
  assert.deepEqual(parsed.CORS_ALLOWED_ORIGINS, []);
  assert.equal(parsed.ADMIN_API_KEY, undefined);
  assert.equal(parsed.ROLLUP_BATCH_DAYS, 7);
  assert.equal(parsed.ROLLUP_DEFAULT_PROPERTY_ID, "default");
  assert.equal(parsed.METRICS_SUMMARY_CACHE_TTL_MS, 15000);
  assert.equal(parsed.METRICS_SUMMARY_CACHE_MAX_ENTRIES, 128);
  assert.equal(parsed.METRICS_USE_MATERIALIZED_VIEW, false);
  assert.equal(
    parsed.METRICS_MATERIALIZED_VIEW_NAME,
    "metrics_daily_summary_mv",
  );
  assert.equal(parsed.PRIVACY_CONTACT_EMAIL, "privacy@altcontext.local");
});

test("parseEnvironment handles boolean coercion flags", () => {
  const disabled = parseEnvironment({
    ...baseEnv,
    ENABLE_HEURISTIC_LINKING: "off",
    METRICS_USE_MATERIALIZED_VIEW: "off",
  });
  const enabled = parseEnvironment({
    ...baseEnv,
    ENABLE_HEURISTIC_LINKING: "yes",
    METRICS_USE_MATERIALIZED_VIEW: "yes",
  });

  assert.equal(disabled.ENABLE_HEURISTIC_LINKING, false);
  assert.equal(enabled.ENABLE_HEURISTIC_LINKING, true);
  assert.equal(disabled.METRICS_USE_MATERIALIZED_VIEW, false);
  assert.equal(enabled.METRICS_USE_MATERIALIZED_VIEW, true);
});

test("parseEnvironment parses comma-separated CORS origins", () => {
  const parsed = parseEnvironment({
    ...baseEnv,
    CORS_ALLOWED_ORIGINS: "https://altcontext.com, https://www.altcontext.com ",
  });

  assert.deepEqual(parsed.CORS_ALLOWED_ORIGINS, [
    "https://altcontext.com",
    "https://www.altcontext.com",
  ]);
});

test("parseEnvironment rejects invalid values", () => {
  assert.throws(() =>
    parseEnvironment({
      ...baseEnv,
      PORT: "70000",
    }),
  );

  assert.throws(() =>
    parseEnvironment({
      ...baseEnv,
      IP_HASH_PEPPER: "too-short",
    }),
  );

  assert.throws(() =>
    parseEnvironment({
      ...baseEnv,
      PRIVACY_CONTACT_EMAIL: "invalid-email",
    }),
  );

  assert.throws(() =>
    parseEnvironment({
      ...baseEnv,
      ADMIN_API_KEY: "too-short",
    }),
  );

  assert.throws(() =>
    parseEnvironment({
      ...baseEnv,
      ROLLUP_BATCH_DAYS: "0",
    }),
  );

  assert.throws(() =>
    parseEnvironment({
      ...baseEnv,
      METRICS_SUMMARY_CACHE_TTL_MS: "-1",
    }),
  );
});
