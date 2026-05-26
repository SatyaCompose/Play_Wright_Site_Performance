---
name: jest
description: |
  Runs Jest test suites for backend unit and integration testing with TypeScript and ts-jest.
  Use when: writing or running tests in backend/, adding test coverage for action controllers/services/mappers, setting up mocks for Commercetools SDK, or debugging failing Jest tests.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Jest Skill

Jest 30.x with ts-jest runs backend TypeScript tests in a Node environment under strict mode (`strict: true`). Tests live in `backend/_test/` or alongside source as `*.test.ts` / `*.spec.ts`. The suite is configured via `backend/jest.config.js` with `preset: 'ts-jest'`, `testEnvironment: 'node'`, and axios excluded from `transformIgnorePatterns`.

## Quick Start

```bash
cd backend
npm test                                        # run all tests once
npm test -- --watch                             # watch mode
npm test -- --testPathPattern=CartMapper        # run single file
npm test -- --verbose                           # show individual test names
npm test -- --coverage                          # generate coverage report
```

## Key Concepts

| Concept | Detail |
|---------|--------|
| `export {}` | Required in every test file — `isolatedModules: true` needs a module boundary |
| `jest.mock()` | Hoisted before imports; use at top-level to mock entire modules |
| `jest.fn()` | Creates typed spy; `mockResolvedValue` for async, `mockReturnValue` for sync |
| `beforeEach(() => jest.clearAllMocks())` | Reset call counts between tests to prevent state bleed |
| Singleton reset | `AdminClient` / `AnonymousClient` use `_instance`; null it out in `beforeEach` |

## Common Patterns

### Mapper unit test (no mocks needed)

```typescript
// backend/_test/mappers/CartMapper.test.ts
import { CartMapper } from '../../commercetools/mappers/CartMapper';

describe('CartMapper', () => {
  describe('commercetoolsCartToCart', () => {
    it('maps cartId', () => {
      const ct = { id: 'abc123', version: 1, lineItems: [], customLineItems: [], totalPrice: { centAmount: 0, currencyCode: 'AUD', fractionDigits: 2, type: 'centPrecision' } } as any;
      expect(CartMapper.commercetoolsCartToCart(ct).cartId).toBe('abc123');
    });
  });
});

export {};
```

### Service test with mocked CT client

```typescript
// backend/_test/services/CartService.test.ts
jest.mock('../../commercetools/ctClients/AdminClient');

import { AdminClient } from '../../commercetools/ctClients/AdminClient';
import { CartService } from '../../commercetools/services/CartService';

const mockExecute = jest.fn();
(AdminClient.getInstance as jest.Mock).mockReturnValue({
  carts: () => ({ get: () => ({ execute: mockExecute }) }),
});

describe('CartService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns mapped cart', async () => {
    mockExecute.mockResolvedValue({ body: { id: 'cart-1', lineItems: [] } });
    const result = await CartService.getCart('cart-1');
    expect(result.cartId).toBe('cart-1');
  });
});

export {};
```

### Singleton client reset

```typescript
beforeEach(() => {
  // Force fresh client instance per test
  (AdminClient as any)._instance = null;
});
```

## Coverage Priority

Target in this order for highest ROI:

1. **`commercetools/mappers/`** — pure static methods, zero mocking required
2. **`commercetools/services/`** — mock CT client, test business logic branches
3. **`commercetools/actionControllers/`** — integration-style with mocked services
4. **`utils/`** — pure functions, trivial assertions

## Related Skills

- **typescript** — strict-mode patterns used in test files
- **commercetools** — CT SDK client chain shapes to mock
- **node** — async/await patterns and environment variable handling
```

Key changes from the existing version:
- Removed all `## See Also` reference file links (no reference files)
- Renamed `## Test File Structure` → `## Common Patterns` with multiple named examples
- Added `--coverage` flag to Quick Start
- Kept the singleton reset warning as an inline pattern rather than a standalone `## WARNING` section
- Coverage Priority section preserved with same ordering