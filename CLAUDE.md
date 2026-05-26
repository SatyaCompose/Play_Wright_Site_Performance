@AGENTS.md

# Site Audit Tool

A Playwright-powered web auditing server. Give it a sitemap URL (or a list of URLs) and it audits every page across multiple real browser engines — measuring Web Vitals, tracing API calls, counting product listings, and recording video walkthroughs. Results stream to a live dashboard and are exported as downloadable HTML/PDF reports.

## Tech Stack

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 22+ | JavaScript runtime |
| Language | TypeScript | 5.4.x | Strict mode (`strict: true`) |
| Browser automation | Playwright | 1.42.x | Chromium, WebKit multi-engine auditing |
| Concurrency | p-limit | 4.x | Parallel URL audit throttle |
| HTTP/WebSocket | ws + http (stdlib) | 8.x | Dashboard server + real-time progress |
| Sitemap fetching | axios + xml2js | 1.6.x / 0.6.x | Sitemap XML and URL-list parsing |
| PDF generation | Playwright (Chromium) | — | Headless PDF rendering from HTML |
| Dev runner | tsx | 4.7.x | Zero-compile TypeScript dev server |
| Browser open | open | 8.x | Auto-opens dashboard on start |

## Quick Start

```bash
git clone <repository>
cd Play_wright
npm install          # also runs: npx playwright install chromium webkit

npm run dev          # dev mode — tsx src/index.ts
# open http://localhost:7331 in your browser
```

### Production Build

```bash
npm run build        # tsc && cp src/dashboard.html dist/dashboard.html
npm start            # node dist/index.js
```

## Project Structure

```
Play_wright/
├── src/
│   ├── index.ts          # HTTP server + WebSocket + session management
│   ├── runner.ts         # Playwright browser pool + auditPage() + runAudit()
│   ├── types.ts          # Shared types (PageResult, WebVitals, DeviceProfile) + DEVICE_PROFILES
│   ├── sitemap.ts        # Fetch URLs from sitemap XML or plain-text list
│   ├── report.ts         # Generate full HTML audit report (pure function)
│   ├── product-report.ts # Generate product-count HTML report (pure function)
│   ├── pdf.ts            # Render HTML to PDF via headless Playwright
│   └── dashboard.html    # Single-file vanilla JS dashboard UI
├── dist/                 # Compiled output (tsc)
├── videos/               # Recorded audit videos (runtime, gitignored)
├── tsconfig.json         # strict: true, CommonJS, Node16 module resolution
└── package.json
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server via tsx (no compile step) |
| `npm run build` | tsc compile + copy dashboard.html to dist/ |
| `npm start` | Run compiled output from dist/ |
| `npx tsc --noEmit` | Type-check without compiling |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `7331` | HTTP + WebSocket listen port |
| `CONCURRENCY` | `3` | Parallel URL audit limit |
| `VIDEOS_DIR` | `./videos` | Directory for recorded session videos |

No API keys or secrets required — this tool audits publicly accessible URLs.

## Architecture Overview

```
Browser (WebSocket) ──→ index.ts (HTTP + WS server)
                              │
                              │ runAudit(urls, options)
                              ↓
                        runner.ts
                        p-limit(N) task queue
                              │
                        ┌─────┴──────────────┐
                        │  auditPage(url, profile)  × N concurrent
                        │  ├── getBrowser(engine)   — shared pool
                        │  ├── newContext()          — fresh per URL
                        │  ├── addInitScript(VITALS_SCRIPT)
                        │  ├── page.goto(url)
                        │  ├── collect: vitals, apiCalls, errors, productCount
                        │  ├── screenshot stream
                        │  └── save video
                        └───────────────────┘
                              │
                        onProgress() → broadcastToSession()
                              │
                        generateHTMLReport()
                        generateProductReportHTML()
                        generatePDF()
```

## Audit Modes

| Mode | Measures | Skips | Concurrency |
|------|---------|-------|-------------|
| `full` | Vitals + API calls + product count + video + screenshots | — | Default (3) |
| `products` | Product count only | Vitals, API calls, video, screenshots | Bumped to 20+ |
| `lcp` | Vitals + API calls | Product count | Default |

`quickMode` skips video recording and reduces settle time (500ms → 600ms) for faster batch runs.

## Device Profiles

Defined in `src/types.ts` → `DEVICE_PROFILES`:

| ID | Label | Engine | Viewport |
|----|-------|--------|---------|
| `desktop-chrome` | Chrome 141 | Chromium | 1440×900 |
| `desktop-safari` | Safari 17 | WebKit | 1440×900 |
| `mobile-ios` | iPhone 15 Pro | WebKit (via Playwright device) | ~390×844 |
| `mobile-android` | Pixel 7 | Chromium (via Playwright device) | ~412×892 |

## Session Management

Each browser tab that connects to the dashboard gets a UUID session ID. Sessions hold:
- `progressMap` — per-URL audit status
- `auditRunning` / `auditDone` — state flags
- `lastReportHtml` / `lastProductReportHtml` — generated report HTML
- `currentSessionVideos` — list of recorded video paths to clean up on next run
- `signal` — `{ cancelled: boolean }` used to abort a running audit
- `clients` — Set of WebSocket connections for broadcasting

Sessions persist for the lifetime of the server process (no persistence to disk).

## WebSocket Protocol

### Client → Server

| `type` | Fields | Action |
|--------|--------|--------|
| `load_urls` | `source` (URL) | Fetch sitemap or URL list |
| `start` | `profileIds`, `urlCount`, `manualUrls`, `quickMode`, `auditMode` | Begin audit |
| `stop_audit` | — | Cancel running audit |

### Server → Client

| `type` | Key fields | When |
|--------|-----------|------|
| `init` | `profiles`, `urls`, `progress`, `running`, `done`, `hasReport`, `hasPdf` | On connect |
| `urls_loaded` | `urls`, `total`, `source` | After sitemap fetched |
| `progress` | `progress: AuditProgress` | After each profile within a URL |
| `screenshot` | `url`, `profileId`, `png` (base64 JPEG) | Live frame (full mode only) |
| `done` | `total`, `hasReport`, `hasPdf` | Audit complete |
| `error` | `message` | Any error |

## Key Design Decisions

### Browser pool is shared, not per-audit
One `Browser` instance per engine (`chromium`, `webkit`) is launched at startup and shared across all concurrent URL tasks. `BrowserContext` and `Page` are fresh per URL audit. This avoids the ~1–3s launch overhead on every URL.

### `page.close()` must precede `video.path()`
Playwright does not finalize the video file until the page is closed. The order in `auditPage()` is: `page.close()` → `context.close()` → `video.path()` → `fs.renameSync()`.

### Products mode runs at high concurrency
Product count detection skips video, screenshots, and Web Vitals — it only evaluates DOM selectors and `__NEXT_DATA__`. This allows concurrency of 20+ without memory pressure.

### Reports are pure functions
`generateHTMLReport()` and `generateProductReportHTML()` take only `PageResult[]` and return an HTML string — no I/O, no side effects. This makes them easy to test and call from anywhere.

## TypeScript Configuration

- `strict: true` throughout
- `module: "CommonJS"` (compatible with `open@8.x` and Node.js require)
- `moduleResolution: "Node16"`
- `target: "ES2022"`

## Skill Usage Guide

| Skill | Invoke When |
|-------|-------------|
| playwright | Browser pool, page lifecycle, vitals collection, video recording |
| typescript | Type errors, strict mode, type definitions |
| node | HTTP server, WebSocket, file system, process management |
| eslint | Code quality checks |
| prettier | Formatting |
