import * as argon2 from "argon2";
import type { FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";

import { env } from "../config/env.js";
import { pool, query, sql, withOwnerRole, withTenant } from "../lib/db.js";

export interface AuthenticatedSession {
  userId: string;
  tenantId: string;
  expiresAt: Date;
}

export interface UserTenantContext {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
}

interface LoginCandidate {
  user_id: string;
  tenant_id: string;
  password_hash: string;
}

interface SessionRow {
  user_id: string;
  tenant_id: string;
  expires_at: Date;
}

export const BOOTSTRAP_PASSWORD_MIN_LENGTH = 12;
export const isBootstrapPasswordValid = (password: string): boolean =>
  password.length >= BOOTSTRAP_PASSWORD_MIN_LENGTH;

export const hashPassword = async (plain: string): Promise<string> =>
  argon2.hash(plain, { type: argon2.argon2id });

export const verifyPassword = async (
  hash: string,
  plain: string,
): Promise<boolean> => argon2.verify(hash, plain);

export const findLoginCandidate = async (
  tenantSlug: string,
  email: string,
): Promise<LoginCandidate | null> => {
  const normalizedTenantSlug = tenantSlug.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  return withOwnerRole(async (client) => {
    const { rows } = await query<LoginCandidate>(
      client,
      sql`
        SELECT u.id AS user_id, u.tenant_id, u.password_hash
        FROM users u
        JOIN tenants t ON t.id = u.tenant_id
        WHERE lower(t.slug) = ${normalizedTenantSlug}
          AND lower(u.email) = ${normalizedEmail}
          AND u.password_hash IS NOT NULL
        LIMIT 1
      `,
    );

    return rows[0] ?? null;
  });
};

export const createSession = async (
  client: PoolClient,
  tenantId: string,
  userId: string,
): Promise<string> => {
  const { rows } = await query<{ id: string }>(
    client,
    sql`
      INSERT INTO auth_sessions (
        user_id,
        tenant_id,
        expires_at
      ) VALUES (
        ${userId}::uuid,
        ${tenantId}::uuid,
        NOW() + INTERVAL '7 days'
      )
      RETURNING id::text
    `,
  );

  const sessionId = rows[0]?.id;
  if (!sessionId) {
    throw new Error("failed to create auth session");
  }

  return sessionId;
};

export const validateSession = async (
  sessionId: string,
): Promise<AuthenticatedSession | null> => {
  const { rows } = await query<SessionRow>(
    pool,
    sql`
      SELECT user_id, tenant_id, expires_at
      FROM auth_sessions
      WHERE id = ${sessionId}::uuid
        AND expires_at > NOW()
      LIMIT 1
    `,
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    tenantId: row.tenant_id,
    expiresAt: new Date(row.expires_at),
  };
};

export const destroySession = async (
  client: PoolClient,
  sessionId: string,
): Promise<void> => {
  await query(
    client,
    sql`
      DELETE FROM auth_sessions
      WHERE id = ${sessionId}::uuid
    `,
  );
};

export const getUserTenantContext = async (
  tenantId: string,
  userId: string,
): Promise<UserTenantContext | null> =>
  withTenant(tenantId, async (client) => {
    const { rows } = await query<{
      user_id: string;
      user_email: string;
      user_name: string | null;
      user_role: string;
      tenant_id: string;
      tenant_name: string;
      tenant_slug: string;
    }>(
      client,
      sql`
        SELECT
          u.id AS user_id,
          u.email AS user_email,
          u.name AS user_name,
          u.role AS user_role,
          t.id AS tenant_id,
          t.name AS tenant_name,
          t.slug AS tenant_slug
        FROM users u
        JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = ${userId}::uuid
          AND u.tenant_id = ${tenantId}::uuid
        LIMIT 1
      `,
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    return {
      user: {
        id: row.user_id,
        email: row.user_email,
        name: row.user_name,
        role: row.user_role,
      },
      tenant: {
        id: row.tenant_id,
        name: row.tenant_name,
        slug: row.tenant_slug,
      },
    };
  });

export const cleanExpiredSessions = async (
  client: PoolClient,
  tenantId: string,
): Promise<void> => {
  await query(
    client,
    sql`
      DELETE FROM auth_sessions
      WHERE tenant_id = ${tenantId}::uuid
        AND expires_at <= NOW()
    `,
  );
};

export const ensureBootstrapUser = async (
  logger?: FastifyBaseLogger,
): Promise<void> => {
  if (
    !env.BOOTSTRAP_TENANT_ID ||
    !env.BOOTSTRAP_USER_EMAIL ||
    !env.BOOTSTRAP_USER_PASSWORD
  ) {
    logger?.info(
      "bootstrap user env vars not fully configured; skipping bootstrap user creation",
    );
    return;
  }

  const tenantId = env.BOOTSTRAP_TENANT_ID;
  const email = env.BOOTSTRAP_USER_EMAIL.trim().toLowerCase();
  const bootstrapPassword = env.BOOTSTRAP_USER_PASSWORD;
  if (!isBootstrapPasswordValid(bootstrapPassword)) {
    logger?.error(
      {
        tenantId,
        email,
        passwordLength: bootstrapPassword.length,
        minLength: BOOTSTRAP_PASSWORD_MIN_LENGTH,
      },
      "BOOTSTRAP_USER_PASSWORD is too short; skipping bootstrap user initialization",
    );
    return;
  }

  const bootstrapStatus = await withTenant(tenantId, async (client) => {
    const existing = await query<{ id: string; password_hash: string | null }>(
      client,
      sql`
        SELECT id::text AS id, password_hash
        FROM users
        WHERE tenant_id = ${tenantId}::uuid
          AND lower(email) = ${email}
        LIMIT 1
      `,
    );

    if (existing.rowCount && existing.rowCount > 0) {
      const existingUser = existing.rows[0];
      if (!existingUser) {
        throw new Error("bootstrap user lookup returned no row");
      }

      if (existingUser.password_hash) {
        try {
          const alreadyMatches = await verifyPassword(
            existingUser.password_hash,
            bootstrapPassword,
          );
          if (alreadyMatches) {
            return "unchanged";
          }
        } catch {
          // Continue to overwrite an invalid/unexpected hash format.
        }
      }

      const passwordHash = await hashPassword(bootstrapPassword);
      await query(
        client,
        sql`
          UPDATE users
          SET
            password_hash = ${passwordHash},
            role = ${"owner"},
            name = ${"Bootstrap Owner"},
            updated_at = NOW()
          WHERE id = ${existingUser.id}::uuid
        `,
      );

      return "updated";
    }

    const passwordHash = await hashPassword(bootstrapPassword);

    await query(
      client,
      sql`
        INSERT INTO users (
          tenant_id,
          email,
          name,
          role,
          password_hash,
          updated_at
        ) VALUES (
          ${tenantId}::uuid,
          ${email},
          ${"Bootstrap Owner"},
          ${"owner"},
          ${passwordHash},
          NOW()
        )
      `,
    );

    return "created";
  });

  if (bootstrapStatus === "created") {
    logger?.info({ tenantId, email }, "bootstrap owner user created");
    return;
  }

  if (bootstrapStatus === "updated") {
    logger?.info(
      { tenantId, email },
      "bootstrap owner user password synchronized from env",
    );
    return;
  }

  if (bootstrapStatus === "unchanged") {
    logger?.info({ tenantId, email }, "bootstrap owner user already exists");
  }
};
