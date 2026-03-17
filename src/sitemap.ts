import axios from "axios";
import { parseStringPromise } from "xml2js";

const ORIGIN_REPLACE_FROM = "https://www.kitchenwarehouse.com.au";
const ORIGIN_REPLACE_TO = "https://kwh-kitchenwarehouse.netlify.app";

function rewriteUrl(original: string): string {
  return original.startsWith(ORIGIN_REPLACE_FROM)
    ? ORIGIN_REPLACE_TO + original.slice(ORIGIN_REPLACE_FROM.length)
    : original;
}

export async function getUrlsFromSitemap(url: string): Promise<string[]> {
  const { data } = await axios.get(url, {
    timeout: 30000,
    headers: { "User-Agent": "SiteAuditBot/1.0" },
  });

  const parsed = await parseStringPromise(data);

  // Handle sitemap index (references child sitemaps)
  if (parsed.sitemapindex?.sitemap) {
    const childUrls: string[] = parsed.sitemapindex.sitemap.map((s: any) => {
      const rewritten = rewriteUrl(s.loc[0]);
      console.log(`  child sitemap: ${rewritten}`);
      return rewritten; // ← was returning s.loc[0] before
    });

    console.log(`  Sitemap index: ${childUrls.length} child sitemaps`);

    const nested = await Promise.all(
      childUrls.map((u) =>
        getUrlsFromSitemap(u).catch((err) => {
          console.warn(`  ⚠ Failed to fetch ${u}: ${err.message}`);
          return [] as string[];
        })
      )
    );
    return nested.flat();
  }

  // Standard sitemap — rewrite every page URL too
  if (parsed.urlset?.url) {
    return parsed.urlset.url.map((u: any) => rewriteUrl(u.loc[0]));
  }

  throw new Error("Unrecognised sitemap format");
}
