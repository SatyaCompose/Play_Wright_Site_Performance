---
name: running-product-experiments
description: |
  Sets up product experiments and rollout checks for the KWH e-commerce platform.
  Use when: adding feature flags via environment variables, instrumenting A/B test variants
  in GTM dataLayer, measuring experiment outcomes via Datadog RUM funnels, validating
  Algolia search ranking experiments, or verifying rollout readiness across checkout/PDP flows.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Running-product-experiments Skill

KWH has no dedicated feature-flag SDK (no LaunchDarkly, Unleash, or Statsig). Experiments run through three layered mechanisms: **env-var feature gates** (static per-deploy), **GTM dataLayer A/B events** (runtime variant tracking), and **Datadog RUM funnels** (outcome measurement). Algolia's built-in A/B testing covers search ranking experiments separately.

## Quick Start

### Env-var feature gate (frontend)

```tsx
// Read at build time — safe for SSR and client
const ENABLE_NEW_CHECKOUT = process.env.NEXT_PUBLIC_ENABLE_NEW_CHECKOUT === 'true';

if (!ENABLE_NEW_CHECKOUT) return <LegacyCheckout />;
return <NewCheckout />;
```

### GTM experiment event

```ts
// Push variant assignment on mount
window.dataLayer?.push({
  event: 'experiment_viewed',
  experiment_id: 'checkout_v2',
  variant_id: 'treatment', // 'control' | 'treatment'
  user_type: isAnonymousUser ? 'guest' : 'authenticated',
});
```

### Datadog RUM outcome tracking

```ts
import { datadogRum } from '@datadog/browser-rum';

datadogRum.addAction('experiment_converted', {
  experiment_id: 'checkout_v2',
  variant_id: 'treatment',
  value: order.totalPrice,
});
```

## Key Concepts

| Concept | Mechanism | Where |
|---------|-----------|-------|
| Feature gate | `NEXT_PUBLIC_*` env var | `frontend/.env.local` |
| Variant assignment | GTM `experiment_viewed` event | `window.dataLayer` |
| Outcome measurement | Datadog RUM action / GTM conversion | `datadogRum.addAction` |
| Search ranking test | Algolia A/B test (dashboard) | Algolia console |
| Session correlation | Datadog session ID | `useDataDogInfo` hook |

## Common Patterns

### Safe rollout with env guard

**When:** Shipping a risky surface change (checkout, cart, payment) that needs a kill-switch.

```tsx
const FEATURE_ENABLED = process.env.NEXT_PUBLIC_FEATURE_XYZ === 'true';

export function FeatureWrapper({ children }) {
  if (!FEATURE_ENABLED) return <LegacyFeature />;
  return <>{children}</>;
}
```

### Verify rollout is instrumented

**When:** Before declaring an experiment live, confirm all three signals fire.

```bash
# 1. Confirm env var is present
grep "NEXT_PUBLIC_" frontend/.env.local | grep EXPERIMENT

# 2. In browser DevTools:
#    window.dataLayer.filter(e => e.event === 'experiment_viewed')

# 3. In Datadog: RUM → Explorer → Action: experiment_converted
```

### Server-side gate in getServerSideProps

**When:** Experiment must gate an entire page or affect SSR-rendered markup.

```ts
export const getServerSideProps: GetServerSideProps = async () => {
  const showNewPDP = process.env.NEXT_PUBLIC_NEW_PDP === 'true';
  return { props: { showNewPDP } };
};
```

## Related Skills

- **nextjs** — env vars, `getServerSideProps` for server-side gate reads, dynamic imports for deferred experiment UI
- **react** — component-level variant rendering, `useEffect` for GTM pushes
- **kinde** — user identity for authenticated vs guest variant splits
- **algolia** — Algolia A/B tests for search ranking experiments
- **mapping-user-journeys** — trace experiment surfaces end-to-end
- **improving-activation-flow** — measure experiment impact on first-purchase funnel
- **orchestrating-feature-adoption** — sequence rollout nudges and GTM events
- **prioritizing-roadmap-bets** — score experiments by impact before running them
- **scoping-feature-work** — define MVP slice and acceptance criteria per experiment