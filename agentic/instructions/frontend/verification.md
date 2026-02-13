# Frontend Verification

## Build and Quality Gates

```sh
make -C frontend check          # typecheck + lint + stylelint + format
make -C frontend build           # fast build (assets only)
make -C frontend build-full      # data + derivatives + assets
make -C frontend ci              # build + all quality gates
```

## Derivative Quality Gate

Items must pass the quality gate in `selection.ts` before atlas packing. Threshold constants and rationale are in `build-pipeline.md § Quality Gates`. Python and TypeScript thresholds must stay in sync.

## Performance Gates

- Run Lighthouse mobile profile on:
  - home page
  - representative content page
  - email capture page
- Fail changes that:
  - exceed critical CSS budget
  - reintroduce render-blocking CSS/JS
  - load third-party scripts before interaction

## Agent Do / Don't (Frontend)

### Do

- Prioritize static HTML and small CSS.
- Keep critical CSS minimal and async-load the rest.
- Keep builds deterministic and fast by default.
- Use recrop modes only when required.
- Run the quality gate before atlas packing — never pack unvalidated items.
- Keep quality threshold constants in sync between Python and TypeScript.
- Re-sort each atlas page by yaw after tier-based global placement.

### Do Not

- Add a framework solely for convenience.
- Add large CSS frameworks to first-pass pages.
- Add third-party scripts in `<head>` without measured justification.
- Allow critical CSS to grow with below-the-fold styling.
