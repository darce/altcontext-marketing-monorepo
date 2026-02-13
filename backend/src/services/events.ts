import { DeviceType, TrafficSource, type Prisma } from "@prisma/client";

import { toPrismaJson } from "../lib/json.js";
import type { EventBody } from "../schemas/events.js";
import { ensureVisitorSession } from "./visitors.js";
import type { RequestContext } from "../lib/request-context.js";

export interface EventIngestResult {
  eventId: string;
  visitorId: string;
  sessionId: string;
}

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

  const data: Prisma.EventCreateInput = {
    visitor: { connect: { id: visitor.id } },
    session: { connect: { id: session.id } },
    eventType: body.eventType,
    path: body.path,
    timestamp: occurredAt,
    ipHash: context.ipHash,
    uaHash: context.uaHash,
  };
  const props = toPrismaJson(body.props);
  if (props !== undefined) {
    data.props = props;
  }

  const event = await tx.event.create({
    data,
    select: { id: true },
  });

  const referrer = normalizeOptional(body.referrer);
  const referrerHost = toReferrerHost(referrer ?? undefined);
  const requestHost = normalizeHost(context.host);
  const trafficHost =
    normalizeHost(body.traffic?.host) ?? requestHost ?? "unknown";
  const webVitals = body.traffic?.webVitals;

  const trafficLogData: Prisma.WebTrafficLogCreateInput = {
    event: { connect: { id: event.id } },
    visitor: { connect: { id: visitor.id } },
    session: { connect: { id: session.id } },
    eventType: body.eventType,
    propertyId: normalizeOptional(body.traffic?.propertyId) ?? trafficHost,
    host: trafficHost,
    path: body.path,
    referrer,
    referrerHost,
    trafficSource: resolveTrafficSource(body, referrerHost, requestHost),
    utmSource: normalizeOptional(body.utm?.source),
    utmMedium: normalizeOptional(body.utm?.medium),
    utmCampaign: normalizeOptional(body.utm?.campaign),
    utmTerm: normalizeOptional(body.utm?.term),
    utmContent: normalizeOptional(body.utm?.content),
    pageTitle: normalizeOptional(body.traffic?.pageTitle),
    language: normalizeOptional(body.traffic?.language),
    deviceType: resolveDeviceType(body.traffic?.deviceType, context.userAgent),
    browserName: normalizeOptional(body.traffic?.browserName),
    browserVersion: normalizeOptional(body.traffic?.browserVersion),
    osName: normalizeOptional(body.traffic?.osName),
    osVersion: normalizeOptional(body.traffic?.osVersion),
    countryCode:
      normalizeOptional(body.traffic?.countryCode)?.toUpperCase() ?? null,
    region: normalizeOptional(body.traffic?.region),
    city: normalizeOptional(body.traffic?.city),
    timezone: normalizeOptional(body.traffic?.timezone),
    screenWidth: body.traffic?.screenWidth ?? null,
    screenHeight: body.traffic?.screenHeight ?? null,
    viewportWidth: body.traffic?.viewportWidth ?? null,
    viewportHeight: body.traffic?.viewportHeight ?? null,
    engagedTimeMs: body.traffic?.engagedTimeMs ?? null,
    scrollDepthPercent: body.traffic?.scrollDepthPercent ?? null,
    fcpMs: webVitals?.fcpMs ?? null,
    lcpMs: webVitals?.lcpMs ?? null,
    inpMs: webVitals?.inpMs ?? null,
    clsScore: webVitals?.clsScore ?? null,
    ttfbMs: webVitals?.ttfbMs ?? null,
    isEntrance: body.traffic?.isEntrance ?? body.eventType === "page_view",
    isExit: body.traffic?.isExit ?? false,
    isConversion:
      body.traffic?.isConversion ?? body.eventType === "form_submit",
    ipHash: context.ipHash,
    uaHash: context.uaHash,
    occurredAt,
  };
  await tx.webTrafficLog.create({
    data: trafficLogData,
  });

  return {
    eventId: event.id,
    visitorId: visitor.id,
    sessionId: session.id,
  };
};
