# Context and Architecture

## Project Context

- Monorepo with three workspaces: `static/` (static marketing site), `backend/` (email capture + marketing intelligence), and `dashboard/` (SvelteKit admin dashboard).
- Marketing pages must remain fast and static-first; backend is never paint-critical.
- Dashboard is a SvelteKit app deployed alongside backend on Fly.io.
- Build-time tools can use Node.js and Python locally/CI.

## Hosting Model

- Static site deploys as static files from `static/dist/` (Apache-first).
- Backend + dashboard share a single Fly.io machine (one process, one port).
- No build tool should assume Node/Python runtime is available on the static host.

### Co-deployment Architecture

Backend (Fastify) and dashboard (SvelteKit) run inside a single Node process on one Fly.io machine.

```text
GitHub Pages (static site)                 Browser (admin user)
  │                                            │
  │ POST /v1/events  (cross-origin, CORS)     │ GET /            (same-origin, HTML)
  │ POST /v1/leads   (cross-origin, CORS)     │ GET /settings    (same-origin, HTML)
  ▼                                            ▼
┌─────────────────────────────────────────────────────────────┐
│                Fly.io machine (:3000)                        │
│                                                             │
│  Fastify (primary server)                                   │
│    /v1/*          → API routes (JSON)     ← registered first│
│                                                             │
│  SvelteKit (mounted via @fastify/middie)                    │
│    /*             → SSR dashboard (HTML)  ← catch-all       │
│    +page.server   → calls /v1/* internally (localhost)      │
└─────────────────────────────────────────────────────────────┘
```

**Key points:**

- Fastify API routes (`/v1/*`) are registered first and always take priority.
- Unmatched requests fall through to the SvelteKit Connect handler (via `@fastify/middie`).
- SvelteKit `load()` functions call the API server-side at `http://localhost:3000` — no network hop, no CORS.
- Browser requests to dashboard pages are same-origin — no CORS needed.
- The static marketing site remains the only cross-origin client; CORS allowlist is unchanged.
- If the dashboard build is absent (e.g. local dev), the mount is skipped and only the API runs.

## Monorepo Layout

```text
./agentic/
  instructions.md                     # agent cold-start router
  instructions/
    context-and-architecture.md    # this file — shared context
    language-standards.md          # shared TypeScript standards
    verification-and-agent-roe.md  # tool-calling conventions, agent rules
    available-tools.md             # Homebrew inventory + flyctl reference
    static/                           # static site instructions
      architecture.md
      performance-and-budgets.md
      build-pipeline.md
      authoring-and-runtime.md
      local-development.md
      language-standards.md
      verification.md
    backend/                          # backend-only instructions
      service-rules.md
      verification.md

./backend/
  package.json
  Makefile                            # orchestration: dev, deploy, db, ci
  infra/fly/Dockerfile                # multi-stage: builds backend + dashboard
  src/lib/dashboard.ts                # mounts SvelteKit handler via @fastify/middie

./static/
  package.json
  Makefile                            # orchestration: build, data, deploy, ci
  build/                              # build tooling (not shipped to runtime)
  styles/                             # SCSS source
  src/                                # runtime source (ships to browser)
  public/                             # static data assets (metadata, atlases)
  offline-scripts/                    # Python analysis scripts
  dist/                               # deploy output

./dashboard/
  package.json
  svelte.config.js                    # SvelteKit config (adapter-node)
  src/
    routes/                           # file-based routing
    lib/                              # shared components, API client
      api.ts                          # server-side fetch to backend (localhost)
      components/                     # Svelte components
    app.html                          # shell template
    app.css                           # global design tokens (dark, no border-radius)
  build/                              # adapter-node output (production only)
```

Domain-specific file trees are in `static/architecture.md` and the backend roadmap respectively.
