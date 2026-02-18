import type { FastifyPluginAsync } from "fastify";

import {
  cleanExpiredSessions,
  createSession,
  destroySession,
  findLoginCandidate,
  getUserTenantContext,
  validateSession,
  verifyPassword,
} from "../services/auth.js";
import { loginBodySchema, type LoginBody } from "../schemas/auth.js";
import { withTenant } from "../lib/db.js";
import { SESSION_ID_KEY } from "../lib/session-config.js";

const LOGIN_FAILURE_REDIRECT = "/login?error=invalid_credentials";
interface SessionStore {
  set: (key: string, value: string) => void;
  get: (key: string) => unknown;
  delete: () => void;
}

const isFormUrlEncoded = (contentTypeHeader: unknown): boolean => {
  if (typeof contentTypeHeader !== "string") {
    return false;
  }
  return contentTypeHeader
    .toLowerCase()
    .startsWith("application/x-www-form-urlencoded");
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const fromForm = isFormUrlEncoded(request.headers["content-type"]);
      const session = request.session as SessionStore;
      const body: LoginBody = loginBodySchema.parse(request.body);
      const candidate = await findLoginCandidate(body.tenantSlug, body.email);

      if (!candidate) {
        if (fromForm) {
          return reply.code(303).redirect(LOGIN_FAILURE_REDIRECT);
        }
        return reply
          .code(401)
          .send({ ok: false, error: "invalid_credentials" });
      }

      const validPassword = await verifyPassword(
        candidate.password_hash,
        body.password,
      );
      if (!validPassword) {
        if (fromForm) {
          return reply.code(303).redirect(LOGIN_FAILURE_REDIRECT);
        }
        return reply
          .code(401)
          .send({ ok: false, error: "invalid_credentials" });
      }

      const sessionId = await withTenant(candidate.tenant_id, async (tx) => {
        await cleanExpiredSessions(tx, candidate.tenant_id);
        return createSession(tx, candidate.tenant_id, candidate.user_id);
      });

      session.set(SESSION_ID_KEY, sessionId);

      const context = await getUserTenantContext(
        candidate.tenant_id,
        candidate.user_id,
      );

      if (!context) {
        return reply.code(500).send({ ok: false, error: "login_failed" });
      }

      if (fromForm) {
        return reply.code(303).redirect("/");
      }
      return reply.code(200).send({ ok: true, ...context });
    },
  );

  app.post("/v1/auth/logout", async (request, reply) => {
    const session = request.session as SessionStore;
    const sessionId = session.get(SESSION_ID_KEY);
    if (typeof sessionId === "string") {
      const validated = await validateSession(sessionId);
      if (validated) {
        await withTenant(validated.tenantId, async (tx) => {
          await destroySession(tx, sessionId);
        });
      }
    }

    session.delete();
    return reply.code(200).send({ ok: true });
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const session = request.session as SessionStore;
    const sessionId = session.get(SESSION_ID_KEY);
    if (typeof sessionId !== "string") {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const validated = await validateSession(sessionId);
    if (!validated) {
      session.delete();
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const context = await getUserTenantContext(
      validated.tenantId,
      validated.userId,
    );
    if (!context) {
      session.delete();
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    return reply.code(200).send({ ok: true, ...context });
  });
};
