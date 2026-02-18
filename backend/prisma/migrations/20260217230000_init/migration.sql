-- Canonical greenfield init migration.
-- Single migration baseline for a no-data, no-backward-compat rollout.

-- Ensure gen_random_uuid() exists for PG17 fallback behavior.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- PG17 compatibility shim for local/dev/test environments.
-- On PG18+, built-in uuidv7() exists and this branch is skipped.
DO $$
BEGIN
  IF to_regprocedure('uuidv7()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION uuidv7()
      RETURNS uuid
      LANGUAGE SQL
      VOLATILE
      AS 'SELECT gen_random_uuid()'
    $fn$;
  END IF;
END
$$;

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'express', 'implied', 'withdrawn');

-- CreateEnum
CREATE TYPE "LinkSource" AS ENUM ('form_submit', 'same_ip_ua_window', 'manual_merge');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('accepted', 'rejected', 'invalid');

-- CreateEnum
CREATE TYPE "TrafficSource" AS ENUM ('direct', 'organic_search', 'paid_search', 'social', 'email', 'referral', 'campaign', 'internal', 'unknown');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('desktop', 'mobile', 'tablet', 'bot', 'unknown');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "key_hash" VARCHAR(64) NOT NULL,
    "key_prefix" VARCHAR(16) NOT NULL,
    "label" VARCHAR(255),
    "scope" VARCHAR(20) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "anon_id" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_ip_hash" VARCHAR(128),
    "last_ip_hash" VARCHAR(128),
    "first_ua_hash" VARCHAR(128),
    "last_ua_hash" VARCHAR(128),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "last_event_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landing_path" TEXT,
    "referrer" TEXT,
    "utm_source" VARCHAR(255),
    "utm_medium" VARCHAR(255),
    "utm_campaign" VARCHAR(255),
    "utm_term" VARCHAR(255),
    "utm_content" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "session_id" TEXT,
    "dedupe_key" VARCHAR(64),
    "event_type" VARCHAR(64) NOT NULL,
    "path" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" VARCHAR(128),
    "ua_hash" VARCHAR(128),
    "props" JSONB,
    "property_id" VARCHAR(128) NOT NULL DEFAULT 'default',
    "traffic_source" "TrafficSource" NOT NULL DEFAULT 'unknown',
    "device_type" "DeviceType" NOT NULL DEFAULT 'unknown',
    "country_code" VARCHAR(2),
    "is_entrance" BOOLEAN NOT NULL DEFAULT false,
    "is_exit" BOOLEAN NOT NULL DEFAULT false,
    "is_conversion" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "email_normalized" VARCHAR(320) NOT NULL,
    "consent_status" "ConsentStatus" NOT NULL DEFAULT 'pending',
    "first_captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_channel" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_identities" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "lead_id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "link_source" "LinkSource" NOT NULL DEFAULT 'form_submit',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "lead_id" TEXT,
    "visitor_id" TEXT,
    "session_id" TEXT,
    "form_name" VARCHAR(255) NOT NULL,
    "payload" JSONB,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validation_status" "ValidationStatus" NOT NULL DEFAULT 'accepted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" VARCHAR(128) NOT NULL,
    "ip_hash" VARCHAR(128),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_rejections" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "property_id" VARCHAR(128) NOT NULL,
    "endpoint" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "status_code" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_rejections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metric_rollups" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "property_id" VARCHAR(128) NOT NULL,
    "day" DATE NOT NULL,
    "unique_visitors" INTEGER NOT NULL DEFAULT 0,
    "returning_visitors" INTEGER NOT NULL DEFAULT 0,
    "total_page_views" INTEGER NOT NULL DEFAULT 0,
    "total_entrances" INTEGER NOT NULL DEFAULT 0,
    "total_exits" INTEGER NOT NULL DEFAULT 0,
    "total_conversions" INTEGER NOT NULL DEFAULT 0,
    "form_starts" INTEGER NOT NULL DEFAULT 0,
    "form_submits" INTEGER NOT NULL DEFAULT 0,
    "new_leads" INTEGER NOT NULL DEFAULT 0,
    "time_to_first_capture_sum_ms" BIGINT NOT NULL DEFAULT 0,
    "time_to_first_capture_count" INTEGER NOT NULL DEFAULT 0,
    "traffic_source_breakdown" JSONB,
    "top_landing_paths" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_metric_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_ingest_rollups" (
    "id" TEXT NOT NULL DEFAULT uuidv7()::text,
    "tenant_id" UUID NOT NULL,
    "property_id" VARCHAR(128) NOT NULL,
    "day" DATE NOT NULL,
    "events_accepted" INTEGER NOT NULL DEFAULT 0,
    "events_rejected" INTEGER NOT NULL DEFAULT 0,
    "leads_accepted" INTEGER NOT NULL DEFAULT 0,
    "leads_rejected" INTEGER NOT NULL DEFAULT 0,
    "p95_ttfb_ms" INTEGER,
    "error_breakdown" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_ingest_rollups_pkey" PRIMARY KEY ("id")
);

-- leads.email_domain generated column.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 180000 THEN
    EXECUTE '
      ALTER TABLE "leads"
      ADD COLUMN "email_domain" VARCHAR(255)
      GENERATED ALWAYS AS (split_part("email_normalized", ''@'', 2)) VIRTUAL
    ';
  ELSE
    EXECUTE '
      ALTER TABLE "leads"
      ADD COLUMN "email_domain" VARCHAR(255)
      GENERATED ALWAYS AS (split_part("email_normalized", ''@'', 2)) STORED
    ';
  END IF;
END
$$;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "visitors_tenant_id_anon_id_key" ON "visitors"("tenant_id", "anon_id");

-- CreateIndex
CREATE INDEX "visitors_tenant_id_last_seen_at_idx" ON "visitors"("tenant_id", "last_seen_at");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_visitor_id_started_at_idx" ON "sessions"("tenant_id", "visitor_id", "started_at");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_visitor_id_last_event_at_idx" ON "sessions"("tenant_id", "visitor_id", "last_event_at");

-- CreateIndex
CREATE UNIQUE INDEX "events_tenant_id_dedupe_key_key" ON "events"("tenant_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "events_tenant_id_visitor_id_timestamp_idx" ON "events"("tenant_id", "visitor_id", "timestamp");

-- CreateIndex
CREATE INDEX "events_tenant_id_event_type_timestamp_idx" ON "events"("tenant_id", "event_type", "timestamp");

-- CreateIndex
CREATE INDEX "events_tenant_id_path_timestamp_idx" ON "events"("tenant_id", "path", "timestamp");

-- CreateIndex
CREATE INDEX "events_tenant_id_session_id_timestamp_idx" ON "events"("tenant_id", "session_id", "timestamp");

-- CreateIndex
CREATE INDEX "events_tenant_id_property_id_timestamp_idx" ON "events"("tenant_id", "property_id", "timestamp");

-- CreateIndex
CREATE INDEX "events_tenant_id_traffic_source_timestamp_idx" ON "events"("tenant_id", "traffic_source", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "leads_tenant_id_email_normalized_key" ON "leads"("tenant_id", "email_normalized");

-- CreateIndex
CREATE INDEX "leads_tenant_id_last_captured_at_idx" ON "leads"("tenant_id", "last_captured_at");

-- CreateIndex
CREATE INDEX "lead_identities_tenant_id_lead_id_linked_at_idx" ON "lead_identities"("tenant_id", "lead_id", "linked_at");

-- CreateIndex
CREATE INDEX "lead_identities_tenant_id_visitor_id_linked_at_idx" ON "lead_identities"("tenant_id", "visitor_id", "linked_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_identities_tenant_id_lead_visitor_source_key" ON "lead_identities"("tenant_id", "lead_id", "visitor_id", "link_source");

-- CreateIndex
CREATE INDEX "form_submissions_tenant_id_lead_id_submitted_at_idx" ON "form_submissions"("tenant_id", "lead_id", "submitted_at");

-- CreateIndex
CREATE INDEX "form_submissions_tenant_id_visitor_id_submitted_at_idx" ON "form_submissions"("tenant_id", "visitor_id", "submitted_at");

-- CreateIndex
CREATE INDEX "form_submissions_tenant_id_session_id_submitted_at_idx" ON "form_submissions"("tenant_id", "session_id", "submitted_at");

-- CreateIndex
CREATE INDEX "consent_events_tenant_id_lead_id_timestamp_idx" ON "consent_events"("tenant_id", "lead_id", "timestamp");

-- CreateIndex
CREATE INDEX "ingest_rejections_tenant_id_property_id_occurred_at_idx" ON "ingest_rejections"("tenant_id", "property_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ingest_rejections_tenant_id_endpoint_occurred_at_idx" ON "ingest_rejections"("tenant_id", "endpoint", "occurred_at");

-- CreateIndex
CREATE INDEX "daily_metric_rollups_tenant_id_day_idx" ON "daily_metric_rollups"("tenant_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metric_rollups_tenant_id_property_day_key" ON "daily_metric_rollups"("tenant_id", "property_id", "day");

-- CreateIndex
CREATE INDEX "daily_ingest_rollups_tenant_id_day_idx" ON "daily_ingest_rollups"("tenant_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "daily_ingest_rollups_tenant_id_property_day_key" ON "daily_ingest_rollups"("tenant_id", "property_id", "day");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identities" ADD CONSTRAINT "lead_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identities" ADD CONSTRAINT "lead_identities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identities" ADD CONSTRAINT "lead_identities_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_rejections" ADD CONSTRAINT "ingest_rejections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metric_rollups" ADD CONSTRAINT "daily_metric_rollups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_ingest_rollups" ADD CONSTRAINT "daily_ingest_rollups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed bootstrap tenant (deterministic ID for local/dev/test parity)
INSERT INTO "tenants" ("id", "name", "slug", "plan", "updated_at")
VALUES ('00000000-0000-4000-a000-000000000001', 'AltContext Marketing', 'altcontext-marketing', 'enterprise', NOW());

-- Seed bootstrap API keys (deterministic hashes/IDs)
-- Ingest key plaintext (dev/test only): akt_test_ingest_key_1234567890
INSERT INTO "api_keys" ("id", "tenant_id", "key_hash", "key_prefix", "label", "scope", "updated_at")
VALUES (
  '00000000-0000-4000-b000-000000000001',
  '00000000-0000-4000-a000-000000000001',
  '48751c083cb8390d5202f7c5ac28a8ecec9aea3349b355a54a2bcce2300704e4',
  'akt_test_ingest_',
  'Bootstrap Ingest Key',
  'ingest',
  NOW()
);

-- Admin key plaintext (dev/test only): akt_test_admin_key_1234567890
INSERT INTO "api_keys" ("id", "tenant_id", "key_hash", "key_prefix", "label", "scope", "updated_at")
VALUES (
  '00000000-0000-4000-b000-000000000002',
  '00000000-0000-4000-a000-000000000001',
  'c2e2436528f5a083d9ac32c30ac4ac71f2514b086d06ef70b57dfff590946927',
  'akt_test_admin_k',
  'Bootstrap Admin Key',
  'admin',
  NOW()
);

-- Create app_user role if it does not exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN;
  END IF;
END
$$;

-- Grant DML + sequence access to app_user in current schema.
DO $$
DECLARE
  s text := current_schema();
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_user', s);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_user', s);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO app_user', s);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user', s);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO app_user', s);
END
$$;

-- Enable RLS and create tenant_isolation policy on tenant-scoped tables.
DO $$
DECLARE
  t text;
  tables_to_rls text[] := ARRAY[
    'visitors', 'sessions', 'events', 'leads', 'lead_identities',
    'form_submissions', 'consent_events', 'ingest_rejections',
    'daily_metric_rollups', 'daily_ingest_rollups', 'users'
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_rls LOOP
    EXECUTE 'ALTER TABLE ' || quote_ident(t) || ' ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON ' || quote_ident(t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO app_user '
      || 'USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;

-- api_keys has split read/write policies: open read for key resolution, tenant-scoped writes.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS api_key_lookup ON "api_keys";
CREATE POLICY api_key_lookup ON "api_keys"
  FOR SELECT
  TO app_user
  USING (true);

DROP POLICY IF EXISTS api_key_tenant_write ON "api_keys";
CREATE POLICY api_key_tenant_write ON "api_keys"
  FOR INSERT
  TO app_user
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS api_key_tenant_update ON "api_keys";
CREATE POLICY api_key_tenant_update ON "api_keys"
  FOR UPDATE
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS api_key_tenant_delete ON "api_keys";
CREATE POLICY api_key_tenant_delete ON "api_keys"
  FOR DELETE
  TO app_user
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- SECURITY DEFINER setter to validate tenant context changes.
CREATE OR REPLACE FUNCTION public.set_tenant_context(
  tid uuid,
  tenant_schema text DEFAULT 'public'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  target_schema text := NULLIF(BTRIM(tenant_schema), '');
  tenant_exists boolean := false;
BEGIN
  IF target_schema IS NULL THEN
    target_schema := 'public';
  END IF;

  IF to_regclass(format('%I.tenants', target_schema)) IS NULL THEN
    RAISE EXCEPTION 'tenant table not found in schema: %', target_schema
      USING ERRCODE = '3F000';
  END IF;

  EXECUTE format(
    'SELECT EXISTS (SELECT 1 FROM %I.tenants WHERE id = $1)',
    target_schema
  )
    INTO tenant_exists
    USING tid;

  IF NOT tenant_exists THEN
    RAISE EXCEPTION 'unknown tenant: %', tid
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config('app.current_tenant_id', tid::text, true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_context(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_context(uuid, text) TO app_user;

-- PG18 parameter ACL hardening.
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 180000 THEN
    EXECUTE 'REVOKE ALL ON PARAMETER "app.current_tenant_id" FROM app_user';
  END IF;
END
$$;
