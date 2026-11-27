import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { A, AUTH, hostGet, hostOf, platformUrl, PORT } from "./helpers";
import { asPlatform, enterViaHandoffTo, ensureUser, sql } from "./hospitality-helpers";

// Nuriel Websites (business_profile) — Stage 1, end to end on the real app and the local database:
//   • the platform admin opens a business site in the panel (a draft, nothing public);
//   • the owner enters the studio through the central login handoff and sends the first publish;
//   • the platform admin reviews exactly the snapshot and approves → the site is public at "/";
//   • after the approval the owner publishes alone (version 2);
//   • the root rewrite exists only on business sites: stores and zimmer sites are unchanged.

test.describe.configure({ mode: "serial" });

// לכל פרויקט כתובת משלו (הטלפון רץ בפרויקט נפרד, והניקוי של אחד לא נוגע באתר של השני)
let SLUG = "web-e2e";
const NAME = "עסק לבדיקה";
const OWNER = { email: "web.owner@e2e.test", password: "Web-Owner-e2e-2026!" };
const site = (path = "/") => `http://${hostOf(SLUG)}:${PORT}${path}`;
let siteId = "";

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

/** הטלפון רץ בפרויקט נפרד (רק @mobile): אתר מפורסם מוכן, ישירות במסד (כמו אחרי אישור) */
function seedPublished() {
  const doc = JSON.stringify({
    schema: 1,
    template: "elegant",
    locales: ["he"],
    business: { name: { he: NAME } },
    pages: [
      {
        id: "home",
        slug: "",
        blocks: [{ id: "hero", type: "hero", v: 1, props: { title: { he: NAME } } }],
      },
    ],
  });
  asPlatform(`SELECT public.platform_bp_open_site('${SLUG}', '${NAME}', NULL, '${doc}'::jsonb)`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`WITH v AS (INSERT INTO business_profile.site_versions (tenant_id, state, version, template, document)
                  SELECT tenant_id, 'published', 1, template, document FROM business_profile.site_versions
                   WHERE tenant_id = '${siteId}' AND state = 'draft' RETURNING id)
       UPDATE business_profile.sites SET live_version_id = (SELECT id FROM v), first_approved_at = now()
        WHERE tenant_id = '${siteId}';
       INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       VALUES ('${siteId}', 'business_profile_public', true)`);
}

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name === "mobile") SLUG = "web-e2e-m";
  cleanup();
  await ensureUser(request, OWNER);
  asPlatform(`SELECT public.platform_set_flag('business_profile_enabled', true),
                     public.platform_set_flag('business_profile_public', true)`);
  if (testInfo.project.name === "mobile") seedPublished();
});

// הדגלים של הפלטפורמה נשארים דלוקים במסד של הבדיקות: הם פועלים רק על אתרי עסקים, והאתר עצמו נמחק
test.afterAll(() => cleanup());

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("the platform admin opens a business site from the panel — a draft, nothing public yet", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the platform panel runs on the computer");
  const page = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await page.goto(platformUrl("/platform/websites"));
  await expect(page.getByRole("heading", { level: 1, name: /אתרי אינטרנט/ })).toBeVisible();
  await page.getByLabel("שם העסק").fill(NAME);
  await page.getByLabel("כתובת באתר").fill(SLUG);
  await page.getByLabel("אימייל בעל העסק (לא חובה)").fill(OWNER.email);
  await page.getByRole("button", { name: "פתיחת האתר" }).click();
  await expect(page.getByText(`האתר "${NAME}" נפתח כטיוטה`)).toBeVisible();
  const row = page.getByTestId("bp-platform-sites").locator("li", { hasText: NAME });
  await expect(row.getByTestId("bp-status")).toHaveText("טיוטה — לא פורסם");
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  expect(sql(`SELECT site_type FROM public.tenants WHERE id = '${siteId}'`)).toBe(
    "business_profile",
  );
  // the owner (a verified account) is attached; no store rows were created
  expect(
    sql(`SELECT count(*) FROM public.user_roles WHERE tenant_id = '${siteId}' AND is_protected`),
  ).toBe("1");
  expect(sql(`SELECT count(*) FROM public.shipping_methods WHERE tenant_id = '${siteId}'`)).toBe(
    "0",
  );
});

test("before the approval: the address shows 'under construction' (404, noindex); robots closes everything", async ({
  request,
}) => {
  siteId ||= sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  const home = await hostGet(request, hostOf(SLUG), "/");
  expect(home.status()).toBe(404);
  expect(home.headers()["x-robots-tag"]).toBe("noindex");
  expect(await home.text()).toContain("האתר בהקמה");
  const robots = await hostGet(request, hostOf(SLUG), "/robots.txt");
  expect(await robots.text()).toBe("User-agent: *\nDisallow: /\n");
  // store pages do not exist on a business site
  for (const path of ["/cart", "/product/x/y", "/admin/orders"]) {
    expect((await hostGet(request, hostOf(SLUG), path)).status(), path).toBe(404);
  }
});

test("the owner enters the studio (central login handoff) and sends the first publish for approval", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  siteId ||= sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  await enterViaHandoffTo(page, site("").replace(/\/$/, ""), siteId, OWNER.email, /\/studio$/);
  await expect(page.getByRole("heading", { level: 1, name: "סקירה ופרסום" })).toBeVisible();
  await expect(page.getByTestId("bp-status")).toHaveText("טיוטה — לא פורסם");
  const axe = await new AxeBuilder({ page }).include("main").analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.getByLabel("הערה לגרסה (לא חובה)").fill("מוכן לבדיקה");
  await page.getByRole("button", { name: "שליחה לאישור פרסום" }).click();
  await expect(page.getByText("הבקשה נשלחה. האתר יתפרסם אחרי אישור של Nuriel.")).toBeVisible();
  await expect(page.getByTestId("bp-status")).toHaveText("ממתין לאישור פרסום");
  // the draft preview (computer / phone) renders the site inside the studio
  await page.getByRole("link", { name: "עריכת האתר" }).click();
  const frame = page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]');
  await expect(frame.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
});

test("still not public while waiting; the platform admin reviews the snapshot and approves", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the platform panel runs on the computer");
  expect((await hostGet(request, hostOf(SLUG), "/")).status()).toBe(404);
  const page = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await page.goto(platformUrl("/platform/websites"));
  const row = page.getByTestId("bp-platform-sites").locator("li", { hasText: NAME });
  await expect(row.getByTestId("bp-status")).toHaveText("ממתין לאישור פרסום");
  await row.getByRole("button", { name: "בדיקת בקשת הפרסום" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("הערת בעל העסק: מוכן לבדיקה")).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
  await sheet.getByRole("button", { name: "נייד" }).click();
  await sheet.getByRole("button", { name: "אישור ופרסום" }).click();
  await expect(page.getByText("אושר: גרסה 1 באוויר")).toBeVisible();
  await expect(row.getByTestId("bp-status")).toHaveText("באוויר");
  expect(
    sql(
      `SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = '${siteId}' AND action = 'bp_publish_approved'`,
    ),
  ).toBe("1");
});

test("after the approval the site is public at '/' — SSR, one H1, RTL, canonical, robots open; unknown pages 404", async ({
  page,
  request,
}) => {
  // the 15-second flag cache: wait until the approval is visible to the gate
  await expect
    .poll(async () => (await hostGet(request, hostOf(SLUG), "/")).status(), { timeout: 30_000 })
    .toBe(200);
  const html = await (await hostGet(request, hostOf(SLUG), "/")).text();
  expect(html).toContain(`<h1 id="hero-title" class="bps-h1">${NAME}</h1>`);
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('rel="canonical"');
  // the internal prefix is never a link (it appears only as a route id in the dehydrated router state)
  expect(html).not.toMatch(/href="\/bp-site/);
  const robots = await (await hostGet(request, hostOf(SLUG), "/robots.txt")).text();
  expect(robots).toContain("Disallow: /studio");
  expect(robots).toContain("Sitemap:");
  expect((await hostGet(request, hostOf(SLUG), "/sitemap.xml")).status()).toBe(200);
  expect((await hostGet(request, hostOf(SLUG), "/bp-site")).status()).toBe(404);

  await page.goto(site("/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
  await expect(page.getByRole("contentinfo")).toContainText("Nuriel Websites");
  expect(page.url()).toBe(site("/"));
  await noHorizontalScroll(page);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  const missing = await page.goto(site("/no-such-page"));
  expect(missing!.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("העמוד לא נמצא");
});

test("@mobile the public site on a phone: no horizontal scroll, the floating WhatsApp only when a number is set", async ({
  page,
}) => {
  await page.goto(site("/"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
  await noHorizontalScroll(page);
  await expect(page.locator(".bps-wa")).toHaveCount(0);
});

test("after the first approval the owner publishes alone → version 2, kept in the history", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  await enterViaHandoffTo(page, site("").replace(/\/$/, ""), siteId, OWNER.email, /\/studio$/);
  await expect(page.getByTestId("bp-status")).toHaveText("באוויר");
  await page.getByRole("button", { name: "פרסום הטיוטה" }).click();
  await expect(page.getByText("פורסמה גרסה 2. האתר מעודכן.")).toBeVisible();
  await page.getByRole("link", { name: "גרסאות" }).click();
  const history = page.locator("main li");
  await expect(history.filter({ hasText: "גרסה 2" })).toContainText("באוויר");
  await expect(history.filter({ hasText: "גרסה 1" })).toContainText("פורסמה");
  await expect(
    history.filter({ hasText: "גרסה 1" }).getByRole("button", { name: "שחזור לטיוטה" }),
  ).toBeVisible();
  expect(
    sql(
      `SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state = 'published'`,
    ),
  ).toBe("2");
});

test("stores and zimmer sites are unchanged: no rewrite, no studio, the store home is the catalog", async ({
  page,
  request,
}) => {
  // a store keeps its own "/" (and /studio does not exist there)
  const storeHome = await hostGet(request, new URL(A("/")).host, "/");
  expect(storeHome.status()).toBe(200);
  expect(await storeHome.text()).not.toContain("bps-");
  await page.goto(A("/studio"));
  // the root 404 page — in Hebrew now (crawl parity: it was "Page not found")
  await expect(page.getByRole("heading", { name: "העמוד לא נמצא" })).toBeVisible();
  await page.goto(A("/"));
  await expect(page.locator('meta[name="nuriel-site-type"]')).toHaveCount(0);
  // the business site's public read never answers on a store address
  expect(sql(`SELECT public.bp_site_head() IS NULL`)).toBe("t");
});
