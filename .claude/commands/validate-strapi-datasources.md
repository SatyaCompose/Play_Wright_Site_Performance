---
description: Run the Strapi datasource validation flow — fetch Production URLs, audit on Staging, compare results.
argument-hint: "[content-sitemap-url] [plp-sitemap-url]"
---

# Validate Strapi datasources (prod URLs → staging audit)

Executes the end-to-end Strapi datasource validation workflow this repo was built for: pull URLs from Production sitemaps, load every page against `staging.kitchenwarehouse.com.au`, and produce a report whose URLs are still the Production URLs so results are comparable across environments.

## Arguments

- `$1` — Content sitemap URL (defaults to `https://www.kitchenwarehouse.com.au/sitemap-content-pages.xml`)
- `$2` — PLP sitemap URL (defaults to `https://www.kitchenwarehouse.com.au/sitemap-product-list-pages.xml`)

## Preflight

1. Confirm both env vars are set — `STG_CYPRESS_CI_BYPASS_TOKEN` (required for the staging nav) and `PROD_CYPRESS_CI_BYPASS_TOKEN` (required if the operator also runs a prod baseline). Read `.env` if present; do not print token values.
2. Confirm `npm run dev` is not already running on `PORT` (default 7331). If it is, reuse it; otherwise start it in the background.
3. Confirm `dist/dashboard.html` was copied by `npm run build` when running the compiled server.

## Steps

1. Start the dev server (`npm run dev`) if not already running, and wait for `http://localhost:7331/` to respond.
2. Open the dashboard (already auto-opens on start), then instruct the operator:
   - Select audit mode → **🧩 Strapi · Datasource scan**
   - Paste the Content sitemap URL: `$1`
   - Paste the PLP sitemap URL: `$2`
   - Tick **"Fetch Production URLs → audit on Staging"**
   - (Optional) Tick **"Include PDPs from Commercetools"** — CT env auto-locks to Production
   - Click **"Fetch URLs from all selected sources →"**, then **Start Audit**
3. While the audit runs, monitor server logs for:
   - `🔓 KWH WAF bypass tokens loaded (STG:*ch, PROD:*ch)` — confirms both tokens loaded at startup
   - `Strapi-mixed loaded N URLs (content=…, plp=…, pdp=…)` — confirms the merge worked
   - Per-URL failures with `wafChallenged` — flag for retest
4. When the run completes, retrieve:
   - `strapi-report.html` (visual) — download from the dashboard's report bar
   - `strapi-report.csv` (diffable) — download from the same bar
5. Hand the CSV to the `strapi-validator` subagent for interpretation:
   - Regressions (Strapi found in prod baseline but absent on staging)
   - Inconclusive rows (`totalSeen: 0` or `wafChallenged`)
   - Migration-boundary rows (`strapi/*` on one side, `builder/component` on the other)

## Optional: prod-vs-staging comparison

For a full comparison, run twice with the same URL set:

1. **Baseline (prod)** — toggle OFF, run against prod. Save `strapi-report-prod.csv`.
2. **Target (staging)** — toggle ON with the same sitemap inputs. Save `strapi-report-staging.csv`.
3. Diff the two CSVs on the URL column; every row whose Strapi/Builder column flipped is a real environment delta.

## Non-goals

- This command does not modify the audit itself — it only orchestrates the operator flow. If a bug in the walker or WAF handling surfaces, hand off to the `debugger` agent.
- Do not attempt to run the audit purely programmatically — the WebSocket protocol is designed around the dashboard as the operator surface.

## Related

- Agent: `strapi-validator` — interprets the resulting report
- Docs: `README.md` → "Audit modes" section; `CLAUDE.md` → audit-mode table
- Runner: `src/runner.ts` `auditPage()` — search for "isStrapiMode" for the walker
- Loader: `src/index.ts` `if (msg.sourceType === "strapi-mixed")` — search for "auditOnStaging"
