-- MT-3 / D-1: dashboard auth schema

-- Password hash for credential login (nullable for future auth flows)
ALTER TABLE "users"
  ADD COLUMN "password_hash" VARCHAR(255);

-- Dashboard auth sessions (separate from analytics sessions)
CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "user_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-leading indexes for RLS-filtered access patterns
CREATE INDEX "auth_sessions_tenant_id_user_id_idx"
  ON "auth_sessions"("tenant_id", "user_id");

CREATE INDEX "auth_sessions_tenant_id_expires_at_idx"
  ON "auth_sessions"("tenant_id", "expires_at");

-- RLS split-policy pattern: permissive read for pre-context lookup,
-- tenant-scoped writes once context is established.
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS session_lookup ON "auth_sessions";
CREATE POLICY session_lookup ON "auth_sessions"
  FOR SELECT
  TO app_user
  USING (true);

DROP POLICY IF EXISTS session_tenant_write ON "auth_sessions";
CREATE POLICY session_tenant_write ON "auth_sessions"
  FOR INSERT
  TO app_user
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS session_tenant_update ON "auth_sessions";
CREATE POLICY session_tenant_update ON "auth_sessions"
  FOR UPDATE
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS session_tenant_delete ON "auth_sessions";
CREATE POLICY session_tenant_delete ON "auth_sessions"
  FOR DELETE
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON "auth_sessions" TO app_user;
