import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PRODUCTS, STORE_A, STORE_B } from "./helpers";

const HOST = hostOf(STORE_A.slug);

// מבנה ה-SEO של החנויות — ערכים יציבים בלבד (בלי תאריכים) כדי למנוע כשלי שווא
test.describe("SEO", () => {
  test("robots.txt baseline", async ({ request }) => {
    const res = await hostGet(request, HOST, "/robots.txt");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    expect(body).toMatchSnapshot("robots.txt");
  });

  test("sitemap.xml is valid and lists the store pages and products", async ({ request }) => {
    const res = await hostGet(request, HOST, "/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("xml");
    const body = await res.text();
    expect(body).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!).sort();
    expect(locs.join("\n")).toMatchSnapshot("sitemap-locs.txt");
    expect(body).toContain(`/product/${PRODUCTS.a1.id}`);
  });

  // llms.txt אופציונלי (site_settings.llms_txt_enabled): כבוי בחנות A, מופעל ב-B (seed)
  test("llms.txt follows the store setting", async ({ request }) => {
    expect((await hostGet(request, HOST, "/llms.txt")).status()).toBe(404);
    const res = await hostGet(request, hostOf(STORE_B.slug), "/llms.txt");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("חנות B");
  });

  test("home page SSR metadata", async ({ request }) => {
    const html = await (await hostGet(request, HOST, "/")).text();
    expect(html).toMatch(/<html[^>]*lang="he"/);
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]+"/);
    expect(html).toMatch(/<meta property="og:title" content="[^"]+"/);
    expect(html).toMatch(/<link rel="canonical" href="[^"]+"/);
    expect(html).toContain("application/ld+json");
  });

  test("product page SSR metadata and structured data", async ({ request }) => {
    const html = await (await hostGet(request, HOST, `/product/${PRODUCTS.a1.id}`)).text();
    expect(html).toContain(`<title>${PRODUCTS.a1.name}`);
    expect(html).toMatch(/<meta property="og:title" content="[^"]+"/);
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const types = blocks.flatMap((m) => {
      const data = JSON.parse(m[1]!) as { "@type"?: string } | { "@type"?: string }[];
      return (Array.isArray(data) ? data : [data]).map((d) => d["@type"]);
    });
    expect(types).toContain("Product");
  });
});
