---
name: node
description: Configures Node.js runtime, npm packages, and build processes for the KWH monorepo backend and frontend.
allowed-tools: Read, Edit, Write, Glob, Grep, Bash
---

# Node Skill

Manages Node.js 22+ runtime configuration, dependency management, and build tooling across the KWH monorepo. The backend uses tsup for compiling Frontastic extensions to `dist/`, while the frontend uses Next.js webpack builds. Both packages maintain independent `package.json` files under `backend/` and `frontend/`.

## Quick Start

```bash
# Install all dependencies from kwh/ root
npm install

# Backend: watch and compile extensions
cd backend && npm run extensions:watch

# Frontend: dev server with concurrent TSC
cd frontend && npm run dev

# Backend production build
cd backend && npm run build

# Frontend production build
cd frontend && npm run build
```

## Key Concepts

- **Runtime:** Node.js 22+ required for both backend and frontend
- **Workspaces:** `backend/` and `frontend/` are independent packages — run commands from their respective directories
- **Backend build:** tsup compiles TypeScript action controllers to `dist/`; entry point is `backend/index.ts`
- **Frontend build:** `next build --webpack` (not turbopack); output in `.next/`
- **TypeScript:** Backend uses `strict: true`; frontend uses `strict: false`
- **Environment vars:** Copy `.env.dist` → `.env.local` in each package before running

## Common Patterns

**Adding a backend dependency:**
```bash
cd backend && npm install <package>
```

**Adding a frontend dependency:**
```bash
cd frontend && npm install <package>
```

**Checking types without output:**
```bash
# Backend
cd backend && npm run ts-compile

# Frontend
cd frontend && npm run ts
```

**Running backend tests:**
```bash
cd backend && npm test
cd backend && npm test -- --watch
```

**Analyzing frontend bundle size:**
```bash
cd frontend && npm run build:analyze
```

**Key scripts by package:**

| Script | Package | Purpose |
|--------|---------|---------|
| `extensions:watch` | backend | tsup watch mode for Frontastic extensions |
| `build` | backend | Production tsup compile |
| `ts-compile` | backend | Type-check only, no output |
| `lint:fix` | backend | Auto-fix ESLint issues |
| `format` | backend | Prettier format all `.ts` files |
| `dev` | frontend | Next.js dev + TSC watch concurrently |
| `build` | frontend | `next build --webpack` for production |
| `fix` | frontend | ESLint fix + Prettier format |
| `ts` | frontend | Single TypeScript check |
| `build:analyze` | frontend | Bundle analysis via next/bundle-analyzer |