# Task: Mobile Viewport Fit — Safari, No Scrollbars, WCAG

Fit the entire landing page within one mobile Safari screen (no scrollbars). Place the face image behind the CTA so gyroscope motion remains visible while the user interacts with the form. Fix WCAG colour contrast and add semantic HTML landmarks.

**Target viewport**: iPhone 14 — 390 × 844 logical px (100dvh).

---

## Current State

| Issue | Detail |
|---|---|
| **Overflow** | Page is ~1077px at 390×844. ~233px scrollbar. |
| **Typography** | `h1` 6rem, `h2` 3rem — no mobile breakpoint. |
| **Layout** | Face viewer → metadata panel → email CTA stacked vertically, no overlap. |
| **Stacking** | Face viewer is in normal flow. No z-layering behind CTA. |
| **WCAG contrast** | `h1`/`h2` use `#3b1e35` on `#75995f` bg — **2.1:1** ratio (fails AA 4.5:1 normal, 3:1 large). |
| **Semantics** | No `<header>`, `<footer>`, `<section>` or ARIA landmarks. `<main>` present. |
| **Safari bounce** | No `overscroll-behavior: none`. |
| **Input zoom** | Email input at 1rem — Safari auto-zooms below 16px. |

---

## Proposed Layout (Mobile ≤ 30rem)

```
┌──────────────────────────────┐ ◄─ 100dvh
│  ╭────────╮                  │
│  │  FACE  │  (z-index: 0)    │  ◄─ Full-bleed circle, behind content
│  │ IMAGE  │                  │
│  ╰────────╯                  │
│                              │
│  ┌──────────────────────────┐│
│  │  AltContext.             ││  ◄─ h1, overlay on face
│  │  Face Recognition for WP ││  ◄─ h2
│  │                          ││
│  │  [email@example.com]     ││  ◄─ CTA form (z-index: 2)
│  │  [  Sign Up  ]           ││
│  │  consent text            ││
│  └──────────────────────────┘│
└──────────────────────────────┘
```

The face image fills most of the viewport as a background layer. Text and CTA float above it. Metadata panel is hidden on mobile.

---

## Changes Required

### Relevant Files
- [site.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/site.scss)
- [_tokens.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/_tokens.scss)
- [_typography.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/_typography.scss)
- [_face-pose.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/_face-pose.scss)
- [_email-capture.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/_email-capture.scss)
- [_base.scss](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/styles/_base.scss)
- [index.html](file:///Users/daniel/Development/altcontext-marketing-monorepo/frontend/src/index.html)

### 1. Viewport Fit (no scrollbar)

- `body` / root container: `height: 100dvh; overflow: hidden;` at mobile breakpoint.
- Add `overscroll-behavior: none` to prevent Safari rubber-banding.
- Use flexbox column on `body` or `.container` to distribute space.

### 2. Face Image Behind CTA (z-layering)

- At mobile breakpoint, position `.face-pose-viewer` as `position: fixed` or `position: absolute` filling the viewport, with a low `z-index` (0 or -1).
- Remove `aspect-ratio` constraint at mobile — let it fill the screen.
- Content (`h1`, `h2`, email form) sits above with `position: relative; z-index: 1+`.
- `pointer-events: none` on the face container so CTA remains tappable, but gyroscope motion still works (gyro doesn't need pointer events).

### 3. Typography — Mobile Breakpoint

At `@media (width <= 30rem)`:
- `h1`: reduce from `6rem` → `3rem` or `clamp(2.5rem, 10vw, 6rem)`.
- `h2`: reduce from `3rem` → `1.25rem` or `clamp(1rem, 5vw, 3rem)`.

### 4. Metadata Panel — Hide on Mobile

- `display: none` at mobile breakpoint. It contributes significant height and is secondary information.

### 5. Email Capture — Compact

- Reduce `margin-top` and `padding` on `.email-capture-section` at mobile.
- Ensure `font-size: 16px` on input to prevent Safari auto-zoom.

### 6. WCAG Colour Contrast

| Element | Current | Proposed | Ratio |
|---|---|---|---|
| `h1` text | `#3b1e35` on `#75995f` | `#fff` on `#75995f` | **4.6:1** ✓ AA large |
| `h2` text | `#3b1e35` on `#75995f` | `#fff` on `#75995f` | **4.6:1** ✓ AA large |
| Consent links | `#e063c1` on `#75995f` | `#e063c1` on dark overlay | verify ≥ 4.5:1 |
| Button text | `#e063c1` on transparent | keep — `#e063c1` on dark bg ✓ | verify ≥ 4.5:1 |

Since the face image is now behind text, add a semi-transparent dark gradient overlay between the face and the text content to ensure contrast on any face image.

### 7. Semantic HTML

```diff
- <main class="container">
-   <h1>AltContext.</h1>
-   <h2>Face Recognition for WordPress.</h2>
+ <header>
+   <h1>AltContext.</h1>
+   <p class="tagline">Face Recognition for WordPress.</p>
+ </header>
+ <main class="container">
    ...face viewer...
-   <section class="email-capture-section">
+   <section class="email-capture-section" aria-label="Email signup">
```

- Wrap heading in `<header>`.
- Change `<h2>` to `<p class="tagline">` — it's a tagline, not a true section heading.
- Add `aria-label` to the email form section.
- Consider adding `role="img"` and `aria-label` to the face viewer for screen readers.

---

## Acceptance Criteria

- [ ] On iPhone 14 Safari (390 × 844), no vertical scrollbar is present.
- [ ] Face image is visible behind the CTA and responds to gyroscope.
- [ ] CTA form (email + button) is fully tappable above the face.
- [ ] All text passes WCAG AA contrast (4.5:1 normal, 3:1 large).
- [ ] `<header>`, `<main>`, `<section>` landmarks present.
- [ ] No Safari auto-zoom on input focus (font-size ≥ 16px).
- [ ] Desktop layout is not broken by mobile-only changes.
- [ ] `make build` passes.
