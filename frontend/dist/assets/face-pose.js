(() => {
  // src/assets/face-pose/config.ts
  var SELECTORS = {
    container: "face-container",
    scrubSurface: "main.container",
    image: "face-image",
    loader: "face-loader",
    metadataPanel: "face-metadata",
    metadataTitle: "face-metadata-title"
  };
  var POSE_CONFIG = {
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
    poseBoundsPaddingRatio: 0
  };
  var PRELOAD_CONFIG = {
    blockUntilComplete: true,
    maxConcurrent: 12,
    backgroundMaxConcurrent: 8,
    stagedBucketSteps: [3, 2, 1],
    initialBlockingLowTiers: [3, 2, 1]
  };
  var POINTER_NOISE_CONFIG = {
    minPoseDeltaToUpdate: 0.05,
    edgeCompressionThreshold: 0.15,
    edgeCompressionOutput: 0.08
  };
  var GYRO_CONFIG = {
    betaOffset: 50,
    minPoseDeltaToUpdate: 0.1,
    gammaMaxAbs: 90,
    interactionCoordinationThresholdMs: 500,
    noEventTimeoutMs: 2e3
  };
  var METADATA_ERROR_HINT = "Metadata is missing precomputed face transforms. Run `npm --prefix frontend run build:derivatives`.";

  // src/assets/face-pose/dom.ts
  var createDomFacade = () => {
    const faceContainer = document.getElementById(SELECTORS.container);
    const scrubSurface = document.querySelector(
      SELECTORS.scrubSurface
    );
    const interactionSurface = scrubSurface instanceof HTMLElement ? scrubSurface : faceContainer instanceof HTMLElement ? faceContainer : null;
    const image = document.getElementById(SELECTORS.image);
    const loader = document.getElementById(SELECTORS.loader);
    const metadataPanel = document.getElementById(SELECTORS.metadataPanel);
    const metadataTitle = document.getElementById(SELECTORS.metadataTitle);
    const permissionOverlay = document.getElementById("pose-permission-overlay");
    const hasRequiredNodes = faceContainer instanceof HTMLElement && interactionSurface instanceof HTMLElement && image instanceof HTMLImageElement && loader instanceof HTMLElement;
    const setLoaderText = (text) => {
      if (!(loader instanceof HTMLElement)) {
        return;
      }
      loader.textContent = text;
    };
    const hideLoader = () => {
      if (!(loader instanceof HTMLElement)) {
        return;
      }
      loader.style.display = "none";
    };
    const showImage = () => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.style.display = "block";
    };
    const setImageSource = (src) => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.src = src;
    };
    const setImageTransform = (transform) => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.style.transform = transform;
    };
    const setImageRendering = (mode) => {
      if (!(image instanceof HTMLImageElement)) {
        return;
      }
      image.style.imageRendering = mode;
    };
    const getContainerRect = () => {
      if (!(interactionSurface instanceof HTMLElement)) {
        return null;
      }
      return interactionSurface.getBoundingClientRect();
    };
    const renderMetadata = (item) => {
      if (!(metadataPanel instanceof HTMLElement)) {
        return;
      }
      if (metadataTitle instanceof HTMLElement) {
        metadataTitle.textContent = item.name ?? "Unknown";
      }
      metadataPanel.textContent = `interocularDist: ${item.interocularDist}
landmarkConfidence: ${item.landmarkConfidence}
pitch: ${item.pose.pitch}
yaw: ${item.pose.yaw}
roll: ${item.pose.roll}`;
    };
    return {
      hasRequiredNodes,
      container: interactionSurface,
      image: image instanceof HTMLImageElement ? image : null,
      setLoaderText,
      hideLoader,
      showImage,
      setImageSource,
      setImageTransform,
      setImageRendering,
      getContainerRect,
      renderMetadata,
      getPermissionOverlay: () => permissionOverlay instanceof HTMLElement ? permissionOverlay : null
    };
  };

  // src/assets/face-pose/metadata.ts
  var isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value);
  var asRecord = (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    return value;
  };
  var parseAtlasFiles = (value) => {
    const files = asRecord(value);
    if (!files) {
      return null;
    }
    const low = files.low;
    const mid = files.mid;
    const high = files.high;
    if (typeof low !== "string" || low.trim().length === 0 || typeof mid !== "string" || mid.trim().length === 0 || typeof high !== "string" || high.trim().length === 0) {
      return null;
    }
    return { low, mid, high };
  };
  var parseAtlasPlacement = (value) => {
    if (value === void 0 || value === null) {
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
    const normalizedFiles = files ?? (typeof file === "string" && file.trim().length > 0 ? {
      low: file,
      mid: file,
      high: file
    } : null);
    if (!normalizedFiles || !isFiniteNumber(column) || !isFiniteNumber(row) || !isFiniteNumber(gridSize)) {
      return null;
    }
    const safeColumn = Math.trunc(column);
    const safeRow = Math.trunc(row);
    const safeGridSize = Math.trunc(gridSize);
    if (safeColumn < 0 || safeRow < 0 || safeGridSize < 1 || safeColumn >= safeGridSize || safeRow >= safeGridSize) {
      return null;
    }
    return {
      files: normalizedFiles,
      column: safeColumn,
      row: safeRow,
      gridSize: safeGridSize
    };
  };
  var parseMetadataItem = (value) => {
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
    if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch) || !isFiniteNumber(interocularDist) || !isFiniteNumber(translateXRatio) || !isFiniteNumber(translateYRatio) || !isFiniteNumber(rotateRad) || !isFiniteNumber(scale)) {
      return null;
    }
    const rawName = item.name;
    const name = typeof rawName === "string" && rawName.trim().length > 0 ? rawName : void 0;
    const atlas = parseAtlasPlacement(item.atlas);
    if (item.atlas !== void 0 && atlas === null) {
      return null;
    }
    const rawPreloadTier = item.preloadTier;
    const preloadTier = isFiniteNumber(rawPreloadTier) && [0, 1, 2, 3].includes(Math.trunc(rawPreloadTier)) ? Math.trunc(rawPreloadTier) : void 0;
    return {
      file,
      pose: { yaw, pitch, roll: isFiniteNumber(roll) ? roll : 0 },
      interocularDist,
      landmarkConfidence: isFiniteNumber(landmarkConfidence) ? Math.max(0, Math.min(1, landmarkConfidence)) : 1,
      name,
      transform: {
        translateXRatio,
        translateYRatio,
        rotateRad,
        scale
      },
      atlas: atlas ?? void 0,
      preloadTier
    };
  };
  var loadMetadata = async () => {
    const metadataUrl = new URL("metadata.json", document.baseURI).toString();
    const response = await fetch(metadataUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} when loading metadata`);
    }
    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("Metadata payload is not an array.");
    }
    const items = payload.map(parseMetadataItem).filter((item) => item !== null);
    if (items.length === 0) {
      throw new Error(METADATA_ERROR_HINT);
    }
    return items;
  };
  var parsePoseBounds = (value) => {
    const record = asRecord(value);
    if (!record) {
      return null;
    }
    const minYaw = record.minYaw;
    const maxYaw = record.maxYaw;
    const minPitch = record.minPitch;
    const maxPitch = record.maxPitch;
    if (!isFiniteNumber(minYaw) || !isFiniteNumber(maxYaw) || !isFiniteNumber(minPitch) || !isFiniteNumber(maxPitch)) {
      return null;
    }
    if (maxYaw <= minYaw || maxPitch <= minPitch) {
      return null;
    }
    return { minYaw, maxYaw, minPitch, maxPitch };
  };
  var loadPoseBounds = async () => {
    const boundsUrl = new URL("pose-bounds.json", document.baseURI).toString();
    const response = await fetch(boundsUrl);
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    return parsePoseBounds(payload);
  };

  // src/assets/face-pose/preload.ts
  var toSingleSource = (item) => new URL(`input-images/${item.file}`, document.baseURI).toString();
  var toAtlasVariantSource = (atlas, variant) => new URL(`atlases/${atlas.files[variant]}`, document.baseURI).toString();
  var toVariantSource = (item, variant) => {
    if (!item.atlas) {
      return toSingleSource(item);
    }
    return toAtlasVariantSource(item.atlas, variant);
  };
  var preloadImage = (source) => new Promise((resolve) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      cleanup();
      resolve(true);
    };
    image.onerror = () => {
      cleanup();
      resolve(false);
    };
    image.src = source;
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      cleanup();
      resolve(true);
    }
  });
  var preloadImages = async (sources, maxConcurrent, onProgress, onSourceLoaded = () => void 0) => {
    const uniqueSources = Array.from(new Set(sources));
    const total = uniqueSources.length;
    let loaded = 0;
    let failed = 0;
    let cursor = 0;
    onProgress({ total, loaded, failed });
    if (total === 0) {
      return { total, loaded, failed };
    }
    const workerCount = Math.max(1, Math.min(maxConcurrent, total));
    const worker = async () => {
      for (; ; ) {
        const nextIndex = cursor;
        cursor += 1;
        if (nextIndex >= total) {
          return;
        }
        const didLoad = await preloadImage(uniqueSources[nextIndex]);
        if (didLoad) {
          loaded += 1;
          onSourceLoaded(uniqueSources[nextIndex]);
        } else {
          failed += 1;
        }
        onProgress({ total, loaded, failed });
      }
    };
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { total, loaded, failed };
  };
  var createPreloadPlan = (metadata) => {
    const hasTierData = metadata.some((item) => item.preloadTier !== void 0);
    if (hasTierData) {
      const toTierVariantSources = (tier, variant) => {
        const sources = /* @__PURE__ */ new Set();
        for (const item of metadata) {
          const itemTier = item.preloadTier ?? 0;
          const isMatch = tier === 3 ? itemTier >= tier : itemTier === tier;
          if (!isMatch) {
            continue;
          }
          sources.add(toVariantSource(item, variant));
        }
        return Array.from(sources).sort();
      };
      const blockingSources2 = Array.from(
        new Set(
          PRELOAD_CONFIG.initialBlockingLowTiers.flatMap(
            (tier) => toTierVariantSources(tier, "low")
          )
        )
      ).sort();
      const emittedSources = new Set(blockingSources2);
      const backgroundStages2 = [];
      const pushStage = (tier, variant) => {
        const stage = toTierVariantSources(tier, variant).filter(
          (source) => !emittedSources.has(source)
        );
        if (stage.length === 0) {
          return;
        }
        stage.forEach((source) => emittedSources.add(source));
        backgroundStages2.push(stage);
      };
      pushStage(2, "low");
      pushStage(1, "low");
      pushStage(0, "low");
      pushStage(3, "mid");
      pushStage(2, "mid");
      pushStage(1, "mid");
      pushStage(0, "mid");
      pushStage(3, "high");
      pushStage(2, "high");
      pushStage(1, "high");
      pushStage(0, "high");
      return { blockingSources: blockingSources2, backgroundStages: backgroundStages2 };
    }
    const usedSources = /* @__PURE__ */ new Set();
    const stageSources = [];
    for (const step of PRELOAD_CONFIG.stagedBucketSteps) {
      const representativeByBucket = /* @__PURE__ */ new Map();
      for (const item of metadata) {
        const key = `${Math.round(item.pose.yaw / step)}:${Math.round(item.pose.pitch / step)}:${Math.round(item.pose.roll / step)}`;
        const previous = representativeByBucket.get(key);
        if (!previous || item.interocularDist > previous.interocularDist) {
          representativeByBucket.set(key, item);
        }
      }
      const sources = Array.from(
        new Set(
          Array.from(representativeByBucket.values()).map(
            (item) => toVariantSource(item, "low")
          )
        )
      ).filter((source) => !usedSources.has(source)).sort();
      if (sources.length === 0) {
        continue;
      }
      sources.forEach((source) => usedSources.add(source));
      stageSources.push(sources);
    }
    if (stageSources.length === 0) {
      return { blockingSources: [], backgroundStages: [] };
    }
    const [blockingSources, ...backgroundStages] = stageSources;
    const midStage = Array.from(
      new Set(metadata.map((item) => toVariantSource(item, "mid")))
    ).filter((source) => !usedSources.has(source));
    midStage.forEach((source) => usedSources.add(source));
    const highStage = Array.from(
      new Set(metadata.map((item) => toVariantSource(item, "high")))
    ).filter((source) => !usedSources.has(source));
    const upgradeStages = [midStage, highStage].filter(
      (stage) => stage.length > 0
    );
    return {
      blockingSources,
      backgroundStages: [...backgroundStages, ...upgradeStages]
    };
  };

  // src/assets/face-pose/pose-index.ts
  var nowMs = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  var toBucketIndex = (value, step) => Math.round(value / step);
  var toPoseCellKey = (yaw, pitch, cellStep) => `${Math.round(yaw / cellStep)}:${Math.round(pitch / cellStep)}`;
  var clampConfidence = (value) => Math.max(0, Math.min(1, value));
  var resolveLoadedCandidateSource = (candidate, loadedSources) => {
    if (!candidate.atlas) {
      return toSingleSource(candidate);
    }
    const high = toVariantSource(candidate, "high");
    if (loadedSources.has(high)) {
      return high;
    }
    const mid = toVariantSource(candidate, "mid");
    if (loadedSources.has(mid)) {
      return mid;
    }
    return toVariantSource(candidate, "low");
  };
  var createPoseIndex = (metadata) => {
    const buckets = /* @__PURE__ */ new Map();
    for (const item of metadata) {
      const bucketYaw = toBucketIndex(item.pose.yaw, POSE_CONFIG.bucketStep);
      const bucketPitch = toBucketIndex(item.pose.pitch, POSE_CONFIG.bucketStep);
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
        const leftDist = (left.pose.yaw - centerYaw) ** 2 + (left.pose.pitch - centerPitch) ** 2;
        const rightDist = (right.pose.yaw - centerYaw) ** 2 + (right.pose.pitch - centerPitch) ** 2;
        if (leftDist !== rightDist) {
          return leftDist - rightDist;
        }
        return left.file.localeCompare(right.file);
      });
    }
    const getClosestFallback = (yaw, pitch) => {
      let closest = metadata[0];
      let minDistance = Infinity;
      for (const item of metadata) {
        const yawDistance = item.pose.yaw - yaw;
        const pitchDistance = item.pose.pitch - pitch;
        const distance = yawDistance * yawDistance + pitchDistance * pitchDistance;
        if (distance < minDistance) {
          minDistance = distance;
          closest = item;
        }
      }
      return closest;
    };
    const collectNearbyCandidates = (bucketYaw, bucketPitch, radius) => {
      const candidates = [];
      for (let yawOffset = -radius; yawOffset <= radius; yawOffset += 1) {
        for (let pitchOffset = -radius; pitchOffset <= radius; pitchOffset += 1) {
          const key = `${bucketYaw + yawOffset}:${bucketPitch + pitchOffset}`;
          const bucket = buckets.get(key);
          if (bucket && bucket.length > 0) {
            candidates.push(...bucket);
          }
        }
      }
      return candidates;
    };
    const estimateTargetRoll = (candidates, yaw, pitch) => {
      if (candidates.length === 0) {
        return null;
      }
      let weightedRoll = 0;
      let weightTotal = 0;
      for (const candidate of candidates) {
        const yawDistance = candidate.pose.yaw - yaw;
        const pitchDistance = candidate.pose.pitch - pitch;
        const distanceSq = yawDistance * yawDistance + pitchDistance * pitchDistance;
        const weight = 1 / (1 + distanceSq);
        weightedRoll += candidate.pose.roll * weight;
        weightTotal += weight;
      }
      if (!Number.isFinite(weightTotal) || weightTotal <= 0) {
        return null;
      }
      return weightedRoll / weightTotal;
    };
    const scoreCandidate = (candidate, yaw, pitch, targetRoll, state) => {
      const source = resolveLoadedCandidateSource(candidate, state.loadedSources);
      const yawDistance = candidate.pose.yaw - yaw;
      const pitchDistance = candidate.pose.pitch - pitch;
      const distance = yawDistance * yawDistance + pitchDistance * pitchDistance;
      const rollPenalty = targetRoll === null ? 0 : (candidate.pose.roll - targetRoll) * (candidate.pose.roll - targetRoll) * POSE_CONFIG.rollPenalty;
      const confidencePenalty = (1 - clampConfidence(candidate.landmarkConfidence)) ** 2 * POSE_CONFIG.landmarkConfidencePenalty;
      const usage = state.selectionUsage.get(candidate.file) ?? 0;
      const recentIndex = state.recentFiles.lastIndexOf(candidate.file);
      let recentPenalty = 0;
      if (recentIndex >= 0) {
        const fromLatest = state.recentFiles.length - 1 - recentIndex;
        const windowLeft = POSE_CONFIG.recentPenaltyWindow - fromLatest;
        recentPenalty = windowLeft > 0 ? windowLeft * POSE_CONFIG.recentPenaltyStep : 0;
      }
      const loadPenalty = state.loadedSources.has(source) ? 0 : POSE_CONFIG.notLoadedSourcePenalty;
      if (distance > POSE_CONFIG.usagePenaltyDistanceSq) {
        return distance + rollPenalty + confidencePenalty + recentPenalty + loadPenalty;
      }
      const usagePenalty = Math.min(
        usage * POSE_CONFIG.usagePenalty,
        POSE_CONFIG.maxUsagePenalty
      );
      return distance + usagePenalty + rollPenalty + confidencePenalty + recentPenalty + loadPenalty;
    };
    const pickFromTopCandidates = (scoredCandidates) => {
      if (scoredCandidates.length === 0) {
        return metadata[0];
      }
      const poolSize = Math.min(
        scoredCandidates.length,
        POSE_CONFIG.candidatePoolSize
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
    const rememberSelection = (state, file) => {
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
    const pickClosest = (yaw, pitch, state) => {
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
      const currentStillCandidate = state.currentItem && candidates.some(
        (candidate) => candidate.file === state.currentItem?.file
      );
      if (inSameCell && state.currentItem && currentStillCandidate && (candidates.length === 1 || nowMs() - state.lastSwitchAt < POSE_CONFIG.sameCellMinSwitchIntervalMs || Math.random() >= POSE_CONFIG.sameCellExploreChance)) {
        return state.currentItem;
      }
      state.poseCellKey = poseCellKey;
      const scoredCandidates = candidates.map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, yaw, pitch, targetRoll, state)
      })).sort((left, right) => {
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
          state
        );
        const scoreGain = currentScore - bestScore;
        const elapsedMs = nowMs() - state.lastSwitchAt;
        const dynamicMinSwitchIntervalMs = POSE_CONFIG.minSwitchIntervalMs + Math.min(
          POSE_CONFIG.maxVelocitySwitchIntervalBoostMs,
          state.pointerVelocityDegPerMs * POSE_CONFIG.velocityIntervalBoostFactor
        );
        const holdForMargin = scoreGain < POSE_CONFIG.switchMargin;
        const holdForRate = elapsedMs < dynamicMinSwitchIntervalMs && scoreGain < POSE_CONFIG.fastSwitchMargin;
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

  // src/assets/face-pose/updater.ts
  var toAtlasTileTransformCss = (atlas) => `translate(${-atlas.column * 100}%, ${-atlas.row * 100}%) scale(${atlas.gridSize})`;
  var toTransformCss = (item) => item.atlas ? toAtlasTileTransformCss(item.atlas) : "none";
  var resolveImageSource = (item, loadedSources) => {
    if (!item.atlas) {
      return { source: toSingleSource(item), variant: "single" };
    }
    const high = toVariantSource(item, "high");
    if (loadedSources.has(high)) {
      return { source: high, variant: "high" };
    }
    const mid = toVariantSource(item, "mid");
    if (loadedSources.has(mid)) {
      return { source: mid, variant: "mid" };
    }
    return { source: toVariantSource(item, "low"), variant: "low" };
  };
  var createFaceUpdater = (dom, state, poseIndex) => {
    const scheduleMicrotask = (task) => {
      if (typeof queueMicrotask === "function") {
        queueMicrotask(task);
        return;
      }
      void Promise.resolve().then(task);
    };
    const applyItemFrame = (item, variant) => {
      const transformCss = toTransformCss(item);
      dom.setImageTransform(transformCss);
      dom.setImageRendering(
        variant === "high" || variant === "single" ? "auto" : "pixelated"
      );
      state.lastTransform = transformCss;
      state.hasTransform = true;
      dom.renderMetadata(item);
    };
    const scheduleVariantUpgrade = (item) => {
      scheduleMicrotask(() => {
        if (!state.currentItem || state.currentItem.file !== item.file) {
          return;
        }
        const upgraded = resolveImageSource(item, state.loadedSources);
        if (upgraded.variant === "low" || upgraded.variant === "single") {
          return;
        }
        if (dom.image && dom.image.src !== upgraded.source) {
          dom.setImageSource(upgraded.source);
        }
        applyItemFrame(item, upgraded.variant);
      });
    };
    const scheduleSourceLoad = (source, token) => {
      if (state.pendingSourceLoads.has(source)) {
        return;
      }
      state.pendingSourceLoads.set(source, token);
      void preloadImage(source).then((didLoad) => {
        state.pendingSourceLoads.delete(source);
        if (!didLoad) {
          return;
        }
        state.loadedSources.add(source);
        if (token !== state.token || !state.currentItem) {
          return;
        }
        const resolved = resolveImageSource(
          state.currentItem,
          state.loadedSources
        );
        if (resolved.source !== source) {
          return;
        }
        if (dom.image && dom.image.src !== source) {
          dom.setImageSource(source);
        }
        applyItemFrame(state.currentItem, resolved.variant);
        if (resolved.variant === "low") {
          scheduleVariantUpgrade(state.currentItem);
        }
      }).catch(() => {
        state.pendingSourceLoads.delete(source);
      });
    };
    const updateFace = (yaw, pitch) => {
      const item = poseIndex.pickClosest(yaw, pitch, state);
      const nextResolved = resolveImageSource(item, state.loadedSources);
      const nextSource = nextResolved.source;
      const sameItem = state.currentItem?.file === item.file;
      const sameSource = Boolean(dom.image && dom.image.src === nextSource);
      if (sameItem && sameSource && state.hasTransform) {
        return;
      }
      state.currentItem = item;
      if (state.loadedSources.has(nextSource)) {
        if (dom.image && dom.image.src !== nextSource) {
          dom.setImageSource(nextSource);
        }
        applyItemFrame(item, nextResolved.variant);
        if (nextResolved.variant === "low") {
          scheduleVariantUpgrade(item);
        }
        return;
      }
      if (state.hasTransform) {
        dom.setImageTransform(state.lastTransform);
      }
      const token = state.token + 1;
      state.token = token;
      scheduleSourceLoad(nextSource, token);
    };
    return { updateFace };
  };
  var createPoseCommandQueue = (state, updateFace) => {
    const flush = () => {
      state.rafId = 0;
      if (!state.pendingCommand) {
        return;
      }
      const command = state.pendingCommand;
      state.pendingCommand = null;
      updateFace(command.yaw, command.pitch);
    };
    const enqueue = (yaw, pitch) => {
      state.pendingCommand = { yaw, pitch };
      if (state.rafId) {
        return;
      }
      state.rafId = requestAnimationFrame(flush);
    };
    return { enqueue };
  };

  // src/assets/face-pose/index.ts
  var CACHE_HINT_INTERVAL_MS = 450;
  var CACHE_HINT_MAX_SOURCES = 10;
  var CACHE_HINT_MIN_VELOCITY = 0.01;
  var nowMs2 = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  var clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  var mapUnitToRange = (unit, min, max) => min + clamp(unit, 0, 1) * (max - min);
  var compressEdgeUnit = (unit) => {
    const threshold = POINTER_NOISE_CONFIG.edgeCompressionThreshold;
    const outputEdge = POINTER_NOISE_CONFIG.edgeCompressionOutput;
    const safe = clamp(unit, 0, 1);
    if (safe <= threshold) {
      return safe / threshold * outputEdge;
    }
    if (safe >= 1 - threshold) {
      return 1 - (1 - safe) / threshold * outputEdge;
    }
    const middleInput = (safe - threshold) / (1 - threshold * 2);
    return outputEdge + middleInput * (1 - outputEdge * 2);
  };
  var derivePoseBounds = (metadata) => {
    const defaultBounds = {
      minYaw: -POSE_CONFIG.defaultMaxAbsYaw,
      maxYaw: POSE_CONFIG.defaultMaxAbsYaw,
      minPitch: -POSE_CONFIG.defaultMaxAbsPitch,
      maxPitch: POSE_CONFIG.defaultMaxAbsPitch
    };
    if (metadata.length === 0) {
      return defaultBounds;
    }
    let minYaw = Infinity;
    let maxYaw = -Infinity;
    let minPitch = Infinity;
    let maxPitch = -Infinity;
    const coverageByCell = /* @__PURE__ */ new Map();
    for (const item of metadata) {
      minYaw = Math.min(minYaw, item.pose.yaw);
      maxYaw = Math.max(maxYaw, item.pose.yaw);
      minPitch = Math.min(minPitch, item.pose.pitch);
      maxPitch = Math.max(maxPitch, item.pose.pitch);
      const yawCell = Math.round(item.pose.yaw / POSE_CONFIG.coverageCellStep);
      const pitchCell = Math.round(
        item.pose.pitch / POSE_CONFIG.coverageCellStep
      );
      const cellKey = `${yawCell}:${pitchCell}`;
      const existing = coverageByCell.get(cellKey);
      if (existing) {
        existing.count += 1;
      } else {
        coverageByCell.set(cellKey, { yawCell, pitchCell, count: 1 });
      }
    }
    if (!Number.isFinite(minYaw) || !Number.isFinite(maxYaw) || !Number.isFinite(minPitch) || !Number.isFinite(maxPitch)) {
      return defaultBounds;
    }
    minYaw = clamp(minYaw, -POSE_CONFIG.maxAbsYaw, POSE_CONFIG.maxAbsYaw);
    maxYaw = clamp(maxYaw, -POSE_CONFIG.maxAbsYaw, POSE_CONFIG.maxAbsYaw);
    minPitch = clamp(minPitch, -POSE_CONFIG.maxAbsPitch, POSE_CONFIG.maxAbsPitch);
    maxPitch = clamp(maxPitch, -POSE_CONFIG.maxAbsPitch, POSE_CONFIG.maxAbsPitch);
    const denseCells = Array.from(coverageByCell.values()).filter(
      (cell) => cell.count >= POSE_CONFIG.coverageMinItemsPerCell
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
      if (Number.isFinite(denseMinYaw) && Number.isFinite(denseMaxYaw) && Number.isFinite(denseMinPitch) && Number.isFinite(denseMaxPitch)) {
        minYaw = clamp(
          denseMinYaw,
          -POSE_CONFIG.maxAbsYaw,
          POSE_CONFIG.maxAbsYaw
        );
        maxYaw = clamp(
          denseMaxYaw,
          -POSE_CONFIG.maxAbsYaw,
          POSE_CONFIG.maxAbsYaw
        );
        minPitch = clamp(
          denseMinPitch,
          -POSE_CONFIG.maxAbsPitch,
          POSE_CONFIG.maxAbsPitch
        );
        maxPitch = clamp(
          denseMaxPitch,
          -POSE_CONFIG.maxAbsPitch,
          POSE_CONFIG.maxAbsPitch
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
        POSE_CONFIG.maxAbsYaw
      ),
      maxYaw: clamp(
        maxYaw + yawPad,
        -POSE_CONFIG.maxAbsYaw,
        POSE_CONFIG.maxAbsYaw
      ),
      minPitch: clamp(
        minPitch - pitchPad,
        -POSE_CONFIG.maxAbsPitch,
        POSE_CONFIG.maxAbsPitch
      ),
      maxPitch: clamp(
        maxPitch + pitchPad,
        -POSE_CONFIG.maxAbsPitch,
        POSE_CONFIG.maxAbsPitch
      )
    };
  };
  var createRuntimeState = () => ({
    phase: "idle",
    token: 0,
    lastTransform: "",
    hasTransform: false,
    currentItem: null,
    lastSwitchAt: 0,
    rafId: 0,
    pendingCommand: null,
    poseCellKey: "",
    selectionUsage: /* @__PURE__ */ new Map(),
    recentFiles: [],
    loadedSources: /* @__PURE__ */ new Set(),
    pendingSourceLoads: /* @__PURE__ */ new Map(),
    lastPointerPose: null,
    lastPointerAtMs: 0,
    pointerVelocityDegPerMs: 0,
    lastHintAtMs: 0,
    lastInteractionAtMs: 0,
    lastInteractionType: null,
    isGyroActive: false
  });
  var toPoseFromPointer = (event, rect, poseBounds) => {
    const safeWidth = rect.width || 1;
    const safeHeight = rect.height || 1;
    const x = clamp((event.clientX - rect.left) / safeWidth, 0, 1);
    const y = clamp((event.clientY - rect.top) / safeHeight, 0, 1);
    const easedX = compressEdgeUnit(x);
    const easedY = compressEdgeUnit(y);
    return {
      yaw: mapUnitToRange(easedX, poseBounds.minYaw, poseBounds.maxYaw),
      pitch: mapUnitToRange(easedY, poseBounds.minPitch, poseBounds.maxPitch)
    };
  };
  var pickInitialPose = (metadata, poseBounds) => {
    if (metadata.length === 0) {
      return {
        yaw: (poseBounds.minYaw + poseBounds.maxYaw) * 0.5,
        pitch: (poseBounds.minPitch + poseBounds.maxPitch) * 0.5
      };
    }
    const randomIndex = Math.floor(Math.random() * metadata.length);
    const item = metadata[randomIndex];
    return {
      yaw: clamp(item.pose.yaw, poseBounds.minYaw, poseBounds.maxYaw),
      pitch: clamp(item.pose.pitch, poseBounds.minPitch, poseBounds.maxPitch)
    };
  };
  var collectQuadrantHintSources = (metadata, pose, loadedSources) => {
    const yawSign = pose.yaw >= 0 ? 1 : -1;
    const pitchSign = pose.pitch >= 0 ? 1 : -1;
    const candidates = metadata.filter((item) => {
      const sameYawQuadrant = yawSign > 0 ? item.pose.yaw >= 0 : item.pose.yaw <= 0;
      const samePitchQuadrant = pitchSign > 0 ? item.pose.pitch >= 0 : item.pose.pitch <= 0;
      return sameYawQuadrant && samePitchQuadrant;
    }).sort((left, right) => {
      const leftDistance = (left.pose.yaw - pose.yaw) ** 2 + (left.pose.pitch - pose.pitch) ** 2;
      const rightDistance = (right.pose.yaw - pose.yaw) ** 2 + (right.pose.pitch - pose.pitch) ** 2;
      return leftDistance - rightDistance;
    });
    const hinted = /* @__PURE__ */ new Set();
    for (const item of candidates) {
      const prioritizedVariants = item.atlas ? ["high", "mid"] : ["high"];
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
  var scheduleCacheWarmHint = (metadata, state, pose, now) => {
    if (state.pointerVelocityDegPerMs < CACHE_HINT_MIN_VELOCITY) {
      return;
    }
    if (now - state.lastHintAtMs < CACHE_HINT_INTERVAL_MS) {
      return;
    }
    const hintSources = collectQuadrantHintSources(
      metadata,
      pose,
      state.loadedSources
    );
    if (hintSources.length === 0) {
      return;
    }
    state.lastHintAtMs = now;
    void preloadImages(
      hintSources,
      PRELOAD_CONFIG.backgroundMaxConcurrent,
      () => void 0,
      (source) => {
        state.loadedSources.add(source);
      }
    );
  };
  var initializeFacePose = async () => {
    const dom = createDomFacade();
    if (!dom.hasRequiredNodes) {
      return;
    }
    const state = createRuntimeState();
    state.phase = "loading";
    let metadata = [];
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
          `Preloading images... ${progressValue}/${summary.total}`
        );
      },
      (source) => {
        state.loadedSources.add(source);
      }
    );
    if (preloadResult.failed > 0) {
      console.warn(
        `Image preload completed with ${preloadResult.failed} failed requests.`
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
      container.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "mouse") {
          container.setPointerCapture(event.pointerId);
        }
      });
      container.addEventListener("pointermove", (event) => {
        const rect = dom.getContainerRect();
        if (!rect) {
          return;
        }
        const pose = toPoseFromPointer(event, rect, poseBounds);
        const now = nowMs2();
        if (state.lastPointerPose && state.lastPointerAtMs > 0) {
          const yawDelta = pose.yaw - state.lastPointerPose.yaw;
          const pitchDelta = pose.pitch - state.lastPointerPose.pitch;
          const distance = Math.sqrt(
            yawDelta * yawDelta + pitchDelta * pitchDelta
          );
          const elapsedMs = Math.max(1, now - state.lastPointerAtMs);
          state.pointerVelocityDegPerMs = distance / elapsedMs;
        } else {
          state.pointerVelocityDegPerMs = 0;
        }
        if (state.lastPointerPose) {
          const yawDelta = Math.abs(pose.yaw - state.lastPointerPose.yaw);
          const pitchDelta = Math.abs(pose.pitch - state.lastPointerPose.pitch);
          if (yawDelta < POINTER_NOISE_CONFIG.minPoseDeltaToUpdate && pitchDelta < POINTER_NOISE_CONFIG.minPoseDeltaToUpdate) {
            return;
          }
        }
        state.lastPointerPose = pose;
        state.lastPointerAtMs = now;
        state.lastInteractionAtMs = now;
        state.lastInteractionType = "pointer";
        commandQueue.enqueue(pose.yaw, pose.pitch);
        scheduleCacheWarmHint(metadata, state, pose, now);
      });
    }
    const initialPose = pickInitialPose(metadata, poseBounds);
    commandQueue.enqueue(initialPose.yaw, initialPose.pitch);
    const permissionOverlay = dom.getPermissionOverlay();
    const hasOrientationSupport = typeof window !== "undefined" && "DeviceOrientationEvent" in window;
    if (hasOrientationSupport && permissionOverlay) {
      const DeviceOrientation = window.DeviceOrientationEvent;
      const requiresPermission = typeof DeviceOrientation.requestPermission === "function";
      let lastGyroPose = null;
      let gyroEventCount = 0;
      let gyroDetectionTimeout;
      const onOrientation = (event) => {
        const now = nowMs2();
        if (state.lastInteractionType === "pointer" && now - state.lastInteractionAtMs < GYRO_CONFIG.interactionCoordinationThresholdMs) {
          return;
        }
        const gamma = event.gamma ?? 0;
        const beta = event.beta ?? 0;
        const normalizedGamma = (clamp(gamma, -GYRO_CONFIG.gammaMaxAbs, GYRO_CONFIG.gammaMaxAbs) + GYRO_CONFIG.gammaMaxAbs) / (2 * GYRO_CONFIG.gammaMaxAbs);
        const yaw = mapUnitToRange(
          normalizedGamma,
          poseBounds.minYaw,
          poseBounds.maxYaw
        );
        const pitch = clamp(
          beta - GYRO_CONFIG.betaOffset,
          poseBounds.minPitch,
          poseBounds.maxPitch
        );
        if (lastGyroPose) {
          const yawDelta = Math.abs(yaw - lastGyroPose.yaw);
          const pitchDelta = Math.abs(pitch - lastGyroPose.pitch);
          if (yawDelta < GYRO_CONFIG.minPoseDeltaToUpdate && pitchDelta < GYRO_CONFIG.minPoseDeltaToUpdate) {
            return;
          }
        }
        gyroEventCount++;
        if (gyroEventCount > 1) {
          state.isGyroActive = true;
          state.lastInteractionType = "gyro";
          state.lastInteractionAtMs = now;
          if (gyroDetectionTimeout !== void 0) {
            clearTimeout(gyroDetectionTimeout);
            gyroDetectionTimeout = void 0;
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
        } catch (e) {
          console.warn("DeviceOrientation permission failed", e);
        }
        permissionOverlay.style.display = "none";
      };
      try {
        window.addEventListener("deviceorientation", onOrientation);
        gyroDetectionTimeout = window.setTimeout(() => {
          if (gyroEventCount === 0 && requiresPermission) {
            permissionOverlay.style.display = "flex";
            permissionOverlay.addEventListener(
              "click",
              (e) => {
                e.stopPropagation();
                void enableMotion();
              },
              { once: true }
            );
          }
        }, 500);
      } catch {
      }
    }
    if (preloadPlan.backgroundStages.length > 0) {
      const runBackgroundPreload = async () => {
        for (let stageIndex = 0; stageIndex < preloadPlan.backgroundStages.length; stageIndex += 1) {
          const stageSources = preloadPlan.backgroundStages[stageIndex];
          if (stageSources.length === 0) {
            continue;
          }
          const summary = await preloadImages(
            stageSources,
            PRELOAD_CONFIG.backgroundMaxConcurrent,
            () => void 0,
            (source) => {
              state.loadedSources.add(source);
            }
          );
          if (summary.failed > 0) {
            console.warn(
              `Background preload stage ${stageIndex + 1} completed with ${summary.failed} failed requests.`
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
})();
