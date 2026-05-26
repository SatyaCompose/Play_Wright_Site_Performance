# Roadmap & Experiments — Empty States

## When to use
When A/B testing empty state copy, CTA destinations, or layout variants to optimise activation rate.

## Patterns

### Environment-flag-gated empty state variant
```tsx
// Use NEXT_PUBLIC_ env flag to gate a new empty state design without a feature-flag service
const useNewCartEmpty = process.env.NEXT_PUBLIC_EMPTY_CART_V2 === 'true';

export function CartEmptyRouter(props: CartEmptyProps) {
  return useNewCartEmpty ? <CartEmptyV2 {...props} /> : <CartEmptyV1 {...props} />;
}
```

### GTM dataLayer variant tracking for A/B test
```tsx
// Push experiment variant to dataLayer so GA4 / Optimize can split results
useEffect(() => {
  if (isClientSide && cartItemsCount === 0) {
    window.dataLayer?.push({
      event: 'experiment_impression',
      experiment_id: 'empty_cart_cta_test',
      variant_id: useNewCartEmpty ? 'v2' : 'control',
    });
  }
}, [isClientSide, cartItemsCount]);
```

### Incremental rollout via Kinde user attribute
```tsx
// Gate new empty state to a subset of users via Kinde custom claims
import { useKindeBrowserClient } from '@kinde-oss/kinde-auth-nextjs';

export function WishlistEmptyRouter(props: WishlistEmptyProps) {
  const { getClaim } = useKindeBrowserClient();
  const inBeta = getClaim('empty_state_beta')?.value === true;

  return inBeta ? <WishlistEmptyV2 {...props} /> : <WishlistEmptyV1 {...props} />;
}
```

## Pitfalls
- `NEXT_PUBLIC_` flags are baked in at build time — you cannot change them per-request. For true runtime targeting use Kinde claims or a server-side flag passed via `getServerSideProps`.