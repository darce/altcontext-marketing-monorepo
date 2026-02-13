import fs from "node:fs";
import process from "node:process";

import {
  collectImageFiles,
  createExtractionState,
  logSelection,
  processImageFile,
  writeExtractionOutputs,
} from "./extract-metadata/pipeline";
import { INPUT_DIR } from "./extract-metadata/constants";
import { getLimit, getSubsetPrefixes, getVerbose, normalizeSubsetToken } from "./derivatives/cli";

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const main = async (): Promise<void> => {
  const verbose = getVerbose();
  const subsetPrefixes = getSubsetPrefixes();
  const limit = getLimit();

  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory ${INPUT_DIR} not found.`);
    process.exitCode = 1;
    return;
  }

  const imageFiles = collectImageFiles(
    INPUT_DIR,
    subsetPrefixes,
    limit,
    normalizeSubsetToken,
  );
  const state = createExtractionState();

  logSelection(verbose, imageFiles, subsetPrefixes, limit);

  try {
    for (const filePath of imageFiles) {
      processImageFile(filePath, verbose, state);
    }

    writeExtractionOutputs(imageFiles, state);

    if (verbose) {
      console.log(`📊 Missing by reason: ${JSON.stringify(state.byReason)}`);
    }
  } catch (error) {
    console.error(`❌ ${toErrorMessage(error)}`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(`Fatal error: ${toErrorMessage(error)}`);
  process.exitCode = 1;
});
