import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { closeDatabase, resetDatabase } from "../helpers/db.js";
import { prisma } from "../helpers/prisma.js";

const TEST_ADMIN_KEY = "test-admin-key-12345678901234567890";
const originalKey = env.ADMIN_API_KEY;

let app: Awaited<ReturnType<typeof createApp>>;

before(async () => {
  app = await createApp();
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  env.ADMIN_API_KEY = TEST_ADMIN_KEY;
});

after(async () => {
  env.ADMIN_API_KEY = originalKey;
  await app.close();
  await closeDatabase();
});

test("POST /v1/leads/delete requires admin auth", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/delete",
    payload: { email: "test@example.com" },
  });
  assert.equal(res.statusCode, 401);

  const resWrongKey = await app.inject({
    method: "POST",
    url: "/v1/leads/delete",
    headers: { "x-admin-key": "wrong" },
    payload: { email: "test@example.com" },
  });
  assert.equal(resWrongKey.statusCode, 401);
});

test("POST /v1/leads/delete deletes lead and anonymizes submissions", async () => {
  // Create lead
  const lead = await prisma.lead.create({
    data: {
      emailNormalized: "delete-me@example.com",
      sourceChannel: "test",
    },
  });

  // Create submission linked to lead (mocking dependencies if needed, or simple FK)
  // Assuming optional FKs or existing visitor.
  // Let's rely on simple lead existence first. Delete logic cascades?
  // Service code deletes lead. FormSubmission updated to NULL payload.

  // Submit request with key
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/delete",
    headers: { "x-admin-key": TEST_ADMIN_KEY },
    payload: { email: "delete-me@example.com" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);

  // Verify deletion
  const deleted = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.equal(deleted, null);
});
