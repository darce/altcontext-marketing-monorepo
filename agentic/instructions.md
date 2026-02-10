# Agentic Instructions — Fastest Possible FCP (Marketing Site)

This file defines **non-negotiable performance constraints** and **build patterns** for achieving the fastest practical First Contentful Paint (FCP) on a marketing site delivered via **Apache + static files**, with optional **PHP/MySQL** at runtime.

**First pass:** no component framework; no SPA; no runtime build step.  
**Later:** re-evaluate if introducing Web Components / Custom Elements.

---

## 0) Runtime constraints (hard)

### Production hosting environment
- **Basic web hosting** (shared/cheap): Apache + static files.
- Runtime languages available: **PHP** (yes), **MySQL/MariaDB** (yes).
- Runtime languages NOT available: **Python/Node** (assume no).
- Therefore: **all bundling / SCSS compilation / critical CSS extraction happens at build time** (local or CI), and the output is uploaded.

### Local dev environment
- Local server is **macOS Apache** (Apple `/etc/apache2` or Homebrew Apache).
- PHP available locally (mod_php or php-fpm depending on setup).

---

## 1) Goals and non‑goals

### Primary goal
- **Minimize FCP** on a cold-cache visit under mobile-like conditions.

### Secondary goals
- Keep CLS low (avoid visible layout jumps) without sacrificing FCP.
- Keep pipeline simple; keep runtime dumb.

### Non‑goals (for now)
- No SPA hydration framework.
- No runtime Markdown/MDX parsing in the browser.
- No client JS required for first paint.

---

## 2) Measurable budgets (treat as hard constraints)

### Critical path payload (initial response)
- HTML + inlined critical CSS + critical inline JS (if any) target: **< 14KB compressed**.
- Inlined critical CSS target: **2–8KB compressed** (smaller is better).

### CSS budgets
- Critical CSS: only above-the-fold layout/typography/hero.
- Non-critical CSS (async): keep **< 30KB compressed** site-wide in first pass.

### JS budgets
- Default: **0KB required for first paint**.
- If needed for progressive enhancement: **< 10KB compressed**, loaded **deferred**.

---

## 3) Architecture (first pass)

### Rendering model
- **Static HTML** pages (MPA).
- Optional: build-time content pipeline for Markdown/MDX to HTML.
- Optional: PHP endpoints for forms/proxy, but keep them off the paint-critical path.

### Frontend stack (given)
- TypeScript (**build tooling only**; runtime JS optional and minimal)
- SCSS authored mobile-first → compiled to CSS
- Responsive with `min-width` overrides

---

## 4) Build tooling (build-time only; output is static)

**Build environment:** Node.js is available for building (local + CI).  
**Offline scripts:** Python is available locally for helper scripts in `offline-scripts/`.  
**Runtime:** Apache static hosting with optional PHP/MySQL (no Node/Python runtime assumptions).

### Baseline approach (TS for tools only; near-zero runtime JS)
Use a **Node-based asset pipeline** to compile SCSS into a static output folder (`dist/`). Use **TypeScript only for build scripts** (critical CSS, audits, content transforms). Do **not** require any runtime JS for the first paint.

- SCSS → CSS (minified)
- PostCSS Autoprefixer (+ optional cssnano) (recommended)
- Linting + formatting gates (TS tools + SCSS)
- Critical CSS extraction/inlining post-build (see §5)
- Upload **contents of `dist/`** (+ any PHP endpoints) to hosting

### Recommended toolchain (no Vite required)
- `sass` (Dart Sass) for SCSS compilation
- `postcss-cli + autoprefixer (+ cssnano)` for post-processing/minification
- `critical` (Penthouse) for critical CSS extraction/inlining
- `TypeScript + tsx` to run build-tool scripts (`build/*.ts`) without a separate compilation step
- ESLint (TypeScript tooling code)
- Stylelint (SCSS/CSS)
- Prettier (formatting)

### Source of truth (confirmed paths)
- `./package.json` — defines the build pipeline (**already configured**).
- `./tsconfig.tools.json` — TypeScript settings for tooling only (**already configured**).
- `./build/*.ts` — TypeScript build tooling (e.g. `critcss.ts`, `copy.ts`, `audit.ts`).
- `./styles/site.scss` — SCSS entrypoint compiled into `dist/assets/site.css`.
- `./dist/` — deploy artifact (static HTML + CSS + assets).
- `./.htaccess` — **local dev routing only** (see §11). SHOULD be in `.gitignore`.

### Required scripts (must exist in package.json)
Agents must not remove these without replacing functionality:

- `build` — produces a complete `dist/` ready to upload
- `build:critcss` — extracts + inlines critical CSS for each route/page
- `typecheck` — runs `tsc -p tsconfig.tools.json --noEmit`
- `lint` / `stylelint` / `format` — enforce code style and prevent regressions

### Critical CSS extraction: local Apache vs CI
Critical CSS tooling needs an HTTP URL to render pages.

- **Local dev (Apache):** base URL is `http://dev.test/altcontext-marketing/`
- **CI:** if Apache isn’t available, `build/critcss.ts` should start a temporary static file server that serves `dist/` and then shut it down after extraction.

**Implementation contract**
- `build/critcss.ts` MUST accept `BASE_URL` (env var). Default to `http://dev.test/altcontext-marketing/`.
- `build/critcss.ts` MUST run extraction at a mobile viewport first (e.g., 390×844) and inline the result into each HTML page.

**Rule:** do not add a heavyweight dev server to production. The site remains static; servers are only for build-time rendering during critical CSS extraction.

---

## 5) Critical CSS strategy (core requirement)

### Rule
- **Inline only the minimum CSS needed to paint above-the-fold content.**
- Load the remainder of CSS asynchronously.

### Implementation (build step)
1. Build the site to `dist/`.
2. Serve the output locally (or in CI) for extraction.
3. For each route:
   - Extract critical CSS (mobile viewport first).
   - Inject it into the page `<head>` as `<style>…</style>`.
   - Ensure full CSS loads **non-blocking**.

### Async CSS loading patterns (choose one)

**Pattern 1: media swap (simple, effective)**
```html
<link rel="stylesheet" href="/assets/site.css" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="/assets/site.css"></noscript>
```

**Pattern 2: split base vs desktop**
```html
<link rel="stylesheet" href="/assets/base.css">
<link rel="stylesheet" href="/assets/desktop.css" media="(min-width: 1024px)">
```

### IMPORTANT: base-path correctness (must not break when shipping `dist/`)
If the site is served under a subpath (like `/altcontext-marketing/`), then **root-relative asset URLs** like `/assets/site.css` will resolve to the domain root and break.

To ensure the contents of `dist/` can be shipped without manual edits:

**Standardize on ONE of the following:**

**Option A (recommended): `<base href>` + base-relative asset paths**
- Each HTML page includes:
```html
<base href="%%BASE_HREF%%">
<link rel="stylesheet" href="assets/site.css">
```
- Build step replaces `%%BASE_HREF%%` with the correct base for the environment:
  - local: `/altcontext-marketing/`
  - production: `/` (or `/altcontext-marketing/` if you deploy under a subpath)

**Option B: always prefix asset URLs with a build-time `PUBLIC_BASE`**
- Generate `<link href="/{PUBLIC_BASE}/assets/site.css">` at build time.

Agents MUST NOT introduce ad-hoc relative URLs that work only on the homepage.

### Force-include rules
Automated extractors often miss:
- `:focus-visible` and skip links
- `@font-face` (if used)
- dark-mode tokens  
Maintain a **force-include snippet** injected into every page’s critical CSS.

---

## 6) CSS authoring patterns (SCSS + mobile-first)

### Suggested structure
- `styles/_tokens.scss` — design tokens (spacing, colors, typography scale)
- `styles/_base.scss` — minimal reset + body defaults
- `styles/_layout.scss` — header/nav/hero layout primitives
- `styles/_components.scss` — minimal UI pieces
- `styles/_utilities.scss` — tiny helpers (sr-only, flow spacing)
- `styles/site.scss` — single entrypoint

### Mobile-first rule
- Base styles assume narrow viewport.
- Add enhancements with:
```scss
@media (min-width: 48rem) { /* ... */ }
@media (min-width: 64rem) { /* ... */ }
```

### Avoid expensive CSS patterns
- Avoid giant frameworks in first pass.
- Avoid deep nesting and long selector chains.
- Prefer CSS variables for theme toggles; avoid duplicating whole rule blocks.

### Optional: below-the-fold rendering optimization
Use `content-visibility: auto` on large below-fold sections; add `contain-intrinsic-size` to reduce layout thrash.

---

## 7) Fonts (don’t let fonts block paint)

### Default recommendation
- Use a **system font stack** initially (fastest).

### If using custom fonts
- WOFF2 only; subset if possible.
- `font-display: swap`.
- Preload only the single font needed for the initial viewport.

---

## 8) Images & icons (reduce bytes, prevent CLS)

- Inline critical SVG icons only (logo, small icons).
- Always set `width`/`height` (or CSS `aspect-ratio`) on images.
- Use AVIF/WebP for large imagery.
- Lazy-load below-fold:
```html
<img loading="lazy" decoding="async" ...>
```

---

## 9) JavaScript rules (keep it off the critical path)

### Default stance
- No JS required for first paint.

### If JS is needed
- Always `defer`.
- Progressive enhancement only.
- No third-party JS before paint.

Example:
```html
<script src="/assets/site.js" defer></script>
```

---

## 10) PHP patterns (allowed at runtime, not required for FCP)

Use PHP only for:
- Email capture POST handler (no-JS form)
- Simple proxy endpoints (e.g., to an email provider) if needed
- WordPress demo area (separate path/subdomain)

### Rules
- PHP must not be required to render the marketing pages (static HTML is canonical).
- PHP endpoints must return small responses; avoid blocking render resources.
- Secure by default:
  - validate inputs server-side,
  - rate limit (even basic),
  - use prepared statements for MySQL,
  - avoid leaking stack traces.

---

## 11) Local development on macOS Apache (dev.test)

### Local URL + mapping (confirmed)
- Apache vhost `dev.test` has `DocumentRoot "/Users/daniel/Development"`.
- Project path is: `/Users/daniel/Development/altcontext-marketing/`
- Site URL is: `http://dev.test/altcontext-marketing/`

### Serving `dist/` without adding a new vhost entry
Use a **project-local** `.htaccess` in the project root to rewrite requests into `dist/`:

**File path:** `/Users/daniel/Development/altcontext-marketing/.htaccess` (repo root)

```apacheconf
RewriteEngine On

# Don't rewrite requests that are already going to /dist/
RewriteRule ^dist/ - [L]

# If a real file/dir exists at project root, serve it as-is (optional)
RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

# Otherwise, serve everything out of dist/
RewriteRule ^$ dist/ [L]
RewriteRule ^(.+)$ dist/$1 [L]
```

### Git hygiene for `.htaccess`
- `.htaccess` is **local dev convenience** and SHOULD be in `.gitignore`.
- Commit a template instead, e.g. `./.htaccess.example`, and document: “copy to `.htaccess` for local Apache”.

### Asset-path rule (must not break under subpaths)
Avoid plain relative paths like `assets/site.css` unless you also have a `<base href>` (see §5). Without `<base>`, nested pages like `/about/` will resolve assets as `/altcontext-marketing/about/assets/...` and break.

---

## 12) Verification (required before merging perf changes)

### Required checks
- Lighthouse (mobile profile) on:
  - Home
  - A representative content page
  - Email capture page

### Regression gates
Fail the build if:
- Critical CSS exceeds budget,
- Render-blocking CSS/JS is reintroduced,
- New third-party scripts load before interaction.

---

## 13) Repo structure (confirmed) + integration notes

### Canonical repo structure
```
./package.json
./tsconfig.tools.json
./.gitignore
./.htaccess              # local only (gitignored)
./.htaccess.example      # committed template (recommended)

./build/                 # TS tooling only (not deployed)
  critcss.ts
  copy.ts
  audit.ts               # optional

./styles/                # SCSS sources
  site.scss
  _tokens.scss
  _base.scss
  _layout.scss
  _components.scss
  _utilities.scss

./src/                   # HTML templates/pages (or source pages)
./public/                # static assets copied as-is (images, robots.txt, etc.)

./dist/                  # deploy artifact (upload the CONTENTS of this folder)
  index.html
  about/index.html
  assets/site.css
  assets/...
```

### Tooling references
- Shell tools available: `agentic/available-tools.md`
- Shell scripts live in: `offline-scripts/`

Suggested scripts (names only; implement as needed):
- `offline-scripts/build.sh` — runs `npm run build`
- `offline-scripts/serve-apache.sh` — helper for local Apache (if needed)
- `offline-scripts/critcss.sh` — runs `npm run build:critcss`
- `offline-scripts/audit.sh` — Lighthouse + size budget checks

---

## 14) Agent rules of engagement (do/don’t)

### DO
- Prefer static HTML + minimal CSS.
- Inline critical CSS; async-load the rest.
- Keep base styles mobile-first.
- Use PHP only where it adds clear value (forms/proxy) and keep it off the critical path.
- Measure regressions.

### DON’T
- Add a framework “because it’s convenient”.
- Add large CSS frameworks.
- Add third-party scripts to `<head>` without measured justification.
- Let critical CSS grow to include below-the-fold styling.
