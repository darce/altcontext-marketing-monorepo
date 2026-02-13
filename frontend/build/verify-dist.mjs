import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(FRONTEND_DIR, "dist");
const METADATA_PATH = path.join(DIST_DIR, "metadata.json");
const ATLAS_DIR = path.join(DIST_DIR, "atlases");
const INDEX_PATH = path.join(DIST_DIR, "index.html");
const ATLAS_VARIANTS = ["low", "mid", "high"];

/**
 * Emit a GitHub Actions error and stop with a non-zero status.
 * Uses a plain stderr path for local runs and action annotations in CI.
 */
const fail = (message) => {
  console.error(`❌ ${message}`);
  console.error(`::error::${message}`);
  process.exit(1);
};

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    fail(`Failed to parse JSON at ${filePath}: ${reason}`);
  }
};

const ensureRequiredPaths = () => {
  if (!fs.existsSync(INDEX_PATH)) {
    fail(`Missing ${path.relative(process.cwd(), INDEX_PATH)}. Build and commit dist before deploy.`);
  }
  if (!fs.existsSync(METADATA_PATH)) {
    fail(`Missing ${path.relative(process.cwd(), METADATA_PATH)}. Build and commit dist before deploy.`);
  }
  if (!fs.existsSync(ATLAS_DIR)) {
    fail(`Missing ${path.relative(process.cwd(), ATLAS_DIR)}. Build and commit dist before deploy.`);
  }
};

const collectRequiredAtlasFiles = (metadata) => {
  const requiredAtlasFiles = new Set();
  for (const item of metadata) {
    if (
      !item ||
      typeof item !== "object" ||
      !item.atlas ||
      typeof item.atlas !== "object" ||
      !item.atlas.files ||
      typeof item.atlas.files !== "object"
    ) {
      continue;
    }

    for (const variant of ATLAS_VARIANTS) {
      const file = item.atlas.files[variant];
      if (typeof file === "string" && file.length > 0) {
        requiredAtlasFiles.add(file);
      }
    }
  }
  return requiredAtlasFiles;
};

const assertAtlasesExist = (requiredAtlasFiles) => {
  const missing = [];
  for (const atlasFile of requiredAtlasFiles) {
    if (!fs.existsSync(path.join(ATLAS_DIR, atlasFile))) {
      missing.push(atlasFile);
    }
  }

  if (missing.length === 0) {
    return;
  }

  const preview = missing.slice(0, 20).join(", ");
  fail(
    `Atlas mismatch: ${missing.length} metadata-referenced atlas file(s) missing in ${path.relative(process.cwd(), ATLAS_DIR)}. Examples: ${preview}`,
  );
};

const main = () => {
  ensureRequiredPaths();

  const metadata = readJson(METADATA_PATH);
  if (!Array.isArray(metadata)) {
    fail(`${METADATA_PATH} must be an array.`);
  }

  const requiredAtlasFiles = collectRequiredAtlasFiles(metadata);
  assertAtlasesExist(requiredAtlasFiles);

  console.log(
    `✅ Dist integrity verified: ${metadata.length} metadata rows, ${requiredAtlasFiles.size} atlas files referenced.`,
  );
};

main();
