# Build Pipeline and Scripts

## Toolchain

- `sass` for SCSS compilation
- `postcss-cli` + `autoprefixer` + `cssnano`
- `tsx` + TypeScript for build tooling
- `critical` for critical CSS extraction/inlining
- `eslint`, `stylelint`, `prettier` as quality gates

## Canonical Frontend Scripts

### Fast Site Build

- `npm --prefix frontend run build`
- `npm --prefix frontend run build:web` (alias)

### Full Build (Data + Derivatives + Assets)

- `npm --prefix frontend run build:full`

### Full Build With Explicit Recrop

- `npm --prefix frontend run build:full:refresh`
- `npm --prefix frontend run build:full:refresh:missing`

### Data-Only Pipeline

- `npm --prefix frontend run build:data:extract`
- `npm --prefix frontend run build:data:derive`
- `npm --prefix frontend run build:data:derive:recrop`
- `npm --prefix frontend run build:data:derive:recrop:missing`

### Asset-Only Pipeline

- `npm --prefix frontend run build:assets`
- `npm --prefix frontend run build:assets:copy`
- `npm --prefix frontend run build:assets:css`
- `npm --prefix frontend run build:assets:postcss`
- `npm --prefix frontend run build:assets:compress`

### Compatibility Aliases

- `npm --prefix frontend run build:metadata`
- `npm --prefix frontend run build:derivatives`
- `npm --prefix frontend run build:derivatives:recrop`
- `npm --prefix frontend run build:derivatives:recrop:missing`

## Build-Mode Rules (Speed)

- Default builds must avoid expensive recropping.
- Recropping must be opt-in through `--recrop=none|missing|all` or recrop scripts.
- If derivatives are missing and recrop is not enabled, fail with an actionable command.
