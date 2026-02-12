# Context and Architecture

## Project Context

- Frontend is an MPA-style static site generated into `frontend/dist/`.
- Backend is a separate service for email capture and marketing intelligence.
- Marketing pages must remain fast and static-first even when backend integrations are enabled.

## Runtime and Hosting Constraints

- Build-time tools can use Node.js and Python locally/CI.
- Deployment artifact for the marketing site is the contents of `frontend/dist/`.
- Static hosting remains Apache-first.
- Backend APIs are separate from paint-critical frontend delivery.
- No build tool should assume Node/Python runtime is available on the static host.

## Monorepo Architecture

```text
./agentic/
  instructions.md
  instructions/
    01-context-and-architecture.md
    02-performance-and-budgets.md
    03-build-pipeline-and-scripts.md
    04-frontend-authoring-and-runtime-js.md
    05-backend-service-rules.md
    06-local-development-apache.md
    07-language-standards.md
    08-verification-and-agent-roe.md

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

## Architecture Notes

- `frontend/dist/` is deploy output.
- `frontend/build/*.ts` are build tools only and are not shipped to runtime.
