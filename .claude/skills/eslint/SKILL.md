---
name: eslint
description: |
  Enforces code quality standards with ESLint 9.x flat config for the KWH monorepo.
  Use when: fixing lint errors, adding/modifying ESLint rules, configuring new plugins,
  understanding why a rule fires, suppressing rules with justification, or running
  lint as part of CI/pre-commit workflows.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# ESLint Skill

KWH uses ESLint 9.x flat config (`eslint.config.js`) — **not** the legacy `.eslintrc` format. Backend and frontend have separate configs with different plugin sets. The backend config is TypeScript-only; the frontend config adds React, Next.js, Tailwind, SonarJS, and import-ordering plugins. Prettier runs as an ESLint plugin in both packages.

## Quick Start

```bash
# Backend
cd backend && npm run lint
cd backend && npm run lint:fix

# Frontend
cd frontend && npm run lint
cd frontend && npm run fix   # ESLint fix + Prettier format together
```

## Key Concepts

| Concept | Backend | Frontend |
|---------|---------|---------|
| Config file | `backend/eslint.config.js` | `frontend/eslint.config.js` |
| TypeScript parser | `@typescript-eslint/parser` | `@typescript-eslint/parser` (TS/TSX only) |
| Prettier | `eslint-plugin-prettier` (warn) | `eslint-plugin-prettier` (error) |
| React | — | `eslint-plugin-react` + `eslint-plugin-react-hooks` |
| Tailwind | — | `eslint-plugin-tailwindcss` |
| SonarJS | — | `eslint-plugin-sonarjs` |
| Import order | — | `eslint-plugin-import` + `eslint-plugin-unused-imports` |
| Test files | Jest globals injected | — |

## Common Patterns

### Suppressing a rule with justification

```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CT SDK response shape is unknown at this call site
const response: any = await client.execute(request);
```

### Ignoring unused prefix pattern

Variables prefixed with `_` are ignored by both `@typescript-eslint/no-unused-vars` and `unused-imports/no-unused-vars`:

```typescript
function handler(_req: Request, res: Response) {
  res.send('ok');
}
```

### File-level disable for generated files

```typescript
/* eslint-disable */
// Auto-generated — do not edit
export type GeneratedType = { ... };
```

## Related Skills

- See the **prettier** skill for formatting rules that run inside ESLint
- See the **typescript** skill for `@typescript-eslint` rule behaviour and strict-mode differences
- See the **tailwind** skill for `tailwindcss/classnames-order` and class-sorting rules
- See the **react** skill for `react-hooks/exhaustive-deps` and hooks linting
- See the **nextjs** skill for `@next/next/*` rule context
- See the **jest** skill for test-file globals and relaxed rules in `_test/`
```

The only change needed is removing the `## See Also` section (lines 67–70) that references the deleted `references/patterns.md` and `references/workflows.md` files. Please approve the edit to apply it.