import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import { env } from "./config/env.js";
import { query, sql, withTenant } from "./lib/db.js";
import {
  INVALID_REQUEST_REASON,
  resolveIngestEndpoint,
} from "./lib/ingest-rejections.js";
import { tableRef } from "./lib/sql.js";
import { mountDashboard } from "./lib/dashboard.js";
import { tenantResolutionHook } from "./lib/tenant-resolution.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { leadRoutes } from "./routes/leads.js";
import { metricsRoutes } from "./routes/metrics.js";

const INGEST_REJECTIONS_TABLE = tableRef("ingest_rejections");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// ... (resolveRejectedPropertyId implementation remains same, skipping lines for brevity if possible, but replace needs full context usually or smart chunks)
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
        const tenantId = request.tenantId; // Resolved by tenantResolutionHook if it reached this stage

        if (tenantId) {
          try {
            await withTenant(tenantId, async (tx) => {
              await query(
                tx,
                sql`
                  INSERT INTO ${INGEST_REJECTIONS_TABLE} (
                    "id",
                    "tenant_id",
                    "property_id",
                    "endpoint",
                    "reason",
                    "status_code",
                    "occurred_at"
                  ) VALUES (
                    ${randomUUID()},
                    ${tenantId},
                    ${propertyId},
                    ${ingestEndpoint},
                    ${INVALID_REQUEST_REASON},
                    400,
                    NOW()
                  )
                `,
              );
            });
          } catch (ingestError: unknown) {
            request.log.warn(
              { err: ingestError },
              "failed to record ingest rejection",
            );
          }
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

    // Let Fastify/plugin-set status codes (e.g. 429 from @fastify/rate-limit) pass through.
    if (
      error instanceof Error &&
      "statusCode" in error &&
      typeof (error as Record<string, unknown>).statusCode === "number"
    ) {
      const statusCode = (error as Record<string, unknown>)
        .statusCode as number;
      if (statusCode >= 400 && statusCode < 500) {
        return reply
          .status(statusCode)
          .send({ ok: false, error: error.message });
      }
    }

    request.log.error({ err: error }, "unhandled request error");
    return reply.status(500).send({
      ok: false,
      error: "internal_error",
    });
  });

  await app.register(healthRoutes);

  // Authenticated/Tenant-scoped API routes
  await app.register(async (api) => {
    api.addHook("onRequest", tenantResolutionHook);

    await api.register(eventRoutes);
    await api.register(leadRoutes);
    await api.register(metricsRoutes);
  });

  // Dashboard catch-all — must be registered AFTER API routes so /v1/* takes priority.
  await mountDashboard(app);

  return app;
};
