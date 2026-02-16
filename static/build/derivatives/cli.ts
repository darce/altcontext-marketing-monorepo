import process from "node:process";

import type { BuildOptions, RecropMode } from "./types";

export const getArgValue = (flag: string): string | undefined => {
  const argv = process.argv.slice(2);
  const prefix = `--${flag}=`;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith(prefix)) {
      return token.slice(prefix.length);
    }

    if (token === `--${flag}` && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (!next.startsWith("--")) {
        return next;
      }
    }
  }

  return undefined;
};

export const getVerbose = (): boolean => {
  return (
    process.argv.includes("--verbose") || process.env.BUILD_VERBOSE === "1"
  );
};

export const normalizeSubsetToken = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
};

export const getSubsetPrefixes = (): string[] => {
  const raw = getArgValue("subset") ?? process.env.BUILD_SUBSET;
  if (!raw) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((prefix) => normalizeSubsetToken(prefix.trim()))
        .filter(Boolean),
    ),
  ).sort();
};

export const getLimit = (): number => {
  const raw = getArgValue("limit") ?? process.env.BUILD_LIMIT;
  if (!raw) {
    return 0;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value;
};

/** Resolve recrop behavior from CLI flags and env: none | missing | all. */
export const getRecropMode = (): RecropMode => {
  const raw = (getArgValue("recrop") ?? "").trim().toLowerCase();
  const hasRecropFlag = process.argv.includes("--recrop");
  const hasRecropMissingFlag = process.argv.includes("--recrop-missing");

  if (hasRecropMissingFlag) {
    return "missing";
  }
  if (hasRecropFlag && raw.length === 0) {
    return "all";
  }
  if (raw.length === 0) {
    return "none";
  }

  if (raw === "all" || raw === "true" || raw === "1") {
    return "all";
  }
  if (raw === "missing") {
    return "missing";
  }
  if (raw === "none" || raw === "false" || raw === "0") {
    return "none";
  }

  throw new Error(
    `Invalid --recrop value "${raw}". Use one of: none, missing, all.`,
  );
};

/** Gather build options used to select and process derivative work. */
export const getBuildOptions = (): BuildOptions => {
  return {
    verbose: getVerbose(),
    subsetPrefixes: getSubsetPrefixes(),
    limit: getLimit(),
    recropMode: getRecropMode(),
  };
};
