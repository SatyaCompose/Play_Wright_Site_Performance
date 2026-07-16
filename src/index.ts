import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import { getUrlsFromSitemap } from "./sitemap";
import { runAudit, closeAllBrowsers } from "./runner";
import { generateHTMLReport } from "./report";
import { generateProductReportHTML } from "./product-report";
import { generatePdpReportHTML } from "./pdp-report";
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
interface Session {
  id: string;
  progressMap: Map<string, AuditProgress>;
  auditDone: boolean;
  auditRunning: boolean;
  allUrls: string[];
  lastReportHtml: string;
  lastProductReportHtml: string;
  lastPdpReportHtml: string;
  lastHasPdf: boolean;
  sessionVideosDir: string;
  currentSessionVideos: string[];
  signal: { cancelled: boolean; aborter?: AbortController };
  clients: Set<WebSocket>;
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
      lastReportHtml: "",
      lastProductReportHtml: "",
      lastPdpReportHtml: "",
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

  if (rawPath === "/report.html") {
    const html = session?.lastReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "attachment; filename=audit-report.html",
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
      "Content-Disposition": "attachment; filename=audit-report.pdf",
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (rawPath === "/product-report.html") {
    const html = session?.lastProductReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No product report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "attachment; filename=product-report.html",
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
      "Content-Disposition": "attachment; filename=product-report.pdf",
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (rawPath === "/pdp-report.html") {
    const html = session?.lastPdpReportHtml ?? "";
    if (!html) { res.writeHead(404); res.end("No PDP report yet"); return; }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "attachment; filename=pdp-report.html",
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
      "Content-Disposition": "attachment; filename=pdp-report.pdf",
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
      hasPdf: session.lastHasPdf,
    })
  );

  ws.on("message", async (raw) => {
    if (exiting) return;
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // ── Load sitemap ──────────────────────────────────────────────────
    if (msg.type === "load_urls") {
      const source: string = (msg.source ?? "").trim();
      if (!source) {
        ws.send(JSON.stringify({ type: "error", message: "Enter a sitemap URL or page URL" }));
        return;
      }
      ws.send(JSON.stringify({ type: "loading_urls", source }));
      try {
        // Large PDP sitemap indexes can legitimately take a while — the p-limit(6)
        // cap in sitemap.ts means N child sitemaps take ceil(N/6) round-trips.
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out after 3 min — check the URL is reachable")), 180000)
        );
        const rawUrls = await Promise.race([
          getUrlsFromSitemap(source, (msg) => {
            ws.send(JSON.stringify({ type: "loading_urls", source, message: msg }));
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
        // Dedupe while preserving first-seen order. Sitemap indexes commonly
        // list the same URL in multiple child sitemaps — without this the same
        // URL runs twice, and its dashboard entry flips between running/done.
        const seen = new Set<string>();
        session.allUrls = [];
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
      const auditMode: "full" | "products" | "lcp" | "pdp-data" = msg.auditMode ?? "full";
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
      session.lastHasPdf = false;
      session.progressMap.clear();
      for (const u of urlsToRun) session.progressMap.set(u, { url: u, status: "pending" });

      broadcastToSession(session, { type: "start", urls: urlsToRun, profiles: selectedProfiles });
      console.log(`\n  [${sessionId.slice(0, 8)}] Audit: ${urlsToRun.length} URLs × ${selectedProfiles.length} profiles`);

      setImmediate(async () => {
        try {
          const effectiveConcurrency =
            auditMode === "pdp-data" ? Math.max(concurrency, 25)   // Playwright w/ subresource block + disconnect/timeout guards
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
            onScreenshot: (quickMode || auditMode === "products" || auditMode === "pdp-data") ? undefined : (url, profileId, png) => {
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

          if (auditMode === "pdp-data") {
            session.lastPdpReportHtml = generatePdpReportHTML(allResults, pdpChecks);
          } else {
            session.lastReportHtml = generateHTMLReport(allResults);
            session.lastProductReportHtml = generateProductReportHTML(allResults);
          }

          try {
            if (auditMode === "pdp-data") {
              await generatePDF(session.lastPdpReportHtml, `pdp-report-${sessionId}.pdf`, false, true, "PDP Empty-Data Report");
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
            hasReport: auditMode !== "pdp-data",
            hasPdpReport: auditMode === "pdp-data",
            hasPdf: session.lastHasPdf,
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
