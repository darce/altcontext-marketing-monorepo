import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { pool, query, sql } from "../lib/db.js";

export type ApiKeyScope = "ingest" | "admin";

export interface ResolvedApiKey {
  tenantId: string;
  scope: ApiKeyScope;
  propertyId?: string;
}

/**
 * Hash a raw API key using SHA-256 for secure storage and lookup.
 */
export const hashKey = (rawKey: string): string =>
  createHash("sha256").update(rawKey).digest("hex");

/**
 * Extracts a prefix from the raw key for identification in the dashboard.
 */
export const getKeyPrefix = (rawKey: string): string => rawKey.slice(0, 16);

/**
 * Generates a new raw API key and its hash.
 */
export const generateRawKey = (scope: ApiKeyScope): string => {
  const prefix = scope === "admin" ? "ak_admin_" : "ak_live_";
  return prefix + randomBytes(32).toString("hex");
};

/**
 * Resolves a raw API key to a tenant and scope.
 * Uses timing-safe comparison on the hash to prevent side-channel attacks.
 */
interface ApiKeyRow {
  tenant_id: string;
  scope: string;
  key_hash: string;
}

/**
 * Resolves a raw API key to a tenant and scope.
 * Uses timing-safe comparison on the hash to prevent side-channel attacks.
 */
export const resolveApiKey = async (
  rawKey: string,
): Promise<ResolvedApiKey | null> => {
  if (!rawKey) return null;

  const keyHash = hashKey(rawKey);
  const prefix = getKeyPrefix(rawKey);

  const res = await query<ApiKeyRow>(
    pool,
    sql`
    SELECT tenant_id, scope, key_hash
    FROM api_keys
    WHERE key_prefix = ${prefix}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > NOW())
  `,
  );

  if (res.rowCount === 0) {
    return null;
  }

  // Find the matching key using timing-safe comparison
  const match = res.rows.find((row) => {
    const configured = Buffer.from(row.key_hash);
    const supplied = Buffer.from(keyHash);
    return (
      configured.length === supplied.length &&
      timingSafeEqual(configured, supplied)
    );
  });

  if (!match) {
    return null;
  }

  return {
    tenantId: match.tenant_id,
    scope: match.scope as ApiKeyScope,
  };
};

/**
 * Generates and stores a new API key for a tenant.
 */
// ts-prune-ignore-next — consumed by tenant onboarding (MT-5) and seed scripts
export const createApiKey = async (
  client: PoolClient,
  tenantId: string,
  scope: ApiKeyScope,
  label?: string,
): Promise<{ rawKey: string; keyPrefix: string }> => {
  const rawKey = generateRawKey(scope);
  const keyHash = hashKey(rawKey);
  const keyPrefix = getKeyPrefix(rawKey);

  await query(
    client,
    sql`
    INSERT INTO api_keys (
      id, tenant_id, key_hash, key_prefix, label, scope, updated_at
    ) VALUES (
      gen_random_uuid(), ${tenantId}, ${keyHash}, ${keyPrefix}, ${label}, ${scope}, NOW()
    )
  `,
  );

  return { rawKey, keyPrefix };
};
