import { METADATA_ERROR_HINT } from "./config";
import type {
  AtlasFiles,
  AtlasPlacement,
  MetadataItem,
  PoseBounds,
} from "./types";

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value);

export const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

export const parseAtlasFiles = (value: unknown): AtlasFiles | null => {
  const files = asRecord(value);
  if (!files) {
    return null;
  }

  const low = files.low;
  const mid = files.mid;
  const high = files.high;
  if (
    typeof low !== "string" ||
    low.trim().length === 0 ||
    typeof mid !== "string" ||
    mid.trim().length === 0 ||
    typeof high !== "string" ||
    high.trim().length === 0
  ) {
    return null;
  }

  return { low, mid, high };
};

export const parseAtlasPlacement = (value: unknown): AtlasPlacement | null => {
  if (value === undefined || value === null) {
    return null;
  }

  const placement = asRecord(value);
  if (!placement) {
    return null;
  }

  const column = placement.column;
  const row = placement.row;
  const gridSize = placement.gridSize;
  const file = placement.file;
  const files = parseAtlasFiles(placement.files);
  const normalizedFiles: AtlasFiles | null =
    files ??
    (typeof file === "string" && file.trim().length > 0
      ? {
          low: file,
          mid: file,
          high: file,
        }
      : null);

  if (
    !normalizedFiles ||
    !isFiniteNumber(column) ||
    !isFiniteNumber(row) ||
    !isFiniteNumber(gridSize)
  ) {
    return null;
  }

  const safeColumn = Math.trunc(column);
  const safeRow = Math.trunc(row);
  const safeGridSize = Math.trunc(gridSize);
  if (
    safeColumn < 0 ||
    safeRow < 0 ||
    safeGridSize < 1 ||
    safeColumn >= safeGridSize ||
    safeRow >= safeGridSize
  ) {
    return null;
  }

  return {
    files: normalizedFiles,
    column: safeColumn,
    row: safeRow,
    gridSize: safeGridSize,
  };
};

export const parseMetadataItem = (value: unknown): MetadataItem | null => {
  const item = asRecord(value);
  if (!item) {
    return null;
  }

  const file = item.file;
  if (typeof file !== "string" || file.trim().length === 0) {
    return null;
  }

  const pose = asRecord(item.pose);
  const transform = asRecord(item.transform);
  if (!pose || !transform) {
    return null;
  }

  const yaw = pose.yaw;
  const pitch = pose.pitch;
  const roll = pose.roll;
  const interocularDist = item.interocularDist;
  const landmarkConfidence = item.landmarkConfidence;
  const translateXRatio = transform.translateXRatio;
  const translateYRatio = transform.translateYRatio;
  const rotateRad = transform.rotateRad;
  const scale = transform.scale;

  if (
    !isFiniteNumber(yaw) ||
    !isFiniteNumber(pitch) ||
    !isFiniteNumber(interocularDist) ||
    !isFiniteNumber(translateXRatio) ||
    !isFiniteNumber(translateYRatio) ||
    !isFiniteNumber(rotateRad) ||
    !isFiniteNumber(scale)
  ) {
    return null;
  }

  const rawName = item.name;
  const name =
    typeof rawName === "string" && rawName.trim().length > 0
      ? rawName
      : undefined;
  const atlas = parseAtlasPlacement(item.atlas);
  if (item.atlas !== undefined && atlas === null) {
    return null;
  }
  const rawPreloadTier = item.preloadTier;
  const preloadTier =
    isFiniteNumber(rawPreloadTier) && [0, 1, 2, 3].includes(Math.trunc(rawPreloadTier))
      ? (Math.trunc(rawPreloadTier) as 0 | 1 | 2 | 3)
      : undefined;

  return {
    file,
    pose: { yaw, pitch, roll: isFiniteNumber(roll) ? roll : 0 },
    interocularDist,
    landmarkConfidence: isFiniteNumber(landmarkConfidence)
      ? Math.max(0, Math.min(1, landmarkConfidence))
      : 1,
    name,
    transform: {
      translateXRatio,
      translateYRatio,
      rotateRad,
      scale,
    },
    atlas: atlas ?? undefined,
    preloadTier,
  };
};

/**
 * Load and validate runtime metadata.
 * Invalid entries are dropped so one corrupt record does not break the viewer.
 */
export const loadMetadata = async (): Promise<MetadataItem[]> => {
  const metadataUrl = new URL("metadata.json", document.baseURI).toString();
  const response = await fetch(metadataUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} when loading metadata`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error("Metadata payload is not an array.");
  }

  const items = payload
    .map(parseMetadataItem)
    .filter((item): item is MetadataItem => item !== null);
  if (items.length === 0) {
    throw new Error(METADATA_ERROR_HINT);
  }

  return items;
};

const parsePoseBounds = (value: unknown): PoseBounds | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const minYaw = record.minYaw;
  const maxYaw = record.maxYaw;
  const minPitch = record.minPitch;
  const maxPitch = record.maxPitch;
  if (
    !isFiniteNumber(minYaw) ||
    !isFiniteNumber(maxYaw) ||
    !isFiniteNumber(minPitch) ||
    !isFiniteNumber(maxPitch)
  ) {
    return null;
  }
  if (maxYaw <= minYaw || maxPitch <= minPitch) {
    return null;
  }

  return { minYaw, maxYaw, minPitch, maxPitch };
};

export const loadPoseBounds = async (): Promise<PoseBounds | null> => {
  const boundsUrl = new URL("pose-bounds.json", document.baseURI).toString();
  const response = await fetch(boundsUrl);
  if (!response.ok) {
    return null;
  }
  const payload: unknown = await response.json();
  return parsePoseBounds(payload);
};
