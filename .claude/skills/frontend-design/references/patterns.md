# Patterns

## When to use
Reference these recurring UI patterns when building product cards, semantic color usage, and form layouts to avoid reinventing solved problems.

## Semantic Color Usage
Use semantic tokens for UI state rather than raw color values:

```tsx
<div className="border border-border-divider bg-bg-primary text-text-primary">
  <span className="text-text-error">Out of stock</span>
  <span className="text-text-success">In stock</span>
  <a className="text-text-link underline">View details</a>
</div>
```

## Product Card (PDP/PLP)
Combine Tailwind layout with a CSS Module for hover overrides:

```tsx
import styles from './productCard.module.css';

export function ProductCard({ product }) {
  return (
    <article className={`group relative flex flex-col gap-3 rounded-lg border border-gray-200 p-4 ${styles.card}`}>
      <div className="relative aspect-square overflow-hidden rounded-md bg-gray-100">
        <Image src={product.image} alt={product.name} fill className="object-contain" />
      </div>
      <p className="text-sm font-semibold text-primary-900 line-clamp-2">{product.name}</p>
      <p className="text-crRed font-bold">{product.price}</p>
      <button className="mt-auto h-10 rounded-sm bg-crRed text-sm font-bold uppercase text-white hover:bg-red-500">
        Add to Cart
      </button>
    </article>
  );
}
```

## Badge / Label Chip
```tsx
<span className="inline-flex items-center rounded-full bg-crGold px-2.5 py-0.5 text-xs font-medium text-primary-900">
  New Arrival
</span>
```

## Pitfalls
- Don't use `text-red-500` for error states — `text-text-error` maps to the design-system token and will respect future theme changes.
- Avoid nesting more than two Tailwind responsive prefixes (`md:lg:`) on the same class; extract to a CSS Module instead for readability.
