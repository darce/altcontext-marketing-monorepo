-- CreateEnum
CREATE TYPE "TrafficSource" AS ENUM ('direct', 'organic_search', 'paid_search', 'social', 'email', 'referral', 'campaign', 'internal', 'unknown');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('desktop', 'mobile', 'tablet', 'bot', 'unknown');

-- CreateTable
CREATE TABLE "web_traffic_logs" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "visitor_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "property_id" VARCHAR(128) NOT NULL DEFAULT 'default',
    "host" VARCHAR(255) NOT NULL,
    "path" TEXT NOT NULL,
    "referrer" TEXT,
    "referrer_host" VARCHAR(255),
    "traffic_source" "TrafficSource" NOT NULL DEFAULT 'unknown',
    "utm_source" VARCHAR(255),
    "utm_medium" VARCHAR(255),
    "utm_campaign" VARCHAR(255),
    "utm_term" VARCHAR(255),
    "utm_content" VARCHAR(255),
    "page_title" VARCHAR(512),
    "language" VARCHAR(32),
    "device_type" "DeviceType" NOT NULL DEFAULT 'unknown',
    "browser_name" VARCHAR(64),
    "browser_version" VARCHAR(32),
    "os_name" VARCHAR(64),
    "os_version" VARCHAR(32),
    "country_code" VARCHAR(2),
    "region" VARCHAR(128),
    "city" VARCHAR(128),
    "timezone" VARCHAR(64),
    "screen_width" INTEGER,
    "screen_height" INTEGER,
    "viewport_width" INTEGER,
    "viewport_height" INTEGER,
    "engaged_time_ms" INTEGER,
    "scroll_depth_percent" INTEGER,
    "fcp_ms" INTEGER,
    "lcp_ms" INTEGER,
    "inp_ms" INTEGER,
    "cls_score" DOUBLE PRECISION,
    "ttfb_ms" INTEGER,
    "is_entrance" BOOLEAN NOT NULL DEFAULT false,
    "is_exit" BOOLEAN NOT NULL DEFAULT false,
    "is_conversion" BOOLEAN NOT NULL DEFAULT false,
    "ip_hash" VARCHAR(128),
    "ua_hash" VARCHAR(128),
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_traffic_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_traffic_logs_event_id_key" ON "web_traffic_logs"("event_id");

-- CreateIndex
CREATE INDEX "web_traffic_logs_property_id_occurred_at_idx" ON "web_traffic_logs"("property_id", "occurred_at");

-- CreateIndex
CREATE INDEX "web_traffic_logs_host_path_occurred_at_idx" ON "web_traffic_logs"("host", "path", "occurred_at");

-- CreateIndex
CREATE INDEX "web_traffic_logs_traffic_source_occurred_at_idx" ON "web_traffic_logs"("traffic_source", "occurred_at");

-- CreateIndex
CREATE INDEX "web_traffic_logs_visitor_id_occurred_at_idx" ON "web_traffic_logs"("visitor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "web_traffic_logs_session_id_occurred_at_idx" ON "web_traffic_logs"("session_id", "occurred_at");

-- CreateIndex
CREATE INDEX "web_traffic_logs_utm_occurred_at_idx" ON "web_traffic_logs"("utm_source", "utm_medium", "utm_campaign", "occurred_at");

-- CreateIndex
CREATE INDEX "web_traffic_logs_device_type_occurred_at_idx" ON "web_traffic_logs"("device_type", "occurred_at");

-- AddForeignKey
ALTER TABLE "web_traffic_logs" ADD CONSTRAINT "web_traffic_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_traffic_logs" ADD CONSTRAINT "web_traffic_logs_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_traffic_logs" ADD CONSTRAINT "web_traffic_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
