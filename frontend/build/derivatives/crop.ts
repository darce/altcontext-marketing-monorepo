import { execFileSync } from "node:child_process";

import type {
  CropBox,
  FaceRegion,
  ImageSize,
  Point,
  RuntimeMetadataItem,
  RuntimeTransform,
  SourceMetadataItem,
} from "./types";

export const CROP_BUFFER = 0.4;
export const OUTPUT_SIZE = 640;
export const COORDINATE_DECIMALS = 4;
export const POSE_DECIMALS = 2;
export const SCALE_DECIMALS = 6;
export const CONFIDENCE_DECIMALS = 3;
export const ALIGNMENT_MARGIN_RATIO = 0.09;
export const ALIGNMENT_TARGET_EYE_X_RATIO = 0.5;
export const ALIGNMENT_TARGET_EYE_Y_RATIO = 0.44;
export const ALIGNMENT_HEAD_SCALE_FACTOR = 0.9;

export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

export const roundTo = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const dist = (a: Point, b: Point): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
};

export const getImageSize = (imagePath: string): ImageSize => {
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

export const pointToPixels = (point: Point, size: ImageSize): Point => {
  return {
    x: point.x * size.width,
    y: point.y * size.height,
  };
};

/** Compute a square crop around the face with deterministic padding. */
export const computeCrop = (item: SourceMetadataItem, size: ImageSize): CropBox => {
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

export const mapPointToCrop = (
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

export const mapRegionToCrop = (
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

/** Compute a normalized transform used to pre-bake face alignment at build time. */
export const computeRuntimeTransform = (
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

export const applyRuntimeTransform = (
  point: Point,
  transform: RuntimeTransform,
): Point => {
  const cos = Math.cos(transform.rotateRad);
  const sin = Math.sin(transform.rotateRad);
  const rotatedX = point.x * cos - point.y * sin;
  const rotatedY = point.x * sin + point.y * cos;

  return {
    x: rotatedX * transform.scale + transform.translateXRatio,
    y: rotatedY * transform.scale + transform.translateYRatio,
  };
};

export const computeAlignedEyeMidpoint = (
  eyeLeft: Point,
  eyeRight: Point,
  transform: RuntimeTransform,
): Point => {
  const alignedLeft = applyRuntimeTransform(eyeLeft, transform);
  const alignedRight = applyRuntimeTransform(eyeRight, transform);
  return {
    x: (alignedLeft.x + alignedRight.x) * 0.5,
    y: (alignedLeft.y + alignedRight.y) * 0.5,
  };
};

export const computeAlignmentDeviationPx = (
  midpoint: Point,
  widthPx: number,
  heightPx: number,
): number => {
  const dxPx = (midpoint.x - ALIGNMENT_TARGET_EYE_X_RATIO) * widthPx;
  const dyPx = (midpoint.y - ALIGNMENT_TARGET_EYE_Y_RATIO) * heightPx;
  return Math.sqrt(dxPx * dxPx + dyPx * dyPx);
};

export const toAlignmentScore = (deviationPx: number): number => {
  const raw = 1 - deviationPx / 8;
  return roundTo(clamp(raw, 0, 1), 4);
};

const distanceToBlockBoundary = (valuePx: number, blockSize: number): number => {
  const mod = ((valuePx % blockSize) + blockSize) % blockSize;
  return Math.min(mod, blockSize - mod);
};

export const isEyeRegionBlockBoundaryCritical = (
  eyeLeft: Point,
  eyeRight: Point,
  transform: RuntimeTransform,
  widthPx: number,
  heightPx: number,
  blockSize: number = 8,
  thresholdPx: number = 1.25,
): boolean => {
  const alignedLeft = applyRuntimeTransform(eyeLeft, transform);
  const alignedRight = applyRuntimeTransform(eyeRight, transform);
  const samplePoints = [
    { x: alignedLeft.x * widthPx, y: alignedLeft.y * heightPx },
    { x: alignedRight.x * widthPx, y: alignedRight.y * heightPx },
  ];

  return samplePoints.some((point) => {
    const xDistance = distanceToBlockBoundary(point.x, blockSize);
    const yDistance = distanceToBlockBoundary(point.y, blockSize);
    return xDistance <= thresholdPx || yDistance <= thresholdPx;
  });
};

export const buildRuntimeMetadata = (
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
  const alignedMidpoint = computeAlignedEyeMidpoint(eyeLeft, eyeRight, transform);
  const alignmentDeviationPx = computeAlignmentDeviationPx(
    alignedMidpoint,
    OUTPUT_SIZE,
    OUTPUT_SIZE,
  );

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
    landmarkConfidence: roundTo(
      clamp(item.landmarkConfidence, 0, 1),
      CONFIDENCE_DECIMALS,
    ),
    alignmentScore: toAlignmentScore(alignmentDeviationPx),
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
