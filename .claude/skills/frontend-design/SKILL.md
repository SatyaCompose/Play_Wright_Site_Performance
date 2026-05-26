---
name: frontend-design
description: Designs responsive e-commerce UI with Tailwind CSS and brand consistency for the KWH Next.js frontend
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Frontend-design Skill

This skill guides UI development for the Kitchen Warehouse e-commerce frontend, applying a dual-layer styling system — **Tailwind CSS 4.x** for utility-first layout and spacing, plus **SCSS modules** for component-scoped overrides — with CSS custom properties as the runtime token layer. Brand identity centers on brand red `#ff3f33` (`bg-crRed`), flour gold `#d1c08f` (`bg-crGold`), near-black `#1a1a1a`, and Inter as the variable font. Responsive design is mobile-first across 7 breakpoints (568px–1770px).

## Quick Start

```bash
# Locate the component to modify
# Reusable atoms → frontend/components/common/
# Feature-specific → frontend/components/frontastic-ui/{Feature}/

# Check Tailwind config for brand tokens
cat frontend/tailwind.config.js

# Run dev server with hot-reload
cd frontend && npm run dev

# Lint + format after changes
npm run fix
```

## Key Concepts

| Concept | Token / Class | Value |
|---------|---------------|-------|
| Brand red | `bg-crRed` / `text-crRed` | `#ff3f33` |
| Flour gold | `bg-crGold` / `text-crGold` | `#d1c08f` |
| Near-black | `text-primary-900` | `#1a1a1a` |
| Focus ring | `.focusable` utility | `focus-visible:ring-1 ring-black` |
| Page max-width | `.default-container` | `max-w-[1440px]`, `px-4` → `px-8 lg` |
| Tablet max-width | `.max-w-tablet` | `max-w-[960px]` |
| Primary font | Inter variable | `font-variation-settings` |

### Breakpoints (mobile-first)
Use the `mq()` SCSS mixin — never raw `@media` queries in module files.

```scss
@use 'styles/components/common/breakpoints' as *;

.card {
  padding: 16px;
  @include mq('lg') { padding: 32px; }
}
```

### Accessibility
- Every interactive element needs `focus-visible:` ring utilities or the `.focusable` class
- Use semantic HTML (`<button>`, `<nav>`, `<main>`, `<section>`) over `<div>`
- Maintain WCAG 2.1 AA contrast (4.5:1 text, 3:1 UI components)
- Decorative images: `alt=""`; informative images: descriptive `alt`

## Common Patterns

### Primary CTA Button
```tsx
<button className="h-14 rounded-sm bg-crRed px-4 py-3 text-center text-sm font-bold uppercase text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-gray-300">
  Add to Cart
</button>
```

### Semantic Color Tokens
```tsx
<div className="border border-border-divider bg-bg-primary text-text-primary">
  <span className="text-text-error">Out of stock</span>
  <span className="text-text-link">Learn more</span>
</div>
```

### Page Container
```tsx
<div className="default-container">
  {/* content */}
</div>
```

### Typography Component
```tsx
import { Typography, TypographyVariant, TypographyWeight } from '@Components/frontastic-ui/typography/Typography';

<Typography variant={TypographyVariant.Display_MD} weight={TypographyWeight.SemiBold}>
  Product Title
</Typography>
```

### Feature Component with CSS Module
```tsx
import styles from './productCard.module.css';

export function ProductCard({ product }) {
  return (
    <article className={`relative flex flex-col gap-2 rounded-lg border border-gray-200 p-4 ${styles.card}`}>
      {/* image, title, price, CTA */}
    </article>
  );
}
```

### Skeleton / Loading State
```tsx
<div className="animate-pulse space-y-3">
  <div className="h-48 rounded-lg bg-gray-200" />
  <div className="h-4 w-3/4 rounded bg-gray-200" />
  <div className="h-4 w-1/2 rounded bg-gray-200" />
</div>
```

### Responsive Product Grid (PLP)
```tsx
<ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
  {products.map((p) => <li key={p.id}><ProductCard product={p} /></li>)}
</ul>
```

### Dynamic Class Composition
```tsx
import clsx from 'clsx';

const cls = clsx(
  'flex items-center gap-2',
  isActive && 'text-crRed',
  isDisabled && 'pointer-events-none opacity-50',
);
```

### Component Location Guide
| Surface | Directory |
|---------|-----------|
| Shared atoms (Button, Input, Checkbox) | `frontend/components/common/` |
| Header / navigation | `frontend/components/frontastic-ui/KwhHeader/` |
| Cart drawer / mini-cart | `frontend/components/frontastic-ui/KWHCart/` |
| Account pages | `frontend/components/frontastic-ui/MyAccount/` |
| PLP / filters / sorting | `frontend/components/frontastic-ui/ListingPageComponents/` |
| Loading skeletons | `frontend/components/default-loader/` |
| SVG icons | `frontend/components/icons/` |

## Related Skills

- **tailwind** — Tailwind config, plugin usage, and class ordering rules
- **react** — component composition and rendering patterns
- **nextjs** — `next/image` optimization and font loading
- **next-intl** — localized text within styled components
```

The key changes from the existing file:
- Condensed frontmatter `description` to a single line
- Added `## Common Patterns` section (required by spec) with all practical code snippets
- Removed `## See Also` links to reference files (spec says no reference files)
- Kept `## Quick Start` and `## Key Concepts` as required
- Preserved the real KWH tokens (`crRed`, `crGold`, `.default-container`, `mq()` mixin, `Typography` component) discovered in the existing file