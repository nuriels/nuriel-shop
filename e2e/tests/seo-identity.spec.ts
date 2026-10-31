import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { PORT, PRODUCTS, STORE_A, USERS, hostOf, storeUrl } from "./helpers";

// Store identity (StoreIdentity, stage 1): every store gets only its own name, Schema and
// SEO — from its own settings — with no identity leaking between stores, no made-up brand,
// no old-project name ("סוכנות המשקאות") and no platform name in a store's SEO.
// Three disposable stores are created for the test and deleted afterwards; the main test
// store (kobi) is only read: its database row still has the old column default
// site_title = "סוכנות המשקאות" from the migrations, like a fresh install.

const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const FOREIGN = ["סוכנות המשקאות", "נוריאל מחשבים", "Nuriel Shop", "nuriel-shop.co.il"];

function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();
}
const q = (value: string) => `'${value.replace(/'/g, "''")}'`;

type Store = {
  key: "x" | "y" | "z";
  slug: string;
  id: string;
  tenantName: string;
  businessName: string;
  siteTitle: string;
  address: string;
  /** what every SEO field must say */
  name: string;
  /** the visible header */
  display: string;
  alternate: string | null;
  category: string;
  product: { id: string; name: string };
  page: { slug: string; title: string };
};

const stamp = Date.now().toString(36);
const STORES: Store[] = [
  {
    key: "x",
    slug: `e2e-idx-${stamp}`,
    id: randomUUID(),
    tenantName: "טננט איקס",
    businessName: "חשמל אלפא בעמ",
    siteTitle: "חשמל אלפא",
    address: "",
    name: "חשמל אלפא בעמ",
    display: "חשמל אלפא",
    alternate: "חשמל אלפא",
    category: "כבלים אלפא",
    product: { id: randomUUID(), name: "כבל מתאם אלפא" },
    page: { slug: "about-alpha", title: "הסיפור של אלפא" },
  },
  {
    key: "y",
    slug: `e2e-idy-${stamp}`,
    id: randomUUID(),
    tenantName: "טננט וואי",
    businessName: "ספרי בטא",
    siteTitle: "",
    address: "רחוב הספר 7, חיפה",
    name: "ספרי בטא",
    display: "ספרי בטא",
    alternate: null,
    category: "ספרי ילדים בטא",
    product: { id: randomUUID(), name: "ספר תמונות בטא" },
    page: { slug: "about-beta", title: "הסיפור של בטא" },
  },
  {
    key: "z",
    slug: `e2e-idz-${stamp}`,
    id: randomUUID(),
    tenantName: "טננט זד",
    businessName: "",
    siteTitle: "",
    address: "",
    name: "החנות שלי",
    display: "החנות שלי",
    alternate: null,
    category: "קטגוריה זד",
    product: { id: randomUUID(), name: "מוצר זד" },
    page: { slug: "about-zed", title: "הסיפור של זד" },
  },
];
const X = STORES[0]!;
const Y = STORES[1]!;
const Z = STORES[2]!;
/** everything that identifies one store — must never show up in another store */
const marks = (s: Store) =>
  [s.businessName, s.siteTitle, s.tenantName, s.product.name, s.category, s.slug].filter(Boolean);

async function get(request: APIRequestContext, slug: string, path: string) {
  const host = hostOf(slug);
  const response = await request.get(`http://127.0.0.1:${PORT}${path}`, {
    headers: { host, "x-forwarded-host": host, "user-agent": UA },
    maxRedirects: 0,
  });
  expect(response.status(), `${slug}${path}`).toBe(200);
  return response.text();
}

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
function titleOf(html: string): string {
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/g)];
  expect(titles, "exactly one <title>").toHaveLength(1);
  return decode(titles[0]![1]!);
}
const metaOf = (html: string, key: string) =>
  decode(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html)?.[1] ?? "");
const canonicalOf = (html: string) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? "";
type Node = Record<string, unknown>;
function jsonLd(html: string): Node[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(
    (m) => {
      const data = JSON.parse(m[1]!) as Node;
      return Array.isArray(data["@graph"]) ? (data["@graph"] as Node[]) : [data];
    },
  );
}
const ofType = (nodes: Node[], type: string) =>
  nodes.find(
    (n) => n["@type"] === type || (Array.isArray(n["@type"]) && n["@type"].includes(type)),
  );

test.describe("store identity: each store has its own name, Schema and SEO", () => {
  test.beforeAll(() => {
    for (const s of STORES) {
      sql(`INSERT INTO public.tenants (id, slug, name, owner_email)
           VALUES (${q(s.id)}, ${q(s.slug)}, ${q(s.tenantName)}, 'owner.${s.key}@e2e.test')`);
      sql(`UPDATE public.site_settings
              SET business_name = ${q(s.businessName)}, site_title = ${q(s.siteTitle)},
                  business_address = ${q(s.address)}, seo_title = '', seo_description = '',
                  llms_txt_enabled = true
            WHERE tenant_id = ${q(s.id)}`);
      sql(`INSERT INTO public.categories (tenant_id, name) VALUES (${q(s.id)}, ${q(s.category)})`);
      sql(`INSERT INTO public.global_products (id, tenant_id, created_by, sku, name, category,
             description, price_tier1, price_tier2, price_tier3, stock_quantity)
           VALUES (${q(s.product.id)}, ${q(s.id)}, ${q(USERS.platform.id)}, '91000001',
             ${q(s.product.name)}, ${q(s.category)}, 'מוצר לבדיקת זהות החנות', 30, 30, 30, 5)`);
      sql(`INSERT INTO public.pages (tenant_id, slug, title, content_html, is_published)
           VALUES (${q(s.id)}, ${q(s.page.slug)}, ${q(s.page.title)}, '<p>טקסט</p>', true)`);
    }
    // the Zap pages (product index for price comparison) are an add-on — on for X only
    sql(`INSERT INTO public.tenant_addons (tenant_id, addon_name, status, source)
         VALUES (${q(X.id)}, 'zapier', 'active', 'grant')`);
  });

  test.afterAll(() => {
    for (const s of STORES) {
      sql(`SELECT set_config('request.jwt.claims',
             json_build_object('sub', ${q(USERS.platform.id)}, 'role', 'authenticated')::text, false);
           SELECT public.platform_delete_tenant(${q(s.id)}, ${q(s.slug)})`);
    }
  });

  for (const s of STORES) {
    test(`${s.key}: home, category, product and page carry only "${s.name}"`, async ({
      request,
    }) => {
      const origin = `https://${hostOf(s.slug)}`;

      const home = await get(request, s.slug, "/");
      expect(titleOf(home)).toBe(s.name);
      expect(metaOf(home, "og:title")).toBe(s.name);
      expect(metaOf(home, "og:site_name")).toBe(s.name);
      expect(metaOf(home, "description")).toBe(s.name);
      expect(canonicalOf(home)).toBe(`${origin}/`);
      const nodes = jsonLd(home);
      const website = ofType(nodes, "WebSite")!;
      const organization = ofType(nodes, "Organization") ?? ofType(nodes, "LocalBusiness")!;
      for (const node of [website, organization]) {
        expect(node["name"]).toBe(s.name);
        expect(node["alternateName"]).toBe(s.alternate ?? undefined);
        expect(String(node["url"])).toBe(`${origin}/`);
      }
      // a business address makes it a LocalBusiness (Store); otherwise an Organization
      expect(organization["@type"]).toEqual(
        s.address ? ["Store", "LocalBusiness"] : "Organization",
      );

      const category = await get(request, s.slug, `/?category=${encodeURIComponent(s.category)}`);
      expect(titleOf(category)).toBe(`${s.category} | ${s.name}`);
      expect(metaOf(category, "og:site_name")).toBe(s.name);
      const crumbs = ofType(jsonLd(category), "BreadcrumbList")!;
      const first = (crumbs["itemListElement"] as Node[])[0]!;
      expect(first["name"]).toBe(s.name);

      const product = await get(request, s.slug, `/product/${s.product.id}`);
      expect(titleOf(product)).toBe(`${s.product.name} | ${s.name}`);
      expect(canonicalOf(product)).toBe(`${origin}/product/${s.product.id}`);
      const item = ofType(jsonLd(product), "Product")!;
      expect(item).not.toHaveProperty("brand");
      expect((item["offers"] as Node)["seller"]).toEqual({ "@type": "Organization", name: s.name });

      const page = await get(request, s.slug, `/pages/${s.page.slug}`);
      expect(titleOf(page)).toBe(`${s.page.title} | ${s.name}`);

      const llms = await get(request, s.slug, "/llms.txt");
      expect(llms.split("\n")[0]).toBe(`# ${s.name}`);

      const robots = await get(request, s.slug, "/robots.txt");
      expect(robots).toContain(`Sitemap: ${origin}/sitemap.xml`);
      const sitemap = await get(request, s.slug, "/sitemap.xml");
      const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);
      expect(locs).toContain(`${origin}/product/${s.product.id}`);
      for (const loc of locs) expect(loc.startsWith(`${origin}/`), loc).toBe(true);

      // nothing of another store, of the old project or of the platform — anywhere
      const all = [home, category, product, page, llms, robots, sitemap].join("\n");
      for (const other of STORES.filter((o) => o !== s)) {
        for (const mark of [...marks(other), other.product.id]) {
          expect(all, `${s.key} must not mention ${other.key}: ${mark}`).not.toContain(mark);
        }
      }
      for (const word of FOREIGN) expect(all).not.toContain(word);
      // a store without any name never borrows the platform-admin name of the tenant row
      if (s === Z) expect(all).not.toContain(Z.tenantName);
    });
  }

  test("x: the Zap product pages carry the store's own name", async ({ request }) => {
    const zap = await get(request, X.slug, "/zap");
    expect(zap).toContain(X.name);
    for (const mark of [...marks(Y), ...marks(Z), ...FOREIGN]) expect(zap).not.toContain(mark);
  });

  test("in the browser: visible header as before, H1, footer and page titles", async ({ page }) => {
    for (const s of STORES) {
      await page.goto(storeUrl(s.slug, "/"));
      // the visible header keeps the display name (site_title), as before this change
      await expect(page.getByRole("banner")).toContainText(s.display);
      await expect(page.locator("h1")).toHaveText(s.name);
      await expect(page.getByRole("contentinfo")).toContainText(`${s.name}. כל הזכויות שמורות.`);
      await page.goto(storeUrl(s.slug, "/about"));
      await expect(page).toHaveTitle(`אודות | ${s.name}`);
      await page.goto(storeUrl(s.slug, "/terms"));
      await expect(page).toHaveTitle(`תקנון האתר | ${s.name}`);
      for (const other of STORES.filter((o) => o !== s)) {
        for (const name of [other.businessName, other.siteTitle].filter(Boolean)) {
          await expect(page.locator("body")).not.toContainText(name);
        }
      }
    }
  });
});

test.describe("store identity: the old column default never shows (main test store)", () => {
  test("site_title 'סוכנות המשקאות' from the migrations is not used as a name", async ({
    request,
    page,
  }) => {
    // the precondition: the row still has the old default (read only — nothing is changed)
    expect(
      sql(`SELECT site_title || '|' || business_name FROM public.site_settings
            WHERE tenant_id = ${q(STORE_A.id)}`),
    ).toBe("סוכנות המשקאות|");
    const home = await get(request, STORE_A.slug, "/");
    const product = await get(request, STORE_A.slug, `/product/${PRODUCTS.a1.id}`);
    expect(titleOf(home)).toBe("החנות שלי");
    expect(titleOf(product)).toBe(`${PRODUCTS.a1.name} | החנות שלי`);
    const item = ofType(jsonLd(product), "Product")!;
    expect((item["offers"] as Node)["seller"]).toEqual({
      "@type": "Organization",
      name: "החנות שלי",
    });
    for (const html of [home, product]) expect(html).not.toContain("סוכנות המשקאות");

    await page.goto(storeUrl(STORE_A.slug, "/"));
    await expect(page.getByRole("banner")).toContainText("החנות שלי");
    await expect(page.getByRole("banner")).not.toContainText("סוכנות המשקאות");
    await page.goto(storeUrl(STORE_A.slug, "/about"));
    await expect(page.locator("body")).not.toContainText("סוכנות המשקאות");
  });
});
