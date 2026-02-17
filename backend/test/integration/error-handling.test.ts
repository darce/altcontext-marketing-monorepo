import assert from "node:assert/strict";
import { test, after, before } from "node:test";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/lib/db.js";
import { TEST_INGEST_KEY, resetDatabase } from "../helpers/db.js";

before(async () => {
  await resetDatabase();
});

test("error handling: Zod validation error -> 400", async () => {
  const app = await createApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { "x-api-key": TEST_INGEST_KEY },
    payload: {
      // Empty payload should fail Zod validation
    },
  });

  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_request");
});

test("error handling: 500 internal error", async () => {
  const app = await createApp();

  // Register a route that throws an unhandled error
  app.get("/test-error", async () => {
    throw new Error("Simulated unhandled error");
  });

  const response = await app.inject({
    method: "GET",
    url: "/test-error",
    headers: { "x-api-key": TEST_INGEST_KEY },
  });

  assert.equal(response.statusCode, 500);
  const body = JSON.parse(response.body);
  assert.equal(body.ok, false);
  assert.equal(body.error, "internal_error");
});

test("error handling: 404 for unknown route", async () => {
  const app = await createApp();
  const response = await app.inject({
    method: "GET",
    url: "/v1/nonexistent",
  });

  assert.equal(response.statusCode, 404);
});

test("CORS preflight: valid origin", async () => {
  const app = await createApp();
  const response = await app.inject({
    method: "OPTIONS",
    url: "/v1/events",
    headers: {
      "access-control-request-method": "POST",
      origin: "https://altcontext.com",
    },
  });

  assert.equal(response.statusCode, 204);
  assert.equal(
    response.headers["access-control-allow-origin"],
    "https://altcontext.com",
  );
});

test("CORS: unknown origin not reflected", async () => {
  const app = await createApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: {
      "x-api-key": TEST_INGEST_KEY,
      origin: "https://evil.com",
    },
  });

  assert.notEqual(
    response.headers["access-control-allow-origin"],
    "https://evil.com",
  );
});

after(async () => {
  await pool.end();
});
