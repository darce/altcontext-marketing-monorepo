export type PreloadTier = 0 | 1 | 2 | 3;
export type RecropMode = "none" | "missing" | "all";
export type JsonRecord = Record<string, unknown>;

export interface Point {
  x: number;
  y: number;
}

export interface FaceRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FacePose {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface PoseBounds {
  minYaw: number;
  maxYaw: number;
  minPitch: number;
  maxPitch: number;
}

export interface SourceFeatures {
  eyes: { l: Point; r: Point; innerL: Point; innerR: Point };
  mouth: { l: Point; r: Point };
  chin: Point;
  oval: { l: Point; r: Point };
  forehead: Point;
}

export interface SourceMetadataItem {
  source: string;
  file: string;
  region: FaceRegion;
  pose: FacePose;
  features: SourceFeatures;
  landmarkConfidence: number;
  name?: string;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface CropBox {
  left: number;
  top: number;
  size: number;
}

export interface RuntimeTransform {
  translateXRatio: number;
  translateYRatio: number;
  rotateRad: number;
  scale: number;
}

export interface RuntimeAtlasFileMap {
  low: string;
  mid: string;
  high: string;
}

export interface RuntimeAtlasPlacement {
  files: RuntimeAtlasFileMap;
  column: number;
  row: number;
  gridSize: number;
}

export interface RuntimeMetadataItem {
  file: string;
  pose: { pitch: number; yaw: number; roll: number };
  region: FaceRegion;
  srcScalePx: number;
  interocularDist: number;
  interocularBlend: number;
  landmarkConfidence: number;
  alignmentScore: number;
  transform: RuntimeTransform;
  atlas?: RuntimeAtlasPlacement;
  preloadTier?: PreloadTier;
  features: {
    eyes: { l: Point; r: Point };
    mouth: { l: Point; r: Point };
    chin: Point;
    forehead: Point;
  };
  name?: string;
}

export interface AtlasBuildStats {
  atlasCount: number;
  tileCount: number;
  sourceBytes: number;
  atlasBytes: number;
}

export interface AtlasBuildResult {
  placementsByFile: Map<string, RuntimeAtlasPlacement>;
  stats: AtlasBuildStats;
}

export interface BrowserRenderer {
  renderAlignedTile: (
    inputPath: string,
    outputPath: string,
    transformCss: string,
  ) => Promise<void>;
  close: () => Promise<void>;
}

export interface BuildOptions {
  verbose: boolean;
  subsetPrefixes: string[];
  limit: number;
  recropMode: RecropMode;
}

export interface ProcessStats {
  runtimeItems: RuntimeMetadataItem[];
  renderedCount: number;
  reusedCount: number;
  missingSources: string[];
  skippedQuality: QualityRejection[];
  missingOutputs: string[];
  renderedSourceBytes: number;
  renderedOutputBytes: number;
}

export interface QualityRejection {
  source: string;
  file: string;
  reason: string;
}
