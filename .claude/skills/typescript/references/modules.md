# TypeScript Modules & Path Aliases

## When to use
When importing from `types/`, using path aliases (`@Types/*`, `frontastic/*`), or debugging module resolution errors across backend and frontend.

## Frontend Path Aliases
Configured in `frontend/tsconfig.json` and `next.config.js`. Use for all cross-package imports.

```typescript
// Correct — resolves to types/ package
import type { Product } from '@Types/product/Product';
import type { Cart } from '@Types/cart/Cart';

// Correct — resolves to frontend/frontastic/
import { cartActions } from 'frontastic/actions/cartActions';
import { useCart } from 'frontastic/provider/CartProvider';
```

## Backend Relative Imports
Backend has no path aliases (`baseUrl: ./` only). Use relative paths for all imports.

```typescript
// backend/commercetools/actionControllers/cartControllers/AddToCart.ts
import type { Cart } from '../../types/cart/Cart';           // ❌ Wrong — types/ is a separate package
import type { CustomCommerceToolsCart } from '../../../mappers/CartMapper'; // ✓ Relative within backend
```

> **Note:** Backend imports types from the `types/` package via npm workspace resolution, not path aliases. Use the package name if configured, or relative paths from the workspace root.

## Extending Third-Party SDK Client Types
When the Algolia or Commercetools client needs extra methods not in the official SDK type:

```typescript
import type { SearchClient, SearchResponse } from 'algoliasearch';

export type ExtendedSearchClient = SearchClient & {
  searchSingleIndex<T = unknown>(params: {
    indexName: string;
    searchParams?: Record<string, unknown>;
  }): Promise<SearchResponse<T>>;
};
```

## Pitfalls
- **Do not use `@Types/*` in backend** — alias is only configured in the frontend tsconfig; backend module resolution will fail.
- **Do not use `import * as` for SDK types** — prefer named `import type` to keep bundles lean and support `isolatedModules`.