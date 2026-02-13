import fs from "node:fs";
import path from "node:path";

import type { BuildOptions, RecropMode } from "./types";

export const INPUT_DIR = "./input-images";
export const GENERATED_DATA_DIR = "./build/generated";
export const SOURCE_METADATA_FILE = path.join(
  GENERATED_DATA_DIR,
  "metadata-source.json",
);
export const RUNTIME_METADATA_FILE = path.join(
  GENERATED_DATA_DIR,
  "metadata.json",
);
export const RUNTIME_METADATA_SUBSET_FILE = path.join(
  GENERATED_DATA_DIR,
  "metadata-subset.json",
);
export const RUNTIME_POSE_BOUNDS_FILE = path.join(
  GENERATED_DATA_DIR,
  "pose-bounds.json",
);
export const RUNTIME_POSE_BOUNDS_SUBSET_FILE = path.join(
  GENERATED_DATA_DIR,
  "pose-bounds-subset.json",
);
export const ATLAS_UNUSABLE_REPORT_FILE = path.join(
  GENERATED_DATA_DIR,
  "unusable-atlas-sources.json",
);
export const ATLAS_UNUSABLE_REPORT_SUBSET_FILE = path.join(
  GENERATED_DATA_DIR,
  "unusable-atlas-sources-subset.json",
);
export const OUTPUT_IMAGE_DIR = "./offline-scripts/processed-images";
export const OUTPUT_ATLAS_DIR = path.join(GENERATED_DATA_DIR, "atlases");
export const OUTPUT_ATLAS_SUBSET_DIR = path.join(
  GENERATED_DATA_DIR,
  "atlases-subset",
);
export const DERIVATIVE_LAYOUT_VERSION = "headless-align-v1";
export const OUTPUT_LAYOUT_STAMP_FILE = path.join(
  OUTPUT_IMAGE_DIR,
  ".layout-version",
);
export const MIRROR_SUFFIX = "_mirror";

export interface OutputTargets {
  runtimeMetadataFile: string;
  poseBoundsFile: string;
  unusableReportFile: string;
  atlasOutputDir: string;
}

export const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

export const cleanOutputDir = (dirPath: string): void => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

export const readLayoutVersionStamp = (): string | undefined => {
  if (!fs.existsSync(OUTPUT_LAYOUT_STAMP_FILE)) {
    return undefined;
  }

  const raw = fs.readFileSync(OUTPUT_LAYOUT_STAMP_FILE, "utf8").trim();
  return raw.length > 0 ? raw : undefined;
};

export const writeLayoutVersionStamp = (): void => {
  ensureDir(OUTPUT_IMAGE_DIR);
  fs.writeFileSync(
    OUTPUT_LAYOUT_STAMP_FILE,
    `${DERIVATIVE_LAYOUT_VERSION}\n`,
    "utf8",
  );
};

export const resolvePathWithin = (
  baseDir: string,
  relativePath: string,
  fieldPath: string,
): string => {
  const baseAbsolutePath = path.resolve(baseDir);
  const targetAbsolutePath = path.resolve(baseAbsolutePath, relativePath);
  const relativeToBase = path.relative(baseAbsolutePath, targetAbsolutePath);

  if (relativeToBase.startsWith("..") || path.isAbsolute(relativeToBase)) {
    throw new Error(
      `${fieldPath} resolves outside ${baseDir}: "${relativePath}"`,
    );
  }

  return targetAbsolutePath;
};

export const toMirrorBaseRelativePath = (
  relativePath: string,
): string | undefined => {
  const extension = path.posix.extname(relativePath);
  const stem = extension
    ? relativePath.slice(0, relativePath.length - extension.length)
    : relativePath;
  if (!stem.endsWith(MIRROR_SUFFIX)) {
    return undefined;
  }
  return `${stem.slice(0, stem.length - MIRROR_SUFFIX.length)}${extension}`;
};

export const isFullSelection = (options: BuildOptions): boolean =>
  options.subsetPrefixes.length === 0 && options.limit === 0;

export const getOutputTargets = (options: BuildOptions): OutputTargets => {
  if (isFullSelection(options)) {
    return {
      runtimeMetadataFile: RUNTIME_METADATA_FILE,
      poseBoundsFile: RUNTIME_POSE_BOUNDS_FILE,
      unusableReportFile: ATLAS_UNUSABLE_REPORT_FILE,
      atlasOutputDir: OUTPUT_ATLAS_DIR,
    };
  }

  return {
    runtimeMetadataFile: RUNTIME_METADATA_SUBSET_FILE,
    poseBoundsFile: RUNTIME_POSE_BOUNDS_SUBSET_FILE,
    unusableReportFile: ATLAS_UNUSABLE_REPORT_SUBSET_FILE,
    atlasOutputDir: OUTPUT_ATLAS_SUBSET_DIR,
  };
};

/** Decide how output image directory should be prepared for the selected mode. */
export const prepareOutputDirectory = (options: BuildOptions): void => {
  if (options.recropMode === "none") {
    return;
  }

  if (options.recropMode === "all" && isFullSelection(options)) {
    cleanOutputDir(OUTPUT_IMAGE_DIR);
    return;
  }

  ensureDir(OUTPUT_IMAGE_DIR);
};

export const shouldWriteLayoutVersionStamp = (options: BuildOptions): boolean =>
  options.recropMode === "all" && isFullSelection(options);

export const shouldRenderDerivative = (
  recropMode: RecropMode,
  outputExists: boolean,
): boolean => {
  if (recropMode === "all") {
    return true;
  }
  if (recropMode === "missing" && !outputExists) {
    return true;
  }
  return false;
};
