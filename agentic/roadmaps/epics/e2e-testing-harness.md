# End-to-End Testing Harness Proposal

Last updated: 2026-02-16

## Table of Contents

- [1. Recommendation Summary](#1-recommendation-summary)
- [2. Tool Evaluation](#2-tool-evaluation)
- [3. Architecture](#3-architecture)
- [4. Backend e2e Testing](#4-backend-e2e-testing)
- [5. Dashboard e2e Testing](#5-dashboard-e2e-testing)
- [6. Static Site e2e Testing](#6-static-site-e2e-testing)
- [7. WCAG Compliance Testing](#7-wcag-compliance-testing)
- [8. CI Integration](#8-ci-integration)
- [9. Delivery Phases](#9-delivery-phases)

## 1. Recommendation Summary

**Playwright** is the recommended e2e testing harness for the entire monorepo.

| Concern | Recommendation |
|---------|---------------|
| Browser e2e (dashboard + static) | **Playwright** |
| API e2e (backend) | **Playwright API testing** (or Vitest integration tests — already in place) |
| WCAG automated audits | **@axe-core/playwright** (Playwright integration) |
| Visual regression | **Playwright screenshot comparison** (built-in) |
| Component isolation (dashboard) | **Storybook** (optional complement, not primary) |

### Why Playwright over alternatives

| Criterion | Playwright | Cypress | Storybook Test Runner |
|-----------|-----------|---------|----------------------|
| Multi-browser support | Chromium, Firefox, WebKit | Chromium, Firefox (WebKit experimental) | Chromium only |
| API testing built-in | Yes (`request` context) | No (requires plugins) | No |
| axe-core integration | `@axe-core/playwright` (first-class) | `cypress-axe` (community) | `@storybook/addon-a11y` (component-only) |
| SvelteKit SSR testing | Full page rendering via real browser | Full page rendering | Component-only (no SSR) |
| Parallel execution | Native sharding | Limited | N/A |
| CI performance | Fast (headed + headless) | Slower (Electron overhead) | N/A |
| Network mocking | Route-level interception | `cy.intercept()` | MSW |
| Screenshot comparison | Built-in | Plugin required | Chromatic (paid) |
| Cost | Free, open-source | Free (OSS), paid dashboard | Free (OSS), Chromatic paid |

### Where Storybook fits

Storybook is **not recommended as the primary testing tool** but is a valuable complement:

- **Component catalogue**: Document and visually browse dashboard UI components in isolation.
- **a11y addon**: `@storybook/addon-a11y` runs axe-core on individual components during development. Useful for catching WCAG issues early, before they reach full-page e2e tests.
- **Not suitable for**: SSR testing, multi-page flows, API integration, authentication flows.
- **Recommendation**: Add Storybook for the dashboard as a development aid after core e2e tests are in place (Phase 3).

## 2. Tool Evaluation

### Playwright

- **Strengths**: Cross-browser, fast parallel execution, native API testing, built-in screenshot comparison, excellent TypeScript support, first-class axe-core integration for WCAG.
- **Weaknesses**: No built-in component isolation (need real server running).
- **Fit**: Ideal for full-stack e2e across backend API, dashboard SSR, and static site.

### Cypress

- **Strengths**: Developer-friendly UI, time-travel debugging, large ecosystem.
- **Weaknesses**: Single-tab limitation, slower CI runs, WebKit support experimental, axe-core integration is community-maintained, no built-in API testing.
- **Fit**: Good for dashboard-only e2e but less suitable for full-stack monorepo testing.

### Storybook + Test Runner

- **Strengths**: Component isolation, visual catalogue, a11y addon for per-component WCAG audits.
- **Weaknesses**: Cannot test SSR, multi-page flows, authentication, or API integration. Not a true e2e harness.
- **Fit**: Complementary tool for component development, not a replacement for e2e.

## 3. Architecture

```text
monorepo root
├── e2e/
│   ├── playwright.config.ts        # shared config
│   ├── fixtures/
│   │   ├── auth.ts                 # authenticated session fixture
│   │   ├── api.ts                  # API client fixture
│   │   └── axe.ts                  # axe-core audit fixture
│   ├── backend/                    # backend API e2e tests
│   │   ├── events.spec.ts
│   │   ├── leads.spec.ts
│   │   ├── metrics.spec.ts
│   │   └── webhooks.spec.ts
│   ├── dashboard/                  # dashboard browser e2e tests
│   │   ├── auth.spec.ts
│   │   ├── metrics-overview.spec.ts
│   │   ├── event-explorer.spec.ts
│   │   ├── lead-list.spec.ts
│   │   ├── settings.spec.ts
│   │   └── wcag.spec.ts           # dedicated WCAG sweep
│   └── static/                     # static site browser e2e tests
│       ├── email-capture.spec.ts
│       ├── navigation.spec.ts
│       └── wcag.spec.ts           # dedicated WCAG sweep
├── backend/
├── dashboard/
└── static/
```

### Test database

- e2e tests run against a dedicated test database (separate from dev/prod).
- Database is seeded with known fixtures before each test suite.
- Prisma migrations are applied automatically in the test setup.
- Database is reset between test suites (not between individual tests — too slow).

### Server lifecycle

- `playwright.config.ts` uses the `webServer` option to start the backend + dashboard process before tests.
- Static site tests serve `static/dist/` via a lightweight HTTP server (e.g. `sirv-cli`).

## 4. Backend e2e Testing

Backend API tests use Playwright's `request` context (no browser needed).

### Test categories

| Category | Example tests |
|----------|--------------|
| Event ingestion | Valid event accepted, invalid payload rejected, rate limiting enforced |
| Lead capture | Email captured, duplicate handling, consent recorded |
| Metrics | Summary returns correct rollups, comparison windows, empty states |
| Webhooks | Description service webhook accepted, idempotency, auth required |
| Auth | Login success/failure, session validation, logout |
| Tenant isolation | Data only visible to correct tenant (RLS verification) |

### Relationship to existing integration tests

The backend already has Vitest integration tests in `backend/test/integration/`. These test service-layer logic with a real database. Playwright API e2e tests are **additive** — they test the full HTTP layer (headers, status codes, CORS, rate limits, auth cookies) which integration tests may skip.

## 5. Dashboard e2e Testing

Dashboard tests run in real browsers (Chromium, Firefox, WebKit).

### Test categories

| Category | Example tests |
|----------|--------------|
| Authentication | Login flow, redirect on unauthenticated access, logout |
| Metrics overview | Cards render with data, charts display, property picker filters |
| Event explorer | Pagination, filtering, date range selection |
| Lead list | Search, sorting, consent status display |
| Settings | API key creation, team management, property CRUD |
| i18n | French locale renders correct strings, date/number formatting |
| Responsive | Key pages render correctly at mobile, tablet, desktop widths |

### Auth fixture

```typescript
// e2e/fixtures/auth.ts
import { test as base } from "@playwright/test";

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    // Login via API to avoid UI overhead
    await page.request.post("/v1/auth/login", {
      data: { email: "test@example.com", password: "test-password" },
    });
    await use(page);
  },
});
```

## 6. Static Site e2e Testing

Static site tests run against `static/dist/` served locally.

### Test categories

| Category | Example tests |
|----------|--------------|
| Email capture | Form submission (JS enabled), form fallback (JS disabled), validation errors |
| Navigation | All internal links resolve, no broken links |
| Face-pose interaction | Component loads, responds to pointer events |
| Performance | Lighthouse CI budget assertions (FCP, CLS, LCP) |

## 7. WCAG Compliance Testing

This is the primary reason for recommending Playwright — `@axe-core/playwright` provides the most robust automated WCAG testing available.

### Integration

```typescript
// e2e/fixtures/axe.ts
import AxeBuilder from "@axe-core/playwright";

export async function checkAccessibility(page: Page, options?: { exclude?: string[] }) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
    .exclude(options?.exclude ?? [])
    .analyze();

  expect(results.violations).toEqual([]);
}
```

### Coverage strategy

| Scope | Approach |
|-------|----------|
| **Dashboard — every page** | Each dashboard e2e test calls `checkAccessibility(page)` after page load. Catches contrast, ARIA, structure issues. |
| **Dashboard — dedicated sweep** | `dashboard/wcag.spec.ts` navigates to every route and runs a full axe audit. Catches pages that might be missed by feature tests. |
| **Static site — every page** | `static/wcag.spec.ts` loads each HTML file from `dist/` and runs axe audit. |
| **Component-level (optional)** | If Storybook is added, `@storybook/addon-a11y` runs axe on individual components during development. |

### What axe-core catches automatically

- Colour contrast violations (WCAG 1.4.3, 1.4.11)
- Missing alt text (WCAG 1.1.1)
- Missing form labels (WCAG 1.3.1, 4.1.2)
- Invalid ARIA attributes (WCAG 4.1.2)
- Heading hierarchy issues (WCAG 1.3.1)
- Keyboard trap detection (WCAG 2.1.2)
- Focus indicator presence (WCAG 2.4.7)

### What requires manual testing

- Logical reading order (beyond DOM order)
- Meaningful alt text quality (axe checks presence, not quality)
- Complex keyboard interaction patterns
- Screen reader announcement quality
- Timing and animation concerns (WCAG 2.2.1, 2.3.1)

## 8. CI Integration

### Pipeline

```yaml
# Conceptual GitHub Actions workflow
e2e:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_DB: altcontext_test
        POSTGRES_USER: test
        POSTGRES_PASSWORD: test
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - run: npm ci --workspaces
    - run: npx prisma migrate deploy --schema backend/prisma/schema.prisma
      env: { DATABASE_URL: "postgresql://test:test@localhost:5432/altcontext_test" }
    - run: npx playwright install --with-deps
    - run: npx playwright test
      env:
        DATABASE_URL: "postgresql://test:test@localhost:5432/altcontext_test"
        SESSION_SECRET: test-secret
        IP_HASH_PEPPER: test-pepper
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: e2e/playwright-report/
```

### CI gates

| Gate | Threshold | Blocks merge? |
|------|-----------|---------------|
| All e2e tests pass | 100% | Yes |
| axe-core WCAG AA violations | 0 | Yes |
| Lighthouse performance (static) | FCP < budget | Yes |
| Screenshot comparison | No unexpected diffs | Yes (after baselines established) |

## 9. Delivery Phases

### Phase E2E-1: Foundation (1–2 days)

- [ ] Create `e2e/` directory structure and `playwright.config.ts`.
- [ ] Install Playwright + `@axe-core/playwright`.
- [ ] Create auth, API, and axe fixtures.
- [ ] Write first backend API test (health check) and first dashboard test (login flow).
- [ ] Verify local execution works.

### Phase E2E-2: Backend API Coverage (1–2 days)

- [ ] e2e tests for event ingestion, lead capture, metrics endpoints.
- [ ] Auth and tenant isolation tests.
- [ ] Webhook endpoint tests.

### Phase E2E-3: Dashboard Coverage + WCAG (2–3 days)

- [ ] e2e tests for all dashboard pages (metrics, events, leads, settings).
- [ ] axe-core WCAG audit on every dashboard route.
- [ ] i18n verification tests (French locale).
- [ ] Responsive layout tests.

### Phase E2E-4: Static Site Coverage + WCAG (1–2 days)

- [ ] e2e tests for email capture form (JS + no-JS).
- [ ] axe-core WCAG audit on all static pages.
- [ ] Lighthouse performance budget assertions.

### Phase E2E-5: CI Pipeline (1 day)

- [ ] GitHub Actions workflow for e2e tests.
- [ ] Postgres service container, migration, seed.
- [ ] Artifact upload on failure.
- [ ] Branch protection rules: require e2e pass + zero WCAG violations.

### Phase E2E-6: Storybook (optional, 1–2 days)

- [ ] Install Storybook for dashboard.
- [ ] Write stories for key UI components (metric cards, charts, property picker).
- [ ] Enable `@storybook/addon-a11y` for per-component WCAG audits.
- [ ] Chromatic or screenshot-based visual regression (optional).

## References

- Playwright docs: https://playwright.dev/
- @axe-core/playwright: https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Storybook: https://storybook.js.org/
- @storybook/addon-a11y: https://storybook.js.org/addons/@storybook/addon-a11y
- Lighthouse CI: https://github.com/GoogleChrome/lighthouse-ci
- Dashboard epic: [dashboard.md](dashboard.md)
- Backend epic: [backend-marketing-server.md](backend-marketing-server.md)
- Master roadmap: [../ROADMAP.md](../ROADMAP.md)
