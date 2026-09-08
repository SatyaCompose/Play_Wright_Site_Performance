import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

export async function generatePDF(
  html: string,
  outPath = "report.pdf",
  landscape = true,
  pageNumbers = false,
  footerTitle = "Audit Report"
): Promise<void> {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  // Unique temp path per call — concurrent sessions can otherwise race on
  // the same file (Session A finishing report + Session B finishing product
  // report at the same moment would collide and one would render blank).
  const tmpPath = path.resolve(
    `./report_tmp_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.html`
  );

  try {
    fs.writeFileSync(tmpPath, html, "utf-8");

    const page = await browser.newPage();
    await page.goto(`file://${tmpPath}`, { waitUntil: "networkidle" });

    const footerTemplate = `
      <div style="width:100%;padding:0 28px;display:flex;justify-content:space-between;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:9px;color:#9ca3af;">
        <span>${footerTitle} &mdash; Confidential</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>`;

    await page.pdf({
      path: outPath,
      format: "A4",
      landscape,
      printBackground: true,
      displayHeaderFooter: pageNumbers,
      headerTemplate: "<span></span>",
      footerTemplate: pageNumbers ? footerTemplate : "<span></span>",
      margin: {
        top: "20px",
        bottom: pageNumbers ? "36px" : "20px",
        left: "20px",
        right: "20px",
      },
    });
  } finally {
    // Always close the browser and remove the temp file, even if page.pdf()
    // throws — otherwise a rendering error would leak a chromium process
    // (and, on containerised hosts, eventually EAGAIN the next launch).
    try { await browser.close(); } catch {}
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
