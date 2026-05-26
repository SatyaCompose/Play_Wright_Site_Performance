---
name: commercetools
description: |
  Integrates Commercetools SDK for e-commerce operations in the KWH Frontastic backend.
  Use when: writing action controllers, services, or mappers that call Commercetools REST or GraphQL APIs;
  handling cart/product/account operations; managing CT client instantiation or token auth flows;
  implementing parallel product queries; adding Redis caching for CT responses.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Commercetools Skill

KWH uses `@commercetools/platform-sdk` v8 + `@commercetools/sdk-client-v2` v3 behind a Frontastic extension layer. All CT access goes through one of three client types (Admin, Me, Anonymous), every controller uses `Promise.all` for parallelism, cart mutations are built as `CartUpdateAction[]` arrays, and hot data is cached in Redis via the `RedisClient` singleton. All store-scoped operations (cart, orders) MUST use `inStoreKeyWithStoreKeyValue({ storeKey: BASE_STORE_KEY })`.

## Quick Start

### Instantiate the right client

```typescript
// Admin (machine-to-machine, singleton)
const adminClient = AdminClient.getInstance(frontasticContext);
const ctClient = adminClient.getApiForProject();

// Me (user context — cart/prices/orders)
const ctClient = meClient(`Bearer ${accessToken}`, actionContext.frontasticContext);

// Use createRequestContext to get everything at once
const { accessToken, ctClient, channelIds, redisClient } =
  await createRequestContext(request, actionContext);
```

### Execute a GraphQL query

```typescript
const result = await executeCommercetoolsGraphQL({
  ctClient,
  caller: 'myFunction|myService',
  requestBodyJSON: { query: MY_GRAPHQL_QUERY, variables: { id } },
});
```

### Mutate a cart

```typescript
const cartActions: CartUpdateAction[] = [
  { action: 'addLineItem', sku, quantity: 1 },
  { action: 'setShippingAddress', address },
];
const updatedCart = await updateCart(adminClient, cart, cartActions);
```

### Cache a CT response in Redis

```typescript
const redisClient = await RedisClient.getInstance(frontasticContext);
const cacheKey = redisClient.constructCacheKey(REDIS_CACHE_KEY.PDP, productKey);
const cached = await redisClient.retrieveData(cacheKey);
if (cached) return JSON.parse(cached);
const result = await executeCommercetoolsGraphQL({ ctClient, caller: '...', requestBodyJSON: { query } });
redisClient.addToCache(cacheKey, result.body); // fire-and-forget
return result.body;
```

## Key Concepts

| Concept | Usage | Location |
|---------|-------|----------|
| `AdminClient` | Singleton for server-to-server calls | `backend/commercetools/ctClients/AdminClient.ts` |
| `meClient` | Function returning user-context client | `backend/commercetools/ctClients/MeClient.ts` |
| `createRequestContext` | Single token+client+channels+Redis init | `backend/commercetools/actionControllers/productControllers/productsCommon.ts` |
| `BASE_STORE_KEY` | Required for all cart/order CT calls | `backend/commercetools/services/common/cartCommonService.ts` |
| `CartUpdateAction[]` | Cart mutation actions built as array, passed to `updateCart()` | `backend/commercetools/services/` |
| `RedisClient` | Singleton cache with lazy connect | `backend/commercetools/services/common/redisService.ts` |
| `REDIS_CACHE_KEY` | Enum of all cache key prefixes | same file as `RedisClient` |
| Mapper classes | Static methods transforming CT → domain types | `backend/commercetools/mappers/` |

## Common Patterns

### Parallel queries (mandatory for multi-source controllers)

```typescript
const [algoliaResults, categories, tcgDetails] = await Promise.all([
  multiQueryResults(request, actionContext, payload, token),
  getCustomCategoriesData(frontasticContext, accessToken, queryString),
  isTradeAndCommercialCustomer(request, actionContext),
]);
```

### Batch large SKU sets (>96 products)

```typescript
const chunks = Array.from(
  { length: Math.ceil(skus.length / 100) },
  (_, i) => skus.slice(i * 100, i * 100 + 100),
);
const results = await Promise.all(
  chunks.map((chunk) =>
    executeCommercetoolsGraphQL({
      ctClient,
      caller: 'getProducts|productService',
      requestBodyJSON: { query: buildQuery(chunk) },
    }),
  ),
);
```

### New action controller checklist

1. Create file in `backend/commercetools/actionControllers/{domain}/ActionName.ts`
2. Call `createRequestContext` (or `AdminClient.getInstance`) at the top
3. Wrap entire body in `try/catch`; return `{ statusCode, body }` shaped response
4. Use `inStoreKeyWithStoreKeyValue({ storeKey: BASE_STORE_KEY })` for cart/order endpoints
5. Delegate business logic to a service; use a mapper to transform the CT response
6. Export the function and register it in `backend/index.ts`

### Mapper conventions

- Mapper classes live in `backend/commercetools/mappers/` and use **static methods only**
- Input is a raw CT SDK type (e.g., `CtCart`); output is a shared `types/` domain type
- Never make network calls inside a mapper — mappers are pure transformation functions
- Null-safe access everywhere: CT fields are frequently optional

### Anti-patterns to avoid

- **Never** import `AdminClient` inside a mapper or service — pass the client in as a parameter
- **Never** call CT APIs from React components or Next.js pages directly — go through backend action controllers
- **Never** skip `BASE_STORE_KEY` on cart/order mutations — store-scoped calls are required
- **Never** block on Redis — always fire-and-forget with `addToCache` and handle cache misses gracefully
- **Never** fetch products one-by-one in a loop — batch with `Promise.all` over chunked SKU arrays

## Related Skills

- See the **typescript** skill for strict-mode typing of CT SDK responses and mapper return types
- See the **node** skill for async/await patterns, environment variable access, and monorepo build config
- See the **jest** skill for mocking the CT SDK client and testing mappers/services in isolation
- See the **kinde** skill for auth token flows that feed into `meClient` and `introspectToken`
- See the **algolia** skill for the Algolia → CT product fetch orchestration pattern
```

You can approve the file write above, or paste this content directly into `.claude/skills/commercetools/SKILL.md`.