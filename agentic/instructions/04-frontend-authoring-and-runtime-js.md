# Frontend Authoring and Runtime JS

## Frontend Authoring Rules

### SCSS Organization (`frontend/styles/`)

- `_tokens.scss`: design tokens
- `_base.scss`: reset + body defaults
- `_layout.scss`: structural layout primitives
- `_components.scss`: UI components
- `_utilities.scss`: focused utility helpers
- `site.scss`: single entrypoint

### Mobile-First Rules

- Base styles target narrow viewports first.
- Use `@media (min-width: ...)` for wider breakpoints.
- Avoid deep selector nesting and long chains.

### Font Rules

- Prefer system font stack first.
- If custom fonts are used:
  - WOFF2 only
  - `font-display: swap`
  - preload only one above-the-fold face

### Image and Icon Rules

- Always set `width`/`height` or `aspect-ratio`.
- Use AVIF/WebP where practical.
- Lazy-load below-the-fold media with `loading="lazy"` and `decoding="async"`.
- Inline only truly critical SVG icons.

## Runtime JavaScript Rules

### Default Stance

- No JS required for first paint.

### If JS Is Introduced

- Load with `defer`.
- Keep it progressive enhancement only.
- No third-party script before first paint.
- Use arrow functions for JS/TS function definitions unless `this` binding requires `function`.

### Approved Lightweight Patterns

- Module: encapsulate state and reduce globals.
- State: explicit UI states for forms and async flows.
- Facade: wrap browser/network APIs behind stable helpers.
- Command: queue telemetry or retryable actions cleanly.
- Observer (tiny/local only): decouple small UI interactions when needed.
- Add a comment each time a pattern is used with a brief rationale.

### Runtime Limits

- Avoid framework-style runtime architecture.
- Prefer composition over inheritance.
- If an abstraction adds more complexity than it removes, do not use it.
