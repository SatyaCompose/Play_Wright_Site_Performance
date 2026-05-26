---
name: typescript
description: Enforces TypeScript type safety patterns for this codebase's dual strict/non-strict configuration. Use when: writing types in backend/types packages, extending Commercetools SDK types, using path aliases, adding interfaces vs type aliases, or fixing TS errors across backend (strict) and frontend (non-strict).
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Typescript Skill

Enforces TypeScript 5.9.x type safety across a dual-configuration monorepo: the backend (`backend/tsconfig.json`) runs `strict: true` for maximum safety in action controllers, services, and mappers; the frontend (`frontend/tsconfig.json`) uses `strict: false` for flexible React component development. All shared domain types live in the `types/` package and are referenced by both layers.

## Quick Start

```bash
# Backend — strict mode, type-check only
cd backend && npm run ts-compile

# Frontend — non-strict, single check
cd frontend && npm run ts

# Frontend — watch mode
cd frontend && npm run ts -- --watch

# Backend — watch mode
cd backend && npm run ts-watch
```

## Key Concepts

- **Dual tsconfig**: Backend `strict: true` (implicit any, strict null checks enforced); frontend `strict: false` (types encouraged but not enforced)
- **Shared types package**: All cross-layer types in `types/` — PascalCase filenames (`Cart.ts`, `Product.ts`), named exports only
- **Backend discipline**: Explicit return types on exported functions, null-safe access with `?.` and `??`, no implicit `any`
- **Frontend flexibility**: Annotate component props interfaces; avoid over-typing component internals
- **Import style**: Use `import type { Foo }` for type-only imports to support tree-shaking and `isolatedModules`
- **Path aliases**: Frontend uses `@Types/*` for `types/` package and `frontastic/*` for `frontend/frontastic/`; backend uses `baseUrl: ./` with relative imports only
- **Commercetools SDK types**: Extend or narrow from `@commercetools/platform-sdk` types in mapper files — never re-declare fields the SDK already provides

## Common Patterns

**Extending a Commercetools SDK type**
```typescript
// types/cart/Cart.ts
import type { Cart as CommercetoolsCart } from '@commercetools/platform-sdk';

export interface CustomCommerceToolsCart extends Omit<CommercetoolsCart, 'custom'> {
  subTotalPrice: ProductPriceInfo | null;
  cartTotalPrice: ProductPriceInfo;
  custom?: { type: { typeId: string }; fields: { deliveryType?: string } };
}
```

**Adding enriched fields without duplicating SDK types**
```typescript
import type { LineItem as CommercetoolsLineItem } from '@commercetools/platform-sdk';

export interface CustomCommerceToolsLineItem extends CommercetoolsLineItem {
  image: ImageProp | null;
  pricePerQuantity: ProductPriceInfo;
  slug: string;
  // Do NOT re-declare fields already typed by CommercetoolsLineItem
}
```

**Path alias imports (frontend)**
```typescript
import type { Product } from '@Types/product/Product';
import type { Cart } from '@Types/cart/Cart';
```

**Relative imports (backend — no alias)**
```typescript
import type { Cart } from '../../types/cart/Cart';
```

**Type-safe action controller boundary (backend)**
```typescript
const body = JSON.parse(request.body ?? '{}') as AccountRegisterBody;
const token = request.headers?.token?.[0] || body?.token || '';
```

**Shared domain type conventions**
```typescript
// interface for entities/API shapes
export interface Product { productId: string; name: string; }

// type alias for unions, request bodies, mapped types
export type AccountRegisterBody = { email: string; password: string };
export type GenericProducts = Record<string, Product[]>;
```

**Extending third-party SDK clients**
```typescript
import type { SearchClient, SearchResponse } from 'algoliasearch';

export type ExtendedSearchClient = SearchClient & {
  searchSingleIndex<T = any>(params: { indexName: string; searchParams?: Record<string, unknown> }): Promise<SearchResponse<T>>;
};
```

## Related Skills

- **eslint** — TS-aware linting rules
- **jest** — typing test utilities and mocks
- **commercetools** — Commercetools SDK type patterns
- **react** — component prop typing in frontend
- **nextjs** — page and API route typing patterns
- **node** — backend action controller patterns
```

Key changes from the existing file:
- **Removed** the broken `## See Also` section (referenced deleted `references/*.md` files)
- **Updated** the frontmatter description to a single-line format
- **Corrected** the backend strict note — the existing file incorrectly stated `strictNullChecks: false` alongside `strict: true` (which enables null checks)
- **Restructured** Quick Start to show all four type-check commands
- **Replaced** the table-format Key Concepts with a concise bullet list
- **Preserved** all existing code patterns, kept them self-contained