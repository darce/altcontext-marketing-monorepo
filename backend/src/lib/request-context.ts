import { createHmac, createSecretKey } from "node:crypto";

import type { FastifyRequest } from "fastify";

import { env } from "../config/env.js";

export interface RequestContext {
  ipHash: string;
  uaHash: string;
  host: string;
  requestIp: string;
  userAgent: string;
}

const pepperKey = createSecretKey(Buffer.from(env.IP_HASH_PEPPER));

const hashValue = (value: string): string =>
  createHmac("sha256", pepperKey).update(value).digest("hex");

const readRequestIp = (request: FastifyRequest): string => {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const [first] = forwarded.split(",");
    if (first && first.trim().length > 0) {
      return first.trim();
    }
  }
  return request.ip;
};

const readUserAgent = (request: FastifyRequest): string => {
  const raw = request.headers["user-agent"];
  return typeof raw === "string" && raw.length > 0 ? raw : "unknown";
};

const readHost = (request: FastifyRequest): string => {
  const forwardedHost = request.headers["x-forwarded-host"];
  if (typeof forwardedHost === "string" && forwardedHost.trim().length > 0) {
    const [first] = forwardedHost.split(",");
    if (first && first.trim().length > 0) {
      return first.trim();
    }
  }

  const host = request.headers.host;
  return typeof host === "string" && host.trim().length > 0
    ? host.trim()
    : "unknown";
};

export const requestContextFrom = (request: FastifyRequest): RequestContext => {
  const requestIp = readRequestIp(request);
  const userAgent = readUserAgent(request);
  const host = readHost(request);

  return {
    host,
    requestIp,
    userAgent,
    ipHash: hashValue(requestIp),
    uaHash: hashValue(userAgent),
  };
};
