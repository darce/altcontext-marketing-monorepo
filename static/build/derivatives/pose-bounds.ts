import fs from "node:fs";
import path from "node:path";

import type { PoseBounds, ProcessStats } from "./types";
import { ensureDir } from "./workflow";

export const POSE_COVERAGE_CELL_STEP = 5;
export const POSE_COVERAGE_MIN_ITEMS_PER_CELL = 2;

const DEFAULT_MAX_ABS_YAW = 75;
const DEFAULT_MAX_ABS_PITCH = 50;
const MAX_ABS_YAW = 120;
const MAX_ABS_PITCH = 90;
const MIN_POSE_SPAN = 20;
const POSE_BOUNDS_PADDING_RATIO = 0;

const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Derive interactive pose bounds from generated runtime metadata coverage.
 * Dense-cell clamping keeps pointer mapping inside reliable regions.
 */
export const derivePoseBoundsFromRuntime = (
  runtimeItems: ProcessStats["runtimeItems"],
): PoseBounds => {
  const defaults: PoseBounds = {
    minYaw: -DEFAULT_MAX_ABS_YAW,
    maxYaw: DEFAULT_MAX_ABS_YAW,
    minPitch: -DEFAULT_MAX_ABS_PITCH,
    maxPitch: DEFAULT_MAX_ABS_PITCH,
  };

  if (runtimeItems.length === 0) {
    return defaults;
  }

  let minYaw = Infinity;
  let maxYaw = -Infinity;
  let minPitch = Infinity;
  let maxPitch = -Infinity;
  const cellCounts = new Map<
    string,
    { yawCell: number; pitchCell: number; count: number }
  >();

  for (const item of runtimeItems) {
    minYaw = Math.min(minYaw, item.pose.yaw);
    maxYaw = Math.max(maxYaw, item.pose.yaw);
    minPitch = Math.min(minPitch, item.pose.pitch);
    maxPitch = Math.max(maxPitch, item.pose.pitch);

    const yawCell = Math.round(item.pose.yaw / POSE_COVERAGE_CELL_STEP);
    const pitchCell = Math.round(item.pose.pitch / POSE_COVERAGE_CELL_STEP);
    const key = `${yawCell}:${pitchCell}`;
    const existing = cellCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      cellCounts.set(key, { yawCell, pitchCell, count: 1 });
    }
  }

  if (
    !Number.isFinite(minYaw) ||
    !Number.isFinite(maxYaw) ||
    !Number.isFinite(minPitch) ||
    !Number.isFinite(maxPitch)
  ) {
    return defaults;
  }

  minYaw = clampNumber(minYaw, -MAX_ABS_YAW, MAX_ABS_YAW);
  maxYaw = clampNumber(maxYaw, -MAX_ABS_YAW, MAX_ABS_YAW);
  minPitch = clampNumber(minPitch, -MAX_ABS_PITCH, MAX_ABS_PITCH);
  maxPitch = clampNumber(maxPitch, -MAX_ABS_PITCH, MAX_ABS_PITCH);

  const denseCells = Array.from(cellCounts.values()).filter(
    (cell) => cell.count >= POSE_COVERAGE_MIN_ITEMS_PER_CELL,
  );
  if (denseCells.length > 0) {
    let denseMinYaw = Infinity;
    let denseMaxYaw = -Infinity;
    let denseMinPitch = Infinity;
    let denseMaxPitch = -Infinity;

    for (const cell of denseCells) {
      const denseYaw = cell.yawCell * POSE_COVERAGE_CELL_STEP;
      const densePitch = cell.pitchCell * POSE_COVERAGE_CELL_STEP;
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
      minYaw = clampNumber(denseMinYaw, -MAX_ABS_YAW, MAX_ABS_YAW);
      maxYaw = clampNumber(denseMaxYaw, -MAX_ABS_YAW, MAX_ABS_YAW);
      minPitch = clampNumber(denseMinPitch, -MAX_ABS_PITCH, MAX_ABS_PITCH);
      maxPitch = clampNumber(denseMaxPitch, -MAX_ABS_PITCH, MAX_ABS_PITCH);
    }
  }

  if (maxYaw - minYaw < MIN_POSE_SPAN) {
    minYaw = defaults.minYaw;
    maxYaw = defaults.maxYaw;
  }
  if (maxPitch - minPitch < MIN_POSE_SPAN) {
    minPitch = defaults.minPitch;
    maxPitch = defaults.maxPitch;
  }

  const yawPad = (maxYaw - minYaw) * POSE_BOUNDS_PADDING_RATIO;
  const pitchPad = (maxPitch - minPitch) * POSE_BOUNDS_PADDING_RATIO;

  return {
    minYaw: clampNumber(minYaw - yawPad, -MAX_ABS_YAW, MAX_ABS_YAW),
    maxYaw: clampNumber(maxYaw + yawPad, -MAX_ABS_YAW, MAX_ABS_YAW),
    minPitch: clampNumber(minPitch - pitchPad, -MAX_ABS_PITCH, MAX_ABS_PITCH),
    maxPitch: clampNumber(maxPitch + pitchPad, -MAX_ABS_PITCH, MAX_ABS_PITCH),
  };
};

export const writePoseBounds = (
  outputFile: string,
  poseBounds: PoseBounds,
): void => {
  ensureDir(path.dirname(outputFile));
  fs.writeFileSync(outputFile, JSON.stringify(poseBounds), "utf8");
};
