(() => {
  type RuntimePhase = "idle" | "loading" | "ready" | "error";

  interface Pose {
    pitch: number;
    yaw: number;
    roll: number;
  }

  interface RuntimeTransform {
    translateXRatio: number;
    translateYRatio: number;
    rotateRad: number;
    scale: number;
  }

  interface MetadataItem {
    file: string;
    pose: Pose;
    interocularDist: number;
    name?: string;
    transform: RuntimeTransform;
  }

  interface PoseCommand {
    yaw: number;
    pitch: number;
  }

  interface PoseBounds {
    minYaw: number;
    maxYaw: number;
    minPitch: number;
    maxPitch: number;
  }

  interface RuntimeState {
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
  }

  interface DomFacade {
    hasRequiredNodes: boolean;
    container: HTMLElement | null;
    image: HTMLImageElement | null;
    setLoaderText: (text: string) => void;
    hideLoader: () => void;
    showImage: () => void;
    setImageSource: (src: string) => void;
    setImageTransform: (transform: string) => void;
    getContainerRect: () => DOMRect | null;
    renderMetadata: (item: MetadataItem) => void;
  }

  interface PoseIndex {
    pickClosest: (
      yaw: number,
      pitch: number,
      state: RuntimeState,
    ) => MetadataItem;
  }

  const SELECTORS = {
    container: "face-container",
    image: "face-image",
    loader: "face-loader",
    metadataPanel: "face-metadata",
    metadataTitle: "face-metadata-title",
  } as const;

  const POSE_CONFIG = {
    bucketStep: 2,
    poseCellStep: 1,
    sameCellExploreChance: 0.18,
    sameCellMinSwitchIntervalMs: 150,
    candidatePoolSize: 4,
    selectionTemperature: 2.8,
    recentHistoryLimit: 18,
    recentPenaltyStep: 1,
    recentPenaltyWindow: 6,
    rollPenalty: 0.2,
    usagePenalty: 0.35,
    maxUsagePenalty: 10,
    usagePenaltyDistanceSq: 64,
    switchMargin: 9,
    minSwitchIntervalMs: 100,
    fastSwitchMargin: 38,
    defaultMaxAbsYaw: 75,
    defaultMaxAbsPitch: 50,
    maxAbsYaw: 120,
    maxAbsPitch: 90,
    minPoseSpan: 20,
    poseBoundsPaddingRatio: 0.04,
  } as const;

  const METADATA_ERROR_HINT =
    "Metadata is missing precomputed face transforms. Run `npm --prefix frontend run build:derivatives`.";

  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value);

  const nowMs = (): number =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  const toBucketIndex = (value: number, step: number): number =>
    Math.round(value / step);

  const toPoseCellKey = (
    yaw: number,
    pitch: number,
    cellStep: number,
  ): string => `${Math.round(yaw / cellStep)}:${Math.round(pitch / cellStep)}`;

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

  const mapUnitToRange = (unit: number, min: number, max: number): number =>
    min + clamp(unit, 0, 1) * (max - min);

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

    for (const item of metadata) {
      minYaw = Math.min(minYaw, item.pose.yaw);
      maxYaw = Math.max(maxYaw, item.pose.yaw);
      minPitch = Math.min(minPitch, item.pose.pitch);
      maxPitch = Math.max(maxPitch, item.pose.pitch);
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
      minYaw: clamp(minYaw - yawPad, -POSE_CONFIG.maxAbsYaw, POSE_CONFIG.maxAbsYaw),
      maxYaw: clamp(maxYaw + yawPad, -POSE_CONFIG.maxAbsYaw, POSE_CONFIG.maxAbsYaw),
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
  });

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  };

  const parseMetadataItem = (value: unknown): MetadataItem | null => {
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

    return {
      file,
      pose: { yaw, pitch, roll: isFiniteNumber(roll) ? roll : 0 },
      interocularDist,
      name,
      transform: {
        translateXRatio,
        translateYRatio,
        rotateRad,
        scale,
      },
    };
  };

  /**
   * Load and validate runtime metadata.
   * Invalid entries are dropped so one corrupt record does not break the viewer.
   */
  const loadMetadata = async (): Promise<MetadataItem[]> => {
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

  const createDomFacade = (): DomFacade => {
    const container = document.getElementById(SELECTORS.container);
    const image = document.getElementById(SELECTORS.image);
    const loader = document.getElementById(SELECTORS.loader);
    const metadataPanel = document.getElementById(SELECTORS.metadataPanel);
    const metadataTitle = document.getElementById(SELECTORS.metadataTitle);

    const hasRequiredNodes =
      container instanceof HTMLElement &&
      image instanceof HTMLImageElement &&
      loader instanceof HTMLElement;

    const setLoaderText = (text: string): void => {
      if (!(loader instanceof HTMLElement)) {
        return;
      }
      loader.textContent = text;
    };

    const hideLoader = (): void => {
      if (!(loader instanceof HTMLElement)) {
        return;
      }
      loader.style.display = "none";
    };

    const showImage = (): void => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.style.display = "block";
    };

    const setImageSource = (src: string): void => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.src = src;
    };

    const setImageTransform = (transform: string): void => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.style.transform = transform;
    };

    const getContainerRect = (): DOMRect | null => {
      if (!(container instanceof HTMLElement)) {
        return null;
      }
      return container.getBoundingClientRect();
    };

    const renderMetadata = (item: MetadataItem): void => {
      if (!(metadataPanel instanceof HTMLElement)) {
        return;
      }

      if (metadataTitle instanceof HTMLElement) {
        metadataTitle.textContent = item.name ?? "Unknown";
      }

      metadataPanel.textContent =
        `interocularDist: ${item.interocularDist}\n` +
        `pitch: ${item.pose.pitch}\n` +
        `yaw: ${item.pose.yaw}\n` +
        `roll: ${item.pose.roll}`;
    };

    return {
      hasRequiredNodes,
      container: container instanceof HTMLElement ? container : null,
      image: image instanceof HTMLImageElement ? image : null,
      setLoaderText,
      hideLoader,
      showImage,
      setImageSource,
      setImageTransform,
      getContainerRect,
      renderMetadata,
    };
  };

  /**
   * Build a pose bucket index for fast nearest-image lookup with jitter damping.
   */
  const createPoseIndex = (metadata: MetadataItem[]): PoseIndex => {
    const buckets = new Map<string, MetadataItem[]>();

    for (const item of metadata) {
      const bucketYaw = toBucketIndex(item.pose.yaw, POSE_CONFIG.bucketStep);
      const bucketPitch = toBucketIndex(
        item.pose.pitch,
        POSE_CONFIG.bucketStep,
      );
      const key = `${bucketYaw}:${bucketPitch}`;
      if (!buckets.has(key)) {
        buckets.set(key, []);
      }
      buckets.get(key)?.push(item);
    }

    for (const [key, bucketItems] of buckets.entries()) {
      const [bucketYaw, bucketPitch] = key.split(":").map(Number);
      const centerYaw = bucketYaw * POSE_CONFIG.bucketStep;
      const centerPitch = bucketPitch * POSE_CONFIG.bucketStep;

      bucketItems.sort((left, right) => {
        const leftDist =
          (left.pose.yaw - centerYaw) ** 2 +
          (left.pose.pitch - centerPitch) ** 2;
        const rightDist =
          (right.pose.yaw - centerYaw) ** 2 +
          (right.pose.pitch - centerPitch) ** 2;

        if (leftDist !== rightDist) {
          return leftDist - rightDist;
        }
        return left.file.localeCompare(right.file);
      });
    }

    const getClosestFallback = (yaw: number, pitch: number): MetadataItem => {
      let closest = metadata[0];
      let minDistance = Infinity;

      for (const item of metadata) {
        const yawDistance = item.pose.yaw - yaw;
        const pitchDistance = item.pose.pitch - pitch;
        const distance =
          yawDistance * yawDistance + pitchDistance * pitchDistance;
        if (distance < minDistance) {
          minDistance = distance;
          closest = item;
        }
      }

      return closest;
    };

    const collectNearbyCandidates = (
      bucketYaw: number,
      bucketPitch: number,
      radius: number,
    ): MetadataItem[] => {
      const candidates: MetadataItem[] = [];

      for (let yawOffset = -radius; yawOffset <= radius; yawOffset += 1) {
        for (
          let pitchOffset = -radius;
          pitchOffset <= radius;
          pitchOffset += 1
        ) {
          const key = `${bucketYaw + yawOffset}:${bucketPitch + pitchOffset}`;
          const bucket = buckets.get(key);
          if (bucket && bucket.length > 0) {
            candidates.push(...bucket);
          }
        }
      }

      return candidates;
    };

    const estimateTargetRoll = (
      candidates: MetadataItem[],
      yaw: number,
      pitch: number,
    ): number | null => {
      if (candidates.length === 0) {
        return null;
      }

      let weightedRoll = 0;
      let weightTotal = 0;

      for (const candidate of candidates) {
        const yawDistance = candidate.pose.yaw - yaw;
        const pitchDistance = candidate.pose.pitch - pitch;
        const distanceSq =
          yawDistance * yawDistance + pitchDistance * pitchDistance;
        const weight = 1 / (1 + distanceSq);
        weightedRoll += candidate.pose.roll * weight;
        weightTotal += weight;
      }

      if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
        return null;
      }

      return weightedRoll / weightTotal;
    };

    const scoreCandidate = (
      candidate: MetadataItem,
      yaw: number,
      pitch: number,
      targetRoll: number | null,
      state: RuntimeState,
    ): number => {
      const yawDistance = candidate.pose.yaw - yaw;
      const pitchDistance = candidate.pose.pitch - pitch;
      const distance =
        yawDistance * yawDistance + pitchDistance * pitchDistance;
      const rollPenalty =
        targetRoll === null
          ? 0
          : (candidate.pose.roll - targetRoll) *
            (candidate.pose.roll - targetRoll) *
            POSE_CONFIG.rollPenalty;
      const usage = state.selectionUsage.get(candidate.file) ?? 0;
      const recentIndex = state.recentFiles.lastIndexOf(candidate.file);
      let recentPenalty = 0;
      if (recentIndex >= 0) {
        const fromLatest = state.recentFiles.length - 1 - recentIndex;
        const windowLeft = POSE_CONFIG.recentPenaltyWindow - fromLatest;
        recentPenalty =
          windowLeft > 0 ? windowLeft * POSE_CONFIG.recentPenaltyStep : 0;
      }
      if (distance > POSE_CONFIG.usagePenaltyDistanceSq) {
        return distance + rollPenalty + recentPenalty;
      }
      const usagePenalty = Math.min(
        usage * POSE_CONFIG.usagePenalty,
        POSE_CONFIG.maxUsagePenalty,
      );
      return distance + usagePenalty + rollPenalty + recentPenalty;
    };

    const pickFromTopCandidates = (
      scoredCandidates: { candidate: MetadataItem; score: number }[],
    ): MetadataItem => {
      if (scoredCandidates.length === 0) {
        return metadata[0];
      }

      const poolSize = Math.min(
        scoredCandidates.length,
        POSE_CONFIG.candidatePoolSize,
      );
      const pool = scoredCandidates.slice(0, poolSize);
      const minScore = pool[0].score;

      let totalWeight = 0;
      const weightedPool = pool.map((entry) => {
        const scoreOffset = entry.score - minScore;
        const weight = Math.exp(-scoreOffset / POSE_CONFIG.selectionTemperature);
        totalWeight += weight;
        return { candidate: entry.candidate, weight };
      });

      if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return pool[0].candidate;
      }

      let threshold = Math.random() * totalWeight;
      for (const entry of weightedPool) {
        threshold -= entry.weight;
        if (threshold <= 0) {
          return entry.candidate;
        }
      }

      return weightedPool[weightedPool.length - 1].candidate;
    };

    const rememberSelection = (state: RuntimeState, file: string): void => {
      const usageCount = state.selectionUsage.get(file) ?? 0;
      state.selectionUsage.set(file, usageCount + 1);

      if (state.recentFiles[state.recentFiles.length - 1] === file) {
        return;
      }

      state.recentFiles.push(file);
      if (state.recentFiles.length > POSE_CONFIG.recentHistoryLimit) {
        state.recentFiles.shift();
      }
    };

    const pickClosest = (
      yaw: number,
      pitch: number,
      state: RuntimeState,
    ): MetadataItem => {
      const bucketYaw = toBucketIndex(yaw, POSE_CONFIG.bucketStep);
      const bucketPitch = toBucketIndex(pitch, POSE_CONFIG.bucketStep);
      const bucketKey = `${bucketYaw}:${bucketPitch}`;

      let candidates = buckets.get(bucketKey) ?? [];
      if (candidates.length === 0) {
        candidates = collectNearbyCandidates(bucketYaw, bucketPitch, 1);
      }
      if (candidates.length === 0) {
        candidates = collectNearbyCandidates(bucketYaw, bucketPitch, 2);
      }
      if (candidates.length === 0) {
        return getClosestFallback(yaw, pitch);
      }
      const targetRoll = estimateTargetRoll(candidates, yaw, pitch);

      const poseCellKey = toPoseCellKey(yaw, pitch, POSE_CONFIG.poseCellStep);
      const inSameCell = state.poseCellKey === poseCellKey;
      const currentStillCandidate =
        state.currentItem &&
        candidates.some((candidate) => candidate.file === state.currentItem?.file);
      if (
        inSameCell &&
        state.currentItem &&
        currentStillCandidate &&
        (candidates.length === 1 ||
          nowMs() - state.lastSwitchAt <
            POSE_CONFIG.sameCellMinSwitchIntervalMs ||
          Math.random() >= POSE_CONFIG.sameCellExploreChance)
      ) {
        return state.currentItem;
      }
      state.poseCellKey = poseCellKey;

      const scoredCandidates = candidates
        .map((candidate) => ({
          candidate,
          score: scoreCandidate(candidate, yaw, pitch, targetRoll, state),
        }))
        .sort((left, right) => {
          if (left.score !== right.score) {
            return left.score - right.score;
          }
          return left.candidate.file.localeCompare(right.candidate.file);
        });

      let chosen = pickFromTopCandidates(scoredCandidates);
      const bestScore = scoredCandidates[0].score;

      if (state.currentItem && chosen.file !== state.currentItem.file) {
        const currentScore = scoreCandidate(
          state.currentItem,
          yaw,
          pitch,
          targetRoll,
          state,
        );
        const scoreGain = currentScore - bestScore;
        const elapsedMs = nowMs() - state.lastSwitchAt;
        const holdForMargin = scoreGain < POSE_CONFIG.switchMargin;
        const holdForRate =
          elapsedMs < POSE_CONFIG.minSwitchIntervalMs &&
          scoreGain < POSE_CONFIG.fastSwitchMargin;
        if (holdForMargin || holdForRate) {
          chosen = state.currentItem;
        }
      }

      if (!state.currentItem || chosen.file !== state.currentItem.file) {
        state.lastSwitchAt = nowMs();
      }

      rememberSelection(state, chosen.file);
      return chosen;
    };

    return { pickClosest };
  };

  const toTransformCss = (transform: RuntimeTransform): string =>
    `translate(${transform.translateXRatio * 100}%, ${transform.translateYRatio * 100}%) ` +
    `rotate(${transform.rotateRad}rad) scale(${transform.scale})`;

  const waitForImageReady = (
    image: HTMLImageElement,
    token: number,
    state: RuntimeState,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      if (token !== state.token) {
        reject(new Error("stale request"));
        return;
      }

      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve();
        return;
      }

      const onLoad = (): void => {
        cleanup();
        resolve();
      };

      const onError = (error: Event): void => {
        cleanup();
        reject(error);
      };

      const cleanup = (): void => {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
      };

      image.addEventListener("load", onLoad);
      image.addEventListener("error", onError);
    });

  /**
   * Update the visible frame for a selected metadata item.
   * Runtime work is limited to source swap + applying precomputed transform.
   */
  const createFaceUpdater = (
    dom: DomFacade,
    state: RuntimeState,
    poseIndex: PoseIndex,
  ): { updateFace: (yaw: number, pitch: number) => Promise<void> } => {
    const applyItemFrame = (item: MetadataItem): void => {
      const transformCss = toTransformCss(item.transform);
      dom.setImageTransform(transformCss);
      state.lastTransform = transformCss;
      state.hasTransform = true;
      dom.renderMetadata(item);
    };

    const updateFace = async (yaw: number, pitch: number): Promise<void> => {
      const item = poseIndex.pickClosest(yaw, pitch, state);
      const nextSource = new URL(
        `input-images/${item.file}`,
        document.baseURI,
      ).toString();

      if (
        dom.image &&
        dom.image.src === nextSource &&
        dom.image.naturalWidth > 0
      ) {
        applyItemFrame(item);
        return;
      }

      if (state.hasTransform) {
        dom.setImageTransform(state.lastTransform);
      }

      const token = state.token + 1;
      state.token = token;
      state.currentItem = item;
      dom.setImageSource(nextSource);

      if (!dom.image) {
        return;
      }

      try {
        await waitForImageReady(dom.image, token, state);
        if (typeof dom.image.decode === "function") {
          try {
            await dom.image.decode();
          } catch {
            // Decode failures should not block rendering after image load.
          }
        }

        if (token !== state.token) {
          return;
        }

        applyItemFrame(item);
      } catch {
        // Keep last good transform on load/decode failure.
      }
    };

    return { updateFace };
  };

  /**
   * Queue only the latest pose update per animation frame.
   */
  const createPoseCommandQueue = (
    state: RuntimeState,
    updateFace: (yaw: number, pitch: number) => Promise<void>,
  ): { enqueue: (yaw: number, pitch: number) => void } => {
    const flush = (): void => {
      state.rafId = 0;
      if (!state.pendingCommand) {
        return;
      }

      const command = state.pendingCommand;
      state.pendingCommand = null;
      void updateFace(command.yaw, command.pitch);
    };

    const enqueue = (yaw: number, pitch: number): void => {
      state.pendingCommand = { yaw, pitch };
      if (state.rafId) {
        return;
      }
      state.rafId = requestAnimationFrame(flush);
    };

    return { enqueue };
  };

  const toPoseFromPointer = (
    event: MouseEvent,
    rect: DOMRect,
    poseBounds: PoseBounds,
  ): PoseCommand => {
    const safeWidth = rect.width || 1;
    const safeHeight = rect.height || 1;
    const x = clamp((event.clientX - rect.left) / safeWidth, 0, 1);
    const y = clamp((event.clientY - rect.top) / safeHeight, 0, 1);

    return {
      yaw: mapUnitToRange(x, poseBounds.minYaw, poseBounds.maxYaw),
      pitch: mapUnitToRange(y, poseBounds.minPitch, poseBounds.maxPitch),
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

    const poseIndex = createPoseIndex(metadata);
    const poseBounds = derivePoseBounds(metadata);
    dom.hideLoader();
    dom.showImage();
    state.phase = "ready";

    const { updateFace } = createFaceUpdater(dom, state, poseIndex);
    const commandQueue = createPoseCommandQueue(state, updateFace);

    if (dom.container) {
      dom.container.addEventListener("mousemove", (event: MouseEvent) => {
        const rect = dom.getContainerRect();
        if (!rect) {
          return;
        }
        const pose = toPoseFromPointer(event, rect, poseBounds);
        commandQueue.enqueue(pose.yaw, pose.pitch);
      });
    }

    const initialPose = pickInitialPose(metadata, poseBounds);
    commandQueue.enqueue(initialPose.yaw, initialPose.pitch);
  };

  void initializeFacePose();
})();
