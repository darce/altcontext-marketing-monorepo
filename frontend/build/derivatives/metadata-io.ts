import fs from "node:fs";
import path from "node:path";

import type {
  FacePose,
  FaceRegion,
  JsonRecord,
  Point,
  RuntimeMetadataItem,
  SourceFeatures,
  SourceMetadataItem,
} from "./types";

export const isJsonRecord = (value: unknown): value is JsonRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export const requireRecord = (value: unknown, fieldPath: string): JsonRecord => {
  if (!isJsonRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }
  return value;
};

export const requireNumber = (value: unknown, fieldPath: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldPath} must be a finite number.`);
  }
  return value;
};

export const readOptionalNumber = (
  value: unknown,
  fieldPath: string,
): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireNumber(value, fieldPath);
};

export const requireString = (value: unknown, fieldPath: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${fieldPath} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldPath} must not be empty.`);
  }
  return trimmed;
};

export const readOptionalString = (
  value: unknown,
  fieldPath: string,
): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldPath} must be a string when present.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const readPoint = (value: unknown, fieldPath: string): Point => {
  const point = requireRecord(value, fieldPath);
  return {
    x: requireNumber(point.x, `${fieldPath}.x`),
    y: requireNumber(point.y, `${fieldPath}.y`),
  };
};

export const readRegion = (value: unknown, fieldPath: string): FaceRegion => {
  const region = requireRecord(value, fieldPath);
  const width = requireNumber(region.w, `${fieldPath}.w`);
  const height = requireNumber(region.h, `${fieldPath}.h`);
  if (width <= 0 || height <= 0) {
    throw new Error(`${fieldPath}.w and ${fieldPath}.h must be > 0.`);
  }

  return {
    x: requireNumber(region.x, `${fieldPath}.x`),
    y: requireNumber(region.y, `${fieldPath}.y`),
    w: width,
    h: height,
  };
};

export const readPose = (value: unknown, fieldPath: string): FacePose => {
  const pose = requireRecord(value, fieldPath);
  return {
    pitch: requireNumber(pose.pitch, `${fieldPath}.pitch`),
    yaw: requireNumber(pose.yaw, `${fieldPath}.yaw`),
    roll: requireNumber(pose.roll, `${fieldPath}.roll`),
  };
};

export const readFeatures = (value: unknown, fieldPath: string): SourceFeatures => {
  const features = requireRecord(value, fieldPath);
  const eyes = requireRecord(features.eyes, `${fieldPath}.eyes`);
  const mouth = requireRecord(features.mouth, `${fieldPath}.mouth`);
  const oval = requireRecord(features.oval, `${fieldPath}.oval`);

  return {
    eyes: {
      l: readPoint(eyes.l, `${fieldPath}.eyes.l`),
      r: readPoint(eyes.r, `${fieldPath}.eyes.r`),
      innerL: readPoint(eyes.innerL, `${fieldPath}.eyes.innerL`),
      innerR: readPoint(eyes.innerR, `${fieldPath}.eyes.innerR`),
    },
    mouth: {
      l: readPoint(mouth.l, `${fieldPath}.mouth.l`),
      r: readPoint(mouth.r, `${fieldPath}.mouth.r`),
    },
    chin: readPoint(features.chin, `${fieldPath}.chin`),
    oval: {
      l: readPoint(oval.l, `${fieldPath}.oval.l`),
      r: readPoint(oval.r, `${fieldPath}.oval.r`),
    },
    forehead: readPoint(features.forehead, `${fieldPath}.forehead`),
  };
};

export const normalizeRelativePath = (value: string, fieldPath: string): string => {
  const normalized = path.posix.normalize(value.replace(/\\/g, "/").trim());
  if (normalized.length === 0 || normalized === ".") {
    throw new Error(`${fieldPath} must be a non-empty relative path.`);
  }
  if (path.posix.isAbsolute(normalized)) {
    throw new Error(`${fieldPath} must not be absolute.`);
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${fieldPath} must not escape its base directory.`);
  }
  return normalized;
};

export const readSourcePath = (value: unknown, fieldPath: string): string => {
  const sourcePath = normalizeRelativePath(
    requireString(value, fieldPath),
    fieldPath,
  );
  const extension = path.posix.extname(sourcePath).toLowerCase();
  if (!extension) {
    throw new Error(`${fieldPath} must include a file extension.`);
  }
  return sourcePath;
};

export const readOutputFile = (value: unknown, fieldPath: string): string => {
  const outputFile = normalizeRelativePath(
    requireString(value, fieldPath),
    fieldPath,
  );
  if (outputFile.includes("/")) {
    throw new Error(`${fieldPath} must be a filename, not a nested path.`);
  }
  if (path.posix.extname(outputFile).toLowerCase() !== ".webp") {
    throw new Error(`${fieldPath} must use a .webp extension.`);
  }
  return outputFile;
};

export const parseSourceMetadataItem = (
  value: unknown,
  index: number,
): SourceMetadataItem => {
  const item = requireRecord(value, `metadata[${index}]`);
  const rawLandmarkConfidence =
    readOptionalNumber(
      item.landmarkConfidence,
      `metadata[${index}].landmarkConfidence`,
    ) ?? 1;
  const landmarkConfidence = Math.max(0, Math.min(1, rawLandmarkConfidence));

  return {
    source: readSourcePath(item.source, `metadata[${index}].source`),
    file: readOutputFile(item.file, `metadata[${index}].file`),
    region: readRegion(item.region, `metadata[${index}].region`),
    pose: readPose(item.pose, `metadata[${index}].pose`),
    features: readFeatures(item.features, `metadata[${index}].features`),
    landmarkConfidence,
    name: readOptionalString(item.name, `metadata[${index}].name`),
  };
};

/** Parse and validate metadata-source.json at the IO boundary. */
export const parseSourceMetadata = (
  rawJson: string,
  filePath: string,
): SourceMetadataItem[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${errorMessage(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON array.`);
  }

  const items: SourceMetadataItem[] = [];
  for (let index = 0; index < parsed.length; index += 1) {
    items.push(parseSourceMetadataItem(parsed[index], index));
  }
  return items;
};

export const compareStrings = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

export const sortSourceItems = (items: SourceMetadataItem[]): SourceMetadataItem[] => {
  return [...items].sort((a, b) => {
    const fileCompare = compareStrings(a.file, b.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }
    return compareStrings(a.source, b.source);
  });
};

export const writeRuntimeMetadata = (
  outputFile: string,
  runtimeItems: RuntimeMetadataItem[],
): void => {
  const sorted = [...runtimeItems].sort((a, b) => compareStrings(a.file, b.file));
  fs.writeFileSync(outputFile, JSON.stringify(sorted), { encoding: "utf8" });
};
