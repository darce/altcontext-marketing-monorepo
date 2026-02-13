import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";

import { eventBodySchema } from "../../src/schemas/events.js";
import {
  leadCaptureBodySchema,
  unsubscribeBodySchema,
} from "../../src/schemas/leads.js";

test("eventBodySchema parses a valid payload", () => {
  const parsed = eventBodySchema.parse({
    anonId: "anon-12345678",
    eventType: "page_view",
    path: "/pricing",
    timestamp: "2026-02-13T22:30:00.000Z",
    referrer: "https://example.com/",
    utm: {
      source: "newsletter",
    },
    props: {
      cta: "hero",
    },
    traffic: {
      propertyId: "marketing-site",
      host: "www.example.com",
      pageTitle: "Pricing",
      language: "en-CA",
      deviceType: "desktop",
      screenWidth: 1920,
      screenHeight: 1080,
      viewportWidth: 1366,
      viewportHeight: 768,
      engagedTimeMs: 3500,
      scrollDepthPercent: 72,
      webVitals: {
        fcpMs: 1200,
        lcpMs: 2200,
        inpMs: 120,
        clsScore: 0.04,
        ttfbMs: 280,
      },
    },
  });

  assert.equal(parsed.anonId, "anon-12345678");
  assert.equal(parsed.eventType, "page_view");
  assert.equal(parsed.path, "/pricing");
  assert.equal(parsed.timestamp instanceof Date, true);
  assert.equal(parsed.traffic?.propertyId, "marketing-site");
  assert.equal(parsed.traffic?.countryCode, undefined);
});

test("eventBodySchema rejects invalid anonId", () => {
  assert.throws(
    () =>
      eventBodySchema.parse({
        anonId: "short",
        eventType: "page_view",
        path: "/",
      }),
    ZodError,
  );
});

test("eventBodySchema rejects invalid traffic metrics", () => {
  assert.throws(
    () =>
      eventBodySchema.parse({
        anonId: "anon-12345678",
        eventType: "page_view",
        path: "/",
        traffic: {
          scrollDepthPercent: 130,
        },
      }),
    ZodError,
  );
});

test("leadCaptureBodySchema applies defaults", () => {
  const parsed = leadCaptureBodySchema.parse({
    email: "Person@Example.com",
    anonId: "anon-abcdef12",
  });

  assert.equal(parsed.formName, "lead_capture");
  assert.equal(parsed.email, "Person@Example.com");
  assert.equal(parsed.anonId, "anon-abcdef12");
});

test("unsubscribeBodySchema rejects malformed email", () => {
  assert.throws(
    () =>
      unsubscribeBodySchema.parse({
        email: "not-an-email",
      }),
    ZodError,
  );
});
