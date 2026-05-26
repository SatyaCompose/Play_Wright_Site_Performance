# Engagement & Adoption — Empty States

## When to use
When empty states should re-engage returning users who have cleared their cart, removed wishlist items, or have no recent orders.

## Patterns

### Returning-user cart empty state with personalised CTA
```tsx
// If user has order history, suggest reordering; otherwise browse
export function MiniCartEmpty({ hasOrders }: { hasOrders: boolean }) {
  const href = hasOrders ? '/account/orders' : '/new-arrivals';
  const label = hasOrders ? 'Reorder a favourite' : 'Explore new products';

  return (
    <div className="flex flex-col items-center gap-6 py-16 text-center">
      <CartIcon className="h-12 w-12 text-black-40" />
      <Typography variant="Display_XS">Your cart is empty</Typography>
      <a href={href} className="text-brand-red underline">{label}</a>
    </div>
  );
}
```

### Wishlist empty state with social proof
```tsx
// Drive re-engagement by surfacing trending items
{wishlistSorted?.length === 0 && (
  <div className="py-10 text-center">
    <Typography variant="Display_SM">Nothing saved yet</Typography>
    <a href="/trending" className="mt-4 inline-block text-brand-red">
      See what's trending
    </a>
  </div>
)}
```

### Skeleton during wishlist data refetch (SWR revalidation)
```tsx
// Keep skeleton visible while SWR revalidates to avoid flash of empty state
{isValidating && !data ? (
  <WishlistSkeleton />
) : wishlist?.length === 0 ? (
  <WishlistEmpty />
) : (
  <WishlistGrid items={wishlist} />
)}
```

## Pitfalls
- Avoid showing personalised re-engagement CTAs before auth state resolves — always wait for `isClientSide && !isLoading` to be true to prevent showing the wrong message.