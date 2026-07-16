import type { PageResult } from "./types";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Human-friendly labels for known buyBox message keys. Falls back to the raw
// key for anything the caller adds later.
const KEY_LABELS: Record<string, string> = {
  buyBoxCNCMessage: "Click & Collect",
  buyBoxMoneyBackGuaranteeMessage: "Money-Back Guarantee",
  buyBoxShippingMessage: "Shipping",
};

// Shipping + CNC are critical (error). Money-back is less critical (warning).
// Unknown keys default to error.
const KEY_SEVERITY: Record<string, "error" | "warn"> = {
  buyBoxCNCMessage: "error",
  buyBoxShippingMessage: "error",
  buyBoxMoneyBackGuaranteeMessage: "warn",
};

function labelFor(key: string): string {
  return KEY_LABELS[key] ?? key;
}

function severityOf(key: string): "error" | "warn" {
  return KEY_SEVERITY[key] ?? "error";
}

interface UrlPdpData {
  url: string;
  status: number | undefined;
  productFound: boolean;
  empty: string[];
  measured: boolean;
}

export function generatePdpReportHTML(results: PageResult[], checks: string[]): string {
  // Deduplicate by URL — pick the first result that actually has a pdpDataCheck
  const urlMap = new Map<string, UrlPdpData>();
  for (const r of results) {
    const c = r.pdpDataCheck;
    const existing = urlMap.get(r.url);
    if (!existing) {
      urlMap.set(r.url, {
        url: r.url,
        status: r.status,
        productFound: !!c?.productFound,
        empty: c?.empty ?? [],
        measured: !!c,
      });
    } else if (!existing.measured && c) {
      existing.productFound = !!c.productFound;
      existing.empty = c.empty;
      existing.measured = true;
      existing.status = r.status;
    }
  }

  const allUrls = [...urlMap.values()];
  const withProduct = allUrls.filter((u) => u.productFound);
  const withoutProduct = allUrls.filter((u) => u.measured && !u.productFound);
  const withEmpty = withProduct.filter((u) => u.empty.length > 0);
  const allOk = withProduct.filter((u) => u.empty.length === 0);

  // Per-field failure counts (only across URLs where product was found)
  const perFieldCounts = new Map<string, number>();
  for (const k of checks) perFieldCounts.set(k, 0);
  for (const u of withProduct) {
    for (const k of u.empty) {
      perFieldCounts.set(k, (perFieldCounts.get(k) ?? 0) + 1);
    }
  }

  // Sort: URLs with most empty fields first, then OK, then no-product last
  const sorted = [...allUrls].sort((a, b) => {
    const rankA = !a.measured || !a.productFound ? 2 : a.empty.length > 0 ? 0 : 1;
    const rankB = !b.measured || !b.productFound ? 2 : b.empty.length > 0 ? 0 : 1;
    if (rankA !== rankB) return rankA - rankB;
    return b.empty.length - a.empty.length;
  });

  const rowParts: string[] = [];
  let okSepInserted = false;
  let noProdSepInserted = false;
  sorted.forEach((u, i) => {
    const bucket = !u.measured || !u.productFound ? "noprod" : u.empty.length > 0 ? "empty" : "ok";

    if (bucket === "ok" && !okSepInserted) {
      okSepInserted = true;
      rowParts.push(
        `<tr class="sep-row sep-row-ok"><td colspan="4">All checked fields present &mdash; No errors</td></tr>`
      );
    }
    if (bucket === "noprod" && !noProdSepInserted) {
      noProdSepInserted = true;
      rowParts.push(
        `<tr class="sep-row sep-row-failed"><td colspan="4">No product data on page &mdash; Not a PDP or blocked</td></tr>`
      );
    }

    let statusCell: string;
    let badge: string;
    let rowClass = "";
    if (bucket === "noprod") {
      statusCell = `<span class="count-val failed-dash">&mdash;</span>`;
      badge = `<span class="badge badge-failed">No Product</span>`;
      rowClass = "failed-row";
    } else if (bucket === "ok") {
      statusCell = `<span class="count-val ok-check">&check;</span>`;
      badge = `<span class="badge badge-ok">OK</span>`;
      rowClass = "ok-row";
    } else {
      const errKeys = u.empty.filter((k) => severityOf(k) === "error");
      const warnKeys = u.empty.filter((k) => severityOf(k) === "warn");
      const chips = [
        ...errKeys.map((k) => `<span class="chip chip-empty">${escHtml(labelFor(k))}</span>`),
        ...warnKeys.map((k) => `<span class="chip chip-warn">${escHtml(labelFor(k))}</span>`),
      ].join(" ");
      statusCell = `<div class="chip-row">${chips}</div>`;
      if (errKeys.length > 0) {
        badge = `<span class="badge badge-zero">${errKeys.length} error${errKeys.length === 1 ? "" : "s"}${warnKeys.length ? ` · ${warnKeys.length} warn` : ""}</span>`;
      } else {
        badge = `<span class="badge badge-warn">${warnKeys.length} warn</span>`;
      }
    }

    rowParts.push(`
      <tr class="${rowClass}">
        <td class="col-num">${i + 1}</td>
        <td class="col-url">
          <span class="url-text" title="${escHtml(u.url)}">${escHtml(u.url)}</span>
        </td>
        <td class="col-count">${statusCell}</td>
        <td class="col-badge">${badge}</td>
      </tr>`);
  });

  const generatedAt = new Date().toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  });

  const checksSummary = checks.length
    ? checks.map((k) => escHtml(labelFor(k))).join(" &middot; ")
    : "No fields selected";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PDP Empty-Data Report</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:#fff;
  color:#111827;
  font-size:13px;
  line-height:1.5;
}
.page{max-width:1040px;margin:0 auto;padding:52px 44px;}
.accent-bar{height:4px;background:linear-gradient(90deg,#dc2626,#7c3aed);border-radius:2px;margin-bottom:36px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.report-header{
  display:flex;align-items:flex-start;justify-content:space-between;
  gap:24px;padding-bottom:22px;border-bottom:1px solid #e5e7eb;margin-bottom:36px;
}
.report-title{font-size:21px;font-weight:700;letter-spacing:-.4px;color:#111827;}
.report-subtitle{font-size:12px;color:#6b7280;margin-top:3px;}
.report-meta{text-align:right;font-size:11px;color:#6b7280;line-height:1.8;white-space:nowrap;}
.report-meta strong{color:#374151;font-weight:600;}

.checks-line{
  font-size:11px;color:#6b7280;margin-bottom:28px;padding:10px 14px;
  background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb;
}
.checks-line strong{color:#374151;}

.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:32px;}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;background:#f9fafb;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.card-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:#6b7280;margin-bottom:10px;}
.card-value{font-size:27px;font-weight:700;letter-spacing:-1px;line-height:1;color:#111827;}
.card-note{font-size:11px;color:#9ca3af;margin-top:6px;}
.card.c-green .card-value{color:#059669;}
.card.c-red .card-value{color:#dc2626;}
.card.c-amber .card-value{color:#b45309;}

.per-field{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:36px;}
.field-card{border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;background:#fff;}
.field-card .fk{font-size:11px;color:#6b7280;font-weight:500;margin-bottom:4px;}
.field-card .fv{font-size:18px;font-weight:700;color:#111827;}
.field-card .fv.ok{color:#059669;}
.field-card .fv.bad{color:#dc2626;}
.field-card .fp{font-size:10px;color:#9ca3af;margin-top:2px;}

.section-title{
  font-size:10px;font-weight:600;text-transform:uppercase;
  letter-spacing:.1em;color:#6b7280;
  padding-bottom:8px;margin-bottom:0;
  border-bottom:1px solid #e5e7eb;
}

.table-wrap{margin-bottom:40px;}
table{width:100%;border-collapse:collapse;}
thead th{
  background:#f3f4f6;padding:9px 12px;text-align:left;
  font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;
  color:#6b7280;border-bottom:1px solid #e5e7eb;
}
th.r{text-align:right;}
tbody tr{border-bottom:1px solid #f3f4f6;}
tbody tr:last-child{border-bottom:none;}
tbody tr:hover td{background:#fafafa;}
tbody tr.ok-row td{opacity:.7;}
tbody tr.failed-row td{opacity:.6;}
td{padding:9px 12px;vertical-align:middle;}

.col-num{width:36px;text-align:right;padding-right:16px;color:#d1d5db;font-size:11px;font-variant-numeric:tabular-nums;}
.col-url{max-width:520px;}
.url-text{
  font-family:'SF Mono','Fira Code','Fira Mono',ui-monospace,monospace;
  font-size:11px;color:#374151;
  display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.col-count{min-width:260px;}
.chip-row{display:flex;flex-wrap:wrap;gap:6px;}
.chip{
  display:inline-block;padding:3px 9px;border-radius:14px;
  font-size:10px;font-weight:600;letter-spacing:.02em;
}
.chip-empty{background:#fee2e2;color:#b91c1c;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.chip-warn{background:#fef3c7;color:#92400e;-webkit-print-color-adjust:exact;print-color-adjust:exact;}

.count-val{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;}
.ok-check{color:#059669;font-size:16px;}
.failed-dash{color:#d1d5db;}

.col-badge{width:130px;text-align:right;}
.badge{
  display:inline-block;padding:3px 10px;border-radius:20px;
  font-size:10px;font-weight:600;letter-spacing:.03em;
}
.badge-ok{background:#dcfce7;color:#15803d;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.badge-zero{background:#fee2e2;color:#dc2626;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.badge-warn{background:#fef3c7;color:#92400e;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.badge-failed{background:#f3f4f6;color:#6b7280;-webkit-print-color-adjust:exact;print-color-adjust:exact;}

.sep-row td{
  padding:7px 12px;background:#fef2f2;
  font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;
  color:#991b1b;border-top:1px solid #fecaca;border-bottom:1px solid #fecaca;
  opacity:1 !important;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.sep-row-ok td{background:#f0fdf4;color:#166534;border-top-color:#bbf7d0;border-bottom-color:#bbf7d0;}
.sep-row-failed td{background:#f9fafb;color:#6b7280;border-top-color:#e5e7eb;border-bottom-color:#e5e7eb;}

.report-footer{
  border-top:1px solid #e5e7eb;padding-top:14px;
  display:flex;justify-content:space-between;
  font-size:10px;color:#9ca3af;
}
@media print{
  body{font-size:11px;}
  .report-footer{display:none;}
  table thead{display:table-header-group;}
  tr{page-break-inside:avoid;}
  .sep-row{page-break-after:avoid;}
}
</style>
</head>
<body>
<div class="page">

  <div class="accent-bar"></div>

  <div class="report-header">
    <div>
      <div class="report-title">PDP Empty-Data Report</div>
      <div class="report-subtitle">Buy-box message fields that came back as hash-only placeholders</div>
    </div>
    <div class="report-meta">
      <div>Generated <strong>${generatedAt}</strong></div>
      <div>${allUrls.length.toLocaleString()} URLs audited</div>
    </div>
  </div>

  <div class="checks-line"><strong>Fields checked:</strong> ${checksSummary}</div>

  <div class="summary">
    <div class="card">
      <div class="card-label">Total URLs</div>
      <div class="card-value">${allUrls.length.toLocaleString()}</div>
      <div class="card-note">with product data: ${withProduct.length.toLocaleString()}</div>
    </div>
    <div class="card c-red">
      <div class="card-label">URLs With Empty Fields</div>
      <div class="card-value">${withEmpty.length.toLocaleString()}</div>
      <div class="card-note">need attention</div>
    </div>
    <div class="card c-green">
      <div class="card-label">All Fields OK</div>
      <div class="card-value">${allOk.length.toLocaleString()}</div>
      <div class="card-note">every checked field has real data</div>
    </div>
    <div class="card c-amber">
      <div class="card-label">No Product Detected</div>
      <div class="card-value">${withoutProduct.length.toLocaleString()}</div>
      <div class="card-note">not a PDP or page did not load</div>
    </div>
  </div>

  ${checks.length ? `
    <div class="section-title" style="margin-bottom:14px;">Per-field failure rate</div>
    <div class="per-field">
      ${checks.map((k) => {
        const count = perFieldCounts.get(k) ?? 0;
        const pct = withProduct.length ? Math.round((count / withProduct.length) * 100) : 0;
        const badClass = count > 0 ? "bad" : "ok";
        return `
          <div class="field-card">
            <div class="fk">${escHtml(labelFor(k))}</div>
            <div class="fv ${badClass}">${count.toLocaleString()}</div>
            <div class="fp">${pct}% of ${withProduct.length} pages · <code style="font-size:10px;">${escHtml(k)}</code></div>
          </div>`;
      }).join("")}
    </div>
  ` : ""}

  <div class="section-title">All URLs &mdash; sorted by errors first</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="r">#</th>
          <th>URL</th>
          <th>Empty Fields</th>
          <th class="r">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowParts.join("")}
      </tbody>
    </table>
  </div>

  <div class="report-footer">
    <span>PDP Empty-Data Report &mdash; ${generatedAt}</span>
    <span>${withEmpty.length} with errors &middot; ${allOk.length} OK &middot; ${withoutProduct.length} no product</span>
  </div>

</div>
</body>
</html>`;
}
