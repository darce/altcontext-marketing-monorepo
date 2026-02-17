-- Create app_user role if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
    END IF;
END
$$;

-- Grant DML and sequence usage to app_user in the current schema
DO $$
DECLARE
    s text := current_schema();
BEGIN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_user', s);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO app_user', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO app_user', s);
END $$;

-- Enable RLS and create tenant_isolation policies for domain tables
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
        EXECUTE format('CREATE POLICY tenant_isolation ON %I FOR ALL TO app_user 
            USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid) 
            WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)', t);
    END LOOP;
END $$;

-- Specialized policies for api_keys
-- Allows lookup without tenant context (for resolution), but requires context for writes.
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
