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
const browserPool = new Map<string, Browser>();
const browserPending = new Map<string, Promise<Browser>>();

async function getBrowser(
  engineName: "chromium" | "webkit" | "firefox"
): Promise<Browser> {
  if (browserPool.has(engineName)) return browserPool.get(engineName)!;
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

  return {
    ...merged,
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
  auditMode: "full" | "products" | "lcp" | "pdp-data" = "full",
  pdpChecks: string[] = []
): Promise<PageResult> {
  const isProductsMode = auditMode === "products";
  const isLcpMode = auditMode === "lcp";
  const isPdpDataMode = auditMode === "pdp-data";
  // Products & PDP-data modes imply quick scan (no video / screenshots / vitals)
  const effectiveQuick = quickMode || isProductsMode || isPdpDataMode;

  const engine = engineForProfile(profile);
  const browser = await getBrowser(engine);
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext(contextOptions(profile, videosDir, effectiveQuick));
    const page = await context.newPage();

    // ── pdp-data speed boost: block subresources ───────────────────────
    // We only need the HTML document to parse __NEXT_DATA__. Blocking images,
    // stylesheets, media, and fonts cuts bytes/second by ~90% and lets us
    // finish each URL in ~1-2s instead of 6-10s. `document` and `script` are
    // still allowed since Next.js hydration reads inline JSON via them.
    if (isPdpDataMode) {
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

    if (!isProductsMode && !isPdpDataMode) {
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
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(`[PageError] ${err.message}`));

    // Vitals script only needed when measuring LCP/CLS/FCP
    if (!isProductsMode && !isPdpDataMode) {
      await page.addInitScript(VITALS_SCRIPT);
    }

    // pdp-data only needs the SSR HTML — DOMContentLoaded is enough.
    // Other modes still wait for full load to measure vitals / capture video.
    const gotoWait = isPdpDataMode ? "domcontentloaded" : "load";
    const gotoTimeout = isPdpDataMode ? 30000 : 60000;
    const response = await page.goto(url, { waitUntil: gotoWait, timeout: gotoTimeout });
    if (!response) throw new Error("No response received");
    if (!isPdpDataMode) {
      try {
        await page.waitForLoadState("networkidle", {
          timeout: isProductsMode ? 1000 : (quickMode ? 3000 : 15000),
        });
      } catch {
        // Network never fully idle — continue with what we have
      }
    }

    const settlems = isPdpDataMode
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

          // A field is "empty" when it's exactly { h: "<string>" } — the API's
          // placeholder for undefined/empty content.
          for (const key of keys) {
            const v = product[key];
            if (v && typeof v === 'object' && !Array.isArray(v)) {
              const ks = Object.keys(v);
              if (ks.length === 1 && ks[0] === 'h' && typeof (v as any).h === 'string') {
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

    // ── Product count (skipped in LCP-only mode and PDP-data mode) ─────
    let productCount: number | undefined;
    if (!isLcpMode && !isPdpDataMode) {
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

    if (!isProductsMode && !isPdpDataMode) {
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
    auditMode?: "full" | "products" | "lcp" | "pdp-data";
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

  // Pre-warm all needed browser engines.
  // pdp-data used to have an axios HTTP fast path, but production WAFs
  // (Cloudflare/Akamai) TLS-fingerprint Node's stack and return 403 regardless
  // of headers. Playwright's real browser TLS clears the challenge.
  const neededEngines = new Set(profiles.map(engineForProfile));
  console.log(`\n  Launching engines: ${[...neededEngines].join(", ")}`);
  await Promise.all([...neededEngines].map((e) => getBrowser(e)));

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

      for (const profile of profiles) {
        if (shuttingDown || signal?.cancelled) break;
        const result = await auditPage(
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
      const progress: AuditProgress = {
        url,
        status: wasCancelled ? "failed" : allFailed ? "failed" : "done",
        results,
        screenshots: shots,
      };
      allProgress.push(progress);
      onProgress?.(progress);
    })
  );

  await Promise.allSettled(tasks);
  return allProgress;
}
