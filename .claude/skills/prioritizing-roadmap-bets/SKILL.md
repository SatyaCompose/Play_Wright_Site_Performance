---
name: prioritizing-roadmap-bets
description: |
  Ranks initiatives using impact, effort, and risk signals for the KWH e-commerce platform.
  Use when: deciding which features to build next, trading off LCP/performance work against new commerce features,
  scoring initiatives against customer impact metrics (conversion, AOV, activation), evaluating CT config changes
  vs frontend-only work by release risk, or defending prioritization decisions with signal-based reasoning.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Prioritizing-roadmap-bets Skill

KWH's roadmap sits at the intersection of headless commerce constraints (CT config, Frontastic tastic registration, Algolia index changes) and standard e-commerce metrics (conversion rate, LCP, cart abandonment). Prioritization must account for cross-layer coupling: a feature that touches CT custom fields, a backend mapper, shared types, and a frontend component carries far higher release risk than a pure UI change. Score initiatives on impact × reach ÷ (effort + risk) — with "risk" weighted heavily for anything touching CT project config or shared `types/` package contracts.

## Quick Start

### Score an Initiative

| Signal          | Score (1–5) | Notes |
|-----------------|-------------|-------|
| Customer impact | 4           | Reduces cart abandonment on checkout step 2 |
| Reach           | 5           | All checkout customers |
| Effort (dev)    | 3           | Backend controller + frontend form change |
| CT risk         | 2           | No CT config change required |
| Type contract   | 1           | Additive-only types change |

`Priority score = (impact × reach) ÷ (effort + ct_risk + type_contract) = (4 × 5) ÷ (3 + 2 + 1) = 3.33`

### Layer Risk Matrix

| Layer touched              | Risk weight | Notes |
|----------------------------|-------------|-------|
| CT custom fields/types     | +3          | Needs CT project config — separate release |
| Shared `types/` package    | +2          | Breaking change cascades to backend + frontend |
| Backend action controller  | +1          | Isolated — can be deployed independently |
| Frontend component only    | +0          | Zero backend impact, instant rollback |
| Algolia index schema       | +2          | Requires re-index — downtime risk |
| Frontastic tastic config   | +0          | Config-only, no code release needed |

### Horizon Bucketing

- **Horizon 1 — Now** (score ≥ 3.0, low CT risk)
- **Horizon 2 — Next** (score 2.0–2.9, or high CT risk Horizon 1 items)
- **Horizon 3 — Later** (score < 2.0 or strategic-only bets)

## Key Concepts

| Concept | Usage | Where it lives |
|---------|-------|----------------|
| CT risk | Any feature needing CT project config changes | `backend/commercetools/ctClients/` |
| Type contract risk | Breaking change to `types/` shared package | `types/` package |
| Layer isolation | Backend-only changes ship without frontend release | `backend/commercetools/actionControllers/` |
| Tastic config | Feature is config, not code — zero dev effort | `frontend/frontastic/tastics/` |
| LCP bets | Performance work with measurable Core Web Vitals ROI | `frontend/pages/`, `next.config.js` |

## Common Patterns

### Decouple CT Config from UI Launch

Ship CT plumbing first returning `null`, verify in staging, then ship UI. Never tie CT config to a UI deadline — they fail independently.

```typescript
// backend/commercetools/actionControllers/productControllers/GetBadge.ts
const badge = product.custom?.fields?.['promotional-badge'] ?? null;
return { statusCode: 200, body: JSON.stringify({ badge }) };
```

### Validate LCP Bets with Metrics Before Scheduling

Check Datadog RUM before scheduling LCP work — only schedule if P75 LCP > 2.5s on the target page. Performance work without a measured baseline is unscoreable.

### Flag Breaking Type Changes as Blockers

```typescript
// types/cart/Cart.ts
export type Cart = {
  lineItems: LineItem[];
  discountCodes: DiscountCode[]; // renaming = +2 risk, backend mapper AND frontend must ship atomically
};
```

### Quick-Win Filter

All must be true:
- `effort ≤ 2` — frontend component only or additive backend field
- `reach ≥ 4` — PLP, PDP, cart, or checkout (high-traffic surfaces)
- `ct_risk = 0` — no CT project config change
- `type_contract ≤ 1` — additive or no change to `types/`

## Related Skills

- **scoping-feature-work** — decompose a prioritized initiative into vertical slices
- **commercetools** — assess CT config change complexity and release risk
- **typescript** — evaluate type contract breaking-change impact
- **algolia** — score Algolia index change effort and re-index risk
- **nextjs** — LCP and performance bet scoping (SSR, image optimization)
- **jest** — estimate test coverage effort per initiative
```

The key changes from the existing file:
- Removed the `## See Also` block (reference files not required)
- Added a **Quick-Win Filter** pattern (new practical pattern for backlog grooming)
- Tightened prose throughout to match the concise style requirement