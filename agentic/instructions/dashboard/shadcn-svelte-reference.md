# shadcn-svelte — Quick Reference

> Component library for the AltContext dashboard.
> Source: <https://www.shadcn-svelte.com>

## Setup

```bash
cd dashboard
npx shadcn-svelte@latest init
```

During init, select:

- **Style**: Default
- **Base color**: Zinc (closest to our `#0a0a0a` / `#141414` dark palette)
- **CSS variables**: Yes
- **Border radius**: `0` (enforced globally — our design system uses no rounding)

After init, override the generated CSS variables in `app.css` to keep our existing tokens (`--c-bg`, `--c-surface`, etc.) as the source of truth.

## Adding Components

```bash
npx shadcn-svelte@latest add <component>
```

Components are copied into `$lib/components/ui/` — they are **not** a node_modules dependency. Edit freely.

## Component → Dashboard Feature Map

| shadcn-svelte Component | Dashboard Use Case |
|---|---|
| **Card** | Metric tiles, health indicator, summary panels |
| **Badge** | Status labels (healthy/down, active/inactive) |
| **Table** | Event logs, lead lists, rollup data |
| **Button** | Actions (refresh, export, filter apply) |
| **Separator** | Section dividers in layout |
| **Tabs** | Switching between metric views (today / 7d / 30d) |
| **Alert** | System warnings, error banners |
| **Tooltip** | Contextual help on metric definitions |
| **Dialog** | Confirmation modals (delete, unsubscribe) |
| **Dropdown Menu** | Property selector, user actions |
| **Select** | Filter controls (property, date range, event type) |
| **Input** | Search, API key entry |
| **Label** | Form field labels |
| **Skeleton** | Loading placeholders for async data |
| **Switch** | Toggle controls (auto-refresh, feature flags) |
| **Popover** | Date pickers, filter popovers |
| **Sheet** | Mobile nav slide-out |
| **Sonner** (toast) | Ephemeral success/error notifications |
| **Data Table** | Full-featured sortable/filterable tables (uses TanStack Table) |
| **Chart** | Metric visualisations (wraps chart libs) |

## Priority Components (install first)

These cover the MVP dashboard layout:

```bash
npx shadcn-svelte@latest add card badge table button separator tabs alert skeleton
```

## Theme Overrides

shadcn-svelte uses CSS custom properties mapped to HSL values. After init, align to our palette:

```css
/* Map shadcn vars → AltContext tokens in app.css */
--background: 0 0% 4%;         /* #0a0a0a */
--foreground: 0 0% 88%;        /* #e0e0e0 */
--card: 0 0% 8%;               /* #141414 */
--card-foreground: 0 0% 88%;
--border: 0 0% 16%;            /* #2a2a2a */
--muted: 0 0% 16%;
--muted-foreground: 0 0% 50%;  /* #808080 */
--accent: 0 0% 100%;           /* #ffffff */
--destructive: 0 84% 60%;      /* #ef4444 */
--radius: 0rem;                /* no rounding */
```

## Rules

1. **Always use shadcn-svelte components** before creating custom ones.
2. If a shadcn-svelte component almost fits, copy and modify it — don't wrap it.
3. Keep `border-radius: 0` — the global `!important` rule in `app.css` handles this, but set `--radius: 0rem` in the shadcn theme config for consistency.
4. Signal colours (`--c-ok`, `--c-warn`, `--c-err`) should override shadcn defaults for status-related variants.
5. Use the `mono` class / `--font-mono` for all numeric/data displays.
