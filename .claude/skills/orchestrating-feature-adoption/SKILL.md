---
name: orchestrating-feature-adoption
description: Plans feature discovery, nudges, and adoption flows for the KWH e-commerce platform
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Orchestrating-feature-adoption Skill

This skill guides planning and implementing feature adoption flows on the KWH platform — covering how new features reach users through discovery surfaces, contextual nudges, progressive disclosure, and GTM-tracked activation milestones across the Next.js frontend and Frontastic backend.

## Quick Start

1. Identify the feature surface: cart, checkout, account dashboard, PLP, PDP, or header
2. Map the discovery path: where does the user first encounter this feature?
3. Define the activation milestone: what action signals the user has adopted the feature?
4. Instrument the milestone with a GTM dataLayer event
5. Build the nudge component (banner, tooltip, empty state CTA) gated by user/session state
6. Wire a dismissal flag to localStorage or Kinde user metadata to prevent nudge fatigue

## Key Concepts

**Discovery Surface** — Entry points where users first encounter a feature:
- `components/frontastic-ui/KwhHeader/` for global nav and search nudges
- `components/frontastic-ui/KWHCart/` for cart-based adoption prompts
- `components/frontastic-ui/MyAccount/` for post-login feature introductions
- `components/frontastic-ui/ListingPageComponents/` for search and filter discovery

**Activation Milestone** — The specific user action that marks adoption (e.g., first wishlist add, first saved address, first use of a filter). Milestones are emitted as GTM `dataLayer.push` events in `components/scripts/`.

**Nudge Gate** — Condition logic that controls when a nudge appears. Typically checks:
- Authentication state via Kinde (`useKindeBrowserClient`)
- Session/localStorage flag for dismissal
- SWR data (e.g., cart is empty, no saved addresses)

**Progressive Disclosure** — Show minimal UI first; deepen engagement once the user signals intent. Use Tailwind's `transition` and `opacity` utilities for smooth reveal.

**Feature Flag** — Environment variable–based flag (`NEXT_PUBLIC_FEATURE_*`) to gate rollout. Read in component via `process.env.NEXT_PUBLIC_FEATURE_FOO === 'true'`.

## Common Patterns

### Gated nudge with dismissal
```tsx
// components/frontastic-ui/MyAccount/FeatureNudge.tsx
'use client';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'kwh_nudge_wishlist_dismissed';

export function WishlistNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setShow(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setShow(false);
  };

  if (!show) return null;
  return (
    <div className="rounded-md bg-brand-red p-4 text-white">
      <p>Save items for later with Wishlists</p>
      <button onClick={dismiss} className="mt-2 underline text-sm">Dismiss</button>
    </div>
  );
}
```

### GTM activation event
```ts
// Emit when user completes the adoption action
window.dataLayer?.push({
  event: 'feature_adopted',
  feature_name: 'wishlist',
  user_id: userId,
});
```

### Feature flag gate
```tsx
// Only render nudge if feature is enabled
{process.env.NEXT_PUBLIC_FEATURE_WISHLIST_NUDGE === 'true' && <WishlistNudge />}
```

### SWR-driven nudge (show only when data condition met)
```tsx
import useSWR from 'swr';

export function EmptyCartNudge() {
  const { data: cart } = useSWR('/api/cart');
  if (!cart || cart.lineItems?.length > 0) return null;
  return <div className="p-4 text-center text-gray-500">Your cart is empty — discover new arrivals</div>;
}
```

### Internationalised nudge copy
```tsx
// Always source copy from next-intl messages, never hardcode strings
import { useTranslations } from 'next-intl';

const t = useTranslations('nudges');
<p>{t('wishlist.prompt')}</p>
```

Add corresponding keys to `public/locales/en/nudges.json` (or the project's message file location).