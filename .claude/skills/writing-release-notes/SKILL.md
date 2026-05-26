---
name: writing-release-notes
description: Drafts release notes tied to shipped features for the KWH e-commerce platform
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Writing-release-notes Skill

This skill drafts structured release notes for the Kitchen Warehouse monorepo by correlating git history, merged PRs, and changed files across `backend/`, `frontend/`, and `types/` packages. It produces changelog entries that map technical changes to user-facing outcomes across the commerce, search, checkout, and account domains.

## Quick Start

1. Run `git log --oneline <base>..HEAD` to enumerate commits in the release range.
2. Run `git diff --name-only <base>..HEAD` to identify affected packages and domains.
3. Group changes by domain: cart/checkout, account, product/search, payments, performance, infrastructure.
4. Draft notes in the format below, distinguishing backend fixes from frontend UX changes.
5. Review against PR titles and commit bodies for accuracy before publishing.

## Key Concepts

- **Scope prefixes** (`feat`, `fix`, `perf`, `refactor`, `chore`) come from conventional commits and determine the section a change belongs to.
- **Domain mapping**: `cartControllers/` → Cart & Checkout; `accountControllers/` → Account; `productControllers/` → Search & Catalog; `paymentControllers/` → Payments; `frontend/components/` → UI/UX.
- **User impact framing**: backend refactors and mapper changes rarely have direct user impact — surface them as reliability or performance improvements, not features.
- **Package tagging**: prefix each entry with `[backend]`, `[frontend]`, or `[types]` when the change is package-specific; omit the tag when it spans both.

## Common Patterns

### Standard changelog section structure

```markdown
## [vX.Y.Z] - YYYY-MM-DD

### New Features
- [frontend] Checkout: added PayPal express button on cart summary page.
- [backend] Search: parallel Algolia facet queries reduce product listing load time by ~40%.

### Bug Fixes
- [frontend] Account: resolved order history pagination resetting on tab switch.
- [backend] Cart: fixed line-item quantity overflow when merging anonymous and authenticated carts.

### Performance
- [backend] Product queries now execute concurrently via `Promise.all`, improving TTFB on PLP.

### Internal / Maintenance
- [types] Extracted shared `CheckoutState` type into `types/checkout/` package.
- [backend] Upgraded `@commercetools/platform-sdk` to 8.x; updated mapper call sites.
```

### Extracting changes by domain

```bash
# List files changed in backend action controllers
git diff --name-only <base>..HEAD -- backend/commercetools/actionControllers/

# List frontend component changes
git diff --name-only <base>..HEAD -- frontend/components/

# Show full commit messages for a domain
git log --oneline <base>..HEAD -- backend/commercetools/actionControllers/cartControllers/
```

### Mapping commit types to release note sections

| Commit type | Section |
|-------------|---------|
| `feat` | New Features |
| `fix` | Bug Fixes |
| `perf` | Performance |
| `refactor`, `chore`, `build` | Internal / Maintenance |
| `docs` | omit unless user-facing |
| `test` | omit |

### Writing user-facing descriptions

- Lead with the **surface** (Checkout, Cart, Account, Search), not the file name.
- Use past tense: "added", "fixed", "resolved", "improved".
- Quantify performance changes when numbers are available (`~40% faster`, `reduced bundle by 12 kB`).
- Avoid internal terms (`mapper`, `tastic`, `actionController`) in customer-facing sections; use them only in Internal notes.
- For Algolia changes, note whether they affect search relevance, facets, or recommendations.
- For Kinde/auth changes, note the user-visible behavior (login redirect, session expiry) not the OAuth detail.