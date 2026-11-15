import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { A, AUTH, B, hostGet, hostOf, PORT, PRODUCTS, STORE_A, STORE_B, USERS } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// Google Tag Manager (מיגרציה 192), על השרת הבנוי, בשני המנועים:
//   • חנות: בעל החנות שומר מזהה Container בלבד (קוד, HTML, GA4/UA/AW — נדחים במסך ובקריאה ישירה);
//     לקוח, אורח ובעל חנות אחרת — לא יכולים לשמור;
//   • לפני הסכמה — שום בקשה ל-Google; אחרי אישור — gtm.js אחד בדיוק, של החנות הזו, עם Consent Mode
//     (ברירת מחדל חסומה לפני העדכון); חנות B לא מקבלת לעולם את המזהה של A;
//   • SPA: אירוע nuriel_page_view אחד לכל עמוד (מעבר בתוך האתר, חזרה), בלי כפילויות;
//   • לא נטען באזורי הניהול והחשבון; כיבוי — לא נטען כלום;
//   • צימר: הבעלים שומר במסך ההגדרות; נטען רק כשהמדידה הופעלה לאתר בפלטפורמה, רק אחרי הסכמה,
//     ופרסום נשאר חסום.
// הבקשות ל-Google לא יוצאות לרשת — הבדיקה עונה עליהן וסופרת אותן.

test.describe.configure({ mode: "serial" });

const GTM_A = "GTM-E2EAAA1";
const GTM_H = "GTM-E2EHOSP1";
const SAVE_FN = { file: "src/platform/analytics/gtm.functions.ts", name: "saveMyTagManagerFn" };

const rowOf = (tenantId: string) =>
  sql(`SELECT coalesce(gtm_container_id, '') || ',' || gtm_enabled FROM public.site_tracking
        WHERE tenant_id = '${tenantId}'`);

/** כל בקשה ל-googletagmanager.com — נספרת, ולא יוצאת לרשת */
async function watchGoogle(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  await context.route(
    /^https:\/\/(www\.googletagmanager\.com|([a-z0-9-]+\.)*google-analytics\.com)\//,
    async (route) => {
      hits.push(route.request().url());
      if (route.request().url().includes("/gtm.js"))
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: "window.__gtmLoaded = (window.__gtmLoaded || 0) + 1;",
        });
      else await route.fulfill({ status: 204, body: "" });
    },
  );
  return hits;
}

const gtmLoads = (hits: string[], id: string) =>
  hits.filter((u) => u.includes(`/gtm.js?id=${id}`)).length;

/** ה-dataLayer: פקודות (arguments) כמערכים, אירועים כאובייקטים */
const dataLayer = (page: Page) =>
  page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: unknown[] }).dataLayer;
    if (!layer) return null;
    return layer.map((e) =>
      e && typeof e === "object" && "length" in (e as object)
        ? Array.from(e as ArrayLike<unknown>)
        : e,
    );
  });
const pageViews = async (page: Page) =>
  ((await dataLayer(page)) ?? [])
    .filter((e) => (e as { event?: string } | null)?.event === "nuriel_page_view")
    .map((e) => (e as { page_location: string }).page_location);
const gtmScriptsInPage = (page: Page) =>
  page.locator('script[src^="https://www.googletagmanager.com/gtm.js"]').count();

test.describe("store", () => {
  test.skip(({ isMobile }) => isMobile, "desktop flow");

  test.beforeAll(() => {
    sql(`DELETE FROM public.site_tracking WHERE tenant_id IN ('${STORE_A.id}', '${STORE_B.id}')`);
  });
  test.afterAll(() => {
    sql(`DELETE FROM public.site_tracking WHERE tenant_id IN ('${STORE_A.id}', '${STORE_B.id}')`);
    sql(`DELETE FROM public.platform_audit_log WHERE action = 'site_tag_manager_saved'
           AND tenant_id IN ('${STORE_A.id}', '${STORE_B.id}')`);
  });

  test("the owner saves a container ID only — code, HTML and other Google IDs are refused", async ({
    browser,
  }) => {
    const owner = await (await browser.newContext({ storageState: AUTH.ownerA })).newPage();
    await owner.goto(A("/admin?tab=marketing"));
    const card = owner.getByTestId("tag-manager-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    const input = card.getByTestId("gtm-container-id");
    await expect(input).toBeVisible();
    await expect(card.getByRole("textbox")).toHaveCount(1); // שדה אחד בלבד — בלי מקום לקוד
    await expect(card.locator("textarea")).toHaveCount(0);
    // the card itself (the rest of the marketing tab has two older findings — listed in the report)
    const axe = await new AxeBuilder({ page: owner })
      .include('[data-testid="tag-manager-card"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);

    for (const bad of ["<script>alert(1)</script>", "G-ABCDEF1234", "UA-12345-1", "GTM-AB"]) {
      await input.fill(bad);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(card).toContainText("מזהה Google Tag Manager לא תקין");
      await expect(card.getByTestId("gtm-save")).toBeDisabled();
    }
    expect(rowOf(STORE_A.id)).toBe("");

    await input.fill(` ${GTM_A.toLowerCase()} `);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await card.getByTestId("gtm-enabled").click();
    await card.getByTestId("gtm-save").click();
    await expect(card.getByRole("status")).toContainText("נשמר", { timeout: 15_000 });
    expect(rowOf(STORE_A.id)).toBe(`${GTM_A},true`);
    await expect(input).toHaveValue(GTM_A);
    expect(
      sql(`SELECT details ->> 'container_id' FROM public.platform_audit_log
            WHERE action = 'site_tag_manager_saved' AND tenant_id = '${STORE_A.id}'
            ORDER BY id DESC LIMIT 1`),
    ).toBe(GTM_A);
    await owner.context().close();
  });

  test("direct calls: an invalid ID, a customer, another store's owner and a guest are all refused", async ({
    request,
  }) => {
    const hostA = hostOf(STORE_A.slug);
    const ownerA = await accessToken(request, USERS.ownerA);
    const bad = await callServerFn(request, {
      host: hostA,
      ...SAVE_FN,
      data: { containerId: `GTM-X1234"><script>alert(1)</script>`, enabled: true },
      token: ownerA,
    });
    // server functions answer 200 with the error in the body (as everywhere in this app)
    const badText = await bad.text();
    expect(badText).toContain("מזהה Google Tag Manager לא תקין");
    expect(badText).not.toContain("loads_on_site");

    const customer = await accessToken(request, USERS.customerA);
    const byCustomer = await callServerFn(request, {
      host: hostA,
      ...SAVE_FN,
      data: { containerId: "GTM-CUST123", enabled: true },
      token: customer,
    });
    expect(await byCustomer.text()).toContain("רק בעל העסק");

    const ownerB = await accessToken(request, USERS.ownerB);
    const byOtherOwner = await callServerFn(request, {
      host: hostA,
      ...SAVE_FN,
      data: { containerId: "GTM-OTHER12", enabled: true },
      token: ownerB,
    });
    expect(await byOtherOwner.text()).toContain("רק בעל העסק");

    const byGuest = await callServerFn(request, {
      host: hostA,
      ...SAVE_FN,
      data: { containerId: "GTM-GUEST12", enabled: true },
    });
    expect(await byGuest.text()).toContain("נדרשת התחברות");

    // nothing changed: store A keeps its own ID, store B has nothing
    expect(rowOf(STORE_A.id)).toBe(`${GTM_A},true`);
    expect(rowOf(STORE_B.id)).toBe("");
  });

  test("a guest: nothing before consent; after 'אישור' exactly one gtm.js of this store, Consent Mode first", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const hits = await watchGoogle(context);
    const page = await context.newPage();
    await page.goto(A("/"));
    const banner = page.getByTestId("cookie-banner");
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner).toContainText("Google Tag Manager");
    await page.waitForLoadState("networkidle");
    expect(hits).toEqual([]);
    expect(await gtmScriptsInPage(page)).toBe(0);

    await banner.getByTestId("cookie-accept").click();
    await expect(banner).toHaveCount(0);
    await expect.poll(() => gtmLoads(hits, GTM_A)).toBe(1);
    expect(hits.filter((u) => u.includes("/gtm.js")).length).toBe(1);
    expect(await gtmScriptsInPage(page)).toBe(1);

    const layer = (await dataLayer(page)) ?? [];
    expect(layer[0]).toEqual([
      "consent",
      "default",
      {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        wait_for_update: 500,
      },
    ]);
    expect(layer[1]).toEqual([
      "consent",
      "update",
      {
        analytics_storage: "granted",
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
      },
    ]);
    expect((layer[2] as { event?: string }).event).toBe("gtm.js");
    await context.close();
  });

  test("SPA: one nuriel_page_view per page — inside-the-site navigation and Back, no duplicates", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const hits = await watchGoogle(context);
    const page = await context.newPage();
    // a product page first (with a private query and a #), then the header link back to the catalog
    // (an in-app navigation, no reload), then Back
    await page.goto(A(`/product/${PRODUCTS.a1.id}?ref=private#x`));
    await page.getByTestId("cookie-banner").getByTestId("cookie-accept").click();
    await expect.poll(() => gtmLoads(hits, GTM_A)).toBe(1);
    const product = A(`/product/${PRODUCTS.a1.id}`);
    const home = A("/");
    await expect.poll(() => pageViews(page)).toEqual([product]);

    await page.getByRole("banner").getByRole("link", { name: "קטלוג" }).click();
    await expect(page).toHaveURL(home);
    await expect.poll(() => pageViews(page)).toEqual([product, home]);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(await pageViews(page)).toEqual([product, home]); // re-renders don't send again

    await page.goBack();
    await expect(page).toHaveURL(/\/product\//);
    await expect.poll(() => pageViews(page)).toEqual([product, home, product]);
    // still one container in the page, loaded once
    expect(await gtmScriptsInPage(page)).toBe(1);
    expect(gtmLoads(hits, GTM_A)).toBe(1);
    await context.close();
  });

  test("tenant separation: store B never gets store A's container — not in the HTML, not in the browser", async ({
    browser,
    request,
  }) => {
    const htmlB = await (await hostGet(request, hostOf(STORE_B.slug), "/")).text();
    expect(htmlB).not.toContain(GTM_A);
    const htmlA = await (await hostGet(request, hostOf(STORE_A.slug), "/")).text();
    expect(htmlA).toContain(GTM_A); // the loader of A does carry it (a public ID) — proves the check above is real

    const context = await browser.newContext();
    const hits = await watchGoogle(context);
    const page = await context.newPage();
    await page.goto(B("/"));
    await page.waitForLoadState("networkidle");
    const accept = page.getByTestId("cookie-accept");
    if (await accept.count()) await accept.click();
    await page.waitForTimeout(500);
    expect(hits.filter((u) => u.includes("/gtm.js"))).toEqual([]);
    expect(JSON.stringify((await dataLayer(page)) ?? [])).not.toContain(GTM_A);
    await context.close();
  });

  test("not in the admin and account areas, even after consent", async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH.ownerA });
    const hits = await watchGoogle(context);
    const page = await context.newPage();
    await page.goto(A("/"));
    await page.getByTestId("cookie-banner").getByTestId("cookie-accept").click();
    await expect.poll(() => gtmLoads(hits, GTM_A)).toBe(1);

    for (const path of ["/admin", "/account"]) {
      await page.goto(A(path));
      await page.waitForLoadState("networkidle");
      expect(await gtmScriptsInPage(page), path).toBe(0);
      expect(await pageViews(page), path).toEqual([]);
    }
    expect(gtmLoads(hits, GTM_A)).toBe(1);
    await context.close();
  });

  test("switched off: nothing loads, and there is no banner for it", async ({ browser }) => {
    const owner = await (await browser.newContext({ storageState: AUTH.ownerA })).newPage();
    await owner.goto(A("/admin?tab=marketing"));
    const card = owner.getByTestId("tag-manager-card");
    await expect(card.getByTestId("gtm-container-id")).toHaveValue(GTM_A, { timeout: 20_000 });
    await card.getByTestId("gtm-enabled").click();
    await card.getByTestId("gtm-save").click();
    await expect(card.getByRole("status")).toContainText("כבוי", { timeout: 15_000 });
    expect(rowOf(STORE_A.id)).toBe(`${GTM_A},false`);
    await owner.context().close();

    const context = await browser.newContext();
    const hits = await watchGoogle(context);
    const page = await context.newPage();
    await page.goto(A("/"));
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("cookie-banner")).toHaveCount(0);
    expect(hits).toEqual([]);
    await context.close();
  });
});

test.describe("zimmer site", () => {
  test.skip(({ isMobile }) => isMobile, "desktop flow");

  const OWNER = { email: "gtm.owner@e2e.test", password: "Gtm-Owner-Pass-1!" };
  const slug = "gtm-site";
  const host = hostOf(slug);
  const url = (path = "/") => `http://${host}:${PORT}${path}`;
  const FLAGS = [
    "hospitality_backend_enabled",
    "hospitality_management_enabled",
    "hospitality_frontend_enabled",
  ] as const;
  let siteId = "";
  let owner: SavedSession | null = null;

  const cleanup = () => {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  };
  /** המתג של המדידה — לפלטפורמה ולאתר (כמו כל מתג של Hospitality: צריך את שניהם) */
  const setAnalytics = (on: boolean) => {
    sql(
      `UPDATE public.platform_feature_flags SET enabled = ${on} WHERE key = 'hospitality_analytics_enabled'`,
    );
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
         VALUES ('${siteId}', 'hospitality_analytics_enabled', ${on})
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = ${on}`);
  };

  test.beforeAll(async ({ request }) => {
    cleanup();
    const ownerId = await ensureUser(request, OWNER);
    asPlatform(`SELECT hospitality.admin_open_site('${slug}', 'נופי המדידה', '${OWNER.email}')`);
    siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
         VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'gtm_owner', 'admin', true)
         ON CONFLICT DO NOTHING`);
    sql(
      `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
    );
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
    const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
         VALUES ('${siteId}', 'נופי המדידה', 'gtm-p', 'active') RETURNING id`);
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
         VALUES ('${siteId}', '${propertyId}', 'unit', 'צימר האורן', 'gtm-u', 2, 2, 500)`);
    sql(`INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision)
         VALUES ('${siteId}', 'published', 1, 'luxury', '{"seo": {}}'::jsonb, 1)`);
    setAnalytics(false);
    await expect
      .poll(async () => (await hostGet(request, host, "/stay")).status(), { timeout: 20_000 })
      .toBe(200);
    owner = await passwordSession(request, url(""), OWNER);
  });

  test.afterAll(() => {
    cleanup();
    sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
  });

  test("the owner saves in the settings screen; while measurement is off for the site, nothing loads", async ({
    page,
    browser,
  }) => {
    await loadSession(page, owner!, "/manage/settings");
    const card = page.getByTestId("tag-manager-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("gtm-measurement-only")).toBeVisible();
    await card.getByTestId("gtm-container-id").fill(GTM_H);
    await card.getByTestId("gtm-enabled").click();
    await card.getByTestId("gtm-save").click();
    await expect(card.getByRole("status")).toContainText("נשמר", { timeout: 15_000 });
    expect(rowOf(siteId)).toBe(`${GTM_H},true`);
    await expect(card.getByTestId("gtm-not-loading")).toBeVisible();
    await expectAccessible(page, "tag manager card — zimmer");

    const context = await browser.newContext();
    const hits = await watchGoogle(context);
    const guest = await context.newPage();
    await guest.goto(url("/stay"));
    await expect(guest.getByRole("banner")).toBeVisible();
    await guest.waitForLoadState("networkidle");
    await expect(guest.getByTestId("consent-banner")).toHaveCount(0);
    expect(hits).toEqual([]);
    await context.close();
  });

  test("measurement on: Tag Manager named in the banner, nothing before a choice, then one container with ads denied", async ({
    browser,
    request,
  }) => {
    setAnalytics(true);
    const context = await browser.newContext();
    const hits = await watchGoogle(context);
    const page = await context.newPage();
    const banner = page.getByTestId("consent-banner");
    await expect
      .poll(
        async () => {
          await page.goto(url("/stay"));
          await expect(page.getByRole("banner")).toBeVisible();
          return banner.count();
        },
        { timeout: 20_000 },
      )
      .toBe(1);
    await expect(banner).toContainText("Google Tag Manager");
    await page.waitForLoadState("networkidle");
    expect(hits).toEqual([]);

    await banner.getByRole("button", { name: "אישור", exact: true }).click();
    await expect(banner).toHaveCount(0);
    await expect.poll(() => gtmLoads(hits, GTM_H)).toBe(1);
    const layer = (await dataLayer(page)) ?? [];
    const consent = layer.filter((e) => Array.isArray(e) && e[0] === "consent") as unknown[][];
    expect(consent[0]?.[1]).toBe("default");
    expect(consent.at(-1)).toEqual([
      "consent",
      "update",
      {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
    await expect.poll(() => pageViews(page)).toEqual([url("/stay")]);

    await page.locator('a[href$="/stay/units/gtm-u"]').first().click();
    await expect(page).toHaveURL(/\/stay\/units\/gtm-u$/);
    await expect.poll(() => pageViews(page)).toEqual([url("/stay"), url("/stay/units/gtm-u")]);
    expect(gtmLoads(hits, GTM_H)).toBe(1);
    expect(await gtmScriptsInPage(page)).toBe(1);
    await context.close();

    // the store never carries the zimmer's container
    expect(await (await hostGet(request, hostOf(STORE_A.slug), "/")).text()).not.toContain(GTM_H);
  });
});
