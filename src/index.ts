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

// Optionally limit which profiles to run: --profiles=desktop-chrome,mobile-ios
const profileArg = process.argv.find((a) => a.startsWith("--profiles="));
const profileIds = profileArg
  ? profileArg.replace("--profiles=", "").split(",")
  : null;
const profiles = profileIds
  ? DEVICE_PROFILES.filter((p) => profileIds.includes(p.id))
  : DEVICE_PROFILES;

if (!sitemapUrl) {
  console.error(
    "\nUsage: npm run dev <sitemap_url> [concurrency] [port] [--profiles=id1,id2]\n" +
      "  Profiles: desktop-chrome, desktop-safari, mobile-ios, mobile-android\n" +
      "  Example: npm run dev https://example.com/sitemap.xml 3 7331 --profiles=desktop-chrome,mobile-ios\n"
  );
  process.exit(1);
}

// ── State ─────────────────────────────────────────────────────────────────
const progressMap = new Map<string, AuditProgress>();
let auditDone = false;

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
  ws.send(
    JSON.stringify({
      type: "init",
      progress: [...progressMap.values()],
      profiles,
    })
  );
  if (auditDone) ws.send(JSON.stringify({ type: "done" }));
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
  console.log(`    Profiles    : ${profiles.map((p) => p.label).join(", ")}`);
  try {
    await open(dashUrl);
  } catch {}

  let urls: string[];
  try {
    urls = await getUrlsFromSitemap(sitemapUrl);
    console.log(`\n  ${urls.length} URLs found`);
  } catch (err: any) {
    console.error("Sitemap fetch failed:", err.message);
    process.exit(1);
  }

  for (const url of urls) {
    progressMap.set(url, { url, status: "pending" });
  }
  broadcast({ type: "urls", urls, profiles });

  const allProgress = await runAudit(urls, {
    concurrency,
    videosDir: "./videos",
    profiles,
    onProgress: (progress) => {
      progressMap.set(progress.url, progress);
      // Don't send screenshots in the progress event (sent separately below)
      const { screenshots, ...rest } = progress;
      broadcast({ type: "progress", progress: rest });
      const done = [...progressMap.values()].filter(
        (p) => p.status === "done" || p.status === "failed"
      ).length;
      process.stdout.write(`\r  ${done} / ${urls.length} done   `);
    },
    onScreenshot: (url, profileId, png) => {
      broadcast({ type: "screenshot", url, profileId, png });
    },
  });

  auditDone = true;
  console.log(
    `\n\n  Audit complete — ${allProgress.length} URLs × ${profiles.length} profiles`
  );

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
  } catch (err: any) {
    console.log("skipped —", err.message);
  }

  broadcast({ type: "done", total: allProgress.length });
  console.log(`\n  Dashboard still live at ${dashUrl}  (Ctrl+C to exit)\n`);
})();
