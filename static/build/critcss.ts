import { generate } from "critical";
import fs from "node:fs";
import process from "node:process";

const DIST_DIR = "dist";

async function main() {
  const verbose =
    process.argv.includes("--verbose") || process.env.BUILD_VERBOSE === "1";

  if (!fs.existsSync(DIST_DIR)) {
    console.error(`❌ Dist directory ${DIST_DIR} not found. Run build first.`);
    process.exitCode = 1;
    return;
  }

  // Rule: Deterministic Sorting
  const htmlFiles = fs
    .readdirSync(DIST_DIR)
    .filter((f) => f.endsWith(".html"))
    .sort();

  for (const file of htmlFiles) {
    if (verbose) {
      console.log(`🔍 Extracting critical CSS for ${file}...`);
    }

    try {
      await generate({
        base: DIST_DIR,
        src: file, // Relative to base
        target: {
          html: file,
          uncritical: "assets/site.css",
        },
        inline: true,
        dimensions: [
          {
            height: 844,
            width: 390,
          },
        ],
      });
      console.log(`✅ Critical CSS inlined into ${file}`);
    } catch (err) {
      console.error(`❌ Failed for ${file}:`, err);
      process.exitCode = 1;
    }
  }

  if (process.env["CI"]) {
    console.warn(
      "⚠️ Critical CSS extraction might fail in CI without a server.",
    );
  }
}

main().catch((err) => {
  console.error("Fatal error during Critical CSS extraction:", err);
  process.exitCode = 1;
});
