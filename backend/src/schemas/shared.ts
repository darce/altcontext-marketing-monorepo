import { z } from "zod";

export const utmSchema = z.object({
  source: z.string().trim().min(1).max(255).optional(),
  medium: z.string().trim().min(1).max(255).optional(),
  campaign: z.string().trim().min(1).max(255).optional(),
  term: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).max(255).optional(),
});

export type UtmInput = z.infer<typeof utmSchema>;
