import { createHash, randomUUID } from "node:crypto";

import { DeviceType, TrafficSource } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { tableRef, typeRef } from "../lib/sql.js";
import type { EventBody } from "../schemas/events.js";
import { ensureVisitorSession } from "./visitors.js";
import type { RequestContext } from "../lib/request-context.js";

export interface EventIngestResult {
  eventId: string;
  visitorId: string;
  sessionId: string;
}

interface EventRecord {
  id: string;
  visitorId: string;
  sessionId: string | null;
}

const EVENTS_TABLE = tableRef("events");
const TRAFFIC_SOURCE_TYPE = typeRef("TrafficSource");
const DEVICE_TYPE_TYPE = typeRef("DeviceType");
const DEDUPE_WINDOW_MS = 30_000;

const normalizeOptional = (value?: string): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeHost = (value?: string): string | null => {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    return null;
  }

  const withoutScheme = normalized.replace(/^https?:\/\//i, "");
  const [withoutPath] = withoutScheme.split("/");
  const withoutPort = (withoutPath ?? "").split(":")[0] ?? "";
  const hostname = withoutPort.toLowerCase().replace(/^www\./, "");
  return hostname.length > 0 ? hostname : null;
};

const stableStringify = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sortedEntries = Object.entries(record).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${sortedEntries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const buildEventDedupeKey = (
  body: EventBody,
  sessionId: string,
  context: RequestContext,
  dedupeTimeToken: string,
): string => {
  const components = [
    "v1",
    body.anonId,
    sessionId,
    body.eventType,
    body.path,
    dedupeTimeToken,
    body.referrer ?? "",
    context.ipHash,
    context.uaHash,
    stableStringify(body.utm ?? null),
    stableStringify(body.traffic ?? null),
    stableStringify(body.props ?? null),
  ];

  return createHash("sha256").update(components.join("|")).digest("hex");
};

const toReferrerHost = (referrer?: string): string | null => {
  if (!referrer) {
    return null;
  }

  try {
    return normalizeHost(new URL(referrer).host);
  } catch {
    return null;
  }
};

const isSearchEngineHost = (host: string): boolean =>
  [
    "google.",
    "bing.com",
    "duckduckgo.com",
    "search.yahoo.com",
    "baidu.com",
    "yandex.",
    "ecosia.org",
    "startpage.com",
  ].some((token) => host.includes(token));

const isSocialHost = (host: string): boolean =>
  [
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "t.co",
    "reddit.com",
    "youtube.com",
    "tiktok.com",
    "pinterest.com",
  ].some((token) => host.includes(token));

const resolveTrafficSource = (
  body: EventBody,
  referrerHost: string | null,
  requestHost: string | null,
): TrafficSource => {
  const medium = normalizeOptional(body.utm?.medium)?.toLowerCase();
  const source = normalizeOptional(body.utm?.source)?.toLowerCase();

  if (medium) {
    if (/(cpc|ppc|paid|display|retarget)/.test(medium)) {
      return TrafficSource.paid_search;
    }
    if (medium.includes("email")) {
      return TrafficSource.email;
    }
    if (medium.includes("social")) {
      return TrafficSource.social;
    }
    if (medium.includes("organic")) {
      return TrafficSource.organic_search;
    }
  }

  if (source) {
    if (isSearchEngineHost(source)) {
      return TrafficSource.organic_search;
    }
    if (isSocialHost(source)) {
      return TrafficSource.social;
    }
    return TrafficSource.campaign;
  }

  if (!referrerHost) {
    return TrafficSource.direct;
  }

  if (requestHost && referrerHost === requestHost) {
    return TrafficSource.internal;
  }

  if (isSearchEngineHost(referrerHost)) {
    return TrafficSource.organic_search;
  }

  if (isSocialHost(referrerHost)) {
    return TrafficSource.social;
  }

  return TrafficSource.referral;
};

type DeviceTypeHint = NonNullable<EventBody["traffic"]>["deviceType"];

const resolveDeviceType = (
  explicit: DeviceTypeHint | undefined,
  userAgent: string,
): DeviceType => {
  if (explicit) {
    switch (explicit) {
      case "desktop":
        return DeviceType.desktop;
      case "mobile":
        return DeviceType.mobile;
      case "tablet":
        return DeviceType.tablet;
      case "bot":
        return DeviceType.bot;
      case "unknown":
        return DeviceType.unknown;
    }
  }

  const ua = userAgent.toLowerCase();
  if (/(bot|crawler|spider|headless)/.test(ua)) {
    return DeviceType.bot;
  }
  if (/(ipad|tablet)/.test(ua)) {
    return DeviceType.tablet;
  }
  if (/(mobile|iphone|android)/.test(ua)) {
    return DeviceType.mobile;
  }
  return DeviceType.desktop;
};

export const ingestEvent = async (
  tx: Prisma.TransactionClient,
  body: EventBody,
  context: RequestContext,
): Promise<EventIngestResult> => {
  const occurredAt = body.timestamp ?? new Date();
  const { visitor, session } = await ensureVisitorSession(tx, {
    anonId: body.anonId,
    occurredAt,
    request: context,
    path: body.path,
    referrer: body.referrer,
    utm: body.utm,
  });
  const dedupeTimeToken =
    body.timestamp instanceof Date
      ? body.timestamp.toISOString()
      : `window:${Math.floor(occurredAt.getTime() / DEDUPE_WINDOW_MS)}`;
  const dedupeKey = buildEventDedupeKey(
    body,
    session.id,
    context,
    dedupeTimeToken,
  );

  const eventId = randomUUID();

  const referrer = normalizeOptional(body.referrer);
  const referrerHost = toReferrerHost(referrer ?? undefined);
  const requestHost = normalizeHost(context.host);
  const webVitals = body.traffic?.webVitals;

  // Build enriched props: merge user-supplied props with CWV + engagement
  const enrichedProps: Record<string, unknown> = {
    ...body.props,
    ...(webVitals?.fcpMs != null && { fcpMs: webVitals.fcpMs }),
    ...(webVitals?.lcpMs != null && { lcpMs: webVitals.lcpMs }),
    ...(webVitals?.inpMs != null && { inpMs: webVitals.inpMs }),
    ...(webVitals?.ttfbMs != null && { ttfbMs: webVitals.ttfbMs }),
    ...(webVitals?.clsScore != null && { clsScore: webVitals.clsScore }),
    ...(body.traffic?.engagedTimeMs != null && {
      engagedTimeMs: body.traffic.engagedTimeMs,
    }),
    ...(body.traffic?.scrollDepthPercent != null && {
      scrollDepthPercent: body.traffic.scrollDepthPercent,
    }),
  };
  const serializedProps =
    Object.keys(enrichedProps).length > 0
      ? JSON.stringify(enrichedProps)
      : null;

  const trafficSource = resolveTrafficSource(body, referrerHost, requestHost);
  const deviceType = resolveDeviceType(
    body.traffic?.deviceType,
    context.userAgent,
  );
  const propertyId =
    normalizeOptional(body.traffic?.propertyId) ?? requestHost ?? "unknown";
  const countryCode =
    normalizeOptional(body.traffic?.countryCode)?.toUpperCase() ?? null;
  const isEntrance = body.traffic?.isEntrance ?? body.eventType === "page_view";
  const isExit = body.traffic?.isExit ?? false;
  const isConversion =
    body.traffic?.isConversion ?? body.eventType === "form_submit";

  const insertedRows = await tx.$queryRaw<Array<EventRecord>>`
    INSERT INTO ${EVENTS_TABLE} (
      "id", "visitor_id", "session_id", "dedupe_key",
      "event_type", "path", "timestamp",
      "ip_hash", "ua_hash", "props",
      "property_id", "traffic_source", "device_type",
      "country_code", "is_entrance", "is_exit", "is_conversion"
    )
    VALUES (
      ${eventId}, ${visitor.id}, ${session.id}, ${dedupeKey},
      ${body.eventType}, ${body.path}, ${occurredAt},
      ${context.ipHash}, ${context.uaHash}, ${serializedProps}::jsonb,
      ${propertyId}, ${trafficSource}::${TRAFFIC_SOURCE_TYPE}, ${deviceType}::${DEVICE_TYPE_TYPE},
      ${countryCode}, ${isEntrance}, ${isExit}, ${isConversion}
    )
    ON CONFLICT ("dedupe_key") DO NOTHING
    RETURNING "id", "visitor_id" AS "visitorId", "session_id" AS "sessionId"
  `;

  let event = insertedRows[0];
  if (!event) {
    const existing = await tx.event.findUnique({
      where: { dedupeKey },
      select: {
        id: true,
        visitorId: true,
        sessionId: true,
      },
    });
    if (!existing) {
      throw new Error("event_dedupe_lookup_failed");
    }
    event = existing;
  }

  return {
    eventId: event.id,
    visitorId: event.visitorId,
    sessionId: event.sessionId ?? session.id,
  };
};
