# Roadmap & Experiments Signals

## When to use
Apply when feedback triage has produced a categorized list of issues and you need to decide whether an item belongs on the immediate sprint backlog, a future roadmap bet, or a controlled experiment — especially for checkout flow changes or search experience updates.

## Patterns

### Classify by blast radius before scheduling
Before adding a triaged item to the backlog, confirm scope:
- **Quick win** — single component, no checkout flow impact, < 1 day: schedule for current sprint
- **Backlog** — multiple controllers or CT config, > 1 day: write acceptance criteria and defer
- **Experiment** — uncertain user impact (new empty state copy, reordered checkout steps): wrap in a feature flag via environment variable before shipping

### Feature-flag checkout changes
Checkout flow modifications derived from funnel-drop triage carry high risk. Gate behind an env flag and instrument a GTM `experiment_variant` event to measure conversion impact before full rollout.

```typescript
// Environment-gated experiment
const ENABLE_STEP_CONSOLIDATION = process.env.NEXT_PUBLIC_ENABLE_STEP_CONSOLIDATION === 'true';
```

### Algolia synonym backlog vs quick win
- Missing synonym → Algolia dashboard change only → quick win, no deploy needed
- Missing entire product category in index → Commercetools → Algolia sync investigation → backlog item with spike estimate

## Pitfalls
Do not let a high volume of similar tickets automatically promote an issue to a roadmap bet. Volume reflects surface area, not engineering complexity. A flood of "search returns no results" tickets may resolve with a single synonym addition — validate root cause before scope estimation.