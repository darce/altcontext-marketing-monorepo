# Multi-Tenancy and Row-Level Security Roadmap

Last updated: 2026-02-16

## Table of Contents

- [1. Goals](#1-goals)
- [2. Constraints](#2-constraints)
- [3. Current State](#3-current-state)
- [4. Tenant Model](#4-tenant-model)
- [5. Row-Level Security Strategy](#5-row-level-security-strategy)
- [6. API Changes](#6-api-changes)
- [7. Auth Design Decisions](#7-auth-design-decisions)
- [8. Dashboard Multi-Tenancy](#8-dashboard-multi-tenancy)
- [9. Migration Strategy](#9-migration-strategy)
- [10. Delivery Phases](#10-delivery-phases)
- [11. Acceptance Checklist](#11-acceptance-checklist)

## 1. Goals

- Evolve the single-tenant marketing backend into a multi-tenant system.
- Enforce tenant isolation at the database level using PostgreSQL Row-Level Security (RLS).
- Enable the SvelteKit dashboard to operate in a multi-tenant context — each authenticated user sees only their tenant's data.
- Preserve existing `propertyId`-based partitioning as a sub-tenant concept (a tenant owns one or more properties).
- Keep the migration incremental — the system must remain functional between phases.

### Multi-property vs multi-org scoping

- **Multi-property (required now)**: A tenant can own multiple properties (e.g. marketing site, docs site, blog). All data tables with `property_id` are scoped within a tenant. A `properties` table formalises this relationship.
- **Multi-org / siloed organisations (future feature)**: An organisation layer above tenants enables fully siloed groups of tenants. Not required for MVP — but schema design must not preclude adding an `org_id` FK on `tenants` later. See [backend-marketing-server.md §16](backend-marketing-server.md) for details.

## 2. Constraints

- **Single database**: all tenants share one PostgreSQL instance; isolation is enforced by RLS, not separate databases.
- **Existing data**: all current data belongs to a default "bootstrap" tenant created during migration.
- **No breaking API changes**: ingest endpoints (`/v1/events`, `/v1/leads/capture`) must remain backward-compatible. Tenant resolution for ingest is via API key, not path.
- **PIPEDA/CASL compliance**: tenant boundaries must not weaken privacy or consent isolation.
- **Co-deployment**: backend + dashboard share a single Fly.io machine; tenant context must flow from dashboard auth through to the database session.

## 3. Current State

The schema uses `property_id` on `events`, `daily_metric_rollups`, `daily_ingest_rollups`, and `ingest_rejections`. This acts as a soft namespace but has no enforcement — any API caller can read/write any `property_id`.

Tables without `property_id`: `visitors`, `sessions`, `leads`, `lead_identities`, `form_submissions`, `consent_events`.

There is a single `ADMIN_API_KEY` env var for dashboard/metrics auth. No user or tenant model exists.

## 4. Tenant Model

### New tables

```sql
-- Tenants
CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  slug        VARCHAR(128) NOT NULL UNIQUE,
  plan        VARCHAR(64)  NOT NULL DEFAULT 'free',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- API keys (ingest + admin)
CREATE TABLE api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash    VARCHAR(128) NOT NULL UNIQUE,  -- SHA-256 of the raw key
  key_prefix  VARCHAR(12)  NOT NULL,         -- first 8 chars for identification
  label       VARCHAR(255),
  scope       VARCHAR(32)  NOT NULL DEFAULT 'ingest',  -- 'ingest' | 'admin'
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_tenant_id_idx ON api_keys(tenant_id);

-- Dashboard users
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       VARCHAR(320) NOT NULL,
  name        VARCHAR(255),
  role        VARCHAR(32)  NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, email)
);
CREATE INDEX users_tenant_id_idx ON users(tenant_id);
```

### Tenant column on existing tables

Add `tenant_id UUID NOT NULL REFERENCES tenants(id)` to:

| Table | Notes |
|-------|-------|
| `visitors` | All visitors belong to a tenant. |
| `sessions` | Inherits tenant from visitor; denormalized for RLS performance. |
| `events` | `property_id` remains as sub-tenant namespace within a tenant. |
| `leads` | Tenant-scoped email uniqueness: `UNIQUE(tenant_id, email_normalized)`. |
| `lead_identities` | Denormalized `tenant_id` for RLS. |
| `form_submissions` | Denormalized `tenant_id` for RLS. |
| `consent_events` | Denormalized `tenant_id` for RLS/compliance scoping. |
| `ingest_rejections` | Already has `property_id`; add `tenant_id`. |
| `daily_metric_rollups` | Add `tenant_id`; keep `property_id` as sub-partition. |
| `daily_ingest_rollups` | Same as above. |

## 5. Row-Level Security Strategy

### Approach: session variable + RLS policies

PostgreSQL RLS policies are enforced via a session variable (`app.current_tenant_id`) set at the start of each request.

```sql
-- Enable RLS on all tenant-scoped tables
ALTER TABLE visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
-- ... (all tables from § 4)

-- Example policy for visitors
CREATE POLICY tenant_isolation ON visitors
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- The application database role must NOT be the table owner
-- (table owners bypass RLS). Use a separate app role:
CREATE ROLE app_user NOLOGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
```

### Connection flow

1. Request arrives at Fastify.
2. Tenant is resolved:
   - **Ingest endpoints** (`/v1/events`, `/v1/leads/*`): look up `x-api-key` header → `api_keys.tenant_id`.
   - **Dashboard SSR** (`SvelteKit load()`): session cookie → `users.tenant_id`.
   - **Admin endpoints** (`/v1/metrics/*`): `x-api-key` header with `scope = 'admin'`.
3. Before the first query, set the session variable:
   ```sql
   SET LOCAL app.current_tenant_id = '<tenant-uuid>';
   ```
   (`SET LOCAL` is transaction-scoped — automatically reset on commit/rollback.)
4. All subsequent queries in that transaction are filtered by RLS.

### Fastify integration

```typescript
// Conceptual — a Fastify onRequest hook
app.addHook("onRequest", async (request) => {
  const tenantId = await resolveTenant(request);
  request.tenantId = tenantId;
});

// Each service method wraps its work in a transaction with SET LOCAL
const withTenant = async <T>(tenantId: string, fn: (tx: PoolClient) => Promise<T>): Promise<T> =>
  transaction(async (tx) => {
    await tx.query(`SET LOCAL app.current_tenant_id = $1`, [tenantId]);
    return fn(tx);
  });
```

### Safety rules

- The app connects as `app_user`, never as the table owner.
- No query may bypass the transaction wrapper that sets the tenant context.
- Superuser/migration connections use a separate role that is the table owner (bypasses RLS for schema changes).
- All indexes on `tenant_id` columns to prevent sequential scans on RLS filter.

## 6. API Changes

### Ingest endpoints

| Endpoint | Change |
|----------|--------|
| `POST /v1/events` | Require `x-api-key` header. Resolve tenant from key. |
| `POST /v1/leads/capture` | Require `x-api-key` header. Resolve tenant from key. |
| `POST /v1/leads/unsubscribe` | Require `x-api-key` header. |
| `POST /v1/leads/delete` | Require `x-admin-key` → becomes `x-api-key` with `scope = 'admin'`. |

### Metrics endpoints

| Endpoint | Change |
|----------|--------|
| `GET /v1/metrics/summary` | `x-api-key` (admin scope) replaces `x-admin-key`. Scoped to tenant. |

### Backward compatibility

During migration, the existing `ADMIN_API_KEY` env var is mapped to the bootstrap tenant's admin API key. Static site ingest calls get a dedicated ingest key for the bootstrap tenant.

## 7. Auth Design Decisions

Three auth surfaces, each with a distinct pattern chosen for the current scale (single Fly machine, small team) while preserving a clear migration path to multi-org.

### Surface 1: Ingest Auth (public endpoints)

**Pattern: Scoped API keys resolved from `api_keys` table.**

Endpoints: `POST /v1/events`, `POST /v1/leads/capture`, `POST /v1/leads/unsubscribe`.

```text
x-api-key: ak_live_<random>  →  SHA-256 lookup  →  api_keys.tenant_id + scope + property_id
```

- Each key has a `scope` (`ingest` | `admin`) and an optional `property_id` constraint.
- Ingest keys are **safe to embed in client-side JavaScript** — they can only write, not read.
- Tenant resolution: `api_keys.tenant_id` → `SET LOCAL app.current_tenant_id`.
- Property scoping: if `property_id` is set, restrict writes to that property. If NULL, writes to any property within the tenant.
- Revocable without deploy: set `revoked_at` in DB.
- **Unsubscribe auth**: use the ingest-scoped API key. The email in the body + tenant from the key is sufficient — only the resolved tenant's lead can be unsubscribed. No HMAC token needed until email-embedded unsubscribe links exist.

#### Property-scoped keys

When the `properties` table is formalised (backend epic §16):

```sql
ALTER TABLE api_keys ADD COLUMN property_id UUID REFERENCES properties(id);
-- NULL = all properties within tenant; non-NULL = restricted to one property
```

This enables:
- Marketing site has its own ingest key (scoped to `property_id = 'marketing'`).
- Docs site has a separate key (scoped to `property_id = 'docs'`).
- Admin key has no property constraint (sees all properties within tenant).
- Dashboard property picker filters by the key's scope or the user's role.

### Surface 2: Dashboard Auth (admin UI)

**Pattern: Server-side sessions with encrypted HTTP-only cookies.**

```text
POST /v1/auth/login   { email, password }  →  bcrypt verify  →  set encrypted cookie
POST /v1/auth/logout                       →  destroy session
```

- Session stores `userId` + `tenantId` + `role`.
- `+layout.server.ts` validates cookie on every SSR request, resolves tenant context.
- **Session storage: PostgreSQL** (not in-memory) — Fly machines can restart at any time; in-memory sessions would be lost.
- Future magic link: passwordless login via email. Deferred until email sending infrastructure exists.
- Future multi-org: session adds `orgId`. `tenantId` remains the primary RLS key; `orgId` is a superset filter for org-admin views.

### Surface 3: Admin API Auth (programmatic access)

**Pattern: Admin-scoped API keys (same `api_keys` table, `scope = 'admin'`).**

```text
x-api-key: ak_admin_<random>  →  SHA-256 lookup  →  scope='admin', tenant_id
```

Endpoints: `GET /v1/metrics/summary`, `POST /v1/leads/delete`, purge scripts.

- Replaces current `ADMIN_API_KEY` env var.
- Admin keys can read metrics, delete leads, run purge — all scoped to their tenant.
- The bootstrap tenant's admin key is seeded from the current `ADMIN_API_KEY` during the MT-1 migration.

### Authorization (RBAC)

| Role | Permissions |
|------|-------------|
| `owner` | Full access. Manage billing, team, API keys, properties. |
| `admin` | Manage properties, API keys, view all dashboards. |
| `member` | View dashboards for assigned properties only. |

Roles are stored on `users.role` (per-tenant). RBAC is enforced in route middleware, not RLS — RLS handles tenant isolation; RBAC handles intra-tenant permissions.

### Alternatives Considered

| Alternative | Why not (now) |
|-------------|---------------|
| **JWT** | Stateless tokens complicate revocation and session invalidation. Single Fly machine — no cross-service token validation needed. JWTs add complexity without benefit at this scale. |
| **OAuth 2.0 / OIDC** | Requires an identity provider (Auth0, Clerk, etc.) or self-hosted. Premature — the user base is the founding team. Can be added later as a login provider alongside email+password without changing the tenant resolution model. |
| **Passkeys / WebAuthn** | Excellent UX but requires client-side JS and browser API support. Defer until the dashboard is mature. |

### Migration Path

| Phase | What changes |
|-------|--------------|
| **Pre-MT (now)** | Add `assertAdminRequest` to `/v1/leads/unsubscribe`. No schema changes. |
| **MT-1** | Create `api_keys` table. Migrate `ADMIN_API_KEY` → bootstrap tenant admin key. Add `resolveTenant` hook. Ingest endpoints require `x-api-key`. |
| **Auth-1** | Create `users` table. Implement `POST /v1/auth/login` + `/logout`. Encrypted cookie sessions in PostgreSQL. |
| **MT-3** | Dashboard `+layout.server.ts` guard. Tenant context from session. RBAC enforcement. |
| **Future** | Add `org_id` to sessions. Org-admin cross-tenant views. OAuth/OIDC as optional login provider. |

## 8. Dashboard Multi-Tenancy

### Tenant-scoped pages

```text
/                     → redirect to /dashboard
/login                → public
/dashboard            → tenant-scoped metrics overview
/dashboard/events     → tenant-scoped event explorer
/dashboard/leads      → tenant-scoped lead list
/settings             → tenant settings, API keys, team
/settings/properties  → manage properties within tenant
```

### Tenant switching

Users who belong to multiple tenants (future) can switch via a tenant picker in the top bar.

## 9. Migration Strategy

### Data migration

All existing rows receive the bootstrap tenant's `tenant_id`:

```sql
-- Run inside a migration after creating the tenants table and bootstrap row
UPDATE visitors SET tenant_id = '<bootstrap-tenant-uuid>';
UPDATE sessions SET tenant_id = '<bootstrap-tenant-uuid>';
UPDATE events SET tenant_id = '<bootstrap-tenant-uuid>';
-- ... all tables
```

### Index migration

Add a covering index on `(tenant_id, <existing-key>)` for every table. Example:

```sql
CREATE INDEX events_tenant_property_ts_idx ON events(tenant_id, property_id, timestamp);
```

### Unique constraint migration

The `leads.email_normalized` unique constraint becomes `UNIQUE(tenant_id, email_normalized)` so different tenants can capture the same email independently.

## 10. Delivery Phases

### Phase MT-1: Tenant model and API keys (2–3 days)

- Create `tenants`, `api_keys`, `users` tables.
- Add `tenant_id` column (nullable initially) to all existing tables.
- Create bootstrap tenant and backfill `tenant_id` on existing data.
- Make `tenant_id` NOT NULL after backfill.
- Implement API key lookup service.
- Add `resolveTenant` hook to Fastify.
- Add `withTenant` transaction wrapper.

### Phase MT-2: Row-Level Security (1–2 days)

- Create `app_user` database role.
- Enable RLS on all tenant-scoped tables.
- Write and test RLS policies.
- Switch application connection to `app_user`.
- Verify existing tests pass with RLS active.

### Phase MT-3: Dashboard auth (2–3 days)

- Implement login (email + password with bcrypt).
- Session management (encrypted cookie).
- `+layout.server.ts` guard — redirect unauthenticated users to `/login`.
- Display tenant name in top bar.
- Create "bootstrap" owner user during migration.

### Phase MT-4: Dashboard tenant-scoped pages (2–3 days)

- Metrics overview scoped to tenant.
- Event explorer.
- Lead list.
- Settings page: API key management, team management.

### Phase MT-5: Tenant onboarding (1–2 days)

- Signup flow: create tenant + owner user.
- Generate initial ingest API key.
- Property creation within tenant.

## 11. Acceptance Checklist

- [ ] All existing data assigned to bootstrap tenant.
- [ ] RLS enforced: queries without `SET LOCAL app.current_tenant_id` return zero rows.
- [ ] API keys resolve to correct tenant; invalid/revoked keys are rejected.
- [ ] Ingest endpoints accept `x-api-key` and scope data to the resolved tenant.
- [ ] Dashboard login works; session persists across requests.
- [ ] Dashboard pages display only the authenticated tenant's data.
- [ ] Multi-tenant metrics summary returns correct scoped data.
- [ ] Existing single-tenant deployment continues to work (bootstrap tenant).
- [ ] PIPEDA/CASL consent isolation verified per-tenant.
- [ ] No SQL injection vector in `SET LOCAL` — tenant ID validated as UUID.
- [ ] Performance: RLS filter uses index scans, no sequential scans on tenant_id.
