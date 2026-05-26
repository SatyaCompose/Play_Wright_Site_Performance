# Playwright

Playwright is the browser automation library used by this project to drive Chromium, WebKit, and Firefox for site auditing, Web Vitals collection, video recording, and PDF generation.

## How This Project Uses Playwright

```
src/runner.ts  — browser pool, BrowserContext per URL, auditPage()
src/pdf.ts     — headless Chromium for PDF generation
```

## Browser Pool Pattern

One shared `Browser` per engine, launched once and reused across all sessions:

```typescript
import { chromium, webkit, firefox, type BrowserType } from "playwright";

const browserPool = new Map<string, Browser>();
const browserPending = new Map<string, Promise<Browser>>();

async function getBrowser(engineName: "chromium" | "webkit" | "firefox"): Promise<Browser> {
  if (browserPool.has(engineName)) return browserPool.get(engineName)!;
  if (browserPending.has(engineName)) return browserPending.get(engineName)!;

  const engines: Record<string, BrowserType> = { chromium, webkit, firefox };
  const launch = engines[engineName].launch({ args: ["--no-sandbox"] })
    .then((browser) => { browserPool.set(engineName, browser); browserPending.delete(engineName); return browser; })
    .catch((err) => { browserPending.delete(engineName); throw err; });

  browserPending.set(engineName, launch);
  return launch;
}
```

**Key invariant:** Never call `browser.close()` per audit — only close `BrowserContext` and `Page`.

## BrowserContext & Page Lifecycle

```typescript
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: "...",
  recordVideo: { dir: "./videos", size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

try {
  // ... audit the page
} finally {
  await page.close();    // MUST be before video.path()
  await context.close(); // releases video buffer
}
```

## Device Profiles

Use `devices` from Playwright for named device presets:

```typescript
import { devices } from "playwright";

const descriptor = devices["iPhone 15 Pro"];
// descriptor includes: viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, defaultBrowserType
```

Strip `defaultBrowserType` before passing to `newContext()`:
```typescript
const { defaultBrowserType, ...contextOpts } = descriptor;
await browser.newContext(contextOpts);
```

## Web Vitals Collection

Inject the observer script before navigation using `addInitScript`:

```typescript
await page.addInitScript(`
  window.__auditVitals = { lcp: 0, cls: 0, fcp: 0 };
  new PerformanceObserver((list) => {
    const last = list.getEntries().at(-1);
    if (last) window.__auditVitals.lcp = last.startTime;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
`);

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500); // settle

const vitals = await page.evaluate(() => (window as any).__auditVitals);
```

**Critical:** `addInitScript` must be called before `page.goto()` — scripts injected after navigation won't observe pre-hydration events.

## Network Interception

```typescript
const apiCalls: ApiCall[] = [];
const reqStart = new Map<string, number>();

page.on("request", (req) => reqStart.set(req.url(), Date.now()));

page.on("response", async (res) => {
  const duration = Date.now() - (reqStart.get(res.url()) ?? Date.now());
  const serverTiming = res.headers()["server-timing"];
  if (res.request().resourceType() === "fetch") {
    apiCalls.push({ url: res.url(), status: res.status(), duration, serverTiming });
  }
});
```

## Screenshots

```typescript
// Streaming (lower quality for live preview)
const buf = await page.screenshot({ type: "jpeg", quality: 65 });
const base64 = buf.toString("base64");

// Final frame (higher quality)
const buf = await page.screenshot({ type: "jpeg", quality: 85 });
```

## Video Recording

```typescript
// Enable in newContext options
const context = await browser.newContext({
  recordVideo: { dir: "./videos", size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

// After audit — MUST close page before calling video.path()
await page.close();
await context.close();

const video = page.video();
if (video) {
  const rawPath = await video.path(); // only available after page.close()
  fs.renameSync(rawPath, path.join("./videos", "my-video.webm"));
}
```

## Page Evaluation

```typescript
// Run JS in the page context and get a typed result
const count = await page.evaluate((): number => {
  return document.querySelectorAll("[data-product-id]").length;
});

// Inject into page before navigation
await page.addInitScript(() => {
  window.__myFlag = true;
});
```

## Navigation & Load States

```typescript
await page.goto(url, { waitUntil: "load", timeout: 60000 });

// Wait for no network activity (can time out on SPAs — catch it)
await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

// Fixed settle time for observer accumulation
await page.waitForTimeout(2500);
```

## Console & Error Capture

```typescript
const errors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(`[PageError] ${err.message}`));
```

## PDF Generation

```typescript
import { chromium } from "playwright";
import * as path from "path";

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
const page = await browser.newPage();

const tmpPath = path.resolve("./report_tmp.html");
fs.writeFileSync(tmpPath, html, "utf-8");
await page.goto(`file://${tmpPath}`, { waitUntil: "networkidle" });

await page.pdf({
  path: "report.pdf",
  format: "A4",
  landscape: true,
  printBackground: true,
});

await browser.close();
fs.unlinkSync(tmpPath); // cleanup temp file
```

## Engine Selection

| Engine | Use case | Notes |
|--------|---------|-------|
| `chromium` | Chrome/Edge simulation | Fastest launch; used for PDFs |
| `webkit` | Safari simulation | Slower launch; needs longer settle time (4000ms) |
| `firefox` | Firefox simulation | Not installed by default in this project |

## Install & Verify

```bash
npx playwright install chromium webkit
npx playwright install --dry-run  # verify what's installed
```

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| LCP always 0 | `addInitScript` called after `goto` | Move before `goto` |
| Video file not found | `video.path()` called before `page.close()` | Close page first |
| "Browser closed" mid-audit | Shared `Browser` incorrectly closed | Only close `BrowserContext` |
| `networkidle` never resolves | SPAs with polling | Wrap in `.catch(() => {})` |
| Device profile wrong engine | `defaultBrowserType` not stripped | Strip from descriptor before `newContext` |
