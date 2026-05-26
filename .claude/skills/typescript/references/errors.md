# TypeScript Errors Reference

## When to use
When diagnosing `ts-compile` or `tsc` failures in backend (strict) or frontend (non-strict), or when CI fails on type errors.

## Error: Object is possibly `null` or `undefined` (TS2532 / TS2533)
Occurs in backend strict mode when accessing optional fields without null-guards.

```typescript
// ❌ Error in backend strict mode
const email = request.body.email; // 'body' is possibly undefined

// ✓ Fix — use optional chaining and nullish coalescing
const body = JSON.parse(request.body ?? '{}') as AccountRegisterBody;
const email = body?.email ?? '';
```

## Error: Argument of type `X` is not assignable to parameter of type `Y` (TS2345)
Common when passing raw Commercetools SDK objects where enriched types are expected.

```typescript
// ❌ Passing CommercetoolsCart where CustomCommerceToolsCart is expected
cartService.enrich(ctCart); // TS2345

// ✓ Fix — map before passing
const enrichedCart = CartMapper.commercetoolsCartToCart(ctCart);
cartService.enrich(enrichedCart);
```

## Error: Module has no exported member (TS2305)
Caused by missing barrel exports or incorrect path alias usage.

```typescript
// ❌ Broken — no index.ts barrel in types/cart/
import type { Cart } from '@Types/cart'; // TS2305

// ✓ Fix — import from the explicit file
import type { Cart } from '@Types/cart/Cart';
```

## Pitfalls
- **`strict: false` in frontend hides errors until build** — run `npm run ts` regularly; the Next.js build (`npm run test`) also type-checks and will fail on errors the dev server silently ignores.
- **`as` casting silences errors without fixing them** — only cast at true system boundaries (e.g., `JSON.parse` results, external API responses); casting internal function arguments masks mapper bugs.