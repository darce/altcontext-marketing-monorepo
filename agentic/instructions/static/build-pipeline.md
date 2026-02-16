# Build Pipeline and Scripts

## Toolchain

- `sass` for SCSS compilation
- `postcss-cli` + `autoprefixer` + `cssnano`
- `tsx` + TypeScript for build tooling
- `critical` for critical CSS extraction/inlining
- `eslint`, `stylelint`, `prettier` as quality gates
- `make` for orchestration — all multi-step workflows are Makefile targets

## Makefile Orchestration

The canonical entry point for all frontend tooling is `frontend/Makefile`. Agents and humans should call Make targets rather than raw npm scripts for multi-step workflows.

```sh
make -C frontend build           # fast build (clean + assets)
make -C frontend build-full      # data + derivatives + assets
make -C frontend data             # extract metadata + derive
make -C frontend data-recrop      # re-render all tiles
make -C frontend check            # typecheck + lint + stylelint + format
make -C frontend ci               # full CI pipeline
make -C frontend deploy           # build + verify + push to GitHub Pages
make -C frontend analyze-faces    # Python face analysis (auto-creates venv)
make -C frontend help             # list all targets
```

Single-step npm scripts (e.g. `npm run lint:fix`) can still be called directly when needed. The Makefile handles dependency ordering and install gating.

## npm Scripts Reference

All npm scripts are defined in `frontend/package.json`. For multi-step workflows, use the Makefile targets above. Single-step scripts (e.g. `npm run lint:fix`) can be called directly.

## Build-Mode Rules (Speed)

- Default builds must avoid expensive recropping.
- Recropping must be opt-in through `--recrop=none|missing|all` or recrop scripts.
- If derivatives are missing and recrop is not enabled, fail with an actionable command.

## Derivatives Pipeline — Module Decomposition

`prepare-derivatives.ts` is the orchestrator. All domain logic lives in `frontend/build/derivatives/`:

| Module | Responsibility |
|--------|----------------|
| `cli.ts` | Parse `--verbose`, `--subset`, `--limit`, `--recrop` from argv / env |
| `selection.ts` | Quality gate, subset filtering, mirror expansion |
| `crop.ts` | Face-crop geometry and alignment transforms |
| `processing.ts` | Per-item rendering and derivative reuse decisions |
| `renderer.ts` | Puppeteer-based aligned tile renderer (WebP output) |
| `atlas.ts` | 8×8 grid assembly, preload tier assignment, per-page yaw sort |
| `pose-bounds.ts` | Derive min/max yaw/pitch from the final runtime item set |
| `metadata-io.ts` | Read `metadata-source.json`, write `metadata.json` and `pose-bounds.json` |
| `reporting.ts` | Console summaries, coverage gap logs, unusable-atlas reports |
| `workflow.ts` | Shared constants (paths, layout version), output dir preparation |
| `types.ts` | All shared type definitions for the pipeline |

## Quality Gates (Derivatives)

Before atlas packing, items must pass the quality gate (`selection.ts`):

| Check | Constant | Value | Rationale |
|-------|----------|-------|-----------|
| Landmark confidence floor | `MIN_LANDMARK_CONFIDENCE` | 0.75 | Rejects non-faces and poor detections (MediaPipe scores ≤ 0.5) |
| Zero-pose rejection | — | `(0, 0, 0)` | Items with no meaningful pose data are unreliable |
| Interocular distance min | `MIN_INTEROCULAR_DIST` | 0.08 | Too-small faces are unusable crops |
| Interocular distance max | `MAX_INTEROCULAR_DIST` | 0.65 | Over-large values indicate landmark errors |

The same `MIN_LANDMARK_CONFIDENCE = 0.75` is enforced at the source in `analyze-faces.py` — items below threshold do not receive XMP metadata at all.

## Atlas Sort Strategy

1. **Global sort** — items ordered by preload tier descending, then `comparePose` (yaw ascending). High-priority tiles land in earlier atlas sheets.
2. **Per-page re-sort** — each 64-tile chunk (one 8×8 atlas page) is re-sorted by `comparePose` to ensure continuous face-direction within a single sheet, even when the page straddles a tier boundary.

## Offline Analysis Scripts

Python scripts in `frontend/offline-scripts/` (see `architecture.md` for file tree). MediaPipe detection thresholds are kept intentionally low (≈ 0.005–0.01) for maximum recall; filtering happens downstream via `MIN_LANDMARK_CONFIDENCE`.
