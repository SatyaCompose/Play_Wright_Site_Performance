# Activation & Onboarding Signals

## When to use
Apply when triaging feedback that indicates new users are failing to complete first-purchase milestones — account registration drop-offs, post-login cart merge failures, or first checkout abandonment.

## Patterns

### Map registration drop-off to controller layer
Support tickets citing "couldn't log in after signup" trace to `backend/commercetools/actionControllers/accountControllers/`. Check whether customer creation in CT succeeded but Kinde token exchange failed.

```typescript
// Frontend action dispatcher entry point
// frontend/frontastic/actions/account/index.ts
// → calls backend/commercetools/actionControllers/accountControllers/CreateAccount.ts
```

### Link post-login cart merge failures to state provider
When users report losing their guest cart after login, triage to `frontend/frontastic/provider/` (cart merge context) and `backend/commercetools/actionControllers/cartControllers/MergeCart.ts`. A 5xx from DataDog on `/action/cart/mergeCart` confirms the backend layer.

### First-checkout abandonment via useCheckoutReducer
Step-level abandonment in the checkout funnel maps to step transitions in the checkout reducer. Locate the stall point using GTM `checkout_step_view` events, then find the corresponding state in `frontend/components/frontastic-ui/KwhCheckout/`.

## Pitfalls
Do not classify every registration complaint as a backend bug. Kinde OAuth misconfiguration (wrong redirect URI, expired PKCE state) produces frontend-only failures — check `KINDE_REDIRECT_URL` in `.env.local` before filing a backend ticket.