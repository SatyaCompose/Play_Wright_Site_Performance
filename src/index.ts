import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import { WebSocketServer, WebSocket } from "ws";
import open from "open";
import { getUrlsFromSitemap } from "./sitemap";
import { runAudit } from "./runner";
import { generateHTMLReport } from "./report";
import { generatePDF } from "./pdf";
import type { AuditProgress, PageResult } from "./types";

// ── CLI args ──────────────────────────────────────────────────────────────
const sitemapUrl = process.argv[2];
const concurrency = parseInt(process.argv[3] ?? "3", 10);
const port = parseInt(process.argv[4] ?? "7331", 10);

if (!sitemapUrl) {
  console.error(
    "\nUsage: npm run dev <sitemap_url> [concurrency] [port]\n" +
      "  Example: npm run dev https://example.com/sitemap.xml 5\n"
  );
  process.exit(1);
}

// ── State ─────────────────────────────────────────────────────────────────
const progressMap = new Map<string, AuditProgress>();
const allResults: PageResult[] = [];
let auditDone = false;

// ── HTTP server — serves dashboard.html + video files ─────────────────────
const dashboardPath = path.join(__dirname, "dashboard.html");
const dashboardHtml = fs.readFileSync(dashboardPath, "utf-8");

const httpServer = http.createServer((req, res) => {
  const url = req.url ?? "/";

  if (url === "/" || url === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(dashboardHtml);
    return;
  }

  // Serve recorded videos from ./videos/
  if (url.startsWith("/videos/")) {
    const filePath = path.join(process.cwd(), url);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      res.writeHead(200, {
        "Content-Type": "video/webm",
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

// ── WebSocket — streams progress events to every open browser tab ─────────
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set<WebSocket>();

wss.on("connection", (ws) => {
  clients.add(ws);

  // Replay full current state so late-joiners catch up instantly
  ws.send(
    JSON.stringify({ type: "init", progress: [...progressMap.values()] })
  );
  if (auditDone) {
    ws.send(JSON.stringify({ type: "done", total: allResults.length }));
  }

  ws.on("close", () => clients.delete(ws));
});

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  const dashUrl = `http://localhost:${port}`;

  console.log(`\n⚡  Site Audit Dashboard → ${dashUrl}`);
  console.log(`    Sitemap     : ${sitemapUrl}`);
  console.log(`    Concurrency : ${concurrency}`);
  console.log(`    Opening browser…\n`);
  try {
    await open(dashUrl);
  } catch {}

  // Fetch sitemap
  let urls: string[];
  try {
    urls = await getUrlsFromSitemap(sitemapUrl);
    console.log(`  ${urls.length} URLs found`);
  } catch (err: any) {
    console.error("Sitemap fetch failed:", err.message);
    process.exit(1);
  }

  // Seed all URLs as pending so dashboard shows the full list immediately
  for (const url of urls) {
    progressMap.set(url, { url, status: "pending" });
  }
  broadcast({ type: "urls", urls });

  // Run audit — each completed page fires onProgress + live screenshots
  const results = await runAudit(urls, {
    concurrency,
    videosDir: "./videos",
    onProgress: (progress) => {
      progressMap.set(progress.url, progress);
      broadcast({ type: "progress", progress });
      const done = [...progressMap.values()].filter(
        (p) => p.status === "done" || p.status === "failed"
      ).length;
      process.stdout.write(`\r  ${done} / ${urls.length} done   `);
    },
    onScreenshot: (url, png) => {
      // Only send to clients currently viewing this URL to avoid flooding
      broadcast({ type: "screenshot", url, png });
    },
  });

  allResults.push(...results);
  auditDone = true;

  console.log(`\n\n  Audit complete — ${results.length} pages`);

  // Reports
  process.stdout.write("  Generating report.html… ");
  const reportHtml = generateHTMLReport(results);
  fs.writeFileSync("report.html", reportHtml, "utf-8");
  console.log("done");

  process.stdout.write("  Generating report.pdf…  ");
  try {
    await generatePDF(reportHtml);
    console.log("done");
  } catch (err: any) {
    console.log("skipped —", err.message);
  }

  broadcast({ type: "done", total: results.length });
  console.log(`\n  Dashboard still live at ${dashUrl}  (Ctrl+C to exit)\n`);
})();
