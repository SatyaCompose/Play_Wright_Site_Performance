# Activation & Onboarding — Empty States

## When to use
When designing first-run experiences for authenticated users landing on empty cart, wishlist, or orders surfaces for the first time.

## Patterns

### First-run cart empty state with onboarding CTA
```tsx
// Show a richer onboarding prompt on first visit vs. a returning empty cart
const isFirstVisit = !localStorage.getItem('kwh_cart_visited');

export function CartEmptyState() {
  useEffect(() => { localStorage.setItem('kwh_cart_visited', '1'); }, []);

  return (
    <EmptyState
      icon={<CartIcon className="h-12 w-12 text-brand-red" />}
      title={isFirstVisit ? "Welcome — start exploring!" : "Your cart is empty"}
    />
  );
}
```

### Post-registration wishlist prompt
```tsx
// After account creation, surface wishlist empty state with save-item nudge
{isNewAccount && wishlist?.lineItems?.length === 0 && (
  <div className="rounded-md border border-brand-red/30 bg-brand-red/5 p-6 text-center">
    <Typography variant="Display_XS">Save items you love</Typography>
    <a href="/new-arrivals" className="mt-4 inline-block text-brand-red underline">
      Browse new arrivals
    </a>
  </div>
)}
```

### Orders empty state driving first purchase
```tsx
// frontend/components/frontastic-ui/MyAccount/Orders/EmptyOrders.tsx
export function EmptyOrders() {
  return (
    <EmptyState
      icon={<BoxIcon className="h-10 w-10 text-flour-gold" />}
      title="No orders yet"
    >
      <a href="/sale" className="btn-primary mt-6">Shop now</a>
    </EmptyState>
  );
}
```

## Pitfalls
- Do not read `localStorage` during SSR — always guard with `isClientSide` or `useEffect`. Reading it at module scope causes hydration mismatches.