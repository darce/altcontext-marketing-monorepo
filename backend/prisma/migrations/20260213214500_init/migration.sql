-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('pending', 'express', 'implied', 'withdrawn');

-- CreateEnum
CREATE TYPE "LinkSource" AS ENUM ('form_submit', 'same_ip_ua_window', 'manual_merge');

-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('accepted', 'rejected', 'invalid');

-- CreateTable
CREATE TABLE "visitors" (
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "session_id" TEXT,
    "event_type" VARCHAR(64) NOT NULL,
    "path" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" VARCHAR(128),
    "ua_hash" VARCHAR(128),
    "props" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "email_normalized" VARCHAR(320) NOT NULL,
    "email_domain" VARCHAR(255),
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
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL,
    "source" VARCHAR(128) NOT NULL,
    "ip_hash" VARCHAR(128),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visitors_anon_id_key" ON "visitors"("anon_id");

-- CreateIndex
CREATE INDEX "visitors_last_seen_at_idx" ON "visitors"("last_seen_at");

-- CreateIndex
CREATE INDEX "sessions_visitor_id_started_at_idx" ON "sessions"("visitor_id", "started_at");

-- CreateIndex
CREATE INDEX "sessions_visitor_id_last_event_at_idx" ON "sessions"("visitor_id", "last_event_at");

-- CreateIndex
CREATE INDEX "events_visitor_id_timestamp_idx" ON "events"("visitor_id", "timestamp");

-- CreateIndex
CREATE INDEX "events_event_type_timestamp_idx" ON "events"("event_type", "timestamp");

-- CreateIndex
CREATE INDEX "events_path_timestamp_idx" ON "events"("path", "timestamp");

-- CreateIndex
CREATE INDEX "events_session_id_timestamp_idx" ON "events"("session_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "leads_email_normalized_key" ON "leads"("email_normalized");

-- CreateIndex
CREATE INDEX "leads_last_captured_at_idx" ON "leads"("last_captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_identities_lead_visitor_source_key" ON "lead_identities"("lead_id", "visitor_id", "link_source");

-- CreateIndex
CREATE INDEX "lead_identities_lead_id_linked_at_idx" ON "lead_identities"("lead_id", "linked_at");

-- CreateIndex
CREATE INDEX "lead_identities_visitor_id_linked_at_idx" ON "lead_identities"("visitor_id", "linked_at");

-- CreateIndex
CREATE INDEX "form_submissions_lead_id_submitted_at_idx" ON "form_submissions"("lead_id", "submitted_at");

-- CreateIndex
CREATE INDEX "form_submissions_visitor_id_submitted_at_idx" ON "form_submissions"("visitor_id", "submitted_at");

-- CreateIndex
CREATE INDEX "form_submissions_session_id_submitted_at_idx" ON "form_submissions"("session_id", "submitted_at");

-- CreateIndex
CREATE INDEX "consent_events_lead_id_timestamp_idx" ON "consent_events"("lead_id", "timestamp");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identities" ADD CONSTRAINT "lead_identities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_identities" ADD CONSTRAINT "lead_identities_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
