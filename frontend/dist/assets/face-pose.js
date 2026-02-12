"use strict";
(() => {
    const SELECTORS = {
        container: "face-container",
        image: "face-image",
        loader: "face-loader",
        metadataPanel: "face-metadata",
        metadataTitle: "face-metadata-title",
    };
    const POSE_CONFIG = {
        bucketStep: 1,
        poseCellStep: 1,
        sameCellExploreChance: 0,
        sameCellMinSwitchIntervalMs: 220,
        candidatePoolSize: 1,
        selectionTemperature: 1,
        recentHistoryLimit: 18,
        recentPenaltyStep: 0,
        recentPenaltyWindow: 6,
        rollPenalty: 0.2,
        usagePenalty: 0,
        maxUsagePenalty: 0,
        usagePenaltyDistanceSq: 64,
        switchMargin: 14,
        minSwitchIntervalMs: 140,
        fastSwitchMargin: 38,
        notLoadedSourcePenalty: 0,
        defaultMaxAbsYaw: 75,
        defaultMaxAbsPitch: 50,
        maxAbsYaw: 120,
        maxAbsPitch: 90,
        minPoseSpan: 20,
        poseBoundsPaddingRatio: 0,
    };
    const PRELOAD_CONFIG = {
        blockUntilComplete: true,
        maxConcurrent: 12,
        backgroundMaxConcurrent: 8,
        stagedBucketSteps: [3, 2, 1],
    };
    const METADATA_ERROR_HINT = "Metadata is missing precomputed face transforms. Run `npm --prefix frontend run build:derivatives`.";
    const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value) && !Number.isNaN(value);
    const nowMs = () => typeof performance !== "undefined" ? performance.now() : Date.now();
    const toBucketIndex = (value, step) => Math.round(value / step);
    const toPoseCellKey = (yaw, pitch, cellStep) => `${Math.round(yaw / cellStep)}:${Math.round(pitch / cellStep)}`;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const mapUnitToRange = (unit, min, max) => min + clamp(unit, 0, 1) * (max - min);
    const toSingleSource = (item) => new URL(`input-images/${item.file}`, document.baseURI).toString();
    const toAtlasVariantSource = (atlas, variant) => new URL(`atlases/${atlas.files[variant]}`, document.baseURI).toString();
    const toVariantSource = (item, variant) => {
        if (!item.atlas) {
            return toSingleSource(item);
        }
        return toAtlasVariantSource(item.atlas, variant);
    };
    /** Choose the sharpest already-loaded atlas variant for smooth progressive upgrades. */
    const resolveImageSource = (item, loadedSources) => {
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
    const preloadImage = (source) => new Promise((resolve) => {
        const image = new Image();
        const cleanup = () => {
            image.onload = null;
            image.onerror = null;
        };
        image.onload = () => {
            cleanup();
            if (typeof image.decode === "function") {
                image.decode().catch(() => undefined).finally(() => resolve(true));
                return;
            }
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
    /**
     * Preload image sources with a bounded async worker pool.
     * Keeps UI responsive while ensuring images are warm in cache before scrub starts.
     */
    const preloadImages = async (sources, maxConcurrent, onProgress, onSourceLoaded = () => undefined) => {
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
            for (;;) {
                const nextIndex = cursor;
                cursor += 1;
                if (nextIndex >= total) {
                    return;
                }
                const didLoad = await preloadImage(uniqueSources[nextIndex]);
                if (didLoad) {
                    loaded += 1;
                    onSourceLoaded(uniqueSources[nextIndex]);
                }
                else {
                    failed += 1;
                }
                onProgress({ total, loaded, failed });
            }
        };
        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return { total, loaded, failed };
    };
    /**
     * Build a staged preload plan:
     * 1) seed tier (3°) blocks first interaction
     * 2) load low-res backfill, then mid-res, then high-res atlas upgrades
     */
    const createPreloadPlan = (metadata) => {
        const hasTierData = metadata.some((item) => item.preloadTier !== undefined);
        if (hasTierData) {
            const toTierVariantSources = (tier, variant) => {
                const sources = new Set();
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
            const blockingSources = toTierVariantSources(3, "low");
            const emittedSources = new Set(blockingSources);
            const backgroundStages = [];
            const pushStage = (tier, variant) => {
                const stage = toTierVariantSources(tier, variant).filter((source) => !emittedSources.has(source));
                if (stage.length === 0) {
                    return;
                }
                stage.forEach((source) => emittedSources.add(source));
                backgroundStages.push(stage);
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
            return { blockingSources, backgroundStages };
        }
        const usedSources = new Set();
        const stageSources = [];
        for (const step of PRELOAD_CONFIG.stagedBucketSteps) {
            const representativeByBucket = new Map();
            for (const item of metadata) {
                const key = `${Math.round(item.pose.yaw / step)}:${Math.round(item.pose.pitch / step)}:${Math.round(item.pose.roll / step)}`;
                const previous = representativeByBucket.get(key);
                if (!previous || item.interocularDist > previous.interocularDist) {
                    representativeByBucket.set(key, item);
                }
            }
            const sources = Array.from(new Set(Array.from(representativeByBucket.values()).map((item) => toVariantSource(item, "low"))))
                .filter((source) => !usedSources.has(source))
                .sort();
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
        const midStage = Array.from(new Set(metadata.map((item) => toVariantSource(item, "mid")))).filter((source) => !usedSources.has(source));
        midStage.forEach((source) => usedSources.add(source));
        const highStage = Array.from(new Set(metadata.map((item) => toVariantSource(item, "high")))).filter((source) => !usedSources.has(source));
        const upgradeStages = [midStage, highStage].filter((stage) => stage.length > 0);
        return { blockingSources, backgroundStages: [...backgroundStages, ...upgradeStages] };
    };
    /**
     * Derive interactive pose bounds from dataset coverage.
     * Falls back to defaults when metadata range is too narrow.
     */
    const derivePoseBounds = (metadata) => {
        const defaultBounds = {
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
        if (!Number.isFinite(minYaw) ||
            !Number.isFinite(maxYaw) ||
            !Number.isFinite(minPitch) ||
            !Number.isFinite(maxPitch)) {
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
            minPitch: clamp(minPitch - pitchPad, -POSE_CONFIG.maxAbsPitch, POSE_CONFIG.maxAbsPitch),
            maxPitch: clamp(maxPitch + pitchPad, -POSE_CONFIG.maxAbsPitch, POSE_CONFIG.maxAbsPitch),
        };
    };
    const createRuntimeState = () => ({
        phase: "idle",
        token: 0,
        lastTransform: "",
        hasTransform: false,
        currentItem: null,
        lastSwitchAt: 0,
        rafId: 0,
        pendingCommand: null,
        poseCellKey: "",
        selectionUsage: new Map(),
        recentFiles: [],
        loadedSources: new Set(),
    });
    const asRecord = (value) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return null;
        }
        return value;
    };
    const parseAtlasFiles = (value) => {
        const files = asRecord(value);
        if (!files) {
            return null;
        }
        const low = files.low;
        const mid = files.mid;
        const high = files.high;
        if (typeof low !== "string" ||
            low.trim().length === 0 ||
            typeof mid !== "string" ||
            mid.trim().length === 0 ||
            typeof high !== "string" ||
            high.trim().length === 0) {
            return null;
        }
        return { low, mid, high };
    };
    const parseAtlasPlacement = (value) => {
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
        const normalizedFiles = files ??
            (typeof file === "string" && file.trim().length > 0
                ? {
                    low: file,
                    mid: file,
                    high: file,
                }
                : null);
        if (!normalizedFiles ||
            !isFiniteNumber(column) ||
            !isFiniteNumber(row) ||
            !isFiniteNumber(gridSize)) {
            return null;
        }
        const safeColumn = Math.trunc(column);
        const safeRow = Math.trunc(row);
        const safeGridSize = Math.trunc(gridSize);
        if (safeColumn < 0 ||
            safeRow < 0 ||
            safeGridSize < 1 ||
            safeColumn >= safeGridSize ||
            safeRow >= safeGridSize) {
            return null;
        }
        return {
            files: normalizedFiles,
            column: safeColumn,
            row: safeRow,
            gridSize: safeGridSize,
        };
    };
    const parseMetadataItem = (value) => {
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
        if (!isFiniteNumber(yaw) ||
            !isFiniteNumber(pitch) ||
            !isFiniteNumber(interocularDist) ||
            !isFiniteNumber(translateXRatio) ||
            !isFiniteNumber(translateYRatio) ||
            !isFiniteNumber(rotateRad) ||
            !isFiniteNumber(scale)) {
            return null;
        }
        const rawName = item.name;
        const name = typeof rawName === "string" && rawName.trim().length > 0
            ? rawName
            : undefined;
        const atlas = parseAtlasPlacement(item.atlas);
        if (item.atlas !== undefined && atlas === null) {
            return null;
        }
        const rawPreloadTier = item.preloadTier;
        const preloadTier = isFiniteNumber(rawPreloadTier) &&
            [0, 1, 2, 3].includes(Math.trunc(rawPreloadTier))
            ? Math.trunc(rawPreloadTier)
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
            atlas: atlas ?? undefined,
            preloadTier,
        };
    };
    /**
     * Load and validate runtime metadata.
     * Invalid entries are dropped so one corrupt record does not break the viewer.
     */
    const loadMetadata = async () => {
        const metadataUrl = new URL("metadata.json", document.baseURI).toString();
        const response = await fetch(metadataUrl);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} when loading metadata`);
        }
        const payload = await response.json();
        if (!Array.isArray(payload)) {
            throw new Error("Metadata payload is not an array.");
        }
        const items = payload
            .map(parseMetadataItem)
            .filter((item) => item !== null);
        if (items.length === 0) {
            throw new Error(METADATA_ERROR_HINT);
        }
        return items;
    };
    const createDomFacade = () => {
        const container = document.getElementById(SELECTORS.container);
        const image = document.getElementById(SELECTORS.image);
        const loader = document.getElementById(SELECTORS.loader);
        const metadataPanel = document.getElementById(SELECTORS.metadataPanel);
        const metadataTitle = document.getElementById(SELECTORS.metadataTitle);
        const hasRequiredNodes = container instanceof HTMLElement &&
            image instanceof HTMLImageElement &&
            loader instanceof HTMLElement;
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
            if (!(container instanceof HTMLElement)) {
                return null;
            }
            return container.getBoundingClientRect();
        };
        const renderMetadata = (item) => {
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
            setImageRendering,
            getContainerRect,
            renderMetadata,
        };
    };
    /**
     * Build a pose bucket index for fast nearest-image lookup with jitter damping.
     */
    const createPoseIndex = (metadata) => {
        const buckets = new Map();
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
                const leftDist = (left.pose.yaw - centerYaw) ** 2 +
                    (left.pose.pitch - centerPitch) ** 2;
                const rightDist = (right.pose.yaw - centerYaw) ** 2 +
                    (right.pose.pitch - centerPitch) ** 2;
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
            const source = resolveImageSource(candidate, state.loadedSources).source;
            const yawDistance = candidate.pose.yaw - yaw;
            const pitchDistance = candidate.pose.pitch - pitch;
            const distance = yawDistance * yawDistance + pitchDistance * pitchDistance;
            const rollPenalty = targetRoll === null
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
            const loadPenalty = state.loadedSources.has(source)
                ? 0
                : POSE_CONFIG.notLoadedSourcePenalty;
            if (distance > POSE_CONFIG.usagePenaltyDistanceSq) {
                return distance + rollPenalty + recentPenalty + loadPenalty;
            }
            const usagePenalty = Math.min(usage * POSE_CONFIG.usagePenalty, POSE_CONFIG.maxUsagePenalty);
            return distance + usagePenalty + rollPenalty + recentPenalty + loadPenalty;
        };
        const pickFromTopCandidates = (scoredCandidates) => {
            if (scoredCandidates.length === 0) {
                return metadata[0];
            }
            const poolSize = Math.min(scoredCandidates.length, POSE_CONFIG.candidatePoolSize);
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
            const currentStillCandidate = state.currentItem &&
                candidates.some((candidate) => candidate.file === state.currentItem?.file);
            if (inSameCell &&
                state.currentItem &&
                currentStillCandidate &&
                (candidates.length === 1 ||
                    nowMs() - state.lastSwitchAt <
                        POSE_CONFIG.sameCellMinSwitchIntervalMs ||
                    Math.random() >= POSE_CONFIG.sameCellExploreChance)) {
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
                const currentScore = scoreCandidate(state.currentItem, yaw, pitch, targetRoll, state);
                const scoreGain = currentScore - bestScore;
                const elapsedMs = nowMs() - state.lastSwitchAt;
                const holdForMargin = scoreGain < POSE_CONFIG.switchMargin;
                const holdForRate = elapsedMs < POSE_CONFIG.minSwitchIntervalMs &&
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
    const toAtlasTileTransformCss = (atlas) => `translate(${-atlas.column * 100}%, ${-atlas.row * 100}%) scale(${atlas.gridSize})`;
    const toTransformCss = (item) => item.atlas ? toAtlasTileTransformCss(item.atlas) : "none";
    const waitForImageReady = (image, token, state) => new Promise((resolve, reject) => {
        if (token !== state.token) {
            reject(new Error("stale request"));
            return;
        }
        if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
            resolve();
            return;
        }
        const onLoad = () => {
            cleanup();
            resolve();
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const cleanup = () => {
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
    const createFaceUpdater = (dom, state, poseIndex) => {
        const applyItemFrame = (item, variant) => {
            const transformCss = toTransformCss(item);
            dom.setImageTransform(transformCss);
            dom.setImageRendering(variant === "low" ? "pixelated" : "auto");
            state.lastTransform = transformCss;
            state.hasTransform = true;
            dom.renderMetadata(item);
        };
        const updateFace = async (yaw, pitch) => {
            const item = poseIndex.pickClosest(yaw, pitch, state);
            const nextResolved = resolveImageSource(item, state.loadedSources);
            const nextSource = nextResolved.source;
            if (dom.image &&
                dom.image.src === nextSource &&
                dom.image.naturalWidth > 0) {
                state.loadedSources.add(nextSource);
                applyItemFrame(item, nextResolved.variant);
                return;
            }
            if (state.hasTransform) {
                dom.setImageTransform(state.lastTransform);
            }
            const token = state.token + 1;
            state.token = token;
            state.currentItem = item;
            dom.setImageRendering(nextResolved.variant === "low" ? "pixelated" : "auto");
            dom.setImageSource(nextSource);
            if (!dom.image) {
                return;
            }
            try {
                await waitForImageReady(dom.image, token, state);
                if (typeof dom.image.decode === "function") {
                    try {
                        await dom.image.decode();
                    }
                    catch {
                        // Decode failures should not block rendering after image load.
                    }
                }
                if (token !== state.token) {
                    return;
                }
                state.loadedSources.add(nextSource);
                const bestResolved = resolveImageSource(item, state.loadedSources);
                applyItemFrame(item, bestResolved.variant);
            }
            catch {
                // Keep last good transform on load/decode failure.
            }
        };
        return { updateFace };
    };
    /**
     * Queue only the latest pose update per animation frame.
     */
    const createPoseCommandQueue = (state, updateFace) => {
        const flush = () => {
            state.rafId = 0;
            if (!state.pendingCommand) {
                return;
            }
            const command = state.pendingCommand;
            state.pendingCommand = null;
            void updateFace(command.yaw, command.pitch);
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
    const toPoseFromPointer = (event, rect, poseBounds) => {
        const safeWidth = rect.width || 1;
        const safeHeight = rect.height || 1;
        const x = clamp((event.clientX - rect.left) / safeWidth, 0, 1);
        const y = clamp((event.clientY - rect.top) / safeHeight, 0, 1);
        return {
            yaw: mapUnitToRange(x, poseBounds.minYaw, poseBounds.maxYaw),
            pitch: mapUnitToRange(y, poseBounds.minPitch, poseBounds.maxPitch),
        };
    };
    const pickInitialPose = (metadata, poseBounds) => {
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
    const initializeFacePose = async () => {
        const dom = createDomFacade();
        if (!dom.hasRequiredNodes) {
            return;
        }
        const state = createRuntimeState();
        state.phase = "loading";
        let metadata = [];
        try {
            metadata = await loadMetadata();
        }
        catch (error) {
            console.error("Failed to load metadata:", error);
            dom.setLoaderText("Error loading metadata.");
            state.phase = "error";
            return;
        }
        const preloadPlan = createPreloadPlan(metadata);
        if (PRELOAD_CONFIG.blockUntilComplete) {
            let lastProgressValue = -1;
            const preloadResult = await preloadImages(preloadPlan.blockingSources, PRELOAD_CONFIG.maxConcurrent, (summary) => {
                const progressValue = summary.loaded + summary.failed;
                if (progressValue === lastProgressValue) {
                    return;
                }
                lastProgressValue = progressValue;
                dom.setLoaderText(`Preloading images... ${progressValue}/${summary.total}`);
            }, (source) => {
                state.loadedSources.add(source);
            });
            if (preloadResult.failed > 0) {
                console.warn(`Image preload completed with ${preloadResult.failed} failed requests.`);
            }
        }
        const poseIndex = createPoseIndex(metadata);
        const poseBounds = derivePoseBounds(metadata);
        dom.hideLoader();
        dom.showImage();
        state.phase = "ready";
        const { updateFace } = createFaceUpdater(dom, state, poseIndex);
        const commandQueue = createPoseCommandQueue(state, updateFace);
        if (dom.container) {
            dom.container.addEventListener("mousemove", (event) => {
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
        if (preloadPlan.backgroundStages.length > 0) {
            const runBackgroundPreload = async () => {
                for (let stageIndex = 0; stageIndex < preloadPlan.backgroundStages.length; stageIndex += 1) {
                    const stageSources = preloadPlan.backgroundStages[stageIndex];
                    if (stageSources.length === 0) {
                        continue;
                    }
                    const summary = await preloadImages(stageSources, PRELOAD_CONFIG.backgroundMaxConcurrent, () => undefined, (source) => {
                        state.loadedSources.add(source);
                    });
                    if (summary.failed > 0) {
                        console.warn(`Background preload stage ${stageIndex + 1} completed with ${summary.failed} failed requests.`);
                    }
                    if (state.currentItem) {
                        void updateFace(state.currentItem.pose.yaw, state.currentItem.pose.pitch);
                    }
                }
            };
            void runBackgroundPreload();
        }
    };
    void initializeFacePose();
})();
