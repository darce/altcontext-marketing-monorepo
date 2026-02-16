/**
 * Dashboard middleware — mounts the SvelteKit adapter-node handler
 * on the Fastify server so both API and dashboard share a single process.
 *
 * In production the pre-built dashboard lives at `./dashboard/` relative to
 * the working directory (copied there by the Dockerfile).  The handler is a
 * standard Connect/Express middleware exported by `@sveltejs/adapter-node`.
 *
 * In development this module is a no-op; run the SvelteKit dev server
 * separately with `npm run dev` inside `dashboard/`.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";

const DASHBOARD_BUILD_PATH = resolve("dashboard");
const HANDLER_ENTRY = resolve(DASHBOARD_BUILD_PATH, "handler.js");

/**
 * Returns true when a pre-built dashboard bundle is present on disk.
 */
export const hasDashboardBuild = (): boolean => existsSync(HANDLER_ENTRY);

/**
 * Register the SvelteKit handler as catch-all middleware.
 *
 * MUST be called **after** all Fastify API routes are registered so that
 * `/v1/*` routes take priority.  Requests that don't match a Fastify route
 * fall through to the SvelteKit middleware.
 */
export const mountDashboard = async (app: FastifyInstance): Promise<void> => {
  if (!hasDashboardBuild()) {
    app.log.warn(
      "Dashboard build not found at %s — skipping dashboard mount",
      DASHBOARD_BUILD_PATH,
    );
    return;
  }

  // Dynamic import so the module is only loaded when the build exists.
  const middie = await import("@fastify/middie");
  await app.register(middie.default);

  // SvelteKit adapter-node exports { handler } — a Connect-compatible middleware.
  const { handler } = await import(HANDLER_ENTRY);

  // Wrap the handler so /v1/* requests skip SvelteKit and fall through to
  // Fastify's own router.  Without this, middie runs the Connect middleware
  // BEFORE Fastify route matching, and SvelteKit would 404 on API paths.
  app.use((req, res, next) => {
    if (req.url?.startsWith("/v1/")) {
      next();
      return;
    }
    handler(req, res, next);
  });

  app.log.info("Dashboard mounted from %s", DASHBOARD_BUILD_PATH);
};
