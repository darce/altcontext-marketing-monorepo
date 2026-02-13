import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env.js";

export const hasValidAdminKey = (requestKey: string): boolean => {
  const configuredKey = env.ADMIN_API_KEY;
  if (!configuredKey) {
    return false;
  }

  const configured = Buffer.from(configuredKey);
  const supplied = Buffer.from(requestKey);
  if (configured.length !== supplied.length) {
    return false;
  }

  return timingSafeEqual(configured, supplied);
};

export const assertAdminRequest = (
  request: FastifyRequest,
  reply: FastifyReply,
): boolean => {
  if (!env.ADMIN_API_KEY) {
    request.log.error("ADMIN_API_KEY is not configured");
    void reply.code(503).send({
      ok: false,
      error: "admin_auth_not_configured",
    });
    return false;
  }

  const requestKey = request.headers["x-admin-key"];
  if (typeof requestKey !== "string" || !hasValidAdminKey(requestKey)) {
    void reply.code(401).send({ ok: false, error: "unauthorized" });
    return false;
  }

  return true;
};
