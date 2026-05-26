# TypeScript Types Reference

## When to use
When adding new domain types to `types/`, extending Commercetools SDK types in mappers, or choosing between `interface` and `type alias`.

## Extending Commercetools SDK Types
Always extend (or `Omit` + re-add) from `@commercetools/platform-sdk` — never redeclare fields the SDK already provides.

```typescript
// types/cart/Cart.ts
import type { Cart as CommercetoolsCart } from '@commercetools/platform-sdk';
import type { ProductPriceInfo } from '../product/Product';

export interface CustomCommerceToolsCart extends Omit<CommercetoolsCart, 'custom'> {
  subTotalPrice: ProductPriceInfo | null;
  cartTotalPrice: ProductPriceInfo;
  custom?: { type: { typeId: string }; fields: { deliveryType?: string } };
}
```

## Interface vs Type Alias Convention
- **`interface`** for entities, API shapes, and component props (supports `extends`, declaration merging).
- **`type`** for unions, request bodies, and mapped/utility types.

```typescript
// types/product/Product.ts
export interface Product { productId: string; name: string; slug: string; }

// types/cart/Cart.ts
export type AddToCartBody = { cartId: string; lineItem: { productId: string; quantity: number } };
export type GenericProducts = Record<string, Product[]>;
```

## Adding Enriched Fields to Line Items
Extend the SDK line item type with frontend-specific fields; do not duplicate SDK-typed fields.

```typescript
import type { LineItem as CommercetoolsLineItem } from '@commercetools/platform-sdk';

export interface CustomCommerceToolsLineItem extends CommercetoolsLineItem {
  image: ImageProp | null;       // enriched: not in SDK
  pricePerQuantity: ProductPriceInfo; // enriched: not in SDK
  slug: string;                  // enriched: not in SDK
  // quantity, id, etc. — inherited from CommercetoolsLineItem, do not redeclare
}
```

## Pitfalls
- **Do not redeclare SDK fields** — mapper bugs hide behind types that shadow the SDK's stricter shape.
- **Barrel-export all types from `types/`** via `index.ts` — missing barrel exports break `@Types/*` path alias resolution in the frontend.