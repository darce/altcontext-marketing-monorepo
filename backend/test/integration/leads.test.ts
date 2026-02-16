import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createApp } from "../../src/app.js";
import { closeDatabase, resetDatabase } from "../helpers/db.js";
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

test("POST /v1/leads/capture creates a new lead", async () => {
  const payload = {
    email: "test@example.com",
    anonId: "anon-lead-12345678",
    formName: "signup",
    sourceChannel: "organic",
    consentStatus: "pending",
  };

  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    payload,
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.ok(body.leadId);

  const lead = await prisma.lead.findUnique({
    where: { id: body.leadId },
  });
  assert.ok(lead);
  assert.equal(lead.emailNormalized, "test@example.com");
  assert.equal(lead.sourceChannel, "organic");
});

test("POST /v1/leads/capture updates existing lead (dedupe)", async () => {
  // First capture
  await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    payload: {
      email: "duplicate@example.com",
      anonId: "anon-visitor-001",
      sourceChannel: "initial",
    },
  });

  // Second capture with same email
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    payload: {
      email: "duplicate@example.com",
      anonId: "anon-visitor-002", // Different visitor
      sourceChannel: "updated",
    },
  });

  assert.equal(res.statusCode, 200);

  // Should have only 1 lead
  const count = await prisma.lead.count();
  assert.equal(count, 1);

  const lead = await prisma.lead.findFirst();
  assert.equal(lead?.sourceChannel, "updated"); // Should update
});

test("POST /v1/leads/capture handles honeypot", async () => {
  const payload = {
    email: "bot@example.com",
    anonId: "anon-bot",
    honeypot: "spam",
  };

  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    payload,
  });

  assert.equal(res.statusCode, 202);

  const count = await prisma.lead.count();
  assert.equal(count, 0);
});

test("POST /v1/leads/capture rejects invalid email", async () => {
  const payload = {
    email: "not-an-email",
    anonId: "anon-invalid-email",
    formName: "signup",
  };

  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    payload,
  });

  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_request");
  assert.ok(body.issues.some((i: any) => i.path === "email"));
});
