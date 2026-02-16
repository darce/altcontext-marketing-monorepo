import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { OUTPUT_SIZE } from "./crop";
import { compareStrings } from "./metadata-io";
import type {
  AtlasBuildResult,
  PreloadTier,
  RuntimeAtlasFileMap,
  RuntimeAtlasPlacement,
  RuntimeMetadataItem,
} from "./types";

const ATLAS_GRID_SIZE = 8;
const ATLAS_WEBP_QUALITY = 34;
const ATLAS_WEBP_METHOD = 6;
const ATLAS_WEBP_ALPHA_QUALITY = 75;
const PRELOAD_TIER_STEPS = [10, 5, 2] as const;

export const PROGRESSIVE_ATLAS_VARIANTS = [
  { suffix: "low", tileSize: 128, quality: 20 },
  { suffix: "mid", tileSize: 320, quality: 30 },
  { suffix: "high", tileSize: OUTPUT_SIZE, quality: ATLAS_WEBP_QUALITY },
] as const;
type ProgressiveAtlasVariant = (typeof PROGRESSIVE_ATLAS_VARIANTS)[number];

const cleanOutputDir = (dirPath: string): void => {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
  fs.mkdirSync(dirPath, { recursive: true });
};

const toPoseBucketKey = (item: RuntimeMetadataItem, step: number): string => {
  const yawBucket = Math.round(item.pose.yaw / step);
  const pitchBucket = Math.round(item.pose.pitch / step);
  const rollBucket = Math.round(item.pose.roll / step);
  return `${yawBucket}:${pitchBucket}:${rollBucket}`;
};

/**
 * Select one representative per pose bucket, preferring larger face scale.
 */
export const buildRepresentativeFileSet = (
  runtimeItems: RuntimeMetadataItem[],
  step: number,
): Set<string> => {
  const representativeByBucket = new Map<string, RuntimeMetadataItem>();

  for (const item of runtimeItems) {
    const key = toPoseBucketKey(item, step);
    const previous = representativeByBucket.get(key);
    if (!previous) {
      representativeByBucket.set(key, item);
      continue;
    }

    if (item.interocularDist > previous.interocularDist) {
      representativeByBucket.set(key, item);
      continue;
    }
    if (
      item.interocularDist === previous.interocularDist &&
      compareStrings(item.file, previous.file) < 0
    ) {
      representativeByBucket.set(key, item);
    }
  }

  return new Set(
    Array.from(representativeByBucket.values()).map((item) => item.file),
  );
};

/**
 * Label each runtime item with the coarsest preload tier that includes it.
 * Tier order: 3° seed -> 2° backfill -> 1° backfill -> remainder.
 */
export const buildPreloadTierByFile = (
  runtimeItems: RuntimeMetadataItem[],
): Map<string, PreloadTier> => {
  const rep3 = buildRepresentativeFileSet(runtimeItems, PRELOAD_TIER_STEPS[0]);
  const rep2 = buildRepresentativeFileSet(runtimeItems, PRELOAD_TIER_STEPS[1]);
  const rep1 = buildRepresentativeFileSet(runtimeItems, PRELOAD_TIER_STEPS[2]);
  const tierByFile = new Map<string, PreloadTier>();

  for (const item of runtimeItems) {
    if (rep3.has(item.file)) {
      tierByFile.set(item.file, 3);
      continue;
    }
    if (rep2.has(item.file)) {
      tierByFile.set(item.file, 2);
      continue;
    }
    if (rep1.has(item.file)) {
      tierByFile.set(item.file, 1);
      continue;
    }
    tierByFile.set(item.file, 0);
  }

  return tierByFile;
};

export const logPreloadTierSummary = (
  tierByFile: Map<string, PreloadTier>,
  verbose: boolean,
): void => {
  if (!verbose) {
    return;
  }

  let tier3 = 0;
  let tier2 = 0;
  let tier1 = 0;
  let tier0 = 0;

  for (const tier of tierByFile.values()) {
    if (tier === 3) {
      tier3 += 1;
      continue;
    }
    if (tier === 2) {
      tier2 += 1;
      continue;
    }
    if (tier === 1) {
      tier1 += 1;
      continue;
    }
    tier0 += 1;
  }

  console.log(
    `🧭 Preload tiers: tier3=${tier3}, tier2=${tier2}, tier1=${tier1}, tier0=${tier0}`,
  );
};

const comparePose = (
  left: RuntimeMetadataItem,
  right: RuntimeMetadataItem,
): number => {
  if (left.pose.yaw !== right.pose.yaw) {
    return left.pose.yaw - right.pose.yaw;
  }
  if (left.pose.pitch !== right.pose.pitch) {
    return left.pose.pitch - right.pose.pitch;
  }
  if (left.pose.roll !== right.pose.roll) {
    return left.pose.roll - right.pose.roll;
  }
  return compareStrings(left.file, right.file);
};

const toAtlasBaseName = (index: number): string => {
  return `faces-atlas-${String(index + 1).padStart(3, "0")}`;
};

const toAtlasVariantFileName = (
  index: number,
  variant: ProgressiveAtlasVariant,
): string => {
  return `${toAtlasBaseName(index)}-${variant.suffix}.webp`;
};

/** Build one quality tier of an atlas and return compressed output byte size. */
export const buildAtlasVariant = (
  chunk: RuntimeMetadataItem[],
  atlasIndex: number,
  variant: ProgressiveAtlasVariant,
  outputAtlasDir: string,
  outputImageDir: string,
): { fileName: string; bytes: number } => {
  const fileName = toAtlasVariantFileName(atlasIndex, variant);
  const outputPath = path.join(outputAtlasDir, fileName);
  const tileSize = variant.tileSize;
  const atlasDimension = tileSize * ATLAS_GRID_SIZE;

  const args: string[] = [
    "-size",
    `${atlasDimension}x${atlasDimension}`,
    "xc:none",
  ];

  for (let tileIndex = 0; tileIndex < chunk.length; tileIndex += 1) {
    const item = chunk[tileIndex];
    const sourcePath = path.join(outputImageDir, item.file);
    const column = tileIndex % ATLAS_GRID_SIZE;
    const row = Math.floor(tileIndex / ATLAS_GRID_SIZE);
    if (tileSize === OUTPUT_SIZE) {
      args.push(sourcePath);
    } else {
      args.push("(", sourcePath, "-resize", `${tileSize}x${tileSize}!`, ")");
    }

    args.push(
      "-geometry",
      `+${column * tileSize}+${row * tileSize}`,
      "-composite",
    );
  }

  args.push(
    "-strip",
    "-quality",
    String(variant.quality),
    "-define",
    `webp:method=${ATLAS_WEBP_METHOD}`,
    "-define",
    `webp:alpha-quality=${ATLAS_WEBP_ALPHA_QUALITY}`,
    "-define",
    "webp:use-sharp-yuv=true",
    outputPath,
  );

  execFileSync("magick", args, { stdio: "pipe" });
  return { fileName, bytes: fs.statSync(outputPath).size };
};

/**
 * Pack cropped derivatives into fixed-grid atlases to reduce runtime requests.
 * Atlas pages are deterministic by sorting runtime items by output filename.
 *
 * Sort strategy: tier descending, then yaw ascending within each tier.
 * At tier boundaries the yaw direction reverses (high positive → low negative).
 * To keep visually similar face directions together and avoid jarring direction
 * changes within a single atlas page, we re-sort each chunk (page) by yaw
 * after the global tier+pose ordering has decided which items land on which page.
 */
export const buildAtlases = (
  runtimeItems: RuntimeMetadataItem[],
  tierByFile: Map<string, PreloadTier>,
  verbose: boolean,
  outputAtlasDir: string,
  outputImageDir: string,
): AtlasBuildResult => {
  cleanOutputDir(outputAtlasDir);

  // Global sort: tier descending, then yaw ascending within each tier.
  // This keeps higher-priority tiles in earlier atlases for preload efficiency.
  const sorted = [...runtimeItems].sort((left, right) => {
    const leftTier = tierByFile.get(left.file) ?? 0;
    const rightTier = tierByFile.get(right.file) ?? 0;
    if (leftTier !== rightTier) {
      return rightTier - leftTier;
    }
    return comparePose(left, right);
  });
  const itemsPerAtlas = ATLAS_GRID_SIZE * ATLAS_GRID_SIZE;

  const placementsByFile = new Map<string, RuntimeAtlasPlacement>();
  let sourceBytes = 0;
  let atlasBytes = 0;

  for (
    let atlasIndex = 0;
    atlasIndex * itemsPerAtlas < sorted.length;
    atlasIndex += 1
  ) {
    const start = atlasIndex * itemsPerAtlas;
    // Re-sort each page by yaw to keep face direction continuous within
    // a single atlas, even when the page straddles a tier boundary.
    const chunk = sorted.slice(start, start + itemsPerAtlas).sort(comparePose);

    for (let tileIndex = 0; tileIndex < chunk.length; tileIndex += 1) {
      const item = chunk[tileIndex];
      const column = tileIndex % ATLAS_GRID_SIZE;
      const row = Math.floor(tileIndex / ATLAS_GRID_SIZE);
      const sourcePath = path.join(outputImageDir, item.file);

      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          `Atlas source derivative missing for ${item.file} at ${sourcePath}`,
        );
      }

      sourceBytes += fs.statSync(sourcePath).size;

      if (!placementsByFile.has(item.file)) {
        const files: RuntimeAtlasFileMap = {
          low: "",
          mid: "",
          high: "",
        };
        placementsByFile.set(item.file, {
          files,
          column,
          row,
          gridSize: ATLAS_GRID_SIZE,
        });
      }
    }

    const variantOutputs = PROGRESSIVE_ATLAS_VARIANTS.map((variant) =>
      buildAtlasVariant(
        chunk,
        atlasIndex,
        variant,
        outputAtlasDir,
        outputImageDir,
      ),
    );
    for (const item of chunk) {
      const placement = placementsByFile.get(item.file);
      if (!placement) {
        throw new Error(`Missing atlas placement for ${item.file}`);
      }

      for (
        let variantIndex = 0;
        variantIndex < PROGRESSIVE_ATLAS_VARIANTS.length;
        variantIndex += 1
      ) {
        const variant = PROGRESSIVE_ATLAS_VARIANTS[variantIndex];
        const output = variantOutputs[variantIndex];
        placement.files[variant.suffix] = output.fileName;
      }
    }

    atlasBytes += variantOutputs.reduce(
      (total, output) => total + output.bytes,
      0,
    );

    if (verbose) {
      const sizeLabel = variantOutputs
        .map((output) => {
          const megabytes = (output.bytes / 1024 / 1024).toFixed(2);
          return `${output.fileName}=${megabytes}MB`;
        })
        .join(", ");
      console.log(
        `🗂️ Atlas ${toAtlasBaseName(atlasIndex)}: ${chunk.length} tiles (${sizeLabel})`,
      );
    }
  }

  return {
    placementsByFile,
    stats: {
      atlasCount: Math.ceil(sorted.length / itemsPerAtlas),
      tileCount: sorted.length,
      sourceBytes,
      atlasBytes,
    },
  };
};

/** Attach atlas placement fields to each runtime metadata record. */
export const attachAtlasPlacements = (
  runtimeItems: RuntimeMetadataItem[],
  placementsByFile: Map<string, RuntimeAtlasPlacement>,
  tierByFile: Map<string, PreloadTier>,
): RuntimeMetadataItem[] => {
  return runtimeItems.map((item) => {
    const atlasPlacement = placementsByFile.get(item.file);
    if (!atlasPlacement) {
      throw new Error(`Missing atlas placement for runtime file ${item.file}`);
    }

    return {
      ...item,
      atlas: atlasPlacement,
      preloadTier: tierByFile.get(item.file) ?? 0,
    };
  });
};
