import { env } from "$env/dynamic/private";

/**
 * In production, dashboard SSR runs inside the same Fastify process.
 * SvelteKit server-side `fetch` calls go to localhost (in-process, no network hop).
 * BACKEND_URL can be overridden for local development when running dashboard standalone.
 */
const BACKEND_URL = env.BACKEND_URL ?? "";
const BACKEND_URL_DEFAULT = "http://127.0.0.1:3000";

const resolveUrl = (path: string): string =>
  `${BACKEND_URL.length > 0 ? BACKEND_URL : BACKEND_URL_DEFAULT}${path}`;

const toIsoDay = (date: Date): string => date.toISOString().slice(0, 10);

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
    const res = await fetch(resolveUrl("/v1/healthz"), {
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
  cookieHeader?: string | null,
): Promise<MetricsSummary> => {
  try {
    const today = new Date();
    const from = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
    const query = new URLSearchParams({
      from: toIsoDay(from),
      to: toIsoDay(today),
    });

    const res = await fetch(resolveUrl(`/v1/metrics/summary?${query.toString()}`), {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
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
