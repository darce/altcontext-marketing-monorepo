# Face Pose Jitter Reduction

## Problem Statement

The interactive face-pose viewer in `face-pose.ts` jitters when the user scrubs across the viewport. The intended illusion — a single contiguous head that rotates as the mouse moves, composed of frames from different people — breaks due to three compounding issues: (1) the pose bucket index retrieves candidates with inconsistent eye-alignment, causing spatial jumps between frames; (2) the `await`-based image load path in `updateFace` yields to the event loop on every source swap, dropping frames and creating visible stalls; (3) source imagery is sparse at the edges of the yaw/pitch range (only 3–11 images below -30° yaw or above +25° pitch), so the viewer reuses distant matches or falls back through expanding bucket radii, producing discontinuous jumps.

## Workflow Principles

- **Alignment is the anchor**: The illusion depends on eyes staying in the same screen-space position across frames. Every optimization must be validated against eye-position stability, not just frame rate.
- **Zero-await hot path**: Once images are preloaded into browser cache, a frame update should be a synchronous CSS transform swap with no `await`, no `decode()`, and no `waitForImageReady()`.
- **Smooth degradation at edges**: When pose coverage is sparse, interpolate or clamp gracefully rather than snapping to a distant match. The viewer should feel like it "runs out of range" smoothly, not abruptly.
- **Build-time investment, runtime savings**: Expensive work (alignment baking, atlas packing, pose gap analysis) belongs in `prepare-derivatives.ts` and `analyze-faces.py`. The runtime receives fully precomputed, pre-aligned assets.

## Terminology

- **Pose cell**: A quantized (yaw, pitch) bucket used by `createPoseIndex` to group metadata items for fast lookup. Current cell step = 0.25°.
- **Atlas tile**: A single face derivative packed into an 8×8 WebP sprite sheet. The runtime positions the `<img>` via `translate()`+`scale()` CSS to show one tile.
- **Frame switch**: A change of the displayed metadata item (different person/image), visible as a face swap. Perceived jitter comes from rapid, spatially inconsistent frame switches.
- **Eye anchor**: The screen-space position where the midpoint between both eyes should remain stable across all frame switches. Currently at (50%, 44%) of the tile.
- **Coverage gap**: A region of pose space where the nearest available metadata item is more than N degrees away from the requested pose. Gaps cause visual discontinuity.

## Current State Analysis

### Runtime (`face-pose.ts` — 1340 lines)

- `updateFace` is `async`: every frame switch calls `dom.setImageSource()`, then `await waitForImageReady()`, then `await image.decode()`. When the atlas is already cached by the browser, these awaits are unnecessary micro-task yields that delay the CSS transform application by 1–3 frames.
- `createPoseCommandQueue` coalesces via `requestAnimationFrame`, but the `flush` callback fires `void updateFace(...)` — the promise floats. If the previous `updateFace` is still awaiting `decode()` when the next RAF fires, the stale token causes the new frame to silently no-op via the `token !== state.token` guard. This drops legitimate frames instead of debouncing them.
- `resolveImageSource` picks the best loaded variant (high > mid > low). During progressive upgrade, the variant changes — causing a source swap even when the same metadata item is selected. This triggers a redundant `waitForImageReady` cycle.
- `scoreCandidate` applies a `rollPenalty` weighted by `POSE_CONFIG.rollPenalty = 0.2`, but `recentPenaltyStep = 0` and `usagePenalty = 0`, effectively disabling diversity scoring. The selection is purely distance-based, which is correct for smoothness, but has no hysteresis beyond the `switchMargin`/`minSwitchIntervalMs` guards.
- `image.style.imageRendering = "pixelated"` is set on every `applyItemFrame` but never reset to `"auto"` when the high-res variant loads. Low-res tiles render with blocky artifacts indefinitely.

### Build Pipeline (`prepare-derivatives.ts` — 1677 lines)

- `bakeAlignedDerivative` writes `transform: IDENTITY_RUNTIME_TRANSFORM` into every runtime metadata record (line ~1170). The alignment is already baked into the pixel data via Puppeteer canvas, so the runtime receives identity transforms. This means the runtime's `toTransformCss` produces only atlas tile positioning — **not** alignment correction. Any alignment error baked at build time is permanent and uncorrectable at runtime.
- `computeRuntimeTransform` anchors on `ALIGNMENT_TARGET_EYE_X_RATIO = 0.5` and `ALIGNMENT_TARGET_EYE_Y_RATIO = 0.44`. The alignment math is solid in theory, but errors compound because: (a) MediaPipe landmarks have ±2–5 pixel noise on eye positions, (b) the Puppeteer canvas render is a single-pass with no subpixel correction, (c) WebP lossy compression at quality 42 introduces further edge shifts.
- Atlas grid is fixed at 8×8 (64 tiles per sheet). With 1381 items, this produces 22 atlas pages × 3 variants = 66 files. The `low` variant tiles are 64×64 px, producing visible blockiness when shown full-size.
- Preload tier assignment (`buildPreloadTierByFile`) puts 842/1381 items in tier 3 (highest priority). This means the blocking preload stage loads the majority of low-res atlases, which is good for coverage but increases time-to-interactive.

### Offline Analysis (`analyze-faces.py` — 544 lines)

- Detection thresholds are very low: `min_face_detection_confidence = 0.005`, `min_face_presence_confidence = 0.01`. This maximizes recall but increases noisy/imprecise landmark positions, especially for extreme poses (profile views, head tilts).
- `compute_face_metrics` extracts pose from the full 4×4 facial transformation matrix, which is reliable. However, eye landmarks at extreme yaw (>40°) are unreliable because the occluded eye is inferred, not observed.
- No coverage analysis or quality scoring is performed. The pipeline processes all detected faces equally, regardless of landmark confidence or pose space utility.
- No mirroring: a right-profile image at yaw=+40° could be mirrored to fill the sparse left-profile range (yaw -40°), but this is not implemented.

### Pose Coverage (from `metadata.json` analysis)

| Yaw range | Count | Density |
|-----------|-------|---------|
| -45° to -30° | 45 | Very sparse |
| -30° to -15° | 215 | Moderate |
| -15° to +15° | 1032 | Dense |
| +15° to +30° | 77 | Sparse |
| +30° to +70° | 37 | Very sparse |

| Pitch range | Count | Density |
|-------------|-------|---------|
| -35° to -15° | 40 | Very sparse |
| -15° to +15° | 993 | Dense |
| +15° to +30° | 292 | Moderate |
| +30° to +40° | 6 | Negligible |

The yaw distribution is asymmetric (more right-facing than left-facing). Edge regions have 10–50× less coverage than center, making smooth transitions impossible with current candidate selection.

## File Decomposition Assessment

The three core files are long enough to hinder readability and make targeted changes riskier (grep/scroll fatigue, merge conflicts, harder code review). The right decomposition strategy differs per file due to runtime vs. build-time constraints.

### `prepare-derivatives.ts` (1677 lines) — SPLIT, high value

This is build tooling executed via `tsx`, which resolves ESM imports natively. Splitting is zero-cost — no new dependencies, no config changes, no output impact. The file contains at least six disjoint responsibilities that never share mutable state.

**Proposed modules** (all under `frontend/build/derivatives/`):

| Module | Responsibility | ~Lines |
|--------|---------------|--------|
| `types.ts` | All interfaces and type aliases (`SourceMetadataItem`, `RuntimeMetadataItem`, `CropBox`, `BuildOptions`, etc.) | ~120 |
| `cli.ts` | Argument parsing (`getArgValue`, `getBuildOptions`, `getRecropMode`, `getSubsetPrefixes`, etc.) | ~100 |
| `metadata-io.ts` | JSON parse/validate/serialize (`parseSourceMetadata`, `writeRuntimeMetadata`, `requireNumber`, `readPoint`, etc.) | ~200 |
| `crop.ts` | Geometry math (`computeCrop`, `mapPointToCrop`, `mapRegionToCrop`, `computeRuntimeTransform`, `buildRuntimeMetadata`) | ~250 |
| `renderer.ts` | Puppeteer browser renderer (`createBrowserRenderer`, `bakeAlignedDerivative`, `CANVAS_TEMPLATE`, `renderCroppedDerivative`, `encodeDerivativeWebp`) | ~200 |
| `atlas.ts` | Atlas packing and preload tiers (`buildAtlases`, `buildAtlasVariant`, `buildPreloadTierByFile`, `buildRepresentativeFileSet`) | ~300 |
| `prepare-derivatives.ts` | Slim orchestrator: `main()`, `processSourceItems`, option wiring, logging | ~300 |

**Benefits**: Each module gets its own focused tests. The alignment math in `crop.ts` can be validated independently. The renderer can be swapped or mocked without touching geometry code. Merge conflicts on a 1677-line file become conflicts on ~200-line files.

### `face-pose.ts` (1340 lines) — SPLIT with bundler, moderate value

The current build step is bare `tsc -p tsconfig.runtime.json`, producing a single `dist/assets/face-pose.js` (38KB raw, 7.2KB brotli). `tsc` alone cannot concatenate multiple source files into one output bundle — it emits one `.js` per `.ts` input. The IIFE wrapper keeps everything out of global scope.

Splitting this file **requires adding a bundler**. `esbuild` is the lightest option: zero-config, single dependency, sub-100ms builds. The script change is minimal:

```jsonc
// Before:
"build:assets:scripts": "tsc -p tsconfig.runtime.json"
// After:
"build:assets:scripts": "esbuild src/assets/face-pose.ts --bundle --format=iife --target=es2022 --outfile=dist/assets/face-pose.js"
```

**Proposed modules** (all under `frontend/src/assets/face-pose/`):

| Module | Responsibility | ~Lines |
|--------|---------------|--------|
| `types.ts` | Interfaces (`MetadataItem`, `PoseCommand`, `RuntimeState`, `AtlasPlacement`, etc.) | ~90 |
| `config.ts` | `POSE_CONFIG`, `PRELOAD_CONFIG`, `POINTER_NOISE_CONFIG`, `SELECTORS` | ~50 |
| `metadata.ts` | `loadMetadata`, `parseMetadataItem`, `parseAtlasPlacement`, `parseAtlasFiles` | ~180 |
| `preload.ts` | `preloadImage`, `preloadImages`, `createPreloadPlan` | ~200 |
| `pose-index.ts` | `createPoseIndex` and all candidate scoring/selection helpers | ~280 |
| `dom.ts` | `createDomFacade` and all DOM read/write helpers | ~100 |
| `updater.ts` | `createFaceUpdater`, `createPoseCommandQueue`, `resolveImageSource`, transform CSS helpers | ~150 |
| `face-pose.ts` | Entry point: `initializeFacePose`, pointer event wiring, background preload orchestration | ~150 |

**Trade-offs**: Adds `esbuild` as a dev dependency (~7MB). `tsc --noEmit` remains the type-checker (unchanged). The output is still a single IIFE file, same size or smaller (esbuild dead-code eliminates unused exports). Tree-shaking is irrelevant since everything is currently used, so the compressed output should be identical.

**If the bundler is rejected**, the file can still be reorganized internally with clear section comments and region markers, but this gives none of the testability or merge-conflict benefits.

### `analyze-faces.py` (544 lines) — MARGINAL, low priority

At 544 lines with a clear top-down flow (detect → compute → XMP generate → inject → main), this file is within reasonable single-file size for a Python script. A split into `face_metrics.py` (pure computation) and `xmp_io.py` (XMP generation/injection) would help testability but isn't blocking any work. Defer until Phase 3 when mirroring logic is added — that's the natural point where the file would exceed comfortable size.

## Proposed Solution

A four-phase approach ordered by impact-per-effort, each phase independently deployable:

**Phase 1 — Runtime hot-path rewrite** eliminates async overhead in the frame-update loop. When the atlas source is already loaded, the update becomes fully synchronous: pick item → compute transform → apply CSS. No awaits, no decode, no image load events.

**Phase 2 — Build-time alignment quality** improves eye-anchor consistency by tightening the Puppeteer alignment pass and adding a post-bake verification step that measures actual eye positions in the output tile.

**Phase 3 — Coverage gap filling** addresses sparse edge regions through horizontal mirroring of existing assets and pose-aware quality filtering in the analysis pipeline.

**Phase 4 — Progressive resolution upgrade** improves the `low` atlas variant from 64px to 128px tiles, and adds a mid-frame resolution swap that upgrades from low to high without visible rendering mode changes.

## Patterns to Follow

### Synchronous Frame Update (Phase 1)

```typescript
const updateFaceSync = (yaw: number, pitch: number): void => {
  const item = poseIndex.pickClosest(yaw, pitch, state);
  const resolved = resolveImageSource(item, state.loadedSources);
  // Only apply if source is already cached — no awaits
  if (state.loadedSources.has(resolved.source)) {
    if (dom.image && dom.image.src !== resolved.source) {
      dom.setImageSource(resolved.source);
    }
    applyItemFrame(item);
    return;
  }
  // Fallback: keep current frame, schedule async load
  scheduleBackgroundLoad(resolved.source);
};
```

### Mirror Fill at Build Time (Phase 3)

```typescript
// In prepare-derivatives.ts, after processing originals:
const mirrorItem = (item: RuntimeMetadataItem): RuntimeMetadataItem => ({
  ...item,
  file: item.file.replace(".webp", "_mirror.webp"),
  pose: { ...item.pose, yaw: -item.pose.yaw, roll: -item.pose.roll },
  features: {
    eyes: { l: mirrorPoint(item.features.eyes.r), r: mirrorPoint(item.features.eyes.l) },
    mouth: { l: mirrorPoint(item.features.mouth.r), r: mirrorPoint(item.features.mouth.l) },
    chin: mirrorPoint(item.features.chin),
    forehead: mirrorPoint(item.features.forehead),
  },
});
```

### Edge Clamping with Velocity Damping (Phase 1)

```typescript
// Slow mouse movement near pose boundaries to prevent abrupt fallback snapping
const dampedYaw = yaw * (1 - edgeProximity * EDGE_DAMPING_FACTOR);
```

## Functions to Change

| File | Function/Area | Change |
|------|--------------|--------|
| `face-pose.ts` → `face-pose/updater.ts` | `updateFace` | Replace async path with synchronous source-swap when atlas is cached |
| `face-pose.ts` → `face-pose/updater.ts` | `createPoseCommandQueue` | Remove floating promise; make flush synchronous |
| `face-pose.ts` → `face-pose/updater.ts` | `applyItemFrame` | Set `imageRendering: "auto"` when high-res variant is active |
| `face-pose.ts` → `face-pose/updater.ts` | `resolveImageSource` | Return variant level alongside source to avoid redundant swaps |
| `face-pose.ts` → `face-pose/pose-index.ts` | `pickClosest` | Add velocity-aware hysteresis and edge damping |
| `face-pose.ts` → `face-pose/index.ts` | `toPoseFromPointer` | Add non-linear edge mapping for smoother boundary behavior |
| `prepare-derivatives.ts` → `derivatives/atlas.ts` | `PROGRESSIVE_ATLAS_VARIANTS` | Increase low tile size from 64 to 128 |
| `prepare-derivatives.ts` → `derivatives/atlas.ts` | `buildAtlases` | Add mirror-aware atlas packing (Phase 3) |
| `prepare-derivatives.ts` (orchestrator) | `processSourceItems` | Add optional mirror generation pass |
| `prepare-derivatives.ts` → `derivatives/crop.ts` | `buildRuntimeMetadata` | Emit alignment quality score for runtime filtering |
| `analyze-faces.py` → `face_metrics.py` | `compute_face_metrics` | Add landmark confidence propagation |
| `analyze-faces.py` | `main` | Add `--mirror` flag for horizontal flip generation |
| `analyze-faces.py` | `process_image` | Emit per-landmark confidence score |

## Related Files

| File | Note |
|------|------|
| [frontend/public/metadata.json](frontend/public/metadata.json) | Runtime metadata consumed by face-pose.ts; regenerated by prepare-derivatives.ts |
| [frontend/public/metadata-source.json](frontend/public/metadata-source.json) | Source metadata consumed by prepare-derivatives.ts; generated by extract-metadata.ts |
| [frontend/build/extract-metadata.ts](frontend/build/extract-metadata.ts) | Parses XMP from source images into metadata-source.json |
| [frontend/styles/_face-pose.scss](frontend/styles/_face-pose.scss) | CSS for viewer; `will-change: transform` already set on `#face-image` |
| [frontend/src/index.html](frontend/src/index.html) | Viewer markup with `#face-container`, `#face-image`, `#face-loader` |

---

# Consolidated Checklist

## Completed

- [x] Codebase analysis and root cause identification
- [x] Pose coverage distribution mapping (1381 items, asymmetric yaw, sparse edges)

## Phase 1: Runtime Hot-Path (Eliminates frame drops from async overhead)

### Phase 1a: Split `prepare-derivatives.ts` into modules

- [x] **Create `build/derivatives/types.ts`**: Extract all interfaces and type aliases. Every other module imports from here.
- [x] **Create `build/derivatives/cli.ts`**: Extract `getArgValue`, `getVerbose`, `getSubsetPrefixes`, `getLimit`, `getRecropMode`, `getBuildOptions`, `normalizeSubsetToken`.
- [x] **Create `build/derivatives/metadata-io.ts`**: Extract `parseSourceMetadata`, `parseSourceMetadataItem`, all `require*`/`read*` field helpers, `readOptionalString`, `sortSourceItems`, `writeRuntimeMetadata`.
- [x] **Create `build/derivatives/crop.ts`**: Extract `computeCrop`, `mapPointToCrop`, `mapRegionToCrop`, `computeRuntimeTransform`, `buildRuntimeMetadata`, `pointToPixels`, `clamp`, `roundTo`, `dist`, geometry constants.
- [x] **Create `build/derivatives/renderer.ts`**: Extract `createBrowserRenderer`, `bakeAlignedDerivative`, `renderCroppedDerivative`, `encodeDerivativeWebp`, `toRuntimeTransformCss`, `CANVAS_TEMPLATE`, and image processing constants.
- [x] **Create `build/derivatives/atlas.ts`**: Extract `buildAtlases`, `buildAtlasVariant`, `buildPreloadTierByFile`, `buildRepresentativeFileSet`, `attachAtlasPlacements`, `logPreloadTierSummary`, atlas constants.
- [x] **Slim `prepare-derivatives.ts`**: Keep `main()`, `processSourceItems`, `selectSourceItems`, `prepareOutputDirectory`, logging helpers. Import everything else.
- [x] **Verify**: `npm run build:data:derive` and `npm run typecheck:tools` pass unchanged.

### Phase 1b: Split `face-pose.ts` with esbuild

- [x] **Add `esbuild` dev dependency**: `npm install --save-dev esbuild`.
- [x] **Update `build:assets:scripts`**: Replace `tsc -p tsconfig.runtime.json` with esbuild command targeting `src/assets/face-pose/index.ts` → `dist/assets/face-pose.js` as IIFE.
- [x] **Keep `typecheck:runtime`**: `tsc -p tsconfig.runtime.json --noEmit` remains the type-checker.
- [x] **Create `src/assets/face-pose/types.ts`**: Extract all interfaces and type aliases.
- [x] **Create `src/assets/face-pose/config.ts`**: Extract `POSE_CONFIG`, `PRELOAD_CONFIG`, `POINTER_NOISE_CONFIG`, `SELECTORS`, `METADATA_ERROR_HINT`.
- [x] **Create `src/assets/face-pose/metadata.ts`**: Extract `loadMetadata`, `parseMetadataItem`, `parseAtlasPlacement`, `parseAtlasFiles`, `asRecord`.
- [x] **Create `src/assets/face-pose/preload.ts`**: Extract `preloadImage`, `preloadImages`, `createPreloadPlan`.
- [x] **Create `src/assets/face-pose/pose-index.ts`**: Extract `createPoseIndex` and all internal helpers (`scoreCandidate`, `collectNearbyCandidates`, etc.).
- [x] **Create `src/assets/face-pose/dom.ts`**: Extract `createDomFacade`.
- [x] **Create `src/assets/face-pose/updater.ts`**: Extract `createFaceUpdater`, `createPoseCommandQueue`, `resolveImageSource`, `toTransformCss`, `toAtlasTileTransformCss`, `waitForImageReady`.
- [x] **Create `src/assets/face-pose/index.ts`**: Keep `initializeFacePose`, pointer wiring, background preload orchestration.
- [x] **Verify**: Output `dist/assets/face-pose.js` is a single IIFE, compressed size ≤ 8KB brotli, `typecheck:runtime` passes.

### Phase 1c: Runtime hot-path changes (within the now-split modules)

- [x] **Sync frame update**: Refactor `updateFace` in `updater.ts` to be synchronous when the resolved source is already in `loadedSources`. Only fall back to async load if the source is genuinely uncached.
- [x] **Remove floating promise in flush**: Make `createPoseCommandQueue.flush` in `updater.ts` call the synchronous path directly instead of `void updateFace(...)`.
- [x] **Token simplification**: Remove the `token` increment / stale-check pattern for the sync path. Keep it only for the async fallback in `updater.ts`.
- [x] **Image rendering mode fix**: Set `imageRendering: "auto"` in `updater.ts` when source is a `high` variant; keep `"pixelated"` only for `low`/`mid`.
- [x] **Variant-aware source resolution**: Extend `resolveImageSource` in `updater.ts` to return `{ source, variant }` so callers can avoid redundant source swaps when variant changes but the metadata item hasn't.
- [x] **Same-item fast path**: When `pickClosest` returns the same item as `state.currentItem` and the source hasn't changed, skip all DOM operations entirely in `updater.ts`.
- [x] **Edge-aware pose mapping**: Add non-linear mapping in `toPoseFromPointer` in `index.ts` that compresses the outer 15% of viewport into a smaller pose range, preventing rapid jumps through sparse edge regions.
- [x] **Velocity-based switch damping**: Increase `minSwitchIntervalMs` dynamically in `pose-index.ts` when pointer velocity is high (fast scrubbing), reducing unnecessary mid-scrub switches.

## Phase 2: Build-Time Alignment Quality (Reduces spatial jitter between frames)

- [x] **Alignment verification pass**: After `bakeAlignedDerivative`, read back the output tile and measure actual eye midpoint position. Log/warn items with >2px deviation from target anchor.
- [x] **Subpixel alignment**: In `CANVAS_TEMPLATE`, enable `ctx.imageSmoothingQuality = "high"` and use a `translate(0.5, 0.5)` offset to align to pixel grid before applying the alignment matrix.
- [x] **Landmark noise reduction in `analyze-faces.py`**: For images re-analyzed with `--only-missing=false`, run MediaPipe detection at 2× resolution and average landmark positions to reduce per-frame noise.
- [x] **Emit alignment confidence**: Add an `alignmentScore` field to `RuntimeMetadataItem` computed from the deviation of baked eye positions vs. target anchor. Runtime can use this to prefer high-confidence items.
- [x] **Tighten WebP quality for critical features**: Increase `DERIVATIVE_WEBP_QUALITY` from 42 to 50 for tiles where the eye region crosses a block boundary (measurable at build time), reducing compression-induced eye-position shift.

## Phase 3: Coverage Gap Filling (Addresses sparse edges)

- [x] **Split `analyze-faces.py`**: Extract `face_metrics.py` (pure `compute_face_metrics`, `get_euler_angles`, `FaceMetrics` dataclass) and `xmp_io.py` (`generate_xmp`, `inject_xmp`, `append_xmp_payload`, `write_xmp_to_source`). Keep `analyze_faces.py` as the CLI entrypoint with detection and orchestration.
- [x] **Horizontal mirror generation in `analyze-faces.py`**: Add `--mirror` flag. For each processed image, also emit a horizontally flipped copy with negated yaw and roll, swapped left/right landmarks. Store with `_mirror` suffix.
- [x] **Mirror-aware derivative pipeline**: In `prepare-derivatives.ts`, when mirror source metadata is present, generate flipped derivatives using `magick -flop` before the alignment pass.
- [x] **Pose gap analysis**: Add a build-time step that identifies 5°×5° yaw/pitch cells with zero coverage and reports them. Use this to prioritize which source images to mirror.
- [x] **Conditional mirroring**: Only create mirrors for items whose mirrored pose falls in a cell with fewer than N existing items (e.g., N=3), avoiding bloating dense center regions.
- [x] **Pose bounds tightening**: In `derivePoseBounds`, clamp to the range where coverage density exceeds a minimum threshold (e.g., ≥2 items per 5° cell), so the viewer doesn't map to unreachable poses.

## Phase 4: Progressive Resolution & Polish

- [x] **Increase low atlas tile size**: Change `PROGRESSIVE_ATLAS_VARIANTS[0].tileSize` from 64 to 128. This doubles low-res clarity with modest atlas size increase (~4× per tile, mitigated by higher compressibility at larger tile size).
- [x] **Mid-frame resolution upgrade**: After applying a low-res frame synchronously, schedule a microtask to swap to the mid/high variant of the same item without changing the CSS transform. This produces a "sharpen" effect rather than a jarring swap.
- [x] **Preload tier rebalance**: With mirrors and better coverage, rebalance `PRELOAD_TIER_STEPS` to ensure tier-3 covers representative poses at ~10° spacing instead of the current 3° that pulls 842 items into blocking preload.
- [x] **Cache-warm hinting**: After initial interaction, prefetch atlas variants for the quadrant of pose space the user is trending toward, based on recent pointer velocity direction.

## Phase 5: Tests & Validation

- [ ] **Eye-anchor stability test**: Build-time script that loads each output tile, detects eye landmarks (via MediaPipe Face Landmarker — the same model used in `analyze-faces.py`), and asserts the midpoint between outer eye landmarks is within 3px of `(OUTPUT_SIZE * 0.5, OUTPUT_SIZE * 0.44)`.
- [ ] **Pose coverage report**: CI step that generates a yaw×pitch heatmap from `metadata.json` and fails if any 10° cell within the interactive bounds has zero items.
- [ ] **Frame-rate benchmark**: Puppeteer-based test that scrubs the viewer at 60fps mouse-move rate and asserts zero dropped CSS transform applications over 5 seconds.
- [ ] **Visual regression snapshots**: Capture the viewer at 9 canonical poses (center + 8 compass points at 80% range) and compare against known-good baselines.

## Stretch Goals

- [ ] **Touch/gyroscope input**: Map `deviceorientation` events to pose commands for mobile tilt interaction.
- [ ] **WebGL atlas rendering**: Replace CSS transform-based atlas tile extraction with a single WebGL quad that samples directly from the atlas texture, eliminating large-image layout overhead.
- [ ] **Adaptive tile resolution**: Serve 320px tiles on mobile (< 768px viewport) and 640px on desktop, halving mobile payload.

## Success Criteria

- [ ] Scrubbing across the viewport at 60fps mouse-move rate produces zero visible spatial jumps (eye position stays within 3px of anchor on sequential frames).
- [ ] No `await` or promise yield occurs on the hot path when atlas sources are preloaded.
- [ ] Edge regions (>30° from center yaw or >20° from center pitch) have at least 3 unique items per 5° cell after mirror fill.
- [ ] Time from `mousemove` event to CSS transform application is consistently < 2ms (measurable via Performance API).
- [ ] `npm --prefix frontend run typecheck` and `npm --prefix frontend run lint` pass after all changes.
