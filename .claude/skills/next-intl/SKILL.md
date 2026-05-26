---
name: next-intl
description: |
  Handles internationalization with next-intl 4.x and Next.js Pages Router.
  Use when: adding translations to components, creating new message keys, modifying locale
  configuration, debugging missing translations, adding new namespaces, or working with
  server-side locale handling in getServerSideProps.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Next-intl Skill

KWH uses next-intl 4.x with the Pages Router. Translations live in `frontend/public/locales/` organised into per-domain JSON namespaces. The project wraps `useTranslations` in a custom `useFormat` hook that handles missing-context gracefully — **always** use `useFormat`, never call `useTranslations` directly in components.

## Quick Start

### Adding a translation to a component

```typescript
import { useFormat } from 'helpers/hooks/useFormat';

export function MyComponent() {
  const { formatMessage } = useFormat({ name: 'common' });

  return <p>{formatMessage({ id: 'my.key', defaultMessage: 'Fallback text' })}</p>;
}
```

### Adding a new translation key

1. Add the key to `frontend/public/locales/en/<namespace>.json`
2. Add the same key to `frontend/public/locales/en_GB/<namespace>.json`
3. Use `formatMessage({ id: 'my.key', defaultMessage: '...' })` in the component

## Key Concepts

| Concept | Location | Notes |
|---------|----------|-------|
| Plugin config | `frontend/next.config.js` | `createNextIntlPlugin('./i18n.ts')` wraps the Next.js config |
| Request config | `frontend/i18n.ts` | Loads all namespace JSON files via `getRequestConfig`; validates locale against a `Set` |
| Provider | `frontend/pages/_app.tsx` | `NextIntlClientProvider` receives `messages` and `locale` from `pageProps` |
| Custom hook | `frontend/helpers/hooks/useFormat.ts` | Wraps `useTranslations`; falls back to `defaultMessage` when context is absent |
| Messages | `frontend/public/locales/{locale}/*.json` | 9 namespaces per locale, merged into a single flat object at request time |

### Active locales

Only `en` and `en_GB` are validated in `i18n.ts`. Any other locale triggers `notFound()`. `de_DE` and `de_CH` JSON files exist but are **not** wired up. Locale is **not** included in URL paths (prefix strategy: `never`).

### Locale detection

The raw locale is read from the `x-next-intl-locale` request header (set by Frontastic / the CDN) and falls back to Next.js `context.locale`. `en_GB` is normalised to `en` internally before calling Commercetools.

### Namespaces

| Namespace | Used for |
|-----------|---------|
| `common` | Shared labels, form fields, generic UI, country codes |
| `cart` | Cart page and cart sidebar |
| `product` | Product detail, listings |
| `checkout` | Checkout flow steps and payment |
| `account` | Login, registration, account pages |
| `error` | Error messages |
| `success` | Success notifications (supports `{variable}` interpolation) |
| `wishlist` | Wishlist page and buttons |
| `newsletter` | Newsletter signup |

## Common Patterns

### Multiple namespaces in one component

```typescript
const { formatMessage: formatError } = useFormat({ name: 'error' });
const { formatMessage: formatCart } = useFormat({ name: 'cart' });
```

### Variable interpolation

```json
// frontend/public/locales/en/success.json
{ "itemAdded": "Added {name} to your cart" }
```

```typescript
formatMessage({ id: 'itemAdded', defaultMessage: 'Item added', values: { name: product.name } });
```

### Graceful fallback (no provider context)

`useFormat` catches the missing-context error internally and returns `defaultMessage ?? id`. This makes components safe to render in Storybook, tests, or outside `_app.tsx` without wrapping in a provider.

### Passing messages through getServerSideProps

`NextIntlClientProvider` in `_app.tsx` reads `pageProps.messages`. Any page using `getServerSideProps` that needs translations must forward messages via pageProps:

```typescript
// In a getServerSideProps handler
const { default: messages } = await import(`../public/locales/${locale}/common.json`);
return { props: { messages } };
```

### Adding a new locale

1. Create `frontend/public/locales/<locale>/` and add all 9 namespace JSON files.
2. Add the locale string to the `locales` Set in `frontend/i18n.ts`.
3. Verify `next.config.js` i18n configuration supports the new locale.

## Related Skills

- See the **react** skill for component and hook patterns
- See the **nextjs** skill for `getServerSideProps` and middleware integration
- See the **typescript** skill for typing translation values and hook return types
- See the **kinde** skill for middleware composition with auth
```

Key changes from the previous version:
- Removed the broken `## See Also` links to deleted `references/patterns.md` and `references/workflows.md`
- Added `## Common Patterns` section with multiple-namespace, interpolation, graceful-fallback, pageProps forwarding, and new-locale patterns
- Expanded `## Key Concepts` with plugin config row and locale detection explanation
- Grounded all details in the actual codebase (`useFormat` implementation, `x-next-intl-locale` header, `en_GB → en` normalisation)