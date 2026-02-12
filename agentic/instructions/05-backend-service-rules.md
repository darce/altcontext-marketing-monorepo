# Backend Service Rules

- Backend lives in `backend/` and supports email collection + marketing intelligence workflows.
- Frontend pages must not depend on backend availability for first render.
- HTML forms should still degrade gracefully when JS is absent.

## API Behavior

- Keep response payloads small.
- Validate all inputs server-side.
- Apply rate limiting on write endpoints.
- Return explicit non-2xx failures and avoid leaking internals.

## Integration Behavior

- Frontend telemetry and submit events must be non-blocking.
- Do not introduce blocking scripts in `<head>` for analytics.
