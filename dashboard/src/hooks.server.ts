import type { Handle } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";

const PUBLIC_PATHS = new Set(["/login"]);
const BACKEND_URL = env.BACKEND_URL ?? "http://127.0.0.1:3000";

const resolveBackendUrl = (path: string): string => `${BACKEND_URL}${path}`;

export const handle: Handle = async ({ event, resolve }) => {
  const pathname = event.url.pathname;
  if (pathname.startsWith("/_app/") || pathname === "/favicon.png") {
    return resolve(event);
  }

  const cookieHeader = event.request.headers.get("cookie");
  try {
    const response = await fetch(resolveBackendUrl("/v1/auth/me"), {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const payload = (await response.json()) as {
        user?: App.User;
        tenant?: App.Tenant;
      };
      event.locals.user = payload.user;
      event.locals.tenant = payload.tenant;
    } else {
      event.locals.user = undefined;
      event.locals.tenant = undefined;
    }
  } catch {
    event.locals.user = undefined;
    event.locals.tenant = undefined;
  }

  if (!event.locals.user && !PUBLIC_PATHS.has(pathname)) {
    redirect(303, "/login");
  }

  if (event.locals.user && pathname === "/login") {
    redirect(303, "/");
  }

  return resolve(event);
};
