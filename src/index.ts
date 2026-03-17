import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import { getUrlsFromSitemap } from "./sitemap";
import { runAudit } from "./runner";
import { generateHTMLReport } from "./report";
import { generatePDF } from "./pdf";
import type { AuditProgress } from "./types";
import { DEVICE_PROFILES } from "./types";

// ── Config — all from env or CLI, no hardcodes ────────────────────────────
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
let lastReportHtml = ""; // kept in memory so UI can fetch it

// ── Ensure dirs exist ─────────────────────────────────────────────────────
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

// ── HTTP server ───────────────────────────────────────────────────────────
const dashboardHtml = fs.readFileSync(
  path.join(__dirname, "dashboard.html"),
  "utf-8"
);

const httpServer = http.createServer((req, res) => {
  const url = req.url ?? "/";

  // Dashboard
  if (url === "/" || url === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml);
    return;
  }

  // Report HTML — served inline for preview iframe
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

  // Report PDF download
  if (url === "/report.pdf") {
    const pdfPath = path.join(process.cwd(), "report.pdf");
    if (!fs.existsSync(pdfPath)) {
      res.writeHead(404);
      res.end("No PDF yet");
      return;
    }
    const stat = fs.statSync(pdfPath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": stat.size,
      "Content-Disposition": "attachment; filename=audit-report.pdf",
    });
    fs.createReadStream(pdfPath).pipe(res);
    return;
  }

  // Report HTML download
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

  // Video files
  if (url.startsWith("/videos/")) {
    const filePath = path.join(process.cwd(), url);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const mime = filePath.endsWith(".mp4") ? "video/mp4" : "video/webm";
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": stat.size,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath).pipe(res);
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
    try {
      const msg = JSON.parse(raw.toString());

      // ── Load sitemap / URLs from source ──────────────────────────────
      if (msg.type === "load_urls") {
        const source: string = (msg.source ?? "").trim();
        if (!source) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "No URL or sitemap provided",
            })
          );
          return;
        }
        ws.send(JSON.stringify({ type: "loading_urls", source }));
        try {
          // Race against a 45s timeout so the UI never hangs
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    "Request timed out after 45s — check the URL is accessible"
                  )
                ),
              45000
            )
          );
          allUrls = await Promise.race([
            getUrlsFromSitemap(source),
            timeoutPromise,
          ]);
          console.log(`  Loaded ${allUrls.length} URLs from ${source}`);
          broadcast({
            type: "urls_loaded",
            urls: allUrls,
            total: allUrls.length,
            source,
          });
        } catch (e: any) {
          console.error("  load_urls failed:", e.message);
          ws.send(JSON.stringify({ type: "error", message: e.message }));
        }
        return;
      }

      // ── Start audit ───────────────────────────────────────────────────
      if (msg.type === "start" && !auditRunning) {
        const selectedProfileIds: string[] =
          msg.profileIds ?? DEVICE_PROFILES.map((p) => p.id);
        const urlCount: number = msg.urlCount ?? allUrls.length;
        const selectedProfiles = DEVICE_PROFILES.filter((p) =>
          selectedProfileIds.includes(p.id)
        );

        // Manual URLs pasted in textarea
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
              message: "No profiles or URLs selected",
            })
          );
          return;
        }

        auditRunning = true;
        auditDone = false;
        lastReportHtml = "";
        progressMap.clear();
        for (const u of urlsToRun)
          progressMap.set(u, { url: u, status: "pending" });

        broadcast({
          type: "start",
          urls: urlsToRun,
          profiles: selectedProfiles,
        });
        console.log(
          `\n  Audit: ${urlsToRun.length} URLs × ${selectedProfiles.length} profiles`
        );

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

        auditRunning = false;
        auditDone = true;

        // Generate reports
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
      }
    } catch (e: any) {
      console.error("WS error:", e.message);
    }
  });

  ws.on("close", () => clients.delete(ws));
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
  console.log(`    No sitemap hardcoded — configure in UI\n`);

  try {
    await open(dashUrl);
  } catch {}
})();
