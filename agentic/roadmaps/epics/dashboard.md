# Dashboard Roadmap

Last updated: 2026-02-16

## Table of Contents

- [1. Goals](#1-goals)
- [2. Constraints](#2-constraints)
- [3. Stack](#3-stack)
- [4. Current State](#4-current-state)
- [5. Internationalisation (i18n)](#5-internationalisation-i18n)
- [6. Runtime Assertions](#6-runtime-assertions)
- [7. Authentication](#7-authentication)
- [8. Multi-Tenancy: Multi-Property and Multi-Org](#8-multi-tenancy-multi-property-and-multi-org)
- [9. WCAG Compliance](#9-wcag-compliance)
- [10. Unit Testing](#10-unit-testing)
- [11. Delivery Phases](#11-delivery-phases)
- [12. Acceptance Checklist](#12-acceptance-checklist)

## 1. Goals

- Provide an admin dashboard for the marketing backend, deployed alongside it on Fly.io.
- Surface marketing metrics, lead data, event explorer, and service usage analytics.
- Support multi-tenant, multi-property scoping with authenticated sessions.
- Meet WCAG 2.2 AA compliance for all user-facing pages.
- Internationalise all user-facing copy from day one.
- Maintain high code quality with unit tests and runtime assertions.

## 2. Constraints

- Dashboard is a SvelteKit app mounted inside the Fastify process via `@fastify/middie` (see `context-and-architecture.md`).
- SvelteKit `load()` functions call backend API routes internally at `http://localhost:3000` — no network hop.
- Dashboard must not block or degrade backend API performance.
- All user-facing text must be externalized for i18n.
- Colour contrast and interactive elements must meet WCAG 2.2 AA.

## 3. Stack

- **Framework**: SvelteKit 2 (Svelte 5)
- **Adapter**: `@sveltejs/adapter-node`
- **UI components**: shadcn-svelte (see `agentic/instructions/dashboard/shadcn-svelte-reference.md`)
- **Styling**: Tailwind CSS (via shadcn-svelte tokens)
- **Type checking**: `svelte-check` + TypeScript
- **Linting**: ESLint + Prettier + prettier-plugin-svelte
- **Testing**: Vitest (unit) + Playwright (e2e) — see §10 and [e2e-testing-harness.md](e2e-testing-harness.md)

## 4. Current State

The dashboard has a skeleton SvelteKit project with:

- Basic route structure (`src/routes/`)
- Build output (`build/`)
- No authentication, no i18n, no tests
- Metrics pages scoped to single admin API key

## 5. Internationalisation (i18n)

All user-facing text in the dashboard — page titles, labels, descriptions, form validation messages, empty states, error messages — must be internationalisation-ready.

### Strategy

- **Library**: Use `svelte-i18n` or `paraglide-js` (SvelteKit-native, compile-time i18n). Paraglide is preferred for type-safe message keys and tree-shaking.
- **Message files**: `src/lib/i18n/messages/{locale}.json` — one file per locale.
- **Default locale**: `en`. First additional locale: `fr` (Canadian French).
- **Locale resolution**: Read `Accept-Language` header in `hooks.server.ts`. Store user preference in session/cookie. URL prefix optional (e.g. `/fr/dashboard`) — defer until second locale ships.
- **Component convention**: Never hardcode user-facing strings. Use `$t('key')` or the Paraglide `m.key()` pattern.
- **Validation messages**: Zod schemas used in form validation must reference i18n keys, not hardcoded English.
- **Date/number formatting**: Use `Intl.DateTimeFormat` and `Intl.NumberFormat` with the resolved locale.

### Delivery

- Phase i18n-1: Install i18n library, create `en.json` catalogue, wire `hooks.server.ts` locale resolution.
- Phase i18n-2: Extract all existing hardcoded strings to catalogue keys.
- Phase i18n-3: Add `fr.json`; validate with snapshot tests.

## 6. Runtime Assertions

In addition to unit tests, runtime assertions catch logic errors and contract violations during actual execution.

### Strategy

- **Shared `invariant()` helper**: Import from `$lib/assert.ts` (mirrors backend pattern). Throws a structured error with context.
- **Where to assert**:
  - `+page.server.ts` / `+layout.server.ts`: Assert that API responses have expected shape before passing to components.
  - Auth guards: Assert session and tenant context are present on protected routes.
  - Data transformations: Assert array lengths, date ordering, numeric ranges before rendering charts.
- **Error boundary**: SvelteKit `+error.svelte` pages catch assertion failures gracefully and show a user-friendly error.
- **Always active**: Assertions are never stripped in production builds.

### Delivery

- Add `src/lib/assert.ts` with `invariant()` and structured `AssertionError`.
- Add assertions to auth guards, API response validation, and data transform utilities.

## 7. Authentication

Authentication is required for all dashboard routes. Detailed design is in [multi-tenancy-rls.md §7](multi-tenancy-rls.md).

### Summary

- **Login**: Email + bcrypt password via `POST /v1/auth/login`.
- **Session**: Encrypted HTTP-only cookie. SvelteKit `hooks.server.ts` validates session on every request.
- **Guards**: `+layout.server.ts` at the dashboard root redirects unauthenticated users to `/login`.
- **Logout**: `POST /v1/auth/logout` clears session.
- **Magic link (future)**: Passwordless login deferred until email infrastructure exists.
- **RBAC**: `owner` / `admin` / `member` roles. Role-based visibility in sidebar and settings pages.

## 8. Multi-Tenancy: Multi-Property and Multi-Org

### Multi-property (required now)

- **Property picker**: Dropdown in the top bar lets users filter all dashboard views by property or view aggregate.
- **Property management**: Settings page to create/edit/delete properties within a tenant.
- **Scoped API calls**: All `load()` functions pass `propertyId` (or omit for aggregate) to backend API.
- **URL routing**: Property context stored in URL search params (`?property=slug`) so links are shareable.

### Multi-org / siloed organisations (future feature)

- **Org switcher**: Future top-level picker above tenant context.
- **Cross-tenant views**: Org admins can view aggregate data across tenants within their org.
- **Not required now**: No implementation needed. Schema and component architecture should not preclude adding this layer.

## 9. WCAG Compliance

The dashboard must meet **WCAG 2.2 Level AA** for all user-facing pages.

### Colour Contrast

- All text must meet minimum contrast ratios: **4.5:1** for normal text, **3:1** for large text (≥18pt or ≥14pt bold).
- UI components (buttons, inputs, focus indicators) must have **3:1** contrast against adjacent colours.
- Charts and data visualisations must not rely on colour alone — use patterns, labels, or shapes as secondary indicators.
- shadcn-svelte theme tokens must be audited and adjusted to meet contrast requirements. Document approved palette in `src/lib/styles/tokens.ts`.

### Interactive Elements

- All interactive elements must be keyboard-navigable and have visible focus indicators.
- ARIA labels on icon-only buttons, charts, and custom components.
- Form inputs must have associated `<label>` elements (not placeholder-only labels).
- Error messages must be announced to screen readers via `aria-live` regions.

### Semantic Structure

- Logical heading hierarchy (`h1` → `h2` → `h3`) on every page.
- Landmark regions (`<nav>`, `<main>`, `<aside>`) for screen reader navigation.
- Data tables must use `<th>`, `scope`, and `<caption>` appropriately.

### Testing

- **Automated**: Playwright + `@axe-core/playwright` for automated WCAG audits in e2e tests (see [e2e-testing-harness.md](e2e-testing-harness.md)).
- **Manual**: Periodic manual testing with VoiceOver (macOS) and keyboard-only navigation.
- **CI gate**: axe-core violations at AA level fail the build.

### Delivery

- Phase WCAG-1: Audit shadcn-svelte theme tokens for contrast compliance. Fix violations.
- Phase WCAG-2: Add ARIA labels, landmarks, and heading hierarchy to all existing pages.
- Phase WCAG-3: Integrate axe-core into Playwright e2e suite; add CI gate.

## 10. Unit Testing

### Strategy

- **Framework**: Vitest (the SvelteKit ecosystem standard, Vite-native, first-class `@testing-library/svelte` support).
  - *Note*: The backend uses `node:test` (per `agentic/instructions/backend/service-rules.md`). The dashboard uses Vitest because SvelteKit component testing requires Vite's transform pipeline for `.svelte` files, and `@testing-library/svelte` integrates natively with Vitest. This is a deliberate per-workspace choice, not a conflict.
- **Component testing**: Use `@testing-library/svelte` for rendering components in a happy-dom environment.
- **Coverage target**: 80% line coverage for `src/lib/` utilities and components. Pages (`src/routes/`) tested via e2e.
- **What to unit test**:
  - `$lib/` utility functions (data transforms, formatters, locale helpers, assertion utils).
  - Svelte components: render, props, event handlers, conditional rendering, accessibility attributes.
  - Form validation schemas (Zod).
  - i18n key completeness (all keys in `en.json` exist in `fr.json`).
- **What NOT to unit test** (covered by e2e):
  - Full page rendering with server load data.
  - Navigation and routing.
  - API integration.

### Conventions

- Test files co-located: `src/lib/utils/format.ts` → `src/lib/utils/format.test.ts`.
- Use `describe` / `it` / `expect` from Vitest.
- Mock API responses with `vi.mock()` or MSW for component tests that call `fetch`.
- Snapshot tests for i18n catalogue completeness.

### Delivery

- Phase Test-1: Install Vitest + `@testing-library/svelte` + happy-dom. Add `test` script to `package.json`.
- Phase Test-2: Write unit tests for existing `$lib/` utilities and key components.
- Phase Test-3: Add CI integration — `vitest run --coverage` on PR.

## 11. Delivery Phases

### Phase D-1: Skeleton + Auth (2–3 days)

- Login page, session management, auth guards.
- Basic layout with sidebar navigation.

### Phase D-2: Metrics Overview (2–3 days)

- Dashboard home page with marketing metric cards.
- Property picker (multi-property support).
- Chart components for trends.

### Phase D-3: i18n + WCAG Foundation (2–3 days)

- i18n library setup, `en.json` catalogue, locale resolution.
- WCAG audit of theme tokens and existing components.
- ARIA labels, landmarks, heading hierarchy.

### Phase D-4: Unit Tests + Runtime Assertions (1–2 days)

- Vitest setup, component testing library.
- Unit tests for utilities, components, validation.
- Runtime assertions in auth guards and data transforms.

### Phase D-5: Event Explorer + Lead List (2–3 days)

- Tenant-scoped event explorer page.
- Tenant-scoped lead list page.
- Filtering, pagination, search.

### Phase D-6: Settings + Team Management (2–3 days)

- Tenant settings page.
- API key management.
- Team member management (RBAC).
- Property CRUD.

### Phase D-7: e2e Testing + WCAG CI Gate (1–2 days)

- Playwright e2e suite for critical flows.
- axe-core WCAG automation in CI.
- See [e2e-testing-harness.md](e2e-testing-harness.md) for full plan.

## 12. Acceptance Checklist

- [ ] Login/logout works; unauthenticated users redirected.
- [ ] Dashboard pages scoped to authenticated tenant.
- [ ] Property picker filters all views correctly.
- [ ] All user-facing strings externalized in i18n catalogue.
- [ ] French locale renders correctly when `Accept-Language: fr`.
- [ ] WCAG 2.2 AA contrast ratios met for all text and UI elements.
- [ ] Keyboard navigation works for all interactive elements.
- [ ] axe-core e2e tests pass with zero AA violations.
- [ ] Vitest unit test suite passes with ≥80% coverage on `$lib/`.
- [ ] Runtime assertions active in production; assertion failures logged and handled gracefully.
- [ ] `svelte-check` and ESLint pass with zero errors.

## References

- SvelteKit docs: https://kit.svelte.dev/docs
- shadcn-svelte: https://www.shadcn-svelte.com/
- Paraglide JS (i18n): https://inlang.com/m/gerre34r/library-inlang-paraglideJs
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- axe-core: https://github.com/dequelabs/axe-core
- Vitest: https://vitest.dev/
- Testing Library Svelte: https://testing-library.com/docs/svelte-testing-library/intro
- Multi-tenancy epic: [multi-tenancy-rls.md](multi-tenancy-rls.md)
- Backend epic: [backend-marketing-server.md](backend-marketing-server.md)
- e2e testing epic: [e2e-testing-harness.md](e2e-testing-harness.md)
- Master roadmap: [../ROADMAP.md](../ROADMAP.md)
