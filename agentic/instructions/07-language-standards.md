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
- Extract shared types and schemas (e.g. UTM, pagination) into a dedicated module instead of duplicating across files.
- Centralise cross-cutting error handling (validation errors, auth failures) in a single app-level handler rather than repeating identical `catch` blocks in every route.
- Inside a database transaction, use the result of a prior write rather than re-reading the same row. Re-reads are redundant round-trips and create race windows under `READ COMMITTED` isolation.
- Avoid serial `await` in loops when operations are independent. Batch with `Promise.all`, `createMany`, or similar to reduce round-trips.

> Python standards and the pipeline module pattern are in `frontend/language-standards.md` — load only for frontend tasks.
