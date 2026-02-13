# Frontend Language Standards

## Python Standards (`frontend/offline-scripts/`)

> [!IMPORTANT]
> Use `pathlib.Path`, strict typing, deterministic file ordering, and explicit error handling. Keep computation pure and keep I/O at entrypoints.

### Required Rules

- All functions typed; no implicit `Any` in public helpers.
- Enforce `mypy --strict` (or equivalent strict pyright profile).
- Enforce Ruff formatting and linting.
- No bare `except`.
- Use `encoding="utf-8"` for text I/O.
- Sort all filesystem iteration before deterministic output.
- Use constants for landmark indices and magic values.
- Keep scripts single-purpose and split oversized files.

### Quality Threshold Pattern

- Define shared quality constants (e.g. `MIN_LANDMARK_CONFIDENCE`) at the top of the script.
- Apply source-level gates early — skip writing XMP for items that will be rejected downstream.
- Threshold values and rationale are in `build-pipeline.md § Quality Gates`.

## Pipeline Module Pattern

- Shared constants and types live in dedicated modules (`types.ts`, `workflow.ts`).
- Quality thresholds used in both Python and TypeScript must have matching values — keep them in sync across `frontend/offline-scripts/analyze-faces.py` and `frontend/build/derivatives/selection.ts`.
- Domain modules export pure functions consumed by the orchestrator (`prepare-derivatives.ts`); they must not have top-level side effects.
