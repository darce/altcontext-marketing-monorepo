import { z } from "zod";

import { utmSchema } from "./shared.js";

const webVitalsSchema = z
  .object({
    fcpMs: z.coerce.number().int().min(0).max(120_000).optional(),
    lcpMs: z.coerce.number().int().min(0).max(120_000).optional(),
    inpMs: z.coerce.number().int().min(0).max(120_000).optional(),
    ttfbMs: z.coerce.number().int().min(0).max(120_000).optional(),
    clsScore: z.coerce.number().min(0).max(10).optional(),
  })
  .optional();

const trafficSchema = z
  .object({
    propertyId: z.string().trim().min(1).max(128).optional(),
    deviceType: z
      .enum(["desktop", "mobile", "tablet", "bot", "unknown"])
      .optional(),
    countryCode: z.string().trim().length(2).toUpperCase().optional(),
    isEntrance: z.boolean().optional(),
    isExit: z.boolean().optional(),
    isConversion: z.boolean().optional(),
    engagedTimeMs: z.coerce.number().int().min(0).max(86_400_000).optional(),
    scrollDepthPercent: z.coerce.number().int().min(0).max(100).optional(),
    webVitals: webVitalsSchema,
  })
  .optional();

export const eventBodySchema = z.object({
  anonId: z.string().trim().min(8).max(128),
  eventType: z.string().trim().min(1).max(64),
  path: z.string().trim().min(1).max(2048),
  timestamp: z.coerce.date().optional(),
  referrer: z.string().trim().min(1).max(2048).optional(),
  utm: utmSchema.optional(),
  traffic: trafficSchema,
  props: z.record(z.string(), z.unknown()).optional(),
  honeypot: z.string().optional(),
});

export type EventBody = z.infer<typeof eventBodySchema>;
