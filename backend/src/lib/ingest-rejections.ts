export const EVENT_INGEST_ENDPOINT = "/v1/events";
export const LEAD_INGEST_ENDPOINT = "/v1/leads/capture";
export const INVALID_REQUEST_REASON = "invalid_request";

const normalizePathname = (url: string): string => {
  const [pathname] = url.split("?", 2);
  return pathname ?? "";
};

export const resolveIngestEndpoint = (url: string): string | null => {
  const pathname = normalizePathname(url);

  if (pathname === EVENT_INGEST_ENDPOINT) {
    return EVENT_INGEST_ENDPOINT;
  }

  if (pathname === LEAD_INGEST_ENDPOINT) {
    return LEAD_INGEST_ENDPOINT;
  }

  return null;
};
