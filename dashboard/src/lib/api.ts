import { env } from "$env/dynamic/private";

/**
 * In production, dashboard SSR runs inside the same Fastify process.
 * SvelteKit server-side `fetch` calls go to localhost (in-process, no network hop).
 * BACKEND_URL can be overridden for local development when running dashboard standalone.
 */
const BACKEND_URL = env.BACKEND_URL ?? "http://localhost:3000";
const ADMIN_API_KEY = env.ADMIN_API_KEY ?? "";

export interface HealthStatus {
  ok: boolean;
  service: string;
  timestamp: string;
  latencyMs: number;
}

export interface MetricsSummary {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export const fetchHealth = async (
  fetch: typeof globalThis.fetch,
): Promise<HealthStatus> => {
  const start = performance.now();
  try {
    const res = await fetch(`${BACKEND_URL}/v1/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return { ok: false, service: "backend", timestamp: new Date().toISOString(), latencyMs };
    }
    const body = await res.json();
    return { ...body, latencyMs };
  } catch {
    const latencyMs = Math.round(performance.now() - start);
    return { ok: false, service: "backend", timestamp: new Date().toISOString(), latencyMs };
  }
};

export const fetchMetrics = async (
  fetch: typeof globalThis.fetch,
): Promise<MetricsSummary> => {
  try {
    const res = await fetch(`${BACKEND_URL}/v1/metrics/summary`, {
      headers: { "x-admin-key": ADMIN_API_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
};
