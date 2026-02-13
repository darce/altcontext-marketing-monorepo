# Language Standards (Shared)

## TypeScript Standards

> [!IMPORTANT]
> TypeScript tooling must be strict, deterministic, ESM-consistent, and quiet by default. External input must be validated at boundaries.

### Required Rules

- Typecheck must pass (`npm --prefix frontend run typecheck` / `npm --prefix backend run typecheck`).
- Avoid `any` without explicit justification.
- Validate all untrusted input (disk, env vars, network) before typing.
- No blind casts on untrusted data.
- Prefer explicit Node imports (for example, `node:fs`, `node:path`).
- No floating promises.
- Use `process.exitCode = 1` on failures in script entrypoints.
- Enforce ESLint rules for unused code, promise handling, and consistent type imports.
- Use arrow functions for JS/TS function definitions unless `this` binding requires `function`.

> Python standards and the pipeline module pattern are in `frontend/language-standards.md` — load only for frontend tasks.
