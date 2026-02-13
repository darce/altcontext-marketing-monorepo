import path from "node:path";

import { normalizeSubsetToken } from "./cli";
import { sortSourceItems } from "./metadata-io";
import type {
  BuildOptions,
  QualityRejection,
  SourceMetadataItem,
} from "./types";
import { MIRROR_SUFFIX } from "./workflow";

const MIN_LANDMARK_CONFIDENCE = 0.75;
const MIN_INTEROCULAR_DIST = 0.08;
const MAX_INTEROCULAR_DIST = 0.65;
const POSE_COVERAGE_CELL_STEP = 5;
const MIRROR_MIN_ITEMS_PER_CELL = 3;

export interface QualityGateResult {
  accepted: SourceMetadataItem[];
  rejected: QualityRejection[];
}

const isZeroPose = (pose: {
  yaw: number;
  pitch: number;
  roll: number;
}): boolean => pose.yaw === 0 && pose.pitch === 0 && pose.roll === 0;

const matchesSubsetPrefix = (fileName: string, prefixes: string[]): boolean => {
  if (prefixes.length === 0) {
    return true;
  }

  const stem = path.basename(fileName, path.extname(fileName));
  const normalizedStem = normalizeSubsetToken(stem);
  return prefixes.some((prefix) => normalizedStem.startsWith(prefix));
};

const isMirrorFile = (fileName: string): boolean => {
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  return stem.endsWith(MIRROR_SUFFIX);
};

const toCoverageCellKey = (
  yaw: number,
  pitch: number,
  step: number,
): string => {
  const yawCell = Math.round(yaw / step);
  const pitchCell = Math.round(pitch / step);
  return `${yawCell}:${pitchCell}`;
};

/**
 * Reject source items whose landmark data is unreliable.
 * Items with low confidence, zero-pose defaults, or anomalous interocular
 * distance produce bad crops, wrong rotations, and "not-a-face" tiles.
 */
export const applyQualityGate = (
  sourceItems: SourceMetadataItem[],
  verbose: boolean,
): QualityGateResult => {
  const rejected: QualityRejection[] = [];

  const accepted = sourceItems.filter((item) => {
    if (item.landmarkConfidence < MIN_LANDMARK_CONFIDENCE) {
      rejected.push({
        source: item.source,
        file: item.file,
        reason: `low confidence ${item.landmarkConfidence}`,
      });
      return false;
    }

    if (isZeroPose(item.pose)) {
      rejected.push({
        source: item.source,
        file: item.file,
        reason: "zero pose (0,0,0)",
      });
      return false;
    }

    const eyeL = item.features.eyes.l;
    const eyeR = item.features.eyes.r;
    const dx = eyeR.x - eyeL.x;
    const dy = eyeR.y - eyeL.y;
    const interocDist = Math.sqrt(dx * dx + dy * dy);
    if (
      interocDist < MIN_INTEROCULAR_DIST ||
      interocDist > MAX_INTEROCULAR_DIST
    ) {
      rejected.push({
        source: item.source,
        file: item.file,
        reason: `interocular dist ${interocDist.toFixed(4)} out of range`,
      });
      return false;
    }

    return true;
  });

  if (rejected.length > 0) {
    console.log(
      `🚫 Quality gate: rejected ${rejected.length}/${sourceItems.length} item(s)`,
    );
    if (verbose) {
      const sample = rejected.slice(0, 16);
      for (const entry of sample) {
        console.log(`   ↳ ${entry.file}: ${entry.reason}`);
      }
      if (rejected.length > 16) {
        console.log(`   ↳ ... and ${rejected.length - 16} more`);
      }
    }
  }

  return { accepted, rejected };
};

/** Filter metadata entries for subset and limit options. */
export const selectSourceItems = (
  sourceItems: SourceMetadataItem[],
  options: BuildOptions,
): SourceMetadataItem[] => {
  let selected = sortSourceItems(sourceItems);

  if (options.subsetPrefixes.length > 0) {
    selected = selected.filter((item) =>
      matchesSubsetPrefix(item.file, options.subsetPrefixes),
    );
  }

  if (options.limit > 0) {
    selected = selected.slice(0, options.limit);
  }

  return selected;
};

export const applyConditionalMirrorSelection = (
  sourceItems: SourceMetadataItem[],
  verbose: boolean,
): SourceMetadataItem[] => {
  const denseByCell = new Map<string, number>();
  for (const item of sourceItems) {
    if (isMirrorFile(item.file)) {
      continue;
    }
    const key = toCoverageCellKey(
      item.pose.yaw,
      item.pose.pitch,
      POSE_COVERAGE_CELL_STEP,
    );
    denseByCell.set(key, (denseByCell.get(key) ?? 0) + 1);
  }

  let skippedMirrorCount = 0;
  const selected = sourceItems.filter((item) => {
    if (!isMirrorFile(item.file)) {
      return true;
    }

    const mirroredCoverageKey = toCoverageCellKey(
      -item.pose.yaw,
      item.pose.pitch,
      POSE_COVERAGE_CELL_STEP,
    );
    const mirrorCellDensity = denseByCell.get(mirroredCoverageKey) ?? 0;
    if (mirrorCellDensity < MIRROR_MIN_ITEMS_PER_CELL) {
      denseByCell.set(mirroredCoverageKey, mirrorCellDensity + 1);
      return true;
    }
    skippedMirrorCount += 1;
    return false;
  });

  if (verbose && skippedMirrorCount > 0) {
    console.log(
      `🪞 Skipped ${skippedMirrorCount} mirror item(s) for dense cells (>=${MIRROR_MIN_ITEMS_PER_CELL} items per ${POSE_COVERAGE_CELL_STEP}° cell).`,
    );
  }

  return selected;
};

export const logSelection = (
  sourceItems: SourceMetadataItem[],
  options: BuildOptions,
): void => {
  if (!options.verbose) {
    return;
  }

  console.log(`🧪 Derivative input entries: ${sourceItems.length}`);
  console.log(`⚙️ Recrop mode: ${options.recropMode}`);

  if (options.subsetPrefixes.length > 0) {
    console.log(`🔎 Subset prefixes: ${options.subsetPrefixes.join(", ")}`);
  }
  if (options.limit > 0) {
    console.log(`🔢 Limit: ${options.limit}`);
  }

  if (sourceItems.length > 0) {
    const sample = sourceItems
      .slice(0, 8)
      .map((item) => item.file)
      .join(", ");
    console.log(
      `🧷 Sample derivatives: ${sample}${sourceItems.length > 8 ? ", ..." : ""}`,
    );
  }
};
