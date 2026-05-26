# Prettier Workflows

## When to use
Follow these workflows when formatting code before committing, fixing CI format failures, or setting up Prettier in a new file or feature area.

## Workflows

### Pre-commit formatting check
Run a check without writing changes to verify the working tree is clean:
```bash
# Check entire frontend
npx prettier --check "frontend/**/*.{ts,tsx,css,json}"

# Check entire backend
npx prettier --check "backend/**/*.ts"
```
If the check fails, run the corresponding fix script to auto-correct and re-stage.

### Fixing a CI format failure
1. Identify which files failed from the CI output.
2. Run the scoped fix script for that package:
   ```bash
   cd frontend && npm run fix      # ESLint fix + Prettier
   cd backend && npm run format    # Prettier only
   ```
3. Review the diff — Prettier changes should be whitespace/quote/comma only. Any logic change is a sign of a misconfigured rule.
4. Commit the formatted files as a standalone commit (e.g. `style: apply prettier formatting`).

### Formatting a single file during development
```bash
npx prettier --write frontend/components/frontastic-ui/KWHCart/CartItem.tsx
```
Use this for quick targeted fixes without reformatting the whole package.

## Pitfalls

- **Do not mix `npm run fix` and manual `prettier --write` in the same pass** — running both can cause ESLint to re-flag lines that Prettier already changed, producing a loop. Pick one entry point per session.
- **Formatting commits should be isolated** — mixing logic changes with Prettier reformats makes code review harder and obscures intent in `git blame`. If a file needs both, do the logic change first, then format in a follow-up commit.