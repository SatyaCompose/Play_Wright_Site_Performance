# Components

## When to use
Reference this file when building or modifying UI atoms or feature components to find the correct location and pattern.

## Component Location

| Surface | Directory |
|---------|-----------|
| Shared atoms (Button, Input, Checkbox) | `frontend/components/common/` |
| Header / navigation | `frontend/components/frontastic-ui/KwhHeader/` |
| Cart drawer / mini-cart | `frontend/components/frontastic-ui/KWHCart/` |
| Account pages | `frontend/components/frontastic-ui/MyAccount/` |
| PLP / filters / sorting | `frontend/components/frontastic-ui/ListingPageComponents/` |
| Loading skeletons | `frontend/components/default-loader/` |
| SVG icons | `frontend/components/icons/` |

## Primary CTA Button
```tsx
<button className="h-14 rounded-sm bg-crRed px-4 py-3 text-center text-sm font-bold uppercase text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-gray-300">
  Add to Cart
</button>
```

## Feature Component with CSS Module
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

## Dynamic Class Composition
```tsx
import clsx from 'clsx';

const cls = clsx(
  'flex items-center gap-2',
  isActive && 'text-crRed',
  isDisabled && 'pointer-events-none opacity-50',
);
```

## Pitfalls
- Don't create one-off styled `<div>` wrappers — check `components/common/` first; the atom may already exist.
- CSS Modules are for component-scoped overrides only; layout and spacing belong in Tailwind utilities on the JSX element.