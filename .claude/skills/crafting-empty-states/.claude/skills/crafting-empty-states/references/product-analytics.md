# Product Analytics — Empty States

## When to use
When wiring GTM or Datadog RUM events to empty state impressions and CTA interactions to measure activation and drop-off.

## Patterns

### GTM impression event on empty state mount
```tsx
import { pushGTMEcommerceEvent } from 'helpers/gtmHelper';

// Track how often users land on an empty surface
useEffect(() => {
  if (isClientSide && cartItemsCount === 0) {
    pushGTMEcommerceEvent('view_empty_state', { surface: 'mini_cart' });
  }
}, [isClientSide, cartItemsCount]);
```

### GTM CTA click event from empty state
```tsx
// Track which CTA the user clicked to exit the empty state
function handleCtaClick(destination: string) {
  pushGTMEcommerceEvent('select_promotion', {
    creative_name: 'empty_state_cta',
    creative_slot: 'cart',
    promotion_name: destination,
  });
  router.push(destination);
}

<button onClick={() => handleCtaClick('/new-arrivals')} className="btn-primary">
  Explore New Products
</button>
```

### Datadog RUM custom action for empty wishlist
```tsx
import { datadogRum } from '@datadog/browser-rum';

useEffect(() => {
  if (isClientSide && wishlist?.length === 0) {
    datadogRum.addAction('empty_wishlist_impression', { authenticated: isAuthenticated });
  }
}, [isClientSide, wishlist, isAuthenticated]);
```

## Pitfalls
- Do not fire analytics events during SSR or before `isClientSide` is true — `window.dataLayer` and `datadogRum` are browser-only globals and will throw on the server.