import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createApp } from "../../src/app.js";
import { closeDatabase, resetDatabase } from "../helpers/db.js";
import { prisma } from "../helpers/prisma.js";
import { ConsentStatus } from "../../src/lib/schema-enums.js";

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

test("POST /v1/leads/unsubscribe updates consent and logs event", async () => {
  // 1. Create lead
  const email = "unsubscribe-me@example.com";
  const lead = await prisma.lead.create({
    data: {
      emailNormalized: email,
      consentStatus: ConsentStatus.express,
    },
  });

  // 2. Unsubscribe
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/unsubscribe",
    payload: { email },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().ok, true);

  // 3. Verify consent status
  const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } });
  assert.equal(updatedLead?.consentStatus, ConsentStatus.withdrawn);

  // 4. Verify consent event
  const event = await prisma.consentEvent.findFirst({
    where: { leadId: lead.id, status: ConsentStatus.withdrawn },
  });
  assert.ok(event);
  assert.equal(event.source, "unsubscribe");
});

test("POST /v1/leads/unsubscribe returns 404 for nonexistent email", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/leads/unsubscribe",
    payload: { email: "nonexistent@example.com" },
  });

  assert.equal(res.statusCode, 404);
});
