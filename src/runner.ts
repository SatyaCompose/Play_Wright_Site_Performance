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
process.on("SIGINT", () => {
  shuttingDown = true;
});
process.on("SIGTERM", () => {
  shuttingDown = true;
});

// ── Browser pool: one instance per engine, shared across all pages ────────
const browserPool = new Map<string, Browser>();

async function getBrowser(
  engineName: "chromium" | "webkit" | "firefox"
): Promise<Browser> {
  if (browserPool.has(engineName)) return browserPool.get(engineName)!;
  const engines: Record<string, BrowserType> = { chromium, webkit, firefox };
  const browser = await engines[engineName].launch({
    args:
      engineName === "chromium"
        ? ["--no-sandbox", "--disable-setuid-sandbox"]
        : [],
  });
  browserPool.set(engineName, browser);
  return browser;
}

async function closeAllBrowsers() {
  for (const [, browser] of browserPool) {
    try {
      await browser.close();
    } catch {}
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
function contextOptions(profile: DeviceProfile, videosDir: string) {
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
    recordVideo: {
      dir: videosDir,
      size: { width: viewport.width, height: viewport.height },
    },
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
  onScreenshot?: (profileId: string, png: string) => void
): Promise<PageResult> {
  const engine = engineForProfile(profile);
  const browser = await getBrowser(engine);
  let context: BrowserContext | null = null;

  try {
    context = await browser.newContext(contextOptions(profile, videosDir));
    const page = await context.newPage();

    let stopScreenshots: (() => void) | null = null;
    if (onScreenshot) {
      stopScreenshots = startScreenshotStream(page, 800, (png) =>
        onScreenshot(profile.id, png)
      );
    }

    // ── Network interception ──────────────────────────────────────────
    // Capture ALL responses at the network level so we can:
    //   • identify SSR calls (api/graphql/next-data) with real status codes
    //   • provide status codes for CSR fetch/XHR calls via cross-reference
    const ssrApiCalls: ApiCall[] = [];
    const reqStart = new Map<string, number>();
    // url → { status, serverTiming, duration } — used to enrich CSR entries
    const networkIndex = new Map<
      string,
      { status: number; serverTiming?: string; duration: number }
    >();

    page.on("request", (req) => reqStart.set(req.url(), Date.now()));

    page.on("response", async (res) => {
      const resUrl = res.url();
      const duration = Date.now() - (reqStart.get(resUrl) ?? Date.now());

      let serverTiming: string | undefined;
      try {
        serverTiming = res.headers()["server-timing"] ?? undefined;
      } catch {}

      // Index every fetch/XHR for CSR status enrichment
      const reqType = res.request().resourceType();
      if (reqType === "fetch" || reqType === "xhr") {
        networkIndex.set(resUrl, {
          status: res.status(),
          serverTiming,
          duration,
        });
      }

      // SSR calls: api / graphql / next-data intercepted during initial page load
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

    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(`[PageError] ${err.message}`));

    await page.addInitScript(VITALS_SCRIPT);

    // "networkidle" waits for no network activity for 500ms after load —
    // catches React/Next.js hydration API calls that fire after DOMContentLoaded.
    // Falls back to "load" if networkidle times out (e.g. long-polling pages).
    let response;
    try {
      response = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
    } catch {
      response = await page.goto(url, { waitUntil: "load", timeout: 60000 });
    }
    if (!response) throw new Error("No response received");

    // Give mobile browsers extra time: WebKit paints later than Chromium,
    // and CSR frameworks (React, Vue) fire data fetches after initial paint.
    const settlems = engineForProfile(profile) === "webkit" ? 4000 : 2500;
    await page.waitForTimeout(settlems);

    // Final screenshot
    if (onScreenshot) {
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 85 });
        onScreenshot(profile.id, buf.toString("base64"));
      } catch {}
    }
    stopScreenshots?.();

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

    // Enrich CSR entries: cross-reference Resource Timing with network responses
    // to get real HTTP status codes (Resource Timing API exposes no status codes).
    const ssrUrls = new Set(ssrApiCalls.map((a) => a.url));
    const csrEnriched = csrRaw
      .filter((c) => !ssrUrls.has(c.url))
      .map((c) => {
        const net = networkIndex.get(c.url);
        return {
          ...c,
          status: net?.status ?? 0,
          serverTiming: net?.serverTiming ?? undefined,
          // Use network-measured duration when available (more accurate than Resource Timing)
          duration: net?.duration ?? c.duration,
        };
      });
    const apiCalls = [...ssrApiCalls, ...csrEnriched];
    const vitals: WebVitals = {
      ttfb: navTiming.ttfb || undefined,
      totalTime: navTiming.totalTime || undefined,
      lcp: observed.lcp || undefined,
      cls: observed.cls,
      fcp: observed.fcp || undefined,
    };

    // ── Save video ───────────────────────────────────────────────────────
    // Must call page.video().path() BEFORE closing page/context — Playwright
    // finalises the file only after context.close(), but the path is locked in
    // at page creation time. Calling it after close() returns undefined.
    let videoPath: string | undefined;
    const video = page.video();

    await page.close();
    // context.close() blocks until Playwright finishes writing the video file
    await context.close();

    if (video) {
      try {
        const raw: string =
          typeof (video as any).savePath === "function"
            ? await (video as any).savePath()
            : await video.path();

        if (raw && fs.existsSync(raw)) {
          const ext = raw.endsWith(".mp4") ? ".mp4" : ".webm";

          // Clean slug from URL path: /product/wolstead-glass-lid → product-wolstead-glass-lid
          const slug =
            new URL(url).pathname
              .replace(/^\//, "") // strip leading slash
              .replace(/\//g, "-") // slashes → hyphens
              .replace(/[^a-zA-Z0-9-]/g, "") // strip anything else
              .slice(0, 80) || // cap length
            "root";

          // Format: <slug>-<profile-id>.ext  e.g. product-wolstead-glass-lid-28cm-mobile-ios.mp4
          const newName = path.join(videosDir, `${slug}-${profile.id}${ext}`);

          // Overwrite any previous recording for this URL+profile combination
          if (fs.existsSync(newName)) fs.unlinkSync(newName);
          fs.renameSync(raw, newName);
          videoPath = newName;
        }
      } catch (e) {
        console.warn("  ⚠ video save failed:", (e as any).message);
      }
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
      auditedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    // Still close context so Playwright flushes the partial video
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
  } = {}
): Promise<AuditProgress[]> {
  const {
    concurrency = 3,
    videosDir = "./videos",
    profiles = DEVICE_PROFILES,
    onProgress,
    onScreenshot,
  } = options;

  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

  // Pre-warm all needed browser engines
  const neededEngines = new Set(profiles.map(engineForProfile));
  console.log(`\n  Launching engines: ${[...neededEngines].join(", ")}`);
  await Promise.all([...neededEngines].map((e) => getBrowser(e)));

  const limit = pLimit(concurrency);
  const allProgress: AuditProgress[] = [];

  const tasks = urls.map((url) =>
    limit(async () => {
      if (shuttingDown) {
        const p: AuditProgress = { url, status: "failed" };
        allProgress.push(p);
        onProgress?.(p);
        return;
      }

      onProgress?.({ url, status: "running", screenshots: {} });

      const results: PageResult[] = [];
      const shots: Record<string, string> = {};

      for (const profile of profiles) {
        if (shuttingDown) break;
        const result = await auditPage(
          url,
          profile,
          videosDir,
          onScreenshot
            ? (pid, png) => {
                shots[pid] = png;
                onScreenshot(url, pid, png);
              }
            : undefined
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

      const allFailed = results.every((r) => !!r.error);
      const progress: AuditProgress = {
        url,
        status: allFailed ? "failed" : "done",
        results,
        screenshots: shots,
      };
      allProgress.push(progress);
      onProgress?.(progress);
    })
  );

  try {
    await Promise.allSettled(tasks);
  } finally {
    await closeAllBrowsers();
  }

  return allProgress;
}
