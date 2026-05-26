---
name: triaging-user-feedback
description: Routes user feedback signals into actionable backlog items and quick wins for the KWH e-commerce platform. Use when: categorizing DataDog RUM errors, Algolia no-results signals, checkout funnel drop-offs, GTM event gaps, newsletter unsubscribe spikes, or support tickets into prioritized engineering tasks or UX improvements.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Triaging User Feedback

Feedback on KWH arrives via three signal types: **quantitative** (DataDog RUM, Algolia analytics, GTM funnel events), **qualitative** (support tickets, session replays, WisePops responses), and **behavioral** (checkout step abandonment, cart errors, error boundary catches). Triage means routing each signal to the right layer — quick UX copy fix, frontend component patch, backend action controller change, or CT config update.

## Quick Start

### Identify signal source and layer

```typescript
// Signal → Layer mapping
const SIGNAL_LAYERS = {
  'ErrorBoundary caught error': 'frontend/components',
  'no_results_rate > 10%': 'backend/commercetools/actionControllers/productControllers',
  'purchase event gap': 'frontend/components/frontastic-ui/KwhCheckout/checkout/tracking',
  '/action/cart 5xx spike': 'backend/commercetools/actionControllers/cartControllers',
} as const;
```

### Triage decision tree

```
Feedback signal received
  ├── Error rate spike?
  │   ├── DataDog network log → /action/cart or /action/checkout → backend controller
  │   └── ErrorBoundary catch → frontend component
  ├── Conversion drop?
  │   ├── GTM funnel gap → checkout tracking gtm.ts
  │   └── Step abandonment → useCheckoutReducer step transitions
  ├── Search friction?
  │   └── Algolia no-results / low CTR → productControllers + Algolia config
  └── UX confusion?
      ├── Session replay (DataDog/Clarity) → specific component
      └── WisePops response → in-app copy / empty states
```

### Quick win vs backlog classification

```typescript
const QUICK_WIN_CRITERIA = {
  scope: 'single component or helper',
  riskLevel: 'no checkout flow impact',
  effort: '< 1 day',
  examples: [
    'Fix misleading error message in frontend/components',
    'Add missing GTM event in existing tracking file',
    'Fix empty state copy in a frontastic-ui component',
  ],
};

const BACKLOG_CRITERIA = {
  scope: 'multiple controllers or CT config',
  riskLevel: 'checkout flow or payment affected',
  effort: '> 1 day',
  examples: [
    'Redesign checkout step validation across useCheckoutReducer',
    'Add new payment method integration',
  ],
};
```

## Key Concepts

| Signal Source | Where to Look | Triage Layer |
|---------------|--------------|--------------|
| DataDog RUM errors | `frontend/helpers/utils/dataDogNetworkLogger.ts` | Backend controller or frontend component |
| GTM event gaps | `frontend/helpers/analytics.ts`, `checkout/tracking/gtm.ts` | Frontend tracking |
| Algolia no-results | `backend/commercetools/actionControllers/productControllers` | Backend + Algolia config |
| Error boundary catches | `frontend/components/common/ErrorBoundry.tsx` | Frontend component |
| Checkout abandonment | `useCheckoutReducer` step transitions | Frontend checkout hooks |
| Newsletter drop-off | `trackZaiusSubscription.ts`, Zaius lists | Backend action + frontend copy |

## Common Patterns

### Link a DataDog error to source

**When:** RUM shows error spike on `/action/cart` or `/action/checkout`

```typescript
// dataDogNetworkLogger.ts tags all errors with endpoint + HTTP status
// 1. Filter DD logs: url contains '/action/cart', status: 500
// 2. Match to backend/commercetools/actionControllers/cartControllers/
// 3. Reproduce with Jest test in backend/_test/
```

### Escalate a quick win from session replay

**When:** Clarity or DataDog replay shows user confusion on a specific component

```
1. Note the page URL + element from replay
2. Map URL to frontend/components/frontastic-ui/<feature>/
3. Copy-only fix → edit component JSX
4. Logic fix → check useCheckoutReducer or SWR cache key
5. Add GTM event if the confused step lacks tracking
```

### Algolia no-results triage

**When:** Algolia Analytics shows no-results rate rising above 10%

```bash
# Find Algolia query calls in frontend
grep -r "searchClient\|algoliasearch\|instantSearch" frontend --include="*.ts" --include="*.tsx" -l

# Find backend product search controllers
ls backend/commercetools/actionControllers/productControllers/
```

Actions:
- Synonym missing → add in Algolia dashboard (no code change, quick win)
- Wrong index replica → fix `indexName` in search component (quick win)
- Entire category missing → investigate Commercetools → Algolia sync (backlog)

### GTM purchase event gap

**When:** GTM preview shows `purchase` event not firing after order confirmation

```bash
# Find existing GTM event calls
grep -r "dataLayer.push\|purchase\|add_to_cart" frontend/components --include="*.tsx" -l
grep -r "gtm\|GTM" frontend/helpers --include="*.ts" -l
```

Actions:
- Event call absent → add `dataLayer.push({ event: 'purchase', ... })` after order confirmation (quick win)
- Payload incomplete → enrich with `order_id`, `revenue`, `items` from `types/orders/` (quick win)
- Event fires before async completes → move push inside `await` block (bug fix)

## Related Skills

- **mapping-user-journeys** — trace end-to-end flows to locate friction before triaging
- **prioritizing-roadmap-bets** — score triaged items by impact/effort after categorizing
- **scoping-feature-work** — decompose backlog items into MVP slices once triaged
- **instrumenting-product-metrics** — add missing tracking that surfaces future feedback
- **improving-activation-flow** — act on first-purchase funnel drop signals
- **designing-inapp-guidance** — act on UX confusion signals from session replays
- **orchestrating-feature-adoption** — plan rollout after backlog item is resolved
- **commercetools** — when triage points to a CT config or controller issue
- **jest** — reproduce reported backend errors as failing tests before fixing