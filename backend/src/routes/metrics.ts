import type { FastifyPluginAsync } from "fastify";

import { assertAdminRequest } from "../lib/admin-auth.js";
import { withTenant } from "../lib/db.js";
import { summaryQuerySchema } from "../schemas/metrics.js";
import { fetchMetricsSummary } from "../services/metrics/summary.js";

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/v1/metrics/summary",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      if (!assertAdminRequest(request, reply)) {
        return;
      }

      const query = summaryQuerySchema.parse(request.query);
      const summary = await withTenant(request.tenantId, (tx) =>
        fetchMetricsSummary(tx, request.tenantId, query),
      );
      return reply.code(200).send({
        ok: true,
        ...summary,
      });
    },
  );
};
