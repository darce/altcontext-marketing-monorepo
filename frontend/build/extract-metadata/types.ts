export type MissingReason =
  | "no_xmp_header"
  | "no_xmp_start"
  | "no_xmp_end"
  | "missing_required_fields";

export interface MissingMetadataEntry {
  file: string;
  reason: MissingReason;
  missingFields?: string[];
}

export interface Point {
  x: number;
  y: number;
}

export interface SourceMetadata {
  source: string;
  file: string;
  region: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  pose: {
    pitch: number;
    yaw: number;
    roll: number;
  };
  center: Point;
  faceWidth: number;
  features: {
    nose: Point;
    eyes: {
      l: Point;
      r: Point;
      innerL: Point;
      innerR: Point;
    };
    mouth: { l: Point; r: Point };
    chin: Point;
    oval: { l: Point; r: Point };
    forehead: Point;
  };
  noseEyeDist: number;
  faceScale: number;
  faceHeight: number;
  srcScalePx: number;
  landmarkConfidence: number;
  interocularDist: number;
  interocularInner: number;
  interocularBlend: number;
  eyeMouthDist: number;
  ovalWidth: number;
  name?: string;
}

export interface ParsedXmpResult {
  data: Omit<SourceMetadata, "source" | "file"> | null;
  missingFields: string[];
}

export interface ExtractionState {
  metadataList: SourceMetadata[];
  missingMetadata: MissingMetadataEntry[];
  byReason: Record<MissingReason, number>;
  duplicateOutputNames: Map<string, string>;
}
