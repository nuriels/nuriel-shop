import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PRODUCTS, STORE_A } from "./helpers";

// השוואת iStores (מנוע משותף, כל החנויות): מה שגוגל מקבל ב-HTML מהשרת בלי JavaScript —
//   • מוצר / עמוד תוכן שלא קיים: 404 אמיתי (לא 200 + noindex), בעברית
//   • "/" בסוף: 308 אחד לכתובת הנקייה (היה 307 מהנתב)
//   • מוצרים נלווים / חלופות: קישורי <a href> אמיתיים; מוצר שאזל — חלופות במלאי ודרך לשאול
//   • Product JSON-LD: לא שם החנות כמותג; המותג והמצב שבעל החנות קבע (מיגרציה 207)
//   • הצהרת הנגישות כבר ב-HTML מהשרת
const HOST = hostOf(STORE_A.slug);

function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-tA", "-c", query], { encoding: "utf8" }).trim();
}

function productLd(html: string): Record<string, unknown> | undefined {
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const data = JSON.parse(m[1]!) as Record<string, unknown>;
    if (data["@type"] === "Product") return data;
  }
  return undefined;
}

test.describe("crawl parity", () => {
  test("a missing product is a real 404 — in Hebrew, inside the store frame", async ({
    request,
  }) => {
    const res = await hostGet(request, HOST, "/product/00000000-0000-4000-8000-0000000000ff");
    expect(res.status()).toBe(404);
    const html = await res.text();
    expect(html).toContain("המוצר לא נמצא");
    expect(html).not.toContain("Page not found");
    // not a soft 404 any more: no canonical, no Product data
    expect(productLd(html)).toBeUndefined();
  });

  test("an unknown content page is a real 404; a published one is 200 with its content", async ({
    request,
  }) => {
    const missing = await hostGet(request, HOST, "/pages/no-such-page-e2e");
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain("העמוד לא נמצא");
    sql(`INSERT INTO public.pages (tenant_id, slug, title, content_html, is_published)
         VALUES ('${STORE_A.id}', 'crawl-parity-e2e', 'עמוד בדיקה', '<p>תוכן שגוגל רואה</p>', true)
         ON CONFLICT DO NOTHING`);
    try {
      const page = await hostGet(request, HOST, "/pages/crawl-parity-e2e");
      expect(page.status()).toBe(200);
      expect(await page.text()).toContain("תוכן שגוגל רואה");
    } finally {
      sql(
        `DELETE FROM public.pages WHERE tenant_id = '${STORE_A.id}' AND slug = 'crawl-parity-e2e'`,
      );
    }
  });

  test("a trailing slash / double slash → one permanent 308 to the clean URL, query kept", async ({
    request,
  }) => {
    const res = await hostGet(request, HOST, "/about/?ref=x");
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toBe("/about?ref=x");
    const dbl = await hostGet(request, HOST, `//product//${PRODUCTS.a1.id}`);
    expect(dbl.status()).toBe(308);
    expect(dbl.headers()["location"]).toBe(`/product/${PRODUCTS.a1.id}`);
    // the clean URL itself answers 200
    expect((await hostGet(request, HOST, "/about")).status()).toBe(200);
  });

  test("an out-of-stock product: in-stock alternatives as real links + a way to ask; still 200 (OutOfStock)", async ({
    request,
  }) => {
    sql(`UPDATE public.global_products SET is_out_of_stock = true WHERE id = '${PRODUCTS.a1.id}'`);
    try {
      const res = await hostGet(request, HOST, `/product/${PRODUCTS.a1.id}`);
      expect(res.status()).toBe(200);
      const html = await res.text();
      expect(html).toContain('data-testid="out-of-stock-help"');
      expect(html).toContain("מוצרים דומים שיש במלאי");
      // the alternative from the same category is a crawlable link (it was a <button>)
      expect(html).toMatch(new RegExp(`<a[^>]+href="/product/${PRODUCTS.a2.id}"`));
      expect(html).toContain('href="/contact"');
      expect((productLd(html)?.["offers"] as Record<string, unknown>)?.["availability"]).toBe(
        "https://schema.org/OutOfStock",
      );
    } finally {
      sql(
        `UPDATE public.global_products SET is_out_of_stock = false WHERE id = '${PRODUCTS.a1.id}'`,
      );
    }
  });

  test("Product JSON-LD: never the store name as brand; the brand and condition the owner set (migration 207)", async ({
    request,
  }) => {
    const before = productLd(
      await (await hostGet(request, HOST, `/product/${PRODUCTS.a1.id}`)).text(),
    );
    expect(before).toBeDefined();
    expect(before).not.toHaveProperty("brand");
    expect((before!["offers"] as Record<string, unknown>)["itemCondition"]).toBe(
      "https://schema.org/NewCondition",
    );
    sql(`UPDATE public.global_products SET brand = 'Golan Heights', item_condition = 'refurbished'
          WHERE id = '${PRODUCTS.a1.id}'`);
    try {
      const html = await (await hostGet(request, HOST, `/product/${PRODUCTS.a1.id}`)).text();
      const ld = productLd(html)!;
      expect(ld["brand"]).toEqual({ "@type": "Brand", name: "Golan Heights" });
      expect((ld["offers"] as Record<string, unknown>)["itemCondition"]).toBe(
        "https://schema.org/RefurbishedCondition",
      );
      // what the structured data says is also on the page
      expect(html).toContain("data-product-brand");
      expect(html).toContain('data-product-condition="refurbished"');
    } finally {
      sql(
        `UPDATE public.global_products SET brand = NULL, item_condition = NULL WHERE id = '${PRODUCTS.a1.id}'`,
      );
    }
  });

  test("the accessibility statement is in the server HTML (it was 'loading…')", async ({
    request,
  }) => {
    const res = await hostGet(request, HOST, "/accessibility");
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-testid="accessibility-statement"');
    expect(html).toContain("פנייה בנושא נגישות");
  });

  test("the store's llms.txt (owner switch on) lists the business details the footer shows", async ({
    request,
  }) => {
    const res = await hostGet(request, hostOf("store-b"), "/llms.txt");
    test.skip(res.status() === 404, "llms.txt is off in this store");
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("## עמודי האתר");
  });
});
