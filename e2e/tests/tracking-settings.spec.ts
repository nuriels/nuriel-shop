import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// "קידום, Analytics ומעקב" בהגדרות העסק של צימר (מיגרציה 199), מקצה לקצה:
//   • המקום: ניהול → הגדרות העסק → "קידום, Analytics ומעקב" — שדה GA4 (G-…) ושדה Tag Manager (GTM-…),
//     עם הסבר לכל אחד; נגישות (axe);
//   • בדיקת תקינות: מזהה לא תקין — הודעה ברורה, אין שמירה; תקין — "נשמר" עם המזהה; ריק — הוסר;
//   • נשמר לעסק הזה בלבד (המסד); נשאר אחרי יציאה וכניסה מחדש; צימר אחר לא רואה אותו;
//   • רק בעל העסק: מנהל/ת עסק רואה הסבר בלבד;
//   • המדידה דולקת: לפני הסכמה — כלום מ-Google; אחרי "אישור" — gtag.js אחד של המזהה הזה, עם Consent Mode
//     ופרסום חסום, והאירועים נשלחים; גם GA4 וגם GTM — עדיין gtag.js אחד ו-gtm.js אחד; הצימר האחר — כלום.
// הבקשות ל-Google לא יוצאות לרשת — הבדיקה עונה עליהן וסופרת אותן.

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "desktop flow");

const OWNER = { email: "track.owner@e2e.test", password: "Track-Owner-Pass-1!" };
const BA = { email: "track.ba@e2e.test", password: "Track-Ba-Pass-1!" };
const OTHER = { email: "track.other@e2e.test", password: "Track-Other-Pass-1!" };
const GA4 = "G-NOFI12345";
const GTM = "GTM-NOFI123";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
] as const;
const SITE = { slug: "track-nofi", name: "נופי דורית" };
const OTHER_SITE = { slug: "track-other", name: "צימר אחר" };
const url = (slug: string, path = "/") => `http://${hostOf(slug)}:${PORT}${path}`;
const ids: Record<string, string> = {};
let owner: SavedSession | null = null;

const trackingOf = (tenantId: string) =>
  sql(`SELECT coalesce(ga4_measurement_id, '') || ',' || coalesce(gtm_container_id, '') || ',' || gtm_enabled
         FROM public.site_tracking WHERE tenant_id = '${tenantId}'`);

function cleanup(slug: string) {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
}

function setAnalytics(on: boolean) {
  sql(
    `UPDATE public.platform_feature_flags SET enabled = ${on} WHERE key = 'hospitality_analytics_enabled'`,
  );
  for (const id of [ids["site"], ids["other"]])
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
         VALUES ('${id}', 'hospitality_analytics_enabled', ${on})
         ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = ${on}`);
}

async function openSite(
  slug: string,
  name: string,
  owner: { id: string; email: string },
  username: string,
) {
  asPlatform(`SELECT hospitality.admin_open_site('${slug}', '${name}', '${owner.email}')`);
  const ownerId = owner.id;
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${id}', '${ownerId}', email, '${username}', 'admin', true, true FROM auth.users WHERE id = '${ownerId}'
       ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${id}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${id}', '${name}', '${slug}-p', 'active') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${id}', '${propertyId}', 'unit', 'צימר האלון', '${slug}-u', 2, 2, 700)`);
  sql(`INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision)
       VALUES ('${id}', 'published', 1, 'luxury', '{"seo": {}}'::jsonb, 1)`);
  return id;
}

/** כל בקשה ל-Google — נספרת, ולא יוצאת לרשת */
async function watchGoogle(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  await context.route(
    /^https:\/\/(www\.googletagmanager\.com|([a-z0-9-]+\.)*google-analytics\.com)\//,
    async (route) => {
      hits.push(route.request().url());
      if (/\/(gtag\/js|gtm\.js)/.test(route.request().url()))
        await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
      else await route.fulfill({ status: 204, body: "" });
    },
  );
  return hits;
}
const loads = (hits: string[], path: string) => hits.filter((u) => u.includes(path)).length;
const commands = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: unknown[] }).dataLayer ?? [])
      .filter((e) => e && typeof e === "object" && "length" in (e as object))
      .map((e) => Array.from(e as ArrayLike<unknown>)),
  );

test.beforeAll(async ({ request }) => {
  cleanup(SITE.slug);
  cleanup(OTHER_SITE.slug);
  const ownerId = await ensureUser(request, OWNER);
  const baId = await ensureUser(request, BA);
  const otherId = await ensureUser(request, OTHER);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  ids["site"] = await openSite(
    SITE.slug,
    SITE.name,
    { id: ownerId, email: OWNER.email },
    "track_owner",
  );
  ids["other"] = await openSite(
    OTHER_SITE.slug,
    OTHER_SITE.name,
    { id: otherId, email: OTHER.email },
    "track_other",
  );
  // מנהל/ת עסק שהבעלים מינה (staff_grants business.admin)
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       VALUES ('${ids["site"]}', '${baId}', '${BA.email}', 'track_ba', 'admin', true, false) ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO hospitality.staff_grants (tenant_id, user_id, permission)
       VALUES ('${ids["site"]}', '${baId}', 'business.admin') ON CONFLICT DO NOTHING`);
  setAnalytics(false);
  await expect
    .poll(async () => (await hostGet(request, hostOf(SITE.slug), "/stay")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  owner = await passwordSession(request, url(SITE.slug, ""), OWNER);
});

test.afterAll(() => {
  cleanup(SITE.slug);
  cleanup(OTHER_SITE.slug);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("business settings → 'קידום, Analytics ומעקב': a GA4 field and a Tag Manager field, each explained", async ({
  page,
}) => {
  await loadSession(page, owner!, "/manage/settings#tracking");
  const section = page.getByTestId("tracking-section");
  await expect(section).toBeVisible({ timeout: 20_000 });
  await expect(section.getByRole("heading", { name: "קידום, Analytics ומעקב" })).toBeVisible();
  const ga4 = section.getByTestId("ga4-card");
  const gtm = section.getByTestId("tag-manager-card");
  await expect(ga4.getByText("Google Analytics 4", { exact: true })).toBeVisible();
  await expect(ga4.getByLabel("מזהה המדידה (Measurement ID)")).toHaveAttribute(
    "placeholder",
    "G-XXXXXXXXXX",
  );
  await expect(ga4).toContainText("רק אחרי שהגולש אישר עוגיות מדידה");
  await expect(gtm.getByTestId("gtm-container-id")).toHaveAttribute("placeholder", "GTM-XXXXXXX");
  await expect(gtm).toContainText("אין כאן מקום לקוד או ל-HTML");
  // המדידה עדיין כבויה לאתר — נאמר במפורש, ואפשר לשמור
  await expect(ga4.getByTestId("ga4-not-loading")).toBeVisible();
  await expectAccessible(page, "tracking section — zimmer settings");
});

test("validation: a wrong ID is refused with a clear message; a valid one is saved for this business only", async ({
  page,
}) => {
  await loadSession(page, owner!, "/manage/settings#tracking");
  const ga4 = page.getByTestId("ga4-card");
  const field = ga4.getByTestId("ga4-measurement-id");
  await expect(field).toBeVisible({ timeout: 20_000 });
  for (const wrong of ["UA-12345-1", "GTM-NOFI123", "G-AB", "<script>"]) {
    await field.fill(wrong);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(ga4).toContainText("מזהה Google Analytics 4 לא תקין");
    await expect(ga4.getByTestId("ga4-save")).toBeDisabled();
  }
  expect(trackingOf(ids["site"]!)).toBe("");

  await field.fill(" g-nofi12345 ");
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await ga4.getByTestId("ga4-save").click();
  await expect(ga4.getByTestId("ga4-notice")).toContainText(`נשמר: ${GA4}`, { timeout: 15_000 });
  await expect(field).toHaveValue(GA4);
  expect(trackingOf(ids["site"]!)).toBe(`${GA4},,false`);
  if (process.env["TRACKING_SHOTS"]) {
    await page.setViewportSize({ width: 1280, height: 1400 });
    await page
      .getByTestId("tracking-section")
      .screenshot({ path: `${process.env["TRACKING_SHOTS"]}/tracking-section.png` });
  }
  // the other zimmer — nothing
  expect(trackingOf(ids["other"]!)).toBe("");
  expect(
    sql(`SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = '${ids["site"]}'
          AND action = 'site_ga4_saved' AND details ->> 'ga4_id' = '${GA4}'`),
  ).toBe("1");

  // Tag Manager next to it — saving one keeps the other
  const gtm = page.getByTestId("tag-manager-card");
  await gtm.getByTestId("gtm-container-id").fill(GTM);
  await gtm.getByTestId("gtm-enabled").click();
  await gtm.getByTestId("gtm-save").click();
  await expect(gtm.getByRole("status")).toContainText("נשמר", { timeout: 15_000 });
  await expect(gtm.getByTestId("gtm-duplicate-warning")).toBeVisible();
  expect(trackingOf(ids["site"]!)).toBe(`${GA4},${GTM},true`);
});

test("saved after signing out and in again; the other business and the business admin never see it", async ({
  browser,
  request,
}) => {
  // a brand-new sign-in (new password login, new browser)
  const fresh = await passwordSession(request, url(SITE.slug, ""), OWNER);
  const context = await browser.newContext();
  const page = await context.newPage();
  await loadSession(page, fresh, "/manage/settings#tracking");
  await expect(page.getByTestId("ga4-measurement-id")).toHaveValue(GA4, { timeout: 20_000 });
  await expect(page.getByTestId("gtm-container-id")).toHaveValue(GTM);
  await context.close();

  // the owner of the other zimmer: an empty field (its own settings)
  const other = await passwordSession(request, url(OTHER_SITE.slug, ""), OTHER);
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await loadSession(p2, other, "/manage/settings#tracking");
  await expect(p2.getByTestId("ga4-measurement-id")).toHaveValue("", { timeout: 20_000 });
  await c2.close();

  // the business admin of this zimmer: an explanation only, no field
  const ba = await passwordSession(request, url(SITE.slug, ""), BA);
  const c3 = await browser.newContext();
  const p3 = await c3.newPage();
  await loadSession(p3, ba, "/manage/settings#tracking");
  const card = p3.getByTestId("ga4-card");
  await expect(card).toContainText("רק בעל העסק יכול לחבר את האתר ל-Google Analytics", {
    timeout: 20_000,
  });
  await expect(card.getByTestId("ga4-measurement-id")).toHaveCount(0);
  await expect(p3.getByTestId("gtm-container-id")).toHaveCount(0);
  await c3.close();
});

test("measurement on: nothing before consent; after 'אישור' one gtag.js of this ID (+ one gtm.js), ads denied, events sent; the other zimmer gets nothing", async ({
  browser,
}) => {
  setAnalytics(true);
  const context = await browser.newContext();
  const hits = await watchGoogle(context);
  const page = await context.newPage();
  const banner = page.getByTestId("consent-banner");
  await expect
    .poll(
      async () => {
        await page.goto(url(SITE.slug, "/stay"));
        await expect(page.getByRole("banner")).toBeVisible();
        return banner.count();
      },
      { timeout: 20_000 },
    )
    .toBe(1);
  await page.waitForLoadState("networkidle");
  expect(hits).toEqual([]);

  await banner.getByRole("button", { name: "אישור", exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect.poll(() => loads(hits, `/gtag/js?id=${GA4}`)).toBe(1);
  await expect.poll(() => loads(hits, `/gtm.js?id=${GTM}`)).toBe(1);
  const layer = await commands(page);
  const consent = layer.filter((e) => e[0] === "consent");
  expect(consent[0]?.[1]).toBe("default");
  expect(JSON.stringify(consent)).not.toContain('"ad_storage":"granted"');
  expect(layer.some((e) => e[0] === "config" && e[1] === GA4)).toBe(true);
  await expect
    .poll(async () => (await commands(page)).some((e) => e[0] === "event" && e[1] === "page_view"))
    .toBe(true);

  // moving inside the site: an item view event, and still one gtag.js / one gtm.js
  await page.locator(`a[href$="/stay/units/${SITE.slug}-u"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/stay/units/${SITE.slug}-u$`));
  await expect
    .poll(async () => (await commands(page)).some((e) => e[0] === "event" && e[1] === "view_item"))
    .toBe(true);
  expect(
    await page.locator('script[src^="https://www.googletagmanager.com/gtag/js"]').count(),
  ).toBe(1);
  expect(loads(hits, "/gtag/js")).toBe(1);
  expect(loads(hits, "/gtm.js")).toBe(1);
  await context.close();

  // the other zimmer (measurement on, nothing saved): no banner, nothing from Google, not our ID
  const c2 = await browser.newContext();
  const otherHits = await watchGoogle(c2);
  const p2 = await c2.newPage();
  await p2.goto(url(OTHER_SITE.slug, "/stay"));
  await expect(p2.getByRole("banner")).toBeVisible();
  await p2.waitForLoadState("networkidle");
  await expect(p2.getByTestId("consent-banner")).toHaveCount(0);
  expect(otherHits).toEqual([]);
  expect(await p2.content()).not.toContain(GA4);
  await c2.close();
  setAnalytics(false);
});

test("an empty GA4 field removes it — the site stops loading GA4", async ({ page, browser }) => {
  await loadSession(page, owner!, "/manage/settings#tracking");
  const ga4 = page.getByTestId("ga4-card");
  await ga4.getByTestId("ga4-measurement-id").fill("");
  await ga4.getByTestId("ga4-save").click();
  await expect(ga4.getByTestId("ga4-notice")).toContainText("המזהה הוסר", { timeout: 15_000 });
  expect(trackingOf(ids["site"]!)).toBe(`,${GTM},true`);

  setAnalytics(true);
  const context = await browser.newContext();
  const hits = await watchGoogle(context);
  const guest = await context.newPage();
  await guest.goto(url(SITE.slug, "/stay"));
  await guest
    .getByTestId("consent-banner")
    .getByRole("button", { name: "אישור", exact: true })
    .click();
  await expect.poll(() => loads(hits, "/gtm.js")).toBe(1);
  expect(loads(hits, "/gtag/js")).toBe(0);
  await context.close();
  setAnalytics(false);
});
