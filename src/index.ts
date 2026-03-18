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

// ── Ctrl+C: clean exit ────────────────────────────────────────────────────
// Runner already sets its own shuttingDown flag — here we just exit the
// process cleanly once the server and WS connections are done.
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
  // Force exit after 3s if something hangs (e.g. Playwright browser still open)
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
  const url = req.url ?? "/";

  if (url === "/" || url === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml);
    return;
  }
  if (url === "/report") {
    if (!lastReportHtml) {
      res.writeHead(404);
      res.end("No report yet");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(lastReportHtml);
    return;
  }
  if (url === "/report.pdf") {
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
  if (url === "/report.html") {
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
  if (url.startsWith("/videos/")) {
    const fp = path.join(process.cwd(), url);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      const mime = fp.endsWith(".mp4") ? "video/mp4" : "video/webm";
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(fp).pipe(res);
      return;
    }
  }
  res.writeHead(404);
  res.end("Not found");
});

// ── WebSocket ─────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);

  // Always send full current state so reconnects / refreshes work
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
    // Ignore messages while shutting down
    if (exiting) return;

    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ── Load sitemap ──────────────────────────────────────────────────
    if (msg.type === "load_urls") {
      // Allow re-loading even while auditRunning — they might be loading
      // a new sitemap to queue for the next run
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

      // ── Reset all state for the new run ──────────────────────────────
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

      // ── Run in background — don't block the message handler ──────────
      // Using setImmediate so the WS ack is sent before the heavy work starts
      setImmediate(async () => {
        try {
          resetShuttingDown(); // allow a fresh run even after a prior Ctrl+C
          const allProgress = await runAudit(urlsToRun, {
            concurrency,
            videosDir,
            profiles: selectedProfiles,
            onProgress: (progress) => {
              progressMap.set(progress.url, progress);
              const { screenshots, ...rest } = progress;
              broadcast({ type: "progress", progress: rest });
              const done = [...progressMap.values()].filter(
                (p) => p.status === "done" || p.status === "failed"
              ).length;
              process.stdout.write(`\r  ${done} / ${urlsToRun.length} done   `);
            },
            onScreenshot: (url, profileId, png) => {
              broadcast({ type: "screenshot", url, profileId, png });
            },
          });

          // ── Always reset running flag, even if something threw ────────
          auditRunning = false;
          auditDone = true;

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
          console.log(`  Done — ${allProgress.length} URLs audited\n`);
          console.log("  Ready for another run.\n");
        } catch (e: any) {
          // Ensure the flag is always reset so the user can retry
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
