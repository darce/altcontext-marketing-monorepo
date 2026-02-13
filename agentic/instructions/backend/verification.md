# Backend Verification

## Build and Quality Gates

```sh
make -C backend check            # typecheck + lint + format
make -C backend ci               # quality gates + migrate deploy
```

## Agent Do / Don't (Backend)

### Do

- Keep backend integration off the paint-critical path.
- Run quality gates before every deploy — use `make -C backend fly-deploy`.

### Do Not

- Run raw multi-step shell sequences when a Make target exists — use the Makefile.
- Call `cd backend && fly deploy` directly — use `make -C backend fly-deploy` so quality gates run first.
