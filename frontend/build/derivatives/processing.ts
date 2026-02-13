import fs from "node:fs";
import path from "node:path";

import {
  OUTPUT_SIZE,
  buildRuntimeMetadata,
  computeCrop,
  getImageSize,
  isEyeRegionBlockBoundaryCritical,
} from "./crop";
import { errorMessage } from "./metadata-io";
import {
  CRITICAL_EYE_DERIVATIVE_WEBP_QUALITY,
  bakeAlignedDerivative,
  createBrowserRenderer,
  verifyAlignedDerivative,
} from "./renderer";
import type {
  BrowserRenderer,
  BuildOptions,
  ProcessStats,
  RuntimeTransform,
  SourceMetadataItem,
} from "./types";
import {
  INPUT_DIR,
  OUTPUT_IMAGE_DIR,
  resolvePathWithin,
  shouldRenderDerivative,
  toMirrorBaseRelativePath,
} from "./workflow";

const PROGRESS_LOG_INTERVAL = 25;
const ALIGNMENT_WARN_DEVIATION_PX = 2;

const IDENTITY_RUNTIME_TRANSFORM: RuntimeTransform = {
  translateXRatio: 0,
  translateYRatio: 0,
  rotateRad: 0,
  scale: 1,
};

/** Build runtime metadata and optionally rebake derivatives based on recrop mode. */
export const processSourceItems = async (
  sourceItems: SourceMetadataItem[],
  options: BuildOptions,
): Promise<ProcessStats> => {
  const runtimeItems = [] as ProcessStats["runtimeItems"];
  const missingSources: string[] = [];
  const skippedQuality: ProcessStats["skippedQuality"] = [];
  const missingOutputs: string[] = [];

  let renderedCount = 0;
  let reusedCount = 0;
  let skippedQualityCount = 0;
  let renderedSourceBytes = 0;
  let renderedOutputBytes = 0;
  let renderer: BrowserRenderer | undefined;

  const getRenderer = async (): Promise<BrowserRenderer> => {
    if (!renderer) {
      renderer = await createBrowserRenderer();
    }
    return renderer;
  };

  try {
    for (let index = 0; index < sourceItems.length; index += 1) {
      const item = sourceItems[index];
      const sourceFieldPath = `metadata[${index}].source`;
      const outputFieldPath = `metadata[${index}].file`;

      let sourcePath: string;
      let outputPath: string;
      let shouldFlopSource = false;
      let sourceFromProcessedFallback = false;

      try {
        sourcePath = resolvePathWithin(INPUT_DIR, item.source, sourceFieldPath);
        outputPath = resolvePathWithin(
          OUTPUT_IMAGE_DIR,
          item.file,
          outputFieldPath,
        );
      } catch (error) {
        throw new Error(errorMessage(error));
      }

      const mirrorBaseRelativePath = toMirrorBaseRelativePath(item.source);
      if (mirrorBaseRelativePath) {
        try {
          const mirrorBasePath = resolvePathWithin(
            INPUT_DIR,
            mirrorBaseRelativePath,
            sourceFieldPath,
          );
          if (fs.existsSync(mirrorBasePath)) {
            sourcePath = mirrorBasePath;
            shouldFlopSource = true;
          }
        } catch {
          // Keep original source path when mirror base cannot be resolved safely.
        }
      }

      if (!fs.existsSync(sourcePath)) {
        const processedFallbackPath = resolvePathWithin(
          OUTPUT_IMAGE_DIR,
          item.file,
          outputFieldPath,
        );
        if (fs.existsSync(processedFallbackPath)) {
          sourcePath = processedFallbackPath;
          sourceFromProcessedFallback = true;
          shouldFlopSource = false;
        } else {
          missingSources.push(item.source);
          if (options.verbose) {
            console.warn(`⚠️ Source image missing, skipped: ${sourcePath}`);
          }
          continue;
        }
      }

      const outputExists = fs.existsSync(outputPath);
      if (options.recropMode === "none" && !outputExists) {
        missingOutputs.push(item.file);
        continue;
      }

      const size = getImageSize(sourcePath);
      const crop = computeCrop(item, size);
      const runtimeMetadata = buildRuntimeMetadata(item, size, crop);

      // Post-crop validation: reject items with anomalous crop ratio
      // (crop box too large relative to the image -> torso/background visible).
      const cropRatio = crop.size / Math.max(size.width, size.height);
      if (cropRatio > 0.98 && runtimeMetadata.interocularDist < 0.12) {
        skippedQualityCount += 1;
        const reason =
          `crop covers ${(cropRatio * 100).toFixed(0)}% of source with tiny interocular dist ` +
          `${runtimeMetadata.interocularDist.toFixed(4)}`;
        skippedQuality.push({
          source: item.source,
          file: item.file,
          reason,
        });
        if (options.verbose) {
          console.warn(`⚠️ Skipped ${item.file}: ${reason}`);
        }
        continue;
      }

      const wantsRender = shouldRenderDerivative(
        options.recropMode,
        outputExists,
      );
      const sourceMatchesOutput =
        path.resolve(sourcePath) === path.resolve(outputPath);
      const canRender = wantsRender && !sourceMatchesOutput;

      if (canRender) {
        const requiresCriticalEyeQuality = isEyeRegionBlockBoundaryCritical(
          runtimeMetadata.features.eyes.l,
          runtimeMetadata.features.eyes.r,
          runtimeMetadata.transform,
          OUTPUT_SIZE,
          OUTPUT_SIZE,
        );
        const activeRenderer = await getRenderer();
        if (requiresCriticalEyeQuality) {
          await bakeAlignedDerivative(
            activeRenderer,
            sourcePath,
            outputPath,
            crop,
            runtimeMetadata.transform,
            CRITICAL_EYE_DERIVATIVE_WEBP_QUALITY,
            shouldFlopSource,
          );
        } else {
          await bakeAlignedDerivative(
            activeRenderer,
            sourcePath,
            outputPath,
            crop,
            runtimeMetadata.transform,
            undefined,
            shouldFlopSource,
          );
        }
        const verification = verifyAlignedDerivative(
          outputPath,
          runtimeMetadata.features.eyes.l,
          runtimeMetadata.features.eyes.r,
          runtimeMetadata.transform,
        );
        runtimeMetadata.alignmentScore = verification.alignmentScore;
        if (verification.deviationPx > ALIGNMENT_WARN_DEVIATION_PX) {
          console.warn(
            `⚠️ Alignment deviation > ${ALIGNMENT_WARN_DEVIATION_PX}px for ${item.file}: ` +
              `${verification.deviationPx.toFixed(3)}px (target ${verification.targetPx.x},${verification.targetPx.y}; ` +
              `actual ${verification.midpointPx.x},${verification.midpointPx.y})`,
          );
        }
        renderedCount += 1;
        renderedSourceBytes += fs.statSync(sourcePath).size;
        renderedOutputBytes += fs.statSync(outputPath).size;
      } else {
        if (
          wantsRender &&
          sourceMatchesOutput &&
          options.verbose &&
          !sourceFromProcessedFallback
        ) {
          console.warn(
            `⚠️ Skipped recrop for ${item.file} because source and output paths are identical.`,
          );
        }
        reusedCount += 1;
      }

      if (!fs.existsSync(outputPath)) {
        missingOutputs.push(item.file);
        continue;
      }

      runtimeItems.push({
        ...runtimeMetadata,
        transform: IDENTITY_RUNTIME_TRANSFORM,
      });

      if (options.verbose && (index + 1) % PROGRESS_LOG_INTERVAL === 0) {
        console.log(`⏱️ Derivatives: ${index + 1}/${sourceItems.length}`);
      }
    }
  } finally {
    if (renderer !== undefined) {
      await renderer.close();
    }
  }

  if (skippedQualityCount > 0) {
    console.log(
      `🔬 Post-crop quality filter: skipped ${skippedQualityCount} item(s) with anomalous crop/size`,
    );
  }

  return {
    runtimeItems,
    renderedCount,
    reusedCount,
    missingSources,
    skippedQuality,
    missingOutputs,
    renderedSourceBytes,
    renderedOutputBytes,
  };
};
