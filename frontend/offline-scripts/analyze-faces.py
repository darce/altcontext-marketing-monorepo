import argparse
from dataclasses import dataclass, field, replace
import json
import os
from pathlib import Path
from typing import Final, List, Optional

import cv2
import mediapipe as mp  # type: ignore[import-untyped]
import numpy as np
from mediapipe.tasks import python  # type: ignore[import-untyped]
from mediapipe.tasks.python import vision  # type: ignore[import-untyped]
import struct

from face_metrics import (
    EYE_L_INNER,
    EYE_L_OUTER,
    EYE_R_INNER,
    EYE_R_OUTER,
    MOUTH_L_CORNER,
    MOUTH_R_CORNER,
    OVAL_L,
    OVAL_R,
    FaceMetrics,
    SimpleLandmark,
    compute_face_metrics,
)
from xmp_io import generate_xmp, write_xmp_to_source

SCRIPT_DIR: Final[Path] = Path(__file__).resolve().parent
FRONTEND_ROOT: Final[Path] = SCRIPT_DIR.parent
DEFAULT_MODEL_CANDIDATES: Final[tuple[Path, ...]] = (
    SCRIPT_DIR / "face_landmarker.task",
    SCRIPT_DIR / "models" / "face_landmarker.task",
    FRONTEND_ROOT / "models" / "face_landmarker.task",
    FRONTEND_ROOT / "face_landmarker.task",
)
MODEL_ENV_VAR: Final[str] = "MEDIAPIPE_FACE_LANDMARKER_MODEL"
# Lower defaults increase recall for difficult/extreme poses at the cost of noisier detections.
DEFAULT_MIN_FACE_DETECTION_CONFIDENCE: Final[float] = 0.005
DEFAULT_MIN_FACE_PRESENCE_CONFIDENCE: Final[float] = 0.01
DEFAULT_MIN_TRACKING_CONFIDENCE: Final[float] = 0.1
SUPPORTED_IMAGE_EXTENSIONS: Final[set[str]] = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
}
DEFAULT_MISSING_REPORT_PATH: Final[str] = "build/generated/missing-pose-metadata.json"
MIN_LANDMARK_CONFIDENCE: Final[float] = 0.75


@dataclass
class DetectionReport:
    """Aggregate detection outcomes for a single analyze-faces run."""

    total_images: int = 0
    mediapipe_no_face: List[str] = field(default_factory=list)
    no_face: List[str] = field(default_factory=list)
    missing_matrix: List[str] = field(default_factory=list)
    mediapipe_errors: List[str] = field(default_factory=list)
    low_confidence: List[str] = field(default_factory=list)
    error_types: dict[str, int] = field(default_factory=dict)


def to_report_relative_path(path_str: str, input_root: Path) -> str:
    """Render report paths relative to input root when possible."""
    path_value = Path(path_str)
    try:
        return str(path_value.resolve().relative_to(input_root.resolve()))
    except Exception:
        return str(path_value)


def write_unusable_report(
    report: DetectionReport,
    input_root: Path,
    output_path: Path,
) -> None:
    """Persist unusable-image report suitable for scripted deletions."""
    no_face_paths = sorted(
        {to_report_relative_path(path_value, input_root) for path_value in report.no_face}
    )
    low_confidence_paths = sorted(
        {
            to_report_relative_path(path_value, input_root)
            for path_value in report.low_confidence
        }
    )
    deletion_candidates = sorted(set(no_face_paths + low_confidence_paths))
    payload = {
        "inputDir": str(input_root),
        "totalImagesProcessed": report.total_images,
        "noFaceCount": len(no_face_paths),
        "lowConfidenceCount": len(low_confidence_paths),
        "deletionCandidateCount": len(deletion_candidates),
        "deletionCandidates": deletion_candidates,
        "byCategory": {
            "noFaceOrDetectionError": no_face_paths,
            "lowLandmarkConfidence": low_confidence_paths,
        },
        "errorTypes": report.error_types,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


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
        delegate=python.BaseOptions.Delegate.CPU,
    )
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        min_face_detection_confidence=min_face_detection_confidence,
        min_face_presence_confidence=min_face_presence_confidence,
        min_tracking_confidence=min_tracking_confidence,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
        num_faces=1,
    )
    try:
        return vision.FaceLandmarker.create_from_options(options)
    except Exception as e:
        print(f"[!] MediaPipe Task detector unavailable ({e}).")
        return None


def detect_with_mediapipe(
    detector: vision.FaceLandmarker,
    image_rgb: np.ndarray,
) -> vision.FaceLandmarkerResult:
    """Run one MediaPipe detection pass for a given RGB frame."""
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)
    return detector.detect(mp_image)


def average_landmarks(
    primary: List[SimpleLandmark],
    secondary: List[SimpleLandmark],
) -> List[SimpleLandmark]:
    """Average two landmark sets when both detections are available."""
    if len(primary) != len(secondary):
        return primary

    averaged: List[SimpleLandmark] = []
    for idx in range(len(primary)):
        p = primary[idx]
        s = secondary[idx]
        averaged.append(
            SimpleLandmark(
                x=(p.x + s.x) * 0.5,
                y=(p.y + s.y) * 0.5,
                z=(p.z + s.z) * 0.5,
                visibility=(p.visibility + s.visibility) * 0.5,
                presence=(p.presence + s.presence) * 0.5,
            )
        )
    return averaged


def average_matrix_bytes(primary: bytes, secondary: bytes) -> bytes:
    """Average two 4x4 transform matrices (16 float32 values each)."""
    primary_values = np.array(struct.unpack("<16f", primary), dtype=np.float32)
    secondary_values = np.array(struct.unpack("<16f", secondary), dtype=np.float32)
    averaged_values = (primary_values + secondary_values) * 0.5
    return struct.pack("<16f", *averaged_values.tolist())


def to_landmark_confidence(value: object) -> float:
    """Normalize MediaPipe visibility/presence values to [0, 1]."""
    if isinstance(value, (float, int)):
        numeric = float(value)
        if np.isfinite(numeric):
            return float(max(0.0, min(1.0, numeric)))
    return 1.0


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
        b"<acx:CenterX>",
        b"<acx:CenterY>",
        b"<acx:FaceWidth>",
        b"<acx:Nose>",
        b"<acx:EyeL>",
        b"<acx:EyeR>",
        b"<acx:EyeInnerL>",
        b"<acx:EyeInnerR>",
        b"<acx:MouthL>",
        b"<acx:MouthR>",
        b"<acx:Chin>",
        b"<acx:OvalL>",
        b"<acx:OvalR>",
        b"<acx:Forehead>",
        b"<acx:NoseEyeDist>",
        b"<acx:FaceScale>",
        b"<acx:FaceHeight>",
        b"<acx:SrcScalePx>",
        b"<acx:InterocularDist>",
        b"<acx:InterocularInner>",
        b"<acx:InterocularBlend>",
        b"<acx:EyeMouthDist>",
        b"<acx:OvalWidth>",
        b"<acx:LandmarkConfidence>",
    )
    return all(tag in data for tag in required_tags)


def load_missing_report_paths(in_path: Path, report_path: Path) -> List[Path]:
    """Resolve report entries to concrete files so analyze-faces matches extract-metadata output."""
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    missing_entries = payload.get("missing")
    if not isinstance(missing_entries, list):
        return []

    resolved_paths: List[Path] = []
    seen: set[Path] = set()
    input_parent = in_path.parent

    for entry in missing_entries:
        if not isinstance(entry, dict):
            continue
        file_value = entry.get("file")
        if not isinstance(file_value, str) or not file_value.strip():
            continue

        relative = Path(file_value)
        candidates = [in_path / relative, input_parent / relative]
        chosen: Optional[Path] = None
        for candidate in candidates:
            if candidate.exists() and candidate.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS:
                chosen = candidate
                break

        if chosen is None:
            fallback_matches = sorted(in_path.rglob(relative.name))
            fallback_matches = [
                candidate
                for candidate in fallback_matches
                if candidate.is_file()
                and candidate.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS
            ]
            if fallback_matches:
                chosen = fallback_matches[0]

        if chosen is None or chosen.stem.endswith("_mirror"):
            continue
        if chosen in seen:
            continue
        seen.add(chosen)
        resolved_paths.append(chosen)

    return sorted(resolved_paths)


def build_mirrored_landmarks(landmarks: List[SimpleLandmark]) -> List[SimpleLandmark]:
    """Mirror landmarks across the X axis and swap left/right semantic pairs."""
    mirrored = [
        SimpleLandmark(
            x=1.0 - lm.x,
            y=lm.y,
            z=lm.z,
            visibility=lm.visibility,
            presence=lm.presence,
        )
        for lm in landmarks
    ]
    swap_pairs = [
        (EYE_L_OUTER, EYE_R_OUTER),
        (EYE_L_INNER, EYE_R_INNER),
        (MOUTH_L_CORNER, MOUTH_R_CORNER),
        (OVAL_L, OVAL_R),
    ]
    for left_idx, right_idx in swap_pairs:
        mirrored[left_idx], mirrored[right_idx] = mirrored[right_idx], mirrored[left_idx]
    return mirrored


def build_mirrored_metrics(
    original: FaceMetrics,
    mirrored_landmarks: List[SimpleLandmark],
) -> FaceMetrics:
    """Recompute mirrored geometry and enforce mirrored pose semantics."""
    mirrored = compute_face_metrics(mirrored_landmarks, None, original.score)
    return replace(
        mirrored,
        pitch=original.pitch,
        yaw=round(-original.yaw, 2),
        roll=round(-original.roll, 2),
    )


def write_mirrored_source(
    source_path: Path,
    mirrored_image: np.ndarray,
    verbose: bool,
) -> Optional[Path]:
    """Persist mirrored source image alongside the original with `_mirror` suffix."""
    mirror_path = source_path.with_name(
        f"{source_path.stem}_mirror{source_path.suffix}"
    )
    success = cv2.imwrite(str(mirror_path), mirrored_image)
    if not success:
        print(f"  [!] Failed to write mirrored source {mirror_path.name}")
        return None
    if verbose:
        print(f"  [+] Saved mirrored source to {mirror_path.name}")
    return mirror_path


def process_image(
    detector: Optional[vision.FaceLandmarker],
    image_path: Path,
    out_dir: Path,
    report: DetectionReport,
    verbose: bool = False,
    use_landmark_averaging: bool = False,
    mirror_output: bool = False,
) -> None:
    """Process one image with MediaPipe-only detection and emit ACX metadata."""
    report.total_images += 1
    if verbose:
        print(f"Processing {image_path.name}...")

    image_cv = cv2.imread(str(image_path))
    if image_cv is None:
        print(f"  [!] Could not read {image_path}; skipping.")
        report.no_face.append(str(image_path))
        return

    if detector is None:
        report.mediapipe_errors.append(str(image_path))
        report.error_types["detector_unavailable"] = (
            report.error_types.get("detector_unavailable", 0) + 1
        )
        report.no_face.append(str(image_path))
        return

    try:
        image_rgb = cv2.cvtColor(image_cv, cv2.COLOR_BGR2RGB)
        result = detect_with_mediapipe(detector, image_rgb)
    except Exception as error:
        report.mediapipe_errors.append(str(image_path))
        error_key = type(error).__name__
        report.error_types[error_key] = report.error_types.get(error_key, 0) + 1
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

    landmarks = [
        SimpleLandmark(
            lm.x,
            lm.y,
            lm.z,
            to_landmark_confidence(getattr(lm, "visibility", 1.0)),
            to_landmark_confidence(getattr(lm, "presence", 1.0)),
        )
        for lm in result.face_landmarks[0]
    ]
    matrix_data = result.facial_transformation_matrixes[0].data.tobytes()
    if use_landmark_averaging:
        try:
            upscaled_rgb = cv2.resize(
                image_rgb,
                None,
                fx=2.0,
                fy=2.0,
                interpolation=cv2.INTER_CUBIC,
            )
            upscaled_result = detect_with_mediapipe(detector, upscaled_rgb)
            if (
                upscaled_result.face_landmarks
                and upscaled_result.facial_transformation_matrixes
            ):
                upscaled_landmarks = [
                    SimpleLandmark(
                        lm.x,
                        lm.y,
                        lm.z,
                        to_landmark_confidence(getattr(lm, "visibility", 1.0)),
                        to_landmark_confidence(getattr(lm, "presence", 1.0)),
                    )
                    for lm in upscaled_result.face_landmarks[0]
                ]
                upscaled_matrix_data = (
                    upscaled_result.facial_transformation_matrixes[0]
                    .data
                    .tobytes()
                )
                landmarks = average_landmarks(landmarks, upscaled_landmarks)
                matrix_data = average_matrix_bytes(matrix_data, upscaled_matrix_data)
        except Exception as error:
            if verbose:
                print(f"  [i] Upscaled averaging skipped for {image_path.name}: {error}")

    metrics = compute_face_metrics(landmarks, matrix_data, 1.0)

    if metrics.landmark_confidence < MIN_LANDMARK_CONFIDENCE:
        report.low_confidence.append(str(image_path))
        if verbose:
            print(
                f"  [i] Skipped {image_path.name}: landmark confidence "
                f"{metrics.landmark_confidence:.3f} < {MIN_LANDMARK_CONFIDENCE}"
            )
        return

    name_parts = image_path.stem.split("_")
    name = name_parts[0].capitalize() if name_parts else "Unknown"
    xmp = generate_xmp(metrics, name, landmarks)
    write_xmp_to_source(image_path, xmp, verbose)

    out_name = image_path.stem + ".webp"
    out_path = out_dir / out_name

    success, enc_buf = cv2.imencode(".webp", image_cv, [int(cv2.IMWRITE_WEBP_QUALITY), 80])
    if success:
        out_path.write_bytes(enc_buf.tobytes())
        if verbose:
            print(f"  [+] Saved visual WebP to {out_name}")
    else:
        print(f"  [!] Failed to encode WebP for {out_name}")

    if mirror_output and not image_path.stem.endswith("_mirror"):
        mirrored_image = cv2.flip(image_cv, 1)
        mirrored_landmarks = build_mirrored_landmarks(landmarks)
        mirrored_metrics = build_mirrored_metrics(metrics, mirrored_landmarks)
        mirrored_name = f"{name} Mirror"
        mirrored_xmp = generate_xmp(mirrored_metrics, mirrored_name, mirrored_landmarks)

        mirrored_source_path = write_mirrored_source(image_path, mirrored_image, verbose)
        if mirrored_source_path is not None:
            write_xmp_to_source(mirrored_source_path, mirrored_xmp, verbose)

        mirror_out_name = image_path.stem + "_mirror.webp"
        mirror_out_path = out_dir / mirror_out_name
        mirror_success, mirror_buf = cv2.imencode(
            ".webp",
            mirrored_image,
            [int(cv2.IMWRITE_WEBP_QUALITY), 80],
        )
        if mirror_success:
            mirror_out_path.write_bytes(mirror_buf.tobytes())
            if verbose:
                print(f"  [+] Saved mirrored visual WebP to {mirror_out_name}")
        else:
            print(f"  [!] Failed to encode mirrored WebP for {mirror_out_name}")


def print_detection_report(report: DetectionReport) -> None:
    """Print a concise run report with explicit no-face image listings."""
    print("Detection report:")
    print(f"- Total images processed: {report.total_images}")
    print(f"- MediaPipe returned no face: {len(report.mediapipe_no_face)}")
    print(f"- Missing transformation matrix: {len(report.missing_matrix)}")
    print(f"- MediaPipe errors/unavailable: {len(report.mediapipe_errors)}")
    print(f"- Low landmark confidence (skipped): {len(report.low_confidence)}")
    print(f"- No usable MediaPipe result: {len(report.no_face)}")
    if report.error_types:
        print("MediaPipe error types:")
        for error_name, count in sorted(
            report.error_types.items(),
            key=lambda item: item[1],
            reverse=True,
        )[:8]:
            print(f"  - {error_name}: {count}")

    if report.no_face:
        print("No-face images:")
        for image_path in sorted(report.no_face):
            print(f"  - {image_path}")


def resolve_frontend_path(path_arg: str) -> Path:
    """Resolve path args with cwd-first semantics, then frontend-root fallback."""
    candidate = Path(path_arg).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()

    # Respect explicit user-provided relative paths from current working directory.
    cwd_candidate = candidate.resolve()
    if cwd_candidate.exists():
        return cwd_candidate

    # Fall back to frontend-root-relative resolution for default arguments.
    return (FRONTEND_ROOT / candidate).resolve()


def resolve_model_path(model_path_arg: Optional[str]) -> Path:
    """Resolve the Face Landmarker model path from arg, env, or default locations."""
    if model_path_arg:
        model_candidate = Path(model_path_arg).expanduser()
        return model_candidate.resolve() if model_candidate.is_absolute() else resolve_frontend_path(model_path_arg)

    env_path = (Path.cwd() / ".").resolve()
    raw_env = os.getenv(MODEL_ENV_VAR)

    if raw_env:
        env_candidate = Path(raw_env).expanduser()
        if env_candidate.is_absolute():
            return env_candidate.resolve()
        return (env_path / env_candidate).resolve()

    for candidate in DEFAULT_MODEL_CANDIDATES:
        if candidate.exists():
            return candidate.resolve()

    return DEFAULT_MODEL_CANDIDATES[0].resolve()


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract face pose metrics and inject as XMP.")
    parser.add_argument(
        "--in-dir",
        type=str,
        default="input-images",
        help="Directory containing source images (relative to frontend/ when not absolute).",
    )
    parser.add_argument(
        "--out-dir",
        type=str,
        default="offline-scripts/processed-images",
        help="Directory to save optimized WebP images (relative to frontend/ when not absolute).",
    )
    parser.add_argument("--limit", type=int, default=0, help="Max number of images to process (0 for no limit).")
    parser.add_argument("--verbose", action="store_true", help="Print detailed status per image.")
    parser.add_argument(
        "--only-missing",
        action="store_true",
        help="Process only images that are missing required ACX pose metadata tags.",
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
    parser.add_argument(
        "--mirror",
        action="store_true",
        help="Also emit mirrored face variants with `_mirror` suffix.",
    )
    parser.add_argument(
        "--missing-report",
        type=str,
        default=DEFAULT_MISSING_REPORT_PATH,
        help="Path to missing-pose-metadata.json used by --only-missing (relative to frontend/ when not absolute).",
    )
    parser.add_argument(
        "--model-path",
        type=str,
        default=None,
        help="Path to face_landmarker.task (relative to cwd when not absolute).",
    )
    parser.add_argument(
        "--unusable-report",
        type=str,
        default=None,
        help=(
            "Path to JSON report containing unusable/deletion-candidate images. "
            "Defaults to <out-dir>/unusable-images-report.json."
        ),
    )
    args = parser.parse_args()

    in_path = resolve_frontend_path(args.in_dir)
    if not in_path.exists():
        print(f"Error: Directory {in_path} does not exist.")
        exit(1)

    out_path = resolve_frontend_path(args.out_dir)
    if not out_path.exists():
        out_path.mkdir(parents=True, exist_ok=True)
    unusable_report_path = (
        resolve_frontend_path(args.unusable_report)
        if isinstance(args.unusable_report, str) and args.unusable_report.strip()
        else out_path / "unusable-images-report.json"
    )

    model_path = resolve_model_path(args.model_path)
    if not model_path.exists():
        print(f"Error: MediaPipe model not found at {model_path}.")
        print(
            "Set --model-path or environment variable "
            f"{MODEL_ENV_VAR} to a valid face_landmarker.task file."
        )
        exit(1)

    detector: Optional[vision.FaceLandmarker] = setup_detector(
        model_path,
        args.min_face_detection_confidence,
        args.min_face_presence_confidence,
        args.min_tracking_confidence,
    )
    if detector is None:
        print("Error: Failed to initialize MediaPipe Face Landmarker.")
        print(
            "Verify the model file is valid and your mediapipe installation supports tasks. "
            f"Model path: {model_path}"
        )
        exit(1)

    files = sorted(
        [
            p
            for p in in_path.rglob("*")
            if p.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS
            and not p.stem.endswith("_mirror")
        ]
    )
    if args.only_missing:
        report_path = resolve_frontend_path(args.missing_report)
        report_files = load_missing_report_paths(in_path, report_path)
        if report_files:
            files = report_files
            print(
                f"Found {len(files)} images from {report_path} missing required pose metadata."
            )
        else:
            files = [p for p in files if not has_required_pose_xmp(p)]
            print(f"Found {len(files)} images missing required pose metadata.")

    report = DetectionReport()
    count = 0
    for f in files:
        if args.limit > 0 and count >= args.limit:
            break
        process_image(
            detector,
            f,
            out_path,
            report,
            args.verbose,
            use_landmark_averaging=not args.only_missing,
            mirror_output=args.mirror,
        )
        count += 1

    print(f"Done. Processed {count} images.")
    print_detection_report(report)
    write_unusable_report(report, in_path, unusable_report_path)
    print(f"🧾 Unusable image report written to {unusable_report_path}")


if __name__ == "__main__":
    main()
