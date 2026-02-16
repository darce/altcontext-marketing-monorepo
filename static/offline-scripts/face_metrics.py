from dataclasses import dataclass
from typing import Final, List, Optional, Tuple

import numpy as np
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
    landmark_confidence: float
    score: float


@dataclass(frozen=True)
class SimpleLandmark:
    x: float
    y: float
    z: float = 0.0
    visibility: float = 1.0
    presence: float = 1.0


def clamp_unit(value: float) -> float:
    """Clamp confidence-like values to the [0, 1] interval."""
    if not np.isfinite(value):
        return 1.0
    return float(max(0.0, min(1.0, value)))


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
    score: float,
) -> FaceMetrics:
    """Pure function to calculate metrics from landmarks and transformation matrix."""

    # 1) Pose from Matrix
    pitch, yaw, roll = 0.0, 0.0, 0.0
    if matrix_data:
        m_floats = struct.unpack("<16f", matrix_data)
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
    confidence_points = [
        p_eye_l,
        p_eye_r,
        p_eye_li,
        p_eye_ri,
        p_nose,
        p_mouth_l,
        p_mouth_r,
    ]
    confidence_values = [
        (clamp_unit(point.visibility) + clamp_unit(point.presence)) * 0.5
        for point in confidence_points
    ]
    landmark_confidence = (
        float(np.mean(confidence_values)) if confidence_values else clamp_unit(score)
    )

    # 3) Scaling and Distances
    fscale = float(
        np.sqrt(
            (p_eye_r.x - p_eye_l.x) ** 2
            + (p_eye_r.y - p_eye_l.y) ** 2
            + (p_eye_r.z - p_eye_l.z) ** 2
        )
    )

    iodist_outer = float(
        np.sqrt((p_eye_r.x - p_eye_l.x) ** 2 + (p_eye_r.y - p_eye_l.y) ** 2)
    )
    iodist_inner = float(
        np.sqrt((p_eye_ri.x - p_eye_li.x) ** 2 + (p_eye_ri.y - p_eye_li.y) ** 2)
    )
    iodist_blend = 0.6 * iodist_inner + 0.4 * iodist_outer

    mid_eye_x = (p_eye_l.x + p_eye_r.x) * 0.5
    mid_eye_y = (p_eye_l.y + p_eye_r.y) * 0.5
    mid_mouth_x = (p_mouth_l.x + p_mouth_r.x) * 0.5
    mid_mouth_y = (p_mouth_l.y + p_mouth_r.y) * 0.5
    eye_mouth_dist = float(
        np.sqrt((mid_mouth_x - mid_eye_x) ** 2 + (mid_mouth_y - mid_eye_y) ** 2)
    )

    oval_width = float(
        np.sqrt((p_oval_r.x - p_oval_l.x) ** 2 + (p_oval_r.y - p_oval_l.y) ** 2)
    )
    nedist = float(np.sqrt((p_nose.x - p_eye_l.x) ** 2 + (p_nose.y - p_eye_l.y) ** 2))

    face_height = float(
        np.sqrt((p_forehead.x - p_chin.x) ** 2 + (p_forehead.y - p_chin.y) ** 2)
    )

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
        landmark_confidence=round(landmark_confidence, 3),
        score=round(score, 3),
    )
