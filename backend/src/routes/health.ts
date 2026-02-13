import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/healthz", async () => ({
    ok: true,
    service: "backend",
    timestamp: new Date().toISOString(),
  }));
};
