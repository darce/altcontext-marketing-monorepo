import type { FastifyPluginAsync } from "fastify";

import { transaction } from "../lib/db.js";
import { requestContextFrom } from "../lib/request-context.js";
import { eventBodySchema } from "../schemas/events.js";
import { ingestEvent } from "../services/events.js";

export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/events",
    {
      config: {
        rateLimit: {
          max: 180,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = eventBodySchema.parse(request.body);
      if (body.honeypot && body.honeypot.trim().length > 0) {
        return reply.code(202).send({ ok: true });
      }

      const result = await transaction((tx) =>
        ingestEvent(tx, body, requestContextFrom(request)),
      );
      return reply.code(202).send({ ok: true, ...result });
    },
  );
};
