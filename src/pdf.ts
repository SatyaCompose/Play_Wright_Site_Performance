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

  const page = await browser.newPage();

  // Write HTML to a temp file and load it (allows relative video paths to resolve)
  const tmpPath = path.resolve("./report_tmp.html");
  fs.writeFileSync(tmpPath, html, "utf-8");

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

  await browser.close();

  // Clean up temp file
  try {
    fs.unlinkSync(tmpPath);
  } catch {}
}
