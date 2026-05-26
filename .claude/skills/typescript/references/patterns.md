# TypeScript Patterns

## When to use
When writing new types, extending SDK types, typing action controllers, or reviewing type patterns across backend (strict) and frontend (non-strict).

## Backend: Explicit Return Types on Exported Functions
Always annotate exported controller/service functions in backend — `strict: true` requires it.

```typescript
// backend/commercetools/actionControllers/cartControllers/AddToCart.ts
export async function addToCart(request: ActionContext): Promise<Cart> {
  const body = JSON.parse(request.body ?? '{}') as AddToCartBody;
  const cartId = body.cartId ?? '';
  return cartService.addLineItem(cartId, body.lineItem);
}
```

## Frontend: Interface-Only for Component Props
Declare prop shapes as interfaces; avoid annotating internal state variables.

```typescript
// frontend/components/frontastic-ui/KWHCart/CartItem.tsx
interface CartItemProps {
  lineItem: CustomCommerceToolsLineItem;
  onRemove: (lineItemId: string) => void;
}

export function CartItem({ lineItem, onRemove }: CartItemProps) {
  const [removing, setRemoving] = useState(false); // no annotation needed
  ...
}
```

## Type-Only Imports for Tree-Shaking
Use `import type` for all imports used only at the type level. Required for `isolatedModules` compatibility in both tsconfigs.

```typescript
import type { Cart } from '@Types/cart/Cart';
import type { LineItem as CommercetoolsLineItem } from '@commercetools/platform-sdk';
```

## Pitfalls
- **Never use `any` in backend** — `strict: true` will flag implicit `any`; use `unknown` with narrowing instead.
- **Frontend `strict: false` is not a license to skip types** — annotate public API boundaries (props, hooks, actions) even when the compiler doesn't require it.