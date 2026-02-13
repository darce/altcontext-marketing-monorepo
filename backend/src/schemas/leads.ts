import { z } from "zod";

import { utmSchema } from "./shared.js";

export const leadCaptureBodySchema = z.object({
  email: z.string().email().max(320),
  anonId: z.string().trim().min(8).max(128),
  formName: z.string().trim().min(1).max(255).default("lead_capture"),
  path: z.string().trim().min(1).max(2048).optional(),
  referrer: z.string().trim().min(1).max(2048).optional(),
  sourceChannel: z.string().trim().min(1).max(255).optional(),
  consentStatus: z.enum(["pending", "express", "implied"]).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  utm: utmSchema.optional(),
  honeypot: z.string().optional(),
});

export const unsubscribeBodySchema = z.object({
  email: z.string().email().max(320),
  reason: z.string().trim().min(1).max(512).optional(),
});

export const deleteByEmailBodySchema = z.object({
  email: z.string().email().max(320),
});

export type LeadCaptureBody = z.infer<typeof leadCaptureBodySchema>;
export type UnsubscribeBody = z.infer<typeof unsubscribeBodySchema>;
export type DeleteByEmailBody = z.infer<typeof deleteByEmailBodySchema>;
