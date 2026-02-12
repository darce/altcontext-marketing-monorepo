import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SRC_DIR = "./src";
const PUBLIC_DIR = "./public";
const DIST_DIR = "./dist";
const PUBLIC_IMAGE_DIR = path.join(PUBLIC_DIR, "input-images");
const PUBLIC_RUNTIME_METADATA = path.join(PUBLIC_DIR, "metadata.json");
const VERBOSE =
  process.argv.includes("--verbose") || process.env.BUILD_VERBOSE === "1";

interface RuntimeMetadataAtlasFiles {
  low: string;
  mid: string;
  high: string;
}

interface RuntimeMetadataAtlas {
  file?: string;
  files?: RuntimeMetadataAtlasFiles;
}

interface RuntimeMetadataEntry {
  file: string;
  atlas?: RuntimeMetadataAtlas;
}

const isSourceTypeScriptAsset = (srcPath: string): boolean => {
  const sourceRelativePath = path.relative(SRC_DIR, srcPath);
  if (sourceRelativePath.startsWith("..")) {
    return false;
  }

  return sourceRelativePath.endsWith(".ts");
};

const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const copyRecursive = (src: string, dest: string): void => {
  if (!fs.existsSync(src)) {
    return;
  }

  const stats = fs.statSync(src);
  if (stats.isDirectory()) {
    ensureDir(dest);
    const children = fs.readdirSync(src).sort();
    for (const child of children) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
    return;
  }

  if (isSourceTypeScriptAsset(src)) {
    if (VERBOSE) {
      console.log(`🧩 Skipped TS source asset (compiled separately): ${src}`);
    }
    return;
  }

  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
};

const copyPublicNonImageAssets = (): void => {
  const entries = fs.readdirSync(PUBLIC_DIR).sort();
  for (const entry of entries) {
    if (entry === "input-images") {
      continue;
    }
    if (entry === "metadata-source.json") {
      continue;
    }

    copyRecursive(path.join(PUBLIC_DIR, entry), path.join(DIST_DIR, entry));
    if (VERBOSE) {
      console.log(`📄 Copied public asset: ${entry}`);
    }
  }
};

const parseRuntimeMetadata = (): RuntimeMetadataEntry[] => {
  const raw = fs.readFileSync(PUBLIC_RUNTIME_METADATA, "utf8");
  const parsed: unknown = JSON.parse(raw);

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid metadata format in ${PUBLIC_RUNTIME_METADATA}.`);
  }

  return parsed.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as { file?: unknown }).file !== "string"
    ) {
      throw new Error(
        `Invalid metadata[${index}] in ${PUBLIC_RUNTIME_METADATA}: expected object with file`,
      );
    }

    const file = (entry as { file: string }).file;
    const atlasRaw = (entry as { atlas?: unknown }).atlas;

    if (atlasRaw === undefined) {
      return { file };
    }

    if (
      typeof atlasRaw !== "object" ||
      atlasRaw === null ||
      Array.isArray(atlasRaw)
    ) {
      throw new Error(
        `Invalid metadata[${index}].atlas in ${PUBLIC_RUNTIME_METADATA}: expected object`,
      );
    }

    const atlasFile = (atlasRaw as { file?: unknown }).file;
    const atlasFiles = (atlasRaw as { files?: unknown }).files;
    const hasLegacyFile = typeof atlasFile === "string" && atlasFile.length > 0;
    const hasProgressiveFiles =
      typeof atlasFiles === "object" &&
      atlasFiles !== null &&
      !Array.isArray(atlasFiles) &&
      typeof (atlasFiles as { low?: unknown }).low === "string" &&
      typeof (atlasFiles as { mid?: unknown }).mid === "string" &&
      typeof (atlasFiles as { high?: unknown }).high === "string";
    if (!hasLegacyFile && !hasProgressiveFiles) {
      throw new Error(
        `Invalid metadata[${index}].atlas in ${PUBLIC_RUNTIME_METADATA}: expected file or files.{low,mid,high}`,
      );
    }

    return {
      file,
      atlas: hasLegacyFile
        ? { file: atlasFile as string }
        : {
            files: {
              low: (atlasFiles as { low: string }).low,
              mid: (atlasFiles as { mid: string }).mid,
              high: (atlasFiles as { high: string }).high,
            },
          },
    };
  });
};

const copyReferencedImages = (): void => {
  if (!fs.existsSync(PUBLIC_RUNTIME_METADATA)) {
    throw new Error(
      `Missing ${PUBLIC_RUNTIME_METADATA}. Run build:derivatives first.`,
    );
  }

  const metadata = parseRuntimeMetadata();
  const distImageDir = path.join(DIST_DIR, "input-images");
  if (fs.existsSync(distImageDir)) {
    fs.rmSync(distImageDir, { recursive: true, force: true });
  }

  const uniqueFiles = Array.from(
    new Set(metadata.filter((item) => !item.atlas).map((item) => item.file)),
  ).sort();

  if (uniqueFiles.length === 0) {
    console.log(
      "🗂️ Metadata references atlas assets only; skipped dist/input-images copy.",
    );
    return;
  }

  if (!fs.existsSync(PUBLIC_IMAGE_DIR)) {
    throw new Error(
      `Missing ${PUBLIC_IMAGE_DIR}. Run build:derivatives first.`,
    );
  }

  ensureDir(distImageDir);

  let totalBytes = 0;
  for (const file of uniqueFiles) {
    const srcPath = path.join(PUBLIC_IMAGE_DIR, file);
    const dstPath = path.join(distImageDir, file);
    if (!fs.existsSync(srcPath)) {
      throw new Error(`Referenced image missing: ${srcPath}`);
    }

    ensureDir(path.dirname(dstPath));
    fs.copyFileSync(srcPath, dstPath);
    totalBytes += fs.statSync(srcPath).size;

    if (VERBOSE && uniqueFiles.length <= 100) {
      console.log(`🖼️ Copied image: ${file}`);
    }
  }

  console.log(
    `🖼️ Copied ${uniqueFiles.length} referenced images ` +
      `(${(totalBytes / 1024 / 1024).toFixed(2)} MB) to dist/input-images`,
  );
};

const main = (): void => {
  try {
    if (VERBOSE) {
      console.log("🚚 Copy step started.");
    }
    ensureDir(DIST_DIR);

    copyRecursive(SRC_DIR, DIST_DIR);
    copyPublicNonImageAssets();
    copyReferencedImages();

    console.log("✅ Assets copied to dist/");
  } catch (error) {
    console.error("❌ Failed to copy assets:", error);
    process.exitCode = 1;
  }
};

main();
