import { createApiBuilderFromCtpClient } from "@commercetools/platform-sdk";
import { ClientBuilder } from "@commercetools/sdk-client-v2";

// ── CT environment selection ──────────────────────────────────────────────
// Each env has its own prefixed set of vars. Callers pass "production" or
// "staging"; every env-var lookup runs through envVar(env, "CTP_API_URL")
// which resolves to PROD_CTP_API_URL or STG_CTP_API_URL respectively.
export type CTEnv = "production" | "staging";

const ENV_PREFIX: Record<CTEnv, string> = {
  production: "PROD_",
  staging:    "STG_",
};

function envVar(env: CTEnv, name: string): string {
  const key = ENV_PREFIX[env] + name;
  const v = process.env[key];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${key}. See .env.example.`);
  }
  return v;
}

// ── CT client — memoised per env so we don't re-auth on every call ────────
type ApiRoot = ReturnType<
  ReturnType<typeof createApiBuilderFromCtpClient>["withProjectKey"]
>;
const clientCache = new Map<CTEnv, ApiRoot>();

function getClient(env: CTEnv): ApiRoot {
  const hit = clientCache.get(env);
  if (hit) return hit;

  const projectKey = envVar(env, "CTP_PROJECT_KEY");
  const authMiddleware = {
    host: envVar(env, "CTP_AUTH_URL"),
    projectKey,
    credentials: {
      clientId: envVar(env, "CTP_CLIENT_ID"),
      clientSecret: envVar(env, "CTP_CLIENT_SECRET"),
    },
    scopes: [envVar(env, "CTP_SCOPES")],
    httpClient: fetch,
  };
  const httpMiddleware = { host: envVar(env, "CTP_API_URL") };

  const ctpClient = new ClientBuilder()
    .withProjectKey(projectKey)
    .withClientCredentialsFlow(authMiddleware as any)
    .withHttpMiddleware(httpMiddleware)
    .build();

  const apiRoot = createApiBuilderFromCtpClient(ctpClient).withProjectKey({ projectKey });
  clientCache.set(env, apiRoot);
  return apiRoot;
}

// ── GraphQL query: URL-only, no images/videos/name/description ────────────
const CT_URLS_QUERY = `
  query getCTProductUrls($whereCond: [SearchFilterInput!], $limit: Int, $offset: Int, $sort: [String!]) {
    productProjectionSearch(
      filters: $whereCond,
      limit: $limit,
      offset: $offset,
      localeProjection: "en-AU",
      sorts: $sort
    ) {
      total
      results {
        masterVariant {
          prices { channel { key } value { centAmount } }
          attributesRaw(includeNames: ["CTProductUrlComponent", "isInactive", "isDisplay", "siteKeys"]) {
            name
            value
          }
        }
      }
    }
  }
`;

// Server-side filters applied via CT's productProjectionSearch. siteKeys is a
// per-store enablement tag — "kwh|T" means "enabled for the Kitchen Warehouse
// storefront". We only want URLs valid for that site.
const CT_ACTIVE_FILTER = [
  { model: { value: { path: "variants.attributes.isInactive", values: ["false"] } } },
  { model: { value: { path: "variants.attributes.isDisplay",  values: ["true"]  } } },
  { model: { value: { path: "variants.attributes.siteKeys",   values: ["KWH|T"] } } },
];

// CT enforces `offset + limit <= 10000` on productProjectionSearch. To reach
// records past the ceiling we flip the sort direction and offset from the top.
const CT_OFFSET_CEILING = 10000;
const PAGE_SIZE = 500;

async function fetchPage(env: CTEnv, offset: number, sortDir: "asc" | "desc"): Promise<any> {
  return getClient(env).graphql().post({
    body: {
      query: CT_URLS_QUERY,
      variables: {
        limit: PAGE_SIZE,
        offset,
        sort: [`createdAt ${sortDir}`],
        whereCond: CT_ACTIVE_FILTER,
      },
    },
  }).execute();
}

function extractUrls(response: any, baseUrl: string, into: Set<string>): void {
  const results = response?.body?.data?.productProjectionSearch?.results ?? [];
  for (const p of results) {
    const attrs: any[] = p?.masterVariant?.attributesRaw ?? [];
    const findAttr = (name: string) => attrs.find((a) => a?.name === name)?.value;

    const slug: string | undefined = findAttr("CTProductUrlComponent");
    const isInactive = findAttr("isInactive");
    const isDisplay = findAttr("isDisplay");
    const siteKeys = findAttr("siteKeys");
    // siteKeys can come back as a string, array, or set-of-strings depending
    // on how CT serialises the attribute. Normalise before membership check.
    const hasKwhKey = Array.isArray(siteKeys)
      ? siteKeys.includes("KWH|T")
      : typeof siteKeys === "string"
        ? siteKeys === "KWH|T"
        : false;
    const hasValidPrice = !!p?.masterVariant?.prices?.find(
      (price: any) => price?.channel?.key === "rrp" && price?.value?.centAmount > 0
    );

    if (
      slug &&
      isInactive === false &&
      isDisplay === true &&
      hasKwhKey &&
      hasValidPrice
    ) {
      const base = baseUrl.replace(/\/$/, "");
      const path = slug.startsWith("/") ? slug : `/${slug}`;
      into.add(`${base}${path}`);
    }
  }
}

// ── Public: fetch all valid product URLs from CT for the given env ───────
export async function getCTProductUrls(
  env: CTEnv,
  onProgress?: (msg: string) => void
): Promise<string[]> {
  const baseUrl = envVar(env, "CT_BASE_URL");
  const label = env === "production" ? "prod" : "stg";

  onProgress?.(`CT [${label}]: fetching first page…`);
  const first = await fetchPage(env, 0, "asc");
  const total: number = first?.body?.data?.productProjectionSearch?.total ?? 0;
  onProgress?.(`CT [${label}]: ${total} products found, paging in ${PAGE_SIZE}-item batches`);

  const seen = new Set<string>();
  extractUrls(first, baseUrl, seen);

  const ascPromises: Promise<any>[] = [];
  const ascEnd = Math.min(total, CT_OFFSET_CEILING);
  for (let offset = PAGE_SIZE; offset < ascEnd; offset += PAGE_SIZE) {
    ascPromises.push(fetchPage(env, offset, "asc"));
  }

  const descPromises: Promise<any>[] = [];
  if (total > CT_OFFSET_CEILING) {
    const remaining = total - CT_OFFSET_CEILING;
    for (let offset = 0; offset < remaining; offset += PAGE_SIZE) {
      descPromises.push(fetchPage(env, offset, "desc"));
    }
  }

  const [asc, desc] = await Promise.all([
    Promise.all(ascPromises),
    Promise.all(descPromises),
  ]);
  for (const r of asc) extractUrls(r, baseUrl, seen);
  for (const r of desc) extractUrls(r, baseUrl, seen);

  onProgress?.(`CT [${label}]: ${seen.size} valid product URLs`);
  return [...seen];
}
