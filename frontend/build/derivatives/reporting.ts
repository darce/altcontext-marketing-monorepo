import fs from "node:fs";
import path from "node:path";

import type {
  AtlasBuildStats,
  PoseBounds,
  ProcessStats,
  QualityRejection,
  RecropMode,
} from "./types";
import {
  POSE_COVERAGE_CELL_STEP,
  POSE_COVERAGE_MIN_ITEMS_PER_CELL,
} from "./pose-bounds";
import { INPUT_DIR, OUTPUT_IMAGE_DIR, ensureDir } from "./workflow";

export const logPoseCoverageGaps = (
  runtimeItems: ProcessStats["runtimeItems"],
  verbose: boolean,
): void => {
  if (runtimeItems.length === 0) {
    return;
  }

  let minYawCell = Infinity;
  let maxYawCell = -Infinity;
  let minPitchCell = Infinity;
  let maxPitchCell = -Infinity;
  const coverageByCell = new Map<string, number>();

  for (const item of runtimeItems) {
    const yawCell = Math.round(item.pose.yaw / POSE_COVERAGE_CELL_STEP);
    const pitchCell = Math.round(item.pose.pitch / POSE_COVERAGE_CELL_STEP);
    const cellKey = `${yawCell}:${pitchCell}`;
    coverageByCell.set(cellKey, (coverageByCell.get(cellKey) ?? 0) + 1);
    minYawCell = Math.min(minYawCell, yawCell);
    maxYawCell = Math.max(maxYawCell, yawCell);
    minPitchCell = Math.min(minPitchCell, pitchCell);
    maxPitchCell = Math.max(maxPitchCell, pitchCell);
  }

  let totalCells = 0;
  let coveredCells = 0;
  let denseCells = 0;
  const missingLabels: string[] = [];
  for (let yawCell = minYawCell; yawCell <= maxYawCell; yawCell += 1) {
    for (
      let pitchCell = minPitchCell;
      pitchCell <= maxPitchCell;
      pitchCell += 1
    ) {
      totalCells += 1;
      const key = `${yawCell}:${pitchCell}`;
      const count = coverageByCell.get(key) ?? 0;
      if (count > 0) {
        coveredCells += 1;
      } else {
        missingLabels.push(
          `${yawCell * POSE_COVERAGE_CELL_STEP},${pitchCell * POSE_COVERAGE_CELL_STEP}`,
        );
      }
      if (count >= POSE_COVERAGE_MIN_ITEMS_PER_CELL) {
        denseCells += 1;
      }
    }
  }

  const missingCells = totalCells - coveredCells;
  console.log(
    `📐 Pose coverage (${POSE_COVERAGE_CELL_STEP}° cells): ` +
      `covered=${coveredCells}/${totalCells}, dense(>=${POSE_COVERAGE_MIN_ITEMS_PER_CELL})=${denseCells}, missing=${missingCells}`,
  );

  if (verbose && missingLabels.length > 0) {
    const sample = missingLabels.slice(0, 16).join(" | ");
    console.log(
      `📍 Missing cell centers (yaw,pitch): ${sample}${missingLabels.length > 16 ? " | ..." : ""}`,
    );
  }
};

/** Log a concise summary describing what was generated and/or reused. */
export const logOutcome = (
  sourceCount: number,
  stats: ProcessStats,
  mode: RecropMode,
  atlasStats: AtlasBuildStats,
  runtimeMetadataFile: string,
  poseBoundsFile: string,
  poseBounds: PoseBounds,
  atlasOutputDir: string,
): void => {
  if (mode === "none") {
    console.log(
      `✅ Wrote runtime metadata for ${stats.runtimeItems.length}/${sourceCount} derivatives to ${runtimeMetadataFile}`,
    );
    console.log(`♻️ Reused existing derivatives: ${stats.reusedCount}`);
  } else if (mode === "missing") {
    console.log(
      `✅ Wrote runtime metadata for ${stats.runtimeItems.length} derivatives to ${runtimeMetadataFile}`,
    );
    console.log(
      `✂️ Recropped missing derivatives: ${stats.renderedCount}; reused existing: ${stats.reusedCount}`,
    );
  } else {
    console.log(
      `✅ Recropped ${stats.renderedCount} derivatives and wrote ${runtimeMetadataFile}`,
    );
  }

  if (stats.renderedCount > 0) {
    const ratio =
      stats.renderedSourceBytes > 0
        ? (stats.renderedOutputBytes / stats.renderedSourceBytes) * 100
        : 0;

    console.log(
      `📉 Recrop bytes: ${(stats.renderedOutputBytes / 1024 / 1024).toFixed(2)} MB ` +
        `from ${(stats.renderedSourceBytes / 1024 / 1024).toFixed(2)} MB (${ratio.toFixed(1)}%)`,
    );
  }

  const atlasRatio =
    atlasStats.sourceBytes > 0
      ? (atlasStats.atlasBytes / atlasStats.sourceBytes) * 100
      : 0;
  console.log(
    `🗂️ Atlas output (${atlasOutputDir}): ${atlasStats.atlasCount} file(s), ${atlasStats.tileCount} faces, ` +
      `${(atlasStats.atlasBytes / 1024 / 1024).toFixed(2)} MB from ${(atlasStats.sourceBytes / 1024 / 1024).toFixed(2)} MB (${atlasRatio.toFixed(1)}%)`,
  );
  console.log(
    `🧭 Pose bounds (${poseBoundsFile}): yaw ${poseBounds.minYaw}..${poseBounds.maxYaw}, ` +
      `pitch ${poseBounds.minPitch}..${poseBounds.maxPitch}`,
  );
};

export const reportMissingOutputs = (missingOutputs: string[]): void => {
  const sample = missingOutputs.slice(0, 10).join(", ");
  const suffix = missingOutputs.length > 10 ? ", ..." : "";

  console.error(
    `❌ ${missingOutputs.length} derivative image(s) are missing under ${OUTPUT_IMAGE_DIR}.`,
  );
  console.error(`❌ Missing files: ${sample}${suffix}`);
  console.error(
    "💡 Run `npm run build:derivatives:recrop:missing` (or `npm run build:derivatives -- --recrop=missing`).",
  );
};

export const reportMissingSources = (missingSources: string[]): void => {
  const sample = missingSources.slice(0, 10).join(", ");
  const suffix = missingSources.length > 10 ? ", ..." : "";
  console.warn(
    `⚠️ Skipped ${missingSources.length} metadata item(s) because source images were missing in ${INPUT_DIR}.`,
  );
  console.warn(`⚠️ Missing sources: ${sample}${suffix}`);
};

export const writeAtlasUnusableReport = (
  outputFile: string,
  qualityGateRejected: QualityRejection[],
  stats: ProcessStats,
): void => {
  const deletionCandidates = Array.from(
    new Set(
      [...qualityGateRejected, ...stats.skippedQuality]
        .map((entry) => entry.source)
        .filter(Boolean),
    ),
  ).sort();

  const payload = {
    qualityGateRejectedCount: qualityGateRejected.length,
    postCropRejectedCount: stats.skippedQuality.length,
    missingSourceCount: stats.missingSources.length,
    missingDerivativeOutputCount: stats.missingOutputs.length,
    deletionCandidateCount: deletionCandidates.length,
    deletionCandidates,
    qualityGateRejected,
    postCropRejected: stats.skippedQuality,
    missingSources: stats.missingSources,
    missingDerivativeOutputs: stats.missingOutputs,
  };

  ensureDir(path.dirname(outputFile));
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`🧾 Atlas unusable report written to ${outputFile}`);
};
