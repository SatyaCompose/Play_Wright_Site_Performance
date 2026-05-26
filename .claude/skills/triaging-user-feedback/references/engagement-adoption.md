# Engagement & Adoption Signals

## When to use
Apply when triaging feedback about returning users not re-engaging — low repeat-purchase rates, wishlist feature underuse, order history confusion, or newsletter unsubscribe spikes signalling content irrelevance.

## Patterns

### Wishlist underuse traced to empty-state gap
If session replays show users landing on an empty wishlist with no CTA, triage to `frontend/components/frontastic-ui/` wishlist component. Classify as quick-win UX copy or empty-state fix — no backend change needed.

### Newsletter unsubscribe spikes to Zaius integration
```bash
# Locate subscription tracking
grep -r "trackZaiusSubscription\|Zaius" frontend --include="*.ts" --include="*.tsx" -l
```
Spike → check `trackZaiusSubscription.ts` for misfiring list assignments. If users are subscribed to wrong segments, trace back to `backend/commercetools/actionControllers/accountControllers/`.

### Order history confusion to mapper layer
"My orders don't show" tickets often trace to `backend/commercetools/mappers/` — specifically the order mapper dropping items with unexpected CT status values. Reproduce with a Jest test in `backend/_test/` before patching.

## Pitfalls
Engagement drop metrics lag by 24–48 hours in DataDog dashboards. Avoid treating a single-day dip as a confirmed regression; correlate with a deploy timestamp from git log before escalating to backlog.