import axios from "axios";
import pLimit from "p-limit";

/**
 * Fetch URLs from either:
 *  - A sitemap XML (if url ends with .xml or content-type is xml)
 *  - A plain URL list (one URL per line, text response)
 *  - A single page URL (just returns [url])
 *
 * XML parsing uses a targeted regex rather than a full DOM parser. Sitemap
 * files commonly include per-URL `<image:image>` / `<video:video>` metadata
 * that we never use — parsing that with xml2js is where the wall-clock time
 * used to disappear on large PDP sitemaps.
 */

const LOC_RE = /<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi;

// Detect the root wrapper without parsing the whole tree
const IS_INDEX_RE = /<sitemapindex[\s>]/i;
const IS_URLSET_RE = /<urlset[\s>]/i;

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const raw = m[1]
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    out.push(raw);
  }
  return out;
}

export interface HttpAuth {
  username?: string;
  password?: string;
  cookie?: string;
}

async function fetchText(
  url: string,
  auth?: HttpAuth
): Promise<{ body: string; contentType: string }> {
  const hasBasic = !!(auth?.username && auth?.password);
  const { data, headers } = await axios.get(url, {
    timeout: 45000,
    responseType: "text",
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    ...(hasBasic ? { auth: { username: auth!.username!, password: auth!.password! } } : {}),
    headers: {
      "User-Agent": "SiteAuditBot/1.0",
      "Accept-Encoding": "gzip, deflate, br",
      Accept: "application/xml, text/xml, text/plain, */*",
      ...(auth?.cookie ? { Cookie: auth.cookie } : {}),
    },
  });
  return { body: String(data), contentType: headers["content-type"] ?? "" };
}

export async function getUrlsFromSitemap(
  url: string,
  onProgress?: (msg: string) => void,
  auth?: HttpAuth
): Promise<string[]> {
  const { body, contentType } = await fetchText(url, auth);

  const isXml =
    url.endsWith(".xml") ||
    url.endsWith(".xml.gz") ||
    contentType.includes("xml") ||
    /^\s*<\?xml/.test(body) ||
    IS_INDEX_RE.test(body) ||
    IS_URLSET_RE.test(body);

  // ── Plain text list ──────────────────────────────────────────────────
  if (!isXml) {
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
    if (lines.length > 0) return lines;
    return [url];
  }

  // ── Sitemap index ────────────────────────────────────────────────────
  if (IS_INDEX_RE.test(body)) {
    const childUrls = extractLocs(body);
    const msg = `Sitemap index: ${childUrls.length} child sitemaps`;
    console.log(`  ${msg}`);
    onProgress?.(msg);

    // Cap parallel child fetches — hammering a host with 50+ concurrent GETs
    // often makes them slower (or gets rate-limited) than 6 in flight.
    const limit = pLimit(6);
    let done = 0;
    const nested = await Promise.all(
      childUrls.map((u) =>
        limit(async () => {
          try {
            const urls = await getUrlsFromSitemap(u);
            done++;
            onProgress?.(`Fetched ${done}/${childUrls.length} child sitemaps`);
            return urls;
          } catch (err: any) {
            done++;
            console.warn(`  ⚠ Failed to fetch child sitemap ${u}: ${err.message}`);
            onProgress?.(`Fetched ${done}/${childUrls.length} child sitemaps (some failed)`);
            return [] as string[];
          }
        })
      )
    );
    return nested.flat();
  }

  // ── Standard urlset ──────────────────────────────────────────────────
  if (IS_URLSET_RE.test(body)) {
    return extractLocs(body);
  }

  throw new Error("Unrecognised sitemap format — expected <urlset> or <sitemapindex>");
}
