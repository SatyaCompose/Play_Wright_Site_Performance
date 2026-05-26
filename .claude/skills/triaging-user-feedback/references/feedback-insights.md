# Feedback Insights

## When to use
Apply when synthesizing raw feedback signals (support tickets, session replays, DataDog errors, Algolia analytics, GTM gaps) into a structured triage output — identifying the source layer, classification (quick win vs backlog), and the specific file or controller to change.

## Patterns

### Source-to-layer routing table
| Signal | First file to check | Layer |
|--------|-------------------|-------|
| `/action/cart` 5xx | `backend/commercetools/actionControllers/cartControllers/` | Backend controller |
| ErrorBoundary catch in DD | `frontend/components/common/ErrorBoundry.tsx` | Frontend component |
| Algolia no-results > 10% | `backend/commercetools/actionControllers/productControllers/` | Backend + Algolia config |
| GTM `purchase` missing | `frontend/helpers/analytics.ts`, checkout tracking | Frontend tracking |
| Cart merge failure post-login | `backend/commercetools/actionControllers/cartControllers/MergeCart.ts` | Backend controller |

### Reproduce before triaging
Every backend error signal should become a failing Jest test in `backend/_test/` before the ticket is written. This locks in the reproduction case and prevents re-opening after a superficial fix.

### Write triage output as acceptance criteria
Convert each signal into a one-line acceptance criterion scoped to a single file:
```
Given a guest cart exists, when user logs in, then /action/cart/mergeCart returns 200 and cart line items are preserved.
```
This format feeds directly into `scoping-feature-work` for sprint decomposition.

## Pitfalls
Avoid triaging from error message text alone — DataDog RUM surfaces the client-visible message, not the root cause. Always pull the full network log entry (endpoint, status, request payload) before assigning the issue to a backend controller or frontend component.