---
name: tailwind
description: |
  Applies Tailwind CSS 4.x for responsive utility-first styling in the Kitchen Warehouse Next.js frontend.
  Use when: adding or modifying component styles, building responsive layouts, working with the design system color tokens, combining Tailwind with SCSS modules, or enforcing class ordering with ESLint.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Tailwind Skill

Tailwind CSS 4.x is the primary styling system for this Next.js frontend, configured via `frontend/tailwind.config.js` with PostCSS integration. All component styles use utility classes directly in JSX. SCSS modules (`*.module.scss`) exist for complex animations or selectors that utilities can't express — use Tailwind first, fall back to SCSS modules only when necessary.

## Quick Start

### Responsive component layout

```tsx
// Product card with responsive grid behavior
<div className="flex flex-col gap-4 rounded-lg border border-gray-200 p-4 hover:shadow-md md:flex-row lg:gap-6">
  <img className="h-48 w-full object-cover md:h-full md:w-48" src={image} alt={name} />
  <div className="flex flex-col justify-between">
    <h2 className="text-lg font-semibold text-gray-900">{name}</h2>
    <span className="text-xl font-bold text-primary-600">{price}</span>
  </div>
</div>
```

### Conditional classes with clsx

```tsx
import clsx from 'clsx';

<button
  className={clsx(
    'rounded px-4 py-2 font-medium transition-colors',
    isLoading && 'cursor-not-allowed opacity-50',
    variant === 'primary' && 'bg-primary-600 text-white hover:bg-primary-700',
    variant === 'secondary' && 'border border-gray-300 text-gray-700 hover:bg-gray-50',
  )}
>
```

## Key Concepts

| Concept | Usage | Example |
|---------|-------|---------|
| Responsive prefix | Mobile-first breakpoints | `md:flex-row lg:gap-6` |
| State variant | Interaction styles | `hover:bg-primary-700 focus:ring-2` |
| Arbitrary value | One-off values | `w-[340px] top-[72px]` |
| Design token | Custom colors/spacing from `tailwind.config.js` | `bg-primary-600 text-secondary-900` |
| Form plugin | `@tailwindcss/forms` resets for inputs/selects | applied globally via plugin |
| Class ordering | ESLint `eslint-plugin-tailwindcss` enforced | layout → spacing → typography → color |

## Common Patterns

### Combining Tailwind with SCSS modules

Use when animations, pseudo-elements, or complex selectors exceed utility scope:

```tsx
import styles from './ProductSlider.module.scss';

<div className={clsx('relative overflow-hidden rounded-lg', styles.sliderTrack)}>
```

### Form input styling with `@tailwindcss/forms`

The forms plugin normalises browser defaults. Layer Tailwind utilities on top:

```tsx
<input
  className="w-full rounded border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:ring-primary-500"
  type="email"
/>
```

### Skeleton / loading placeholder

```tsx
<div className="animate-pulse space-y-3">
  <div className="h-4 w-3/4 rounded bg-gray-200" />
  <div className="h-4 w-1/2 rounded bg-gray-200" />
</div>
```

### Responsive container with max-width

```tsx
<section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
```

## Related Skills

- See the **react** skill for component composition patterns
- See the **nextjs** skill for server component styling constraints
- See the **eslint** skill for Tailwind class ordering enforcement
- See the **frontend-design** skill for KWH brand tokens and design system usage
```

Please approve the write permission so I can save this to `.claude/skills/tailwind/SKILL.md`.