import type { ConsentStatus } from "./schema-enums.js";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface Visitor {
  id: string;
  tenantId: string;
  anonId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstIpHash: string | null;
  lastIpHash: string | null;
  firstUaHash: string | null;
  lastUaHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  tenantId: string;
  visitorId: string;
  startedAt: Date;
  endedAt: Date | null;
  lastEventAt: Date;
  landingPath: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Lead {
  id: string;
  tenantId: string;
  emailNormalized: string;
  emailDomain: string | null;
  consentStatus: ConsentStatus;
  firstCapturedAt: Date;
  lastCapturedAt: Date;
  sourceChannel: string | null;
  createdAt: Date;
  updatedAt: Date;
}
