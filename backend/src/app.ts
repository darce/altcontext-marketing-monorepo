import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { env } from "./config/env.js";
import {
  INVALID_REQUEST_REASON,
  resolveIngestEndpoint,
} from "./lib/ingest-rejections.js";
import { prisma } from "./lib/prisma.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { leadRoutes } from "./routes/leads.js";
import { metricsRoutes } from "./routes/metrics.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveRejectedPropertyId = (body: unknown): string => {
  if (!isRecord(body)) {
    return env.ROLLUP_DEFAULT_PROPERTY_ID;
  }

  const directPropertyId = body.propertyId;
  if (
    typeof directPropertyId === "string" &&
    directPropertyId.trim().length > 0
  ) {
    return directPropertyId.trim();
  }

  const traffic = body.traffic;
  if (!isRecord(traffic)) {
    return env.ROLLUP_DEFAULT_PROPERTY_ID;
  }

  const trafficPropertyId = traffic.propertyId;
  if (
    typeof trafficPropertyId === "string" &&
    trafficPropertyId.trim().length > 0
  ) {
    return trafficPropertyId.trim();
  }

  return env.ROLLUP_DEFAULT_PROPERTY_ID;
};

export const createApp = async (): Promise<FastifyInstance> => {
  const allowedOrigins = new Set(env.CORS_ALLOWED_ORIGINS);

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.body.email",
          "req.body.payload",
          "res.body.email",
        ],
        censor: "[REDACTED]",
      },
    },
    requestIdHeader: "x-request-id",
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      callback(null, allowedOrigins.has(origin));
    },
  });
  await app.register(formbody);
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_TIME_WINDOW,
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      const ingestEndpoint = resolveIngestEndpoint(request.url);
      if (ingestEndpoint) {
        const propertyId = resolveRejectedPropertyId(request.body);
        try {
          await prisma.ingestRejection.create({
            data: {
              propertyId,
              endpoint: ingestEndpoint,
              reason: INVALID_REQUEST_REASON,
              statusCode: 400,
              occurredAt: new Date(),
            },
          });
        } catch (ingestError: unknown) {
          request.log.warn(
            { err: ingestError },
            "failed to record ingest rejection",
          );
        }
      }

      return reply.status(400).send({
        ok: false,
        error: "invalid_request",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    request.log.error({ err: error }, "unhandled request error");
    return reply.status(500).send({
      ok: false,
      error: "internal_error",
    });
  });

  await app.register(healthRoutes);
  await app.register(eventRoutes);
  await app.register(leadRoutes);
  await app.register(metricsRoutes);

  return app;
};
