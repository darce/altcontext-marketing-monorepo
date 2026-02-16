import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer-core";

import {
  ALIGNMENT_TARGET_EYE_X_RATIO,
  ALIGNMENT_TARGET_EYE_Y_RATIO,
  OUTPUT_SIZE,
  SCALE_DECIMALS,
  computeAlignedEyeMidpoint,
  computeAlignmentDeviationPx,
  roundTo,
  toAlignmentScore,
} from "./crop";
import type {
  BrowserRenderer,
  CropBox,
  Point,
  RuntimeTransform,
} from "./types";

const DERIVATIVE_WEBP_QUALITY = 42;
export const CRITICAL_EYE_DERIVATIVE_WEBP_QUALITY = 50;
const DERIVATIVE_WEBP_METHOD = 6;
const DERIVATIVE_WEBP_SNS_STRENGTH = 85;
const DERIVATIVE_WEBP_FILTER_STRENGTH = 35;
const DERIVATIVE_WEBP_ALPHA_QUALITY = 80;
const PUPPETEER_CHROME_PATH =
  process.env.PUPPETEER_CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CANVAS_TEMPLATE = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;background:transparent;">
  <canvas id="canvas" width="640" height="640"></canvas>
  <script>
    window.__acxRender = async (inputUrl, outputPath, transformCss) => {
      const canvas = document.getElementById("canvas");
      const ctx = canvas.getContext("2d", { alpha: true });
      if (!ctx) {
        throw new Error("2D canvas context unavailable.");
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const image = new Image();
      image.src = inputUrl;
      await image.decode();

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const matrix = new DOMMatrix(transformCss);
      ctx.translate(0.5, 0.5);
      ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.restore();

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) {
        throw new Error("Canvas toBlob returned null.");
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      await window.__acxWriteFile(outputPath, Array.from(bytes));
      return bytes.length;
    };
  </script>
</body>
</html>`;

const ensureDir = (dirPath: string): void => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const deleteFileIfExists = (filePath: string): void => {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
};

/** Render a cropped square PNG derivative for a metadata record. */
export const renderCroppedDerivative = (
  sourcePath: string,
  outputPath: string,
  crop: CropBox,
  flopSource = false,
): void => {
  ensureDir(path.dirname(outputPath));
  const args: string[] = [sourcePath, "-auto-orient"];
  if (flopSource) {
    args.push("-flop");
  }
  args.push(
    "-crop",
    `${crop.size}x${crop.size}+${crop.left}+${crop.top}`,
    "+repage",
    "-resize",
    `${OUTPUT_SIZE}x${OUTPUT_SIZE}!`,
    "-background",
    "none",
    "-alpha",
    "set",
    "-strip",
    outputPath,
  );
  execFileSync("magick", args, { stdio: "pipe" });
};

/** Convert normalized transform fields into an SVG/CSS matrix() string. */
export const toRuntimeTransformCss = (transform: RuntimeTransform): string => {
  const cos = Math.cos(transform.rotateRad);
  const sin = Math.sin(transform.rotateRad);
  const a = roundTo(transform.scale * cos, SCALE_DECIMALS);
  const b = roundTo(transform.scale * sin, SCALE_DECIMALS);
  const c = roundTo(-transform.scale * sin, SCALE_DECIMALS);
  const d = roundTo(transform.scale * cos, SCALE_DECIMALS);
  const e = roundTo(transform.translateXRatio * OUTPUT_SIZE, SCALE_DECIMALS);
  const f = roundTo(transform.translateYRatio * OUTPUT_SIZE, SCALE_DECIMALS);
  return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
};

/** Encode a transformed PNG into final WebP output with deterministic settings. */
export const encodeDerivativeWebp = (
  sourcePath: string,
  outputPath: string,
  quality: number = DERIVATIVE_WEBP_QUALITY,
): void => {
  execFileSync(
    "magick",
    [
      sourcePath,
      "-strip",
      "-quality",
      String(quality),
      "-define",
      `webp:method=${DERIVATIVE_WEBP_METHOD}`,
      "-define",
      `webp:sns-strength=${DERIVATIVE_WEBP_SNS_STRENGTH}`,
      "-define",
      `webp:filter-strength=${DERIVATIVE_WEBP_FILTER_STRENGTH}`,
      "-define",
      `webp:alpha-quality=${DERIVATIVE_WEBP_ALPHA_QUALITY}`,
      "-define",
      "webp:use-sharp-yuv=true",
      outputPath,
    ],
    { stdio: "pipe" },
  );
};

const getOutputImageSize = (
  outputPath: string,
): { width: number; height: number } => {
  const raw = execFileSync(
    "magick",
    [outputPath, "-ping", "-format", "%w %h", "info:"],
    { encoding: "utf8" },
  ).trim();
  const [widthRaw, heightRaw] = raw.split(/\s+/);
  const width = Number.parseInt(widthRaw, 10);
  const height = Number.parseInt(heightRaw, 10);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(`Invalid output dimensions for ${outputPath}: "${raw}"`);
  }
  return { width, height };
};

export interface AlignmentVerification {
  midpointPx: Point;
  targetPx: Point;
  deviationPx: number;
  alignmentScore: number;
}

export const verifyAlignedDerivative = (
  outputPath: string,
  eyeLeft: Point,
  eyeRight: Point,
  alignmentTransform: RuntimeTransform,
): AlignmentVerification => {
  // Read from final output to verify we are scoring against the baked artifact dimensions.
  const { width, height } = getOutputImageSize(outputPath);
  const midpoint = computeAlignedEyeMidpoint(
    eyeLeft,
    eyeRight,
    alignmentTransform,
  );
  const midpointPx = {
    x: midpoint.x * width,
    y: midpoint.y * height,
  };
  const targetPx = {
    x: ALIGNMENT_TARGET_EYE_X_RATIO * width,
    y: ALIGNMENT_TARGET_EYE_Y_RATIO * height,
  };
  const deviationPx = computeAlignmentDeviationPx(midpoint, width, height);
  return {
    midpointPx: {
      x: roundTo(midpointPx.x, 3),
      y: roundTo(midpointPx.y, 3),
    },
    targetPx: {
      x: roundTo(targetPx.x, 3),
      y: roundTo(targetPx.y, 3),
    },
    deviationPx: roundTo(deviationPx, 4),
    alignmentScore: toAlignmentScore(deviationPx),
  };
};

/** Launch a shared headless renderer so all alignment math runs in browser canvas. */
export const createBrowserRenderer = async (): Promise<BrowserRenderer> => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: PUPPETEER_CHROME_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--allow-file-access-from-files",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: OUTPUT_SIZE,
    height: OUTPUT_SIZE,
    deviceScaleFactor: 1,
  });
  await page.exposeFunction(
    "__acxWriteFile",
    async (outputPath: string, bytes: number[]): Promise<void> => {
      fs.writeFileSync(outputPath, Buffer.from(bytes));
    },
  );
  await page.setContent(CANVAS_TEMPLATE, { waitUntil: "domcontentloaded" });

  const renderAlignedTile = async (
    inputPath: string,
    outputPath: string,
    transformCss: string,
  ): Promise<void> => {
    const inputBytes = fs.readFileSync(path.resolve(inputPath));
    const inputUrl = `data:image/png;base64,${inputBytes.toString("base64")}`;
    const absoluteOutputPath = path.resolve(outputPath);
    await page.evaluate(
      async (payload: {
        inputUrl: string;
        outputPath: string;
        transformCss: string;
      }) => {
        const renderRaw = (globalThis as unknown as { __acxRender?: unknown })
          .__acxRender;
        if (typeof renderRaw !== "function") {
          throw new Error("Canvas renderer is unavailable in headless page.");
        }

        await (
          renderRaw as (
            inputUrl: string,
            outputPath: string,
            transformCss: string,
          ) => Promise<number>
        )(payload.inputUrl, payload.outputPath, payload.transformCss);
      },
      { inputUrl, outputPath: absoluteOutputPath, transformCss },
    );
  };

  const close = async (): Promise<void> => {
    await page.close();
    await browser.close();
  };

  return { renderAlignedTile, close };
};

/** Crop, align (via browser canvas), and encode a final derivative tile. */
export const bakeAlignedDerivative = async (
  renderer: BrowserRenderer,
  sourcePath: string,
  outputPath: string,
  crop: CropBox,
  alignmentTransform: RuntimeTransform,
  webpQuality?: number,
  flopSource = false,
): Promise<void> => {
  const tempBasePngPath = `${outputPath}.base.png`;
  const tempAlignedPngPath = `${outputPath}.aligned.png`;
  const targetWebpQuality = webpQuality ?? DERIVATIVE_WEBP_QUALITY;

  try {
    renderCroppedDerivative(sourcePath, tempBasePngPath, crop, flopSource);
    await renderer.renderAlignedTile(
      tempBasePngPath,
      tempAlignedPngPath,
      toRuntimeTransformCss(alignmentTransform),
    );
    encodeDerivativeWebp(tempAlignedPngPath, outputPath, targetWebpQuality);
  } finally {
    deleteFileIfExists(tempBasePngPath);
    deleteFileIfExists(tempAlignedPngPath);
  }
};
