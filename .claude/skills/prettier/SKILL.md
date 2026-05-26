---
name: prettier
description: |
  Formats code with Prettier 3.x according to KWH project configuration.
  Use when: running or configuring Prettier formatting, fixing style violations, integrating
  Prettier with ESLint, writing scripts that format code, or investigating formatting failures
  in CI. All three packages (backend, frontend, types) share identical Prettier config.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Prettier Skill

Prettier 3.x enforces consistent formatting across the KWH monorepo. All three packages (backend, frontend, types) share identical config: `printWidth: 120`, `singleQuote: true`, `semi: true`, `trailingComma: 'all'`, `tabWidth: 2`. Prettier runs via ESLint integration (`eslint-config-prettier`) so ESLint is the single entry point for both linting and formatting in CI.

## Quick Start

### Format a single package

```bash
# Frontend (ESLint fix + Prettier combined)
cd frontend && npm run fix

# Backend
cd backend && npm run format
```

### Check formatting without writing

```bash
npx prettier --check "frontend/**/*.{ts,tsx,css,json}"
npx prettier --check "backend/**/*.ts"
```

## Key Concepts

| Concept | Value | Impact |
|---------|-------|--------|
| `printWidth` | `120` | Longer lines allowed — avoids over-wrapping |
| `singleQuote` | `true` | `'string'` not `"string"` |
| `trailingComma` | `'all'` | Trailing commas in function params (ES5+) |
| `semi` | `true` | Always use semicolons |
| `tabWidth` | `2` | Two-space indentation |

## Common Patterns

### Running format + lint together (frontend)

```bash
cd frontend && npm run fix
# Equivalent to: eslint --fix && prettier --write
```

### Checking before commit

```bash
npx prettier --check "**/*.{ts,tsx,json}" --ignore-path .gitignore
```

### Format specific file

```bash
npx prettier --write frontend/components/common/Button.tsx
```

## Related Skills

- See the **eslint** skill for ESLint + Prettier integration and rule configuration
- See the **typescript** skill for TypeScript-specific formatting considerations
- See the **node** skill for npm script setup and monorepo tooling
```

The only diff from the current file is the removal of the `## See Also` block (lines 68–71) that pointed to the now-deleted `references/patterns.md` and `references/workflows.md`. Please approve the edit so I can apply it.