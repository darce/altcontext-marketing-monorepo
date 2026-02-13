import { POSE_CONFIG } from "./config";
import { toVariantSource, toSingleSource } from "./preload";
import type { MetadataItem, PoseIndex, RuntimeState } from "./types";

const nowMs = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const toBucketIndex = (value: number, step: number): number =>
  Math.round(value / step);

const toPoseCellKey = (yaw: number, pitch: number, cellStep: number): string =>
  `${Math.round(yaw / cellStep)}:${Math.round(pitch / cellStep)}`;

const clampConfidence = (value: number): number =>
  Math.max(0, Math.min(1, value));

const resolveLoadedCandidateSource = (
  candidate: MetadataItem,
  loadedSources: Set<string>,
): string => {
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

/**
 * Build a pose bucket index for fast nearest-image lookup with jitter damping.
 */
export const createPoseIndex = (metadata: MetadataItem[]): PoseIndex => {
  const buckets = new Map<string, MetadataItem[]>();

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
      const leftDist =
        (left.pose.yaw - centerYaw) ** 2 + (left.pose.pitch - centerPitch) ** 2;
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
      const distance = yawDistance * yawDistance + pitchDistance * pitchDistance;
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

  const scoreCandidate = (
    candidate: MetadataItem,
    yaw: number,
    pitch: number,
    targetRoll: number | null,
    state: RuntimeState,
  ): number => {
    const source = resolveLoadedCandidateSource(candidate, state.loadedSources);
    const yawDistance = candidate.pose.yaw - yaw;
    const pitchDistance = candidate.pose.pitch - pitch;
    const distance = yawDistance * yawDistance + pitchDistance * pitchDistance;
    const rollPenalty =
      targetRoll === null
        ? 0
        : (candidate.pose.roll - targetRoll) *
          (candidate.pose.roll - targetRoll) *
          POSE_CONFIG.rollPenalty;
    const confidencePenalty =
      (1 - clampConfidence(candidate.landmarkConfidence)) ** 2 *
      POSE_CONFIG.landmarkConfidencePenalty;
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
      return distance + rollPenalty + confidencePenalty + recentPenalty + loadPenalty;
    }
    const usagePenalty = Math.min(
      usage * POSE_CONFIG.usagePenalty,
      POSE_CONFIG.maxUsagePenalty,
    );
    return (
      distance +
      usagePenalty +
      rollPenalty +
      confidencePenalty +
      recentPenalty +
      loadPenalty
    );
  };

  const pickFromTopCandidates = (
    scoredCandidates: { candidate: MetadataItem; score: number }[],
  ): MetadataItem => {
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

  const pickClosest = (yaw: number, pitch: number, state: RuntimeState): MetadataItem => {
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
        nowMs() - state.lastSwitchAt < POSE_CONFIG.sameCellMinSwitchIntervalMs ||
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
      const dynamicMinSwitchIntervalMs =
        POSE_CONFIG.minSwitchIntervalMs +
        Math.min(
          POSE_CONFIG.maxVelocitySwitchIntervalBoostMs,
          state.pointerVelocityDegPerMs * POSE_CONFIG.velocityIntervalBoostFactor,
        );
      const holdForMargin = scoreGain < POSE_CONFIG.switchMargin;
      const holdForRate =
        elapsedMs < dynamicMinSwitchIntervalMs && scoreGain < POSE_CONFIG.fastSwitchMargin;
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
