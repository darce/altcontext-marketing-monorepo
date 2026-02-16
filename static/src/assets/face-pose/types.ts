export type RuntimePhase = "idle" | "loading" | "ready" | "error";

export interface Pose {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface RuntimeTransform {
  translateXRatio: number;
  translateYRatio: number;
  rotateRad: number;
  scale: number;
}

export type AtlasVariant = "low" | "mid" | "high";

export interface AtlasFiles {
  low: string;
  mid: string;
  high: string;
}

export interface AtlasPlacement {
  files: AtlasFiles;
  column: number;
  row: number;
  gridSize: number;
}

export interface MetadataItem {
  file: string;
  pose: Pose;
  interocularDist: number;
  landmarkConfidence: number;
  name?: string;
  transform: RuntimeTransform;
  atlas?: AtlasPlacement;
  preloadTier?: 0 | 1 | 2 | 3;
}

export interface PoseCommand {
  yaw: number;
  pitch: number;
}

export interface PoseBounds {
  minYaw: number;
  maxYaw: number;
  minPitch: number;
  maxPitch: number;
}

export interface PreloadSummary {
  total: number;
  loaded: number;
  failed: number;
}

export interface PreloadPlan {
  blockingSources: string[];
  backgroundStages: string[][];
}

export interface ResolvedImageSource {
  source: string;
  variant: AtlasVariant | "single";
}

export interface RuntimeState {
  phase: RuntimePhase;
  token: number;
  lastTransform: string;
  hasTransform: boolean;
  currentItem: MetadataItem | null;
  lastSwitchAt: number;
  rafId: number;
  pendingCommand: PoseCommand | null;
  poseCellKey: string;
  selectionUsage: Map<string, number>;
  recentFiles: string[];
  loadedSources: Set<string>;
  pendingSourceLoads: Map<string, number>;
  lastPointerPose: PoseCommand | null;
  lastPointerAtMs: number;
  pointerVelocityDegPerMs: number;
  lastHintAtMs: number;
  lastInteractionAtMs: number;
  lastInteractionType: "pointer" | "gyro" | null;
  isGyroActive: boolean;
}

export interface DomFacade {
  hasRequiredNodes: boolean;
  container: HTMLElement | null;
  image: HTMLImageElement | null;
  setLoaderText: (text: string) => void;
  hideLoader: () => void;
  showImage: () => void;
  setImageSource: (src: string) => void;
  setImageTransform: (transform: string) => void;
  setImageRendering: (mode: "pixelated" | "auto") => void;
  getContainerRect: () => DOMRect | null;
  renderMetadata: (item: MetadataItem) => void;
  getPermissionOverlay: () => HTMLElement | null;
}

export interface PoseIndex {
  pickClosest: (
    yaw: number,
    pitch: number,
    state: RuntimeState,
  ) => MetadataItem;
}
