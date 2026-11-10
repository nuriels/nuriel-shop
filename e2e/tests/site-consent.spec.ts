import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT, STORE_A } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// Google SEO שלב 4 — הסכמה ל-Cookies באתר האירוח (מיגרציה 20261110210000), מקצה לקצה:
//   • היום (המתג כבוי — גם כשיש מזהה GA4 בגרסה המפורסמת): אין באנר, אין שום בקשה ל-Google, אין Cookie;
//     "הגדרות Cookies" בפוטר מסביר שיש רק שמירה הכרחית;
//   • המתג דולק + מזהה GA4: באנר; לפני בחירה — שום בקשה ל-Google; סירוב — נרשם ולא נטען כלום;
//     הגדרות → מדידה פעילה → GA4 נטען עם Consent Mode (פרסום חסום) ו-Cookies רק על הכתובת של האתר;
//     ביטול → נרשם, ה-Cookies של המדידה נמחקים ובטעינה הבאה לא נטען כלום; אישור מהבאנר — נטען;
//   • נגישות (axe) של הבאנר והחלון; בטלפון — הבאנר מעל שורת הפעולות, בלי גלילה לצדדים;
//   • עורך האתר: השדה של GA4 רק כשהמתג דולק; מזהה תקין נשמר בטיוטה;
//   • בלי שום שינוי בחנויות.
// הבקשות ל-Google לא יוצאות לרשת — הבדיקה עונה עליהן וסופרת אותן.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "consent.owner@e2e.test", password: "Consent-Owner-Pass-1!" };
const GA4 = "G-E2ETEST123";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
] as const;
let slug = "consent-site";
let host = hostOf(slug);
const url = (path = "/") => `http://${host}:${PORT}${path}`;
let siteId = "";
let owner: SavedSession | null = null;
let storeHash = "";

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);

function cleanup(s: string) {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${s}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${s}')`);
}

/** המתג של המדידה — לפלטפורמה ולאתר (כמו כל מתג של Hospitality: צריך את שניהם) */
function setAnalytics(on: boolean) {
  sql(
    `UPDATE public.platform_feature_flags SET enabled = ${on} WHERE key = 'hospitality_analytics_enabled'`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       VALUES ('${siteId}', 'hospitality_analytics_enabled', ${on})
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = ${on}`);
}

/** גרסה מפורסמת חדשה עם מזהה GA4 (כמו "פרסום" בעורך) */
function publishWithGa4(id: string) {
  sql(`INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision)
       VALUES ('${siteId}', 'published',
               COALESCE((SELECT max(version) FROM hospitality.site_versions
                          WHERE tenant_id = '${siteId}' AND kind = 'published'), 0) + 1,
               'luxury', '{"seo": {"ga4": "${id}"}}'::jsonb, 1)`);
}

/** הרשומות האנונימיות של האתר: "פעולה:מדידה", לפי הסדר */
const records = () =>
  sql(`SELECT coalesce(string_agg(action || ':' || analytics, ',' ORDER BY id), '')
         FROM hospitality.consent_records WHERE tenant_id = '${siteId}'`);

/** כל בקשה ל-Google (הקוד של GA4 / שליחת נתונים) — נספרת, ולא יוצאת לרשת */
async function watchGoogle(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  await context.route(
    /^https:\/\/(www\.googletagmanager\.com|([a-z0-9-]+\.)*google-analytics\.com)\//,
    async (route) => {
      hits.push(route.request().url());
      if (route.request().url().includes("/gtag/js"))
        await route.fulfill({
          status: 200,
          contentType: "application/javascript",
          body: "window.__gaLoaded = (window.__gaLoaded || 0) + 1;",
        });
      else await route.fulfill({ status: 204, body: "" });
    },
  );
  return hits;
}

const gtagLoads = (hits: string[]) => hits.filter((u) => u.includes(`/gtag/js?id=${GA4}`)).length;
const dataLayer = (page: Page) =>
  page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer;
    return layer ? JSON.stringify(layer.map((a) => Array.from(a))) : null;
  });

async function siteCookies(context: BrowserContext) {
  return (await context.cookies()).filter(
    (c) => c.name === "hosp_consent" || c.name.startsWith("_ga"),
  );
}

test.beforeAll(async ({ request }, testInfo) => {
  slug = testInfo.project.name === "mobile" ? "consent-site-m" : "consent-site";
  host = hostOf(slug);
  cleanup(slug);
  storeHash = storeDataHash();
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${slug}', 'נופי ההסכמה', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'consent_owner_${testInfo.project.name}', 'admin', true)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'נופי ההסכמה', 'consent-p', 'active') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'צימר האלה', 'consent-u', 2, 2, 600)`);
  // יש מזהה GA4 בגרסה המפורסמת כבר מההתחלה — המתג (כבוי) הוא מה שקובע
  publishWithGa4(GA4);
  setAnalytics(false);
  await expect
    .poll(async () => (await hostGet(request, host, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
  owner = await passwordSession(request, url(""), OWNER);
});

test.afterAll(() => {
  cleanup(slug);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("today (switch off, even with a GA4 id): no banner, nothing from Google, no cookie — the footer link explains", async ({
  page,
  context,
}) => {
  const hits = await watchGoogle(context);
  await page.goto(url("/stay"));
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  await page.getByTestId("footer-cookies").click();
  const panel = page.getByTestId("consent-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("האתר משתמש רק בשמירה הכרחית");
  await expect(panel.getByRole("switch")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "שמירת הבחירה" })).toHaveCount(0);
  await expectAccessible(page, "cookie settings — necessary only");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.goto(url("/stay/units/consent-u"));
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(hits).toEqual([]);
  expect(await dataLayer(page)).toBeNull();
  expect(await siteCookies(context)).toEqual([]);
  expect(records()).toBe("");
});

test("switch on: the banner; nothing from Google before a choice; reject — recorded, nothing loads", async ({
  page,
  context,
}) => {
  setAnalytics(true);
  const hits = await watchGoogle(context);
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
  await expect(banner).toContainText("Google Analytics");
  // אישור וסירוב — שני כפתורים באותו גודל
  const accept = banner.getByRole("button", { name: "אישור", exact: true });
  const reject = banner.getByRole("button", { name: "סירוב", exact: true });
  const [a, r] = [await accept.boundingBox(), await reject.boundingBox()];
  expect(Math.abs((a?.height ?? 0) - (r?.height ?? 1))).toBeLessThan(2);
  await page.waitForLoadState("networkidle");
  expect(hits).toEqual([]);
  expect(await dataLayer(page)).toBeNull();
  await expectAccessible(page, "consent banner");

  await reject.click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId("consent-status")).toHaveText("הבחירה נשמרה");
  await expect.poll(records).toBe("reject:false");
  const [consent] = await siteCookies(context);
  expect(consent?.name).toBe("hosp_consent");
  expect(consent?.domain.startsWith(".")).toBe(false); // רק הכתובת של האתר
  expect(decodeURIComponent(consent?.value ?? "")).toMatch(/:0:\d+$/);
  await page.reload();
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(banner).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(hits).toEqual([]);
});

test("settings: measurement on — GA4 loads with Consent Mode (ads denied) on this address only; off — withdrawn, its cookies removed", async ({
  page,
  context,
}) => {
  const hits = await watchGoogle(context);
  await page.goto(url("/stay"));
  await page
    .getByTestId("consent-banner")
    .getByRole("button", { name: "הגדרות", exact: true })
    .click();
  const panel = page.getByTestId("consent-panel");
  const toggle = panel.getByRole("switch", { name: "מדידה (Google Analytics)" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expectAccessible(page, "cookie settings — with measurement");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await panel.getByRole("button", { name: "שמירת הבחירה" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  await expect.poll(() => gtagLoads(hits)).toBe(1);
  const layer = (await dataLayer(page)) ?? "";
  expect(layer).toContain(
    '["consent","default",{"ad_storage":"denied","ad_user_data":"denied","ad_personalization":"denied","analytics_storage":"denied"}]',
  );
  expect(layer).toContain('["consent","update",{"analytics_storage":"granted"}]');
  expect(layer).toContain(`["config","${GA4}",{"cookie_domain":"${host}"`);
  expect(layer).not.toMatch(/"ad_storage":"granted"/);
  await expect.poll(records).toBe("reject:false,save:true");

  // ה-Cookies של המדידה (כמו שהקוד האמיתי של Google היה כותב) — ואז ביטול
  await context.addCookies([
    { name: "_ga", value: "GA1.1.123.456", domain: host, path: "/" },
    { name: "_ga_E2ETEST123", value: "GS1.1.1", domain: host, path: "/" },
  ]);
  await page.getByTestId("footer-cookies").click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await panel.getByRole("button", { name: "שמירת הבחירה" }).click();
  await expect.poll(records).toBe("reject:false,save:true,withdraw:false");
  await expect
    .poll(async () => (await siteCookies(context)).map((c) => c.name))
    .toEqual(["hosp_consent"]);
  expect((await dataLayer(page)) ?? "").toContain(
    '["consent","update",{"analytics_storage":"denied"}]',
  );
  await page.reload();
  await expect(page.getByRole("banner")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(gtagLoads(hits)).toBe(1);
  expect(await dataLayer(page)).toBeNull();
});

test("accept from the banner loads GA4; the choice is remembered on the next page", async ({
  page,
  context,
}) => {
  const hits = await watchGoogle(context);
  await page.goto(url("/stay"));
  await page
    .getByTestId("consent-banner")
    .getByRole("button", { name: "אישור", exact: true })
    .click();
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  await expect.poll(() => gtagLoads(hits)).toBe(1);
  await expect.poll(records).toMatch(/,accept:true$/);
  await page.goto(url("/stay/units/consent-u"));
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  await expect.poll(() => gtagLoads(hits)).toBe(2);
});

test("measurement events: nothing before the choice, then only this page's events — clean address, no personal data", async ({
  page,
  context,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const hits = await watchGoogle(context);
  const banner = page.getByTestId("consent-banner");
  // עמוד ראשון (עם # "אישי" ושאילתה פרטית), ואז מעבר בתוך האתר לעמוד היחידה — לפני החלטה
  await page.goto(url("/stay?ref=private#t=secret-token"));
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await page.locator('a[href$="/stay/units/consent-u"]').first().click();
  await expect(page).toHaveURL(/\/stay\/units\/consent-u$/);
  await page.waitForLoadState("networkidle");
  expect(hits).toEqual([]);
  expect(await dataLayer(page)).toBeNull();

  await banner.getByRole("button", { name: "אישור", exact: true }).click();
  await expect.poll(() => gtagLoads(hits)).toBe(1);
  const unitUrl = `http://${host}:${PORT}/stay/units/consent-u`;
  const sent = async () =>
    (JSON.parse((await dataLayer(page)) ?? "[]") as unknown[][]).filter((a) => a[0] === "event");
  // רק של העמוד הנוכחי: הצפייה, ואחריה הצפייה ביחידה (שום דבר מהעמוד הראשון)
  await expect
    .poll(async () => (await sent()).map((e) => e[1]))
    .toEqual(["page_view", "view_item"]);
  const [view, item] = await sent();
  expect(view![2]).toMatchObject({ page_location: unitUrl });
  expect(item![2]).toMatchObject({
    page_location: unitUrl,
    currency: "ILS",
    value: 600,
    items: [{ item_id: "consent-u", item_name: "צימר האלה", item_category: "unit", price: 600 }],
  });

  // קישור קשר (כאן — נוסף לעמוד): רק סוג הקישור ומיקומו, בלי המספר
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.href = "https://wa.me/972500000000?text=secret-token";
    a.textContent = "WhatsApp";
    a.id = "e2e-wa";
    a.addEventListener("click", (e) => e.preventDefault());
    document.querySelector("main")?.appendChild(a);
  });
  await page.locator("#e2e-wa").click();
  await expect.poll(async () => (await sent()).map((e) => e[1])).toContain("click_whatsapp");
  const click = (await sent()).find((e) => e[1] === "click_whatsapp");
  expect(click![2]).toEqual({ page_location: unitUrl, link_location: "page" });
  expect((await dataLayer(page)) ?? "").not.toMatch(/secret-token|ref=private|972500000000/);
});

test("@mobile phone: the banner sits above the action bar, nothing sideways, accessible", async ({
  page,
}) => {
  setAnalytics(true);
  await page.goto(url("/stay/units/consent-u"));
  const banner = page.getByTestId("consent-banner");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  const bar = page.locator("[data-action-bar]");
  if (await bar.isVisible().catch(() => false)) {
    const [b, a] = [await banner.boundingBox(), await bar.boundingBox()];
    expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual((a?.y ?? 0) + 1);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  await expectAccessible(page, "consent banner on the phone");
});

test("the website editor shows the GA4 field only while the switch is on; a valid id goes into the draft", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  setAnalytics(false);
  await loadSession(page, owner!, "/manage/website?tab=seo");
  const pick = page.getByRole("button", { name: /יוקרה/ });
  if (await pick.isVisible().catch(() => false)) await pick.click();
  await page.getByRole("tab", { name: "גוגל ושיתוף" }).click();
  await expect(page.getByText("Google Search Console", { exact: true })).toBeVisible();
  await expect(page.getByTestId("seo-ga4")).toHaveCount(0);

  setAnalytics(true);
  await page.reload();
  await page.getByRole("tab", { name: "גוגל ושיתוף" }).click();
  const field = page.getByTestId("seo-ga4");
  await expect(field).toBeVisible();
  await field.fill("UA-12345-1");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("המזהה לא תקין")).toBeVisible();
  await field.fill("g-e2eui1234");
  await expect(page.getByText("נשמר; ייכנס לאתר בפרסום")).toBeVisible();
  await expect
    .poll(
      () =>
        sql(`SELECT document -> 'seo' ->> 'ga4' FROM hospitality.site_versions
              WHERE tenant_id = '${siteId}' AND kind = 'draft'`),
      { timeout: 15_000 },
    )
    .toBe("G-E2EUI1234");
});

test("the stores are not touched: no consent banner or cookie there, store data unchanged", async ({
  page,
  context,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await page.goto(`http://${hostOf(STORE_A.slug)}:${PORT}/`);
  await expect(page.getByTestId("consent-banner")).toHaveCount(0);
  expect((await context.cookies()).some((c) => c.name === "hosp_consent")).toBe(false);
  expect(storeDataHash()).toBe(storeHash);
});
