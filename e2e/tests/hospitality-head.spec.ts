import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, hostOf, PORT, STORE_A } from "./helpers";
import { asPlatform, sql } from "./hospitality-helpers";

// R-1 (לפני Stage 2c): ה-head וה-state של העמוד באתר אירוח — בלי נתוני Ecommerce.
// הבדיקות קוראות את ה-HTML שהשרת מחזיר (SSR) כמו שתצוגה מקדימה של WhatsApp קוראת אותו:
//   • meta description / og:title / og:site_name = שם העסק; noindex; בלי תגיות SEO של חנות;
//   • מצב העמוד (state) בלי מנוי, SEO, שבת, מבצעים, מעקב — רק engineSite עם השם;
//   • שינוי שם העסק → מופיע בבקשה הבאה;
//   • החנות: אותן תגיות ואותו state כמו קודם, ובלי שום דבר מאתר האירוח (בשני הכיוונים).

test.describe.configure({ mode: "serial" });

// a separate site per project: the server caches the site of an address for a few seconds
let SLUG = "r1-head";
let HOST = hostOf(SLUG);
const NAME = "בקתות הים";
const STORE = hostOf(STORE_A.slug);
let siteId = "";

/** מה שאסור שיופיע במצב העמוד של אתר אירוח — שדות של נתוני החנות ב-root */
const STORE_STATE_KEYS = [
  "subscription",
  "googleLogin",
  "maxProducts",
  "zapFeed",
  "seoTitle",
  "seoDescription",
  "seoKeywords",
  "googleVerification",
  "sabbath",
  "promo",
  "tracking",
  "shareImage",
  "appleIcon",
  "isPortal",
  "isDefaultStore",
  "brandColor",
];

function meta(html: string, attr: "name" | "property", key: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<meta[^>]*${attr}="${key}"[^>]*>`, "g");
  for (const tag of html.match(re) ?? []) out.push(/content="([^"]*)"/.exec(tag)?.[1] ?? "");
  return out;
}
/** ה-state שהשרת מטמיע בעמוד (ה-script של ה-router) */
function pageState(html: string): string {
  return [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1] ?? "")
    .filter((s) => s.includes("$R"))
    .join("\n");
}
async function ssr(request: APIRequestContext, host: string, path: string) {
  const res = await hostGet(request, host, path);
  expect(res.status(), `${host}${path}`).toBe(200);
  return res.text();
}

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

test.beforeAll(async ({ request }, testInfo) => {
  SLUG = testInfo.project.name === "mobile" ? "r1-head-m" : "r1-head";
  HOST = hostOf(SLUG);
  cleanup();
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'שם האתר בפלטפורמה')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`UPDATE hospitality.settings SET business_name = '${NAME}' WHERE tenant_id = '${siteId}'`);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteId}', 'hospitality_backend_enabled', true), ('${siteId}', 'hospitality_management_enabled', true)`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/login")).status(), { timeout: 20_000 })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("Hospitality SSR: meta tags carry the business name, never the store defaults", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "HTTP checks once");
  for (const path of [
    "/manage/login",
    "/manage",
    "/manage/settings",
    "/manage/team",
    "/manage/units",
  ]) {
    const html = await ssr(request, HOST, path);
    expect(meta(html, "name", "description"), path).toEqual([NAME]);
    expect(meta(html, "property", "og:title"), path).toEqual([NAME]);
    expect(meta(html, "property", "og:site_name"), path).toEqual([NAME]);
    expect(meta(html, "property", "og:description"), path).toEqual([NAME]);
    expect(meta(html, "name", "robots"), path).toEqual(["noindex, nofollow"]);
    expect(html, path).not.toContain("החנות שלי");
    // no store SEO / branding tags at all
    for (const [attr, key] of [
      ["name", "keywords"],
      ["name", "google-site-verification"],
      ["name", "theme-color"],
      ["property", "og:image"],
      ["property", "og:url"],
      ["name", "twitter:card"],
    ] as const) {
      expect(meta(html, attr, key), `${path} ${key}`).toEqual([]);
    }
    expect(html, path).not.toMatch(/rel="canonical"|apple-touch-icon/);
  }
  // the page title of each screen stays the screen's own
  expect(await ssr(request, HOST, "/manage/login")).toContain("<title>כניסה לניהול העסק</title>");
});

test("Hospitality SSR: the page state has only the engine's site data — no store subscription or settings", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "HTTP checks once");
  const state = pageState(await ssr(request, HOST, "/manage/login"));
  expect(state).toContain("engineSite");
  expect(state).toContain(NAME);
  for (const key of STORE_STATE_KEYS) expect(state, key).not.toContain(key);
  // host mode: the lock comes from the site itself, not from an Ecommerce subscription
  expect(state).toMatch(/siteType:"hospitality",suspended:!1,lock:null/);
});

test("renaming the business shows the new name on the next request", async ({ request }) => {
  test.skip(test.info().project.name === "mobile", "HTTP checks once");
  sql(
    `UPDATE hospitality.settings SET business_name = 'בקתות הים החדשות' WHERE tenant_id = '${siteId}'`,
  );
  const html = await ssr(request, HOST, "/manage/login");
  expect(meta(html, "property", "og:site_name")).toEqual(["בקתות הים החדשות"]);
  // empty name → the site name (never a store default)
  sql(`UPDATE hospitality.settings SET business_name = '' WHERE tenant_id = '${siteId}'`);
  const fallback = await ssr(request, HOST, "/manage/login");
  expect(meta(fallback, "property", "og:site_name")).toEqual(["שם האתר בפלטפורמה"]);
  sql(`UPDATE hospitality.settings SET business_name = '${NAME}' WHERE tenant_id = '${siteId}'`);
});

test("Ecommerce SSR unchanged: the store's own tags and state, nothing from Hospitality", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "HTTP checks once");
  const store = sql(`SELECT coalesce(nullif(trim(business_name), ''), 'החנות שלי') || '|' ||
                            coalesce(nullif(trim(seo_title), ''), '') || '|' || coalesce(nullif(trim(seo_description), ''), '')
                       FROM public.site_settings WHERE tenant_id = '${STORE_A.id}'`).split("|");
  const [storeName = "", seoTitle = "", seoDescription = ""] = store;
  const html = await ssr(request, STORE, "/");
  expect(meta(html, "property", "og:site_name")).toEqual([storeName]);
  expect(meta(html, "name", "description")).toEqual([seoDescription || storeName]);
  expect(meta(html, "property", "og:title")).toEqual([seoTitle || storeName]);
  expect(meta(html, "name", "twitter:card")).toEqual(["summary_large_image"]);
  expect(meta(html, "name", "robots")).toEqual([]);
  const state = pageState(html);
  // the store keeps its root data (subscription, settings) as before …
  for (const key of ["subscription", "seoTitle", "sabbath", "siteName"])
    expect(state, key).toContain(key);
  // … and nothing of the Hospitality engine or site
  expect(state).not.toContain("engineSite");
  expect(html).not.toContain(NAME);
  expect(html).not.toContain("שם האתר בפלטפורמה");
});

test("no leak the other way: the Hospitality page carries nothing of a store", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "HTTP checks once");
  const storeName = sql(
    `SELECT nullif(trim(business_name), '') FROM public.site_settings WHERE tenant_id = '${STORE_A.id}'`,
  );
  const html = await ssr(request, HOST, "/manage/login");
  if (storeName) expect(html).not.toContain(storeName);
  // the Hospitality site's own (seeded, unused) store settings row is not read either
  const seeded = sql(
    `SELECT coalesce(nullif(trim(business_name), ''), '') FROM public.site_settings WHERE tenant_id = '${siteId}'`,
  );
  if (seeded) expect(html).not.toContain(seeded);
});

test("@mobile in the browser: the tags stay right after hydration", async ({ page }) => {
  await page.goto(`http://${HOST}:${PORT}/manage/login`);
  await expect(page.getByRole("heading", { level: 1, name: "כניסה לניהול העסק" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const tags = await page.evaluate(() => ({
    site: document.querySelector('meta[property="og:site_name"]')?.getAttribute("content"),
    description: document.querySelector('meta[name="description"]')?.getAttribute("content"),
    title: document.title,
  }));
  expect(tags).toEqual({ site: NAME, description: NAME, title: "כניסה לניהול העסק" });
});
