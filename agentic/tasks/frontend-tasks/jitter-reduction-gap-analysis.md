# Jitter Reduction — Implementation Gap Analysis

Cross-reference of **face-pose-jitter-reduction.md** (Phases 1–4, checked items) against refactored source in `build/`, `build/derivatives/`, and `offline-scripts/`.

> Scope: `build/derivatives/*.ts`, `build/prepare-derivatives.ts`, `offline-scripts/analyze-faces.py`, `offline-scripts/face_metrics.py`, `offline-scripts/xmp_io.py`.
> Runtime modules (`src/assets/face-pose/`) were read for verification but are outside the flagged directories.

---

## Summary

| Area | Planned items | Fully met | Gaps |
|------|:---:|:---:|:---:|
| Phase 1a — `prepare-derivatives.ts` split | 8 | 8 | 0 |
| Phase 2 — Build-time alignment quality | 5 | 4 | 1 |
| Phase 3 — Coverage gap filling | 7 | 5 | 2 |
| Functions-to-Change table (build + offline rows) | 6 | 4 | 2 |

---

## Phase 1a: `prepare-derivatives.ts` Split — ALL MET

| Checklist item | Status | Evidence |
|---|---|---|
| `derivatives/types.ts` | ✅ | 120 lines, all interfaces + type aliases extracted |
| `derivatives/cli.ts` | ✅ | `getArgValue`, `getVerbose`, `getSubsetPrefixes`, `getLimit`, `getRecropMode`, `getBuildOptions`, `normalizeSubsetToken` present |
| `derivatives/metadata-io.ts` | ✅ | `parseSourceMetadata`, `parseSourceMetadataItem`, all `require*`/`read*` helpers, `sortSourceItems`, `writeRuntimeMetadata` present |
| `derivatives/crop.ts` | ✅ | `computeCrop`, `mapPointToCrop`, `mapRegionToCrop`, `computeRuntimeTransform`, `buildRuntimeMetadata`, geometry constants present |
| `derivatives/renderer.ts` | ✅ | `createBrowserRenderer`, `bakeAlignedDerivative`, `renderCroppedDerivative`, `encodeDerivativeWebp`, `toRuntimeTransformCss`, `CANVAS_TEMPLATE` present |
| `derivatives/atlas.ts` | ✅ | `buildAtlases`, `buildAtlasVariant`, `buildPreloadTierByFile`, `buildRepresentativeFileSet`, `attachAtlasPlacements`, `logPreloadTierSummary` present |
| Slim orchestrator | ✅ | `prepare-derivatives.ts` is 688 lines (down from 1677), keeps `main`, `processSourceItems`, `selectSourceItems`, logging; imports everything else |
| Verify unchanged build | ✅ | Build scripts import from `./derivatives/*`; orchestrator calls all modules |

---

## Phase 2: Build-Time Alignment Quality

| Checklist item | Status | Evidence |
|---|---|---|
| Alignment verification pass | ✅ | `verifyAlignedDerivative` in `renderer.ts:186–220`; called in `prepare-derivatives.ts:366–383` after bake; warns on >2px deviation |
| Subpixel alignment | ✅ | `CANVAS_TEMPLATE` sets `ctx.imageSmoothingQuality = "high"` and `ctx.translate(0.5, 0.5)` before applying transform matrix |
| Landmark noise reduction | ✅ | `analyze-faces.py:280–308` — `use_landmark_averaging` flag triggers 2× upscale + `average_landmarks` + `average_matrix_bytes` |
| Emit `alignmentScore` | ✅ | `RuntimeMetadataItem.alignmentScore` in `types.ts:78`; computed in `crop.ts:356` via `toAlignmentScore`; overwritten post-verification in orchestrator |
| Tighten WebP quality for eye-critical tiles | ✅ | `CRITICAL_EYE_DERIVATIVE_WEBP_QUALITY = 50` in `renderer.ts:21`; `isEyeRegionBlockBoundaryCritical` in `crop.ts:289–311` gates the quality bump in orchestrator |

**No gaps in Phase 2.**

---

## Phase 3: Coverage Gap Filling

| Checklist item | Status | Detail |
|---|---|---|
| Split `analyze-faces.py` → `face_metrics.py` + `xmp_io.py` | ✅ | `face_metrics.py` has `FaceMetrics`, `SimpleLandmark`, `get_euler_angles`, `compute_face_metrics`; `xmp_io.py` has `generate_xmp`, `inject_xmp`, `append_xmp_payload`, `write_xmp_to_source` |
| `--mirror` flag in `analyze-faces.py` | ✅ | `argparse` mirrors implemented; `build_mirrored_landmarks`, `build_mirrored_metrics`, `write_mirrored_source` present; emits `_mirror` suffix sources |
| Mirror-aware derivative pipeline | ✅ | `prepare-derivatives.ts:294–307` detects `_mirror` suffix via `toMirrorBaseRelativePath`, sets `shouldFlopSource = true`; `bakeAlignedDerivative` and `renderCroppedDerivative` accept `flopSource` param and use `magick -flop` |
| Pose gap analysis | ✅ | `logPoseCoverageGaps` in `prepare-derivatives.ts:439–491` reports covered/dense/missing 5°×5° cells |
| Conditional mirroring | ✅ | `applyConditionalMirrorSelection` in `prepare-derivatives.ts:166–200` filters mirrors to cells with <3 items |
| **Pose bounds tightening** | ⚠️ GAP | Plan says "In `derivePoseBounds`…" — implementation exists in **runtime** `src/assets/face-pose/index.ts:47–163`, not in `build/` or `offline-scripts/`. The build pipeline has no analogous bounds-emission step; the runtime derives bounds from metadata at load time. **No build/offline-side implementation exists.** Whether this is intentional (runtime-only) or a gap depends on intent — the plan item's `[x]` mark references a runtime function, but the checklist is under Phase 3 which targets build-time changes. |
| **Soft edge fade** | ⚠️ GAP | Plan says "Add CSS vignette or opacity reduction…". `_face-pose.scss:67–77` has a `::after` pseudo-element with a `radial-gradient` vignette, but this appears to be the **original** decorative vignette (present before jitter reduction work). There is no evidence of a new, pose-coverage-aware fade that "corresponds to sparse coverage" or dynamically signals "end of range." The CSS vignette is static and does not vary with pose position. |

---

## Functions-to-Change Table — Build & Offline Rows

| Row | Status | Detail |
|---|---|---|
| `derivatives/atlas.ts` — `PROGRESSIVE_ATLAS_VARIANTS` low tile 64→128 | ✅ | `atlas.ts:22` now reads `tileSize: 128` |
| `derivatives/atlas.ts` — `buildAtlases` mirror-aware packing | ✅ | Mirrors enter `buildAtlases` via the existing sorted path after `applyConditionalMirrorSelection`; no special mirror logic needed inside `buildAtlases` itself since mirrors are regular `RuntimeMetadataItem`s |
| Orchestrator — `processSourceItems` mirror generation pass | ✅ | `shouldFlopSource` logic in `processSourceItems` handles mirrors |
| `derivatives/crop.ts` — `buildRuntimeMetadata` emit `alignmentScore` | ✅ | Present at `crop.ts:356` |
| **`face_metrics.py` — `compute_face_metrics` add landmark confidence propagation** | ❌ GAP | `compute_face_metrics` accepts a `score: float` parameter (detection-level score), but does **not** accept or propagate per-landmark confidence/visibility values. MediaPipe landmarks have a `visibility` and `presence` attribute per landmark that are never read. The `FaceMetrics` dataclass has a single `score` field (detection confidence), not per-landmark confidence. |
| **`analyze-faces.py` — `process_image` emit per-landmark confidence** | ❌ GAP | `process_image` converts landmarks to `SimpleLandmark(lm.x, lm.y, lm.z)` at line 285, discarding `lm.visibility` and `lm.presence`. No per-landmark confidence is emitted into XMP or stored anywhere. |

---

## Gap Details

### Gap 1: Per-Landmark Confidence Not Propagated

**Plan reference**: Functions-to-Change rows for `face_metrics.py` (`compute_face_metrics`) and `analyze-faces.py` (`process_image`).

**Current state**: MediaPipe's `NormalizedLandmark` provides `.visibility` and `.presence` per landmark. These are discarded when constructing `SimpleLandmark` — only `(x, y, z)` are kept. `FaceMetrics.score` holds the detection-level confidence (hardcoded to `1.0` for primary detections), not per-landmark quality.

**Impact**: Without per-landmark confidence, the build pipeline cannot filter or downweight items with unreliable eye landmarks at extreme yaw (>40°). This was identified in the plan's Current State Analysis as a root cause of alignment jitter at pose edges.

**Suggested remediation**:
1. Extend `SimpleLandmark` with `visibility: float` and `presence: float` fields.
2. Populate them from `lm.visibility` and `lm.presence` in `process_image`.
3. Add key-landmark confidence aggregation to `FaceMetrics` (e.g., mean visibility of `EYE_L_OUTER`, `EYE_R_OUTER`, `EYE_L_INNER`, `EYE_R_INNER`).
4. Emit aggregated confidence into XMP (e.g., `<acx:LandmarkConfidence>`).
5. Propagate to `RuntimeMetadataItem` so the runtime/build can prefer high-confidence items.

### Gap 3: Pose Bounds Tightening — Build vs Runtime Ambiguity

**Plan reference**: Phase 3 checklist — "In `derivePoseBounds`, clamp to the range where coverage density exceeds a minimum threshold (e.g., ≥2 items per 5° cell)."

**Current state**: `derivePoseBounds` exists and correctly implements density-aware clamping, but it lives in `src/assets/face-pose/index.ts` (runtime), not in `build/` or `offline-scripts/`. The build pipeline reports coverage gaps in `logPoseCoverageGaps` but does not emit pre-computed bounds.

**Assessment**: This is likely **intentionally runtime-only** — the runtime has access to the actual metadata.json and can derive bounds dynamically. However, the plan item is filed under Phase 3 (coverage gap filling, nominally build-time). If the intent was to also emit bounds from the build pipeline (e.g., into `metadata.json`), that is missing.

**Suggested action**: Clarify intent. If runtime-only derivation is acceptable, no change needed — just note the plan item's [x] is satisfied by the runtime module, not the build/offline directories.

---

## Items Fully Met (for completeness)

These Phase 2–4 build/offline items were confirmed present and correct:

- `verifyAlignedDerivative` post-bake check with 2px warning threshold
- `ctx.imageSmoothingQuality = "high"` + `translate(0.5, 0.5)` subpixel alignment
- `average_landmarks` / `average_matrix_bytes` 2× resolution noise reduction
- `alignmentScore` field computed, emitted, and overwritten post-verification
- `CRITICAL_EYE_DERIVATIVE_WEBP_QUALITY = 50` with `isEyeRegionBlockBoundaryCritical` gate
- `face_metrics.py` and `xmp_io.py` extracted from `analyze-faces.py`
- `--mirror` CLI flag with `build_mirrored_landmarks`, `build_mirrored_metrics`, `write_mirrored_source`
- `flopSource` plumbing through `renderCroppedDerivative` and `bakeAlignedDerivative`
- `logPoseCoverageGaps` 5°×5° cell analysis
- `applyConditionalMirrorSelection` conditional mirror filtering (N=3 threshold)
- `PROGRESSIVE_ATLAS_VARIANTS[0].tileSize` changed from 64 to 128
- `PRELOAD_TIER_STEPS` changed from `[3, 2, 1]` to `[10, 5, 2]` (rebalanced)
