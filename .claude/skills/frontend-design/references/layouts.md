# Layouts

## When to use
Apply these layout patterns for page shells, section containers, and product grids to maintain consistent spacing and max-widths.

## Page Container
Wrap every top-level page section with `.default-container` to enforce `max-w-[1440px]` and responsive horizontal padding:

```tsx
<div className="default-container">
  {/* page content */}
</div>
```

For narrower content (forms, confirmation panels) use `.max-w-tablet` (`max-w-[960px]`):

```tsx
<div className="default-container">
  <div className="max-w-tablet mx-auto">
    <CheckoutForm />
  </div>
</div>
```

## Responsive Product Grid (PLP)
```tsx
<ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
  {products.map((p) => (
    <li key={p.id}><ProductCard product={p} /></li>
  ))}
</ul>
```

## SCSS Breakpoints
Use the `mq()` mixin inside CSS Modules — never raw `@media` in module files:

```scss
@use 'styles/components/common/breakpoints' as *;

.hero {
  min-height: 320px;
  @include mq('lg') { min-height: 560px; }
}
```

Breakpoints: `568px` `640px` `768px` `1024px` `1280px` `1440px` `1770px`.

## Pitfalls
- Never set a fixed width on `.default-container` children — let the grid or flex children determine their own widths.
- Avoid mixing raw `@media` queries with `mq()` in the same module file; it causes specificity conflicts.