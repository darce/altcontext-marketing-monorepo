import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const INPUT_DIR = "./input-images";
const SOURCE_METADATA_FILE = "./public/metadata-source.json";
const REPORT_FILE = "./public/missing-pose-metadata.json";
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";

const getArgValue = (flag: string): string | undefined => {
  const argv = process.argv.slice(2);
  const pref = `--${flag}=`;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith(pref)) {
      return token.slice(pref.length);
    }

    if (token === `--${flag}` && i + 1 < argv.length) {
      const next = argv[i + 1];
      if (!next.startsWith("--")) {
        return next;
      }
    }
  }

  return undefined;
};

const getVerbose = (): boolean => {
  return (
    process.argv.includes("--verbose") || process.env.BUILD_VERBOSE === "1"
  );
};

const normalizeSubsetToken = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
};

const getSubsetPrefixes = (): string[] => {
  const raw = getArgValue("subset") ?? process.env.BUILD_SUBSET;
  if (!raw) {
    return [];
  }

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((prefix) => normalizeSubsetToken(prefix.trim()))
        .filter(Boolean),
    ),
  ).sort();
};

const getLimit = (): number => {
  const raw = getArgValue("limit") ?? process.env.BUILD_LIMIT;
  if (!raw) {
    return 0;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value;
};

type MissingReason =
  | "no_xmp_header"
  | "no_xmp_start"
  | "no_xmp_end"
  | "missing_required_fields";

interface MissingMetadataEntry {
  file: string;
  reason: MissingReason;
  missingFields?: string[];
}

interface Point {
  x: number;
  y: number;
}

interface SourceMetadata {
  source: string;
  file: string;
  region: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  pose: {
    pitch: number;
    yaw: number;
    roll: number;
  };
  center: Point;
  faceWidth: number;
  features: {
    nose: Point;
    eyes: {
      l: Point;
      r: Point;
      innerL: Point;
      innerR: Point;
    };
    mouth: { l: Point; r: Point };
    chin: Point;
    oval: { l: Point; r: Point };
    forehead: Point;
  };
  noseEyeDist: number;
  faceScale: number;
  faceHeight: number;
  srcScalePx: number;
  interocularDist: number;
  interocularInner: number;
  interocularBlend: number;
  eyeMouthDist: number;
  ovalWidth: number;
  name?: string;
}

interface ParsedXmpResult {
  data: Omit<SourceMetadata, "source" | "file"> | null;
  missingFields: string[];
}

interface ExtractionState {
  metadataList: SourceMetadata[];
  missingMetadata: MissingMetadataEntry[];
  byReason: Record<MissingReason, number>;
  duplicateOutputNames: Map<string, string>;
}

/** Extract the raw XMP block from binary image data. */
const extractXmp = (
  buffer: Buffer,
): { xmp: string | null; reason?: MissingReason } => {
  const offset = buffer.indexOf(XMP_HEADER);
  if (offset === -1) {
    return { xmp: null, reason: "no_xmp_header" };
  }

  const start = buffer.indexOf("<x:xmpmeta", offset);
  if (start === -1) {
    return { xmp: null, reason: "no_xmp_start" };
  }

  const end = buffer.indexOf("</x:xmpmeta>", start);
  if (end === -1) {
    return { xmp: null, reason: "no_xmp_end" };
  }

  return { xmp: buffer.toString("utf8", start, end + 12) };
};

const parsePoint = (value: string | null): Point | null => {
  if (!value) {
    return null;
  }

  const [xRaw, yRaw] = value.split(",");
  const x = Number.parseFloat(xRaw);
  const y = Number.parseFloat(yRaw);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
};

/** Parse the required face fields from XMP content. */
const parseXmp = (xmp: string): ParsedXmpResult => {
  const getVal = (regex: RegExp): string | null => {
    const match = xmp.match(regex);
    return match ? match[1] : null;
  };

  const rbX = getVal(/<Iptc4xmpExt:rbX>([\d.-]+)<\/Iptc4xmpExt:rbX>/);
  const rbY = getVal(/<Iptc4xmpExt:rbY>([\d.-]+)<\/Iptc4xmpExt:rbY>/);
  const rbW = getVal(/<Iptc4xmpExt:rbW>([\d.-]+)<\/Iptc4xmpExt:rbW>/);
  const rbH = getVal(/<Iptc4xmpExt:rbH>([\d.-]+)<\/Iptc4xmpExt:rbH>/);

  const pitch = getVal(/<acx:Pitch>([\d.-]+)<\/acx:Pitch>/);
  const yaw = getVal(/<acx:Yaw>([\d.-]+)<\/acx:Yaw>/);
  const roll = getVal(/<acx:Roll>([\d.-]+)<\/acx:Roll>/);
  const name = getVal(/<Iptc4xmpExt:Name>([^<]+)<\/Iptc4xmpExt:Name>/);

  const centerX = getVal(/<acx:CenterX>([\d.-]+)<\/acx:CenterX>/);
  const centerY = getVal(/<acx:CenterY>([\d.-]+)<\/acx:CenterY>/);
  const faceWidth = getVal(/<acx:FaceWidth>([\d.-]+)<\/acx:FaceWidth>/);

  const nose = parsePoint(getVal(/<acx:Nose>([\d.,-]+)<\/acx:Nose>/));
  const eyeL = parsePoint(getVal(/<acx:EyeL>([\d.,-]+)<\/acx:EyeL>/));
  const eyeR = parsePoint(getVal(/<acx:EyeR>([\d.,-]+)<\/acx:EyeR>/));
  const eyeInnerL = parsePoint(
    getVal(/<acx:EyeInnerL>([\d.,-]+)<\/acx:EyeInnerL>/),
  );
  const eyeInnerR = parsePoint(
    getVal(/<acx:EyeInnerR>([\d.,-]+)<\/acx:EyeInnerR>/),
  );
  const mouthL = parsePoint(getVal(/<acx:MouthL>([\d.,-]+)<\/acx:MouthL>/));
  const mouthR = parsePoint(getVal(/<acx:MouthR>([\d.,-]+)<\/acx:MouthR>/));
  const chin = parsePoint(getVal(/<acx:Chin>([\d.,-]+)<\/acx:Chin>/));
  const ovalL = parsePoint(getVal(/<acx:OvalL>([\d.,-]+)<\/acx:OvalL>/));
  const ovalR = parsePoint(getVal(/<acx:OvalR>([\d.,-]+)<\/acx:OvalR>/));
  const forehead = parsePoint(
    getVal(/<acx:Forehead>([\d.,-]+)<\/acx:Forehead>/),
  );

  const noseEyeDist = getVal(/<acx:NoseEyeDist>([\d.-]+)<\/acx:NoseEyeDist>/);
  const faceScale = getVal(/<acx:FaceScale>([\d.-]+)<\/acx:FaceScale>/);
  const faceHeight = getVal(/<acx:FaceHeight>([\d.-]+)<\/acx:FaceHeight>/);
  const srcScalePx = getVal(/<acx:SrcScalePx>([\d.-]+)<\/acx:SrcScalePx>/);
  const interocularDist = getVal(
    /<acx:InterocularDist>([\d.-]+)<\/acx:InterocularDist>/,
  );
  const interocularInner = getVal(
    /<acx:InterocularInner>([\d.-]+)<\/acx:InterocularInner>/,
  );
  const interocularBlend = getVal(
    /<acx:InterocularBlend>([\d.-]+)<\/acx:InterocularBlend>/,
  );
  const eyeMouthDist = getVal(
    /<acx:EyeMouthDist>([\d.-]+)<\/acx:EyeMouthDist>/,
  );
  const ovalWidth = getVal(/<acx:OvalWidth>([\d.-]+)<\/acx:OvalWidth>/);

  const requiredFields: Record<string, unknown> = {
    rbX,
    rbY,
    rbW,
    rbH,
    pitch,
    yaw,
    roll,
    centerX,
    centerY,
    faceWidth,
    nose,
    eyeL,
    eyeR,
    eyeInnerL,
    eyeInnerR,
    mouthL,
    mouthR,
    chin,
    ovalL,
    ovalR,
    forehead,
    noseEyeDist,
    faceScale,
    faceHeight,
    srcScalePx,
    interocularDist,
    interocularInner,
    interocularBlend,
    eyeMouthDist,
    ovalWidth,
  };

  const missingFields = Object.entries(requiredFields)
    .filter(([, value]) => !value)
    .map(([field]) => field)
    .sort();

  if (missingFields.length > 0) {
    return { data: null, missingFields };
  }

  return {
    data: {
      region: {
        x: Number.parseFloat(rbX as string),
        y: Number.parseFloat(rbY as string),
        w: Number.parseFloat(rbW as string),
        h: Number.parseFloat(rbH as string),
      },
      pose: {
        pitch: Number.parseFloat(pitch as string),
        yaw: Number.parseFloat(yaw as string),
        roll: Number.parseFloat(roll as string),
      },
      center: {
        x: Number.parseFloat(centerX as string),
        y: Number.parseFloat(centerY as string),
      },
      faceWidth: Number.parseFloat(faceWidth as string),
      noseEyeDist: Number.parseFloat(noseEyeDist as string),
      faceScale: Number.parseFloat(faceScale as string),
      faceHeight: Number.parseFloat(faceHeight as string),
      srcScalePx: Number.parseFloat(srcScalePx as string),
      interocularDist: Number.parseFloat(interocularDist as string),
      interocularInner: Number.parseFloat(interocularInner as string),
      interocularBlend: Number.parseFloat(interocularBlend as string),
      eyeMouthDist: Number.parseFloat(eyeMouthDist as string),
      ovalWidth: Number.parseFloat(ovalWidth as string),
      features: {
        nose: nose as Point,
        eyes: {
          l: eyeL as Point,
          r: eyeR as Point,
          innerL: eyeInnerL as Point,
          innerR: eyeInnerR as Point,
        },
        mouth: {
          l: mouthL as Point,
          r: mouthR as Point,
        },
        chin: chin as Point,
        oval: {
          l: ovalL as Point,
          r: ovalR as Point,
        },
        forehead: forehead as Point,
      },
      name: name || undefined,
    },
    missingFields: [],
  };
};

/** Recursively collect files and return deterministic ordering. */
const getAllFiles = (dir: string): string[] => {
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

const matchesSubsetPrefix = (filePath: string, prefixes: string[]): boolean => {
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
const inferPersonName = (relativeInputPath: string): string | undefined => {
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
const collectImageFiles = (
  inputDir: string,
  subsetPrefixes: string[],
  limit: number,
): string[] => {
  const allFiles = getAllFiles(inputDir);
  let imageFiles = allFiles
    .filter((file) => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))
    .sort();

  if (subsetPrefixes.length > 0) {
    imageFiles = imageFiles.filter((filePath) =>
      matchesSubsetPrefix(filePath, subsetPrefixes),
    );
  }

  if (limit > 0) {
    imageFiles = imageFiles.slice(0, limit);
  }

  return imageFiles;
};

const createExtractionState = (): ExtractionState => {
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

const logSelection = (
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
const processImageFile = (
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
const writeExtractionOutputs = (
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

  fs.writeFileSync(
    SOURCE_METADATA_FILE,
    JSON.stringify(state.metadataList, null, 2),
  );
  console.log(
    `✅ Extracted metadata for ${state.metadataList.length} images to ${SOURCE_METADATA_FILE}`,
  );
};

const main = async (): Promise<void> => {
  const verbose = getVerbose();
  const subsetPrefixes = getSubsetPrefixes();
  const limit = getLimit();

  if (!fs.existsSync(INPUT_DIR)) {
    console.error(`❌ Input directory ${INPUT_DIR} not found.`);
    process.exitCode = 1;
    return;
  }

  const imageFiles = collectImageFiles(INPUT_DIR, subsetPrefixes, limit);
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
    console.error(
      `❌ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(
    `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
