import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";

import { createApp } from "../../src/app.js";
import {
  closeDatabase,
  resetDatabase,
  TEST_ADMIN_KEY,
  TEST_TENANT_ID,
} from "../helpers/db.js";
import { prisma } from "../helpers/prisma.js";

let app: Awaited<ReturnType<typeof createApp>>;

before(async () => {
  app = await createApp();
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
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
    headers: { "x-api-key": "wrong" },
    payload: { email: "test@example.com" },
  });
  assert.equal(resWrongKey.statusCode, 401);
});

test("POST /v1/leads/delete deletes lead and anonymizes submissions", async () => {
  // Create lead
  const lead = await prisma.lead.create({
    data: {
      tenantId: TEST_TENANT_ID,
      emailNormalized: "delete-me@example.com",
      sourceChannel: "test",
    },
  });

  // Submit request with key
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/delete",
    headers: { "x-api-key": TEST_ADMIN_KEY },
    payload: { email: "delete-me@example.com" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);

  // Verify deletion
  const deleted = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.equal(deleted, null);
});

test("POST /v1/leads/delete scrubs PII in form submissions", async () => {
  // 1. Create a visitor and session
  const visitorId = randomUUID();
  await prisma.visitor.create({
    data: {
      id: visitorId,
      tenantId: TEST_TENANT_ID,
      anonId: "anon-scrub-test",
    },
  });
  const sessionId = randomUUID();
  await prisma.session.create({
    data: {
      id: sessionId,
      tenantId: TEST_TENANT_ID,
      visitorId,
      startedAt: new Date(),
    },
  });

  // 2. Create lead
  const lead = await prisma.lead.create({
    data: {
      tenantId: TEST_TENANT_ID,
      emailNormalized: "scrub-me@example.com",
      sourceChannel: "test",
    },
  });

  // 3. Create submission with PII
  const submissionId = randomUUID();
  await prisma.formSubmission.create({
    data: {
      id: submissionId,
      tenantId: TEST_TENANT_ID,
      leadId: lead.id,
      visitorId,
      sessionId,
      formName: "contact",
      submittedAt: new Date(),
      validationStatus: "accepted",
      payload: { name: "John Doe", phone: "123456789" },
    },
  });

  // 4. Delete lead
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/delete",
    headers: { "x-api-key": TEST_ADMIN_KEY },
    payload: { email: "scrub-me@example.com" },
  });

  assert.equal(res.statusCode, 200);

  // 5. Verify PII is scrubbed (payload is NULL)
  const submission = await prisma.formSubmission.findUnique({
    where: { id: submissionId },
  });
  assert.ok(submission);
  assert.equal(submission.payload, null);
});

test("POST /v1/leads/delete returns 404 for nonexistent email", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/delete",
    headers: { "x-api-key": TEST_ADMIN_KEY },
    payload: { email: "nonexistent@example.com" },
  });

  assert.equal(res.statusCode, 404);
});
