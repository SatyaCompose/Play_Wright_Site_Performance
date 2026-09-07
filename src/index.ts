import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import "dotenv/config";
import { getCTProductUrls, type CTEnv } from "./ct";
import { getUrlsFromSitemap } from "./sitemap";
import { runAudit, closeAllBrowsers } from "./runner";
import { generateHTMLReport } from "./report";
import { generateProductReportHTML } from "./product-report";
import { generatePdpReportHTML } from "./pdp-report";
import { generateStrapiReportHTML, generateStrapiReportCSV, type StrapiUrlSource } from "./strapi-report";
import { generatePDF } from "./pdf";
import type { AuditProgress } from "./types";
import { DEVICE_PROFILES } from "./types";

// ── Config ────────────────────────────────────────────────────────────────
const concurrency = parseInt(
  process.env.CONCURRENCY ?? process.argv[2] ?? "3",
  10
);
const port = parseInt(process.env.PORT ?? process.argv[3] ?? "7331", 10);
const videosDir = process.env.VIDEOS_DIR ?? "./videos";

// ── Per-session state ─────────────────────────────────────────────────────
interface LastRunOptions {
  profileIds: string[];
  auditMode: "full" | "products" | "lcp" | "pdp-data" | "strapi";
  pdpChecks: string[];
  quickMode: boolean;
}

interface Session {
  id: string;
  progressMap: Map<string, AuditProgress>;
  auditDone: boolean;
  auditRunning: boolean;
  allUrls: string[];
  // For strapi-mixed runs, tracks the origin sitemap/CT for each URL so the
  // report can group results by content / PLP / PDP without asking the client
  // to re-send the mapping on each broadcast.
  urlSources: Map<string, StrapiUrlSource>;
  lastReportHtml: string;
  lastProductReportHtml: string;
  lastPdpReportHtml: string;
  lastStrapiReportHtml: string;
  lastStrapiReportCsv: string;
  // Filesystem-safe Sydney-time stamp assigned when reports are built. Used to
  // suffix download filenames so a user re-downloading the same report twice
  // gets the same filename, and successive runs don't overwrite each other in
  // the user's Downloads folder.
  lastReportTs: string;
  lastHasPdf: boolean;
  sessionVideosDir: string;
  currentSessionVideos: string[];
  signal: { cancelled: boolean; aborter?: AbortController };
  clients: Set<WebSocket>;
  lastRunOptions?: LastRunOptions;
}

const sessions = new Map<string, Session>();

function getOrCreateSession(id: string): Session {
  if (!sessions.has(id)) {
    sessions.set(id, {
      id,
      progressMap: new Map(),
      auditDone: false,
      auditRunning: false,
      allUrls: [],
      urlSources: new Map(),
      lastReportHtml: "",
      lastProductReportHtml: "",
      lastPdpReportHtml: "",
      lastStrapiReportHtml: "",
      lastStrapiReportCsv: "",
      lastReportTs: "",
      lastHasPdf: false,
      sessionVideosDir: path.join(videosDir, id.slice(0, 8)),
      currentSessionVideos: [],
      signal: { cancelled: false },
      clients: new Set(),
    });
  }
  return sessions.get(id)!;
}

function broadcastToSession(session: Session, msg: object) {
  const data = JSON.stringify(msg);
  for (const c of session.clients) {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  }
}

// Filesystem-safe timestamp in Sydney time: "2026-09-07_14-30-45". Colons,
// slashes, and spaces would be legal on some platforms but break on others,
// so we replace them with dashes/underscores.
function nowForFilename(): string {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}_${g("hour")}-${g("minute")}-${g("second")}`;
}

// Append the given timestamp to a base filename, before its extension:
//   stampedName("audit-report.html", "2026-09-07_14-30-45")
//     → "audit-report-2026-09-07_14-30-45.html"
function stampedName(base: string, ts: string): string {
  if (!ts) return base;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return `${base}-${ts}`;
  return `${base.slice(0, dot)}-${ts}${base.slice(dot)}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────
function clearSessionVideos(session: Session) {
  // Remove the whole session-specific videos subdirectory
  try {
    if (fs.existsSync(session.sessionVideosDir)) {
      fs.rmSync(session.sessionVideosDir, { recursive: true, force: true });
    }
  } catch {}
  session.currentSessionVideos = [];
}

// ── Graceful exit ─────────────────────────────────────────────────────────
let exiting = false;
async function gracefulExit() {
  if (exiting) return;
  exiting = true;
  console.log("\n\n  Shutting down…");
  // Cancel all running sessions
  for (const session of sessions.values()) {
    session.signal.cancelled = true;
  }
  wss.close();
  httpServer.close(() => {
    console.log("  Goodbye.\n");
    process.exit(0);
  });
  try { await closeAllBrowsers(); } catch {}
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGINT", gracefulExit);
process.on("SIGTERM", gracefulExit);

// ── Dirs ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

// ── HTTP server ───────────────────────────────────────────────────────────
const dashboardHtml = fs.readFileSync(
  path.join(__dirname, "dashboard.html"),
  "utf-8"
);

const httpServer = http.createServer((req, res) => {
  const [rawPath, rawQuery] = (req.url ?? "/").split("?");
  const params = new URLSearchParams(rawQuery ?? "");
  const sessionId = params.get("session") ?? "";
  const session = sessionId ? sessions.get(sessionId) : undefined;

  if (rawPath === "/" || rawPath === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml);
    return;
  }

  if (rawPath === "/report") {
    const html = session?.lastReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No report yet"); return; }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const ts = session?.lastReportTs ?? "";

  if (rawPath === "/report.html") {
    const html = session?.lastReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename=${stampedName("audit-report.html", ts)}`,
    });
    res.end(html);
    return;
  }

  if (rawPath === "/report.pdf") {
    const p = path.join(process.cwd(), `report-${sessionId}.pdf`);
    if (!sessionId || !fs.existsSync(p)) { res.writeHead(404); res.end("No PDF yet"); return; }
    const stat = fs.statSync(p);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename=${stampedName("audit-report.pdf", ts)}`,
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (rawPath === "/product-report.html") {
    const html = session?.lastProductReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No product report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename=${stampedName("product-report.html", ts)}`,
    });
    res.end(html);
    return;
  }

  if (rawPath === "/product-report.pdf") {
    const p = path.join(process.cwd(), `product-report-${sessionId}.pdf`);
    if (!sessionId || !fs.existsSync(p)) { res.writeHead(404); res.end("No product report PDF yet"); return; }
    const stat = fs.statSync(p);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename=${stampedName("product-report.pdf", ts)}`,
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (rawPath === "/pdp-report.html") {
    const html = session?.lastPdpReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No PDP report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename=${stampedName("pdp-report.html", ts)}`,
    });
    res.end(html);
    return;
  }

  if (rawPath === "/pdp-report.pdf") {
    const p = path.join(process.cwd(), `pdp-report-${sessionId}.pdf`);
    if (!sessionId || !fs.existsSync(p)) { res.writeHead(404); res.end("No PDP report PDF yet"); return; }
    const stat = fs.statSync(p);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename=${stampedName("pdp-report.pdf", ts)}`,
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (rawPath === "/strapi-report.html") {
    const html = session?.lastStrapiReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No Strapi report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename=${stampedName("strapi-report.html", ts)}`,
    });
    res.end(html);
    return;
  }

  if (rawPath === "/strapi-report.csv") {
    const csv = session?.lastStrapiReportCsv ?? "";
    if (!csv) { res.writeHead(404); res.end("No Strapi report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${stampedName("strapi-report.csv", ts)}`,
    });
    res.end(csv);
    return;
  }

  if (rawPath === "/strapi-report.pdf") {
    const p = path.join(process.cwd(), `strapi-report-${sessionId}.pdf`);
    if (!sessionId || !fs.existsSync(p)) { res.writeHead(404); res.end("No Strapi report PDF yet"); return; }
    const stat = fs.statSync(p);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename=${stampedName("strapi-report.pdf", ts)}`,
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  // Video streaming + optional download
  if (rawPath.startsWith("/videos/")) {
    const fp = path.join(process.cwd(), rawPath);
    if (!fs.existsSync(fp)) { res.writeHead(404); res.end("Video not found"); return; }

    const stat = fs.statSync(fp);
    const mime = fp.endsWith(".mp4") ? "video/mp4" : "video/webm";
    const fname = path.basename(fp);
    const download = params.get("download") === "1";

    const range = req.headers.range;
    if (range && !download) {
      const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": mime,
      });
      fs.createReadStream(fp, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
        "Content-Disposition": download
          ? `attachment; filename="${fname}"`
          : `inline; filename="${fname}"`,
      });
      fs.createReadStream(fp).pipe(res);
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws, req) => {
  // Parse session ID from WS URL query string (?session=<id>)
  const urlParams = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
  const sessionId = urlParams.get("session") || crypto.randomUUID();
  const session = getOrCreateSession(sessionId);
  session.clients.add(ws);

  ws.send(
    JSON.stringify({
      type: "init",
      profiles: DEVICE_PROFILES,
      urls: session.allUrls,
      progress: [...session.progressMap.values()],
      running: session.auditRunning,
      done: session.auditDone,
      hasReport: !!session.lastReportHtml,
      hasPdpReport: !!session.lastPdpReportHtml,
      hasStrapiReport: !!session.lastStrapiReportHtml,
      hasPdf: session.lastHasPdf,
      reportTs: session.lastReportTs,
    })
  );

  ws.on("message", async (raw) => {
    if (exiting) return;
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // ── Load URLs ──────────────────────────────────────────────────────
    // Two sources depending on audit intent:
    //   - Commercetools (msg.sourceType === "ct"): fetches valid PDPs directly
    //     from CT. Filters: isInactive=false, isDisplay=true, RRP-price > 0.
    //     msg.env picks the credential set (production / staging).
    //   - Sitemap (default, msg.source is a URL): fetches from an XML sitemap,
    //     sitemap index, plain-text URL list, or single page. Used for PLP /
    //     full / lcp modes where the sitemap is the source of truth.
    if (msg.type === "load_urls") {
      // ── Strapi mode: two sitemaps + optional CT PDPs ───────────────
      // Fetch all three in parallel, dedupe, tag each URL by origin so the
      // report can group results without another round-trip. Origin priority
      // if the same URL appears in two sources: pdp > plp > content (matches
      // how a KWH URL is more specifically identified by CT than by sitemap).
      if (msg.sourceType === "strapi-mixed") {
        const contentUrl: string = (msg.contentSitemap ?? "").trim();
        const plpUrl: string = (msg.plpSitemap ?? "").trim();
        const includePdp = !!msg.includePdp;
        const ctEnv: CTEnv = msg.ctEnv === "staging" ? "staging" : "production";

        if (!contentUrl && !plpUrl && !includePdp) {
          ws.send(JSON.stringify({ type: "error", message: "Provide at least one sitemap URL or enable CT PDPs" }));
          return;
        }

        ws.send(JSON.stringify({ type: "loading_urls", source: "strapi-mixed" }));

        const rewriteToOrigin = (urls: string[], sourceHref: string): string[] => {
          try {
            const src = new URL(sourceHref);
            return urls.map((u) => {
              try {
                const p = new URL(u);
                if (p.origin !== src.origin) {
                  p.hostname = src.hostname;
                  p.protocol = src.protocol;
                  p.port = src.port;
                  return p.toString();
                }
              } catch {}
              return u;
            });
          } catch {
            return urls;
          }
        };

        const fetchSitemap = async (u: string, label: string): Promise<string[]> => {
          if (!u) return [];
          try {
            const timeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Timed out fetching ${label} sitemap`)), 180000)
            );
            const raw = await Promise.race([
              getUrlsFromSitemap(u, (m) => {
                ws.send(JSON.stringify({ type: "loading_urls", source: "strapi-mixed", message: `${label}: ${m}` }));
              }),
              timeout,
            ]);
            return rewriteToOrigin(raw, u);
          } catch (e: any) {
            ws.send(JSON.stringify({ type: "loading_urls", source: "strapi-mixed", message: `${label} failed: ${e.message}` }));
            return [];
          }
        };

        const fetchPdp = async (): Promise<string[]> => {
          if (!includePdp) return [];
          try {
            const timeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Timed out fetching CT PDPs")), 180000)
            );
            return await Promise.race([
              getCTProductUrls(ctEnv, (m) => {
                ws.send(JSON.stringify({ type: "loading_urls", source: "strapi-mixed", message: `CT: ${m}` }));
              }),
              timeout,
            ]);
          } catch (e: any) {
            ws.send(JSON.stringify({ type: "loading_urls", source: "strapi-mixed", message: `CT PDPs failed: ${e.message}` }));
            return [];
          }
        };

        try {
          const [contentUrls, plpUrlsRaw, pdpUrls] = await Promise.all([
            fetchSitemap(contentUrl, "Content"),
            fetchSitemap(plpUrl, "PLP"),
            fetchPdp(),
          ]);

          // PLP sitemaps list every paginated variant (?p=2, ?p=3, …).
          // The Strapi datasources on those variants are identical to the
          // main page — auditing them all is duplicate work. Keep main pages
          // only, matching how the non-strapi PLP audit's "Main page only"
          // subpage mode filters.
          const isMainPageUrl = (u: string): boolean => {
            try { return !new URL(u).searchParams.has("p"); } catch { return true; }
          };
          const plpUrls = plpUrlsRaw.filter(isMainPageUrl);
          const plpDropped = plpUrlsRaw.length - plpUrls.length;
          if (plpDropped > 0) {
            ws.send(JSON.stringify({
              type: "loading_urls",
              source: "strapi-mixed",
              message: `PLP: filtered ${plpDropped.toLocaleString()} paginated variants (?p=…), kept ${plpUrls.length.toLocaleString()} main pages`,
            }));
          }

          const merged: string[] = [];
          const seen = new Set<string>();
          const sources = new Map<string, StrapiUrlSource>();
          // pdp > plp > content — first seen wins, so iterate priority-first
          const push = (list: string[], tag: StrapiUrlSource) => {
            for (const u of list) {
              if (seen.has(u)) continue;
              seen.add(u);
              merged.push(u);
              sources.set(u, tag);
            }
          };
          push(pdpUrls, "pdp");
          push(plpUrls, "plp");
          push(contentUrls, "content");

          session.allUrls = merged;
          session.urlSources = sources;

          console.log(
            `  [${sessionId.slice(0, 8)}] Strapi-mixed loaded ${merged.length} URLs ` +
            `(content=${contentUrls.length}, plp=${plpUrls.length}, pdp=${pdpUrls.length})`
          );

          broadcastToSession(session, {
            type: "urls_loaded",
            urls: session.allUrls,
            total: session.allUrls.length,
            source: "strapi-mixed",
            breakdown: {
              content: contentUrls.length,
              plp: plpUrls.length,
              pdp: pdpUrls.length,
            },
          });
        } catch (e: any) {
          console.error(`  [${sessionId.slice(0, 8)}] strapi-mixed load error:`, e.message);
          ws.send(JSON.stringify({ type: "error", message: e.message }));
        }
        return;
      }

      const useCt = msg.sourceType === "ct";

      if (useCt) {
        const ctEnv: CTEnv = msg.env === "staging" ? "staging" : "production";
        const source = `commercetools-${ctEnv}`;
        ws.send(JSON.stringify({ type: "loading_urls", source, env: ctEnv }));
        try {
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Timed out after 3 min fetching CT products")), 180000)
          );
          const urls = await Promise.race([
            getCTProductUrls(ctEnv, (m) => {
              ws.send(JSON.stringify({ type: "loading_urls", source, env: ctEnv, message: m }));
            }),
            timeout,
          ]);
          // CT is the source of truth for uniqueness — getCTProductUrls already
          // uses a Set. Assign directly.
          session.allUrls = urls;
          session.urlSources.clear();
          console.log(`  [${sessionId.slice(0, 8)}] Loaded ${session.allUrls.length} URLs from Commercetools (${ctEnv})`);
          broadcastToSession(session, {
            type: "urls_loaded",
            urls: session.allUrls,
            total: session.allUrls.length,
            source,
            env: ctEnv,
          });
        } catch (e: any) {
          console.error(`  [${sessionId.slice(0, 8)}] load_urls error:`, e.message);
          ws.send(JSON.stringify({ type: "error", message: e.message }));
        }
        return;
      }

      // ── Sitemap path (PLP / full / lcp modes) ────────────────────────
      const source: string = (msg.source ?? "").trim();
      if (!source) {
        ws.send(JSON.stringify({ type: "error", message: "Enter a sitemap URL or page URL" }));
        return;
      }
      ws.send(JSON.stringify({ type: "loading_urls", source }));
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out after 3 min — check the URL is reachable")), 180000)
        );
        const rawUrls = await Promise.race([
          getUrlsFromSitemap(source, (m) => {
            ws.send(JSON.stringify({ type: "loading_urls", source, message: m }));
          }),
          timeout,
        ]);
        const sourceOrigin = new URL(source).origin;
        const rewritten = rawUrls.map((u) => {
          try {
            const parsed = new URL(u);
            if (parsed.origin !== sourceOrigin) {
              parsed.hostname = new URL(source).hostname;
              parsed.protocol = new URL(source).protocol;
              parsed.port = new URL(source).port;
              return parsed.toString();
            }
          } catch {}
          return u;
        });
        // Sitemap indexes commonly list the same URL in multiple child sitemaps —
        // dedupe here (preserve first-seen order) so a URL isn't audited twice.
        const seen = new Set<string>();
        session.allUrls = [];
        session.urlSources.clear();
        for (const u of rewritten) {
          if (!seen.has(u)) { seen.add(u); session.allUrls.push(u); }
        }
        const dupCount = rewritten.length - session.allUrls.length;
        console.log(
          `  [${sessionId.slice(0, 8)}] Loaded ${session.allUrls.length} URLs from ${source}` +
          (dupCount > 0 ? ` (${dupCount} duplicate${dupCount === 1 ? "" : "s"} removed)` : "")
        );
        broadcastToSession(session, {
          type: "urls_loaded",
          urls: session.allUrls,
          total: session.allUrls.length,
          source,
        });
      } catch (e: any) {
        console.error(`  [${sessionId.slice(0, 8)}] load_urls error:`, e.message);
        ws.send(JSON.stringify({ type: "error", message: e.message }));
      }
      return;
    }

    // ── Stop audit ────────────────────────────────────────────────────
    // Cooperative stop: sets cancelled + aborts the run's AbortController.
    // Queued tasks in pLimit see signal.cancelled and skip. In-flight
    // Playwright pages still need to close naturally, so a large batch may
    // take a few seconds to fully drain. Use force_stop for immediate exit.
    if (msg.type === "stop_audit") {
      if (session.auditRunning) {
        session.signal.cancelled = true;
        try { session.signal.aborter?.abort(); } catch {}
        // Immediately mark all still-running URLs as failed for instant UI feedback
        for (const prog of session.progressMap.values()) {
          if (prog.status === "running") {
            const failed: AuditProgress = { url: prog.url, status: "failed" };
            session.progressMap.set(prog.url, failed);
            broadcastToSession(session, { type: "progress", progress: failed });
          }
        }
        const total = session.progressMap.size;
        const stopped = [...session.progressMap.values()].filter(
          (p) => p.status === "done" || p.status === "failed"
        ).length;
        broadcastToSession(session, { type: "audit_stopping", stopped, total });
        console.log(`  [${sessionId.slice(0, 8)}] Audit cancellation requested (${stopped}/${total}).`);
      }
      return;
    }

    // ── Force stop ─────────────────────────────────────────────────────
    // Hard cancel — immediately fires `done`, skips report generation, and
    // marks the session complete regardless of any tasks still draining in
    // the background. Use when Stop is too slow at high URL counts.
    if (msg.type === "force_stop") {
      if (session.auditRunning) {
        session.signal.cancelled = true;
        try { session.signal.aborter?.abort(); } catch {}
        for (const prog of session.progressMap.values()) {
          if (prog.status === "running" || prog.status === "pending") {
            const failed: AuditProgress = { url: prog.url, status: "failed" };
            session.progressMap.set(prog.url, failed);
            broadcastToSession(session, { type: "progress", progress: failed });
          }
        }
        session.auditRunning = false;
        session.auditDone = true;
        const total = session.progressMap.size;
        broadcastToSession(session, {
          type: "done",
          total,
          hasReport: false,
          hasPdpReport: false,
          hasStrapiReport: false,
          hasPdf: false,
          forced: true,
        });
        console.log(`  [${sessionId.slice(0, 8)}] Force stop — abandoned run at ${total} URLs.`);
      }
      return;
    }

    // ── Start audit ───────────────────────────────────────────────────
    if (msg.type === "start") {
      if (session.auditRunning) {
        ws.send(JSON.stringify({ type: "error", message: "An audit is already running in this session" }));
        return;
      }

      const quickMode: boolean = !!msg.quickMode;
      const auditMode: "full" | "products" | "lcp" | "pdp-data" | "strapi" = msg.auditMode ?? "full";
      const pdpChecks: string[] = Array.isArray(msg.pdpChecks)
        ? msg.pdpChecks.filter((k: unknown): k is string => typeof k === "string")
        : [];
      const selectedProfileIds: string[] = msg.profileIds ?? DEVICE_PROFILES.map((p) => p.id);
      const urlCount: number = msg.urlCount ?? session.allUrls.length;
      const selectedProfiles = DEVICE_PROFILES.filter((p) => selectedProfileIds.includes(p.id));

      const manualUrls: string[] = (msg.manualUrls ?? [])
        .map((u: string) => u.trim())
        .filter((u: string) => u.startsWith("http"));

      const sitemapSlice = session.allUrls.slice(0, urlCount);
      const urlsToRun = [...manualUrls, ...sitemapSlice.filter((u) => !manualUrls.includes(u))];

      if (!selectedProfiles.length || !urlsToRun.length) {
        ws.send(JSON.stringify({ type: "error", message: "No profiles or URLs to run" }));
        return;
      }

      // Reset session for new run
      clearSessionVideos(session);
      session.signal = { cancelled: false, aborter: new AbortController() };
      session.auditRunning = true;
      session.auditDone = false;
      session.lastReportHtml = "";
      session.lastProductReportHtml = "";
      session.lastPdpReportHtml = "";
      session.lastStrapiReportHtml = "";
      session.lastStrapiReportCsv = "";
      session.lastReportTs = "";
      session.lastHasPdf = false;
      session.progressMap.clear();
      for (const u of urlsToRun) session.progressMap.set(u, { url: u, status: "pending" });
      // Remember the exact config so a later retest reuses the same profiles,
      // audit mode, and PDP checks without asking the client to re-send them.
      session.lastRunOptions = {
        profileIds: selectedProfiles.map((p) => p.id),
        auditMode,
        pdpChecks,
        quickMode,
      };

      broadcastToSession(session, { type: "start", urls: urlsToRun, profiles: selectedProfiles });
      console.log(`\n  [${sessionId.slice(0, 8)}] Audit: ${urlsToRun.length} URLs × ${selectedProfiles.length} profiles`);

      setImmediate(async () => {
        try {
          const effectiveConcurrency =
            // SSR-only modes fan out to 25 — KWH's Cloudflare occasionally
            // 403s a request under sustained load, but the runner retries
            // once with backoff on 403, so the effective failure rate is
            // near zero and full throughput is preserved.
            auditMode === "pdp-data" ? Math.max(concurrency, 25)
            : auditMode === "strapi" ? Math.max(concurrency, 25)
            : auditMode === "products" ? Math.max(concurrency, 20)
            : quickMode ? Math.max(concurrency, 15)
            : concurrency;

          const allProgress = await runAudit(urlsToRun, {
            concurrency: effectiveConcurrency,
            videosDir: session.sessionVideosDir,
            profiles: selectedProfiles,
            quickMode,
            auditMode,
            pdpChecks,
            signal: session.signal,
            onProgress: (progress) => {
              // After cancellation, don't let stale "running" updates from still-
              // draining in-flight tasks overwrite the "failed" state we already set.
              if (session.signal.cancelled && progress.status === "running") return;
              session.progressMap.set(progress.url, progress);
              const { screenshots, ...rest } = progress;
              broadcastToSession(session, { type: "progress", progress: rest });

              for (const r of progress.results ?? []) {
                if (r.videoPath && !session.currentSessionVideos.includes(r.videoPath)) {
                  session.currentSessionVideos.push(r.videoPath);
                }
              }

              const done = [...session.progressMap.values()].filter(
                (p) => p.status === "done" || p.status === "failed"
              ).length;
              process.stdout.write(`\r  [${sessionId.slice(0, 8)}] ${done} / ${urlsToRun.length} done   `);
            },
            onScreenshot: (quickMode || auditMode === "products" || auditMode === "pdp-data" || auditMode === "strapi") ? undefined : (url, profileId, png) => {
              broadcastToSession(session, { type: "screenshot", url, profileId, png });
            },
          });

          // If force_stop already fired `done` for this session, don't run
          // reports or broadcast a second done — the client has moved on.
          if (session.auditDone && session.signal.cancelled) {
            console.log(`  [${sessionId.slice(0, 8)}] Drain complete after force stop — skipping reports.`);
            return;
          }

          session.auditRunning = false;
          session.auditDone = true;

          for (const p of allProgress) {
            for (const r of p.results ?? []) {
              if (r.videoPath && !session.currentSessionVideos.includes(r.videoPath)) {
                session.currentSessionVideos.push(r.videoPath);
              }
            }
          }

          console.log(`\n\n  [${sessionId.slice(0, 8)}] Generating reports…`);
          const allResults = allProgress.flatMap((p) => p.results ?? []);
          session.lastReportTs = nowForFilename();

          if (auditMode === "pdp-data") {
            session.lastPdpReportHtml = generatePdpReportHTML(allResults, pdpChecks);
          } else if (auditMode === "strapi") {
            session.lastStrapiReportHtml = generateStrapiReportHTML(allResults, session.urlSources);
            session.lastStrapiReportCsv = generateStrapiReportCSV(allResults, session.urlSources);
          } else {
            session.lastReportHtml = generateHTMLReport(allResults);
            session.lastProductReportHtml = generateProductReportHTML(allResults);
          }

          try {
            if (auditMode === "pdp-data") {
              await generatePDF(session.lastPdpReportHtml, `pdp-report-${sessionId}.pdf`, false, true, "PDP Empty-Data Report");
            } else if (auditMode === "strapi") {
              await generatePDF(session.lastStrapiReportHtml, `strapi-report-${sessionId}.pdf`, false, true, "Datasource Scan — Strapi + Builder");
            } else {
              await generatePDF(session.lastReportHtml, `report-${sessionId}.pdf`, true, false, "Audit Report");
              await generatePDF(session.lastProductReportHtml, `product-report-${sessionId}.pdf`, false, true, "Product Count Report");
            }
            session.lastHasPdf = true;
          } catch (e: any) {
            console.warn(`  [${sessionId.slice(0, 8)}] PDF skipped:`, e.message);
          }

          broadcastToSession(session, {
            type: "done",
            total: allProgress.length,
            hasReport: auditMode !== "pdp-data" && auditMode !== "strapi",
            hasPdpReport: auditMode === "pdp-data",
            hasStrapiReport: auditMode === "strapi",
            hasPdf: session.lastHasPdf,
            reportTs: session.lastReportTs,
          });
          console.log(`  [${sessionId.slice(0, 8)}] Done — ${allProgress.length} URLs · ${session.currentSessionVideos.length} videos`);
        } catch (e: any) {
          session.auditRunning = false;
          console.error(`\n  [${sessionId.slice(0, 8)}] Audit error:`, e.message);
          broadcastToSession(session, { type: "error", message: `Audit failed: ${e.message}` });
          broadcastToSession(session, { type: "done", total: 0, hasReport: false, hasPdf: false });
        }
      });
    }

    // ── Retest specific URLs (uses last-run options) ─────────────────────
    if (msg.type === "retest_urls") {
      if (session.auditRunning) {
        ws.send(JSON.stringify({ type: "error", message: "An audit is already running in this session" }));
        return;
      }
      if (!session.lastRunOptions) {
        ws.send(JSON.stringify({ type: "error", message: "No previous run to retest. Start a fresh audit first." }));
        return;
      }

      const requested: string[] = Array.isArray(msg.urls)
        ? msg.urls.filter((u: unknown): u is string => typeof u === "string" && u.startsWith("http"))
        : [];
      // Only retest URLs that were part of the previous run so a stale client
      // can't smuggle arbitrary URLs through.
      const urlsToRun = requested.filter((u) => session.progressMap.has(u));
      if (!urlsToRun.length) {
        ws.send(JSON.stringify({ type: "error", message: "No matching URLs to retest" }));
        return;
      }

      const { profileIds, auditMode, pdpChecks, quickMode } = session.lastRunOptions;
      const selectedProfiles = DEVICE_PROFILES.filter((p) => profileIds.includes(p.id));
      if (!selectedProfiles.length) {
        ws.send(JSON.stringify({ type: "error", message: "Last run's device profiles are no longer available" }));
        return;
      }

      // Reset only the retested URLs' progress; leave everything else intact.
      for (const u of urlsToRun) session.progressMap.set(u, { url: u, status: "pending" });
      session.signal = { cancelled: false, aborter: new AbortController() };
      session.auditRunning = true;
      session.auditDone = false;

      broadcastToSession(session, { type: "retest_start", urls: urlsToRun });
      // Emit a pending progress for each so the client immediately shows them
      // as queued rather than keeping their stale "done/failed" chip.
      for (const u of urlsToRun) {
        broadcastToSession(session, { type: "progress", progress: { url: u, status: "pending" } });
      }
      console.log(`\n  [${sessionId.slice(0, 8)}] Retest: ${urlsToRun.length} URLs × ${selectedProfiles.length} profiles`);

      setImmediate(async () => {
        try {
          const effectiveConcurrency =
            // Full throughput restored — the runner retries once on 403, so
            // occasional Cloudflare rate-limits don't lose URLs.
            auditMode === "pdp-data" ? Math.max(concurrency, 25)
            : auditMode === "strapi" ? Math.max(concurrency, 25)
            : auditMode === "products" ? Math.max(concurrency, 20)
            : quickMode ? Math.max(concurrency, 15)
            : concurrency;

          await runAudit(urlsToRun, {
            concurrency: effectiveConcurrency,
            videosDir: session.sessionVideosDir,
            profiles: selectedProfiles,
            quickMode,
            auditMode,
            pdpChecks,
            signal: session.signal,
            onProgress: (progress) => {
              if (session.signal.cancelled && progress.status === "running") return;
              session.progressMap.set(progress.url, progress);
              const { screenshots, ...rest } = progress;
              broadcastToSession(session, { type: "progress", progress: rest });

              for (const r of progress.results ?? []) {
                if (r.videoPath && !session.currentSessionVideos.includes(r.videoPath)) {
                  session.currentSessionVideos.push(r.videoPath);
                }
              }
            },
            onScreenshot: (quickMode || auditMode === "products" || auditMode === "pdp-data" || auditMode === "strapi") ? undefined : (url, profileId, png) => {
              broadcastToSession(session, { type: "screenshot", url, profileId, png });
            },
          });

          session.auditRunning = false;
          session.auditDone = true;

          // Regenerate report from the merged progress map so retested rows
          // replace their old counterparts in the downloadable HTML/PDF.
          const mergedResults = [...session.progressMap.values()].flatMap((p) => p.results ?? []);
          session.lastReportTs = nowForFilename();
          if (auditMode === "pdp-data") {
            session.lastPdpReportHtml = generatePdpReportHTML(mergedResults, pdpChecks);
          } else if (auditMode === "strapi") {
            session.lastStrapiReportHtml = generateStrapiReportHTML(mergedResults, session.urlSources);
            session.lastStrapiReportCsv = generateStrapiReportCSV(mergedResults, session.urlSources);
          } else {
            session.lastReportHtml = generateHTMLReport(mergedResults);
            session.lastProductReportHtml = generateProductReportHTML(mergedResults);
          }

          try {
            if (auditMode === "pdp-data") {
              await generatePDF(session.lastPdpReportHtml, `pdp-report-${sessionId}.pdf`, false, true, "PDP Empty-Data Report");
            } else if (auditMode === "strapi") {
              await generatePDF(session.lastStrapiReportHtml, `strapi-report-${sessionId}.pdf`, false, true, "Datasource Scan — Strapi + Builder");
            } else {
              await generatePDF(session.lastReportHtml, `report-${sessionId}.pdf`, true, false, "Audit Report");
              await generatePDF(session.lastProductReportHtml, `product-report-${sessionId}.pdf`, false, true, "Product Count Report");
            }
            session.lastHasPdf = true;
          } catch (e: any) {
            console.warn(`  [${sessionId.slice(0, 8)}] PDF skipped:`, e.message);
          }

          broadcastToSession(session, {
            type: "done",
            total: session.progressMap.size,
            hasReport: auditMode !== "pdp-data" && auditMode !== "strapi",
            hasPdpReport: auditMode === "pdp-data",
            hasStrapiReport: auditMode === "strapi",
            hasPdf: session.lastHasPdf,
            reportTs: session.lastReportTs,
            retest: true,
          });
          console.log(`  [${sessionId.slice(0, 8)}] Retest complete — ${urlsToRun.length} URLs`);
        } catch (e: any) {
          session.auditRunning = false;
          console.error(`\n  [${sessionId.slice(0, 8)}] Retest error:`, e.message);
          broadcastToSession(session, { type: "error", message: `Retest failed: ${e.message}` });
          broadcastToSession(session, { type: "done", total: session.progressMap.size, hasReport: false, hasPdf: false, retest: true });
        }
      });
    }
  });

  ws.on("close", () => session.clients.delete(ws));
  ws.on("error", () => session.clients.delete(ws));
});

// ── Start ─────────────────────────────────────────────────────────────────
(async () => {
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  const dashUrl = `http://localhost:${port}`;

  console.log(`\n⚡  Site Audit — ${dashUrl}`);
  console.log(`    Concurrency : ${concurrency}`);
  console.log(`    Videos dir  : ${videosDir}`);
  console.log(`    Press Ctrl+C to stop\n`);

  try { await open(dashUrl); } catch {}
})();
