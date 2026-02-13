import { timingSafeEqual } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";

import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { requestContextFrom } from "../lib/request-context.js";
import {
  deleteByEmailBodySchema,
  leadCaptureBodySchema,
  unsubscribeBodySchema,
} from "../schemas/leads.js";
import {
  captureLead,
  deleteLeadByEmail,
  unsubscribeLead,
} from "../services/leads.js";

const isFormUrlEncoded = (contentTypeHeader: unknown): boolean => {
  if (typeof contentTypeHeader !== "string") {
    return false;
  }
  return contentTypeHeader
    .toLowerCase()
    .startsWith("application/x-www-form-urlencoded");
};

const resolveRedirectPath = (value: string | undefined): string => {
  if (!value) {
    return "/";
  }

  const normalized = value.trim();
  if (!normalized.startsWith("/")) {
    return "/";
  }

  return normalized.length > 0 ? normalized : "/";
};

const hasValidAdminKey = (requestKey: string): boolean => {
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

export const leadRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/leads/capture",
    {
      config: {
        rateLimit: {
          max: 24,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = leadCaptureBodySchema.parse(request.body);
      if (body.honeypot && body.honeypot.trim().length > 0) {
        return reply.code(202).send({ ok: true });
      }

      const result = await prisma.$transaction((tx) =>
        captureLead(tx, body, requestContextFrom(request)),
      );

      if (isFormUrlEncoded(request.headers["content-type"])) {
        return reply.code(303).redirect(resolveRedirectPath(body.path));
      }

      return reply.code(200).send({ ok: true, ...result });
    },
  );

  app.post(
    "/v1/leads/unsubscribe",
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = unsubscribeBodySchema.parse(request.body);
      const result = await prisma.$transaction((tx) =>
        unsubscribeLead(tx, body.email, requestContextFrom(request)),
      );
      return reply.code(200).send({ ok: true, ...result });
    },
  );

  app.post(
    "/v1/leads/delete",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      if (!env.ADMIN_API_KEY) {
        request.log.error("ADMIN_API_KEY is not configured");
        return reply.code(503).send({
          ok: false,
          error: "admin_auth_not_configured",
        });
      }

      const requestKey = request.headers["x-admin-key"];
      if (typeof requestKey !== "string" || !hasValidAdminKey(requestKey)) {
        return reply.code(401).send({ ok: false, error: "unauthorized" });
      }

      const body = deleteByEmailBodySchema.parse(request.body);
      const result = await prisma.$transaction((tx) =>
        deleteLeadByEmail(tx, body.email),
      );
      return reply.code(200).send({ ok: true, ...result });
    },
  );
};
