import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(FRONTEND_DIR, "dist");

const ensureDistDir = () => {
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }
};

const removeDistContents = () => {
  const entries = fs.readdirSync(DIST_DIR);
  for (const entry of entries) {
    fs.rmSync(path.join(DIST_DIR, entry), { recursive: true, force: true });
  }
};

const main = () => {
  ensureDistDir();
  removeDistContents();
  console.log("🧹 Cleaned dist contents.");
};

main();
