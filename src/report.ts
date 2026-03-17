import type { PageResult, ApiCall } from "./types";

// ── Scoring thresholds (Google CWV) ─────────────────────────────────────────
function lcpScore(ms: number): "good" | "needs-improvement" | "poor" {
  if (ms <= 2500) return "good";
  if (ms <= 4000) return "needs-improvement";
  return "poor";
}

function clsScore(score: number): "good" | "needs-improvement" | "poor" {
  if (score <= 0.1) return "good";
  if (score <= 0.25) return "needs-improvement";
  return "poor";
}

function ttfbScore(ms: number): "good" | "needs-improvement" | "poor" {
  if (ms <= 800) return "good";
  if (ms <= 1800) return "needs-improvement";
  return "poor";
}

function fcpScore(ms: number): "good" | "needs-improvement" | "poor" {
  if (ms <= 1800) return "good";
  if (ms <= 3000) return "needs-improvement";
  return "poor";
}

const SCORE_COLOR: Record<string, string> = {
  good: "#0cce6b",
  "needs-improvement": "#ffa400",
  poor: "#ff4e42",
};

const SCORE_BG: Record<string, string> = {
  good: "rgba(12,206,107,0.1)",
  "needs-improvement": "rgba(255,164,0,0.1)",
  poor: "rgba(255,78,66,0.1)",
};

function badge(
  label: string,
  value: string | number,
  grade: "good" | "needs-improvement" | "poor"
) {
  return `<span class="badge" style="background:${SCORE_BG[grade]};border:1px solid ${SCORE_COLOR[grade]};color:${SCORE_COLOR[grade]}">${label}: ${value}</span>`;
}

function fmt(n: number | undefined, unit = "ms"): string {
  if (n === undefined || n === 0) return "–";
  return `${n.toLocaleString()}${unit}`;
}

function apiRow(call: ApiCall): string {
  const type =
    call.type === "ssr"
      ? `<span class="tag ssr">SSR</span>`
      : `<span class="tag csr">CSR</span>`;
  const status = call.status
    ? `<span class="status ${call.status >= 400 ? "err" : "ok"}">${
        call.status
      }</span>`
    : `<span class="status unknown">–</span>`;
  const serverTiming = call.serverTiming
    ? `<div class="server-timing">${call.serverTiming}</div>`
    : "";
  return `
    <tr>
      <td>${type}</td>
      <td class="url-cell" title="${call.url}">${call.url}</td>
      <td>${status}</td>
      <td>${fmt(call.duration)}</td>
      <td class="small">${serverTiming}</td>
    </tr>`;
}

function pageCard(page: PageResult, index: number): string {
  const { url, vitals, apiCalls, errors, status, error, videoPath } = page;
  const v = vitals ?? {};

  const lcpG = v.lcp ? lcpScore(v.lcp) : "poor";
  const clsG = v.cls !== undefined ? clsScore(v.cls) : "poor";
  const ttfbG = v.ttfb ? ttfbScore(v.ttfb) : "poor";
  const fcpG = v.fcp ? fcpScore(v.fcp) : "poor";

  const hasError = !!error;
  const ssrCalls = apiCalls.filter((a) => a.type === "ssr");
  const csrCalls = apiCalls.filter((a) => a.type === "csr");

  const avgSsrTime = ssrCalls.length
    ? Math.round(ssrCalls.reduce((s, a) => s + a.duration, 0) / ssrCalls.length)
    : undefined;
  const avgCsrTime = csrCalls.length
    ? Math.round(csrCalls.reduce((s, a) => s + a.duration, 0) / csrCalls.length)
    : undefined;

  return `
  <div class="card ${hasError ? "card-error" : ""}" id="page-${index}">
    <div class="card-header">
      <div class="card-title">
        <span class="page-num">#${index + 1}</span>
        <a href="${url}" target="_blank" rel="noopener">${url}</a>
        ${
          status
            ? `<span class="http-status ${
                status >= 400 ? "err" : "ok"
              }">${status}</span>`
            : ""
        }
      </div>
      <div class="card-time">${new Date(
        page.auditedAt
      ).toLocaleTimeString()}</div>
    </div>

    ${hasError ? `<div class="error-banner">⚠️ ${error}</div>` : ""}

    <div class="vitals-row">
      ${v.lcp !== undefined ? badge("LCP", fmt(v.lcp), lcpG) : ""}
      ${v.cls !== undefined ? badge("CLS", v.cls.toFixed(3), clsG) : ""}
      ${v.fcp !== undefined ? badge("FCP", fmt(v.fcp), fcpG) : ""}
      ${v.ttfb !== undefined ? badge("TTFB", fmt(v.ttfb), ttfbG) : ""}
      ${
        v.totalTime !== undefined
          ? `<span class="badge neutral">Load: ${fmt(v.totalTime)}</span>`
          : ""
      }
    </div>

    ${
      videoPath
        ? `
    <div class="video-row">
      <details>
        <summary>🎬 Page Recording</summary>
        <video controls width="100%" style="margin-top:8px;border-radius:6px;">
          <source src="${videoPath}" type="video/webm">
        </video>
      </details>
    </div>`
        : ""
    }

    ${
      apiCalls.length > 0
        ? `
    <div class="api-section">
      <div class="api-header">
        <span>API Calls (${apiCalls.length})</span>
        <span class="api-meta">
          ${
            ssrCalls.length
              ? `SSR: ${ssrCalls.length} (avg ${fmt(avgSsrTime)})`
              : ""
          }
          ${
            csrCalls.length
              ? ` · CSR: ${csrCalls.length} (avg ${fmt(avgCsrTime)})`
              : ""
          }
        </span>
      </div>
      <div class="table-wrap">
        <table class="api-table">
          <thead><tr><th>Type</th><th>URL</th><th>Status</th><th>Time</th><th>Server-Timing</th></tr></thead>
          <tbody>${apiCalls.map(apiRow).join("")}</tbody>
        </table>
      </div>
    </div>`
        : ""
    }

    ${
      errors.length > 0
        ? `
    <div class="errors-section">
      <div class="errors-header">Console Errors (${errors.length})</div>
      ${errors.map((e) => `<div class="error-line">${e}</div>`).join("")}
    </div>`
        : ""
    }
  </div>`;
}

export function generateHTMLReport(results: PageResult[]): string {
  const total = results.length;
  const failed = results.filter(
    (r) => r.error || (r.status && r.status >= 400)
  );
  const passed = total - failed.length;

  // Aggregate Web Vitals
  const lcpValues = results
    .map((r) => r.vitals?.lcp)
    .filter(Boolean) as number[];
  const clsValues = results
    .map((r) => r.vitals?.cls)
    .filter((v) => v !== undefined) as number[];
  const ttfbValues = results
    .map((r) => r.vitals?.ttfb)
    .filter(Boolean) as number[];
  const fcpValues = results
    .map((r) => r.vitals?.fcp)
    .filter(Boolean) as number[];

  const median = (arr: number[]) => {
    if (!arr.length) return undefined;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const medLcp = median(lcpValues);
  const medCls = clsValues.length
    ? clsValues.reduce((a, b) => a + b, 0) / clsValues.length
    : undefined;
  const medTtfb = median(ttfbValues);
  const medFcp = median(fcpValues);

  const allApiCalls = results.flatMap((r) => r.apiCalls ?? []);
  const ssrTotal = allApiCalls.filter((a) => a.type === "ssr").length;
  const csrTotal = allApiCalls.filter((a) => a.type === "csr").length;

  // Pages sorted worst LCP first for the summary table
  const sorted = [...results].sort(
    (a, b) => (b.vitals?.lcp ?? 0) - (a.vitals?.lcp ?? 0)
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Site Audit Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0a0b0e;
      --surface: #111318;
      --surface2: #1a1d24;
      --border: #262a33;
      --text: #e4e6ef;
      --muted: #6b7280;
      --accent: #6c63ff;
      --good: #0cce6b;
      --warn: #ffa400;
      --poor: #ff4e42;
      --font-sans: 'Syne', sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 14px;
      line-height: 1.6;
    }

    /* ── Header ── */
    .header {
      border-bottom: 1px solid var(--border);
      padding: 32px 40px 24px;
      display: flex;
      align-items: flex-start;
      gap: 24px;
    }
    .header-logo {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -1px;
      background: linear-gradient(135deg, var(--accent), #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header-meta { color: var(--muted); font-size: 13px; margin-top: 4px; font-family: var(--font-mono); }

    /* ── Layout ── */
    .container { max-width: 1400px; margin: 0 auto; padding: 0 40px 80px; }

    /* ── Summary Grid ── */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      padding: 32px 0 24px;
    }
    .stat-tile {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .stat-tile .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); }
    .stat-tile .value { font-size: 32px; font-weight: 800; margin-top: 4px; font-family: var(--font-mono); }
    .stat-tile .sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
    .stat-tile.pass .value { color: var(--good); }
    .stat-tile.fail .value { color: var(--poor); }
    .stat-tile.warn .value { color: var(--warn); }
    .stat-tile.neutral .value { color: var(--accent); }

    /* ── CWV Summary ── */
    .cwv-band {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 24px;
    }
    .cwv-tile {
      flex: 1;
      min-width: 140px;
      background: var(--surface);
      border-radius: 10px;
      border: 1px solid var(--border);
      padding: 16px;
    }
    .cwv-tile .cwv-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .cwv-tile .cwv-value { font-size: 22px; font-weight: 700; font-family: var(--font-mono); margin-top: 4px; }
    .cwv-tile .cwv-grade { font-size: 11px; margin-top: 4px; font-weight: 600; }

    /* ── Worst pages table ── */
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 12px;
      letter-spacing: -0.3px;
    }
    .worst-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    .worst-table th, .worst-table td {
      text-align: left;
      padding: 10px 14px;
      font-size: 13px;
    }
    .worst-table th { background: var(--surface2); color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    .worst-table tr:hover td { background: var(--surface); }
    .worst-table td { border-bottom: 1px solid var(--border); }
    .worst-table td a { color: var(--accent); text-decoration: none; font-family: var(--font-mono); font-size: 12px; }
    .worst-table td a:hover { text-decoration: underline; }

    /* ── Page Cards ── */
    .cards-section .section-title { margin-top: 32px; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .card-error { border-color: rgba(255,78,66,0.4); }
    .card-header {
      padding: 16px 20px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
    }
    .card-title { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
    .page-num { font-size: 11px; font-family: var(--font-mono); color: var(--muted); background: var(--surface2); padding: 2px 8px; border-radius: 4px; }
    .card-title a { color: var(--text); font-family: var(--font-mono); font-size: 12px; text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 700px; }
    .card-title a:hover { color: var(--accent); }
    .card-time { font-size: 12px; color: var(--muted); font-family: var(--font-mono); flex-shrink: 0; }

    .http-status { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; font-family: var(--font-mono); }
    .http-status.ok { background: rgba(12,206,107,0.1); color: var(--good); }
    .http-status.err { background: rgba(255,78,66,0.1); color: var(--poor); }

    .error-banner { background: rgba(255,78,66,0.08); border-bottom: 1px solid rgba(255,78,66,0.2); padding: 10px 20px; color: var(--poor); font-size: 13px; }

    .vitals-row { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 20px; }
    .badge {
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
    }
    .badge.neutral { background: var(--surface2); border: 1px solid var(--border); color: var(--muted); }

    .video-row { padding: 0 20px 14px; }
    .video-row details summary { cursor: pointer; font-size: 13px; color: var(--accent); }

    .api-section { border-top: 1px solid var(--border); }
    .api-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; background: var(--surface2); }
    .api-header span { font-size: 13px; font-weight: 600; }
    .api-meta { font-size: 12px; color: var(--muted); font-family: var(--font-mono); }
    .table-wrap { overflow-x: auto; }
    .api-table { width: 100%; border-collapse: collapse; }
    .api-table th { background: var(--surface2); padding: 8px 14px; font-size: 11px; color: var(--muted); text-align: left; text-transform: uppercase; letter-spacing: 0.06em; }
    .api-table td { padding: 8px 14px; border-bottom: 1px solid var(--border); font-size: 12px; vertical-align: middle; }
    .api-table tr:last-child td { border-bottom: none; }
    .api-table tr:hover td { background: rgba(255,255,255,0.02); }
    .url-cell { font-family: var(--font-mono); font-size: 11px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { font-size: 10px; font-weight: 700; letter-spacing: 0.05em; padding: 2px 7px; border-radius: 4px; }
    .tag.ssr { background: rgba(108,99,255,0.15); color: var(--accent); border: 1px solid rgba(108,99,255,0.3); }
    .tag.csr { background: rgba(255,164,0,0.1); color: var(--warn); border: 1px solid rgba(255,164,0,0.25); }
    .status { font-family: var(--font-mono); font-size: 11px; font-weight: 600; }
    .status.ok { color: var(--good); }
    .status.err { color: var(--poor); }
    .status.unknown { color: var(--muted); }
    .server-timing { font-size: 10px; color: var(--muted); font-family: var(--font-mono); }

    .errors-section { border-top: 1px solid var(--border); padding: 12px 20px; }
    .errors-header { font-size: 12px; font-weight: 600; color: var(--poor); margin-bottom: 8px; }
    .error-line { font-family: var(--font-mono); font-size: 11px; color: #ff8080; padding: 3px 0; border-bottom: 1px solid rgba(255,78,66,0.1); }
    .small { font-size: 11px; }

    /* ── Filter bar ── */
    .filter-bar { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; flex-wrap: wrap; }
    .filter-bar input { background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 8px 14px; border-radius: 8px; font-family: var(--font-mono); font-size: 13px; flex: 1; min-width: 200px; }
    .filter-bar input:focus { outline: none; border-color: var(--accent); }
    .filter-btn { background: var(--surface); border: 1px solid var(--border); color: var(--muted); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-family: var(--font-sans); font-size: 13px; }
    .filter-btn:hover, .filter-btn.active { border-color: var(--accent); color: var(--accent); }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="header-logo">⚡ Site Audit Report</div>
      <div class="header-meta">Generated at ${new Date().toLocaleString()} · ${total} pages audited</div>
    </div>
  </div>

  <div class="container">
    <!-- Summary Stats -->
    <div class="summary-grid">
      <div class="stat-tile pass">
        <div class="label">Pages Passed</div>
        <div class="value">${passed}</div>
        <div class="sub">of ${total} total</div>
      </div>
      <div class="stat-tile fail">
        <div class="label">Pages Failed</div>
        <div class="value">${failed.length}</div>
        <div class="sub">4xx/5xx or error</div>
      </div>
      <div class="stat-tile neutral">
        <div class="label">SSR API Calls</div>
        <div class="value">${ssrTotal}</div>
        <div class="sub">network-intercepted</div>
      </div>
      <div class="stat-tile warn">
        <div class="label">CSR API Calls</div>
        <div class="value">${csrTotal}</div>
        <div class="sub">client fetch/XHR</div>
      </div>
    </div>

    <!-- Core Web Vitals Summary -->
    <div class="section-title">Core Web Vitals — Site Median</div>
    <div class="cwv-band">
      ${
        medLcp !== undefined
          ? (() => {
              const g = lcpScore(medLcp);
              return `<div class="cwv-tile"><div class="cwv-label">LCP · Largest Contentful Paint</div><div class="cwv-value" style="color:${
                SCORE_COLOR[g]
              }">${fmt(
                Math.round(medLcp)
              )}</div><div class="cwv-grade" style="color:${
                SCORE_COLOR[g]
              }">${g}</div></div>`;
            })()
          : ""
      }
      ${
        medCls !== undefined
          ? (() => {
              const g = clsScore(medCls);
              return `<div class="cwv-tile"><div class="cwv-label">CLS · Cumulative Layout Shift</div><div class="cwv-value" style="color:${
                SCORE_COLOR[g]
              }">${medCls.toFixed(
                3
              )}</div><div class="cwv-grade" style="color:${
                SCORE_COLOR[g]
              }">${g}</div></div>`;
            })()
          : ""
      }
      ${
        medFcp !== undefined
          ? (() => {
              const g = fcpScore(medFcp);
              return `<div class="cwv-tile"><div class="cwv-label">FCP · First Contentful Paint</div><div class="cwv-value" style="color:${
                SCORE_COLOR[g]
              }">${fmt(
                Math.round(medFcp)
              )}</div><div class="cwv-grade" style="color:${
                SCORE_COLOR[g]
              }">${g}</div></div>`;
            })()
          : ""
      }
      ${
        medTtfb !== undefined
          ? (() => {
              const g = ttfbScore(medTtfb);
              return `<div class="cwv-tile"><div class="cwv-label">TTFB · Time To First Byte</div><div class="cwv-value" style="color:${
                SCORE_COLOR[g]
              }">${fmt(
                Math.round(medTtfb)
              )}</div><div class="cwv-grade" style="color:${
                SCORE_COLOR[g]
              }">${g}</div></div>`;
            })()
          : ""
      }
    </div>

    <!-- Worst Pages Summary Table -->
    <div class="section-title">Worst LCP Pages</div>
    <table class="worst-table">
      <thead>
        <tr>
          <th>URL</th>
          <th>LCP</th>
          <th>CLS</th>
          <th>FCP</th>
          <th>TTFB</th>
          <th>Load</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${sorted
          .slice(0, 20)
          .map((r, i) => {
            const v = r.vitals ?? {};
            const lcpG = v.lcp ? lcpScore(v.lcp) : "poor";
            const clsG = v.cls !== undefined ? clsScore(v.cls) : "poor";
            const ttfbG = v.ttfb ? ttfbScore(v.ttfb) : "poor";
            const fcpG = v.fcp ? fcpScore(v.fcp) : "poor";
            return `
          <tr>
            <td><a href="#page-${results.indexOf(r)}" title="${r.url}">${
              r.url.length > 60 ? "…" + r.url.slice(-57) : r.url
            }</a></td>
            <td style="color:${
              SCORE_COLOR[lcpG]
            };font-family:var(--font-mono)">${fmt(v.lcp)}</td>
            <td style="color:${
              SCORE_COLOR[clsG]
            };font-family:var(--font-mono)">${
              v.cls !== undefined ? v.cls.toFixed(3) : "–"
            }</td>
            <td style="color:${
              SCORE_COLOR[fcpG]
            };font-family:var(--font-mono)">${fmt(v.fcp)}</td>
            <td style="color:${
              SCORE_COLOR[ttfbG]
            };font-family:var(--font-mono)">${fmt(v.ttfb)}</td>
            <td style="font-family:var(--font-mono)">${fmt(v.totalTime)}</td>
            <td><span class="http-status ${
              r.status && r.status >= 400 ? "err" : "ok"
            }">${r.status ?? (r.error ? "ERR" : "?")}</span></td>
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>

    <!-- Per-Page Cards -->
    <div class="cards-section">
      <div class="section-title">All Pages (${results.length})</div>
      <div class="filter-bar">
        <input type="text" id="search" placeholder="Filter by URL…" oninput="filterCards()">
        <button class="filter-btn active" onclick="filterBy('all', this)">All</button>
        <button class="filter-btn" onclick="filterBy('poor', this)">Poor</button>
        <button class="filter-btn" onclick="filterBy('errors', this)">Errors</button>
        <button class="filter-btn" onclick="filterBy('api', this)">Has API</button>
      </div>
      <div id="cards">
        ${results.map((r, i) => pageCard(r, i)).join("")}
      </div>
    </div>
  </div>

  <script>
    let currentFilter = 'all';

    function filterCards() {
      const q = document.getElementById('search').value.toLowerCase();
      document.querySelectorAll('#cards .card').forEach(card => {
        const url = card.querySelector('a')?.href ?? '';
        const show = url.toLowerCase().includes(q) || q === '';
        card.style.display = show ? '' : 'none';
      });
    }

    function filterBy(type, btn) {
      currentFilter = type;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('#cards .card').forEach(card => {
        let show = true;
        if (type === 'poor') show = card.innerHTML.includes('"poor"') || card.classList.contains('card-error');
        if (type === 'errors') show = card.querySelector('.errors-section') !== null || card.classList.contains('card-error');
        if (type === 'api') show = card.querySelector('.api-section') !== null;
        card.style.display = show ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}
