import type { PageResult, ApiCall, DeviceProfile } from "./types.js";

// ── CWV thresholds ────────────────────────────────────────────────────────
function grade(metric: string, val: number): "good" | "ni" | "poor" {
  const thresholds: Record<string, [number, number]> = {
    lcp: [2500, 4000],
    fcp: [1800, 3000],
    ttfb: [800, 1800],
    cls: [0.1, 0.25],
    load: [3000, 6000],
  };
  const [good, warn] = thresholds[metric] ?? [Infinity, Infinity];
  return val <= good ? "good" : val <= warn ? "ni" : "poor";
}

const GRADE_COLOR = { good: "#0cce6b", ni: "#ffa400", poor: "#ff4e42" };
const GRADE_BG = {
  good: "rgba(12,206,107,.1)",
  ni: "rgba(255,164,0,.1)",
  poor: "rgba(255,78,66,.1)",
};
const GRADE_LABEL = { good: "Good", ni: "Needs work", poor: "Poor" };

function gradeColor(metric: string, val: number | undefined): string {
  if (val === undefined || val === null) return "#6b7280";
  return GRADE_COLOR[grade(metric, val)];
}

function fmt(n: number | undefined, dec = 0): string {
  if (n === undefined || n === null) return "–";
  return dec > 0 ? n.toFixed(dec) : n.toLocaleString() + "ms";
}

function fmtCls(n: number | undefined): string {
  if (n === undefined || n === null) return "–";
  return n.toFixed(3);
}

function badge(label: string, val: string, g: "good" | "ni" | "poor") {
  return `<span style="background:${GRADE_BG[g]};border:1px solid ${GRADE_COLOR[g]};color:${GRADE_COLOR[g]};
    padding:3px 9px;border-radius:5px;font-size:11px;font-weight:600;font-family:monospace">${label}: ${val}</span>`;
}

function apiRows(calls: ApiCall[]): string {
  return calls
    .map((c) => {
      const type =
        c.type === "ssr"
          ? `<span style="background:rgba(108,99,255,.15);color:#7c6dff;border:1px solid rgba(108,99,255,.3);padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700">SSR</span>`
          : `<span style="background:rgba(255,164,0,.1);color:#ffa400;border:1px solid rgba(255,164,0,.25);padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700">CSR</span>`;
      const st = c.status
        ? `<span style="color:${
            c.status >= 400 ? "#ff4e42" : "#0cce6b"
          };font-family:monospace;font-size:10px">${c.status}</span>`
        : `<span style="color:#6b7280">–</span>`;
      const dur = c.duration;
      const durColor =
        dur <= 300 ? "#0cce6b" : dur <= 1000 ? "#ffa400" : "#ff4e42";
      const st_txt = c.serverTiming
        ? `<div style="font-size:9px;color:#6b7280;font-family:monospace">${c.serverTiming}</div>`
        : "";
      return `<tr>
      <td style="width:52px">${type}</td>
      <td style="font-family:monospace;font-size:10px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${
        c.url
      }">${c.url}</td>
      <td style="width:60px;text-align:center">${st}</td>
      <td style="width:80px;text-align:right;font-family:monospace;color:${durColor}">${fmt(
        dur
      )}</td>
      <td style="width:180px;font-size:9px">${st_txt}</td>
    </tr>`;
    })
    .join("");
}

// ── Group results by URL, preserving device order ─────────────────────────
interface UrlGroup {
  url: string;
  results: PageResult[];
  worstLcp: number;
}

function groupByUrl(results: PageResult[]): UrlGroup[] {
  const map = new Map<string, PageResult[]>();
  for (const r of results) {
    if (!map.has(r.url)) map.set(r.url, []);
    map.get(r.url)!.push(r);
  }
  return [...map.entries()].map(([url, rs]) => ({
    url,
    results: rs,
    worstLcp: Math.max(...rs.map((r) => r.vitals?.lcp ?? 0)),
  }));
}

// ── Per-device result card inside a URL group ─────────────────────────────
function deviceCard(r: PageResult, idx: number, tabId: string): string {
  const v = r.vitals ?? {};
  const p = r.profile;
  const ssr = (r.apiCalls ?? []).filter((a) => a.type === "ssr");
  const csr = (r.apiCalls ?? []).filter((a) => a.type === "csr");
  const avgSsr = ssr.length
    ? Math.round(ssr.reduce((s, a) => s + a.duration, 0) / ssr.length)
    : 0;
  const avgCsr = csr.length
    ? Math.round(csr.reduce((s, a) => s + a.duration, 0) / csr.length)
    : 0;

  const videoFileName = r.videoPath ? r.videoPath.split(/[/\\]/).pop() : null;
  const videoMime = videoFileName?.endsWith(".mp4")
    ? "video/mp4"
    : "video/webm";

  const vitalsHtml = [
    { label: "LCP", metric: "lcp", val: v.lcp, fv: fmt(v.lcp) },
    { label: "CLS", metric: "cls", val: v.cls, fv: fmtCls(v.cls) },
    { label: "FCP", metric: "fcp", val: v.fcp, fv: fmt(v.fcp) },
    { label: "TTFB", metric: "ttfb", val: v.ttfb, fv: fmt(v.ttfb) },
    { label: "Load", metric: "load", val: v.totalTime, fv: fmt(v.totalTime) },
  ]
    .map(({ label, metric, val, fv }) => {
      const g = val !== undefined ? grade(metric, val) : null;
      const c = g ? GRADE_COLOR[g] : "#6b7280";
      return `<div style="background:#18191f;border:1px solid #2a2d38;border-radius:8px;padding:12px 10px;min-width:0">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#6b7280;margin-bottom:4px">${label}</div>
      <div style="font-family:monospace;font-size:18px;font-weight:700;color:${c};line-height:1">${fv}</div>
      ${
        g
          ? `<div style="font-size:9px;color:${c};margin-top:4px;font-weight:600;text-transform:uppercase">${GRADE_LABEL[g]}</div>`
          : ""
      }
    </div>`;
    })
    .join("");

  return `
  <div class="dcard" id="dc-${tabId}" style="display:${
    idx === 0 ? "block" : "none"
  }">
    ${
      r.error
        ? `<div style="background:rgba(255,78,66,.08);border:1px solid rgba(255,78,66,.25);border-radius:8px;padding:10px 14px;color:#ff4e42;font-size:12px;margin-bottom:14px;font-family:monospace">⚠ ${r.error}</div>`
        : ""
    }

    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:16px">
      ${vitalsHtml}
    </div>

    ${
      videoFileName
        ? `
    <div style="margin-bottom:16px">
      <details>
        <summary style="cursor:pointer;font-size:12px;color:#7c6dff;padding:8px 0;user-select:none">🎬 Page Recording (${
          p?.label ?? ""
        })</summary>
        <video controls preload="metadata" style="width:100%;border-radius:8px;background:#000;margin-top:8px;max-height:400px">
          <source src="/videos/${encodeURIComponent(
            videoFileName
          )}" type="${videoMime}">
        </video>
      </details>
    </div>`
        : ""
    }

    ${
      (r.apiCalls ?? []).length > 0
        ? `
    <div style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:8px 12px;background:#18191f;border:1px solid #2a2d38;border-radius:8px 8px 0 0;
        font-size:12px;font-weight:600">
        <span>API Calls (${r.apiCalls.length})</span>
        <span style="font-family:monospace;font-size:10px;color:#6b7280">
          ${
            ssr.length
              ? `SSR: ${ssr.length}${avgSsr ? ` · avg ${fmt(avgSsr)}` : ""}`
              : ""
          }
          ${ssr.length && csr.length ? " · " : ""}
          ${
            csr.length
              ? `CSR: ${csr.length}${avgCsr ? ` · avg ${fmt(avgCsr)}` : ""}`
              : ""
          }
        </span>
      </div>
      <div style="border:1px solid #2a2d38;border-top:none;border-radius:0 0 8px 8px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;table-layout:fixed">
          <thead><tr style="background:#18191f">
            <th style="padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;text-align:left;width:52px">Type</th>
            <th style="padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;text-align:left">URL</th>
            <th style="padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;text-align:center;width:60px">Status</th>
            <th style="padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;text-align:right;width:80px">Time</th>
            <th style="padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:#6b7280;text-align:left;width:180px">Server-Timing</th>
          </tr></thead>
          <tbody>${apiRows(r.apiCalls)}</tbody>
        </table>
      </div>
    </div>`
        : ""
    }

    ${
      (r.errors ?? []).length > 0
        ? `
    <div>
      <div style="padding:8px 12px;background:rgba(255,78,66,.08);border:1px solid rgba(255,78,66,.3);
        border-radius:8px 8px 0 0;font-size:12px;font-weight:600;color:#ff4e42">
        Console Errors (${r.errors.length})
      </div>
      <div style="border:1px solid rgba(255,78,66,.2);border-top:none;border-radius:0 0 8px 8px">
        ${r.errors
          .map(
            (e) =>
              `<div style="padding:5px 12px;font-family:monospace;font-size:10px;color:#ff8080;border-bottom:1px solid rgba(255,78,66,.1)">${e}</div>`
          )
          .join("")}
      </div>
    </div>`
        : ""
    }
  </div>`;
}

// ── URL group card ────────────────────────────────────────────────────────
function urlGroupCard(group: UrlGroup, groupIdx: number): string {
  const { url, results } = group;

  // Device tabs
  const tabGroupId = `g${groupIdx}`;
  const tabsHtml = results
    .map((r, i) => {
      const p = r.profile;
      const lcp = r.vitals?.lcp;
      const g = lcp !== undefined ? grade("lcp", lcp) : null;
      const dot = g
        ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${GRADE_COLOR[g]};margin-left:5px;vertical-align:middle"></span>`
        : "";
      const active = i === 0;
      return `<button onclick="switchTab('${tabGroupId}',${i},${
        results.length
      })"
      id="tab-${tabGroupId}-${i}"
      style="padding:7px 14px;font-size:11px;font-weight:600;cursor:pointer;border:none;
        border-bottom:2px solid ${active ? "#7c6dff" : "transparent"};
        color:${active ? "#7c6dff" : "#6b7280"};background:transparent;
        transition:all .15s;white-space:nowrap">
      ${p?.icon ?? ""} ${p?.label ?? `Device ${i + 1}`}${dot}
    </button>`;
    })
    .join("");

  // Per-device vitals summary in the overview table row
  const deviceVitals = results
    .map((r) => {
      const v = r.vitals ?? {};
      const lcp = v.lcp;
      const g = lcp !== undefined ? grade("lcp", lcp) : null;
      return `<td style="padding:8px 10px;font-family:monospace;font-size:11px;color:${
        g ? GRADE_COLOR[g] : "#6b7280"
      }">${fmt(lcp)}</td>
            <td style="padding:8px 10px;font-family:monospace;font-size:11px;color:${gradeColor(
              "cls",
              v.cls
            )}">${fmtCls(v.cls)}</td>
            <td style="padding:8px 10px;font-family:monospace;font-size:11px;color:${gradeColor(
              "ttfb",
              v.ttfb
            )}">${fmt(v.ttfb)}</td>`;
    })
    .join("<td style='padding:8px 10px;color:#2a2d38'>|</td>");

  const firstStatus = results[0]?.status;
  const hasError = results.some((r) => !!r.error);

  return `
  <div class="url-card" id="ug-${groupIdx}" style="background:#111216;border:1px solid ${
    hasError ? "rgba(255,78,66,.4)" : "#2a2d38"
  };border-radius:12px;margin-bottom:16px;overflow:hidden">
    <!-- Card header -->
    <div style="display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid #2a2d38">
      <span style="font-size:10px;font-family:monospace;color:#6b7280;background:#22242c;padding:2px 7px;border-radius:3px">#${
        groupIdx + 1
      }</span>
      <a href="${url}" target="_blank" rel="noopener" style="color:#e2e4f0;font-family:monospace;font-size:12px;text-decoration:none;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${url}">${url}</a>
      ${
        firstStatus
          ? `<span style="padding:2px 8px;border-radius:4px;font-family:monospace;font-size:10px;font-weight:700;${
              firstStatus >= 400
                ? "background:rgba(255,78,66,.1);color:#ff4e42;border:1px solid rgba(255,78,66,.25)"
                : "background:rgba(12,206,107,.1);color:#0cce6b;border:1px solid rgba(12,206,107,.25)"
            }">${firstStatus}</span>`
          : ""
      }
      <span style="font-size:11px;color:#6b7280;font-family:monospace;flex-shrink:0">${new Date(
        results[0]?.auditedAt
      ).toLocaleTimeString()}</span>
    </div>

    <!-- Device tabs -->
    <div style="display:flex;border-bottom:1px solid #2a2d38;background:#0a0b0e;overflow-x:auto">
      ${tabsHtml}
    </div>

    <!-- Device content panels -->
    <div style="padding:16px 18px">
      ${results.map((r, i) => deviceCard(r, i, `${tabGroupId}-${i}`)).join("")}
    </div>
  </div>`;
}

// ── Main export ───────────────────────────────────────────────────────────
export function generateHTMLReport(results: PageResult[]): string {
  const groups = groupByUrl(results);
  const total = groups.length; // unique URLs
  const totalResults = results.length;

  const failed = groups.filter((g) =>
    g.results.some((r) => r.error || (r.status && r.status >= 400))
  );
  const passed = total - failed.length;

  // Aggregate CWV across all results
  const allLcp = results
    .map((r) => r.vitals?.lcp)
    .filter((v): v is number => !!v);
  const allCls = results
    .map((r) => r.vitals?.cls)
    .filter((v): v is number => v !== undefined);
  const allTtfb = results
    .map((r) => r.vitals?.ttfb)
    .filter((v): v is number => !!v);
  const allFcp = results
    .map((r) => r.vitals?.fcp)
    .filter((v): v is number => !!v);

  const median = (arr: number[]) => {
    if (!arr.length) return undefined;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const mean = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : undefined;

  const medLcp = median(allLcp);
  const medCls = mean(allCls);
  const medTtfb = median(allTtfb);
  const medFcp = median(allFcp);

  const ssrTotal = results
    .flatMap((r) => r.apiCalls ?? [])
    .filter((a) => a.type === "ssr").length;
  const csrTotal = results
    .flatMap((r) => r.apiCalls ?? [])
    .filter((a) => a.type === "csr").length;

  // Sort by worst LCP for overview table
  const sortedGroups = [...groups].sort((a, b) => b.worstLcp - a.worstLcp);

  // Get unique devices that were run
  const deviceSet = new Map<string, DeviceProfile>();
  for (const r of results) {
    if (r.profile && !deviceSet.has(r.profile.id))
      deviceSet.set(r.profile.id, r.profile);
  }
  const devices = [...deviceSet.values()];

  // Overview table header per device
  const devHeaders = devices
    .map(
      (d) =>
        `<th colspan="3" style="padding:8px 10px;text-align:center;background:#111216;border-left:1px solid #2a2d38">${d.icon} ${d.label}</th>`
    )
    .join("");
  const devSubHeaders = devices
    .map(
      () =>
        `<th style="padding:6px 10px;text-align:left;background:#111216;border-left:1px solid #2a2d38;font-size:9px;width:80px">LCP</th>
     <th style="padding:6px 10px;text-align:left;font-size:9px;width:70px">CLS</th>
     <th style="padding:6px 10px;text-align:left;font-size:9px;width:70px">TTFB</th>`
    )
    .join("");

  const hasPoorLcp = allLcp.some((v) => grade("lcp", v) === "poor");
  const hasPoorCls = allCls.some((v) => grade("cls", v) === "poor");
  const tableTitle =
    hasPoorLcp || hasPoorCls
      ? "Pages by LCP — worst first"
      : "All Pages by LCP";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Site Audit Report</title>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Syne:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#09090c;--s1:#111216;--s2:#18191f;--s3:#22242c;--border:#2a2d38;--text:#e2e4f0;--muted:#6b7280;--accent:#7c6dff;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--text);font-family:'Syne',sans-serif;font-size:14px;line-height:1.6;}
a{color:var(--accent);}
.container{max-width:1400px;margin:0 auto;padding:0 32px 80px;}
/* Header */
.hdr{padding:28px 32px 20px;border-bottom:1px solid var(--border);background:var(--s1);margin-bottom:32px;}
.hdr h1{font-size:26px;font-weight:800;letter-spacing:-.5px;color:var(--accent);}
.hdr .meta{font-size:12px;color:var(--muted);font-family:'JetBrains Mono',monospace;margin-top:4px;}
/* Summary tiles */
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:28px;}
.tile{background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:18px;}
.tile .tl{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);}
.tile .tv{font-size:30px;font-weight:800;font-family:'JetBrains Mono',monospace;margin:6px 0 2px;}
.tile .ts{font-size:11px;color:var(--muted);}
.tile.pass .tv{color:#0cce6b;} .tile.fail .tv{color:#ff4e42;} .tile.ssr .tv{color:#7c6dff;} .tile.csr .tv{color:#ffa400;}
/* CWV band */
.cwv-band{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:28px;}
.cwv{flex:1;min-width:160px;background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:16px;}
.cwv .cl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);}
.cwv .cv{font-size:24px;font-weight:700;font-family:'JetBrains Mono',monospace;margin:4px 0;}
.cwv .cg{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;}
/* Section title */
.sec-title{font-size:15px;font-weight:700;color:var(--text);margin-bottom:12px;letter-spacing:-.2px;}
/* Overview table */
.overview-wrap{overflow-x:auto;margin-bottom:28px;border:1px solid var(--border);border-radius:10px;}
.overview-table{width:100%;border-collapse:collapse;font-size:12px;}
.overview-table th{background:var(--s2);padding:8px 10px;text-align:left;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.07em;white-space:nowrap;}
.overview-table td{padding:8px 10px;border-bottom:1px solid rgba(42,45,56,.5);}
.overview-table tr:last-child td{border-bottom:none;}
.overview-table tr:hover td{background:rgba(255,255,255,.02);}
.overview-table td a{color:var(--accent);font-family:'JetBrains Mono',monospace;font-size:11px;text-decoration:none;}
.overview-table td a:hover{text-decoration:underline;}
/* Filter */
.filter-bar{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap;}
.filter-bar input{flex:1;min-width:200px;background:var(--s1);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 14px;font-family:'JetBrains Mono',monospace;font-size:12px;outline:none;}
.filter-bar input:focus{border-color:var(--accent);}
.fbtn{background:var(--s1);border:1px solid var(--border);color:var(--muted);padding:7px 14px;border-radius:8px;cursor:pointer;font-size:12px;}
.fbtn:hover,.fbtn.active{border-color:var(--accent);color:var(--accent);}
</style>
</head>
<body>
<div class="hdr">
  <div class="container" style="padding-bottom:0;margin-bottom:0">
    <h1>⚡ Site Audit Report</h1>
    <div class="meta">Generated at ${new Date().toLocaleString()} · ${total} URLs audited · ${totalResults} page-device combinations · Devices: ${devices
    .map((d) => d.icon + " " + d.label)
    .join(", ")}</div>
  </div>
</div>

<div class="container">

  <!-- Summary tiles -->
  <div class="tiles">
    <div class="tile pass"><div class="tl">URLs Passed</div><div class="tv">${passed}</div><div class="ts">of ${total} unique URLs</div></div>
    <div class="tile fail"><div class="tl">URLs Failed</div><div class="tv">${
      failed.length
    }</div><div class="ts">4xx/5xx or error</div></div>
    <div class="tile ssr"><div class="tl">SSR API Calls</div><div class="tv">${ssrTotal}</div><div class="ts">network-intercepted</div></div>
    <div class="tile csr"><div class="tl">CSR API Calls</div><div class="tv">${csrTotal}</div><div class="ts">client fetch/XHR</div></div>
  </div>

  <!-- CWV Median (across all device results) -->
  <div class="sec-title">Core Web Vitals — Median across all devices</div>
  <div class="cwv-band">
    ${[
      {
        label: "LCP · Largest Contentful Paint",
        metric: "lcp",
        val: medLcp,
        fv: medLcp ? fmt(Math.round(medLcp)) : "–",
      },
      {
        label: "CLS · Cumulative Layout Shift",
        metric: "cls",
        val: medCls,
        fv: medCls !== undefined ? medCls.toFixed(3) : "–",
      },
      {
        label: "FCP · First Contentful Paint",
        metric: "fcp",
        val: medFcp,
        fv: medFcp ? fmt(Math.round(medFcp)) : "–",
      },
      {
        label: "TTFB · Time To First Byte",
        metric: "ttfb",
        val: medTtfb,
        fv: medTtfb ? fmt(Math.round(medTtfb)) : "–",
      },
    ]
      .map(({ label, metric, val, fv }) => {
        const g = val !== undefined ? grade(metric, val) : null;
        const c = g ? GRADE_COLOR[g] : "#6b7280";
        return `<div class="cwv"><div class="cl">${label}</div><div class="cv" style="color:${c}">${fv}</div>${
          g ? `<div class="cg" style="color:${c}">${GRADE_LABEL[g]}</div>` : ""
        }</div>`;
      })
      .join("")}
  </div>

  <!-- Overview table: one row per URL, columns per device -->
  <div class="sec-title">${tableTitle}</div>
  <div class="overview-wrap">
    <table class="overview-table">
      <thead>
        <tr>
          <th style="min-width:300px">URL</th>
          ${devHeaders}
          <th>Status</th>
        </tr>
        <tr>
          <th></th>
          ${devSubHeaders}
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${sortedGroups
          .map((g, i) => {
            const firstStatus = g.results[0]?.status;
            return `<tr>
            <td><a href="#ug-${groups.indexOf(g)}" title="${g.url}">${
              g.url.length > 70 ? "…" + g.url.slice(-67) : g.url
            }</a></td>
            ${devices
              .map((dev) => {
                const r = g.results.find((r) => r.profile?.id === dev.id);
                const v = r?.vitals ?? {};
                const lcpG2 = v.lcp ? grade("lcp", v.lcp) : null;
                const clsG2 = v.cls !== undefined ? grade("cls", v.cls) : null;
                const ttfbG2 = v.ttfb ? grade("ttfb", v.ttfb) : null;
                return `<td style="border-left:1px solid #2a2d38;color:${
                  lcpG2 ? GRADE_COLOR[lcpG2] : "#6b7280"
                };font-family:monospace;font-size:11px">${fmt(v.lcp)}</td>
                      <td style="color:${
                        clsG2 ? GRADE_COLOR[clsG2] : "#6b7280"
                      };font-family:monospace;font-size:11px">${fmtCls(
                  v.cls
                )}</td>
                      <td style="color:${
                        ttfbG2 ? GRADE_COLOR[ttfbG2] : "#6b7280"
                      };font-family:monospace;font-size:11px">${fmt(
                  v.ttfb
                )}</td>`;
              })
              .join("")}
            <td>${
              firstStatus
                ? `<span style="padding:2px 7px;border-radius:4px;font-family:monospace;font-size:10px;font-weight:700;${
                    firstStatus >= 400
                      ? "background:rgba(255,78,66,.1);color:#ff4e42;border:1px solid rgba(255,78,66,.25)"
                      : "background:rgba(12,206,107,.1);color:#0cce6b;border:1px solid rgba(12,206,107,.25)"
                  }">${firstStatus}</span>`
                : ""
            }</td>
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  </div>

  <!-- Per-URL cards with device tabs -->
  <div class="sec-title">All Pages (${total} URLs)</div>
  <div class="filter-bar">
    <input type="text" id="search" placeholder="Filter by URL…" oninput="filterCards()">
    <button class="fbtn active" onclick="filterBy('all',this)">All</button>
    <button class="fbtn" onclick="filterBy('poor',this)">Poor CWV</button>
    <button class="fbtn" onclick="filterBy('errors',this)">Errors</button>
    <button class="fbtn" onclick="filterBy('api',this)">Has API</button>
  </div>
  <div id="cards">
    ${groups.map((g, i) => urlGroupCard(g, i)).join("")}
  </div>

</div>

<script>
function switchTab(groupId, idx, total) {
  for (let i = 0; i < total; i++) {
    const panel = document.getElementById('dc-' + groupId + '-' + i);
    const tab   = document.getElementById('tab-' + groupId + '-' + i);
    if (panel) panel.style.display = i === idx ? 'block' : 'none';
    if (tab) {
      tab.style.borderBottomColor = i === idx ? '#7c6dff' : 'transparent';
      tab.style.color = i === idx ? '#7c6dff' : '#6b7280';
    }
  }
}

function filterCards() {
  const q = document.getElementById('search').value.toLowerCase();
  document.querySelectorAll('#cards .url-card').forEach(card => {
    const url = card.querySelector('a')?.textContent ?? '';
    card.style.display = url.toLowerCase().includes(q) || !q ? '' : 'none';
  });
}

function filterBy(type, btn) {
  document.querySelectorAll('.fbtn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#cards .url-card').forEach(card => {
    let show = true;
    if (type === 'poor')   show = card.innerHTML.includes('"poor"') || card.querySelector('[style*="ff4e42"]') !== null;
    if (type === 'errors') show = card.innerHTML.includes('⚠') || card.querySelector('[style*="rgba(255,78,66"]') !== null;
    if (type === 'api')    show = card.innerHTML.includes('SSR</span>') || card.innerHTML.includes('CSR</span>');
    card.style.display = show ? '' : 'none';
  });
}
</script>
</body>
</html>`;
}
