import { XMP_HEADER } from "./constants";
import type { ParsedXmpResult, Point } from "./types";

/** Extract the raw XMP block from binary image data. */
export const extractXmp = (
  buffer: Buffer,
): { xmp: string | null; reason?: "no_xmp_header" | "no_xmp_start" | "no_xmp_end" } => {
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

export const parsePoint = (value: string | null): Point | null => {
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
export const parseXmp = (xmp: string): ParsedXmpResult => {
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
  const landmarkConfidence =
    getVal(/<acx:LandmarkConfidence>([\d.-]+)<\/acx:LandmarkConfidence>/) ??
    getVal(/<acx:DetScore>([\d.-]+)<\/acx:DetScore>/) ??
    "1";
  const interocularDist = getVal(
    /<acx:InterocularDist>([\d.-]+)<\/acx:InterocularDist>/,
  );
  const interocularInner = getVal(
    /<acx:InterocularInner>([\d.-]+)<\/acx:InterocularInner>/,
  );
  const interocularBlend = getVal(
    /<acx:InterocularBlend>([\d.-]+)<\/acx:InterocularBlend>/,
  );
  const eyeMouthDist = getVal(/<acx:EyeMouthDist>([\d.-]+)<\/acx:EyeMouthDist>/);
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
    landmarkConfidence,
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
      landmarkConfidence: Number.parseFloat(landmarkConfidence as string),
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
