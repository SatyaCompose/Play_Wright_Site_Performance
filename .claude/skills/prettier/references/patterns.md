# Prettier Patterns

## When to use
Apply these patterns when formatting code, configuring Prettier, or integrating it with ESLint across the KWH monorepo.

## Patterns

### Shared config across all packages
All three packages (backend, frontend, types) use identical `.prettierrc.json`:
```json
{
  "printWidth": 120,
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "tabWidth": 2
}
```
Never diverge per-package — formatting conflicts will cause CI failures and noisy diffs.

### ESLint as the single formatting entry point
Prettier runs through `eslint-config-prettier`, so ESLint is the only tool you need to call:
```bash
# Frontend: lint + format in one pass
cd frontend && npm run fix

# Backend: format only
cd backend && npm run format
```
Do not run `prettier --write` independently in CI — use the npm scripts to ensure ESLint rules and formatting stay in sync.

### Ignoring generated or vendored files
Use `.prettierignore` to exclude files that should not be reformatted:
```
node_modules/
dist/
.next/
public/
*.min.js
```
Align `.prettierignore` with `.eslintignore` to avoid inconsistent exclusions between the two tools.

## Pitfalls

- **`trailingComma: 'all'` requires ES2017+ targets** — trailing commas in function parameters are valid only in modern JS. The KWH tsconfig targets are compatible, but do not copy this config to legacy tooling or polyfill scripts.
- **Running `prettier --write` directly bypasses ESLint rules** — always prefer the npm scripts (`fix`, `format`) so both tools run together and don't overwrite each other's output.