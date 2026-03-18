# Site Audit Tool

A web-based site audit tool that measures Core Web Vitals and network performance across multiple browsers and devices using Playwright. It captures video recordings of page loads, intercepts API calls, and generates detailed HTML and PDF reports — all accessible through a real-time dashboard.

---

## Features

- **Multi-browser & multi-device**: Audit with Chrome, Safari (desktop), iPhone 15 Pro, and Pixel 7 profiles
- **Core Web Vitals**: Captures LCP, CLS, FCP, TTFB, and total load time per page per device
- **Network interception**: Tracks both SSR (server-rendered) and CSR (client-side) API calls with real HTTP status codes and Server-Timing headers
- **Video recording**: Records every page load and makes videos streamable from the dashboard
- **Live dashboard**: WebSocket-powered UI showing real-time audit progress and screenshots
- **Report generation**: Filterable HTML reports with per-device tabs plus optional PDF export
- **Sitemap support**: Loads URLs from `sitemap.xml`, sitemap index files, plain text lists, or manually entered URLs
- **Configurable concurrency**: Run multiple page audits in parallel

---

## Device Profiles

| Profile | Engine | Viewport | Emulates |
|---|---|---|---|
| Chrome 141 | Chromium | 1440×900 | Windows 10, Chrome 141 |
| Safari 17 | WebKit | 1440×900 (2× scale) | macOS Sonoma, Safari 17.5 |
| iPhone 15 Pro | WebKit | Playwright preset | iOS 17.5, Mobile Safari |
| Pixel 7 | Chromium | Playwright preset | Android 14, Chrome 141 |

---

## Metrics Captured

### Web Vitals

| Metric | Good Threshold |
|---|---|
| LCP (Largest Contentful Paint) | ≤ 2500 ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 |
| FCP (First Contentful Paint) | ≤ 1800 ms |
| TTFB (Time To First Byte) | ≤ 800 ms |
| Total Load Time | — |

### Network Data

- SSR API calls: `/api/`, `/graphql`, `/_next/data` endpoints via network interception
- CSR calls: client-side fetch/XHR captured via Resource Timing API
- Per-call: URL, HTTP status, duration, Server-Timing headers, initiator type

### Page Data

- Console errors and page errors
- HTTP response status of the page itself
- Video recording (MP4/WebM, streamable)

---

## Project Structure

```
src/
├── index.ts        # HTTP + WebSocket server, routing, report orchestration, graceful shutdown
├── runner.ts       # Core audit logic: browser pool, page auditing, vitals, video management
├── types.ts        # TypeScript interfaces and device profile definitions
├── sitemap.ts      # URL loading from sitemap.xml, sitemap index, text lists, or single URLs
├── report.ts       # HTML report generation with grading, tables, device tabs, video embeds
├── pdf.ts          # PDF report generation via Puppeteer
└── dashboard.html  # Interactive frontend UI (served at /)
```

---

## API / Routes

### HTTP

| Route | Description |
|---|---|
| `GET /` or `/dashboard` | Interactive dashboard UI |
| `GET /report` | View generated HTML report |
| `GET /report.html` | Download HTML report |
| `GET /report.pdf` | Download PDF report |
| `GET /videos/<filename>` | Stream a recorded video (supports HTTP Range) |
| `GET /videos/<filename>?download=1` | Download a recorded video |

### WebSocket Messages

| Message | Direction | Description |
|---|---|---|
| `load_urls` | Client → Server | Load URLs from a sitemap or text source |
| `urls_loaded` | Server → Client | Broadcast the loaded URL list |
| `start` | Client → Server | Begin audit with chosen profiles and URLs |
| `progress` | Server → Client | Per-URL progress updates |
| `screenshot` | Server → Client | Live JPEG screenshot during page load |
| `done` | Server → Client | Audit complete |
| `error` | Server → Client | Error notification |

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

This also runs `playwright install` via the `postinstall` script to download Chromium and WebKit browsers.

### Development

```bash
npm run dev
```

Starts the server with `tsx` (hot reload) and opens `http://localhost:7331` in your browser.

### Production Build

```bash
npm run build
npm start
```

Compiles TypeScript to `dist/` and starts the compiled server.

### Command-line Arguments

```bash
npm start [concurrency] [port]
# e.g. npm start 5 8080
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7331` | HTTP server port |
| `CONCURRENCY` | `3` | Number of parallel page audits |
| `VIDEOS_DIR` | `/app/videos` | Directory for video recordings |
| `NODE_ENV` | `production` | Runtime environment |

---

## Docker

### Build

```bash
docker build -t site-audit .
```

### Run

```bash
docker run -p 7331:7331 -v $(pwd)/videos:/app/videos site-audit
```

### How the image is built

The image uses a two-stage build:

1. **Builder** (`node:20-slim`): Installs dependencies, compiles TypeScript, copies `dashboard.html` to `dist/`
2. **Runner** (`node:20-slim`): Installs system fonts and curl, runs `playwright install --with-deps chromium webkit` to pull in all OS-level browser dependencies automatically, then starts the compiled server

A healthcheck polls `GET /` every 30 seconds (starts checking after 20 s, 10 s timeout, 3 retries).

---

## Deployment (Railway)

A `Railway.toml` is included with:

- **Builder**: Dockerfile
- **Start command**: `node dist/index.js`
- **Restart policy**: ON_FAILURE (max 3 retries)
- **Healthcheck**: `GET /` with 30 s timeout

---

## Dependencies

### Production

| Package | Purpose |
|---|---|
| `playwright` | Browser automation (Chromium, WebKit, Firefox) |
| `puppeteer` | PDF generation from HTML |
| `ws` | WebSocket server for live dashboard |
| `axios` | HTTP client for fetching sitemaps |
| `xml2js` | XML parsing for sitemap files |
| `p-limit` | Concurrency control for parallel audits |
| `open` | Opens the dashboard in the default browser on startup |

### Dev

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `tsx` | TypeScript execution / hot reload |
| `@types/node`, `@types/ws`, `@types/xml2js` | Type definitions |

---

## How It Works

1. Open the dashboard at `http://localhost:7331`
2. Enter a sitemap URL or paste a list of URLs, then click **Load URLs**
3. Select which device profiles to audit and how many URLs to include
4. Click **Start Audit** — progress, live screenshots, and per-URL status appear in real time
5. When complete, click **View Report** to see the HTML report with per-device tabs, color-coded grades, API call tables, and embedded video players
6. Optionally download the report as HTML or PDF

### Page Loading Strategy

- Primary: waits for `networkidle` (500 ms of network inactivity)
- Fallback: falls back to the `load` event if networkidle times out
- Post-load settlement: 4000 ms for WebKit, 2500 ms for Chromium (allows CSR hydration before capturing metrics)

### Video Recording

- Playwright records each page load as MP4/WebM
- Videos are renamed to `<url-slug>-<profile-id>.<ext>` after the page closes
- Previous session videos are cleared before each new audit run
- Videos are streamed from `/videos/<filename>` with HTTP Range support for mobile compatibility
