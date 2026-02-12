# Agentic Instructions: AltContext Marketing Monorepo

This document defines the performance, build, and coding rules for the marketing monorepo.

The current monorepo structure is:
- `frontend/`: static marketing site and build tooling
- `backend/`: email collection and marketing intelligence server

---

## Quick Navigation

- [Project Context](#project-context)
- [Goals and Budgets](#goals-and-budgets)
- [Runtime and Hosting Constraints](#runtime-and-hosting-constraints)
- [Monorepo Architecture](#monorepo-architecture)
- [Build Pipeline and Scripts](#build-pipeline-and-scripts)
- [Critical CSS Strategy](#critical-css-strategy)
- [Frontend Authoring Rules](#frontend-authoring-rules)
- [Runtime JavaScript Rules](#runtime-javascript-rules)
- [Backend Service Rules](#backend-service-rules)
- [Local Development (macOS Apache)](#local-development-macos-apache)
- [Python Standards (`frontend/offline-scripts/`)](#python-standards-frontendoffline-scripts)
- [TypeScript Standards (Build Tooling)](#typescript-standards-build-tooling)
- [Verification Gates](#verification-gates)
- [Agent Rules of Engagement](#agent-rules-of-engagement)

---

<a id="project-context"></a>
## 1. Project Context

- Frontend is an MPA-style static site generated into `frontend/dist/`.
- Backend is a separate service for email capture and marketing intelligence.
- Marketing pages must remain fast and static-first even when backend integrations are enabled.

---

<a id="goals-and-budgets"></a>
## 2. Goals and Budgets

### Primary goal
- Minimize First Contentful Paint (FCP) on cold-cache mobile-like conditions.

### Secondary goals
- Keep Cumulative Layout Shift (CLS) low.
- Keep runtime dependencies minimal.

### Budgets (treat as hard limits)
- Critical path (HTML + inlined critical CSS + critical inline JS): `< 14KB` compressed.
- Inlined critical CSS: `2KB` to `8KB` compressed.
- Non-critical CSS loaded after first paint: `< 30KB` compressed.
- Runtime JS required for first paint: default `0KB`.
- Progressive enhancement JS (if required): `< 10KB` compressed and deferred.

---

<a id="runtime-and-hosting-constraints"></a>
## 3. Runtime and Hosting Constraints

- Build-time tools can use Node.js and Python locally/CI.
- Deployment artifact for the marketing site is the contents of `frontend/dist/`.
- Static hosting remains Apache-first.
- Backend APIs are separate from paint-critical frontend delivery.
- No build tool should assume Node/Python runtime is available on the static host.

---

<a id="monorepo-architecture"></a>
## 4. Monorepo Architecture

```text
./agentic/
  instructions.md

./backend/
  package.json
  server.js

./frontend/
  package.json
  tsconfig.tools.json
  build/
    copy.ts
    compress.ts
    critcss.ts
    extract-metadata.ts
    prepare-derivatives.ts
  styles/
    site.scss
    _tokens.scss
    ...
  src/
  public/
  offline-scripts/
  dist/
```

Notes:
- `frontend/dist/` is deploy output.
- `frontend/build/*.ts` are build tools only and are not shipped to runtime.

---

<a id="build-pipeline-and-scripts"></a>
## 5. Build Pipeline and Scripts

### Toolchain
- `sass` for SCSS compilation
- `postcss-cli` + `autoprefixer` + `cssnano`
- `tsx` + TypeScript for build tooling
- `critical` for critical CSS extraction/inlining
- `eslint`, `stylelint`, `prettier` as quality gates

### Canonical frontend scripts
- Fast site build:
  - `npm --prefix frontend run build`
  - `npm --prefix frontend run build:web` (alias)
- Full build (data + derivatives + assets):
  - `npm --prefix frontend run build:full`
- Full build with explicit recrop:
  - `npm --prefix frontend run build:full:refresh`
  - `npm --prefix frontend run build:full:refresh:missing`
- Data-only pipeline:
  - `npm --prefix frontend run build:data:extract`
  - `npm --prefix frontend run build:data:derive`
  - `npm --prefix frontend run build:data:derive:recrop`
  - `npm --prefix frontend run build:data:derive:recrop:missing`
- Asset-only pipeline:
  - `npm --prefix frontend run build:assets`
  - `npm --prefix frontend run build:assets:copy`
  - `npm --prefix frontend run build:assets:css`
  - `npm --prefix frontend run build:assets:postcss`
  - `npm --prefix frontend run build:assets:compress`
- Compatibility aliases:
  - `npm --prefix frontend run build:metadata`
  - `npm --prefix frontend run build:derivatives`
  - `npm --prefix frontend run build:derivatives:recrop`
  - `npm --prefix frontend run build:derivatives:recrop:missing`

### Build-mode rules (speed)
- Default builds must avoid expensive recropping.
- Recropping must be opt-in through `--recrop=none|missing|all` or recrop scripts.
- If derivatives are missing and recrop is not enabled, fail with an actionable command.

---

<a id="critical-css-strategy"></a>
## 6. Critical CSS Strategy

### Rules
- Inline only above-the-fold CSS required for first paint.
- Load non-critical CSS asynchronously.
- Extract critical CSS at a mobile viewport first.

### Critical CSS contract
- `frontend/build/critcss.ts` must accept `BASE_URL`.
- Default `BASE_URL`: `http://dev.test/altcontext-marketing-monorepo/`.
- In CI, if Apache is unavailable, script may run a temporary static server against `frontend/dist/`.

### Async loading patterns
```html
<link rel="stylesheet" href="/assets/site.css" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="/assets/site.css"></noscript>
```

or

```html
<link rel="stylesheet" href="/assets/base.css">
<link rel="stylesheet" href="/assets/desktop.css" media="(min-width: 1024px)">
```

### Base-path correctness
If deployed under a subpath, do not rely on root-relative URLs unless configured for that subpath.

Preferred option:
```html
<base href="%%BASE_HREF%%">
<link rel="stylesheet" href="assets/site.css">
```

Build should replace `%%BASE_HREF%%` per environment.

### Force-include critical rules
Extractors may miss:
- `:focus-visible` and skip links
- `@font-face` used above the fold
- theme token declarations needed for first paint

Maintain a force-include snippet for these.

---

<a id="frontend-authoring-rules"></a>
## 7. Frontend Authoring Rules

### SCSS organization (`frontend/styles/`)
- `_tokens.scss`: design tokens
- `_base.scss`: reset + body defaults
- `_layout.scss`: structural layout primitives
- `_components.scss`: UI components
- `_utilities.scss`: focused utility helpers
- `site.scss`: single entrypoint

### Mobile-first rules
- Base styles target narrow viewports first.
- Use `@media (min-width: ...)` for wider breakpoints.
- Avoid deep selector nesting and long chains.

### Font rules
- Prefer system font stack first.
- If custom fonts are used:
  - WOFF2 only
  - `font-display: swap`
  - preload only one above-the-fold face

### Image and icon rules
- Always set `width`/`height` or `aspect-ratio`.
- Use AVIF/WebP where practical.
- Lazy-load below-the-fold media with `loading="lazy"` and `decoding="async"`.
- Inline only truly critical SVG icons.

---

<a id="runtime-javascript-rules"></a>
## 8. Runtime JavaScript Rules

### Default stance
- No JS required for first paint.

### If JS is introduced
- Load with `defer`.
- Keep it progressive enhancement only.
- No third-party script before first paint.
- Use arrow functions for JS/TS function definitions unless `this` binding requires `function`.

### Approved lightweight patterns
- Module: encapsulate state and reduce globals.
- State: explicit UI states for forms and async flows.
- Facade: wrap browser/network APIs behind stable helpers.
- Command: queue telemetry or retryable actions cleanly.
- Observer (tiny/local only): decouple small UI interactions when needed.

### Runtime limits
- Avoid framework-style runtime architecture.
- Prefer composition over inheritance.
- If an abstraction adds more complexity than it removes, do not use it.

---

<a id="backend-service-rules"></a>
## 9. Backend Service Rules

- Backend lives in `backend/` and supports email collection + marketing intelligence workflows.
- Frontend pages must not depend on backend availability for first render.
- HTML forms should still degrade gracefully when JS is absent.

### API behavior
- Keep response payloads small.
- Validate all inputs server-side.
- Apply rate limiting on write endpoints.
- Return explicit non-2xx failures and avoid leaking internals.

### Integration behavior
- Frontend telemetry and submit events must be non-blocking.
- Do not introduce blocking scripts in `<head>` for analytics.

---

<a id="local-development-macos-apache"></a>
## 10. Local Development (macOS Apache)

### Confirmed local path and URL
- Monorepo: `/Users/daniel/Development/altcontext-marketing-monorepo/`
- Frontend URL: `http://dev.test/altcontext-marketing-monorepo/`

### `.htaccess` rewrite for serving `frontend/dist/`
File: `/Users/daniel/Development/altcontext-marketing-monorepo/.htaccess`

```apacheconf
RewriteEngine On

RewriteRule ^frontend/dist/ - [L]

RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

RewriteRule ^$ frontend/dist/ [L]
RewriteRule ^(.+)$ frontend/dist/$1 [L]
```

### Git hygiene
- `.htaccess` should be gitignored as local-only convenience.
- Keep a committed template at `./.htaccess.example`.

---

<a id="python-standards-frontendoffline-scripts"></a>
## 11. Python Standards (`frontend/offline-scripts/`)

> [!IMPORTANT]
> Use `pathlib.Path`, strict typing, deterministic file ordering, and explicit error handling. Keep computation pure and keep I/O at entrypoints.

### Required rules
- All functions typed; no implicit `Any` in public helpers.
- Enforce `mypy --strict` (or equivalent strict pyright profile).
- Enforce Ruff formatting and linting.
- No bare `except`.
- Use `encoding="utf-8"` for text I/O.
- Sort all filesystem iteration before deterministic output.
- Use constants for landmark indices and magic values.
- Keep scripts single-purpose and split oversized files.

---

<a id="typescript-standards-build-tooling"></a>
## 12. TypeScript Standards (Build Tooling)

> [!IMPORTANT]
> TypeScript tooling must be strict, deterministic, ESM-consistent, and quiet by default. External input must be validated at boundaries.

### Required rules
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

---

<a id="verification-gates"></a>
## 13. Verification Gates

### Build and quality gates
- `npm --prefix frontend run build`
- `npm --prefix frontend run build:full`
- `npm --prefix frontend run typecheck`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run stylelint`
- `npm --prefix frontend run format`

### Performance gates
- Run Lighthouse mobile profile on:
  - home page
  - representative content page
  - email capture page
- Fail changes that:
  - exceed critical CSS budget
  - reintroduce render-blocking CSS/JS
  - load third-party scripts before interaction

---

<a id="agent-rules-of-engagement"></a>
## 14. Agent Rules of Engagement

### Do
- Prioritize static HTML and small CSS.
- Keep critical CSS minimal and async-load the rest.
- Keep builds deterministic and fast by default.
- Use recrop modes only when required.
- Keep backend integration off the paint-critical path.

### Do not
- Add a framework solely for convenience.
- Add large CSS frameworks to first-pass pages.
- Add third-party scripts in `<head>` without measured justification.
- Allow critical CSS to grow with below-the-fold styling.
