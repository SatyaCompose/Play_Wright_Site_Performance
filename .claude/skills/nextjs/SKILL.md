---
name: nextjs
description: Configures Next.js 16.x SSR, Pages Router, API routes, and performance optimization for the KWH e-commerce frontend
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Nextjs Skill

This skill guides Next.js 16.x development for the Kitchen Warehouse frontend, a server-rendered e-commerce app using the Pages Router (not App Router), React 19, and Tailwind CSS 4.x. The frontend lives in `frontend/` and integrates with Frontastic backend extensions via action dispatchers.

## Quick Start

```bash
cd frontend
npm run dev          # Next.js dev server + TSC watch in parallel
npm run build        # Production build (next build --webpack)
npm run ts           # Type-check without output
npm run lint         # ESLint check
npm run fix          # ESLint fix + Prettier format
npm run build:analyze  # Bundle size analysis
```

## Key Concepts

### Pages Router (Not App Router)
All routes live in `frontend/pages/`. The catch-all `[[...slug]].tsx` handles CMS-driven pages via Frontastic. Use `getServerSideProps` for SSR data fetching.

```typescript
// pages/[[...slug]].tsx pattern
export const getServerSideProps: GetServerSideProps = async (context) => {
  // fetch page data from Frontastic
  return { props: { data } };
};
```

### File Locations
- Pages: `frontend/pages/` — Next.js routing conventions
- API routes: `frontend/pages/api/` — serverless handlers
- Components: `frontend/components/common/` (reusable) and `frontend/components/frontastic-ui/` (feature-specific)
- Frontastic integration: `frontend/frontastic/actions/` (dispatchers), `frontend/frontastic/provider/` (context), `frontend/frontastic/tastics/` (CMS registry)

### TypeScript Configuration
Frontend uses `strict: false` in `tsconfig.json` for flexibility. Path aliases available: `@Types/*` and `frontastic/*`.

### next.config.js
Webpack is explicitly invoked (`next build --webpack`). i18n plugin is configured here alongside image domains, rewrites, and environment variable exposure.

## Common Patterns

### Server-Side Props with Error Handling
```typescript
export const getServerSideProps: GetServerSideProps = async ({ locale, params }) => {
  try {
    const data = await fetchPageData(params?.slug);
    return { props: { data, locale } };
  } catch {
    return { notFound: true };
  }
};
```

### API Route Handler
```typescript
// pages/api/example.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  // handle request
  res.status(200).json({ ok: true });
}
```

### Custom `_app.tsx` Provider Wrapping
Providers are layered in `_app.tsx`: Kinde auth, next-intl, Frontastic state, and global error boundary. Add new providers here, wrapping from outermost (auth) to innermost (feature state).

### Custom `_document.tsx`
Used for injecting fonts, GTM script tags, and Datadog RUM initialization. Avoid client-only code here — it runs server-side only.

### Dynamic Component Registry (Tastics)
CMS-driven components are registered in `frontend/frontastic/tastics/`. Each tastic maps a CMS component name to a React component.

```typescript
// frontastic/tastics/index.ts
import ProductDetail from 'components/frontastic-ui/ProductDetail';
export const tastics = {
  'kwh/product/detail': ProductDetail,
};
```

### Image Optimization
Use `next/image` with explicit `width`, `height`, or `fill` prop. Configure allowed external domains in `next.config.js` under `images.domains` or `images.remotePatterns`.

### Environment Variables
- `NEXT_PUBLIC_*` — exposed to the browser; safe for API keys that are public (Algolia search key, GTM ID)
- Non-prefixed — server-only; never expose secrets client-side
- Defined in `frontend/.env.local` (copy from `.env.dist`)

### Performance: Parallel Data Fetching in `getServerSideProps`
```typescript
const [products, categories] = await Promise.all([
  fetchProducts(query),
  fetchCategories(),
]);
```

### Bundle Analysis
```bash
cd frontend && npm run build:analyze
```
Opens a visual bundle report. Target: eliminate large client-side dependencies from SSR-only paths.