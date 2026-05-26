# Feedback & Insights — Empty States

## When to use
When surfacing user feedback mechanisms within empty states, or using analytics signals to identify broken or confusing empty state experiences.

## Patterns

### Inline feedback prompt on empty orders page
```tsx
// Lightweight "Was this helpful?" prompt — stores response in localStorage to avoid repeat asks
export function EmptyOrdersFeedback() {
  const [submitted, setSubmitted] = useState(() => !!localStorage.getItem('kwh_orders_feedback'));

  function handleFeedback(helpful: boolean) {
    localStorage.setItem('kwh_orders_feedback', helpful ? 'yes' : 'no');
    pushGTMEcommerceEvent('empty_state_feedback', { surface: 'orders', helpful });
    setSubmitted(true);
  }

  if (submitted) return null;
  return (
    <div className="mt-8 text-center text-sm text-black-60">
      <span>Not finding what you need?</span>
      <button onClick={() => handleFeedback(true)} className="ml-2 underline">Yes</button>
      <button onClick={() => handleFeedback(false)} className="ml-1 underline">No</button>
    </div>
  );
}
```

### Algolia no-results signal — log to Datadog
```tsx
// frontend/components/frontastic-ui/products/ProductList/ProductListGrid.tsx
useEffect(() => {
  if (isClientSide && !products?.length && query) {
    datadogRum.addAction('search_no_results', { query });
    // Also push to GTM for search analytics
    pushGTMEcommerceEvent('search', { search_term: query, results_count: 0 });
  }
}, [isClientSide, products, query]);
```

### Surfacing Datadog RUM funnel drop-off from empty cart
```tsx
// Record the moment a user abandons from an empty cart state
useEffect(() => {
  const handleUnload = () => {
    if (cartItemsCount === 0) {
      datadogRum.addAction('exit_from_empty_cart');
    }
  };
  window.addEventListener('beforeunload', handleUnload);
  return () => window.removeEventListener('beforeunload', handleUnload);
}, [cartItemsCount]);
```

## Pitfalls
- `localStorage` reads must be inside `useEffect` or guarded by `isClientSide` — reading during render causes SSR/client mismatch. The feedback prompt above is safe because `useState` initialiser only runs on the client.