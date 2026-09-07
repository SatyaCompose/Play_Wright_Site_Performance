import type { PageResult, StrapiDatasource } from "./types";

export type StrapiUrlSource = "content" | "plp" | "pdp";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// CSV per RFC 4180 — quote every field, double any internal quote.
function csvCell(s: string | number | undefined | null): string {
  const str = s == null ? "" : String(s);
  return `"${str.replace(/"/g, '""')}"`;
}

interface CollapsedUrl {
  url: string;
  source: StrapiUrlSource;
  found: boolean;
  datasources: StrapiDatasource[];
  measured: boolean;
}

// Collapse per-profile results down to one row per URL: pick the first result
// that actually has a strapiCheck. Strapi mode runs chromium-only so this is
// effectively a no-op, but keeping the shape robust means retest runs that
// re-audit under a second profile don't produce duplicate rows.
function collapse(
  results: PageResult[],
  sources: Map<string, StrapiUrlSource>
): CollapsedUrl[] {
  const byUrl = new Map<string, CollapsedUrl>();
  for (const r of results) {
    const existing = byUrl.get(r.url);
    const c = r.strapiCheck;
    if (!existing) {
      byUrl.set(r.url, {
        url: r.url,
        source: sources.get(r.url) ?? "content",
        found: !!c?.found,
        datasources: c?.datasources ?? [],
        measured: !!c,
      });
    } else if (!existing.measured && c) {
      existing.found = c.found;
      existing.datasources = c.datasources;
      existing.measured = true;
    }
  }
  return [...byUrl.values()];
}

function sourceLabel(s: StrapiUrlSource): string {
  return s === "content" ? "Content" : s === "plp" ? "PLP" : "PDP";
}

// Datasource classifiers — the detector collects both keyword families in
// one pass, and the report splits them here so Strapi gets full URL detail
// and builder/component gets a headline count only.
const isStrapi = (d: StrapiDatasource): boolean =>
  d.type.toLowerCase().includes("strapi");
const isBuilder = (d: StrapiDatasource): boolean =>
  d.type.toLowerCase().includes("builder/component");

export function generateStrapiReportHTML(
  results: PageResult[],
  sources: Map<string, StrapiUrlSource>
): string {
  const rows = collapse(results, sources);

  const measured = rows.filter((r) => r.measured);
  const withStrapi = rows.filter((r) => r.datasources.some(isStrapi));
  const withBuilder = rows.filter((r) => r.datasources.some(isBuilder));
  // Per-source counts track Strapi only — Builder/component is a headline
  // number, no per-source breakdown or URL listing.
  const bySource: Record<StrapiUrlSource, { scanned: number; found: number }> = {
    content: { scanned: 0, found: 0 },
    plp: { scanned: 0, found: 0 },
    pdp: { scanned: 0, found: 0 },
  };
  for (const r of rows) {
    bySource[r.source].scanned++;
    if (r.datasources.some(isStrapi)) bySource[r.source].found++;
  }

  const sortedFound = [...withStrapi].sort((a, b) => {
    if (a.source !== b.source) {
      const order: StrapiUrlSource[] = ["content", "plp", "pdp"];
      return order.indexOf(a.source) - order.indexOf(b.source);
    }
    return a.url.localeCompare(b.url);
  });

  const foundRows = sortedFound
    .map((r, i) => {
      // URL rows show Strapi datasources only — builder/component matches are
      // still recorded on the row but rendered as a headline count above.
      const chips = r.datasources
        .filter(isStrapi)
        .map(
          (d) =>
            `<span class="chip"><code>${escHtml(d.type)}</code><span class="chip-id">${escHtml(
              d.id
            )}</span></span>`
        )
        .join(" ");
      return `
      <tr>
        <td class="col-num">${i + 1}</td>
        <td class="col-source"><span class="source-badge s-${r.source}">${sourceLabel(
          r.source
        )}</span></td>
        <td class="col-url"><span class="url-text" title="${escHtml(r.url)}">${escHtml(
          r.url
        )}</span></td>
        <td class="col-chips">${chips || '<span class="muted">–</span>'}</td>
      </tr>`;
    })
    .join("");

  const generatedAt = new Date().toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Australia/Sydney",
  });

  const sourceCard = (label: string, s: StrapiUrlSource) => `
    <div class="card">
      <div class="card-label">${label}</div>
      <div class="card-value">${bySource[s].found.toLocaleString()}</div>
      <div class="card-note">of ${bySource[s].scanned.toLocaleString()} scanned</div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Datasource Scan — Strapi + Builder</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#fff;color:#111827;font-size:13px;line-height:1.5;}
.page{max-width:1040px;margin:0 auto;padding:52px 44px;}
.accent-bar{height:4px;background:linear-gradient(90deg,#7c3aed,#2563eb);border-radius:2px;margin-bottom:36px;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.report-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:1px solid #e5e7eb;margin-bottom:36px;}
.report-title{font-size:21px;font-weight:700;letter-spacing:-.4px;color:#111827;}
.report-subtitle{font-size:12px;color:#6b7280;margin-top:3px;}
.report-meta{text-align:right;font-size:11px;color:#6b7280;line-height:1.8;white-space:nowrap;}
.report-meta strong{color:#374151;font-weight:600;}

.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:32px;}
.card{border:1px solid #e5e7eb;border-radius:8px;padding:18px 20px;background:#f9fafb;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.card-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:#6b7280;margin-bottom:10px;}
.card-value{font-size:27px;font-weight:700;letter-spacing:-1px;line-height:1;color:#111827;}
.card-note{font-size:11px;color:#9ca3af;margin-top:6px;}
.card.c-purple .card-value{color:#7c3aed;}
.card.c-blue .card-value{color:#2563eb;}
.card.c-orange .card-value{color:#ea580c;}

.section-title{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;padding-bottom:8px;margin-bottom:0;border-bottom:1px solid #e5e7eb;}

.table-wrap{margin-bottom:40px;}
table{width:100%;border-collapse:collapse;}
thead th{background:#f3f4f6;padding:9px 12px;text-align:left;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;border-bottom:1px solid #e5e7eb;}
tbody tr{border-bottom:1px solid #f3f4f6;}
tbody tr:last-child{border-bottom:none;}
tbody tr:hover td{background:#fafafa;}
td{padding:9px 12px;vertical-align:middle;}

.col-num{width:36px;text-align:right;padding-right:16px;color:#d1d5db;font-size:11px;font-variant-numeric:tabular-nums;}
.col-source{width:88px;}
.col-url{max-width:480px;}
.url-text{font-family:'SF Mono','Fira Code','Fira Mono',ui-monospace,monospace;font-size:11px;color:#374151;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.col-chips{}

.source-badge{display:inline-block;padding:2px 9px;border-radius:12px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.source-badge.s-content{background:#e0e7ff;color:#4338ca;}
.source-badge.s-plp{background:#dbeafe;color:#1d4ed8;}
.source-badge.s-pdp{background:#fce7f3;color:#be185d;}

.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;margin:2px 4px 2px 0;border-radius:12px;background:#f3e8ff;color:#6b21a8;font-size:10px;font-weight:600;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.chip code{font-family:'SF Mono','Fira Code',ui-monospace,monospace;font-size:10px;color:inherit;background:transparent;padding:0;}
.chip-id{opacity:.65;font-weight:500;font-family:'SF Mono','Fira Code',ui-monospace,monospace;}
.muted{color:#9ca3af;}

.empty-state{padding:36px 20px;text-align:center;background:#f9fafb;border:1px dashed #e5e7eb;border-radius:8px;color:#6b7280;font-size:13px;margin-bottom:40px;}
.empty-state strong{display:block;color:#111827;font-size:15px;font-weight:600;margin-bottom:6px;}

.report-footer{border-top:1px solid #e5e7eb;padding-top:14px;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;}
@media print{
  body{font-size:11px;}
  .report-footer{display:none;}
  table thead{display:table-header-group;}
  tr{page-break-inside:avoid;}
}
</style>
</head>
<body>
<div class="page">

  <div class="accent-bar"></div>

  <div class="report-header">
    <div>
      <div class="report-title">Datasource Scan &mdash; Strapi + Builder</div>
      <div class="report-subtitle">Detects <code>strapi/*</code> and <code>builder/component</code> datasources in each page's <code>__NEXT_DATA__</code>. Full URL list for Strapi only; Builder is a headline count.</div>
    </div>
    <div class="report-meta">
      <div>Generated <strong>${generatedAt}</strong></div>
      <div>${measured.length.toLocaleString()} URLs scanned &middot; Strapi: ${withStrapi.length.toLocaleString()} &middot; Builder: ${withBuilder.length.toLocaleString()}</div>
    </div>
  </div>

  <div class="summary">
    <div class="card c-purple">
      <div class="card-label">Strapi Found</div>
      <div class="card-value">${withStrapi.length.toLocaleString()}</div>
      <div class="card-note">URLs listed below</div>
    </div>
    <div class="card c-orange">
      <div class="card-label">Builder/Component Found</div>
      <div class="card-value">${withBuilder.length.toLocaleString()}</div>
      <div class="card-note">count only &mdash; no URL list</div>
    </div>
    <div class="card">
      <div class="card-label">Total Scanned</div>
      <div class="card-value">${measured.length.toLocaleString()}</div>
      <div class="card-note">${rows.length.toLocaleString()} requested</div>
    </div>
    ${sourceCard("Content · Strapi", "content")}
    ${sourceCard("PLP · Strapi", "plp")}
    ${sourceCard("PDP · Strapi", "pdp")}
  </div>

  <div class="section-title" style="margin-bottom:14px;">URLs with Strapi datasources</div>
  ${
    withStrapi.length === 0
      ? `<div class="empty-state"><strong>No Strapi datasources found</strong>None of the ${measured.length.toLocaleString()} scanned pages returned a datasource whose type contains "strapi". ${withBuilder.length.toLocaleString()} page${withBuilder.length === 1 ? "" : "s"} did contain builder/component datasources.</div>`
      : `<div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Source</th>
          <th>URL</th>
          <th>Strapi Datasources</th>
        </tr>
      </thead>
      <tbody>${foundRows}</tbody>
    </table>
  </div>`
  }

  <div class="report-footer">
    <span>Datasource Scan &mdash; ${generatedAt}</span>
    <span>Strapi &mdash; Content: ${bySource.content.found}/${bySource.content.scanned} &middot; PLP: ${bySource.plp.found}/${bySource.plp.scanned} &middot; PDP: ${bySource.pdp.found}/${bySource.pdp.scanned}</span>
  </div>

</div>
</body>
</html>`;
}

export function generateStrapiReportCSV(
  results: PageResult[],
  sources: Map<string, StrapiUrlSource>
): string {
  // CSV mirrors the URL list in the HTML report: Strapi rows only. Builder is
  // a headline count on the report and doesn't need per-URL export.
  const rows = collapse(results, sources).filter((r) => r.datasources.some(isStrapi));
  const header = ["url", "source", "datasource_id", "datasource_type", "location"];
  const lines: string[] = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const strapiOnly = r.datasources.filter(isStrapi);
    for (const d of strapiOnly) {
      lines.push(
        [r.url, r.source, d.id, d.type, d.location].map(csvCell).join(",")
      );
    }
  }
  // RFC 4180 requires CRLF between records for maximum interop.
  return lines.join("\r\n") + "\r\n";
}
