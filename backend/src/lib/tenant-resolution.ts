import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { resolveApiKey } from "../services/api-keys.js";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    apiKeyScope?: "ingest" | "admin";
  }
}

/**
 * Fastify preHandler hook to resolve the tenant context from the x-api-key header.
 */
export const tenantResolutionHook = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> => {
  const rawKey = request.headers["x-api-key"];

  if (typeof rawKey === "string") {
    const resolved = await resolveApiKey(rawKey);
    if (!resolved) {
      return reply.code(401).send({ ok: false, error: "invalid_api_key" });
    }
    request.tenantId = resolved.tenantId;
    request.apiKeyScope = resolved.scope;
    return;
  }

  // Fallback for backward compatibility during rollout
  if (env.BOOTSTRAP_TENANT_ID) {
    request.tenantId = env.BOOTSTRAP_TENANT_ID;
    request.apiKeyScope = "ingest"; // Default to ingest for fallback
    return;
  }

  return reply.code(401).send({ ok: false, error: "api_key_required" });
};
