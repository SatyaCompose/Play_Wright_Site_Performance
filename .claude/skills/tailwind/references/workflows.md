# Tailwind Workflows

## When to use
Follow these workflows when adding new component styles, debugging responsive behaviour, or integrating Tailwind with the KWH design system tokens.

## Adding styles to a new component
1. Check `frontend/tailwind.config.js` for available design tokens (colors, spacing, font sizes).
2. Write utility classes directly in JSX — no separate stylesheet needed.
3. Use `clsx` for any conditional or variant-based classes.
4. Run `npm run fix` in `frontend/` to auto-fix class ordering and formatting.
5. Verify visually at each breakpoint (`sm` 640 px, `md` 768 px, `lg` 1024 px, `xl` 1280 px).

```bash
cd frontend
npm run fix        # ESLint (class order) + Prettier in one pass
npm run ts         # Confirm no type errors introduced
```

## Debugging a responsive layout issue
1. Narrow the browser to 320 px and work up — Tailwind is mobile-first.
2. Confirm the breakpoint prefix matches the intent: `md:` applies at ≥ 768 px, not below.
3. Search for conflicting utilities with the same property at the same breakpoint:

```bash
# Find all usages of a utility in a component file
grep -n "md:flex" frontend/components/frontastic-ui/KWHCart/CartSummary.tsx
```

4. Use arbitrary values (`w-[340px]`, `top-[72px]`) only for one-off layout needs not covered by tokens.

## Extending the design system
Add new tokens to `tailwind.config.js` under `theme.extend` — never override `theme` directly, which discards Tailwind defaults.

```js
// frontend/tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: { 600: '#ff3f33', 700: '#e0362b' },
        flour:   { DEFAULT: '#d1c08f' },
      },
      fontFamily: {
        scandia:     ['Scandia', 'sans-serif'],
        montserrat:  ['Montserrat', 'sans-serif'],
      },
    },
  },
};
```

After editing the config, the dev server picks up changes automatically — no restart needed.

## Pitfalls
- **Purging:** Tailwind's JIT scans `frontend/components/**`, `frontend/pages/**`, and paths listed in `content` in `tailwind.config.js`. Files outside those paths won't have their classes included in the build — add new source directories to `content` if needed.
- **`@tailwindcss/forms` resets apply globally.** Do not add manual browser-reset styles for inputs or selects; they conflict with the plugin and cause inconsistent focus rings across browsers.