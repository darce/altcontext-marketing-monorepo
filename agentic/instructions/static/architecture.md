# Frontend Architecture

## File Tree

```text
./frontend/
  package.json
  Makefile                          # orchestration: build, data, deploy, ci
  tsconfig.tools.json
  tsconfig.runtime.json
  build/
    copy.ts
    compress.ts
    critcss.ts
    extract-metadata.ts
    prepare-derivatives.ts          # orchestrator — calls derivatives/*
    derivatives/
      atlas.ts                      # atlas grid assembly, preload tiers, per-page sort
      cli.ts                        # CLI arg parsing (--verbose, --subset, --limit, --recrop)
      crop.ts                       # face-crop geometry
      metadata-io.ts                # read/write metadata-source.json & runtime metadata
      pose-bounds.ts                # derive min/max yaw/pitch from runtime items
      processing.ts                 # per-item rendering / derivative reuse
      renderer.ts                   # Puppeteer-based aligned tile renderer (WebP)
      reporting.ts                  # console summaries, coverage gaps, unusable-atlas logs
      selection.ts                  # quality gate, subset filter, mirror expansion
      types.ts                      # shared pipeline types
      workflow.ts                   # constants (paths, layout version), output dir prep
  styles/
    site.scss
    _tokens.scss
    ...
  src/
    assets/
      face-pose/
        config.ts                   # runtime tuning constants
        dom.ts                      # DOM facade for face container
        index.ts                    # entry — wires metadata, preload, pointer, render loop
        metadata.ts                 # fetches metadata.json & pose-bounds.json
        pose-index.ts               # spatial index — nearest item to yaw/pitch
        preload.ts                  # tiered image preload planner
        types.ts                    # runtime type declarations
        updater.ts                  # face updater & PoseCommandQueue
  public/
    metadata.json
    metadata-source.json
    pose-bounds.json
    atlases/
  offline-scripts/
    analyze-faces.py                # MediaPipe face detection → XMP injection
    face_metrics.py                 # confidence & pose computation helpers
    xmp_io.py                       # read/write XMP sidecar metadata
    requirements.txt
  dist/
```

## Architecture Notes

- `frontend/dist/` is the deploy output.
- `frontend/build/*.ts` are build tools only and are not shipped to runtime.
- `frontend/build/derivatives/` modules are imported by `prepare-derivatives.ts`; they are never executed standalone.
- `frontend/src/assets/face-pose/` is the runtime face-pose interaction module (ships to browser).
- `frontend/offline-scripts/` are Python one-shots for image analysis; they write XMP metadata consumed by `extract-metadata.ts`.

## Data Flow

```text
analyze-faces.py → XMP in source images
                    ↓
extract-metadata.ts → metadata-source.json
                    ↓
prepare-derivatives.ts
  ├─ quality gate   (selection.ts — rejects low-confidence / zero-pose)
  ├─ crop + render  (crop.ts, processing.ts, renderer.ts)
  ├─ atlas packing  (atlas.ts — 8×8 grid, tier sort, per-page yaw re-sort)
  └─ output         → metadata.json, pose-bounds.json, atlases/*.webp
                    ↓
face-pose runtime   (src/assets/face-pose/) consumes metadata + atlases
```
