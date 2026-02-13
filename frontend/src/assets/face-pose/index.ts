import {
  GYRO_CONFIG,
  POINTER_NOISE_CONFIG,
  POSE_CONFIG,
  PRELOAD_CONFIG,
} from "./config";
import { createDomFacade } from "./dom";
import { loadMetadata, loadPoseBounds } from "./metadata";
import { createPoseIndex } from "./pose-index";
import { createPreloadPlan, preloadImages, toVariantSource } from "./preload";
import type {
  AtlasVariant,
  MetadataItem,
  PoseBounds,
  PoseCommand,
  RuntimeState,
} from "./types";
import { createFaceUpdater, createPoseCommandQueue } from "./updater";

const CACHE_HINT_INTERVAL_MS = 450;
const CACHE_HINT_MAX_SOURCES = 10;
const CACHE_HINT_MIN_VELOCITY = 0.01;

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const mapUnitToRange = (unit: number, min: number, max: number): number =>
  min + clamp(unit, 0, 1) * (max - min);

const compressEdgeUnit = (unit: number): number => {
  const threshold = POINTER_NOISE_CONFIG.edgeCompressionThreshold;
  const outputEdge = POINTER_NOISE_CONFIG.edgeCompressionOutput;
  const safe = clamp(unit, 0, 1);
  if (safe <= threshold) {
    return (safe / threshold) * outputEdge;
  }
  if (safe >= 1 - threshold) {
    return 1 - ((1 - safe) / threshold) * outputEdge;
  }

  const middleInput = (safe - threshold) / (1 - threshold * 2);
  return outputEdge + middleInput * (1 - outputEdge * 2);
};

/**
 * Derive interactive pose bounds from dataset coverage.
 * Falls back to defaults when metadata range is too narrow.
 */
const derivePoseBounds = (metadata: MetadataItem[]): PoseBounds => {
  const defaultBounds: PoseBounds = {
    minYaw: -POSE_CONFIG.defaultMaxAbsYaw,
    maxYaw: POSE_CONFIG.defaultMaxAbsYaw,
    minPitch: -POSE_CONFIG.defaultMaxAbsPitch,
    maxPitch: POSE_CONFIG.defaultMaxAbsPitch,
  };

  if (metadata.length === 0) {
    return defaultBounds;
  }

  let minYaw = Infinity;
  let maxYaw = -Infinity;
  let minPitch = Infinity;
  let maxPitch = -Infinity;
  const coverageByCell = new Map<
    string,
    { yawCell: number; pitchCell: number; count: number }
  >();

  for (const item of metadata) {
    minYaw = Math.min(minYaw, item.pose.yaw);
    maxYaw = Math.max(maxYaw, item.pose.yaw);
    minPitch = Math.min(minPitch, item.pose.pitch);
    maxPitch = Math.max(maxPitch, item.pose.pitch);

    const yawCell = Math.round(item.pose.yaw / POSE_CONFIG.coverageCellStep);
    const pitchCell = Math.round(
      item.pose.pitch / POSE_CONFIG.coverageCellStep,
    );
    const cellKey = `${yawCell}:${pitchCell}`;
    const existing = coverageByCell.get(cellKey);
    if (existing) {
      existing.count += 1;
    } else {
      coverageByCell.set(cellKey, { yawCell, pitchCell, count: 1 });
    }
  }

  if (
    !Number.isFinite(minYaw) ||
    !Number.isFinite(maxYaw) ||
    !Number.isFinite(minPitch) ||
    !Number.isFinite(maxPitch)
  ) {
    return defaultBounds;
  }

  minYaw = clamp(minYaw, -POSE_CONFIG.maxAbsYaw, POSE_CONFIG.maxAbsYaw);
  maxYaw = clamp(maxYaw, -POSE_CONFIG.maxAbsYaw, POSE_CONFIG.maxAbsYaw);
  minPitch = clamp(minPitch, -POSE_CONFIG.maxAbsPitch, POSE_CONFIG.maxAbsPitch);
  maxPitch = clamp(maxPitch, -POSE_CONFIG.maxAbsPitch, POSE_CONFIG.maxAbsPitch);

  const denseCells = Array.from(coverageByCell.values()).filter(
    (cell) => cell.count >= POSE_CONFIG.coverageMinItemsPerCell,
  );
  if (denseCells.length > 0) {
    let denseMinYaw = Infinity;
    let denseMaxYaw = -Infinity;
    let denseMinPitch = Infinity;
    let denseMaxPitch = -Infinity;

    for (const cell of denseCells) {
      const denseYaw = cell.yawCell * POSE_CONFIG.coverageCellStep;
      const densePitch = cell.pitchCell * POSE_CONFIG.coverageCellStep;
      denseMinYaw = Math.min(denseMinYaw, denseYaw);
      denseMaxYaw = Math.max(denseMaxYaw, denseYaw);
      denseMinPitch = Math.min(denseMinPitch, densePitch);
      denseMaxPitch = Math.max(denseMaxPitch, densePitch);
    }

    if (
      Number.isFinite(denseMinYaw) &&
      Number.isFinite(denseMaxYaw) &&
      Number.isFinite(denseMinPitch) &&
      Number.isFinite(denseMaxPitch)
    ) {
      minYaw = clamp(
        denseMinYaw,
        -POSE_CONFIG.maxAbsYaw,
        POSE_CONFIG.maxAbsYaw,
      );
      maxYaw = clamp(
        denseMaxYaw,
        -POSE_CONFIG.maxAbsYaw,
        POSE_CONFIG.maxAbsYaw,
      );
      minPitch = clamp(
        denseMinPitch,
        -POSE_CONFIG.maxAbsPitch,
        POSE_CONFIG.maxAbsPitch,
      );
      maxPitch = clamp(
        denseMaxPitch,
        -POSE_CONFIG.maxAbsPitch,
        POSE_CONFIG.maxAbsPitch,
      );
    }
  }

  if (maxYaw - minYaw < POSE_CONFIG.minPoseSpan) {
    minYaw = defaultBounds.minYaw;
    maxYaw = defaultBounds.maxYaw;
  }
  if (maxPitch - minPitch < POSE_CONFIG.minPoseSpan) {
    minPitch = defaultBounds.minPitch;
    maxPitch = defaultBounds.maxPitch;
  }

  const yawPad = (maxYaw - minYaw) * POSE_CONFIG.poseBoundsPaddingRatio;
  const pitchPad = (maxPitch - minPitch) * POSE_CONFIG.poseBoundsPaddingRatio;

  return {
    minYaw: clamp(
      minYaw - yawPad,
      -POSE_CONFIG.maxAbsYaw,
      POSE_CONFIG.maxAbsYaw,
    ),
    maxYaw: clamp(
      maxYaw + yawPad,
      -POSE_CONFIG.maxAbsYaw,
      POSE_CONFIG.maxAbsYaw,
    ),
    minPitch: clamp(
      minPitch - pitchPad,
      -POSE_CONFIG.maxAbsPitch,
      POSE_CONFIG.maxAbsPitch,
    ),
    maxPitch: clamp(
      maxPitch + pitchPad,
      -POSE_CONFIG.maxAbsPitch,
      POSE_CONFIG.maxAbsPitch,
    ),
  };
};

const createRuntimeState = (): RuntimeState => ({
  phase: "idle",
  token: 0,
  lastTransform: "",
  hasTransform: false,
  currentItem: null,
  lastSwitchAt: 0,
  rafId: 0,
  pendingCommand: null,
  poseCellKey: "",
  selectionUsage: new Map<string, number>(),
  recentFiles: [],
  loadedSources: new Set<string>(),
  pendingSourceLoads: new Map<string, number>(),
  lastPointerPose: null,
  lastPointerAtMs: 0,
  pointerVelocityDegPerMs: 0,
  lastHintAtMs: 0,
  lastInteractionAtMs: 0,
  lastInteractionType: null,
  isGyroActive: false,
});

const toPoseFromPointer = (
  event: MouseEvent,
  rect: DOMRect,
  poseBounds: PoseBounds,
): PoseCommand => {
  const safeWidth = rect.width || 1;
  const safeHeight = rect.height || 1;
  const x = clamp((event.clientX - rect.left) / safeWidth, 0, 1);
  const y = clamp((event.clientY - rect.top) / safeHeight, 0, 1);

  const easedX = compressEdgeUnit(x);
  const easedY = compressEdgeUnit(y);
  return {
    yaw: mapUnitToRange(easedX, poseBounds.minYaw, poseBounds.maxYaw),
    pitch: mapUnitToRange(easedY, poseBounds.minPitch, poseBounds.maxPitch),
  };
};

const pickInitialPose = (
  metadata: MetadataItem[],
  poseBounds: PoseBounds,
): PoseCommand => {
  if (metadata.length === 0) {
    return {
      yaw: (poseBounds.minYaw + poseBounds.maxYaw) * 0.5,
      pitch: (poseBounds.minPitch + poseBounds.maxPitch) * 0.5,
    };
  }

  const randomIndex = Math.floor(Math.random() * metadata.length);
  const item = metadata[randomIndex];
  return {
    yaw: clamp(item.pose.yaw, poseBounds.minYaw, poseBounds.maxYaw),
    pitch: clamp(item.pose.pitch, poseBounds.minPitch, poseBounds.maxPitch),
  };
};

const collectQuadrantHintSources = (
  metadata: MetadataItem[],
  pose: PoseCommand,
  loadedSources: Set<string>,
): string[] => {
  const yawSign = pose.yaw >= 0 ? 1 : -1;
  const pitchSign = pose.pitch >= 0 ? 1 : -1;
  const candidates = metadata
    .filter((item) => {
      const sameYawQuadrant =
        yawSign > 0 ? item.pose.yaw >= 0 : item.pose.yaw <= 0;
      const samePitchQuadrant =
        pitchSign > 0 ? item.pose.pitch >= 0 : item.pose.pitch <= 0;
      return sameYawQuadrant && samePitchQuadrant;
    })
    .sort((left, right) => {
      const leftDistance =
        (left.pose.yaw - pose.yaw) ** 2 + (left.pose.pitch - pose.pitch) ** 2;
      const rightDistance =
        (right.pose.yaw - pose.yaw) ** 2 + (right.pose.pitch - pose.pitch) ** 2;
      return leftDistance - rightDistance;
    });

  const hinted = new Set<string>();
  for (const item of candidates) {
    const prioritizedVariants: AtlasVariant[] = item.atlas
      ? ["high", "mid"]
      : ["high"];
    for (const variant of prioritizedVariants) {
      const source = toVariantSource(item, variant);
      if (loadedSources.has(source)) {
        continue;
      }
      hinted.add(source);
      if (hinted.size >= CACHE_HINT_MAX_SOURCES) {
        return Array.from(hinted);
      }
    }
  }

  return Array.from(hinted);
};

const scheduleCacheWarmHint = (
  metadata: MetadataItem[],
  state: RuntimeState,
  pose: PoseCommand,
  now: number,
): void => {
  if (state.pointerVelocityDegPerMs < CACHE_HINT_MIN_VELOCITY) {
    return;
  }
  if (now - state.lastHintAtMs < CACHE_HINT_INTERVAL_MS) {
    return;
  }

  const hintSources = collectQuadrantHintSources(
    metadata,
    pose,
    state.loadedSources,
  );
  if (hintSources.length === 0) {
    return;
  }
  state.lastHintAtMs = now;
  void preloadImages(
    hintSources,
    PRELOAD_CONFIG.backgroundMaxConcurrent,
    () => undefined,
    (source) => {
      state.loadedSources.add(source);
    },
  );
};

const initializeFacePose = async (): Promise<void> => {
  const dom = createDomFacade();
  if (!dom.hasRequiredNodes) {
    return;
  }

  const state = createRuntimeState();
  state.phase = "loading";

  let metadata: MetadataItem[] = [];
  try {
    metadata = await loadMetadata();
  } catch (error) {
    console.error("Failed to load metadata:", error);
    dom.setLoaderText("Error loading metadata.");
    state.phase = "error";
    return;
  }

  const preloadPlan = createPreloadPlan(metadata);

  let lastProgressValue = -1;
  const preloadResult = await preloadImages(
    preloadPlan.blockingSources,
    PRELOAD_CONFIG.maxConcurrent,
    (summary) => {
      const progressValue = summary.loaded + summary.failed;
      if (progressValue === lastProgressValue) {
        return;
      }
      lastProgressValue = progressValue;
      dom.setLoaderText(
        `Preloading images... ${progressValue}/${summary.total}`,
      );
    },
    (source) => {
      state.loadedSources.add(source);
    },
  );

  if (preloadResult.failed > 0) {
    console.warn(
      `Image preload completed with ${preloadResult.failed} failed requests.`,
    );
  }

  const poseIndex = createPoseIndex(metadata);
  const derivedPoseBounds = derivePoseBounds(metadata);
  let poseBounds = derivedPoseBounds;
  try {
    const precomputedPoseBounds = await loadPoseBounds();
    if (precomputedPoseBounds) {
      poseBounds = precomputedPoseBounds;
    }
  } catch {
    poseBounds = derivedPoseBounds;
  }
  dom.hideLoader();
  dom.showImage();
  state.phase = "ready";

  const { updateFace } = createFaceUpdater(dom, state, poseIndex);
  const commandQueue = createPoseCommandQueue(state, updateFace);

  const container = dom.container;
  if (container) {
    container.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "mouse") {
        container.setPointerCapture(event.pointerId);
      }
    });

    container.addEventListener("pointermove", (event: PointerEvent) => {
      const rect = dom.getContainerRect();
      if (!rect) {
        return;
      }
      const pose = toPoseFromPointer(event, rect, poseBounds);
      const now = nowMs();
      if (state.lastPointerPose && state.lastPointerAtMs > 0) {
        const yawDelta = pose.yaw - state.lastPointerPose.yaw;
        const pitchDelta = pose.pitch - state.lastPointerPose.pitch;
        const distance = Math.sqrt(
          yawDelta * yawDelta + pitchDelta * pitchDelta,
        );
        const elapsedMs = Math.max(1, now - state.lastPointerAtMs);
        state.pointerVelocityDegPerMs = distance / elapsedMs;
      } else {
        state.pointerVelocityDegPerMs = 0;
      }

      if (state.lastPointerPose) {
        const yawDelta = Math.abs(pose.yaw - state.lastPointerPose.yaw);
        const pitchDelta = Math.abs(pose.pitch - state.lastPointerPose.pitch);
        if (
          yawDelta < POINTER_NOISE_CONFIG.minPoseDeltaToUpdate &&
          pitchDelta < POINTER_NOISE_CONFIG.minPoseDeltaToUpdate
        ) {
          return;
        }
      }
      state.lastPointerPose = pose;
      state.lastPointerAtMs = now;

      // Coordination: Prioritize direct pointer interaction.
      // Mark activity and disable gyro if it was active recently.
      state.lastInteractionAtMs = now;
      state.lastInteractionType = "pointer";

      commandQueue.enqueue(pose.yaw, pose.pitch);
      scheduleCacheWarmHint(metadata, state, pose, now);
    });
  }

  const initialPose = pickInitialPose(metadata, poseBounds);
  commandQueue.enqueue(initialPose.yaw, initialPose.pitch);

  // --- Gyroscope / Device Orientation ---
  // iOS 13+ requires permission. Others might work automatically or not at all.
  const permissionOverlay = dom.getPermissionOverlay();
  const hasOrientationSupport =
    typeof window !== "undefined" && "DeviceOrientationEvent" in window;

  if (hasOrientationSupport && permissionOverlay) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const DeviceOrientation = window.DeviceOrientationEvent as any;
    const requiresPermission =
      typeof DeviceOrientation.requestPermission === "function";

    let lastGyroPose: PoseCommand | null = null;
    let gyroEventCount = 0;
    let gyroDetectionTimeout: number | undefined;

    const onOrientation = (event: DeviceOrientationEvent) => {
      const now = nowMs();

      // Coordination: If user is interacting via pointer recently, ignore gyro
      if (
        state.lastInteractionType === "pointer" &&
        now - state.lastInteractionAtMs <
          GYRO_CONFIG.interactionCoordinationThresholdMs
      ) {
        return;
      }

      const gamma = event.gamma ?? 0; // Left/Right tilt (-90 to 90)
      const beta = event.beta ?? 0; // Front/Back tilt (-180 to 180)

      // 1. Normalization & Mapping
      // Normalize gamma (-GYRO_CONFIG.gammaMaxAbs ... GYRO_CONFIG.gammaMaxAbs) to 0...1
      const normalizedGamma =
        (clamp(gamma, -GYRO_CONFIG.gammaMaxAbs, GYRO_CONFIG.gammaMaxAbs) +
          GYRO_CONFIG.gammaMaxAbs) /
        (2 * GYRO_CONFIG.gammaMaxAbs);
      const yaw = mapUnitToRange(
        normalizedGamma,
        poseBounds.minYaw,
        poseBounds.maxYaw,
      );

      // Normalize beta around the offset
      const pitch = clamp(
        beta - GYRO_CONFIG.betaOffset,
        poseBounds.minPitch,
        poseBounds.maxPitch,
      );

      // 2. Noise & Delta Filtering
      if (lastGyroPose) {
        const yawDelta = Math.abs(yaw - lastGyroPose.yaw);
        const pitchDelta = Math.abs(pitch - lastGyroPose.pitch);
        if (
          yawDelta < GYRO_CONFIG.minPoseDeltaToUpdate &&
          pitchDelta < GYRO_CONFIG.minPoseDeltaToUpdate
        ) {
          return;
        }
      }

      // Feature detection: First few events confirm gyro is actually moving/present
      gyroEventCount++;
      if (gyroEventCount > 1) {
        state.isGyroActive = true;
        state.lastInteractionType = "gyro";
        state.lastInteractionAtMs = now;
        if (gyroDetectionTimeout !== undefined) {
          clearTimeout(gyroDetectionTimeout);
          gyroDetectionTimeout = undefined;
        }
        permissionOverlay.style.display = "none";
      }

      lastGyroPose = { yaw, pitch };
      commandQueue.enqueue(yaw, pitch);
    };

    const enableMotion = async () => {
      try {
        if (requiresPermission) {
          const response = await DeviceOrientation.requestPermission();
          if (response !== "granted") {
            return;
          }
        }

        window.addEventListener("deviceorientation", onOrientation);

        // Timeout to hide overlay if no events actually arrive (e.g. desktop)
        gyroDetectionTimeout = window.setTimeout(() => {
          if (gyroEventCount < 2) {
            permissionOverlay.style.display = "none";
          }
        }, GYRO_CONFIG.noEventTimeoutMs);
      } catch (e) {
        console.warn("DeviceOrientation permission failed", e);
        permissionOverlay.style.display = "none";
      }
    };

    if (requiresPermission) {
      // Show overlay to request permission on tap
      permissionOverlay.style.display = "flex";
      permissionOverlay.addEventListener(
        "click",
        (e) => {
          // Stop propagation so container pointerdown doesn't capture immediately
          e.stopPropagation();
          void enableMotion();
        },
        { once: true },
      );
    } else {
      // Just try to enable automatically
      void enableMotion();
    }
  }

  if (preloadPlan.backgroundStages.length > 0) {
    const runBackgroundPreload = async (): Promise<void> => {
      for (
        let stageIndex = 0;
        stageIndex < preloadPlan.backgroundStages.length;
        stageIndex += 1
      ) {
        const stageSources = preloadPlan.backgroundStages[stageIndex];
        if (stageSources.length === 0) {
          continue;
        }

        const summary = await preloadImages(
          stageSources,
          PRELOAD_CONFIG.backgroundMaxConcurrent,
          () => undefined,
          (source) => {
            state.loadedSources.add(source);
          },
        );
        if (summary.failed > 0) {
          console.warn(
            `Background preload stage ${stageIndex + 1} completed with ${summary.failed} failed requests.`,
          );
        }

        if (state.currentItem) {
          updateFace(state.currentItem.pose.yaw, state.currentItem.pose.pitch);
        }
      }
    };

    void runBackgroundPreload();
  }
};

void initializeFacePose();
