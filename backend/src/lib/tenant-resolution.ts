import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { SESSION_ID_KEY } from "./session-config.js";
import { resolveApiKey } from "../services/api-keys.js";
import { validateSession } from "../services/auth.js";

const METRICS_PATH_PREFIX = "/v1/metrics/";

interface SessionStore {
  get: (key: string) => unknown;
}

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
    apiKeyScope?: "ingest" | "admin" | "session";
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

  // Dashboard SSR metrics requests use encrypted auth session cookies.
  // Restrict this fallback to metrics endpoints to avoid broadening ingest auth.
  if (request.url.startsWith(METRICS_PATH_PREFIX)) {
    const session = request.session as SessionStore | undefined;
    const sessionId = session?.get(SESSION_ID_KEY);
    if (typeof sessionId === "string") {
      const validated = await validateSession(sessionId);
      if (validated) {
        request.tenantId = validated.tenantId;
        request.apiKeyScope = "session";
        return;
      }
    }
  }

  // Fallback for backward compatibility during rollout
  if (env.BOOTSTRAP_TENANT_ID) {
    request.tenantId = env.BOOTSTRAP_TENANT_ID;
    request.apiKeyScope = "ingest"; // Default to ingest for fallback
    return;
  }

  return reply.code(401).send({ ok: false, error: "api_key_required" });
};
