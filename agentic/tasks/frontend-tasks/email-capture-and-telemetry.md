# Email Collection and Frontend Metrics Integration

## Problem Statement

The marketing site has no email collection UI and no connection to the backend. The backend has working `/v1/events` and `/v1/leads/capture` endpoints, but the frontend sends zero beacons and has zero forms. Visitors cannot enter their email, and no engagement or rendering metrics are recorded.

## Workflow Principles

- Static-first: the email form must work without JS (progressive enhancement via `<form>` POST).
- Non-blocking: event beacons must never delay paint or interaction. Use `sendBeacon` or async `fetch` with short timeouts.
- Minimal PII: only capture email when the user explicitly submits. No pre-capture keystroke telemetry.
- PIPEDA/CASL: form must include a clear consent statement before submission.

## Terminology

- **Beacon**: A non-blocking telemetry event sent via `navigator.sendBeacon` or async `fetch` fire-and-forget.
- **anon_id**: A client-side stable identifier stored in `localStorage`, sent with every beacon and form submission to enable visitor stitching.
- **CWV**: Core Web Vitals — FCP, LCP, INP, CLS, TTFB.

## Current State Analysis

- `index.html` has no `<form>` element and no email input.
- `face-pose/index.ts` (464 lines) handles the interactive face viewer but has no beacon or analytics code.
- Backend `POST /v1/events` accepts `{ anonId, eventType, path, props, timestamp }` with honeypot.
- Backend `POST /v1/leads/capture` accepts `{ email, anonId, path, honeypot }` and handles both JSON and form-urlencoded.
- Backend returns 303 redirect for form-urlencoded POST (no-JS fallback).
- No `BACKEND_URL` or API base URL is configured anywhere in the frontend build.
- No `anon_id` generation exists in frontend code.

## Proposed Solution

Add three pieces to the frontend:

1. **Email collection form** — A `<form>` at the bottom of `index.html` with email input, honeypot, consent text, and submit button. Posts to `/v1/leads/capture`. Works without JS. With JS, intercepts submit, sends JSON, shows success/error inline.

2. **Beacon module** — A small `telemetry.ts` module that generates/retrieves `anon_id`, sends `page_view` on load, `engagement` on visibility change (with engaged time), and `cwv` with web vitals after load.

3. **Build config** — A `BACKEND_URL` environment variable injected at build time (via `define` in the build config or a simple string replacement) so the frontend knows where to send beacons.

## Patterns to Follow

### anon_id generation

```typescript
const ANON_ID_KEY = "altctx_anon_id";

const getAnonId = (): string => {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
};
```

### Non-blocking beacon

```typescript
const sendBeacon = (eventType: string, props?: Record<string, unknown>): void => {
  const payload = JSON.stringify({
    anonId: getAnonId(),
    eventType,
    path: location.pathname,
    timestamp: new Date().toISOString(),
    props,
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon(`${BACKEND_URL}/v1/events`, new Blob([payload], { type: "application/json" }));
  } else {
    fetch(`${BACKEND_URL}/v1/events`, {
      method: "POST",
      body: payload,
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  }
};
```

### Email form (no-JS fallback)

```html
<form
  id="email-form"
  method="POST"
  action="https://BACKEND_URL/v1/leads/capture"
  class="email-capture"
>
  <label for="email-input">Get early access:</label>
  <div class="email-capture-row">
    <input
      id="email-input"
      type="email"
      name="email"
      placeholder="you@example.com"
      required
      autocomplete="email"
    />
    <button type="submit">Sign up</button>
  </div>
  <!-- Honeypot — hidden from real users -->
  <input type="text" name="honeypot" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px" />
  <input type="hidden" name="path" value="/" />
  <p class="email-capture-consent">
    We'll email you product updates. Unsubscribe anytime. 
    <a href="/privacy">Privacy policy</a>.
  </p>
</form>
```

### JS-enhanced form submit

```typescript
const enhanceForm = (form: HTMLFormElement): void => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (form.querySelector("[name=email]") as HTMLInputElement).value;
    const honeypot = (form.querySelector("[name=honeypot]") as HTMLInputElement).value;
    try {
      const res = await fetch(`${BACKEND_URL}/v1/leads/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, anonId: getAnonId(), path: location.pathname, honeypot }),
      });
      if (res.ok) {
        form.innerHTML = "<p class='email-capture-success'>Thanks! We'll be in touch.</p>";
      } else {
        showFormError(form, "Something went wrong. Please try again.");
      }
    } catch {
      showFormError(form, "Network error. Please try again.");
    }
  });
};
```

## Functions to Change

| File | Line | Change |
|---|---|---|
| `frontend/src/index.html` | after `</main>` closing or inside `<main>` | Add email capture `<form>` with honeypot, consent text |
| `frontend/src/assets/telemetry.ts` | new | Create beacon module: `getAnonId`, `sendBeacon`, `trackPageView`, `trackEngagement`, `trackCwv`, `enhanceForm` |
| `frontend/src/index.html` | `<script>` | Add `<script src="assets/telemetry.js" defer></script>` |
| `frontend/styles/_base.scss` or new `_email-capture.scss` | — | Styles for `.email-capture`, `.email-capture-row`, `.email-capture-consent`, `.email-capture-success` |
| `frontend/styles/site.scss` | — | `@use 'email-capture'` if new partial created |

## Related Files

| File | Note |
| --- | --- |
| `backend/src/routes/events.ts` | Target for beacons — no changes needed |
| `backend/src/routes/leads.ts` | Target for form POST — no changes needed |
| `backend/src/schemas/events.ts` | Validates beacon payload shape — reference for client-side payload |
| `backend/src/schemas/leads.ts` | Validates lead capture body — reference for form fields |
| `backend/src/config/env.ts` | `CORS_ALLOWED_ORIGINS` must include the production frontend domain |
| `frontend/src/assets/face-pose/index.ts` | Existing JS entry point — telemetry.ts is a separate entry, not merged into this |
| `agentic/instructions/02-performance-and-budgets.md` | JS budget constraints — telemetry module must be tiny |
| `agentic/tasks/backend-tasks/deploy-marketing-backend-to-fly.md` | Backend must be deployed before frontend can send real beacons |

---

# Consolidated Checklist

## Completed

- [x] Backend `/v1/events` endpoint implemented and tested.
- [x] Backend `/v1/leads/capture` endpoint implemented with form-urlencoded + JSON support.
- [x] Backend honeypot validation and consent tracking implemented.

## Phase 1: Email Capture Form (0.5 days)

- [ ] Add `<form>` to `index.html` with email input, honeypot, hidden `path` field, consent copy.
- [ ] `action` URL points to backend `/v1/leads/capture`.
- [ ] Verify no-JS fallback: plain form POST → 303 redirect → page reload.
- [ ] Add `.email-capture` styles (inline with design tokens from `_tokens.scss`).

## Phase 2: Telemetry Module (1 day)

- [ ] Create `frontend/src/assets/telemetry.ts`.
- [ ] Implement `getAnonId()` — `localStorage` stable UUID.
- [ ] Implement `sendBeacon(eventType, props)` — `navigator.sendBeacon` with `fetch` fallback.
- [ ] Fire `page_view` beacon on `DOMContentLoaded`.
- [ ] Fire `engagement` beacon on `visibilitychange` (hidden) with `engagedTimeMs` prop.
- [ ] Add `<script src="assets/telemetry.js" defer></script>` to `index.html`.
- [ ] Inject `BACKEND_URL` at build time (esbuild `define` or Rollup equivalent).

## Phase 3: Web Vitals and Rendering Metrics (0.5 days)

- [ ] Use `web-vitals` library (or manual `PerformanceObserver`) to capture FCP, LCP, INP, CLS, TTFB.
- [ ] Fire `cwv` beacon after LCP settles (typically within 2.5s of load).
- [ ] Include face-pose load timing in props: `{ facePoseInitMs }` from existing `performance.now()` instrumentation.
- [ ] Ensure total telemetry JS is < 3 KB gzipped (per performance budget).

## Phase 4: JS-Enhanced Form (0.5 days)

- [ ] Intercept form submit with JS when available.
- [ ] Send JSON `{ email, anonId, path, honeypot }` to `/v1/leads/capture`.
- [ ] Show inline success message on 200 (replace form with "Thanks" text).
- [ ] Show inline error on failure (network or 4xx) with retry affordance.
- [ ] Fire `form_submit` beacon with `{ formName: "email_capture" }` on successful submission.

## Phase 5: Scroll Depth and Interaction Events (0.5 days)

- [ ] Track max scroll depth via `IntersectionObserver` on sentinel elements (25%, 50%, 75%, 100%).
- [ ] Fire `scroll_depth` beacon on `visibilitychange` with `{ maxDepthPercent }`.
- [ ] Fire `cta_click` beacon on face-pose interaction start (first pointer/touch event on container).
- [ ] Fire `face_pose_scrub` beacon on session end with `{ scrubDurationMs, framesViewed }`.

## Phase 6: Verify End-to-End

- [ ] Deploy backend (see `deploy-marketing-backend-to-fly.md`).
- [ ] Deploy frontend with `BACKEND_URL` pointing to Fly app.
- [ ] Confirm `page_view` events appear in `events` table.
- [ ] Confirm email capture creates `leads` + `lead_identities` rows.
- [ ] Confirm CWV metrics appear in event `props` column.
- [ ] CORS working: no console errors from cross-origin beacon/form.

## Stretch Goals

- [ ] Add scroll-triggered CTA: show email form only after 50% scroll depth (reduces initial visual load).
- [ ] A/B test form placement (below hero vs. sticky footer) via `props.variant` on beacon.
- [ ] Add `utm_*` param extraction from URL to beacon payloads for attribution.

## Success Criteria

- [ ] Email form visible on the marketing site, works with and without JS.
- [ ] `page_view` beacon fires on every page load; `events` table has rows with real visitor data.
- [ ] CWV metrics (FCP, LCP, CLS, INP, TTFB) recorded in `events.props` for every page view.
- [ ] At least one email captured end-to-end: marketing page → backend → `leads` table.
- [ ] `GET /v1/metrics/summary` returns non-zero `uniqueVisitors` and `leadsCaptured` after 24h of live traffic.
