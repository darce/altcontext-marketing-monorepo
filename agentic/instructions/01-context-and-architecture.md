# Context and Architecture

## Project Context

- Monorepo with two workspaces: `frontend/` (static marketing site) and `backend/` (email capture + marketing intelligence).
- Marketing pages must remain fast and static-first; backend is never paint-critical.
- Build-time tools can use Node.js and Python locally/CI.

## Hosting Model

- Frontend deploys as static files from `frontend/dist/` (Apache-first).
- Backend deploys to Fly.io as a containerised Node service from `backend/`.
- No build tool should assume Node/Python runtime is available on the static host.

## Monorepo Layout

```text
./agentic/
  instructions.md                     # agent cold-start router
  instructions/
    01-context-and-architecture.md    # this file — shared context
    07-language-standards.md          # shared TypeScript standards
    08-verification-and-agent-roe.md  # tool-calling conventions, agent rules
    09-available-tools.md             # Homebrew inventory + flyctl reference
    frontend/                         # frontend-only instructions
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

./frontend/
  package.json
  Makefile                            # orchestration: build, data, deploy, ci
  build/                              # build tooling (not shipped to runtime)
  styles/                             # SCSS source
  src/                                # runtime source (ships to browser)
  public/                             # static data assets (metadata, atlases)
  offline-scripts/                    # Python analysis scripts
  dist/                               # deploy output
```

Domain-specific file trees are in `frontend/architecture.md` and the backend roadmap respectively.
