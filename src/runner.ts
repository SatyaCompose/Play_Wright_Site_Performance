import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import pLimit from "p-limit";
import * as fs from "fs";
import * as path from "path";
import type { PageResult, ApiCall, WebVitals, AuditProgress } from "./types";

const VITALS_SCRIPT = `
  window.__auditVitals = { lcp: 0, cls: 0, fcp: 0 };
  try {
    new PerformanceObserver((list) => {
      const e = list.getEntries();
      const last = e[e.length - 1];
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

// ── Screenshot streamer ───────────────────────────────────────────────────
// Fires onScreenshot(url, base64png) every `intervalMs` while the page loads.
// Stops automatically when stopFn() is called.
function startScreenshotStream(
  page: Page,
  pageUrl: string,
  intervalMs: number,
  onScreenshot: (url: string, png: string) => void
): () => void {
  let active = true;

  (async () => {
    while (active) {
      await new Promise((r) => setTimeout(r, intervalMs));
      if (!active) break;
      try {
        const buf = await page.screenshot({ type: "jpeg", quality: 70 });
        if (active) onScreenshot(pageUrl, buf.toString("base64"));
      } catch {
        // Page may have closed — stop silently
        break;
      }
    }
  })();

  return () => {
    active = false;
  };
}

export async function runAudit(
  urls: string[],
  options: {
    concurrency?: number;
    videosDir?: string;
    onProgress?: (progress: AuditProgress) => void;
    onScreenshot?: (url: string, png: string) => void; // ← new
  } = {}
): Promise<PageResult[]> {
  const {
    concurrency = 3,
    videosDir = "./videos",
    onProgress,
    onScreenshot,
  } = options;

  if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (err: any) {
    throw new Error(`Failed to launch browser: ${err.message}`);
  }

  const results: PageResult[] = [];
  const limit = pLimit(concurrency);

  const tasks = urls.map((url) =>
    limit(async () => {
      if (shuttingDown) {
        const r: PageResult = {
          url,
          error: "Audit cancelled",
          vitals: {},
          apiCalls: [],
          errors: [],
          auditedAt: new Date().toISOString(),
        };
        results.push(r);
        onProgress?.({ url, status: "failed", result: r });
        return;
      }

      onProgress?.({ url, status: "running" });

      let context: BrowserContext | null = null;
      let result: PageResult;
      let stopScreenshots: (() => void) | null = null;

      try {
        context = await browser!.newContext({
          recordVideo: { dir: videosDir, size: { width: 1280, height: 720 } },
          viewport: { width: 1280, height: 720 },
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        });

        const page = await context.newPage();

        // ── Live screenshot stream (800ms interval) ───────────────────
        if (onScreenshot) {
          stopScreenshots = startScreenshotStream(page, url, 100, onScreenshot);
        }

        // ── Network interception ──────────────────────────────────────
        const ssrApiCalls: ApiCall[] = [];
        const reqStart = new Map<string, number>();

        page.on("request", (req) => reqStart.set(req.url(), Date.now()));
        page.on("response", async (res) => {
          const resUrl = res.url();
          const duration = Date.now() - (reqStart.get(resUrl) ?? Date.now());
          let serverTiming: string | undefined;
          try {
            serverTiming = res.headers()["server-timing"] ?? undefined;
          } catch {}
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
        page.on("pageerror", (err) =>
          errors.push(`[PageError] ${err.message}`)
        );

        await page.addInitScript(VITALS_SCRIPT);

        const response = await page.goto(url, {
          waitUntil: "load",
          timeout: 60000,
        });
        if (!response) throw new Error("No response received");

        // Settle observers + CSR fetches, screenshots keep firing here
        await page.waitForTimeout(2500);

        // Final screenshot before we close
        if (onScreenshot) {
          try {
            const buf = await page.screenshot({ type: "jpeg", quality: 85 });
            onScreenshot(url, buf.toString("base64"));
          } catch {}
        }

        stopScreenshots?.();
        stopScreenshots = null;

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

        const csrRaw: ApiCall[] = await page.evaluate(() => {
          return (
            performance.getEntriesByType(
              "resource"
            ) as PerformanceResourceTiming[]
          )
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
            }));
        });

        const ssrUrls = new Set(ssrApiCalls.map((a) => a.url));
        const apiCalls: ApiCall[] = [
          ...ssrApiCalls,
          ...csrRaw.filter((c) => !ssrUrls.has(c.url)),
        ];

        const vitals: WebVitals = {
          ttfb: navTiming.ttfb || undefined,
          totalTime: navTiming.totalTime || undefined,
          lcp: observed.lcp || undefined,
          cls: observed.cls,
          fcp: observed.fcp || undefined,
        };

        result = {
          url,
          status: response.status(),
          vitals,
          apiCalls,
          errors,
          auditedAt: new Date().toISOString(),
        };
        await page.close();
      } catch (err: any) {
        stopScreenshots?.();
        result = {
          url,
          error: err.message,
          vitals: {},
          apiCalls: [],
          errors: [],
          auditedAt: new Date().toISOString(),
        };
      }

      // Close context + rename video
      if (context) {
        try {
          await context.close();
          const files = fs
            .readdirSync(videosDir)
            .filter((f) => f.endsWith(".webm"))
            .map((f) => ({
              name: f,
              mtime: fs.statSync(path.join(videosDir, f)).mtimeMs,
            }))
            .sort((a, b) => b.mtime - a.mtime);

          if (files.length > 0) {
            const slug =
              new URL(url).pathname
                .replace(/\//g, "_")
                .replace(/[^a-zA-Z0-9_-]/g, "") || "root";
            const newName = `${slug}_${Date.now()}.webm`;
            fs.renameSync(
              path.join(videosDir, files[0].name),
              path.join(videosDir, newName)
            );
            result.videoPath = path.join(videosDir, newName);
          }
        } catch {}
      }

      results.push(result);
      onProgress?.({ url, status: result.error ? "failed" : "done", result });
    })
  );

  try {
    await Promise.allSettled(tasks);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }

  return results;
}
