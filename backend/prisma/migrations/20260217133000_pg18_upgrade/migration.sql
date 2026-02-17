-- PG18 baseline schema consolidation:
-- 1) Rebuild tenant-scoped composite indexes with tenant_id leading
-- 2) Remove now-redundant standalone tenant_id indexes
-- 3) Switch id defaults to uuidv7()
-- 4) Convert leads.email_domain to a generated virtual column
-- 5) Add validated tenant context setter + parameter ACL hardening

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

-- Ensure app_user can access the active schema when non-public schemas are used
-- (e.g. tests with ?schema=backend_test).
DO $$
DECLARE
  s text := current_schema();
BEGIN
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_user', s);
END
$$;

-- ---------------------------------------------------------------------------
-- Composite index rebuilds (tenant_id first)
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "visitors_last_seen_at_idx";
CREATE INDEX "visitors_tenant_id_last_seen_at_idx"
  ON "visitors"("tenant_id", "last_seen_at");

DROP INDEX IF EXISTS "sessions_visitor_id_started_at_idx";
CREATE INDEX "sessions_tenant_id_visitor_id_started_at_idx"
  ON "sessions"("tenant_id", "visitor_id", "started_at");
DROP INDEX IF EXISTS "sessions_visitor_id_last_event_at_idx";
CREATE INDEX "sessions_tenant_id_visitor_id_last_event_at_idx"
  ON "sessions"("tenant_id", "visitor_id", "last_event_at");

DROP INDEX IF EXISTS "events_visitor_id_timestamp_idx";
CREATE INDEX "events_tenant_id_visitor_id_timestamp_idx"
  ON "events"("tenant_id", "visitor_id", "timestamp");
DROP INDEX IF EXISTS "events_event_type_timestamp_idx";
CREATE INDEX "events_tenant_id_event_type_timestamp_idx"
  ON "events"("tenant_id", "event_type", "timestamp");
DROP INDEX IF EXISTS "events_path_timestamp_idx";
CREATE INDEX "events_tenant_id_path_timestamp_idx"
  ON "events"("tenant_id", "path", "timestamp");
DROP INDEX IF EXISTS "events_session_id_timestamp_idx";
CREATE INDEX "events_tenant_id_session_id_timestamp_idx"
  ON "events"("tenant_id", "session_id", "timestamp");
DROP INDEX IF EXISTS "events_property_id_timestamp_idx";
CREATE INDEX "events_tenant_id_property_id_timestamp_idx"
  ON "events"("tenant_id", "property_id", "timestamp");
DROP INDEX IF EXISTS "events_traffic_source_timestamp_idx";
CREATE INDEX "events_tenant_id_traffic_source_timestamp_idx"
  ON "events"("tenant_id", "traffic_source", "timestamp");

DROP INDEX IF EXISTS "leads_last_captured_at_idx";
CREATE INDEX "leads_tenant_id_last_captured_at_idx"
  ON "leads"("tenant_id", "last_captured_at");

DROP INDEX IF EXISTS "lead_identities_lead_id_linked_at_idx";
CREATE INDEX "lead_identities_tenant_id_lead_id_linked_at_idx"
  ON "lead_identities"("tenant_id", "lead_id", "linked_at");
DROP INDEX IF EXISTS "lead_identities_visitor_id_linked_at_idx";
CREATE INDEX "lead_identities_tenant_id_visitor_id_linked_at_idx"
  ON "lead_identities"("tenant_id", "visitor_id", "linked_at");

DROP INDEX IF EXISTS "form_submissions_lead_id_submitted_at_idx";
CREATE INDEX "form_submissions_tenant_id_lead_id_submitted_at_idx"
  ON "form_submissions"("tenant_id", "lead_id", "submitted_at");
DROP INDEX IF EXISTS "form_submissions_visitor_id_submitted_at_idx";
CREATE INDEX "form_submissions_tenant_id_visitor_id_submitted_at_idx"
  ON "form_submissions"("tenant_id", "visitor_id", "submitted_at");
DROP INDEX IF EXISTS "form_submissions_session_id_submitted_at_idx";
CREATE INDEX "form_submissions_tenant_id_session_id_submitted_at_idx"
  ON "form_submissions"("tenant_id", "session_id", "submitted_at");

DROP INDEX IF EXISTS "consent_events_lead_id_timestamp_idx";
CREATE INDEX "consent_events_tenant_id_lead_id_timestamp_idx"
  ON "consent_events"("tenant_id", "lead_id", "timestamp");

DROP INDEX IF EXISTS "ingest_rejections_property_id_occurred_at_idx";
CREATE INDEX "ingest_rejections_tenant_id_property_id_occurred_at_idx"
  ON "ingest_rejections"("tenant_id", "property_id", "occurred_at");
DROP INDEX IF EXISTS "ingest_rejections_endpoint_occurred_at_idx";
CREATE INDEX "ingest_rejections_tenant_id_endpoint_occurred_at_idx"
  ON "ingest_rejections"("tenant_id", "endpoint", "occurred_at");

DROP INDEX IF EXISTS "daily_metric_rollups_day_idx";
CREATE INDEX "daily_metric_rollups_tenant_id_day_idx"
  ON "daily_metric_rollups"("tenant_id", "day");
DROP INDEX IF EXISTS "daily_ingest_rollups_day_idx";
CREATE INDEX "daily_ingest_rollups_tenant_id_day_idx"
  ON "daily_ingest_rollups"("tenant_id", "day");

-- Redundant now that tenant-leading composites exist.
DROP INDEX IF EXISTS "visitors_tenant_id_idx";
DROP INDEX IF EXISTS "sessions_tenant_id_idx";
DROP INDEX IF EXISTS "events_tenant_id_idx";
DROP INDEX IF EXISTS "leads_tenant_id_idx";
DROP INDEX IF EXISTS "lead_identities_tenant_id_idx";
DROP INDEX IF EXISTS "form_submissions_tenant_id_idx";
DROP INDEX IF EXISTS "consent_events_tenant_id_idx";
DROP INDEX IF EXISTS "ingest_rejections_tenant_id_idx";
DROP INDEX IF EXISTS "daily_metric_rollups_tenant_id_idx";
DROP INDEX IF EXISTS "daily_ingest_rollups_tenant_id_idx";

-- ---------------------------------------------------------------------------
-- uuidv7 defaults
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ALTER COLUMN "id" SET DEFAULT uuidv7();
ALTER TABLE "api_keys" ALTER COLUMN "id" SET DEFAULT uuidv7();
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT uuidv7();

ALTER TABLE "visitors" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "sessions" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "events" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "leads" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "lead_identities" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "form_submissions" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "consent_events" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "ingest_rejections" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "daily_metric_rollups" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;
ALTER TABLE "daily_ingest_rollups" ALTER COLUMN "id" SET DEFAULT uuidv7()::text;

-- ---------------------------------------------------------------------------
-- leads.email_domain generated virtual column
-- ---------------------------------------------------------------------------

ALTER TABLE "leads" DROP COLUMN "email_domain";
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

-- ---------------------------------------------------------------------------
-- RLS tenant context hardening
-- ---------------------------------------------------------------------------

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
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 180000 THEN
    EXECUTE 'REVOKE ALL ON PARAMETER "app.current_tenant_id" FROM app_user';
  END IF;
END
$$;
