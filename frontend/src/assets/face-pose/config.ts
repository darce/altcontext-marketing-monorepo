export const SELECTORS = {
  container: "face-container",
  scrubSurface: "main.container",
  image: "face-image",
  loader: "face-loader",
  metadataPanel: "face-metadata",
  metadataTitle: "face-metadata-title",
} as const;

export const POSE_CONFIG = {
  bucketStep: 0.5,
  poseCellStep: 0.25,
  sameCellExploreChance: 0,
  sameCellMinSwitchIntervalMs: 120,
  candidatePoolSize: 1,
  selectionTemperature: 1,
  recentHistoryLimit: 18,
  recentPenaltyStep: 0,
  recentPenaltyWindow: 6,
  rollPenalty: 0.2,
  landmarkConfidencePenalty: 6,
  usagePenalty: 0,
  maxUsagePenalty: 0,
  usagePenaltyDistanceSq: 64,
  switchMargin: 12,
  minSwitchIntervalMs: 90,
  fastSwitchMargin: 24,
  velocityIntervalBoostFactor: 240,
  maxVelocitySwitchIntervalBoostMs: 200,
  notLoadedSourcePenalty: 0,
  defaultMaxAbsYaw: 75,
  defaultMaxAbsPitch: 50,
  maxAbsYaw: 120,
  maxAbsPitch: 90,
  minPoseSpan: 20,
  coverageCellStep: 5,
  coverageMinItemsPerCell: 2,
  poseBoundsPaddingRatio: 0,
} as const;

export const VISUAL_CONFIG = {
  edgeFadeMaxOpacity: 0.32,
} as const;

export const PRELOAD_CONFIG = {
  blockUntilComplete: true,
  maxConcurrent: 12,
  backgroundMaxConcurrent: 8,
  stagedBucketSteps: [3, 2, 1] as const,
  initialBlockingLowTiers: [3, 2, 1] as const,
} as const;

export const POINTER_NOISE_CONFIG = {
  minPoseDeltaToUpdate: 0.05,
  edgeCompressionThreshold: 0.15,
  edgeCompressionOutput: 0.08,
} as const;

export const METADATA_ERROR_HINT =
  "Metadata is missing precomputed face transforms. Run `npm --prefix frontend run build:derivatives`.";
