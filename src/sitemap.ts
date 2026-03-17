import axios from "axios";
import { parseStringPromise } from "xml2js";

/**
 * Fetch URLs from either:
 *  - A sitemap XML (if url ends with .xml or content-type is xml)
 *  - A plain URL list (one URL per line, text response)
 *  - A single page URL (just returns [url])
 *
 * No hardcoded domain rewrites. URLs are returned exactly as found in the sitemap.
 * Rewriting (e.g. prod → staging) is the caller's responsibility via the config panel.
 */
export async function getUrlsFromSitemap(url: string): Promise<string[]> {
  const { data, headers } = await axios.get(url, {
    timeout: 30000,
    headers: { "User-Agent": "SiteAuditBot/1.0" },
    // Accept both XML and plain text
    responseType: "text",
  });

  const contentType = headers["content-type"] ?? "";
  const isXml = url.endsWith(".xml") || contentType.includes("xml");

  // ── Plain text list ──────────────────────────────────────────────────
  if (!isXml) {
    // Could be a newline-separated list of URLs, or a single URL
    const lines = String(data)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
    if (lines.length > 0) return lines;
    // Single page — just return it
    return [url];
  }

  // ── XML sitemap ──────────────────────────────────────────────────────
  const parsed = await parseStringPromise(data);

  // Sitemap index — recursively fetch child sitemaps
  if (parsed.sitemapindex?.sitemap) {
    const childUrls: string[] = parsed.sitemapindex.sitemap.map(
      (s: any) => s.loc[0]
    );
    console.log(`  Sitemap index: ${childUrls.length} child sitemaps`);

    const nested = await Promise.all(
      childUrls.map((u) =>
        getUrlsFromSitemap(u).catch((err) => {
          console.warn(
            `  ⚠ Failed to fetch child sitemap ${u}: ${err.message}`
          );
          return [] as string[];
        })
      )
    );
    return nested.flat();
  }

  // Standard urlset
  if (parsed.urlset?.url) {
    return parsed.urlset.url.map((u: any) => u.loc[0]);
  }

  throw new Error(
    "Unrecognised sitemap format — expected <urlset> or <sitemapindex>"
  );
}
