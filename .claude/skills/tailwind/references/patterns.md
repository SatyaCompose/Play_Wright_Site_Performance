# Tailwind Patterns

## When to use
Apply these patterns when styling KWH components, building responsive layouts, or combining Tailwind with SCSS modules.

## Responsive grid layout
Mobile-first with breakpoint prefixes. Always start with the mobile layout, then override at `md:` and `lg:`.

```tsx
// Product listing grid
<ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
  {products.map((p) => (
    <li key={p.id} className="flex flex-col rounded-lg border border-gray-200 p-4 hover:shadow-md">
      <img className="mb-3 h-48 w-full object-cover" src={p.image} alt={p.name} />
      <span className="mt-auto text-lg font-bold text-primary-600">{p.price}</span>
    </li>
  ))}
</ul>
```

## Conditional class merging with clsx
Use `clsx` (available in frontend) for dynamic class composition. Never use string interpolation for conditional classes — Tailwind's JIT scanner won't detect partial class names.

```tsx
import clsx from 'clsx';

<button
  disabled={isLoading}
  className={clsx(
    'rounded px-4 py-2 text-sm font-medium transition-colors',
    isLoading && 'cursor-not-allowed opacity-50',
    variant === 'primary' && 'bg-primary-600 text-white hover:bg-primary-700',
    variant === 'ghost'   && 'border border-gray-300 text-gray-700 hover:bg-gray-50',
  )}
>
```

## SCSS module fallback
Use SCSS modules only for animations, pseudo-elements, or selectors that utilities cannot express. Import alongside Tailwind classes with `clsx`.

```tsx
import styles from './Carousel.module.scss';
import clsx from 'clsx';

// SCSS handles the keyframe; Tailwind handles layout/color
<div className={clsx('relative overflow-hidden rounded-lg bg-white', styles.carouselTrack)}>
```

## Pitfalls
- **Dynamic class names will not be included in the build.** Tailwind scans source files statically. Never construct class names from variables (e.g. `` `bg-${color}-600` ``). Use a full lookup map instead.
- **Do not use `@apply` for utilities that could be written directly in JSX.** `@apply` is valid only inside SCSS modules for non-expressible selectors; overusing it defeats Tailwind's purpose and increases bundle size.
- **ESLint enforces class ordering** via `eslint-plugin-tailwindcss`. Run `npm run fix` in `frontend/` to auto-sort before committing.