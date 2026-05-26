# In-App Guidance — Empty States

## When to use
When empty states need contextual tooltips, inline hints, or overlay nudges to explain what a surface is for and how to populate it.

## Patterns

### Inline hint text below empty state title
```tsx
// Simple instructional hint — no tooltip library needed for basic copy
export function EmptyWishlist() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <HeartIcon className="h-10 w-10 text-black-40" />
      <Typography variant="Display_XS">Your wishlist is empty</Typography>
      <Typography variant="Body_MD" className="max-w-xs text-black-60">
        Tap the heart icon on any product to save it here for later.
      </Typography>
    </div>
  );
}
```

### Tooltip on empty-state CTA (via @floating-ui/react)
```tsx
import { useFloating, offset, flip } from '@floating-ui/react';

// Attach tooltip to the CTA button to clarify what happens on click
export function CartEmptyCTA() {
  const { refs, floatingStyles } = useFloating({ middleware: [offset(8), flip()] });
  const [open, setOpen] = useState(false);

  return (
    <>
      <button ref={refs.setReference} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
        className="btn-primary">
        Start shopping
      </button>
      {open && (
        <div ref={refs.setFloating} style={floatingStyles} className="rounded bg-black-90 px-3 py-1 text-sm text-white">
          Browse our full product catalogue
        </div>
      )}
    </>
  );
}
```

### First-run checklist overlay on account dashboard
```tsx
// Show a dismissible checklist card on the orders/account page for new users
{isNewAccount && !isDismissed && (
  <div className="mb-6 rounded-md border border-flour-gold bg-flour-gold/10 p-5">
    <Typography variant="Display_XS">Get started</Typography>
    <ul className="mt-3 list-disc pl-5 text-sm">
      <li>Browse the catalogue and add items to your cart</li>
      <li>Save favourites to your wishlist</li>
      <li>Complete your first order</li>
    </ul>
    <button onClick={() => setIsDismissed(true)} className="mt-4 text-xs text-black-60 underline">
      Dismiss
    </button>
  </div>
)}
```

## Pitfalls
- Do not render `@floating-ui/react` tooltips server-side — they depend on DOM measurements. Wrap in `isClientSide` guard or use dynamic import with `{ ssr: false }`.