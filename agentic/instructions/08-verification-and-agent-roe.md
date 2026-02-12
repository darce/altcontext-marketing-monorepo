# Verification and Agent Rules of Engagement

## Verification Gates

### Build and Quality Gates

- `npm --prefix frontend run build`
- `npm --prefix frontend run build:full`
- `npm --prefix frontend run typecheck`
- `npm --prefix frontend run lint`
- `npm --prefix frontend run stylelint`
- `npm --prefix frontend run format`

### Performance Gates

- Run Lighthouse mobile profile on:
  - home page
  - representative content page
  - email capture page
- Fail changes that:
  - exceed critical CSS budget
  - reintroduce render-blocking CSS/JS
  - load third-party scripts before interaction

## Agent Rules of Engagement

### Do

- Prioritize static HTML and small CSS.
- Keep critical CSS minimal and async-load the rest.
- Keep builds deterministic and fast by default.
- Use recrop modes only when required.
- Keep backend integration off the paint-critical path.

### Do Not

- Add a framework solely for convenience.
- Add large CSS frameworks to first-pass pages.
- Add third-party scripts in `<head>` without measured justification.
- Allow critical CSS to grow with below-the-fold styling.
