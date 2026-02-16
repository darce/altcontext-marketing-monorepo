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

test("POST /v1/events accepts valid event and persists it", async () => {
  const payload = {
    anonId: "anon-test-12345678",
    eventType: "page_view",
    path: "/pricing",
    timestamp: new Date().toISOString(),
    referrer: "https://google.com?q=test",
    traffic: {
      deviceType: "desktop",
      isEntrance: true,
    },
    props: {
      custom_prop: "value",
    },
  };

  const res = await app.inject({
    method: "POST",
    url: "/v1/events",
    payload,
  });

  assert.equal(res.statusCode, 202);
  const body = res.json();
  assert.equal(body.ok, true);

  // Verify persistence
  const event = await prisma.event.findFirst({
    where: { visitor: { anonId: payload.anonId } },
  });
  assert.ok(event);
  assert.equal(event.eventType, payload.eventType);
  assert.equal(event.path, payload.path);
  assert.equal(event.trafficSource, "organic_search"); // Derived from referrer
});

test("POST /v1/events rejects invalid payload", async () => {
  const payload = {
    anonId: "short", // too short (min 8)
    eventType: "", // empty
    // path missing
  };

  const res = await app.inject({
    method: "POST",
    url: "/v1/events",
    payload,
  });

  assert.equal(res.statusCode, 400);
  const body = res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, "invalid_request");
});

test("POST /v1/events silent success for honeypot", async () => {
  const payload = {
    anonId: "anon-honeypot-1234",
    eventType: "bot_event",
    path: "/secret",
    honeypot: "i_am_a_bot",
  };

  const res = await app.inject({
    method: "POST",
    url: "/v1/events",
    payload,
  });

  // Should return 202 Accepted (fake success)
  assert.equal(res.statusCode, 202);

  // Verify NOT persisted
  const count = await prisma.event.count({
    where: { visitor: { anonId: payload.anonId } },
  });
  assert.equal(count, 0);
});

test("POST /v1/events rate limit exceeded", async () => {
  const payload = {
    anonId: "anon-rate-limit-test",
    eventType: "page_view",
    path: "/",
  };

  // Route has max: 180 in events.ts. Inject 200 requests quickly.
  // We use a for loop with inject to simulate rapid requests.
  for (let i = 0; i < 200; i++) {
    await app.inject({
      method: "POST",
      url: "/v1/events",
      payload,
    });
  }

  // 121st request should be rate limited
  const res = await app.inject({
    method: "POST",
    url: "/v1/events",
    payload,
  });

  assert.equal(res.statusCode, 429);
  const body = res.json();
  assert.equal(body.ok, false);
});
