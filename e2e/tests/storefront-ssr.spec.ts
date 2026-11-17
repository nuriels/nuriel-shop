import { expect, test, type APIRequestContext } from "@playwright/test";
import { A, AUTH, hostGet, hostOf, PRODUCTS, STORE_A, STORE_B } from "./helpers";
import { sql } from "./hospitality-helpers";

/**
 * עמודי החנות נבנים בשרת (SEO): מה שגוגל מקבל בלי JavaScript — H1, תוכן, מוצרים, מחירים, תמונות
 * ו-Schema — הוא מה שאורח רואה, רק של החנות של הבקשה. בדפדפן העמוד ממשיך כמו קודם: אין אי-התאמה
 * בהידרציה, הסל מתווסף רק אחרי שהמחירים של מי שמחובר נטענו, ולקוח עם מחירון משלו מקבל את המחיר שלו.
 */

const KOBI = hostOf(STORE_A.slug);
const STOREB = hostOf(STORE_B.slug);

/** ה-HTML שהשרת מחזיר (בלי JavaScript) — הגוף בלבד, בלי סקריפטים */
async function serverHtml(request: APIRequestContext, host: string, path: string) {
  const res = await hostGet(request, host, path);
  expect(res.status(), path).toBe(200);
  const html = await res.text();
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? "";
  const visible = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  const text = visible
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  const h1 = [...visible.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
    m[1]!.replace(/<[^>]+>/g, "").trim(),
  );
  const ldTypes = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => m[1]!)
    .join(" ");
  return { html, visible, text, h1, ldTypes };
}

test.describe("store pages are rendered on the server (what Google gets without JavaScript)", () => {
  test.skip(({ isMobile }) => isMobile, "server HTML — one project is enough");

  test("home, category and product: H1, products, prices, images and schema in the HTML", async ({
    request,
  }) => {
    const category = sql(
      `SELECT category FROM public.global_products WHERE id = '${PRODUCTS.a1.id}'`,
    );

    const home = await serverHtml(request, KOBI, "/");
    expect(home.h1).toHaveLength(1);
    expect(home.text).toContain(PRODUCTS.a1.name);
    expect(home.text).toMatch(/50\.00/);
    expect(home.ldTypes).toContain('"WebSite"');

    const cat = await serverHtml(request, KOBI, `/?category=${encodeURIComponent(category)}`);
    expect(cat.h1).toEqual([category]);
    expect(cat.text).toContain(PRODUCTS.a1.name);
    expect(cat.text).toContain(PRODUCTS.a2.name);
    expect(cat.visible).toMatch(new RegExp(`href="/product/${PRODUCTS.a1.id}"`));
    expect(cat.ldTypes).toContain('"BreadcrumbList"');

    const product = await serverHtml(request, KOBI, `/product/${PRODUCTS.a1.id}`);
    expect(product.h1).toEqual([PRODUCTS.a1.name]);
    expect(product.text).toMatch(/50\.00/);
    expect(product.text).toContain(PRODUCTS.a1.sku);
    expect(product.visible).toMatch(/<img[^>]+alt="[^"]+"/);
    expect(product.ldTypes).toContain('"Product"');
    expect(product.ldTypes).toContain('"Offer"');
    // הכתובת הקנונית לא השתנתה: לעמוד עצמו, באותו דומיין
    expect(product.html).toContain(
      `<link rel="canonical" href="http://${KOBI}:3100/product/${PRODUCTS.a1.id}"/>`,
    );
  });

  test("the other public pages: H1 and their text in the HTML", async ({ request }) => {
    for (const path of ["/about", "/terms", "/privacy", "/contact", "/cancellations", "/sitemap"]) {
      const page = await serverHtml(request, KOBI, path);
      expect(page.h1, path).toHaveLength(1);
      expect(page.text.length, path).toBeGreaterThan(150);
    }
  });

  test("tenant isolation: each store's HTML has only its own products", async ({ request }) => {
    for (const path of ["/", `/product/${PRODUCTS.a1.id}`, `/product/${PRODUCTS.b1.id}`]) {
      const { html } = await serverHtml(request, KOBI, path);
      expect(html, path).not.toContain(PRODUCTS.b1.name);
      expect(html, path).not.toContain(PRODUCTS.b1.sku);
    }
    for (const path of ["/", `/product/${PRODUCTS.b1.id}`, `/product/${PRODUCTS.a1.id}`]) {
      const { html } = await serverHtml(request, STOREB, path);
      expect(html, path).not.toContain(PRODUCTS.a1.name);
      expect(html, path).not.toContain(PRODUCTS.a2.name);
    }
    // מוצר של חנות אחרת — "לא נמצא" (noindex), בלי שום פרט שלו
    const cross = await serverHtml(request, KOBI, `/product/${PRODUCTS.b1.id}`);
    expect(cross.html).toContain('<meta name="robots" content="noindex"/>');
    expect(cross.h1).toHaveLength(0);
  });

  test("maintenance mode: only the maintenance screen — no products in the HTML", async ({
    request,
  }) => {
    sql(
      `UPDATE public.site_settings SET maintenance_mode = true WHERE tenant_id = '${STORE_A.id}'`,
    );
    try {
      const home = await serverHtml(request, KOBI, "/");
      expect(home.text).toContain("תחזוקה");
      expect(home.html).not.toContain(PRODUCTS.a1.name);
      expect(home.html).not.toContain(PRODUCTS.a2.name);
      const product = await serverHtml(request, KOBI, `/product/${PRODUCTS.a2.id}`);
      expect(product.text).toContain("תחזוקה");
      expect(product.visible).not.toContain(PRODUCTS.a2.name);
    } finally {
      sql(
        `UPDATE public.site_settings SET maintenance_mode = false WHERE tenant_id = '${STORE_A.id}'`,
      );
    }
  });
});

test.describe("store pages in the browser after server rendering", () => {
  test("no hydration errors, no layout jump, and add-to-cart works @mobile", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const w = window as unknown as { __cls: number };
      w.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[])
          if (!entry.hadRecentInput) w.__cls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    for (const path of ["/", `/product/${PRODUCTS.a1.id}`, "/about", "/terms"]) {
      await page.goto(A(path));
      await page.waitForLoadState("networkidle");
    }
    await page.goto(A(`/product/${PRODUCTS.a1.id}`));
    await page.waitForLoadState("networkidle");
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
    await page.getByRole("button", { name: "הוספה לסל" }).first().click();
    await expect(page.getByText(`"${PRODUCTS.a1.name}" נוסף לסל`)).toBeVisible();
    expect(errors.filter((e) => /hydrat|did not match|#418|#423|#425/i.test(e))).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("a customer with a price tier sees their own price, and the cart uses it", async ({
    browser,
  }) => {
    const tierBefore = sql(
      `SELECT price_tier FROM public.customer_profiles WHERE user_id = (SELECT id FROM auth.users WHERE email = 'customer.a@e2e.test') AND tenant_id = '${STORE_A.id}'`,
    );
    sql(
      `UPDATE public.customer_profiles SET price_tier = 2 WHERE user_id = (SELECT id FROM auth.users WHERE email = 'customer.a@e2e.test') AND tenant_id = '${STORE_A.id}'`,
    );
    const context = await browser.newContext({ storageState: AUTH.customerA });
    try {
      const page = await context.newPage();
      await page.goto(A(`/product/${PRODUCTS.a1.id}`));
      // מחירון 2 (48.00) — לא המחיר של אורח שבא מהשרת (50.00)
      await expect(page.getByText("48.00").first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "הוספה לסל" }).first().click();
      await page.goto(A("/checkout"));
      await expect(page.getByText(PRODUCTS.a1.name).first()).toBeVisible();
      await expect(page.getByText("48.00").first()).toBeVisible();
      await expect(page.getByText("50.00")).toHaveCount(0);
    } finally {
      await context.close();
      // הסל של הלקוח נשמר בשרת — מנקים כדי לא להשפיע על בדיקות אחרות
      sql(
        `DELETE FROM public.customer_carts WHERE user_id = (SELECT id FROM auth.users WHERE email = 'customer.a@e2e.test')`,
      );
      sql(
        `UPDATE public.customer_profiles SET price_tier = ${Number(tierBefore) || 1} WHERE user_id = (SELECT id FROM auth.users WHERE email = 'customer.a@e2e.test') AND tenant_id = '${STORE_A.id}'`,
      );
    }
  });
});
