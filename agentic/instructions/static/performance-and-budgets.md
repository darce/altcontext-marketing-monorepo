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

## WCAG Compliance

The static marketing site must meet **WCAG 2.2 Level AA**.

### Colour Contrast

- All text must meet minimum contrast ratios: **4.5:1** for normal text, **3:1** for large text (≥18pt or ≥14pt bold).
- UI elements (buttons, form inputs, focus rings) must have **3:1** contrast against adjacent colours.
- Audit SCSS token values in `styles/_tokens.scss` and adjust as needed. Document approved palette.
- The face-pose interactive area must have sufficient contrast for any overlaid text or controls.

### Semantic HTML and Accessibility

- Logical heading hierarchy (`h1` → `h2` → `h3`) on every page.
- All images must have meaningful `alt` text (this is core to AltContext's product — lead by example).
- Skip-to-content link at the top of every page.
- Form inputs (email capture) must have associated `<label>` elements and `aria-describedby` for error messages.
- `aria-live` regions for dynamic content updates (form submission feedback, face-pose status).
- Focus management: visible `:focus-visible` indicators on all interactive elements (already in critical CSS force-includes).

### Keyboard Navigation

- All interactive elements must be operable via keyboard.
- The face-pose interaction must degrade gracefully for keyboard-only and screen-reader users (provide static fallback or alternative content).
- Tab order must follow visual layout.

### Testing

- **Automated**: Lighthouse accessibility audit in CI (score ≥ 90). Additionally, `axe-core` CLI or Playwright integration for detailed WCAG violation detection.
- **Manual**: Periodic VoiceOver (macOS) and keyboard-only testing.
- **Build gate**: axe-core AA violations fail the build.

### Delivery

- Phase WCAG-S1: Audit `_tokens.scss` colour palette for contrast compliance. Fix violations.
- Phase WCAG-S2: Add skip link, review heading hierarchy, add `aria-live` regions, audit `alt` text.
- Phase WCAG-S3: Keyboard navigation audit for face-pose interaction; add static fallback if needed.
- Phase WCAG-S4: Integrate Lighthouse + axe-core into CI pipeline.
