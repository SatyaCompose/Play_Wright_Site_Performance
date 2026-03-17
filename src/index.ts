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

const sitemapUrl = process.argv[2];
const concurrency = parseInt(process.argv[3] ?? "3", 10);
const port = parseInt(process.argv[4] ?? "7331", 10);

if (!sitemapUrl) {
  console.error(
    "\nUsage: npm run dev <sitemap_url> [concurrency] [port]\n" +
      "  Example: npm run dev https://example.com/sitemap.xml 3 7331\n"
  );
  process.exit(1);
}

// ── State ─────────────────────────────────────────────────────────────────
const progressMap = new Map<string, AuditProgress>();
let auditDone = false;
let auditRunning = false;
let allUrls: string[] = [];

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

  // Send current state to new client
  ws.send(
    JSON.stringify({
      type: "init",
      profiles: DEVICE_PROFILES,
      urls: allUrls,
      progress: [...progressMap.values()],
      running: auditRunning,
      done: auditDone,
    })
  );

  // Handle start command from browser
  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "start" && !auditRunning) {
        const selectedProfileIds: string[] =
          msg.profileIds ?? DEVICE_PROFILES.map((p) => p.id);
        const urlCount: number = msg.urlCount ?? allUrls.length;
        const selectedProfiles = DEVICE_PROFILES.filter((p) =>
          selectedProfileIds.includes(p.id)
        );
        const urlsToRun = allUrls.slice(0, urlCount);

        if (!selectedProfiles.length) {
          ws.send(
            JSON.stringify({ type: "error", message: "No profiles selected" })
          );
          return;
        }

        auditRunning = true;
        progressMap.clear();
        for (const u of urlsToRun)
          progressMap.set(u, { url: u, status: "pending" });

        broadcast({
          type: "start",
          urls: urlsToRun,
          profiles: selectedProfiles,
        });

        console.log(
          `\n  Starting audit: ${urlsToRun.length} URLs × ${selectedProfiles.length} profiles`
        );

        const allProgress = await runAudit(urlsToRun, {
          concurrency,
          videosDir: "./videos",
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

        console.log(`\n\n  Audit complete — ${allProgress.length} URLs`);

        process.stdout.write("  Generating report.html… ");
        const reportHtml = generateHTMLReport(
          allProgress.flatMap((p) => p.results ?? [])
        );
        fs.writeFileSync("report.html", reportHtml, "utf-8");
        console.log("done");

        process.stdout.write("  Generating report.pdf…  ");
        try {
          await generatePDF(reportHtml);
          console.log("done");
        } catch (e: any) {
          console.log("skipped —", e.message);
        }

        broadcast({ type: "done", total: allProgress.length });
      }
    } catch (e: any) {
      console.error("WS message error:", e.message);
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

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  const dashUrl = `http://localhost:${port}`;

  console.log(`\n⚡  Site Audit Dashboard → ${dashUrl}`);
  console.log(`    Sitemap     : ${sitemapUrl}`);
  console.log(`    Concurrency : ${concurrency}`);

  // Fetch sitemap immediately so the UI can show URL count
  console.log("\n  Fetching sitemap…");
  try {
    allUrls = await getUrlsFromSitemap(sitemapUrl);
    console.log(
      `  ${allUrls.length} URLs loaded — open dashboard to configure & run`
    );
  } catch (err: any) {
    console.error("Sitemap fetch failed:", err.message);
    process.exit(1);
  }

  // Broadcast URLs to any already-connected clients (reconnect case)
  broadcast({ type: "urls_loaded", urls: allUrls, profiles: DEVICE_PROFILES });

  try {
    await open(dashUrl);
  } catch {}
  console.log(`\n  Dashboard: ${dashUrl}  (Ctrl+C to exit)\n`);
})();
