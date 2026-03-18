import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import { getUrlsFromSitemap } from "./sitemap";
import { runAudit, resetShuttingDown } from "./runner";
import { generateHTMLReport } from "./report";
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

// ── State ─────────────────────────────────────────────────────────────────
const progressMap = new Map<string, AuditProgress>();
let auditDone = false;
let auditRunning = false;
let allUrls: string[] = [];
let lastReportHtml = "";
// Track videos created in the current session so we can clean them on next run
let currentSessionVideos: string[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────
function clearSessionVideos() {
  for (const f of currentSessionVideos) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {}
  }
  currentSessionVideos = [];
  console.log("  Previous session videos cleared.");
}

// ── Graceful exit ─────────────────────────────────────────────────────────
let exiting = false;
function gracefulExit() {
  if (exiting) return;
  exiting = true;
  console.log("\n\n  Shutting down…");
  wss.close();
  httpServer.close(() => {
    console.log("  Goodbye.\n");
    process.exit(0);
  });
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
  // Parse URL and query string
  const [rawPath, rawQuery] = (req.url ?? "/").split("?");
  const params = new URLSearchParams(rawQuery ?? "");

  if (rawPath === "/" || rawPath === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml);
    return;
  }

  if (rawPath === "/report") {
    if (!lastReportHtml) {
      res.writeHead(404);
      res.end("No report yet");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(lastReportHtml);
    return;
  }

  if (rawPath === "/report.pdf") {
    const p = path.join(process.cwd(), "report.pdf");
    if (!fs.existsSync(p)) {
      res.writeHead(404);
      res.end("No PDF yet");
      return;
    }
    const stat = fs.statSync(p);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": "attachment; filename=audit-report.pdf",
    });
    fs.createReadStream(p).pipe(res);
    return;
  }

  if (rawPath === "/report.html") {
    if (!lastReportHtml) {
      res.writeHead(404);
      res.end("No report yet");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "attachment; filename=audit-report.html",
    });
    res.end(lastReportHtml);
    return;
  }

  // Video streaming + optional download
  if (rawPath.startsWith("/videos/")) {
    const fp = path.join(process.cwd(), rawPath);
    if (!fs.existsSync(fp)) {
      res.writeHead(404);
      res.end("Video not found");
      return;
    }

    const stat = fs.statSync(fp);
    const mime = fp.endsWith(".mp4") ? "video/mp4" : "video/webm";
    const fname = path.basename(fp);
    const download = params.get("download") === "1";

    // Support HTTP Range requests so Safari/mobile can seek
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
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.send(
    JSON.stringify({
      type: "init",
      profiles: DEVICE_PROFILES,
      urls: allUrls,
      progress: [...progressMap.values()],
      running: auditRunning,
      done: auditDone,
      hasReport: !!lastReportHtml,
    })
  );

  ws.on("message", async (raw) => {
    if (exiting) return;
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ── Load sitemap ──────────────────────────────────────────────────
    if (msg.type === "load_urls") {
      const source: string = (msg.source ?? "").trim();
      if (!source) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "Enter a sitemap URL or page URL",
          })
        );
        return;
      }
      ws.send(JSON.stringify({ type: "loading_urls", source }));
      try {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error("Timed out after 45s — check the URL is reachable")
              ),
            45000
          )
        );
        allUrls = await Promise.race([getUrlsFromSitemap(source), timeout]);
        console.log(`  Loaded ${allUrls.length} URLs from ${source}`);
        broadcast({
          type: "urls_loaded",
          urls: allUrls,
          total: allUrls.length,
          source,
        });
      } catch (e: any) {
        console.error("  load_urls error:", e.message);
        ws.send(JSON.stringify({ type: "error", message: e.message }));
      }
      return;
    }

    // ── Start audit ───────────────────────────────────────────────────
    if (msg.type === "start") {
      if (auditRunning) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "An audit is already running",
          })
        );
        return;
      }

      const selectedProfileIds: string[] =
        msg.profileIds ?? DEVICE_PROFILES.map((p) => p.id);
      const urlCount: number = msg.urlCount ?? allUrls.length;
      const selectedProfiles = DEVICE_PROFILES.filter((p) =>
        selectedProfileIds.includes(p.id)
      );

      const manualUrls: string[] = (msg.manualUrls ?? [])
        .map((u: string) => u.trim())
        .filter((u: string) => u.startsWith("http"));

      const sitemapSlice = allUrls.slice(0, urlCount);
      const urlsToRun = [
        ...manualUrls,
        ...sitemapSlice.filter((u) => !manualUrls.includes(u)),
      ];

      if (!selectedProfiles.length || !urlsToRun.length) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "No profiles or URLs to run",
          })
        );
        return;
      }

      // ── Clear previous session's videos before starting new run ──────
      clearSessionVideos();

      auditRunning = true;
      auditDone = false;
      lastReportHtml = "";
      progressMap.clear();
      for (const u of urlsToRun)
        progressMap.set(u, { url: u, status: "pending" });

      broadcast({ type: "start", urls: urlsToRun, profiles: selectedProfiles });
      console.log(
        `\n  Audit: ${urlsToRun.length} URLs × ${selectedProfiles.length} profiles`
      );

      setImmediate(async () => {
        try {
          resetShuttingDown();
          const allProgress = await runAudit(urlsToRun, {
            concurrency,
            videosDir,
            profiles: selectedProfiles,
            onProgress: (progress) => {
              progressMap.set(progress.url, progress);
              const { screenshots, ...rest } = progress;
              broadcast({ type: "progress", progress: rest });

              // Track video paths as they come in
              for (const r of progress.results ?? []) {
                if (
                  r.videoPath &&
                  !currentSessionVideos.includes(r.videoPath)
                ) {
                  currentSessionVideos.push(r.videoPath);
                }
              }

              const done = [...progressMap.values()].filter(
                (p) => p.status === "done" || p.status === "failed"
              ).length;
              process.stdout.write(`\r  ${done} / ${urlsToRun.length} done   `);
            },
            onScreenshot: (url, profileId, png) => {
              broadcast({ type: "screenshot", url, profileId, png });
            },
          });

          auditRunning = false;
          auditDone = true;

          // Also collect any videos we might have missed
          for (const p of allProgress) {
            for (const r of p.results ?? []) {
              if (r.videoPath && !currentSessionVideos.includes(r.videoPath)) {
                currentSessionVideos.push(r.videoPath);
              }
            }
          }

          console.log(`\n\n  Generating reports…`);
          lastReportHtml = generateHTMLReport(
            allProgress.flatMap((p) => p.results ?? [])
          );
          fs.writeFileSync("report.html", lastReportHtml, "utf-8");

          let hasPdf = false;
          try {
            await generatePDF(lastReportHtml);
            hasPdf = true;
          } catch (e: any) {
            console.warn("  PDF skipped:", e.message);
          }

          broadcast({
            type: "done",
            total: allProgress.length,
            hasReport: true,
            hasPdf,
          });
          console.log(
            `  Done — ${allProgress.length} URLs · ${currentSessionVideos.length} videos`
          );
          console.log("  Ready for another run.\n");
        } catch (e: any) {
          auditRunning = false;
          console.error("\n  Audit error:", e.message);
          broadcast({ type: "error", message: `Audit failed: ${e.message}` });
          broadcast({
            type: "done",
            total: 0,
            hasReport: false,
            hasPdf: false,
          });
        }
      });
    }
  });

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────
(async () => {
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  const dashUrl = `http://localhost:${port}`;

  console.log(`\n⚡  Site Audit — ${dashUrl}`);
  console.log(`    Concurrency : ${concurrency}`);
  console.log(`    Videos dir  : ${videosDir}`);
  console.log(`    Press Ctrl+C to stop\n`);

  try {
    await open(dashUrl);
  } catch {}
})();
