import type { PageResult } from "./types";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

interface UrlProductData {
  url: string;
  productCount: number | undefined;
  status: number | undefined;
}

export function generateProductReportHTML(results: PageResult[]): string {
  // Deduplicate by URL — pick productCount from whichever result has it
  const urlMap = new Map<string, UrlProductData>();
  for (const r of results) {
    const existing = urlMap.get(r.url);
    if (!existing) {
      urlMap.set(r.url, { url: r.url, productCount: r.productCount, status: r.status });
    } else if (existing.productCount === undefined && r.productCount !== undefined) {
      existing.productCount = r.productCount;
    }
  }

  const allUrls = [...urlMap.values()];
  const measured = allUrls.filter((u) => u.productCount !== undefined);
  const failed = allUrls.filter((u) => u.productCount === undefined);
  const withProducts = measured.filter((u) => u.productCount! > 0);
  const zeroProducts = measured.filter((u) => u.productCount === 0);
  const totalProducts = withProducts.reduce((s, u) => s + u.productCount!, 0);
  const avgProducts = withProducts.length ? Math.round(totalProducts / withProducts.length) : 0;
  const maxProducts = withProducts.length ? Math.max(...withProducts.map((u) => u.productCount!)) : 0;
  const pctWithProducts = measured.length
    ? Math.round((withProducts.length / measured.length) * 100)
    : 0;

  // Sort measured: highest count first, zeros at the end
  const sorted = [...measured].sort((a, b) => {
    if (a.productCount === 0 && b.productCount !== 0) return 1;
    if (b.productCount === 0 && a.productCount !== 0) return -1;
    return b.productCount! - a.productCount!;
  });

  // Build rows with separators before zero-product and failed sections
  const rowParts: string[] = [];
  let zeroSepInserted = false;
  sorted.forEach((u, i) => {
    const isZero = u.productCount === 0;
    if (isZero && !zeroSepInserted) {
      zeroSepInserted = true;
      rowParts.push(
        `<tr class="sep-row"><td colspan="4">Zero-Product URLs &mdash; For Reference Only</td></tr>`
      );
    }
    const barWidth =
      !isZero && maxProducts > 0 ? Math.round((u.productCount! / maxProducts) * 100) : 0;
    rowParts.push(`
      <tr class="${isZero ? "zero-row" : ""}">
        <td class="col-num">${i + 1}</td>
        <td class="col-url">
          <span class="url-text" title="${escHtml(u.url)}">${escHtml(u.url)}</span>
        </td>
        <td class="col-count">
          <span class="count-val${isZero ? " zero" : ""}">${u.productCount!.toLocaleString()}</span>
          ${!isZero ? `<div class="bar-track"><div class="bar-fill" style="width:${barWidth}%"></div></div>` : ""}
        </td>
        <td class="col-badge">
          <span class="badge ${isZero ? "badge-zero" : "badge-ok"}">${isZero ? "No Products" : "Has Products"}</span>
        </td>
      </tr>`);
  });

  // Append failed URLs at the bottom
  if (failed.length > 0) {
    rowParts.push(
      `<tr class="sep-row sep-row-failed"><td colspan="4">Pages Without Product List &mdash; No List Tastic Detected</td></tr>`
    );
    failed.forEach((u, i) => {
      rowParts.push(`
        <tr class="failed-row">
          <td class="col-num">${sorted.length + i + 1}</td>
          <td class="col-url">
            <span class="url-text" title="${escHtml(u.url)}">${escHtml(u.url)}</span>
          </td>
          <td class="col-count">
            <span class="count-val failed-dash">&mdash;</span>
          </td>
          <td class="col-badge">
            <span class="badge badge-failed">No List</span>
          </td>
        </tr>`);
    });
  }

  const generatedAt = new Date().toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Product Count Report</title>
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

/* ── Page shell ── */
.page{max-width:960px;margin:0 auto;padding:52px 44px;}

/* ── Top accent bar ── */
.accent-bar{height:4px;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:2px;margin-bottom:36px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}

/* ── Report header ── */
.report-header{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:24px;
  padding-bottom:22px;
  border-bottom:1px solid #e5e7eb;
  margin-bottom:36px;
}
.report-title{font-size:21px;font-weight:700;letter-spacing:-.4px;color:#111827;}
.report-subtitle{font-size:12px;color:#6b7280;margin-top:3px;}
.report-meta{text-align:right;font-size:11px;color:#6b7280;line-height:1.8;white-space:nowrap;}
.report-meta strong{color:#374151;font-weight:600;}

/* ── Summary cards ── */
.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:40px;}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;background:#f9fafb;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.card-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:#6b7280;margin-bottom:10px;}
.card-value{font-size:27px;font-weight:700;letter-spacing:-1px;line-height:1;color:#111827;}
.card-note{font-size:11px;color:#9ca3af;margin-top:6px;}
.card.c-blue .card-value{color:#2563eb;}
.card.c-green .card-value{color:#059669;}
.card.c-red .card-value{color:#dc2626;}

/* ── Section title ── */
.section-title{
  font-size:10px;font-weight:600;text-transform:uppercase;
  letter-spacing:.1em;color:#6b7280;
  padding-bottom:8px;margin-bottom:0;
  border-bottom:1px solid #e5e7eb;
}

/* ── Table ── */
.table-wrap{margin-bottom:40px;}
table{width:100%;border-collapse:collapse;}
thead th{
  background:#f3f4f6;
  padding:9px 12px;
  text-align:left;
  font-size:10px;
  font-weight:600;
  text-transform:uppercase;
  letter-spacing:.08em;
  color:#6b7280;
  border-bottom:1px solid #e5e7eb;
}
th.r{text-align:right;}
tbody tr{border-bottom:1px solid #f3f4f6;}
tbody tr:last-child{border-bottom:none;}
tbody tr:hover td{background:#fafafa;}
tbody tr.zero-row td{opacity:.5;}
td{padding:9px 12px;vertical-align:middle;}

.col-num{width:36px;text-align:right;padding-right:16px;color:#d1d5db;font-size:11px;font-variant-numeric:tabular-nums;}
.col-url{max-width:520px;}
.url-text{
  font-family:'SF Mono','Fira Code','Fira Mono',ui-monospace,monospace;
  font-size:11px;color:#374151;
  display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.col-count{width:200px;}
.count-val{
  font-size:15px;font-weight:700;color:#111827;
  font-variant-numeric:tabular-nums;display:block;
}
.count-val.zero{font-size:13px;font-weight:500;color:#9ca3af;}
.bar-track{height:3px;background:#e5e7eb;border-radius:2px;margin-top:5px;}
.bar-fill{height:3px;background:#2563eb;border-radius:2px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.col-badge{width:130px;text-align:right;}
.badge{
  display:inline-block;padding:3px 10px;border-radius:20px;
  font-size:10px;font-weight:600;letter-spacing:.03em;
}
.badge-ok{background:#dcfce7;color:#15803d;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.badge-zero{background:#fee2e2;color:#dc2626;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.badge-failed{background:#f3f4f6;color:#6b7280;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.count-val.failed-dash{font-size:13px;font-weight:500;color:#d1d5db;}
tbody tr.failed-row td{opacity:.6;}

/* ── Separator row ── */
.sep-row td{
  padding:7px 12px;
  background:#fffbeb;
  font-size:10px;font-weight:600;
  text-transform:uppercase;letter-spacing:.09em;
  color:#92400e;
  border-top:1px solid #fde68a;
  border-bottom:1px solid #fde68a;
  opacity:1 !important;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.sep-row-failed td{
  background:#f9fafb;
  color:#6b7280;
  border-top:1px solid #e5e7eb;
  border-bottom:1px solid #e5e7eb;
}

/* ── Footer ── */
.report-footer{
  border-top:1px solid #e5e7eb;
  padding-top:14px;
  display:flex;justify-content:space-between;
  font-size:10px;color:#9ca3af;
}

/* ── Print ── */
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
      <div class="report-title">Product Count Report</div>
      <div class="report-subtitle">URL-level product availability audit</div>
    </div>
    <div class="report-meta">
      <div>Generated <strong>${generatedAt}</strong></div>
      <div>${allUrls.length.toLocaleString()} URLs &middot; ${failed.length > 0 ? `${failed.length} without product list` : 'all have product list'}</div>
    </div>
  </div>

  <div class="summary">
    <div class="card">
      <div class="card-label">Total URLs</div>
      <div class="card-value">${allUrls.length.toLocaleString()}</div>
      <div class="card-note">audited</div>
    </div>
    <div class="card c-green">
      <div class="card-label">URLs With Products</div>
      <div class="card-value">${withProducts.length.toLocaleString()}</div>
      <div class="card-note">${pctWithProducts}% of measured</div>
    </div>
    <div class="card c-blue">
      <div class="card-label">Total Products</div>
      <div class="card-value">${totalProducts.toLocaleString()}</div>
      <div class="card-note">avg ${avgProducts.toLocaleString()} per URL</div>
    </div>
    <div class="card c-red">
      <div class="card-label">Zero-Product URLs</div>
      <div class="card-value">${zeroProducts.length.toLocaleString()}</div>
      <div class="card-note">need attention</div>
    </div>
    <div class="card">
      <div class="card-label">No Product List</div>
      <div class="card-value" style="color:#9ca3af">${failed.length.toLocaleString()}</div>
      <div class="card-note">no list tastic</div>
    </div>
  </div>

  <div class="section-title">All URLs &mdash; sorted by product count</div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th class="r">#</th>
          <th>URL</th>
          <th>Product Count</th>
          <th class="r">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowParts.join("")}
      </tbody>
    </table>
  </div>

  <div class="report-footer">
    <span>Product Count Report &mdash; ${generatedAt}</span>
    <span>${withProducts.length} with products &middot; ${zeroProducts.length} empty &middot; ${failed.length} no product list</span>
  </div>

</div>
</body>
</html>`;
}
