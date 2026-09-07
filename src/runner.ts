import {
  chromium,
  webkit,
  firefox,
  devices,
  type Browser,
  type BrowserContext,
  type Page,
  type BrowserType,
} from "playwright";
import pLimit from "p-limit";
import * as fs from "fs";
import * as path from "path";
import type {
  PageResult,
  ApiCall,
  WebVitals,
  AuditProgress,
  DeviceProfile,
  PdpDataCheck,
  StrapiCheck,
} from "./types";
import { DEVICE_PROFILES } from "./types";

const VITALS_SCRIPT = `
  window.__auditVitals = { lcp: 0, cls: 0, fcp: 0 };
  try {
    new PerformanceObserver((list) => {
      const e = list.getEntries(); const last = e[e.length-1];
      if (last) window.__auditVitals.lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch(e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (!e.hadRecentInput) window.__auditVitals.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch(e) {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.name === 'first-contentful-paint') window.__auditVitals.fcp = e.startTime;
    }).observe({ type: 'paint', buffered: true });
  } catch(e) {}
`;

let shuttingDown = false;
// index.ts owns the process exit — runner just needs to know to stop
// launching new pages. Do NOT call process.exit() here; that's index.ts's job.
process.on("SIGINT", () => { shuttingDown = true; });
process.on("SIGTERM", () => { shuttingDown = true; });

// ── Browser pool: one instance per engine, shared across all sessions ─────
// Under sustained load (thousands of contexts on one browser) Chromium can
// crash. If we don't detect the disconnect, callers get a dead reference and
// browser.newContext() hangs forever — occupying pLimit slots indefinitely
// and stalling the run. We watch 'disconnected' and also isConnected() before
// handing back a cached browser.
const browserPool = new Map<string, Browser>();
const browserPending = new Map<string, Promise<Browser>>();

async function getBrowser(
  engineName: "chromium" | "webkit" | "firefox"
): Promise<Browser> {
  const cached = browserPool.get(engineName);
  if (cached && cached.isConnected()) return cached;
  if (cached && !cached.isConnected()) {
    console.warn(`  ⚠ ${engineName} browser is disconnected — relaunching`);
    browserPool.delete(engineName);
  }
  if (browserPending.has(engineName)) return browserPending.get(engineName)!;

  const engines: Record<string, BrowserType> = { chromium, webkit, firefox };
  const launch = engines[engineName]
    .launch({
      args:
        engineName === "chromium"
          ? ["--no-sandbox", "--disable-setuid-sandbox"]
          : [],
    })
    .then((browser) => {
      browser.on("disconnected", () => {
        // Clear the cached reference so the next getBrowser() relaunches.
        if (browserPool.get(engineName) === browser) {
          console.warn(`  ⚠ ${engineName} disconnected — will relaunch on next request`);
          browserPool.delete(engineName);
        }
      });
      browserPool.set(engineName, browser);
      browserPending.delete(engineName);
      return browser;
    })
    .catch((err) => {
      browserPending.delete(engineName);
      throw err;
    });

  browserPending.set(engineName, launch);
  return launch;
}

export async function closeAllBrowsers() {
  for (const [, browser] of browserPool) {
    try { await browser.close(); } catch {}
  }
  browserPool.clear();
}

// ── Active-run counter (shared browser pool ref count) ────────────────────
// Every runAudit call increments this on entry and decrements in a finally.
// closeAllBrowsers-on-teardown only fires when the count returns to zero —
// otherwise a session finishing its audit would rip the browser out from
// under another session that's still running (retest, or a parallel tab).
let activeAudits = 0;

// ── Resolve which engine a profile needs ─────────────────────────────────
function engineForProfile(
  profile: DeviceProfile
): "chromium" | "webkit" | "firefox" {
  if (profile.playwrightDevice) {
    const d = devices[profile.playwrightDevice];
    const bt = d?.defaultBrowserType ?? "chromium";
    if (bt === "webkit") return "webkit";
    if (bt === "firefox") return "firefox";
    return "chromium";
  }
  return profile.engine ?? "chromium";
}

// ── Console-error noise filter ────────────────────────────────────────────
// Errors that are always downstream of a WAF bot-challenge or third-party
// analytics failure — nothing the site owner can fix, and adding them to
// the report just buries real errors. Matches by substring against the
// captured console message. Update sparingly; conservative by default.
const NOISE_PATTERNS: readonly string[] = [
  "/qxm9/",                                    // Cloudflare Bot Management challenge script
  "cloudflareinsights.com",                    // CF Web Analytics beacon (blocked by CORS on some sessions)
  "challenges.cloudflare.com",                 // CF Turnstile widget assets
  "dcinfos-cache.abtasty.com",                 // AB Tasty geo/UA lookups (frequently CORS-blocked)
  "api-data-connector.abtasty.com",            // AB Tasty audience sync
  "segment.api.useinsider.com",                // Insider segments API (CORS-flaky)
  "falcon.useinsider.com",                     // Insider tracking
  "cdn.builder.io/api/v1/track",               // Builder.io telemetry
];
function isNoiseError(msg: string): boolean {
  for (const p of NOISE_PATTERNS) {
    if (msg.includes(p)) return true;
  }
  return false;
}

// ── WAF-friendly HTTP headers ─────────────────────────────────────────────
// Cloudflare fingerprints requests missing the sec-ch-ua client-hint family.
// Chromium sends these automatically, BUT only when the UA is left as
// Playwright's default. Overriding userAgent (which we do to pin Chrome/141)
// suppresses the auto-hints — so the request looks like "Chrome without
// hints", which the WAF flags via its accept-ch response header.
//
// Only include headers that are TRULY constant per browser context.
// extraHTTPHeaders is applied to EVERY request (navigation, subresources,
// cross-origin fetches, CORS preflights). Headers like
// `upgrade-insecure-requests`, `sec-fetch-dest/mode/user`, and `Accept`
// legitimately vary per request — hardcoding them broke CORS preflight for
// third-party services (abtasty, cloudflareinsights, Frontastic, Builder)
// because "upgrade-insecure-requests" was rejected as a disallowed request
// header.
//
// The four kept here are low-entropy client hints; real Chrome sends the
// same values on every request from the same UA/context, so echoing them
// on CORS preflights is safe.
const CHROME_141_CLIENT_HINTS = {
  "Accept-Language": "en-AU,en;q=0.9",
  "sec-ch-ua": '"Google Chrome";v="141", "Chromium";v="141", "Not?A_Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

// ── Build Playwright newContext() options for a profile ───────────────────
function contextOptions(profile: DeviceProfile, videosDir: string, quickMode = false) {
  // Start from Playwright device descriptor if specified
  const deviceDesc = profile.playwrightDevice
    ? { ...devices[profile.playwrightDevice] }
    : {};

  // Remove non-context keys from device descriptor
  const { defaultBrowserType, ...cleanDesc } = deviceDesc as any;

  const merged = {
    ...cleanDesc,
    // Explicit overrides in the profile win
    ...(profile.viewport ? { viewport: profile.viewport } : {}),
    ...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
    ...(profile.isMobile !== undefined ? { isMobile: profile.isMobile } : {}),
    ...(profile.hasTouch !== undefined ? { hasTouch: profile.hasTouch } : {}),
    ...(profile.deviceScaleFactor !== undefined
      ? { deviceScaleFactor: profile.deviceScaleFactor }
      : {}),
  };

  const viewport = merged.viewport ?? { width: 1440, height: 900 };

  // Any Chromium context that overrides userAgent to Chrome needs explicit
  // client hints — the UA override suppresses Playwright's auto-generated
  // sec-ch-ua headers, and Cloudflare/similar WAFs flag "Chrome UA without
  // matching hints" as suspicious. This applies to every audit mode that
  // uses a Chrome-UA profile: products, full, lcp, pdp-data, strapi.
  const overriddenUa: string | undefined = merged.userAgent;
  const engine = engineForProfile(profile);
  const needsChromeHints =
    engine === "chromium" &&
    typeof overriddenUa === "string" &&
    /Chrome\/\d+/.test(overriddenUa);

  return {
    ...merged,
    ...(needsChromeHints ? { extraHTTPHeaders: CHROME_141_CLIENT_HINTS } : {}),
    ...(quickMode ? {} : {
      recordVideo: {
        dir: videosDir,
        size: { width: viewport.width, height: viewport.height },
      },
    }),
  };
}

// ── Screenshot loop ───────────────────────────────────────────────────────
function startScreenshotStream(
  page: Page,
  intervalMs: number,
  onFrame: (png: string) => void
): () => void {
  let active = true;
  (async () => {
    while (active) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (!active) break;
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 65 });
        if (active) onFrame(buf.toString("base64"));
      } catch {
        break;
      }
    }
  })();
  return () => {
    active = false;
  };
}

// ── Audit a single URL × profile ─────────────────────────────────────────
async function auditPage(
  url: string,
  profile: DeviceProfile,
  videosDir: string,
  onScreenshot?: (profileId: string, png: string) => void,
  quickMode = false,
  auditMode: "full" | "products" | "lcp" | "pdp-data" | "strapi" = "full",
  pdpChecks: string[] = []
): Promise<PageResult> {
  const isProductsMode = auditMode === "products";
  const isLcpMode = auditMode === "lcp";
  const isPdpDataMode = auditMode === "pdp-data";
  const isStrapiMode = auditMode === "strapi";
  // SSR-only modes (pdp-data, strapi) share the same fast path — parse
  // __NEXT_DATA__ from the initial HTML, no vitals/video/screenshots.
  const isSsrOnlyMode = isPdpDataMode || isStrapiMode;
  // Products & SSR-only modes imply quick scan (no video / screenshots / vitals)
  const effectiveQuick = quickMode || isProductsMode || isSsrOnlyMode;

  const engine = engineForProfile(profile);
  const browser = await getBrowser(engine);
  let context: BrowserContext | null = null;

  try {
    // contextOptions auto-adds Chrome client hints for any Chromium+Chrome-UA
    // profile — the WAF blocks "Chrome UA without matching sec-ch-ua" regardless
    // of audit mode, so this covers products / full / lcp / pdp-data / strapi.
    context = await browser.newContext(
      contextOptions(profile, videosDir, effectiveQuick)
    );
    const page = await context.newPage();

    // ── SSR-only speed boost: block heavy non-executable subresources ──
    // We only need the initial HTML doc + inline __NEXT_DATA__ parsed, but
    // blocking scripts made Cloudflare escalate its bot challenge (a real
    // browser fetches scripts even if we don't wait for them). So block
    // only the heavy passive assets — images, media, fonts, stylesheets —
    // and let scripts request normally. The page still finishes fast
    // because we return at DOMContentLoaded without waiting for JS to run.
    if (isSsrOnlyMode) {
      await context.route("**/*", (route) => {
        const t = route.request().resourceType();
        if (t === "image" || t === "media" || t === "font" || t === "stylesheet") {
          return route.abort();
        }
        return route.continue();
      });
    }

    let stopScreenshots: (() => void) | null = null;
    if (onScreenshot && !effectiveQuick) {
      stopScreenshots = startScreenshotStream(page, 800, (png) =>
        onScreenshot(profile.id, png)
      );
    }

    // ── Network interception (skipped in products mode) ───────────────
    const ssrApiCalls: ApiCall[] = [];
    const reqStart = new Map<string, number>();
    const networkIndex = new Map<
      string,
      { status: number; serverTiming?: string; duration: number }
    >();

    if (!isProductsMode && !isSsrOnlyMode) {
      page.on("request", (req) => reqStart.set(req.url(), Date.now()));

      page.on("response", async (res) => {
        const resUrl = res.url();
        const duration = Date.now() - (reqStart.get(resUrl) ?? Date.now());

        let serverTiming: string | undefined;
        try {
          serverTiming = res.headers()["server-timing"] ?? undefined;
        } catch {}

        const reqType = res.request().resourceType();
        if (reqType === "fetch" || reqType === "xhr") {
          networkIndex.set(resUrl, { status: res.status(), serverTiming, duration });
        }

        if (
          resUrl.includes("/api/") ||
          resUrl.includes("/graphql") ||
          resUrl.includes("/_next/data")
        ) {
          ssrApiCalls.push({
            url: resUrl,
            status: res.status(),
            duration,
            type: "ssr",
            serverTiming,
          });
        }
      });
    }

    const errors: string[] = [];
    // Skip console/pageerror capture in SSR-only modes. Aborting every
    // non-document request generates a wall of "Failed to load resource:
    // net::ERR_FAILED" console errors that are purely our own doing — not
    // real page errors — and the pdp-data / strapi reports don't use the
    // errors[] array anyway.
    if (!isSsrOnlyMode) {
      page.on("console", (msg) => {
        if (msg.type() === "error" && !isNoiseError(msg.text())) {
          errors.push(msg.text());
        }
      });
      page.on("pageerror", (err) => {
        const msg = `[PageError] ${err.message}`;
        if (!isNoiseError(msg)) errors.push(msg);
      });
    }

    // Vitals script only needed when measuring LCP/CLS/FCP
    if (!isProductsMode && !isSsrOnlyMode) {
      await page.addInitScript(VITALS_SCRIPT);
    }

    // SSR-only modes need just the initial HTML — DOMContentLoaded is enough.
    // Other modes still wait for full load to measure vitals / capture video.
    const gotoWait = isSsrOnlyMode ? "domcontentloaded" : "load";
    const gotoTimeout = isSsrOnlyMode ? 30000 : 60000;
    let response = await page.goto(url, { waitUntil: gotoWait, timeout: gotoTimeout });
    if (!response) throw new Error("No response received");

    // WAF-aware retry: KWH production's Cloudflare rules rate-limit bursts
    // of parallel requests from the same IP with a 403 (bot block) or 503
    // (challenge). Most clear within a couple of seconds; the odd stubborn
    // one needs a second attempt with a longer backoff (observed: a
    // one-in-a-hundred PDP still 403s after 3s, passes after 7s).
    // Backoff schedule (ms, jittered ±1s): 3000, 6000.
    if (isSsrOnlyMode) {
      const RETRY_BACKOFFS = [3000, 6000];
      for (const base of RETRY_BACKOFFS) {
        const s = response.status();
        if (s !== 403 && s !== 503) break;
        await page.waitForTimeout(base + Math.floor(Math.random() * 1000));
        try {
          const retryRes = await page.goto(url, { waitUntil: gotoWait, timeout: gotoTimeout });
          if (retryRes) response = retryRes;
        } catch {
          // Retry navigation itself failed — keep the last response and
          // let downstream code report the WAF status honestly.
          break;
        }
      }
    }

    // Cloudflare "Just a moment..." interstitial: the WAF returns 200 with
    // a JS-challenge page instead of the real content. Since we allow
    // scripts to load, the challenge can solve itself in a few seconds —
    // wait up to 12s for __NEXT_DATA__ to appear (either the challenge
    // resolves and Next.js hydrates, or navigation replaces the doc).
    // We track whether we ever saw the challenge, and whether it cleared,
    // so the aggregator can flip the URL to "failed" honestly.
    let wafChallenged = false;
    if (isSsrOnlyMode) {
      const challenged = await page.evaluate(() =>
        document.title === "Just a moment..." && !document.getElementById("__NEXT_DATA__")
      ).catch(() => false);
      if (challenged) {
        try {
          await page.waitForFunction(
            () => !!document.getElementById("__NEXT_DATA__"),
            { timeout: 12000, polling: 500 }
          );
        } catch {
          // Challenge never cleared — mark this result as WAF-challenged
          // so the URL surfaces as failed in the retest queue.
          wafChallenged = true;
        }
      }
    }
    if (!isSsrOnlyMode) {
      try {
        await page.waitForLoadState("networkidle", {
          timeout: isProductsMode ? 1000 : (quickMode ? 3000 : 15000),
        });
      } catch {
        // Network never fully idle — continue with what we have
      }
    }

    const settlems = isSsrOnlyMode
      ? 0                              // __NEXT_DATA__ is inlined; no settle needed
      : isProductsMode
        ? 500
        : effectiveQuick
          ? 600
          : engine === "webkit" ? 4000 : 2500;
    if (settlems > 0) await page.waitForTimeout(settlems);

    // Scroll only in full non-quick mode (for video capture)
    if (!effectiveQuick) {
      await page.evaluate(async () => {
        const totalHeight = document.body.scrollHeight;
        const step = Math.ceil(window.innerHeight * 0.6);
        for (let pos = 0; pos < totalHeight; pos += step) {
          window.scrollTo({ top: pos, behavior: "smooth" });
          await new Promise((r) => setTimeout(r, 300));
        }
        await new Promise((r) => setTimeout(r, 500));
        window.scrollTo({ top: 0, behavior: "smooth" });
        await new Promise((r) => setTimeout(r, 400));
      });
    }

    // ── PDP empty-data check (only in pdp-data mode) ─────────────────
    let pdpDataCheck: PdpDataCheck | undefined;
    if (isPdpDataMode) {
      pdpDataCheck = await page.evaluate((keys: string[]): PdpDataCheck => {
        const result: PdpDataCheck = { checked: keys, empty: [], productFound: false };
        try {
          // Prefer the inlined <script id="__NEXT_DATA__"> — SSR always writes it.
          // window.__NEXT_DATA__ depends on Next.js client runtime succeeding,
          // which can fail on pages with third-party auth/analytics 401s.
          let nd: any = null;
          const scriptEl = document.getElementById('__NEXT_DATA__');
          if (scriptEl?.textContent) {
            try { nd = JSON.parse(scriptEl.textContent); } catch { nd = null; }
          }
          if (!nd) nd = (window as any).__NEXT_DATA__;
          if (!nd) return result;

          // The `product` object can live at several observed paths depending
          // on the Frontastic build. Walk all of them and take the first hit.
          //   1. props.pageProps.data.data.dataSources.<id>.product   (SSR-hydrated)
          //   2. props.pageProps.data.dataSources.<id>.product        (older layout)
          //   3. props.pageProps.data.pageFolder.dataSourceConfigurations[].preloadedValue.product
          const candidates: any[] = [
            nd?.props?.pageProps?.data?.data?.dataSources,
            nd?.props?.pageProps?.data?.dataSources,
          ];
          let product: any = null;
          for (const ds of candidates) {
            if (product) break;
            if (ds && typeof ds === 'object') {
              for (const entry of Object.values<any>(ds)) {
                if (entry && typeof entry === 'object' && entry.product && typeof entry.product === 'object') {
                  product = entry.product;
                  break;
                }
              }
            }
          }
          if (!product) {
            const cfgs = nd?.props?.pageProps?.data?.pageFolder?.dataSourceConfigurations;
            if (Array.isArray(cfgs)) {
              for (const c of cfgs) {
                const p = c?.preloadedValue?.product;
                if (p && typeof p === 'object') { product = p; break; }
              }
            }
          }
          if (!product) return result;
          result.productFound = true;

          // A field is "empty" when either:
          //   1. the shape is exactly { h: "<string>" } — the API's placeholder
          //      for undefined/empty content, OR
          //   2. `h` contains only empty HTML that renders blank in the buy box
          //      (e.g. "<p></p>", "<p>&nbsp;</p>", "<p><br></p>", "  ").
          //      The CMS keeps a rich-text wrapper even when the author cleared
          //      the value, so the string is non-empty but visually blank.
          const isVisuallyEmptyHtml = (html: string): boolean => {
            if (!html) return true;
            const div = document.createElement('div');
            div.innerHTML = html;
            const text = (div.textContent || '')
              .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, '')
              .trim();
            return text.length === 0;
          };

          for (const key of keys) {
            const v = product[key];
            if (v == null) {
              result.empty.push(key);
              continue;
            }
            if (typeof v === 'string') {
              if (isVisuallyEmptyHtml(v)) result.empty.push(key);
              continue;
            }
            if (typeof v === 'object' && !Array.isArray(v)) {
              const h = (v as any).h;
              const ks = Object.keys(v);
              const isOnlyH = ks.length === 1 && ks[0] === 'h' && typeof h === 'string';
              if (isOnlyH) {
                result.empty.push(key);
              } else if (typeof h === 'string' && isVisuallyEmptyHtml(h)) {
                result.empty.push(key);
              }
            }
          }
          return result;
        } catch {
          return result;
        }
      }, pdpChecks).catch(() => ({ checked: pdpChecks, empty: [], productFound: false }));
    }

    // ── Datasource scan (only in strapi mode) ───────────────────────────
    // Walk __NEXT_DATA__ and flag every datasource whose type string matches
    // one of the tracked keywords: "strapi" (any subtype — strapi/component,
    // strapi/blog, …) and "builder/component" (Frontastic Builder). Both are
    // returned so the report can headline strapi with URL detail and just
    // count builder. Frontastic stores the type field under `type`,
    // `dataSource`, or `dataSourceType` depending on version — check all.
    let strapiCheck: StrapiCheck | undefined;
    if (isStrapiMode) {
      strapiCheck = await page.evaluate((): StrapiCheck => {
        const out: StrapiCheck = { found: false, datasources: [] };
        try {
          let nd: any = null;
          const scriptEl = document.getElementById("__NEXT_DATA__");
          if (scriptEl?.textContent) {
            try { nd = JSON.parse(scriptEl.textContent); } catch { nd = null; }
          }
          if (!nd) nd = (window as any).__NEXT_DATA__;
          if (!nd) return out;

          const KEYWORDS = ["strapi", "builder/component"];
          const matches = (v: unknown): v is string => {
            if (typeof v !== "string") return false;
            const lc = v.toLowerCase();
            return KEYWORDS.some((k) => lc.includes(k));
          };

          const dsMap =
            nd?.props?.pageProps?.data?.data?.dataSources ??
            nd?.props?.pageProps?.data?.dataSources ??
            null;
          if (dsMap && typeof dsMap === "object") {
            for (const [id, entry] of Object.entries<any>(dsMap)) {
              const t = entry?.dataSource ?? entry?.dataSourceType ?? entry?.type;
              if (matches(t)) {
                out.datasources.push({ id, type: t as string, location: "dataSources" });
              }
            }
          }

          const cfgs = nd?.props?.pageProps?.data?.pageFolder?.dataSourceConfigurations;
          if (Array.isArray(cfgs)) {
            cfgs.forEach((c: any, i: number) => {
              const t = c?.type ?? c?.dataSource ?? c?.dataSourceType;
              if (matches(t)) {
                out.datasources.push({
                  id: c?.dataSourceId ?? c?.name ?? String(i),
                  type: t as string,
                  location: "pageFolder",
                });
              }
            });
          }

          out.found = out.datasources.length > 0;
          return out;
        } catch {
          return out;
        }
      }).catch(() => ({ found: false, datasources: [] as any[] }));
    }

    // ── Product count (skipped in LCP-only, PDP-data, and Strapi modes) ─
    let productCount: number | undefined;
    if (!isLcpMode && !isSsrOnlyMode) {
      const productCountRaw = await page.evaluate((): number | null => {
        try {
          const nd = (window as any).__NEXT_DATA__;
          if (!nd) return null;

          // Find the product-list tastic in sections.main to get the dataSourceId
          const layoutElements =
            nd?.props?.pageProps?.data?.page?.sections?.main?.layoutElements;
          if (!Array.isArray(layoutElements)) return null;

          let dataSourceId: string | undefined;
          outer: for (const le of layoutElements) {
            for (const t of (le?.tastics ?? [])) {
              if (t?.tasticType === 'frontastic/ui/products/product-list') {
                dataSourceId = t?.configuration?.data?.dataSourceId;
                break outer;
              }
            }
          }

          // No product-list tastic → not a product listing page
          if (!dataSourceId) return null;

          // Read totalCount from the matching data source
          const ds = nd?.props?.pageProps?.data?.data?.dataSources?.[dataSourceId];
          if (!ds) return 0;
          return typeof ds.totalCount === 'number' ? ds.totalCount : 0;
        } catch {
          return null;
        }
      }).catch(() => null);

      productCount = productCountRaw !== null ? productCountRaw : undefined;
    }

    // Final screenshot
    if (onScreenshot && !effectiveQuick) {
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 85 });
        onScreenshot(profile.id, buf.toString("base64"));
      } catch {}
    }
    stopScreenshots?.();

    // ── Vitals + API calls (skipped in products mode) ─────────────────
    let vitals: WebVitals = {};
    let apiCalls: ApiCall[] = [];

    if (!isProductsMode && !isSsrOnlyMode) {
      const navTiming = await page.evaluate(() => {
        const nav = performance.getEntriesByType(
          "navigation"
        )[0] as PerformanceNavigationTiming;
        if (!nav) return { ttfb: 0, totalTime: 0 };
        return {
          ttfb: Math.round(nav.responseStart - nav.requestStart),
          totalTime: Math.round(nav.loadEventEnd - nav.startTime),
        };
      });

      const observed = await page.evaluate(() => {
        const v = (window as any).__auditVitals ?? {};
        return {
          lcp: Math.round(v.lcp ?? 0),
          cls: parseFloat((v.cls ?? 0).toFixed(4)),
          fcp: Math.round(v.fcp ?? 0),
        };
      });

      const csrRaw: ApiCall[] = await page.evaluate(() =>
        (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter(
            (r) =>
              r.name.includes("/api/") ||
              r.name.includes("/graphql") ||
              r.name.includes("/_next/data") ||
              r.initiatorType === "fetch" ||
              r.initiatorType === "xmlhttprequest"
          )
          .map((r) => ({
            url: r.name,
            status: 0,
            duration: Math.round(r.responseEnd - r.startTime),
            type: "csr" as const,
            initiator: r.initiatorType,
          }))
      );

      const ssrUrls = new Set(ssrApiCalls.map((a) => a.url));
      const csrEnriched = csrRaw
        .filter((c) => !ssrUrls.has(c.url))
        .map((c) => {
          const net = networkIndex.get(c.url);
          return {
            ...c,
            status: net?.status ?? 0,
            serverTiming: net?.serverTiming ?? undefined,
            duration: net?.duration ?? c.duration,
          };
        });

      apiCalls = [...ssrApiCalls, ...csrEnriched];
      vitals = {
        ttfb: navTiming.ttfb || undefined,
        totalTime: navTiming.totalTime || undefined,
        lcp: observed.lcp || undefined,
        cls: observed.cls,
        fcp: observed.fcp || undefined,
      };
    }

    // ── Save video ───────────────────────────────────────────────────────
    let videoPath: string | undefined;

    if (!effectiveQuick) {
      const video = page.video();

      await page.close();
      await context.close();

      if (video) {
        try {
          const raw: string =
            typeof (video as any).savePath === "function"
              ? await (video as any).savePath()
              : await video.path();

          if (raw && fs.existsSync(raw)) {
            const ext = raw.endsWith(".mp4") ? ".mp4" : ".webm";
            const slug =
              new URL(url).pathname
                .replace(/^\//, "")
                .replace(/\//g, "-")
                .replace(/[^a-zA-Z0-9-]/g, "")
                .slice(0, 80) || "root";
            const newName = path.join(videosDir, `${slug}-${profile.id}${ext}`);
            if (fs.existsSync(newName)) fs.unlinkSync(newName);
            fs.renameSync(raw, newName);
            videoPath = newName;
          }
        } catch (e) {
          console.warn("  ⚠ video save failed:", (e as any).message);
        }
      }
    } else {
      await page.close();
      await context.close();
    }

    return {
      url,
      profile,
      engine,
      status: response.status(),
      vitals,
      apiCalls,
      errors,
      videoPath,
      productCount,
      pdpDataCheck,
      strapiCheck,
      wafChallenged: wafChallenged || undefined,
      auditedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    try {
      await context?.close();
    } catch {}
    return {
      url,
      profile,
      engine,
      error: err.message,
      vitals: {},
      apiCalls: [],
      errors: [],
      auditedAt: new Date().toISOString(),
    };
  }
}

// ── Main export ───────────────────────────────────────────────────────────
export async function runAudit(
  urls: string[],
  options: {
    concurrency?: number;
    videosDir?: string;
    profiles?: DeviceProfile[];
    onProgress?: (progress: AuditProgress) => void;
    onScreenshot?: (url: string, profileId: string, png: string) => void;
    quickMode?: boolean;
    auditMode?: "full" | "products" | "lcp" | "pdp-data" | "strapi";
    pdpChecks?: string[];
    signal?: { cancelled: boolean; aborter?: AbortController };
  } = {}
): Promise<AuditProgress[]> {
  const {
    concurrency = 3,
    videosDir = "./videos",
    profiles = DEVICE_PROFILES,
    onProgress,
    onScreenshot,
    quickMode = false,
    auditMode = "full",
    pdpChecks = [],
    signal,
  } = options;

  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

  // Claim a slot in the shared pool ref count. The paired decrement lives
  // in a finally so a thrown pre-warm doesn't leak the count.
  activeAudits++;

  // Pre-warm all needed browser engines.
  // pdp-data used to have an axios HTTP fast path, but production WAFs
  // (Cloudflare/Akamai) TLS-fingerprint Node's stack and return 403 regardless
  // of headers. Playwright's real browser TLS clears the challenge.
  const neededEngines = new Set(profiles.map(engineForProfile));
  console.log(`\n  Launching engines: ${[...neededEngines].join(", ")}  (active audits: ${activeAudits})`);
  try {
    await Promise.all([...neededEngines].map((e) => getBrowser(e)));
  } catch (err) {
    activeAudits--;
    throw err;
  }

  const limit = pLimit(concurrency);
  const allProgress: AuditProgress[] = [];

  const tasks = urls.map((url) =>
    limit(async () => {
      if (shuttingDown || signal?.cancelled) {
        const p: AuditProgress = { url, status: "failed" };
        allProgress.push(p);
        onProgress?.(p);
        return;
      }

      onProgress?.({ url, status: "running", screenshots: {} });

      const results: PageResult[] = [];
      const shots: Record<string, string> = {};

      // Hard wall-clock cap per (url × profile). If auditPage() ever hangs —
      // browser crashed, route handler stuck, TLS handshake stalled — the
      // outer timeout wins and the pLimit slot is released. Without this a
      // single hung task can freeze the whole run (seen at ~9500/12000 URLs
      // when Chromium ran out of memory).
      const PER_URL_TIMEOUT_MS =
        auditMode === "pdp-data" ? 45000
        : auditMode === "strapi" ? 45000
        : auditMode === "products" ? 60000
        : 120000;

      for (const profile of profiles) {
        if (shuttingDown || signal?.cancelled) break;
        const auditPromise = auditPage(
          url,
          profile,
          videosDir,
          onScreenshot
            ? (pid, png) => {
                shots[pid] = png;
                onScreenshot(url, pid, png);
              }
            : undefined,
          quickMode,
          auditMode,
          pdpChecks
        );
        const timeoutPromise = new Promise<PageResult>((resolve) => {
          setTimeout(() => {
            resolve({
              url,
              profile,
              engine: engineForProfile(profile),
              error: `Task exceeded ${PER_URL_TIMEOUT_MS}ms wall-clock cap`,
              vitals: {},
              apiCalls: [],
              errors: [],
              auditedAt: new Date().toISOString(),
            });
          }, PER_URL_TIMEOUT_MS).unref();
        });
        const result = await Promise.race([auditPromise, timeoutPromise]);
        results.push(result);
        // Broadcast partial progress after each profile
        onProgress?.({
          url,
          status: "running",
          results: [...results],
          screenshots: { ...shots },
        });
      }

      const wasCancelled = !!(signal?.cancelled);
      const allFailed = results.length === 0 || results.every((r) => !!r.error);
      // Treat any 403 as a failed URL — the WAF blocked us and the audit
      // result is unreliable. Marking it "failed" surfaces it in the Retest
      // Failed queue so the user can requeue without hunting through 200s.
      const any403 = results.some((r) => r.status === 403);
      // Same for the "Just a moment..." challenge — the runner explicitly
      // flags results where the interstitial never resolved. Status will
      // typically be 200 (misleading), so we need this dedicated signal.
      const anyChallenge = results.some((r) => r.wafChallenged);
      const progress: AuditProgress = {
        url,
        status: (wasCancelled || allFailed || any403 || anyChallenge) ? "failed" : "done",
        results,
        screenshots: shots,
      };
      allProgress.push(progress);
      onProgress?.(progress);
    })
  );

  await Promise.allSettled(tasks);

  // Recycle the browser pool ONLY when no other runAudit is still in flight.
  // Otherwise Session A ending would tear down chromium mid-run for Session B
  // (retest, parallel tab, or concurrent bulk audit) — every in-flight page
  // in the other run would fail with "browser disconnected".
  //
  // On long-lived hosts (e.g. Railway with capped pids.max), leaked Chromium
  // helpers from crashed contexts still accumulate. This teardown reclaims
  // them once the last active audit is done.
  activeAudits--;
  if (activeAudits === 0) {
    try {
      await closeAllBrowsers();
    } catch (err) {
      console.warn("  ⚠ closeAllBrowsers() failed after audit:", err);
    }
  } else {
    console.log(`  Skipping pool teardown — ${activeAudits} audit(s) still running`);
  }

  return allProgress;
}
