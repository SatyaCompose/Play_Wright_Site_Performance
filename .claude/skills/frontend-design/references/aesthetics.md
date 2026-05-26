# Aesthetics

## When to use
Apply these tokens whenever styling text, backgrounds, borders, or interactive states to stay on-brand.

## Brand Tokens

| Token | Tailwind Class | Hex |
|-------|---------------|-----|
| Brand red | `bg-crRed` / `text-crRed` | `#ff3f33` |
| Flour gold | `bg-crGold` / `text-crGold` | `#d1c08f` |
| Near-black | `text-primary-900` | `#1a1a1a` |
| Error | `text-text-error` | semantic token |
| Link | `text-text-link` | semantic token |
| Divider | `border-border-divider` | semantic token |

## Typography
Primary font is **Inter** (variable font). Use the `Typography` component for all headings and body copy:

```tsx
import { Typography, TypographyVariant, TypographyWeight } from '@Components/frontastic-ui/typography/Typography';

<Typography variant={TypographyVariant.Display_MD} weight={TypographyWeight.SemiBold}>
  Product Title
</Typography>
```

## Focus & Accessibility
Every interactive element must expose a focus ring. Use the `.focusable` utility or `focus-visible:ring-1 ring-black`:

```tsx
<button className="focusable bg-crRed px-4 py-2 text-white">
  Shop Now
</button>
```

Maintain WCAG 2.1 AA contrast: **4.5:1** for text, **3:1** for UI components.

## Pitfalls
- Never hardcode `#ff3f33` inline — always use `bg-crRed` / `text-crRed` so theme overrides apply.
- Avoid `outline-none` without a replacement focus indicator; it silently breaks keyboard navigation.