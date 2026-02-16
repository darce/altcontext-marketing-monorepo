# Performance and Budgets

## Goals

### Primary Goal

- Minimize First Contentful Paint (FCP) on cold-cache mobile-like conditions.

### Secondary Goals

- Keep Cumulative Layout Shift (CLS) low.
- Keep runtime dependencies minimal.

## Hard Budgets

- Critical path (HTML + inlined critical CSS + critical inline JS): `< 14KB` compressed.
- Inlined critical CSS: `2KB` to `8KB` compressed.
- Non-critical CSS loaded after first paint: `< 30KB` compressed.
- Runtime JS required for first paint: default `0KB`.
- Progressive enhancement JS (if required): `< 10KB` compressed and deferred.

## Critical CSS Strategy

### Core Rules

- Inline only above-the-fold CSS required for first paint.
- Load non-critical CSS asynchronously.
- Extract critical CSS at a mobile viewport first.

### Critical CSS Contract

- `frontend/build/critcss.ts` must accept `BASE_URL`.
- Default `BASE_URL`: `http://dev.test/altcontext-marketing-monorepo/`.
- In CI, if Apache is unavailable, script may run a temporary static server against `frontend/dist/`.

### Async Loading Patterns

```html
<link rel="stylesheet" href="/assets/site.css" media="print" onload="this.media='all'">
<noscript><link rel="stylesheet" href="/assets/site.css"></noscript>
```

or

```html
<link rel="stylesheet" href="/assets/base.css">
<link rel="stylesheet" href="/assets/desktop.css" media="(min-width: 1024px)">
```

### Base-Path Correctness

If deployed under a subpath, do not rely on root-relative URLs unless configured for that subpath.

Preferred option:

```html
<base href="%%BASE_HREF%%">
<link rel="stylesheet" href="assets/site.css">
```

Build should replace `%%BASE_HREF%%` per environment.

### Force-Include Critical Rules

Extractors may miss:

- `:focus-visible` and skip links
- `@font-face` used above the fold
- theme token declarations needed for first paint

Maintain a force-include snippet for these.
