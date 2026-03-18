import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

export async function generatePDF(html: string): Promise<void> {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  // Write HTML to a temp file and load it (allows relative video paths to resolve)
  const tmpPath = path.resolve("./report_tmp.html");
  fs.writeFileSync(tmpPath, html, "utf-8");

  await page.goto(`file://${tmpPath}`, { waitUntil: "networkidle" });

  await page.pdf({
    path: "report.pdf",
    format: "A4",
    printBackground: true,
    margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" },
  });

  await browser.close();

  // Clean up temp file
  try {
    fs.unlinkSync(tmpPath);
  } catch {}
}
