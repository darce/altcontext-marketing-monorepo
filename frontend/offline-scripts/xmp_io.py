from pathlib import Path
from typing import List

from face_metrics import FaceMetrics, SimpleLandmark


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
            <acx:LandmarkConfidence>{metrics.landmark_confidence:.3f}</acx:LandmarkConfidence>
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
        xmp_header = b"http://ns.adobe.com/xap/1.0/\0"
        xmp_packet = xmp_str.encode("utf-8")

        seg_len = 2 + len(xmp_header) + len(xmp_packet)
        app1_head = b"\xff\xe1" + seg_len.to_bytes(2, "big")

        if data[:2] != b"\xff\xd8":
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
    if image_path.suffix.lower() in [".jpg", ".jpeg"]:
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
