import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { performance } from "node:perf_hooks";

import { ConsentStatus, LinkSource } from "@prisma/client";
import type { FastifyInstance } from "fastify";

import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { closeDatabase, resetDatabase } from "../helpers/db.js";

interface EventsResponseBody {
  ok: boolean;
  eventId: string;
  visitorId: string;
  sessionId: string;
}

interface CaptureLeadResponseBody {
  ok: boolean;
  leadId: string;
  visitorId: string;
  sessionId: string;
  heuristicLinksCreated: number;
}

let app: FastifyInstance;

const requestHeaders = {
  "x-forwarded-for": "203.0.113.10",
  "user-agent": "backend-test-suite/1.0",
};

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

test("POST /v1/events stores validated events and returns 202", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: requestHeaders,
    payload: {
      anonId: "anon-events-001",
      eventType: "page_view",
      path: "/pricing",
      referrer: "https://example.com/",
      utm: {
        source: "newsletter",
      },
      props: {
        cta: "hero",
      },
      traffic: {
        propertyId: "marketing-site",
        host: "www.altcontext.dev",
        pageTitle: "Pricing",
        language: "en-CA",
        deviceType: "desktop",
        browserName: "Chrome",
        browserVersion: "122",
        osName: "macOS",
        osVersion: "14.7",
        countryCode: "ca",
        region: "Ontario",
        city: "Toronto",
        timezone: "America/Toronto",
        screenWidth: 2560,
        screenHeight: 1440,
        viewportWidth: 1512,
        viewportHeight: 920,
        engagedTimeMs: 5800,
        scrollDepthPercent: 65,
        isEntrance: true,
        webVitals: {
          fcpMs: 900,
          lcpMs: 1800,
          inpMs: 110,
          clsScore: 0.03,
          ttfbMs: 240,
        },
      },
    },
  });

  assert.equal(response.statusCode, 202);

  const body = response.json<EventsResponseBody>();
  assert.equal(body.ok, true);

  const event = await prisma.event.findUnique({
    where: { id: body.eventId },
    select: {
      eventType: true,
      path: true,
      ipHash: true,
      uaHash: true,
      visitor: {
        select: {
          id: true,
          anonId: true,
        },
      },
      session: {
        select: {
          id: true,
        },
      },
    },
  });

  assert.ok(event);
  assert.equal(event.eventType, "page_view");
  assert.equal(event.path, "/pricing");
  assert.equal(event.visitor.id, body.visitorId);
  assert.equal(event.visitor.anonId, "anon-events-001");
  assert.equal(event.session?.id, body.sessionId);
  assert.equal(event.ipHash?.length, 64);
  assert.equal(event.uaHash?.length, 64);

  const trafficLog = await prisma.webTrafficLog.findUnique({
    where: { eventId: body.eventId },
    select: {
      propertyId: true,
      host: true,
      path: true,
      trafficSource: true,
      pageTitle: true,
      countryCode: true,
      scrollDepthPercent: true,
      lcpMs: true,
      clsScore: true,
    },
  });

  assert.ok(trafficLog);
  assert.equal(trafficLog.propertyId, "marketing-site");
  assert.equal(trafficLog.host, "altcontext.dev");
  assert.equal(trafficLog.path, "/pricing");
  assert.equal(trafficLog.trafficSource, "campaign");
  assert.equal(trafficLog.pageTitle, "Pricing");
  assert.equal(trafficLog.countryCode, "CA");
  assert.equal(trafficLog.scrollDepthPercent, 65);
  assert.equal(trafficLog.lcpMs, 1800);
  assert.equal(trafficLog.clsScore, 0.03);
});

test("POST /v1/events returns 400 on invalid payload", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: requestHeaders,
    payload: {
      anonId: "short",
      path: "/",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json<{ ok: boolean; error: string }>().ok, false);
});

test("POST /v1/leads/capture normalizes email and creates identity + consent audit", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    headers: requestHeaders,
    payload: {
      email: "Person@Example.COM",
      anonId: "anon-lead-001",
      formName: "newsletter_signup",
      path: "/",
      sourceChannel: "website",
      consentStatus: "express",
      payload: {
        placement: "footer",
      },
    },
  });

  assert.equal(response.statusCode, 200);

  const body = response.json<CaptureLeadResponseBody>();
  assert.equal(body.ok, true);

  const lead = await prisma.lead.findUnique({
    where: { id: body.leadId },
    select: {
      emailNormalized: true,
      consentStatus: true,
    },
  });

  assert.ok(lead);
  assert.equal(lead.emailNormalized, "person@example.com");
  assert.equal(lead.consentStatus, ConsentStatus.express);

  const identity = await prisma.leadIdentity.findUnique({
    where: {
      leadId_visitorId_linkSource: {
        leadId: body.leadId,
        visitorId: body.visitorId,
        linkSource: LinkSource.form_submit,
      },
    },
    select: {
      confidence: true,
    },
  });

  assert.ok(identity);
  assert.equal(identity.confidence, 1);

  const submissions = await prisma.formSubmission.findMany({
    where: { leadId: body.leadId },
    select: { formName: true },
  });
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0]?.formName, "newsletter_signup");

  const consentEvents = await prisma.consentEvent.findMany({
    where: { leadId: body.leadId },
    select: {
      status: true,
      source: true,
    },
  });
  assert.equal(consentEvents.length, 1);
  assert.equal(consentEvents[0]?.status, ConsentStatus.express);
  assert.equal(consentEvents[0]?.source, "form_submit");
});

test("POST /v1/leads/capture returns 303 for form-url-encoded fallback", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    headers: {
      ...requestHeaders,
      "content-type": "application/x-www-form-urlencoded",
    },
    payload:
      "email=form%40example.com&anonId=anon-form-001&formName=newsletter_signup&path=%2Fthank-you",
  });

  assert.equal(response.statusCode, 303);
  assert.equal(response.headers.location, "/thank-you");
});

test("POST /v1/leads/unsubscribe sets consent to withdrawn", async () => {
  const captureResponse = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    headers: requestHeaders,
    payload: {
      email: "withdraw-me@example.com",
      anonId: "anon-lead-002",
      formName: "newsletter_signup",
      path: "/",
      consentStatus: "implied",
    },
  });

  const captured = captureResponse.json<CaptureLeadResponseBody>();

  const unsubscribeResponse = await app.inject({
    method: "POST",
    url: "/v1/leads/unsubscribe",
    headers: requestHeaders,
    payload: {
      email: "WITHDRAW-ME@EXAMPLE.COM",
      reason: "user_request",
    },
  });

  assert.equal(unsubscribeResponse.statusCode, 200);
  assert.equal(
    unsubscribeResponse.json<{ ok: boolean; found: boolean }>().found,
    true,
  );

  const lead = await prisma.lead.findUnique({
    where: { id: captured.leadId },
    select: { consentStatus: true },
  });
  assert.ok(lead);
  assert.equal(lead.consentStatus, ConsentStatus.withdrawn);

  const events = await prisma.consentEvent.findMany({
    where: { leadId: captured.leadId },
    orderBy: { timestamp: "asc" },
    select: { source: true },
  });
  assert.equal(events.length, 2);
  assert.equal(events[1]?.source, "unsubscribe");
});

test("POST /v1/leads/delete is blocked when admin auth is not configured", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/leads/delete",
    headers: requestHeaders,
    payload: {
      email: "person@example.com",
    },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(
    response.json<{ ok: boolean; error: string }>().error,
    "admin_auth_not_configured",
  );
});

test("frontend-style submission flow responds quickly and does not block", async () => {
  const startedAt = performance.now();

  const eventResponse = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: requestHeaders,
    payload: {
      anonId: "anon-flow-001",
      eventType: "page_view",
      path: "/",
    },
  });
  const leadResponse = await app.inject({
    method: "POST",
    url: "/v1/leads/capture",
    headers: requestHeaders,
    payload: {
      email: "flow@example.com",
      anonId: "anon-flow-001",
      formName: "newsletter_signup",
      path: "/",
    },
  });

  const elapsedMs = performance.now() - startedAt;

  assert.equal(eventResponse.statusCode, 202);
  assert.equal(leadResponse.statusCode, 200);
  assert.equal(eventResponse.json<{ ok: boolean }>().ok, true);
  assert.equal(leadResponse.json<{ ok: boolean }>().ok, true);
  assert.equal(elapsedMs < 2000, true);
});
