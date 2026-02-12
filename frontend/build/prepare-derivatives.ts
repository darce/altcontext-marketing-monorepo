import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const INPUT_DIR = "./input-images";
const SOURCE_METADATA_FILE = "./public/metadata-source.json";
const RUNTIME_METADATA_FILE = "./public/metadata.json";
const OUTPUT_IMAGE_DIR = "./public/input-images";

const CROP_BUFFER = 0.4;
const OUTPUT_SIZE = 640;
const WEBP_QUALITY = 60;
const COORDINATE_DECIMALS = 4;
const POSE_DECIMALS = 2;
const SCALE_DECIMALS = 6;
const PROGRESS_LOG_INTERVAL = 25;
const ALIGNMENT_MARGIN_RATIO = 0.09;
const ALIGNMENT_TARGET_EYE_X_RATIO = 0.5;
const ALIGNMENT_TARGET_EYE_Y_RATIO = 0.44;
const ALIGNMENT_HEAD_SCALE_FACTOR = 0.9;

interface Point {
  x: number;
  y: number;
}

interface FaceRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FacePose {
  pitch: number;
  yaw: number;
  roll: number;
}

interface SourceFeatures {
  eyes: { l: Point; r: Point; innerL: Point; innerR: Point };
  mouth: { l: Point; r: Point };
  chin: Point;
  oval: { l: Point; r: Point };
  forehead: Point;
}

interface SourceMetadataItem {
  source: string;
  file: string;
  region: FaceRegion;
  pose: FacePose;
  features: SourceFeatures;
  name?: string;
}

interface RuntimeMetadataItem {
  file: string;
  pose: { pitch: number; yaw: number; roll: number };
  region: FaceRegion;
  srcScalePx: number;
  interocularDist: number;
  interocularBlend: number;
  transform: RuntimeTransform;
  features: {
    eyes: { l: Point; r: Point };
    mouth: { l: Point; r: Point };
    chin: Point;
    forehead: Point;
  };
  name?: string;
}

interface ImageSize {
  width: number;
  height: number;
}

interface CropBox {
  left: number;
  top: number;
  size: number;
}

interface RuntimeTransform {
  translateXRatio: number;
  translateYRatio: number;
  rotateRad: number;
  scale: number;
}

type JsonRecord = Record<string, unknown>;
type RecropMode = "none" | "missing" | "all";

interface BuildOptions {
  verbose: boolean;
  subsetPrefixes: string[];
  limit: number;
  recropMode: RecropMode;
}

interface ProcessStats {
  runtimeItems: RuntimeMetadataItem[];
  renderedCount: number;
  reusedCount: number;
  missingOutputs: string[];
  renderedSourceBytes: number;
  renderedOutputBytes: number;
}

const getArgValue = (flag: string): string | undefined => {
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

const getVerbose = (): boolean => {
  return (
    process.argv.includes("--verbose") || process.env.BUILD_VERBOSE === "1"
  );
};

const normalizeSubsetToken = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
};

const getSubsetPrefixes = (): string[] => {
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

const getLimit = (): number => {
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
const getRecropMode = (): RecropMode => {
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
const getBuildOptions = (): BuildOptions => {
  return {
    verbose: getVerbose(),
    subsetPrefixes: getSubsetPrefixes(),
    limit: getLimit(),
    recropMode: getRecropMode(),
  };
};

const isJsonRecord = (value: unknown): value is JsonRecord => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const requireRecord = (value: unknown, fieldPath: string): JsonRecord => {
  if (!isJsonRecord(value)) {
    throw new Error(`${fieldPath} must be an object.`);
  }
  return value;
};

const requireNumber = (value: unknown, fieldPath: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldPath} must be a finite number.`);
  }
  return value;
};

const requireString = (value: unknown, fieldPath: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${fieldPath} must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldPath} must not be empty.`);
  }
  return trimmed;
};

const readOptionalString = (
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

const readPoint = (value: unknown, fieldPath: string): Point => {
  const point = requireRecord(value, fieldPath);
  return {
    x: requireNumber(point.x, `${fieldPath}.x`),
    y: requireNumber(point.y, `${fieldPath}.y`),
  };
};

const readRegion = (value: unknown, fieldPath: string): FaceRegion => {
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

const readPose = (value: unknown, fieldPath: string): FacePose => {
  const pose = requireRecord(value, fieldPath);
  return {
    pitch: requireNumber(pose.pitch, `${fieldPath}.pitch`),
    yaw: requireNumber(pose.yaw, `${fieldPath}.yaw`),
    roll: requireNumber(pose.roll, `${fieldPath}.roll`),
  };
};

const readFeatures = (value: unknown, fieldPath: string): SourceFeatures => {
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

const normalizeRelativePath = (value: string, fieldPath: string): string => {
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

const readSourcePath = (value: unknown, fieldPath: string): string => {
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

const readOutputFile = (value: unknown, fieldPath: string): string => {
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

const parseSourceMetadataItem = (
  value: unknown,
  index: number,
): SourceMetadataItem => {
  const item = requireRecord(value, `metadata[${index}]`);
  return {
    source: readSourcePath(item.source, `metadata[${index}].source`),
    file: readOutputFile(item.file, `metadata[${index}].file`),
    region: readRegion(item.region, `metadata[${index}].region`),
    pose: readPose(item.pose, `metadata[${index}].pose`),
    features: readFeatures(item.features, `metadata[${index}].features`),
    name: readOptionalString(item.name, `metadata[${index}].name`),
  };
};

/** Parse and validate metadata-source.json at the IO boundary. */
const parseSourceMetadata = (
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

const compareStrings = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const sortSourceItems = (items: SourceMetadataItem[]): SourceMetadataItem[] => {
  return [...items].sort((a, b) => {
    const fileCompare = compareStrings(a.file, b.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }
    return compareStrings(a.source, b.source);
  });
};

const resolvePathWithin = (
  baseDir: string,
  relativePath: string,
  fieldPath: string,
): string => {
  const baseAbsolutePath = path.resolve(baseDir);
  const targetAbsolutePath = path.resolve(baseAbsolutePath, relativePath);
  const relativeToBase = path.relative(baseAbsolutePath, targetAbsolutePath);

  if (relativeToBase.startsWith("..") || path.isAbsolute(relativeToBase)) {
    throw new Error(
      `${fieldPath} resolves outside ${baseDir}: "${relativePath}"`,
    );
  }

  return targetAbsolutePath;
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const dist = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const getImageSize = (imagePath: string): ImageSize => {
  const output = execFileSync(
    "magick",
    [imagePath, "-ping", "-format", "%w %h", "info:"],
    {
      encoding: "utf8",
    },
  ).trim();

  const [widthRaw, heightRaw] = output.split(/\s+/);
  const width = Number.parseInt(widthRaw, 10);
  const height = Number.parseInt(heightRaw, 10);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid image dimensions for ${imagePath}: "${output}"`);
  }

  return { width, height };
};

const pointToPixels = (point: Point, size: ImageSize): Point => {
  return {
    x: point.x * size.width,
    y: point.y * size.height,
  };
};

/** Compute a square crop around the face with deterministic padding. */
const computeCrop = (item: SourceMetadataItem, size: ImageSize): CropBox => {
  const ovalLeft = pointToPixels(item.features.oval.l, size);
  const ovalRight = pointToPixels(item.features.oval.r, size);
  const forehead = pointToPixels(item.features.forehead, size);
  const chin = pointToPixels(item.features.chin, size);
  const eyeLeft = pointToPixels(item.features.eyes.l, size);
  const eyeRight = pointToPixels(item.features.eyes.r, size);
  const mouthLeft = pointToPixels(item.features.mouth.l, size);
  const mouthRight = pointToPixels(item.features.mouth.r, size);

  const left = Math.min(ovalLeft.x, ovalRight.x);
  const right = Math.max(ovalLeft.x, ovalRight.x);
  const top = Math.min(forehead.y, eyeLeft.y, eyeRight.y);
  const bottom = Math.max(chin.y, mouthLeft.y, mouthRight.y);

  const headWidth = Math.max(2, right - left);
  const headHeight = Math.max(2, bottom - top);
  const headSize = Math.max(headWidth, headHeight);
  const paddedSize = headSize * (1 + CROP_BUFFER * 2);
  const maxSquare = Math.min(size.width, size.height);
  let cropSize = Math.floor(clamp(paddedSize, 2, maxSquare));

  const centerX = (left + right) * 0.5;
  const centerY = (top + bottom) * 0.5;
  let cropLeft = Math.floor(centerX - cropSize * 0.5);
  let cropTop = Math.floor(centerY - cropSize * 0.5);

  if (cropLeft < 0) {
    cropLeft = 0;
  }
  if (cropTop < 0) {
    cropTop = 0;
  }
  if (cropLeft + cropSize > size.width) {
    cropLeft = Math.max(0, size.width - cropSize);
  }
  if (cropTop + cropSize > size.height) {
    cropTop = Math.max(0, size.height - cropSize);
  }

  if (cropSize <= 1) {
    cropSize = Math.max(2, Math.min(size.width, size.height));
    cropLeft = Math.max(0, Math.floor((size.width - cropSize) * 0.5));
    cropTop = Math.max(0, Math.floor((size.height - cropSize) * 0.5));
  }

  return {
    left: cropLeft,
    top: cropTop,
    size: cropSize,
  };
};

const mapPointToCrop = (
  point: Point,
  size: ImageSize,
  crop: CropBox,
): Point => {
  const pixelX = point.x * size.width;
  const pixelY = point.y * size.height;

  return {
    x: roundTo(
      clamp((pixelX - crop.left) / crop.size, 0, 1),
      COORDINATE_DECIMALS,
    ),
    y: roundTo(
      clamp((pixelY - crop.top) / crop.size, 0, 1),
      COORDINATE_DECIMALS,
    ),
  };
};

const mapRegionToCrop = (
  region: FaceRegion,
  size: ImageSize,
  crop: CropBox,
): FaceRegion => {
  const xPx = region.x * size.width;
  const yPx = region.y * size.height;
  const wPx = region.w * size.width;
  const hPx = region.h * size.height;

  let x1 = (xPx - crop.left) / crop.size;
  let y1 = (yPx - crop.top) / crop.size;
  let x2 = (xPx + wPx - crop.left) / crop.size;
  let y2 = (yPx + hPx - crop.top) / crop.size;

  x1 = clamp(x1, 0, 1);
  y1 = clamp(y1, 0, 1);
  x2 = clamp(x2, 0, 1);
  y2 = clamp(y2, 0, 1);

  if (x2 <= x1 || y2 <= y1) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }

  return {
    x: roundTo(x1, COORDINATE_DECIMALS),
    y: roundTo(y1, COORDINATE_DECIMALS),
    w: roundTo(x2 - x1, COORDINATE_DECIMALS),
    h: roundTo(y2 - y1, COORDINATE_DECIMALS),
  };
};

/**
 * Precompute a normalized transform so runtime can align faces without
 * recalculating geometry for every frame.
 */
const computeRuntimeTransform = (
  eyeLeft: Point,
  eyeRight: Point,
  chin: Point,
  forehead: Point,
): RuntimeTransform => {
  const midEye: Point = {
    x: (eyeLeft.x + eyeRight.x) * 0.5,
    y: (eyeLeft.y + eyeRight.y) * 0.5,
  };

  const eyeVector: Point = {
    x: eyeRight.x - eyeLeft.x,
    y: eyeRight.y - eyeLeft.y,
  };

  const rotateRad = -Math.atan2(eyeVector.y, eyeVector.x);
  const cos = Math.cos(rotateRad);
  const sin = Math.sin(rotateRad);

  const rotatePoint = (point: Point): Point => {
    return {
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    };
  };

  const rotatedForehead = rotatePoint(forehead);
  const rotatedChin = rotatePoint(chin);
  const sourceHeadTop = Math.min(rotatedForehead.y, rotatedChin.y);
  const sourceHeadBottom = Math.max(rotatedForehead.y, rotatedChin.y);
  const sourceHeadHeight = Math.max(1e-6, sourceHeadBottom - sourceHeadTop);

  const targetHeadHeight = 1 - ALIGNMENT_MARGIN_RATIO * 2;
  const scale = clamp(
    (targetHeadHeight / sourceHeadHeight) * ALIGNMENT_HEAD_SCALE_FACTOR,
    0.05,
    8,
  );

  const rotatedMidEye = rotatePoint(midEye);
  const scaledMidEye: Point = {
    x: rotatedMidEye.x * scale,
    y: rotatedMidEye.y * scale,
  };

  const translateXRatio = ALIGNMENT_TARGET_EYE_X_RATIO - scaledMidEye.x;
  const translateYRatio = ALIGNMENT_TARGET_EYE_Y_RATIO - scaledMidEye.y;

  if (
    !Number.isFinite(scale) ||
    !Number.isFinite(rotateRad) ||
    !Number.isFinite(translateXRatio) ||
    !Number.isFinite(translateYRatio)
  ) {
    throw new Error("Invalid precomputed transform for runtime metadata.");
  }

  return {
    translateXRatio: roundTo(translateXRatio, SCALE_DECIMALS),
    translateYRatio: roundTo(translateYRatio, SCALE_DECIMALS),
    rotateRad: roundTo(rotateRad, SCALE_DECIMALS),
    scale: roundTo(scale, SCALE_DECIMALS),
  };
};

const buildRuntimeMetadata = (
  item: SourceMetadataItem,
  size: ImageSize,
  crop: CropBox,
): RuntimeMetadataItem => {
  const eyeLeft = mapPointToCrop(item.features.eyes.l, size, crop);
  const eyeRight = mapPointToCrop(item.features.eyes.r, size, crop);
  const eyeInnerLeft = mapPointToCrop(item.features.eyes.innerL, size, crop);
  const eyeInnerRight = mapPointToCrop(item.features.eyes.innerR, size, crop);
  const mouthLeft = mapPointToCrop(item.features.mouth.l, size, crop);
  const mouthRight = mapPointToCrop(item.features.mouth.r, size, crop);
  const chin = mapPointToCrop(item.features.chin, size, crop);
  const forehead = mapPointToCrop(item.features.forehead, size, crop);
  const ovalLeft = mapPointToCrop(item.features.oval.l, size, crop);
  const ovalRight = mapPointToCrop(item.features.oval.r, size, crop);

  const interocularDist = dist(eyeLeft, eyeRight);
  const interocularInner = dist(eyeInnerLeft, eyeInnerRight);
  const interocularBlend = 0.6 * interocularInner + 0.4 * interocularDist;
  const faceHeight = dist(forehead, chin);
  const ovalWidth = dist(ovalLeft, ovalRight);
  const srcScalePx =
    0.55 * interocularBlend + 0.3 * ovalWidth + 0.15 * faceHeight;
  const transform = computeRuntimeTransform(eyeLeft, eyeRight, chin, forehead);

  const runtime: RuntimeMetadataItem = {
    file: item.file,
    pose: {
      pitch: roundTo(item.pose.pitch, POSE_DECIMALS),
      yaw: roundTo(item.pose.yaw, POSE_DECIMALS),
      roll: roundTo(item.pose.roll, POSE_DECIMALS),
    },
    region: mapRegionToCrop(item.region, size, crop),
    srcScalePx: roundTo(srcScalePx, SCALE_DECIMALS),
    interocularDist: roundTo(interocularDist, SCALE_DECIMALS),
    interocularBlend: roundTo(interocularBlend, SCALE_DECIMALS),
    transform,
    features: {
      eyes: { l: eyeLeft, r: eyeRight },
      mouth: { l: mouthLeft, r: mouthRight },
      chin,
      forehead,
    },
  };

  if (item.name) {
    runtime.name = item.name;
  }

  return runtime;
};

/** Render a cropped WebP derivative for the selected crop box. */
const renderDerivative = (
  sourcePath: string,
  outputPath: string,
  crop: CropBox,
): void => {
  ensureDir(path.dirname(outputPath));
  execFileSync(
    "magick",
    [
      sourcePath,
      "-auto-orient",
      "-crop",
      `${crop.size}x${crop.size}+${crop.left}+${crop.top}`,
      "+repage",
      "-resize",
      `${OUTPUT_SIZE}x${OUTPUT_SIZE}!`,
      "-strip",
      "-quality",
      String(WEBP_QUALITY),
      "-define",
      "webp:method=6",
      outputPath,
    ],
    { stdio: "pipe" },
  );
};

const cleanOutputDir = (dirPath: string): void => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

const matchesSubsetPrefix = (fileName: string, prefixes: string[]): boolean => {
  if (prefixes.length === 0) {
    return true;
  }

  const stem = path.basename(fileName, path.extname(fileName));
  const normalizedStem = normalizeSubsetToken(stem);
  return prefixes.some((prefix) => normalizedStem.startsWith(prefix));
};

/** Filter metadata entries for subset and limit options. */
const selectSourceItems = (
  sourceItems: SourceMetadataItem[],
  options: BuildOptions,
): SourceMetadataItem[] => {
  let selected = sortSourceItems(sourceItems);

  if (options.subsetPrefixes.length > 0) {
    selected = selected.filter((item) =>
      matchesSubsetPrefix(item.file, options.subsetPrefixes),
    );
  }

  if (options.limit > 0) {
    selected = selected.slice(0, options.limit);
  }

  return selected;
};

/** Decide how output image directory should be prepared for the selected mode. */
const prepareOutputDirectory = (options: BuildOptions): void => {
  if (options.recropMode === "none") {
    return;
  }

  const isFullSelection =
    options.subsetPrefixes.length === 0 && options.limit === 0;
  if (options.recropMode === "all" && isFullSelection) {
    cleanOutputDir(OUTPUT_IMAGE_DIR);
    return;
  }

  ensureDir(OUTPUT_IMAGE_DIR);
};

const shouldRenderDerivative = (
  recropMode: RecropMode,
  outputExists: boolean,
): boolean => {
  if (recropMode === "all") {
    return true;
  }
  if (recropMode === "missing" && !outputExists) {
    return true;
  }
  return false;
};

/** Build runtime metadata and optionally recrop images based on recrop mode. */
const processSourceItems = (
  sourceItems: SourceMetadataItem[],
  options: BuildOptions,
): ProcessStats => {
  const runtimeItems: RuntimeMetadataItem[] = [];
  const missingOutputs: string[] = [];

  let renderedCount = 0;
  let reusedCount = 0;
  let renderedSourceBytes = 0;
  let renderedOutputBytes = 0;

  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = sourceItems[index];
    const sourceFieldPath = `metadata[${index}].source`;
    const outputFieldPath = `metadata[${index}].file`;

    let sourcePath: string;
    let outputPath: string;

    try {
      sourcePath = resolvePathWithin(INPUT_DIR, item.source, sourceFieldPath);
      outputPath = resolvePathWithin(
        OUTPUT_IMAGE_DIR,
        item.file,
        outputFieldPath,
      );
    } catch (error) {
      throw new Error(errorMessage(error));
    }

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source image missing: ${sourcePath}`);
    }

    const outputExists = fs.existsSync(outputPath);
    if (options.recropMode === "none" && !outputExists) {
      missingOutputs.push(item.file);
      continue;
    }

    const size = getImageSize(sourcePath);
    const crop = computeCrop(item, size);

    if (shouldRenderDerivative(options.recropMode, outputExists)) {
      renderDerivative(sourcePath, outputPath, crop);
      renderedCount += 1;
      renderedSourceBytes += fs.statSync(sourcePath).size;
      renderedOutputBytes += fs.statSync(outputPath).size;
    } else {
      reusedCount += 1;
    }

    if (!fs.existsSync(outputPath)) {
      missingOutputs.push(item.file);
      continue;
    }

    runtimeItems.push(buildRuntimeMetadata(item, size, crop));

    if (options.verbose && (index + 1) % PROGRESS_LOG_INTERVAL === 0) {
      console.log(`⏱️ Derivatives: ${index + 1}/${sourceItems.length}`);
    }
  }

  return {
    runtimeItems,
    renderedCount,
    reusedCount,
    missingOutputs,
    renderedSourceBytes,
    renderedOutputBytes,
  };
};

const writeRuntimeMetadata = (
  outputFile: string,
  runtimeItems: RuntimeMetadataItem[],
): void => {
  const sorted = [...runtimeItems].sort((a, b) =>
    compareStrings(a.file, b.file),
  );
  fs.writeFileSync(outputFile, JSON.stringify(sorted), { encoding: "utf8" });
};

const logSelection = (
  sourceItems: SourceMetadataItem[],
  options: BuildOptions,
): void => {
  if (!options.verbose) {
    return;
  }

  console.log(`🧪 Derivative input entries: ${sourceItems.length}`);
  console.log(`⚙️ Recrop mode: ${options.recropMode}`);

  if (options.subsetPrefixes.length > 0) {
    console.log(`🔎 Subset prefixes: ${options.subsetPrefixes.join(", ")}`);
  }
  if (options.limit > 0) {
    console.log(`🔢 Limit: ${options.limit}`);
  }

  if (sourceItems.length > 0) {
    const sample = sourceItems
      .slice(0, 8)
      .map((item) => item.file)
      .join(", ");
    console.log(
      `🧷 Sample derivatives: ${sample}${sourceItems.length > 8 ? ", ..." : ""}`,
    );
  }
};

/** Log a concise summary describing what was generated and/or reused. */
const logOutcome = (
  sourceCount: number,
  stats: ProcessStats,
  mode: RecropMode,
): void => {
  if (mode === "none") {
    console.log(
      `✅ Wrote runtime metadata for ${stats.runtimeItems.length}/${sourceCount} derivatives to ${RUNTIME_METADATA_FILE}`,
    );
    console.log(`♻️ Reused existing derivatives: ${stats.reusedCount}`);
    return;
  }

  if (mode === "missing") {
    console.log(
      `✅ Wrote runtime metadata for ${stats.runtimeItems.length} derivatives to ${RUNTIME_METADATA_FILE}`,
    );
    console.log(
      `✂️ Recropped missing derivatives: ${stats.renderedCount}; reused existing: ${stats.reusedCount}`,
    );
  } else {
    console.log(
      `✅ Recropped ${stats.renderedCount} derivatives and wrote ${RUNTIME_METADATA_FILE}`,
    );
  }

  if (stats.renderedCount > 0) {
    const ratio =
      stats.renderedSourceBytes > 0
        ? (stats.renderedOutputBytes / stats.renderedSourceBytes) * 100
        : 0;

    console.log(
      `📉 Recrop bytes: ${(stats.renderedOutputBytes / 1024 / 1024).toFixed(2)} MB ` +
        `from ${(stats.renderedSourceBytes / 1024 / 1024).toFixed(2)} MB (${ratio.toFixed(1)}%)`,
    );
  }
};

const reportMissingOutputs = (missingOutputs: string[]): void => {
  const sample = missingOutputs.slice(0, 10).join(", ");
  const suffix = missingOutputs.length > 10 ? ", ..." : "";

  console.error(
    `❌ ${missingOutputs.length} derivative image(s) are missing under ${OUTPUT_IMAGE_DIR}.`,
  );
  console.error(`❌ Missing files: ${sample}${suffix}`);
  console.error(
    "💡 Run `npm run build:derivatives:recrop:missing` (or `npm run build:derivatives -- --recrop=missing`).",
  );
};

const main = async (): Promise<void> => {
  let options: BuildOptions;
  try {
    options = getBuildOptions();
  } catch (error) {
    console.error(`❌ ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(SOURCE_METADATA_FILE)) {
    console.error(
      `❌ ${SOURCE_METADATA_FILE} not found. Run build:metadata first.`,
    );
    process.exitCode = 1;
    return;
  }

  let sourceItems: SourceMetadataItem[];
  try {
    const rawMetadata = fs.readFileSync(SOURCE_METADATA_FILE, "utf8");
    sourceItems = parseSourceMetadata(rawMetadata, SOURCE_METADATA_FILE);
  } catch (error) {
    console.error(`❌ ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  const selectedItems = selectSourceItems(sourceItems, options);
  if (selectedItems.length === 0) {
    console.error(
      "❌ No source metadata entries selected after subset/limit filtering.",
    );
    process.exitCode = 1;
    return;
  }

  logSelection(selectedItems, options);

  try {
    prepareOutputDirectory(options);
    const stats = processSourceItems(selectedItems, options);

    if (stats.missingOutputs.length > 0) {
      reportMissingOutputs(stats.missingOutputs);
      process.exitCode = 1;
      return;
    }

    writeRuntimeMetadata(RUNTIME_METADATA_FILE, stats.runtimeItems);
    logOutcome(selectedItems.length, stats, options.recropMode);
  } catch (error) {
    console.error(`❌ Failed to prepare derivatives: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`Fatal error preparing derivatives: ${errorMessage(error)}`);
  process.exitCode = 1;
});
