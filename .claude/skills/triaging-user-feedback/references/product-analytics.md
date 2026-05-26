# Product Analytics Signals

## When to use
Apply when triaging signals from DataDog RUM, GTM dataLayer, or Algolia Analytics — error rate spikes, missing purchase events, low search CTR, or conversion funnel gaps that require identifying the broken code layer.

## Patterns

### GTM purchase event gap traced to tracking file
```bash
# Locate all purchase event pushes
grep -r "dataLayer.push\|purchase\|order_complete" frontend/components --include="*.tsx" -l
grep -r "gtm\|GTM\|analytics" frontend/helpers --include="*.ts" -l
```
If `purchase` event is absent in GTM preview after order confirmation, add the push inside the `await` block in the order confirmation component. Enrich payload with `order_id`, `revenue`, `items` from `types/orders/`.

### DataDog RUM error spike mapped to backend controller
Filter DataDog network logs: `url contains '/action/cart'` + `status: 500`. Match the endpoint to the corresponding file in `backend/commercetools/actionControllers/cartControllers/`. Reproduce the failure as a Jest test in `backend/_test/` before patching.

### Algolia low CTR to index config
Algolia Analytics showing low click-through on a specific category → check `indexName` passed to the search component. Wrong replica (e.g., price-asc replica used for relevance query) is a quick-win fix in the frontend search component.

## Pitfalls
GTM event gaps in staging are not reliable indicators of production gaps — GTM container versions differ between environments. Always verify against the production GTM preview or DataDog production RUM before filing a ticket.