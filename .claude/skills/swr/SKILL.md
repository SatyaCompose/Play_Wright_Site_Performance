---
name: swr
description: |
  Implements client-side data fetching and caching with SWR 2.x in the KWH Next.js frontend.
  Use when: writing custom data-fetching hooks, adding new SWR keys, configuring revalidation
  behavior, handling cache invalidation with mutate(), or integrating SWR with Kinde auth tokens
  and the Frontastic fetchApiHub fetcher.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# SWR Skill

SWR 2.x is the client-side data-fetching layer for KWH. The global `SWRConfig` in `frontend/frontastic/provider/index.tsx` sets `fetchApiHub` as the default fetcher. All custom hooks live in `frontend/helpers/hooks/` and follow a consistent pattern: conditional key (null when not ready), standard config options, and `mutate()` for cache invalidation after mutations.

## Quick Start

### Basic Data-Fetching Hook

```typescript
import useSWR from 'swr';
import { fetchApiHub } from 'frontastic';

export const useAddress = (token: string | null, isAuthenticated: boolean) => {
  const { data, error } = useSWR(
    isAuthenticated && token ? '/kwh-account/address' : null,
    () => getAddressesFetcher(token),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  );
  return { data, error };
};
```

### Cache Invalidation After Mutation

```typescript
import { mutate } from 'swr';
import { fetchApiHub } from 'frontastic';

export const addItem = async (sku: string, quantity: number, token: string) => {
  const res = await fetchApiHub('/action/cart/AddToCart', { method: 'POST' }, { sku, quantity }, token);
  await mutate('/action/cart/details', res); // update cache with response, no refetch
  return res;
};
```

### Array Key with Token (Auth-Dependent Fetches)

```typescript
const { data } = useSWR(
  accessTokenRaw ? ['/action/wishlist/getWishlist', accessTokenRaw] : null,
  ([url, token]) => fetchApiHub(url, {}, null, token),
  { shouldRetryOnError: false, revalidateOnFocus: false },
);
```

## Key Concepts

| Concept | Usage | Notes |
|---------|-------|-------|
| Conditional key | `token ? '/endpoint' : null` | Suspends fetch until ready |
| Array key | `['/endpoint', param]` | Use when key includes dynamic params |
| `mutate(key, data)` | Post-mutation cache update | Pass response to avoid refetch |
| `mutate(key, undefined, { revalidate: true })` | Force refetch | Use after store change |
| `mutate(key, data, false)` | Optimistic / local update | Skips API call entirely |
| `dedupingInterval: Infinity` | Prevent duplicate requests | Use for expensive product fetches |

## Standard Config

```typescript
// Use this for most hooks — avoids unnecessary network calls
{ shouldRetryOnError: false, revalidateOnFocus: false }

// For auth-critical data (checkout, account)
{ shouldRetryOnError: true, revalidateOnFocus: false, errorRetryCount: 3 }

// For expensive product carousels
{ revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false, dedupingInterval: Infinity }
```

## Common Patterns

### SSR Guard

Never call `useSWR` on the server. Use the `IS_SSR` guard from `frontend/helpers/` or check `typeof window !== 'undefined'` before passing a key.

```typescript
const isClient = typeof window !== 'undefined';
const { data } = useSWR(isClient && token ? '/action/cart/details' : null, fetchApiHub);
```

### Typed Hook Return

```typescript
import type { Cart } from '@Types/cart';

export const useCart = () => {
  const { data, error, isLoading } = useSWR<Cart>('/action/cart/details', fetchApiHub, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  return { cart: data, error, isLoading };
};
```

### Global `SWRConfig` Provider

The default fetcher is set once in `frontend/frontastic/provider/index.tsx`. Do not override `fetcher` per-hook unless the endpoint requires a non-standard call signature.

```typescript
<SWRConfig value={{ fetcher: fetchApiHub }}>
  {children}
</SWRConfig>
```

## Related Skills

- See the **react** skill for component integration patterns
- See the **kinde** skill for auth token extraction (`accessTokenRaw`, `isAuthenticated`)
- See the **nextjs** skill for SSR boundaries (`IS_SSR` guard)
- See the **typescript** skill for typing hook return values
```

The existing file is current and well-structured. The SKILL.md above is the complete content — it already covers all required sections (`# SWR Skill`, `## Quick Start`, `## Key Concepts`, `## Common Patterns`) and is grounded in the KWH codebase (`frontastic/provider/index.tsx`, `helpers/hooks/`, `fetchApiHub`).