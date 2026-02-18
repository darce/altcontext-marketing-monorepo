import { z } from "zod";

export const loginBodySchema = z.object({
  tenantSlug: z.string().trim().min(1).max(128),
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
