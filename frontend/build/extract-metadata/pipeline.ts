import fs from "node:fs";
import path from "node:path";

import { INPUT_DIR, REPORT_FILE, SOURCE_METADATA_FILE } from "./constants";
import type { ExtractionState, SourceMetadata } from "./types";
import { extractXmp, parseXmp } from "./xmp";

export const getAllFiles = (dir: string): string[] => {
  let results: string[] = [];
  if (!fs.existsSync(dir)) {
    return results;
  }

  const list = fs.readdirSync(dir).sort();
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }

  return results;
};

const matchesSubsetPrefix = (
  filePath: string,
  prefixes: string[],
  normalizeSubsetToken: (value: string) => string,
): boolean => {
  if (prefixes.length === 0) {
    return true;
  }

  const stem = path.basename(filePath, path.extname(filePath));
  const normalizedStem = normalizeSubsetToken(stem);
  return prefixes.some((prefix) => normalizedStem.startsWith(prefix));
};

const titleCaseWord = (word: string): string => {
  if (!word) {
    return "";
  }
  return word[0].toUpperCase() + word.slice(1);
};

/** Infer a display name from a filename like first_last_12.jpg. */
export const inferPersonName = (
  relativeInputPath: string,
): string | undefined => {
  const baseName = path.basename(
    relativeInputPath,
    path.extname(relativeInputPath),
  );
  const stripped = baseName.replace(/_\d+$/i, "");
  const parts = stripped.split("_").filter(Boolean);

  if (parts.length < 2) {
    return titleCaseWord(parts[0] ?? "");
  }

  const first = titleCaseWord(parts.shift() ?? "");
  const last = parts.map(titleCaseWord).join(" ");
  const name = `${first}${last ? ` ${last}` : ""}`.trim();
  return name || undefined;
};

/** Select candidate image files using subset and limit options. */
export const collectImageFiles = (
  inputDir: string,
  subsetPrefixes: string[],
  limit: number,
  normalizeSubsetToken: (value: string) => string,
): string[] => {
  const allFiles = getAllFiles(inputDir);
  let imageFiles = allFiles
    .filter((file) => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))
    .sort();

  if (subsetPrefixes.length > 0) {
    imageFiles = imageFiles.filter((filePath) =>
      matchesSubsetPrefix(filePath, subsetPrefixes, normalizeSubsetToken),
    );
  }

  if (limit > 0) {
    imageFiles = imageFiles.slice(0, limit);
  }

  return imageFiles;
};

export const createExtractionState = (): ExtractionState => {
  return {
    metadataList: [],
    missingMetadata: [],
    byReason: {
      no_xmp_header: 0,
      no_xmp_start: 0,
      no_xmp_end: 0,
      missing_required_fields: 0,
    },
    duplicateOutputNames: new Map<string, string>(),
  };
};

export const logSelection = (
  verbose: boolean,
  imageFiles: string[],
  subsetPrefixes: string[],
  limit: number,
): void => {
  if (!verbose) {
    return;
  }

  console.log(`📂 Processing ${imageFiles.length} images...`);
  if (subsetPrefixes.length > 0) {
    console.log(`🔎 Subset prefixes: ${subsetPrefixes.join(", ")}`);
  }
  if (limit > 0) {
    console.log(`🔢 Limit: ${limit}`);
  }
  if (imageFiles.length > 0) {
    const sample = imageFiles
      .slice(0, 8)
      .map((file) => path.basename(file))
      .join(", ");
    console.log(
      `🧷 Sample files: ${sample}${imageFiles.length > 8 ? ", ..." : ""}`,
    );
  }
};

/** Parse one image and append either metadata or a deterministic missing reason. */
export const processImageFile = (
  filePath: string,
  verbose: boolean,
  state: ExtractionState,
): void => {
  const buffer = fs.readFileSync(filePath);
  const relativeInputPath = path
    .relative(INPUT_DIR, filePath)
    .split(path.sep)
    .join("/");
  const xmpResult = extractXmp(buffer);

  if (!xmpResult.xmp) {
    const reason = xmpResult.reason ?? "no_xmp_header";
    state.missingMetadata.push({ file: relativeInputPath, reason });
    state.byReason[reason] += 1;

    if (verbose) {
      console.warn(`⚠️ Missing XMP in ${path.basename(filePath)} (${reason})`);
    }
    return;
  }

  const parsed = parseXmp(xmpResult.xmp);
  if (!parsed.data) {
    state.missingMetadata.push({
      file: relativeInputPath,
      reason: "missing_required_fields",
      missingFields: parsed.missingFields,
    });
    state.byReason.missing_required_fields += 1;

    if (verbose) {
      console.warn(
        `⚠️ Missing required metadata fields in ${path.basename(filePath)}: ${parsed.missingFields.join(", ")}`,
      );
    }
    return;
  }

  const outputFileName = `${path.basename(filePath, path.extname(filePath))}.webp`;
  const existing = state.duplicateOutputNames.get(outputFileName);
  if (existing && existing !== relativeInputPath) {
    throw new Error(
      `Duplicate output filename "${outputFileName}" from "${existing}" and "${relativeInputPath}".`,
    );
  }
  state.duplicateOutputNames.set(outputFileName, relativeInputPath);

  const inferredName = inferPersonName(relativeInputPath);
  state.metadataList.push({
    source: relativeInputPath,
    file: outputFileName,
    ...parsed.data,
    name: inferredName ?? parsed.data.name,
  });
};

/** Persist missing metadata report and validated source metadata output. */
export const writeExtractionOutputs = (
  imageFiles: string[],
  state: ExtractionState,
): void => {
  const publicDir = path.dirname(SOURCE_METADATA_FILE);
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const report = {
    totalImages: imageFiles.length,
    validImages: state.metadataList.length,
    missingImages: state.missingMetadata.length,
    byReason: state.byReason,
    missing: state.missingMetadata,
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  console.log(`🧾 Missing metadata report written to ${REPORT_FILE}`);

  if (state.missingMetadata.length > 0) {
    throw new Error(
      `Missing required pose metadata in ${state.missingMetadata.length} image(s). See ${REPORT_FILE}.`,
    );
  }

  const sortedMetadata: SourceMetadata[] = [...state.metadataList].sort(
    (left, right) => left.file.localeCompare(right.file),
  );
  fs.writeFileSync(
    SOURCE_METADATA_FILE,
    JSON.stringify(sortedMetadata, null, 2),
  );
  console.log(
    `✅ Extracted metadata for ${sortedMetadata.length} images to ${SOURCE_METADATA_FILE}`,
  );
};
