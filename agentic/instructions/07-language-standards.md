# Language Standards

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

## TypeScript Standards (Build Tooling)

> [!IMPORTANT]
> TypeScript tooling must be strict, deterministic, ESM-consistent, and quiet by default. External input must be validated at boundaries.

### Required Rules

- `npm --prefix frontend run typecheck` must pass.
- Avoid `any` without explicit justification.
- Validate all untrusted input (disk, env vars, network) before typing.
- No blind casts on untrusted data.
- Prefer explicit Node imports (for example, `node:fs`, `node:path`).
- Keep `frontend/build/*.ts` as side-effect boundaries.
- No floating promises.
- Use `process.exitCode = 1` on failures in script entrypoints.
- Enforce ESLint rules for unused code, promise handling, and consistent type imports.
- Use arrow functions for JS/TS function definitions unless `this` binding requires `function`.
