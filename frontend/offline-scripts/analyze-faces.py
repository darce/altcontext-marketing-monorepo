import argparse
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, List, Optional, Tuple

import cv2
import mediapipe as mp  # type: ignore[import-untyped]
import numpy as np
from mediapipe.tasks import python  # type: ignore[import-untyped]
from mediapipe.tasks.python import vision  # type: ignore[import-untyped]
import struct

# Landmark Constants
# Indices from MediaPipe Face Landmarker
NOSE_TIP: Final[int] = 1
EYE_L_OUTER: Final[int] = 33
EYE_R_OUTER: Final[int] = 263
MOUTH_L_CORNER: Final[int] = 61
MOUTH_R_CORNER: Final[int] = 291
EYE_L_INNER: Final[int] = 133
EYE_R_INNER: Final[int] = 362
CHIN_TIP: Final[int] = 152
OVAL_L: Final[int] = 234
OVAL_R: Final[int] = 454
FOREHEAD_TOP: Final[int] = 10

# Model path relative to script
MODEL_PATH: Final[Path] = Path(__file__).parent / "face_landmarker.task"
# Lower defaults increase recall for difficult/extreme poses at the cost of noisier detections.
DEFAULT_MIN_FACE_DETECTION_CONFIDENCE: Final[float] = 0.005
DEFAULT_MIN_FACE_PRESENCE_CONFIDENCE: Final[float] = 0.01
DEFAULT_MIN_TRACKING_CONFIDENCE: Final[float] = 0.1

@dataclass(frozen=True)
class FaceMetrics:
    """Anatomical and pose metrics for a detected face."""
    pitch: float
    yaw: float
    roll: float
    center_x: float
    center_y: float
    face_width: float
    face_scale: float
    interocular_dist: float
    nose_x: float
    nose_y: float
    eye_l_x: float
    eye_l_y: float
    eye_r_x: float
    eye_r_y: float
    mouth_l_x: float
    mouth_l_y: float
    mouth_r_x: float
    mouth_r_y: float
    eye_li_x: float
    eye_li_y: float
    eye_ri_x: float
    eye_ri_y: float
    iodist_inner: float
    iodist_blend: float
    eye_mouth_dist: float
    chin_x: float
    chin_y: float
    oval_l_x: float
    oval_l_y: float
    oval_r_x: float
    oval_r_y: float
    oval_width: float
    forehead_x: float
    forehead_y: float
    face_height: float
    src_scale_px: float
    nose_eye_dist: float
    score: float


@dataclass(frozen=True)
class SimpleLandmark:
    x: float
    y: float
    z: float = 0.0


@dataclass
class DetectionReport:
    """Aggregate detection outcomes for a single analyze-faces run."""
    total_images: int = 0
    mediapipe_no_face: List[str] = field(default_factory=list)
    no_face: List[str] = field(default_factory=list)
    missing_matrix: List[str] = field(default_factory=list)
    mediapipe_errors: List[str] = field(default_factory=list)


def get_euler_angles(rmat: np.ndarray) -> Tuple[float, float, float]:
    """
    Decompose 3x3 rotation matrix into Euler angles (Pitch, Yaw, Roll) in degrees.
    rmat: top-left 3x3 of facial transformation matrix.
    """
    sy = np.sqrt(rmat[0, 0] * rmat[0, 0] + rmat[1, 0] * rmat[1, 0])
    singular = sy < 1e-6
    if not singular:
        pitch = np.degrees(np.arctan2(rmat[2, 1], rmat[2, 2]))
        yaw = np.degrees(np.arctan2(-rmat[2, 0], sy))
        roll = np.degrees(np.arctan2(rmat[1, 0], rmat[0, 0]))
    else:
        pitch = np.degrees(np.arctan2(-rmat[1, 2], rmat[1, 1]))
        yaw = np.degrees(np.arctan2(-rmat[2, 0], sy))
        roll = 0.0
    return float(pitch), float(yaw), float(roll)

def compute_face_metrics(
    landmarks: List[SimpleLandmark],
    matrix_data: Optional[bytes],
    score: float
) -> FaceMetrics:
    """Pure function to calculate metrics from landmarks and transformation matrix."""
    
    # 1) Pose from Matrix
    pitch, yaw, roll = 0.0, 0.0, 0.0
    if matrix_data:
        # Buffer contiguity fix: use tobytes() then unpack 16 floats (4x4 matrix)
        m_floats = struct.unpack('<16f', matrix_data)
        # Reshape to 4x4
        rmat = np.array(m_floats).reshape(4, 4)[:3, :3]
        pitch, yaw, roll = get_euler_angles(rmat)

    # 2) Key Points
    p_nose = landmarks[NOSE_TIP]
    p_eye_l = landmarks[EYE_L_OUTER]
    p_eye_r = landmarks[EYE_R_OUTER]
    p_mouth_l = landmarks[MOUTH_L_CORNER]
    p_mouth_r = landmarks[MOUTH_R_CORNER]
    p_eye_li = landmarks[EYE_L_INNER]
    p_eye_ri = landmarks[EYE_R_INNER]
    p_chin = landmarks[CHIN_TIP]
    p_oval_l = landmarks[OVAL_L]
    p_oval_r = landmarks[OVAL_R]
    p_forehead = landmarks[FOREHEAD_TOP]

    # 3) Scaling and Distances
    # 3D Euclidean distance (legacy, but kept for now)
    fscale = float(np.sqrt(
        (p_eye_r.x - p_eye_l.x)**2 + 
        (p_eye_r.y - p_eye_l.y)**2 + 
        (p_eye_r.z - p_eye_l.z)**2
    ))
    
    # 2D Distances
    iodist_outer = float(np.sqrt((p_eye_r.x - p_eye_l.x)**2 + (p_eye_r.y - p_eye_l.y)**2))
    iodist_inner = float(np.sqrt((p_eye_ri.x - p_eye_li.x)**2 + (p_eye_ri.y - p_eye_li.y)**2))
    iodist_blend = 0.6 * iodist_inner + 0.4 * iodist_outer

    mid_eye_x = (p_eye_l.x + p_eye_r.x) * 0.5
    mid_eye_y = (p_eye_l.y + p_eye_r.y) * 0.5
    mid_mouth_x = (p_mouth_l.x + p_mouth_r.x) * 0.5
    mid_mouth_y = (p_mouth_l.y + p_mouth_r.y) * 0.5
    eye_mouth_dist = float(np.sqrt((mid_mouth_x - mid_eye_x)**2 + (mid_mouth_y - mid_eye_y)**2))

    oval_width = float(np.sqrt((p_oval_r.x - p_oval_l.x)**2 + (p_oval_r.y - p_oval_l.y)**2))
    nedist = float(np.sqrt((p_nose.x - p_eye_l.x)**2 + (p_nose.y - p_eye_l.y)**2))

    # Face Height (Forehead to Chin)
    face_height = float(np.sqrt((p_forehead.x - p_chin.x)**2 + (p_forehead.y - p_chin.y)**2))

    # Pattern A: Source Scale Pixel (blended metric)
    # srcScalePx = 0.55*iodistBlend + 0.30*ovalWidth + 0.15*faceHeight
    # All inputs are normalized (0..1), so src_scale_px is also normalized relative to image size.
    # Note: The JS side will multiply these by image dimensions.
    src_scale_px = 0.55 * iodist_blend + 0.30 * oval_width + 0.15 * face_height

    # 4) Bounding Box Metrics
    x_coords = [lm.x for lm in landmarks]
    raw_bw = max(x_coords) - min(x_coords)

    return FaceMetrics(
        pitch=round(pitch, 2),
        yaw=round(yaw, 2),
        roll=round(roll, 2),
        center_x=round(p_eye_l.x, 4),
        center_y=round(p_eye_l.y, 4),
        face_width=round(raw_bw, 4),
        face_scale=round(fscale, 6),
        interocular_dist=round(iodist_outer, 6),
        nose_x=round(p_nose.x, 4),
        nose_y=round(p_nose.y, 4),
        eye_l_x=round(p_eye_l.x, 4),
        eye_l_y=round(p_eye_l.y, 4),
        eye_r_x=round(p_eye_r.x, 4),
        eye_r_y=round(p_eye_r.y, 4),
        mouth_l_x=round(p_mouth_l.x, 4),
        mouth_l_y=round(p_mouth_l.y, 4),
        mouth_r_x=round(p_mouth_r.x, 4),
        mouth_r_y=round(p_mouth_r.y, 4),
        eye_li_x=round(p_eye_li.x, 4),
        eye_li_y=round(p_eye_li.y, 4),
        eye_ri_x=round(p_eye_ri.x, 4),
        eye_ri_y=round(p_eye_ri.y, 4),
        iodist_inner=round(iodist_inner, 6),
        iodist_blend=round(iodist_blend, 6),
        eye_mouth_dist=round(eye_mouth_dist, 6),
        chin_x=round(p_chin.x, 4),
        chin_y=round(p_chin.y, 4),
        oval_l_x=round(p_oval_l.x, 4),
        oval_l_y=round(p_oval_l.y, 4),
        oval_r_x=round(p_oval_r.x, 4),
        oval_r_y=round(p_oval_r.y, 4),
        oval_width=round(oval_width, 6),
        forehead_x=round(p_forehead.x, 4),
        forehead_y=round(p_forehead.y, 4),
        face_height=round(face_height, 6),
        src_scale_px=round(src_scale_px, 6),
        nose_eye_dist=round(nedist, 6),
        score=round(score, 3)
    )

def generate_xmp(metrics: FaceMetrics, name: str, landmarks: List[SimpleLandmark]) -> str:
    """Generate XMP metadata string from metrics."""
    # Padding calculation for the display region (legacy compat)
    x_coords = [lm.x for lm in landmarks]
    y_coords = [lm.y for lm in landmarks]
    raw_bx, raw_by = min(x_coords), min(y_coords)
    raw_bw, raw_bh = max(x_coords) - raw_bx, max(y_coords) - raw_by
    
    padding_w, padding_h = raw_bw * 0.25, raw_bh * 0.25
    bx = max(0.0, raw_bx - padding_w)
    by = max(0.0, raw_by - padding_h)
    bw = min(1.0 - bx, raw_bw + 2 * padding_w)
    bh = min(1.0 - by, raw_bh + 2 * padding_h)

    return f"""<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description
      xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"
      xmlns:acx="http://alt-context.dev/ns/1.0/">
      <Iptc4xmpExt:ImageRegion>
        <rdf:Bag>
          <rdf:li>
            <Iptc4xmpExt:RegionBoundary>
              <Iptc4xmpExt:rbShape>rectangle</Iptc4xmpExt:rbShape>
              <Iptc4xmpExt:rbX>{bx:.3f}</Iptc4xmpExt:rbX>
              <Iptc4xmpExt:rbY>{by:.3f}</Iptc4xmpExt:rbY>
              <Iptc4xmpExt:rbW>{bw:.3f}</Iptc4xmpExt:rbW>
              <Iptc4xmpExt:rbH>{bh:.3f}</Iptc4xmpExt:rbH>
              <Iptc4xmpExt:rbUnit>relative</Iptc4xmpExt:rbUnit>
            </Iptc4xmpExt:RegionBoundary>
            <Iptc4xmpExt:Name>{name}</Iptc4xmpExt:Name>
            <acx:Pitch>{metrics.pitch:.2f}</acx:Pitch>
            <acx:Yaw>{metrics.yaw:.2f}</acx:Yaw>
            <acx:Roll>{metrics.roll:.2f}</acx:Roll>
            <acx:CenterX>{metrics.center_x:.4f}</acx:CenterX>
            <acx:CenterY>{metrics.center_y:.4f}</acx:CenterY>
            <acx:FaceWidth>{metrics.face_width:.4f}</acx:FaceWidth>
            <acx:FaceScale>{metrics.face_scale:.6f}</acx:FaceScale>
            <acx:InterocularDist>{metrics.interocular_dist:.6f}</acx:InterocularDist>
            <acx:InterocularInner>{metrics.iodist_inner:.6f}</acx:InterocularInner>
            <acx:InterocularBlend>{metrics.iodist_blend:.6f}</acx:InterocularBlend>
            <acx:EyeMouthDist>{metrics.eye_mouth_dist:.6f}</acx:EyeMouthDist>
            <acx:OvalWidth>{metrics.oval_width:.6f}</acx:OvalWidth>
            <acx:Nose>{metrics.nose_x:.4f},{metrics.nose_y:.4f}</acx:Nose>
            <acx:EyeL>{metrics.eye_l_x:.4f},{metrics.eye_l_y:.4f}</acx:EyeL>
            <acx:EyeR>{metrics.eye_r_x:.4f},{metrics.eye_r_y:.4f}</acx:EyeR>
            <acx:EyeInnerL>{metrics.eye_li_x:.4f},{metrics.eye_li_y:.4f}</acx:EyeInnerL>
            <acx:EyeInnerR>{metrics.eye_ri_x:.4f},{metrics.eye_ri_y:.4f}</acx:EyeInnerR>
            <acx:MouthL>{metrics.mouth_l_x:.4f},{metrics.mouth_l_y:.4f}</acx:MouthL>
            <acx:MouthR>{metrics.mouth_r_x:.4f},{metrics.mouth_r_y:.4f}</acx:MouthR>
            <acx:Chin>{metrics.chin_x:.4f},{metrics.chin_y:.4f}</acx:Chin>
            <acx:OvalL>{metrics.oval_l_x:.4f},{metrics.oval_l_y:.4f}</acx:OvalL>
            <acx:OvalR>{metrics.oval_r_x:.4f},{metrics.oval_r_y:.4f}</acx:OvalR>
            <acx:Forehead>{metrics.forehead_x:.4f},{metrics.forehead_y:.4f}</acx:Forehead>
            <acx:FaceHeight>{metrics.face_height:.6f}</acx:FaceHeight>
            <acx:SrcScalePx>{metrics.src_scale_px:.6f}</acx:SrcScalePx>
            <acx:NoseEyeDist>{metrics.nose_eye_dist:.6f}</acx:NoseEyeDist>
            <acx:DetScore>{metrics.score:.3f}</acx:DetScore>
          </rdf:li>
        </rdf:Bag>
      </Iptc4xmpExt:ImageRegion>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>"""

def inject_xmp(image_path: Path, xmp_str: str) -> bool:
    """Inject XMP metadata packet into a JPEG file."""
    try:
        data = image_path.read_bytes()
        xmp_header = b'http://ns.adobe.com/xap/1.0/\0'
        xmp_packet = xmp_str.encode('utf-8')
        
        seg_len = 2 + len(xmp_header) + len(xmp_packet)
        app1_head = b'\xff\xe1' + seg_len.to_bytes(2, 'big')
        
        if data[:2] != b'\xff\xd8':
            return False

        new_data = data[:2] + app1_head + xmp_header + xmp_packet + data[2:]
        image_path.write_bytes(new_data)
        return True
    except Exception as e:
        print(f"  [!] Failed to inject XMP into {image_path}: {e}")
        return False


def append_xmp_payload(image_path: Path, xmp_str: str) -> bool:
    """Append scan-friendly XMP payload for non-JPEG/invalid-JPEG files."""
    try:
        data = image_path.read_bytes()
        marker = b"http://ns.adobe.com/xap/1.0/\0"
        image_path.write_bytes(data + marker + xmp_str.encode("utf-8"))
        return True
    except Exception as e:
        print(f"  [!] Failed to append XMP payload to {image_path}: {e}")
        return False


def write_xmp_to_source(image_path: Path, xmp: str, verbose: bool = False) -> None:
    """Persist generated XMP in source image bytes with a robust fallback path."""
    if image_path.suffix.lower() in ['.jpg', '.jpeg']:
        if inject_xmp(image_path, xmp):
            if verbose:
                print(f"  [+] Injected XMP into source {image_path.name}")
            return
        if append_xmp_payload(image_path, xmp):
            if verbose:
                print(f"  [+] Appended fallback XMP payload to {image_path.name}")
            return
        print(f"  [!] Failed to inject/append XMP for source {image_path.name}")
        return

    if append_xmp_payload(image_path, xmp):
        if verbose:
            print(f"  [+] Appended XMP payload to non-JPEG source {image_path.name}")
    else:
        print(f"  [!] Failed to append XMP payload to {image_path.name}")

def setup_detector(
    model_path: Path,
    min_face_detection_confidence: float,
    min_face_presence_confidence: float,
    min_tracking_confidence: float,
) -> Optional[vision.FaceLandmarker]:
    """Initialize MediaPipe Face Landmarker."""
    # Force CPU delegate to avoid OpenGL/GPU initialization failures in headless CI/dev shells.
    base_options = python.BaseOptions(
        model_asset_path=str(model_path),
        delegate=python.BaseOptions.Delegate.CPU
    )
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        min_face_detection_confidence=min_face_detection_confidence,
        min_face_presence_confidence=min_face_presence_confidence,
        min_tracking_confidence=min_tracking_confidence,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
        num_faces=1
    )
    try:
        return vision.FaceLandmarker.create_from_options(options)
    except Exception as e:
        print(f"[!] MediaPipe Task detector unavailable ({e}).")
        return None


def has_required_pose_xmp(image_path: Path) -> bool:
    """
    Return True when the image bytes contain the required ACX pose tags.
    This mirrors the minimum contract expected by build/extract-metadata.ts.
    """
    try:
        data = image_path.read_bytes()
    except Exception:
        return False

    required_tags = (
        b"<Iptc4xmpExt:rbX>",
        b"<Iptc4xmpExt:rbY>",
        b"<Iptc4xmpExt:rbW>",
        b"<Iptc4xmpExt:rbH>",
        b"<acx:Pitch>",
        b"<acx:Yaw>",
        b"<acx:Roll>",
        b"<acx:Nose>",
        b"<acx:EyeL>",
        b"<acx:EyeR>",
        b"<acx:MouthL>",
        b"<acx:MouthR>",
        b"<acx:Chin>",
        b"<acx:Forehead>",
        b"<acx:SrcScalePx>",
    )
    return all(tag in data for tag in required_tags)

def process_image(
    detector: Optional[vision.FaceLandmarker],
    image_path: Path,
    out_dir: Path,
    report: DetectionReport,
    verbose: bool = False
) -> None:
    """Process one image with MediaPipe-only detection and emit ACX metadata."""
    report.total_images += 1
    if verbose:
        print(f"Processing {image_path.name}...")

    # 1. Read original bytes.
    image_cv = cv2.imread(str(image_path))
    if image_cv is None:
        print(f"  [!] Could not read {image_path}; skipping.")
        report.no_face.append(str(image_path))
        return

    # 2. MediaPipe-only detection.
    if detector is None:
        report.mediapipe_errors.append(str(image_path))
        report.no_face.append(str(image_path))
        return

    try:
        image_rgb = cv2.cvtColor(image_cv, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
        result = detector.detect(mp_image)
    except Exception as error:
        report.mediapipe_errors.append(str(image_path))
        report.no_face.append(str(image_path))
        if verbose:
            print(f"  [i] MediaPipe error for {image_path.name}: {error}")
        return

    if not result.face_landmarks:
        report.mediapipe_no_face.append(str(image_path))
        report.no_face.append(str(image_path))
        return

    if not result.facial_transformation_matrixes:
        report.missing_matrix.append(str(image_path))
        report.no_face.append(str(image_path))
        return

    landmarks = [SimpleLandmark(lm.x, lm.y, lm.z) for lm in result.face_landmarks[0]]
    matrix_data = result.facial_transformation_matrixes[0].data.tobytes()
    metrics = compute_face_metrics(landmarks, matrix_data, 1.0)

    name_parts = image_path.stem.split('_')
    name = name_parts[0].capitalize() if name_parts else "Unknown"
    xmp = generate_xmp(metrics, name, landmarks)
    write_xmp_to_source(image_path, xmp, verbose)

    # 3. Save clean WebP (visual asset) to output directory.
    out_name = image_path.stem + ".webp"
    out_path = out_dir / out_name
    
    success, enc_buf = cv2.imencode(".webp", image_cv, [int(cv2.IMWRITE_WEBP_QUALITY), 80])
    if success:
        out_path.write_bytes(enc_buf.tobytes())
        if verbose:
            print(f"  [+] Saved visual WebP to {out_name}")
    else:
        print(f"  [!] Failed to encode WebP for {out_name}")


def print_detection_report(report: DetectionReport) -> None:
    """Print a concise run report with explicit no-face image listings."""
    print("Detection report:")
    print(f"- Total images processed: {report.total_images}")
    print(f"- MediaPipe returned no face: {len(report.mediapipe_no_face)}")
    print(f"- Missing transformation matrix: {len(report.missing_matrix)}")
    print(f"- MediaPipe errors/unavailable: {len(report.mediapipe_errors)}")
    print(f"- No usable MediaPipe result: {len(report.no_face)}")

    if report.no_face:
        print("No-face images:")
        for image_path in sorted(report.no_face):
            print(f"  - {image_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract face pose metrics and inject as XMP.")
    parser.add_argument("--in-dir", type=str, default="input-images/celebs", help="Directory containing source images.")
    parser.add_argument("--out-dir", type=str, default="public/input-images", help="Directory to save optimized WebP images.")
    parser.add_argument("--limit", type=int, default=0, help="Max number of images to process (0 for no limit).")
    parser.add_argument("--verbose", action="store_true", help="Print detailed status per image.")
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Process only images that are missing required ACX pose metadata tags."
    )
    parser.add_argument(
        "--min-face-detection-confidence",
        type=float,
        default=DEFAULT_MIN_FACE_DETECTION_CONFIDENCE,
        help="MediaPipe minimum detection confidence (lower is noisier).",
    )
    parser.add_argument(
        "--min-face-presence-confidence",
        type=float,
        default=DEFAULT_MIN_FACE_PRESENCE_CONFIDENCE,
        help="MediaPipe minimum face presence confidence (lower is noisier).",
    )
    parser.add_argument(
        "--min-tracking-confidence",
        type=float,
        default=DEFAULT_MIN_TRACKING_CONFIDENCE,
        help="MediaPipe tracking confidence (mainly relevant in VIDEO/LIVE modes).",
    )
    args = parser.parse_args()

    in_path = Path(args.in_dir)
    if not in_path.exists():
        print(f"Error: Directory {in_path} does not exist.")
        exit(1)

    out_path = Path(args.out_dir)
    if not out_path.exists():
        out_path.mkdir(parents=True, exist_ok=True)

    detector: Optional[vision.FaceLandmarker] = None
    if MODEL_PATH.exists():
        detector = setup_detector(
            MODEL_PATH,
            args.min_face_detection_confidence,
            args.min_face_presence_confidence,
            args.min_tracking_confidence,
        )
    else:
        print(f"[!] Model not found at {MODEL_PATH}.")
    
    # Deterministic sorting
    files = sorted([p for p in in_path.rglob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}])
    if args.only_missing:
        files = [p for p in files if not has_required_pose_xmp(p)]
        print(f"Found {len(files)} images missing required pose metadata.")
    
    report = DetectionReport()
    count = 0
    for f in files:
        if args.limit > 0 and count >= args.limit:
            break
        process_image(detector, f, out_path, report, args.verbose)
        count += 1

    print(f"Done. Processed {count} images.")
    print_detection_report(report)

if __name__ == "__main__":
    main()
