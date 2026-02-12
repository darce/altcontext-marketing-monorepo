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

const isSourceTypeScriptAsset = (srcPath: string): boolean => {
  const sourceRelativePath = path.relative(SRC_DIR, srcPath);
  if (sourceRelativePath.startsWith("..")) {
    return false;
  }

  return sourceRelativePath.endsWith(".ts");
};

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function copyRecursive(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
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
}

function copyPublicNonImageAssets() {
  const entries = fs.readdirSync(PUBLIC_DIR).sort();
  for (const entry of entries) {
    if (entry === "input-images") continue;
    if (entry === "metadata-source.json") continue;
    copyRecursive(path.join(PUBLIC_DIR, entry), path.join(DIST_DIR, entry));
    if (VERBOSE) {
      console.log(`📄 Copied public asset: ${entry}`);
    }
  }
}

function copyReferencedImages() {
  if (!fs.existsSync(PUBLIC_RUNTIME_METADATA)) {
    throw new Error(
      `Missing ${PUBLIC_RUNTIME_METADATA}. Run build:derivatives first.`,
    );
  }
  if (!fs.existsSync(PUBLIC_IMAGE_DIR)) {
    throw new Error(
      `Missing ${PUBLIC_IMAGE_DIR}. Run build:derivatives first.`,
    );
  }

  const metadata = JSON.parse(
    fs.readFileSync(PUBLIC_RUNTIME_METADATA, "utf8"),
  ) as { file: string }[];
  if (!Array.isArray(metadata)) {
    throw new Error(`Invalid metadata format in ${PUBLIC_RUNTIME_METADATA}.`);
  }

  const uniqueFiles = Array.from(
    new Set(metadata.map((item) => item.file)),
  ).sort();
  const distImageDir = path.join(DIST_DIR, "input-images");
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
}

function main() {
  try {
    if (VERBOSE) {
      console.log("🚚 Copy step started.");
    }
    ensureDir(DIST_DIR);

    copyRecursive(SRC_DIR, DIST_DIR);
    copyPublicNonImageAssets();
    copyReferencedImages();

    console.log("✅ Assets copied to dist/");
  } catch (err) {
    console.error("❌ Failed to copy assets:", err);
    process.exitCode = 1;
  }
}

main();
