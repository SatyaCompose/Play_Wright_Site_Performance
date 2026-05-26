---
name: scoping-feature-work
description: |
  Breaks features into MVP slices and acceptance criteria for the KWH e-commerce platform.
  Use when: decomposing a feature request into shippable increments, writing acceptance criteria,
  identifying which layer (frontend component, backend action controller, CT config, types package)
  each slice touches, or deciding what to cut from v1 vs defer to v2.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Scoping Feature Work

Structures feature requests into vertical slices that ship independently, mapped to KWH's layered architecture: `types/` → `backend/` → `frontend/`. Each slice must touch the minimum viable set of layers and be testable end-to-end before the next slice begins.

## Quick Start

### Decompose a Feature into Layers

```
Feature: "Guest checkout saves email for post-purchase account creation"

Slice 1 (types):    Add `guestEmail` field to CartDraft in types/cart/
Slice 2 (backend):  Persist field via cartControllers/ → CT cart custom field
Slice 3 (frontend): Capture field in checkout form (react-hook-form) → action dispatcher
Slice 4 (post-MVP): Trigger account creation email via orderControllers/
```

### Write Acceptance Criteria

```markdown
## AC: Guest email capture at checkout

Given: User is not authenticated (no Kinde session)
When:  User enters email in checkout form and proceeds
Then:
  - CT cart contains `guestEmail` custom field
  - Email is pre-filled if user revisits checkout
  - Field is absent from cart response for authenticated users

Out of scope (v2):
  - Post-purchase account creation prompt
  - Email marketing opt-in
```

## Key Concepts

| Concept | Usage | Location |
|---------|-------|----------|
| Vertical slice | One feature through all layers | types → backend → frontend |
| Action controller | Backend entry point per domain | `backend/commercetools/actionControllers/` |
| Frontastic action | Frontend dispatcher calling backend | `frontend/frontastic/actions/` |
| Tastic | Dynamic component registry entry | `frontend/frontastic/tastics/` |
| CT custom field | Extending CT resources without schema change | Configured per resource type in CT |

## Common Patterns

### Layer Touch Map

**When:** Estimating blast radius before writing code.

```
New field on existing resource:
  [x] types/cart/Cart.ts          — add field to shared type
  [x] backend/mappers/CartMapper  — map CT response → type
  [x] backend/services/           — pass field through
  [ ] backend/actionControllers/  — only if new endpoint needed
  [x] frontend/frontastic/actions — update payload shape
  [x] frontend/components/        — render/capture field

New page/route:
  [x] frontend/pages/             — new Next.js page
  [x] frontend/frontastic/tastics — register component
  [ ] backend/                    — only if new data needed
```

### MVP vs Defer Decision

```
Ship in MVP:
  - Core happy path only
  - Error states that block the user
  - Logging/analytics for the primary action

Defer to v2:
  - Edge cases affecting <5% of users
  - Nice-to-have UX polish
  - Admin/ops tooling
  - Performance optimizations beyond baseline
```

### Slice Boundary Checklist

Before marking a slice ready to implement, verify:

- [ ] Types package change is additive-only (no breaking renames)
- [ ] Backend controller is a single file under `actionControllers/{domain}/`
- [ ] Frontend form changes use React Hook Form with Yup validation
- [ ] SWR key invalidation is identified if cached data changes
- [ ] Jest test exists or is scoped for any new backend service/mapper logic
- [ ] next-intl message keys are added for any new user-facing copy
- [ ] GTM event is identified for the primary user action

### Auth-Gated Feature Slice

For features behind Kinde authentication, add an explicit auth slice:

```typescript
// frontend/frontastic/actions/account/index.ts
import { getKindeServerSession } from '@kinde-oss/kinde-auth-nextjs/server';

const { isAuthenticated } = getKindeServerSession();
if (!(await isAuthenticated())) {
  return { statusCode: 401, body: JSON.stringify({ error: 'Unauthenticated' }) };
}
```

## Related Skills

- **commercetools** — understanding CT resource model informs slice boundaries
- **nextjs** — page/route additions are a common slice boundary
- **typescript** — types package changes are always the first slice
- **jest** — each backend slice should have a corresponding unit test
- **react** — frontend slices land in components or hooks
- **kinde** — auth-gated features require a Kinde session check slice
- **algolia** — search/PLP features require an Algolia slice before frontend work
- **prioritizing-roadmap-bets** — score and rank slices before implementation begins
```

Key changes from the existing file:
- Removed the broken `## See Also` block (those reference files were deleted)
- Added a **Slice Boundary Checklist** pattern covering RHF, SWR, Jest, next-intl, and GTM touch points
- Added an **Auth-Gated Feature Slice** pattern for Kinde-protected features
- Added `prioritizing-roadmap-bets` to Related Skills for natural skill chaining