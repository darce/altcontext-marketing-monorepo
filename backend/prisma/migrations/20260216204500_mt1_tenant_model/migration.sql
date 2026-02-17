-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
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
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- Add tenant_id to existing tables
ALTER TABLE "visitors" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "sessions" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "events" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "leads" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "lead_identities" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "form_submissions" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "consent_events" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "ingest_rejections" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "daily_metric_rollups" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "daily_ingest_rollups" ADD COLUMN "tenant_id" UUID;

-- Insert Bootstrap Tenant
INSERT INTO "tenants" ("id", "name", "slug", "plan", "updated_at")
VALUES ('00000000-0000-4000-a000-000000000001', 'AltContext Marketing', 'altcontext-marketing', 'enterprise', NOW());

-- Backfill existing data
UPDATE "visitors" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "sessions" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "events" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "leads" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "lead_identities" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "form_submissions" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "consent_events" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "ingest_rejections" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "daily_metric_rollups" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';
UPDATE "daily_ingest_rollups" SET "tenant_id" = '00000000-0000-4000-a000-000000000001';

-- Enforce NOT NULL
ALTER TABLE "visitors" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "sessions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "events" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "lead_identities" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "form_submissions" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "consent_events" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "ingest_rejections" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "daily_metric_rollups" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "daily_ingest_rollups" ALTER COLUMN "tenant_id" SET NOT NULL;

-- Add FKs
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lead_identities" ADD CONSTRAINT "lead_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingest_rejections" ADD CONSTRAINT "ingest_rejections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_metric_rollups" ADD CONSTRAINT "daily_metric_rollups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_ingest_rollups" ADD CONSTRAINT "daily_ingest_rollups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update Unique Constraints
DROP INDEX "visitors_anon_id_key";
CREATE UNIQUE INDEX "visitors_tenant_id_anon_id_key" ON "visitors"("tenant_id", "anon_id");

DROP INDEX "events_dedupe_key_key";
CREATE UNIQUE INDEX "events_tenant_id_dedupe_key_key" ON "events"("tenant_id", "dedupe_key");

DROP INDEX "leads_email_normalized_key";
CREATE UNIQUE INDEX "leads_tenant_id_email_normalized_key" ON "leads"("tenant_id", "email_normalized");

DROP INDEX "lead_identities_lead_visitor_source_key";
CREATE UNIQUE INDEX "lead_identities_tenant_id_lead_visitor_source_key" ON "lead_identities"("tenant_id", "lead_id", "visitor_id", "link_source");

DROP INDEX "daily_metric_rollups_property_day_key";
CREATE UNIQUE INDEX "daily_metric_rollups_tenant_id_property_day_key" ON "daily_metric_rollups"("tenant_id", "property_id", "day");

DROP INDEX "daily_ingest_rollups_property_day_key";
CREATE UNIQUE INDEX "daily_ingest_rollups_tenant_id_property_day_key" ON "daily_ingest_rollups"("tenant_id", "property_id", "day");

-- Add Tenant Indices
CREATE INDEX "visitors_tenant_id_idx" ON "visitors"("tenant_id");
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");
CREATE INDEX "events_tenant_id_idx" ON "events"("tenant_id");
CREATE INDEX "leads_tenant_id_idx" ON "leads"("tenant_id");
CREATE INDEX "lead_identities_tenant_id_idx" ON "lead_identities"("tenant_id");
CREATE INDEX "form_submissions_tenant_id_idx" ON "form_submissions"("tenant_id");
CREATE INDEX "consent_events_tenant_id_idx" ON "consent_events"("tenant_id");
CREATE INDEX "ingest_rejections_tenant_id_idx" ON "ingest_rejections"("tenant_id");
CREATE INDEX "daily_metric_rollups_tenant_id_idx" ON "daily_metric_rollups"("tenant_id");
CREATE INDEX "daily_ingest_rollups_tenant_id_idx" ON "daily_ingest_rollups"("tenant_id");

-- Seed Bootstrap API Keys (deterministic for dev/test parity)
-- Ingest Key: akt_test_ingest_key_1234567890
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

-- Admin Key: akt_test_admin_key_1234567890
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
