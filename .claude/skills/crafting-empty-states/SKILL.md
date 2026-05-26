---
name: crafting-empty-states
description: |
  Creates empty states and onboarding affordances for KWH e-commerce surfaces.
  Use when: adding empty state UI for cart, wishlist, orders, or search; building
  skeleton loaders; designing first-run affordances after account registration;
  wiring GTM events to empty-state CTA clicks; or replacing inline null-check
  strings with structured empty state components.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Crafting Empty States Skill

KWH uses a layered empty-state system: a generic `EmptyState` base component (`frontend/components/frontastic-ui/empty-state/index.tsx`), surface-specific variants (cart, wishlist, orders, search), and skeleton placeholders that mirror the empty-state layout during SSR hydration. Every empty state must pair with a skeleton — the MiniCart pattern is the gold standard.

## Quick Start

### Generic EmptyState base

```tsx
// frontend/components/frontastic-ui/empty-state/index.tsx
interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
}

export function EmptyState({ icon, title }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      {icon}
      <Typography variant="Display_XS">{title}</Typography>
    </div>
  );
}
```

### Cart empty state with SSR-safe client-side guard

```tsx
// Pattern from MiniCart/MiniCart.tsx
{cartItemsCount === 0 &&
  (isClientSide && !isLoading ? (
    <MiniCartEmpty {...props} />
  ) : (
    <MiniCartEmptySkeleton />
  ))}
```

### Product list no-results state

```tsx
// frontend/components/frontastic-ui/products/ProductList/ProductListGrid.tsx
{!products?.length ? (
  <Typography variant="Display_XS" className="py-20 text-center">
    No product found, please clear the filter to search
  </Typography>
) : (
  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{/* products */}</div>
)}
```

## Key Concepts

| Concept | Usage | Example |
|---------|-------|---------|
| `isClientSide` guard | Prevents hydration mismatch on SSR | `isClientSide && !isLoading ? <Empty /> : <Skeleton />` |
| Skeleton mirroring | Skeleton must match empty state layout | `MiniCartEmptySkeleton` mirrors `MiniCartEmpty` |
| CTA in empty state | Drive next action from zero state | "Explore New Products" → `/new-arrivals` |
| GTM on CTA click | Track activation from empty states | `pushGTMEcommerceEvent('select_promotion', ...)` |
| i18n message keys | All user-facing strings via `useFormat` | `t('cart.empty', 'Nothing here yet')` |

## Common Patterns

### Early return (page-level empty state)

**When:** Component renders nothing meaningful without data.

```tsx
// frontend/components/frontastic-ui/cart/index.tsx
if (!cart?.lineItems || cart.lineItems.length < 1) return <EmptyCart />;
```

### Inline ternary (section-level empty state)

**When:** Empty state appears within a larger layout.

```tsx
// frontend/components/frontastic-ui/wishlist/WishlistGrid.tsx
{wishlistSorted?.length > 0 ? (
  <WishlistItems items={wishlistSorted} />
) : (
  <div className="py-10">
    <Typography variant="Display_SM">There are no items in this wishlist.</Typography>
    <a href="/new-arrivals">Explore New Products</a>
  </div>
)}
```

### Skeleton fallback for SSR

**When:** Component depends on client-side auth state or SWR data.

```tsx
// frontend/components/frontastic-ui/wishlist/FavouriteFoldersList.tsx
{isClientSide ? (
  isAuthenticated && allWishlists !== null ? (
    <LoggedinUserWishlist {...props} />
  ) : (
    <GuestUserWishlist {...props} />
  )
) : (
  <div className="h-[650px] w-full animate-pulse rounded-sm bg-black-5" />
)}
```

## Related Skills

- See the **react** skill for component patterns and hook usage
- See the **tailwind** skill for `animate-pulse` skeleton utilities and spacing tokens
- See the **frontend-design** skill for Typography variants and brand color tokens
- See the **next-intl** skill for translating empty-state strings via `useFormat`
- See the **swr** skill for driving empty state from SWR loading/data states
- See the **designing-onboarding-paths** skill for first-run empty state flows
- See the **designing-inapp-guidance** skill for CTA overlays within empty states
- See the **improving-activation-flow** skill for conversion optimization from empty states
```

The existing file is solid — the only change needed is removing the broken `## See Also` section (lines 116–123) that references the now-deleted reference files. Once you grant write permission, I can apply that removal directly.