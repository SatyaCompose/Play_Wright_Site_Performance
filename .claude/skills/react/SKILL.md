---
name: react
description: Manages React 19.x components, hooks, and client-side interactivity for the KWH Next.js frontend
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# React Skill

Manages React 19.x components, hooks, and client-side interactivity within the KWH Next.js Pages Router frontend. Components are organized into reusable atoms in `frontend/components/common/` and feature-specific composites in `frontend/components/frontastic-ui/`. Global state flows through Context providers in `frontend/frontastic/provider/`.

## Quick Start

```bash
cd frontend
npm run dev        # Start dev server with hot reload + TSC watch
npm run ts         # Type-check components once
npm run lint       # Run ESLint
npm run fix        # ESLint fix + Prettier format
```

## Key Concepts

- **Component locations**: Reusable UI → `components/common/`; feature components → `components/frontastic-ui/{feature}/`
- **Naming**: PascalCase filenames and exports (e.g., `ProductCard.tsx`, `export function ProductCard()`)
- **Hooks**: Prefix with `use`, camelCase (e.g., `useCart.ts`, `useProduct.ts`)
- **State**: Context API providers in `frontastic/provider/` for cart, auth, language
- **Forms**: Always use React Hook Form 7.x with Yup resolvers — no raw `useState` form state
- **Data fetching**: SWR 2.x custom hooks; dispatchers live in `frontastic/actions/`
- **i18n**: All user-facing strings via `next-intl` — no hardcoded English text
- **Styles**: CSS Modules (`.module.css`) for scoped styles; Tailwind 4.x utilities for layout/spacing
- **Error handling**: Wrap feature sections with `ErrorBoundary` from `components/ErrorBoundary/`
- **TypeScript**: `strict: false` in frontend tsconfig — annotate props interfaces but avoid over-typing

## Common Patterns

**Functional component with props interface**
```tsx
interface ProductCardProps {
  product: Product;
  onAddToCart: (variantId: string) => void;
}

export function ProductCard({ product, onAddToCart }: ProductCardProps) {
  return (
    <div className={styles.card}>
      <h2>{product.name}</h2>
    </div>
  );
}
```

**Custom SWR data-fetching hook**
```tsx
import useSWR from 'swr';

export function useProduct(productId: string) {
  const { data, error, isLoading } = useSWR(
    productId ? `/api/product/${productId}` : null,
    fetcher,
  );
  return { product: data, error, isLoading };
}
```

**Context provider pattern**
```tsx
// frontastic/provider/cart/index.tsx
export const CartContext = createContext<CartContextShape>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  return <CartContext.Provider value={{ cart, setCart }}>{children}</CartContext.Provider>;
}
```

**Calling a backend action**
```tsx
import { cartActions } from 'frontastic/actions/cart';

const handleAddToCart = async (variantId: string) => {
  await cartActions.addItem({ variantId, quantity: 1 });
};
```

**Translations**
```tsx
import { useTranslations } from 'next-intl';

export function CheckoutButton() {
  const t = useTranslations('checkout');
  return <button>{t('proceedToCheckout')}</button>;
}
```