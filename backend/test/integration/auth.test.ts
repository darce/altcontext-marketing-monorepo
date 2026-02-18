import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { FastifyInstance } from "fastify";

import { createApp } from "../../src/app.js";
import { hashPassword } from "../../src/services/auth.js";
import { prisma } from "../helpers/prisma.js";
import { closeDatabase, resetDatabase, TEST_TENANT_ID } from "../helpers/db.js";

const TEST_EMAIL = "owner@test-tenant.local";
const TEST_PASSWORD = "test-password-123";
const TEST_TENANT_SLUG = "test-tenant";

let app: FastifyInstance;

const toCookieHeader = (setCookieHeader: string): string => {
  const match = /ac_session=([^;]+)/.exec(setCookieHeader);
  if (!match) {
    throw new Error("missing ac_session cookie");
  }
  return `ac_session=${match[1]}`;
};

before(async () => {
  app = await createApp();
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();

  await prisma.user.create({
    data: {
      tenantId: TEST_TENANT_ID,
      email: TEST_EMAIL,
      role: "owner",
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
});

after(async () => {
  await app.close();
  await closeDatabase();
});

test("POST /v1/auth/login returns a session cookie and /v1/auth/me resolves user", async () => {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress: "10.0.0.1",
    payload: {
      tenantSlug: TEST_TENANT_SLUG,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });

  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.json<{ ok: boolean }>().ok, true);

  const setCookie = loginResponse.headers["set-cookie"];
  assert.equal(typeof setCookie, "string");
  assert.match(setCookie, /ac_session=/);
  assert.match(setCookie, /HttpOnly/i);
  const cookieHeader = toCookieHeader(setCookie);

  const meResponse = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie: cookieHeader },
  });

  assert.equal(meResponse.statusCode, 200);
  const meBody = meResponse.json<{
    ok: boolean;
    user: { email: string; role: string };
    tenant: { id: string };
  }>();
  assert.equal(meBody.ok, true);
  assert.equal(meBody.user.email, TEST_EMAIL);
  assert.equal(meBody.user.role, "owner");
  assert.equal(meBody.tenant.id, TEST_TENANT_ID);
});

test("POST /v1/auth/login rejects invalid credentials", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress: "10.0.0.2",
    payload: {
      tenantSlug: TEST_TENANT_SLUG,
      email: TEST_EMAIL,
      password: "wrong-password",
    },
  });

  assert.equal(response.statusCode, 401);
  assert.equal(
    response.json<{ ok: boolean; error: string }>().error,
    "invalid_credentials",
  );
});

test("POST /v1/auth/logout clears session", async () => {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress: "10.0.0.3",
    payload: {
      tenantSlug: TEST_TENANT_SLUG,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });

  const cookieHeader = loginResponse.headers["set-cookie"];
  assert.equal(typeof cookieHeader, "string");
  const cookie = toCookieHeader(cookieHeader);

  const logoutResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/logout",
    headers: { cookie },
  });
  assert.equal(logoutResponse.statusCode, 200);

  const meResponse = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie },
  });
  assert.equal(meResponse.statusCode, 401);
});

test("GET /v1/metrics/summary accepts dashboard session cookie auth", async () => {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress: "10.0.0.4",
    payload: {
      tenantSlug: TEST_TENANT_SLUG,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });

  const cookieHeader = loginResponse.headers["set-cookie"];
  assert.equal(typeof cookieHeader, "string");
  const cookie = toCookieHeader(cookieHeader);

  const metricsResponse = await app.inject({
    method: "GET",
    url: "/v1/metrics/summary?from=2026-02-01&to=2026-02-07",
    headers: { cookie },
  });

  assert.equal(metricsResponse.statusCode, 200);
  assert.equal(metricsResponse.json<{ ok: boolean }>().ok, true);
});

test("GET /v1/auth/me returns 401 after session expiry", async () => {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress: "10.0.0.5",
    payload: {
      tenantSlug: TEST_TENANT_SLUG,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });

  const cookieHeader = loginResponse.headers["set-cookie"];
  assert.equal(typeof cookieHeader, "string");
  const cookie = toCookieHeader(cookieHeader);
  await prisma.$executeRaw`
    UPDATE auth_sessions
    SET expires_at = NOW() - INTERVAL '1 minute'
    WHERE tenant_id = ${TEST_TENANT_ID}::uuid
  `;

  const meResponse = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie },
  });

  assert.equal(meResponse.statusCode, 401);
});

test("POST /v1/auth/login rate limits repeated failures", async () => {
  const failingPayload = {
    tenantSlug: TEST_TENANT_SLUG,
    email: TEST_EMAIL,
    password: "wrong-password",
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: failingPayload,
      remoteAddress: "10.0.0.99",
    });
    assert.equal(response.statusCode, 401);
  }

  const limited = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: failingPayload,
    remoteAddress: "10.0.0.99",
  });
  assert.equal(limited.statusCode, 429);
});

test("POST /v1/auth/login sets expected cookie flags in test environment", async () => {
  const loginResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress: "10.0.0.7",
    payload: {
      tenantSlug: TEST_TENANT_SLUG,
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });

  const setCookie = loginResponse.headers["set-cookie"];
  assert.equal(typeof setCookie, "string");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /Secure/i);
});
