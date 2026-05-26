# Motion

## When to use
Apply motion tokens when adding loading states, hover transitions, or entrance animations to keep interactions consistent and performant.

## Skeleton / Loading State
Use `animate-pulse` with gray placeholder shapes whenever data is loading:

```tsx
<div className="animate-pulse space-y-3">
  <div className="h-48 rounded-lg bg-gray-200" />
  <div className="h-4 w-3/4 rounded bg-gray-200" />
  <div className="h-4 w-1/2 rounded bg-gray-200" />
</div>
```

## Hover Transitions
Prefer Tailwind's `transition` utilities over custom CSS for simple state changes:

```tsx
<button className="bg-crRed transition-colors duration-150 hover:bg-red-500">
  Add to Cart
</button>

<div className="opacity-0 transition-opacity duration-200 group-hover:opacity-100">
  Quick view
</div>
```

## Reduced Motion
Always respect `prefers-reduced-motion` for users who opt out of animation:

```tsx
<div className="animate-pulse motion-reduce:animate-none">
  {/* skeleton */}
</div>
```

In SCSS modules, wrap keyframe animations:

```scss
@media (prefers-reduced-motion: no-preference) {
  .fadeIn { animation: fadeIn 0.2s ease-out; }
}
```

## Pitfalls
- Avoid `transition-all` — it re-triggers on every CSS property change including layout, causing jank on scroll.
- Don't use JavaScript-driven animations for things achievable with CSS transitions; they block the main thread during heavy renders.