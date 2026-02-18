# Backend Code Review Checklist

Pre-review protocol and defect patterns to guard against during any backend code review or post-implementation audit.

---

## Pre-Review: Run Deterministic Gates First

> [!IMPORTANT]
> Before spending review time on style, types, or formatting, rely on automated quality gates. These catch violations deterministically — do not waste inference or reviewer attention on anything the toolchain already covers.

If the task context already provides explicit, current evidence that tests/gates passed for the exact branch under review, treat that as a precondition and proceed with manual review. Re-run gates only when evidence is missing, stale, or your edits changed behavior.

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

Prisma is a dev-only schema management tool \u2014 it must never be in the production image. Any schema change (`prisma migrate dev`) must be applied to the production database via `fly proxy` + `prisma migrate deploy` from a dev machine or CI/CD. Ensure `fly.toml` has no `release_command` referencing Prisma.

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

### 15. Stale Task Checklists

Task checklist items in `agentic/tasks/backend-tasks/` are consistently left unchecked after the corresponding work is completed. This makes roadmap progress invisible and causes duplicate effort when a future review re-investigates already-finished items.

**What to look for:**
- A PR implements a feature described by a task checklist item, but the `- [ ]` is not changed to `- [x]`
- Multiple items completed in a single session with none marked off
- Task file status header still reads "OPEN" when all checklist items are done

**Action:** Before sign-off, open every task file referenced by the work and mark completed items `- [x]`. If all items in a task are complete, add a `> ✅ **CLOSED**` status header. This is a **sign-off blocker** — do not approve a review where completed work is not reflected in the task checklist.

### 16. Version-Gated SQL Feature Assumptions

Review conclusions sometimes assume a PostgreSQL feature or syntax is available without validating it against the actual target major version.

**What to look for:**
- Task docs that claim new SQL syntax (for example, `RETURNING old/new`, parameter ACL behavior) without a reproducible probe
- Migration SQL that gates behavior on `server_version_num`, but review findings treat the behavior as universally active
- Findings that discuss PG18 behavior while local verification ran on PG17 (or vice versa) without stating the environment gap

**Action:** Add an executable SQL probe to the review notes (`psql ... -c`), record the exact server version, and scope conclusions accordingly. If local env is not the target major, mark verification as pending in a PG18 environment instead of stating speculative behavior as fact.

### 17. Prisma Default Semantics Drift

`schema.prisma` defaults and database defaults can diverge silently, especially when raw SQL migrations set DB-generated defaults (for example, `uuidv7()`) but Prisma models keep client-side defaults (for example, `@default(uuid())`).

**What to look for:**
- Migrations altering column defaults via raw SQL without corresponding Prisma schema default updates
- Review claims that assume `@default(uuid())` maps to a DB default expression
- Unverified assumptions about drift risk without running Prisma diff tooling

**Action:** Run `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` after default-related migrations. If drift is intentional, document it explicitly in the task and avoid generating corrective migrations from schema drift output.

### 18. Scope-Leaky "Remaining Usage" Claims

Findings that state "only remaining usage/import" often mix production runtime code with tests and dev helpers, producing incorrect conclusions.

**What to look for:**
- Global grep claims that do not specify path scope (for example, `src/` vs `test/`)
- Findings labeling something as "only remaining" when multiple test/dev call sites still exist
- Recommendations that remove legitimate test-only usage because runtime/test scopes were conflated

**Action:** Always scope grep queries by intent and report scope explicitly:
- Runtime: `rg <pattern> backend/src`
- Tests/dev tooling: `rg <pattern> backend/test backend/scripts`
Only elevate to production findings when runtime scope is affected.

### 19. Split Schema Resolution Sources

When schema selection can come from multiple configuration sources (for example `DATABASE_URL` query params and a separate schema env var), different layers may resolve different schemas and silently read/write different data.

**What to look for:**
- Connection pool `search_path` derived from one source while SQL identifier builders use another
- Test helpers and runtime code using different schema resolution logic
- No fail-fast behavior when both schema sources are present but disagree

**Action:** Centralize schema resolution in one shared helper used by runtime, test helpers, and SQL builders. If multiple schema inputs are present, validate they agree and fail fast on conflict.

### 20. Destructive Test Target Collisions

Test workflows often run destructive operations (`migrate reset`, truncation, drop/create). If test and development URLs drift to the same target, test runs can wipe developer data and hide environment boundary mistakes.

**What to look for:**
- `TEST_DATABASE_URL` or equivalent resolves to the same database as default `DATABASE_URL`
- Make/test scripts labeled "isolated" but using shared DB targets
- Test setup commands that mutate data structures used by local development

**Action:** Keep test and development database targets distinct by default (separate DB name or clearly isolated schema with aligned runtime/test config). Verify destructive test commands cannot hit the default dev target.

### 21. SECURITY DEFINER Privilege and Search Path Drift

`SECURITY DEFINER` functions can unintentionally expand privilege if execute grants and search paths are not tightly controlled.

**What to look for:**
- Function executable by `PUBLIC` when only specific roles should call it
- Unqualified object references in function bodies relying on mutable caller/session search paths
- Dynamic SQL over identifiers built without identifier quoting/validation

**Action:** Explicitly `REVOKE` execute from `PUBLIC` and grant only required roles. Pin definer function `search_path` to trusted schemas (typically `pg_catalog` + explicit targets) and use identifier-safe formatting (`format('%I', ...)`) for dynamic SQL object names.

### 22. Non-Canonical Squashed Init Migrations

When migrations are consolidated for a greenfield baseline, the new `init` can accidentally preserve transitional DDL/DML from historical rollout steps instead of expressing the final schema directly.

**What to look for:**
- A squashed `init` migration containing backfill-style data updates (for example, `UPDATE ... SET tenant_id = ...`) on tables it just created
- `ALTER TABLE ... ADD COLUMN ...` followed by immediate `UPDATE` and `SET NOT NULL` for columns that should be created in final form
- Index drop/recreate sequences that only exist to transition from an older schema state

**Action:** In a greenfield/squashed baseline, require canonical final-state DDL only: create tables, constraints, indexes, policies, roles, and functions exactly as they should exist after all historical changes. Eliminate transitional backfill steps from the squashed `init`.

### 23. Fresh-Database Migration Replay Gaps

Reviews often validate on a pre-migrated local database, which can hide ordering issues and missing prerequisites that only appear on a clean database.

**What to look for:**
- Review sign-off without replaying migrations from an empty database
- Validation evidence limited to `migrate status` on an already-initialized DB
- No proof that a brand-new database reaches the expected end state

**Action:** Make fresh-database replay a sign-off gate for schema-changing work. Reset/create an empty DB, apply all migrations, then verify the schema is up to date and expected bootstrap objects exist.

### 24. Startup-Critical Database Prerequisites Not Verified

Application startup may depend on roles, functions, or permissions that are not guaranteed unless migrations explicitly create and verify them.

**What to look for:**
- Startup code executing DB-critical statements (`SET ROLE`, security-context setters, required function calls) without corresponding migration verification
- Tests that assert business behavior but never assert startup prerequisites
- Missing checks for required DB roles/functions after migration replay

**Action:** Add explicit verification for startup-critical prerequisites in review or CI (roles, functions, grants, policies). Treat missing startup prerequisites as a deployment blocker even if unit/integration tests pass.

### 25. Migration Validation Path Mismatch (`reset/dev` vs `deploy`)

Schema changes can pass local `migrate reset` / `migrate dev` flows but still fail in the actual deployment path (`migrate deploy`) due to engine, permission, or environment differences.

**What to look for:**
- Evidence only from development migration commands, with no `migrate deploy` validation
- Different database major version between validation environment and deployment target without explicit compatibility proof
- CI/local verification that does not exercise the same migration command used for releases

**Action:** For release-bound schema changes, validate at least one clean run using the same deploy command path and target major-version family as production. Do not approve based solely on local dev reset results.

---

## Review Protocol

1. **Confirm gate evidence**: Use explicit pass evidence for `make -C backend audit` if already provided for the current branch; otherwise run it before manual review.
2. **Scan this checklist**: Walk the Prisma boundary guards and each defect pattern against every changed file.
3. **Check `verification.md` manual rules**: Walk the rules not yet enforced by tooling (percentile correctness, metric columns, field naming, blind casts, schema duplication, write-result reuse).
4. **Replay migrations on a fresh DB**: For any schema change, verify a clean-database migration replay succeeds and produces the expected bootstrap objects (roles/functions/policies/indexes).
5. **Document findings**: Use the task template format (Bug/Antipattern/Gap with file, line, action).
6. **Update task checklists**: Open every task file in `agentic/tasks/backend-tasks/` that covers the work under review. Mark completed items `- [x]`. Add `> ✅ **CLOSED**` header if all items are done. **This step is mandatory and blocks sign-off.**
7. **Confirm post-fix gate evidence**: Re-run `make -C backend audit && make -C backend test` after fixes unless fresh pass evidence for the same branch/commit is already documented.
8. **Sign-off**: All findings resolved, all gates green, migrations replayed cleanly, startup prerequisites verified, all task checklists current.
