# Backend Code Review Checklist

Pre-review protocol and defect patterns to guard against during any backend code review or post-implementation audit.

---

## Pre-Review: Run Deterministic Gates First

> [!IMPORTANT]
> Before spending review time on style, types, or formatting, run the automated quality gates. These catch violations deterministically — do not waste inference or reviewer attention on anything the toolchain already covers.

```sh
make -C backend audit          # typecheck + lint + format + dead-exports + duplicates
```

If any gate fails, fix before proceeding. See [`verification.md`](./verification.md) for the full tool matrix.

---

## Dev-Only Prisma: Runtime Boundary Guards

Prisma is a **dev-only** dependency — it is excluded from the production image via `npm ci --omit=dev`. The following guards prevent accidental reintroduction of Prisma into the runtime.

### No Prisma imports in `src/`

Any import from `@prisma/client` or `@prisma/adapter-pg` in files under `src/` will break the production build. Prisma may only be imported in files outside the compiled source tree (e.g. `prisma.config.ts`, standalone migration scripts not bundled into the image).

**Check:** `grep -r "@prisma/client" backend/src/` must return zero results.

### No `prisma generate` in Dockerfile

The production Dockerfile must not run `npx prisma generate`. Since `tsc` does not import `@prisma/client`, the generated client is unnecessary and wastes ~20s + ~40MB in the build layer.

**Check:** `grep "prisma generate" backend/infra/fly/Dockerfile` must return zero results.

### Schema changes require external migration

Prisma migrations cannot run from the deployed container. Any schema change (`prisma migrate dev`) must be deployed via `fly proxy` + `prisma migrate deploy` from a dev machine or CI/CD. Ensure `fly.toml` has no `release_command` referencing Prisma.

### Type parity with Prisma schema

When adding columns or tables to `schema.prisma`, the corresponding TypeScript types (`src/lib/types.ts`), enums (`src/lib/schema-enums.ts`), and SQL queries must be updated manually. There is no auto-generation step — type drift between the schema and runtime code is a silent correctness bug.

---

## Recurring Defect Patterns

### 1. Stale Agent Comments

Agent-authored thinking-out-loud comments left in production code. These read like internal reasoning notes, not documentation.

**What to look for:**
- Comments starting with "I need to…", "Actually I can…", "Note: calling X within…"
- Comments referencing a removed dependency or prior approach
- Trailing comments explaining nothing useful

**Action:** Delete. Code comments should explain _why_, not narrate planning.

### 2. Configuration Mismatches (Dockerfile ↔ fly.toml)

Dockerfile CMD flags and inline comments can drift from `fly.toml` VM sizing after a refactor.

**What to look for:**
- `--max-old-space-size` exceeds the `memory` in `fly.toml` (heap cap should be ~75% of VM memory)
- Comment says one VM size but the config says another
- Build-stage steps that are no longer needed

**Action:** Cross-reference `fly.toml` `[[vm]]` memory with Dockerfile heap cap after any resource or dependency change.

### 3. Documentation Drift in Instruction Files

After a refactor, instruction files (`service-rules.md`, `verification.md`) may still describe the pre-refactor state.

**What to look for:**
- Stale memory sizing guidance or dependency references
- Contradictory statements in the same section
- Patterns described that no longer exist in the codebase

**Action:** Grep instruction files for keywords related to the change and update stale references.

### 4. Semantic Naming Errors

Column/field names that don't match the actual data source they store.

**What to look for:**
- A metric field named after one source but populated from another
- Generic names like `rejected` that don't specify what was rejected

**Action:** Every metric column name must describe exactly what it measures. Rename and migrate if wrong.

### 5. Hardcoded Metric Stubs

Metric columns wired into dashboards but silently hardcoded to zero.

**What to look for:**
- Any metric field assigned a literal value instead of a query result
- Missing `TODO` or doc comment explaining why a value is stubbed

**Action:** Either populate from real data or explicitly mark as stub with `TODO` + zero default + doc comment.

### 6. Incorrect Percentile Aggregation

Taking `max()` or `avg()` of daily percentiles ≠ the true percentile of the combined distribution.

**What to look for:**
- Window-aggregation code that reduces percentile values across time buckets
- Labels like `p95` on a value that is actually `peakP95` or an approximation

**Action:** Use event-weighted approximation, mergeable sketches, or compute from raw data. Label to reflect the actual semantic.

### 7. Duplicated Logic Across Routes/Services

Identical patterns copied into every handler instead of being extracted.

**What to look for:**
- Identical `try/catch` error handling in every route
- Duplicated schema fragments across files
- Duplicated field maps in create vs. update paths

**Action:** Extract to shared utilities: app-level error handler, shared schemas module, shared field-map objects.

### 8. Missing Access Control on Destructive Endpoints

Endpoints that delete data or expose admin views protected by rate limiting alone.

**What to look for:**
- `DELETE` or destructive `POST` endpoints without auth middleware
- Admin/metrics endpoints reachable without authentication
- Rate limiting used as a substitute for access control

**Action:** Require `assertAdminRequest` or private-network restriction on all destructive/admin endpoints.

### 9. Transaction Re-reads (Race Windows)

Inside a transaction, re-reading a row that was just written instead of using the write result.

**What to look for:**
- `INSERT ... RETURNING` followed by a separate `SELECT` for the same row
- Status reads after a prior write in the same transaction

**Action:** Use the result of the prior write. Under `READ COMMITTED`, a re-read can see concurrent changes.

### 10. Orphaned PII on Cascade Delete

`SET NULL` relationships leave rows with PII-containing fields orphaned after a parent delete.

**What to look for:**
- JSONB payload fields still containing PII after the linked entity is deleted
- Any `SET NULL` relationship where the child row contains sensitive data

**Action:** Either cascade-delete child rows or explicitly scrub PII fields to `null` during delete.

### 11. SQL Composition Type Inconsistency

SQL builder helpers that return mixed types (`string | SqlQuery`) break the `sql` tagged template's nesting logic. When the template encounters a bare string, it treats it as a bind parameter (`$N`) instead of inlining SQL text.

**What to look for:**
- Any function returning `string` where `SqlQuery` is expected (especially empty/no-op cases)
- Variables typed as `SqlQuery | string` that are interpolated into `sql` templates
- Conditional SQL fragments (e.g. optional `WHERE` clauses) that return `""` for the default case

**Action:** All SQL composition helpers must return `SqlQuery` unconditionally. Use `emptySql()` (returns `{ text: "", values: [] }`) for no-op cases, never a bare empty string.

### 12. pg Driver JSONB Serialization

The `pg` driver's `prepareValue()` calls `JSON.stringify()` on plain objects, but treats JavaScript arrays as PostgreSQL arrays (using `{a,b,c}` literal syntax). Passing a JS array directly as a bind parameter for a JSONB column produces `invalid input syntax for type json`.

**What to look for:**
- Array-typed values interpolated into `sql` templates targeting JSONB columns
- `toJsonValue()` / `structuredClone()` results passed directly to `pg` without stringification
- Any JSONB INSERT or UPDATE where the JS value might be an array, not an object

**Action:** Pre-stringify all JSONB bind values with `JSON.stringify()` before passing to the `sql` template. The driver sends the resulting string as-is, which PostgreSQL parses as valid JSON.

### 13. Raw SQL Column Drift After Schema Migrations

When a Prisma migration adds, removes, or renames columns, raw SQL `INSERT` / `UPDATE` statements in service code silently go stale. The TypeScript compiler cannot catch the mismatch because the `sql` tagged template accepts `unknown` values.

**What to look for:**
- `INSERT INTO` statements with a column list that doesn't match the current `schema.prisma` definition
- Missing required columns (e.g. `id`, `updated_at`) that have no database default
- Extra columns in SQL that were dropped in a migration

**Action:** After every schema migration, grep for all raw SQL referencing the changed table(s): `grep -rn 'table_name' backend/src/`. Verify each column list against the current schema. Consider adding a code comment `-- columns: see schema.prisma L<n>` to aid future grep-based audits.

### 14. Schema-Coupled Test Mocks

Unit test mocks that match SQL text by exact string (e.g. `text === 'UPDATE "leads"'`) break when `tableRef()` adds a schema prefix (`"public"."leads"`) or when the SQL is restructured.

**What to look for:**
- Mock implementations that compare `query.text` with hardcoded SQL strings
- Assertions on exact SQL text rather than structural properties
- Mocks that assume table names are unqualified

**Action:** Match SQL patterns with decoupled checks: `text.includes('UPDATE') && text.includes('"leads"')` rather than `text.includes('UPDATE "leads"')`. This survives schema-prefix changes and minor query restructuring.

---

## Review Protocol

1. **Run gates**: `make -C backend audit` must pass before manual review begins.
2. **Scan this checklist**: Walk the Prisma boundary guards and each defect pattern against every changed file.
3. **Check `verification.md` manual rules**: Walk the rules not yet enforced by tooling (percentile correctness, metric columns, field naming, blind casts, schema duplication, write-result reuse).
4. **Document findings**: Use the task template format (Bug/Antipattern/Gap with file, line, action).
5. **Re-run gates**: `make -C backend audit && make -C backend test` after all fixes.
6. **Sign-off**: All findings resolved, all gates green.
