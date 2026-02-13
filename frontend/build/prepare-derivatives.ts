import fs from "node:fs";
import process from "node:process";

import {
  attachAtlasPlacements,
  buildAtlases,
  buildPreloadTierByFile,
  logPreloadTierSummary,
} from "./derivatives/atlas";
import { getBuildOptions } from "./derivatives/cli";
import {
  errorMessage,
  parseSourceMetadata,
  writeRuntimeMetadata,
} from "./derivatives/metadata-io";
import { derivePoseBoundsFromRuntime, writePoseBounds } from "./derivatives/pose-bounds";
import { processSourceItems } from "./derivatives/processing";
import {
  logOutcome,
  logPoseCoverageGaps,
  reportMissingOutputs,
  reportMissingSources,
  writeAtlasUnusableReport,
} from "./derivatives/reporting";
import {
  applyConditionalMirrorSelection,
  applyQualityGate,
  logSelection,
  selectSourceItems,
} from "./derivatives/selection";
import {
  DERIVATIVE_LAYOUT_VERSION,
  OUTPUT_IMAGE_DIR,
  SOURCE_METADATA_FILE,
  getOutputTargets,
  isFullSelection,
  prepareOutputDirectory,
  readLayoutVersionStamp,
  shouldWriteLayoutVersionStamp,
  writeLayoutVersionStamp,
} from "./derivatives/workflow";
import type { BuildOptions, SourceMetadataItem } from "./derivatives/types";

const main = async (): Promise<void> => {
  let options: BuildOptions;
  try {
    options = getBuildOptions();
  } catch (error) {
    console.error(`❌ ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(SOURCE_METADATA_FILE)) {
    console.error(`❌ ${SOURCE_METADATA_FILE} not found. Run build:metadata first.`);
    process.exitCode = 1;
    return;
  }

  let sourceItems: SourceMetadataItem[];
  try {
    const rawMetadata = fs.readFileSync(SOURCE_METADATA_FILE, "utf8");
    sourceItems = parseSourceMetadata(rawMetadata, SOURCE_METADATA_FILE);
  } catch (error) {
    console.error(`❌ ${errorMessage(error)}`);
    process.exitCode = 1;
    return;
  }

  const qualityGate = applyQualityGate(sourceItems, options.verbose);
  const selectedSubset = selectSourceItems(qualityGate.accepted, options);
  const selectedItems = applyConditionalMirrorSelection(
    selectedSubset,
    options.verbose,
  );
  if (selectedItems.length === 0) {
    console.error("❌ No source metadata entries selected after subset/limit filtering.");
    process.exitCode = 1;
    return;
  }

  logSelection(selectedItems, options);

  const existingLayoutVersion = readLayoutVersionStamp();
  if (
    existingLayoutVersion !== DERIVATIVE_LAYOUT_VERSION &&
    options.recropMode !== "all"
  ) {
    const foundVersion = existingLayoutVersion ?? "missing";
    console.error(
      `❌ Derivative layout version is "${foundVersion}" but "${DERIVATIVE_LAYOUT_VERSION}" is required.`,
    );
    console.error(
      "💡 Run `npm run build:data:derive:recrop` once to rebake aligned derivatives.",
    );
    process.exitCode = 1;
    return;
  }

  try {
    const outputTargets = getOutputTargets(options);
    prepareOutputDirectory(options);
    const stats = await processSourceItems(selectedItems, options);
    writeAtlasUnusableReport(
      outputTargets.unusableReportFile,
      qualityGate.rejected,
      stats,
    );
    if (stats.missingSources.length > 0) {
      reportMissingSources(stats.missingSources);
    }
    logPoseCoverageGaps(stats.runtimeItems, options.verbose);

    if (stats.missingOutputs.length > 0) {
      reportMissingOutputs(stats.missingOutputs);
      process.exitCode = 1;
      return;
    }

    const tierByFile = buildPreloadTierByFile(stats.runtimeItems);
    logPreloadTierSummary(tierByFile, options.verbose);
    const atlasBuild = buildAtlases(
      stats.runtimeItems,
      tierByFile,
      options.verbose,
      outputTargets.atlasOutputDir,
      OUTPUT_IMAGE_DIR,
    );
    const runtimeWithAtlas = attachAtlasPlacements(
      stats.runtimeItems,
      atlasBuild.placementsByFile,
      tierByFile,
    );
    const poseBounds = derivePoseBoundsFromRuntime(runtimeWithAtlas);

    writeRuntimeMetadata(outputTargets.runtimeMetadataFile, runtimeWithAtlas);
    writePoseBounds(outputTargets.poseBoundsFile, poseBounds);
    if (!isFullSelection(options)) {
      console.log(
        `ℹ️ Subset build isolated outputs to ${outputTargets.runtimeMetadataFile}, ${outputTargets.poseBoundsFile}, and ${outputTargets.atlasOutputDir}.`,
      );
    }
    if (shouldWriteLayoutVersionStamp(options)) {
      writeLayoutVersionStamp();
    } else if (options.verbose && options.recropMode === "all") {
      console.log(
        "ℹ️ Skipped layout stamp update because recrop was limited by subset/limit flags.",
      );
    }
    logOutcome(
      selectedItems.length,
      stats,
      options.recropMode,
      atlasBuild.stats,
      outputTargets.runtimeMetadataFile,
      outputTargets.poseBoundsFile,
      poseBounds,
      outputTargets.atlasOutputDir,
    );
  } catch (error) {
    console.error(`❌ Failed to prepare derivatives: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`Fatal error preparing derivatives: ${errorMessage(error)}`);
  process.exitCode = 1;
});
