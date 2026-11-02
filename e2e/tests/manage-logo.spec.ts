import sharp from "sharp";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import { asPlatform, ensureUser, loadSession, passwordSession, sql } from "./hospitality-helpers";

// מיגרציה 42 — הלוגו מחוץ לגלריות, על השרת הבנוי ועל Storage האמיתי:
//   • העלאת לוגו בעורך האתר כשגלריית האתר ריקה: נשמר כלוגו ("brand"), לא תמונה ראשית, לא ב"תמונות";
//   • התמונה הראשונה שמעלים לגלריית האתר — היא התמונה הראשית (הלוגו לא תפס את מקומה);
//   • לוגו חדש (החלפה): התמונה הראשית נשארת; התצוגה המקדימה מציגה את הלוגו החדש בראש העמוד;
//   • הבחירה בעורך: הלוגואים שהועלו ותמונות האתר.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "hj.owner@e2e.test", password: "Hj-Owner-Pass-1!" };
const BASE_SLUG = "hj-logo";
let slug = BASE_SLUG;
let siteId = "";
let logoA: Buffer;
let logoB: Buffer;
let photo: Buffer;

const url = (path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });
/** הפריטים של האתר: סוג הבעלים (+ * לתמונה ראשית), לפי הסוג ואז לפי סדר ההעלאה */
const mediaRows = () =>
  sql(`SELECT string_agg(owner_kind || CASE WHEN is_cover THEN '*' ELSE '' END, ',' ORDER BY owner_kind, created_at)
         FROM hospitality.media WHERE tenant_id = '${siteId}'`);

function cleanup() {
  for (const row of sql(`SELECT id || '|' || slug FROM public.tenants
                          WHERE slug ~ '^hj-logo' AND site_type = 'hospitality'`)
    .split("\n")
    .filter(Boolean)) {
    const [id, s] = row.split("|") as [string, string];
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${s}')`);
  }
}

async function open(page: Page, request: APIRequestContext, path: string) {
  const session = await passwordSession(request, url(), OWNER);
  await loadSession(page, session, path);
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop flow");
  slug = testInfo.retry > 0 ? `${BASE_SLUG}-r${testInfo.retry}` : BASE_SLUG;
  cleanup();
  const png = (r: number, g: number, b: number) =>
    sharp({
      create: { width: 600, height: 200, channels: 4, background: { r, g, b, alpha: 0.6 } },
    })
      .png()
      .toBuffer();
  [logoA, logoB] = await Promise.all([png(20, 60, 120), png(160, 40, 40)]);
  photo = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 60, g: 160, b: 90 } },
  })
    .jpeg()
    .toBuffer();
  await ensureUser(request, OWNER);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  asPlatform(`SELECT hospitality.admin_create_site('${slug}', 'צימר הלוגו')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${siteId}', id, email, 'hj_owner${slug === BASE_SLUG ? "" : "_r"}', 'admin', true, true
         FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteId}', 'hospitality_backend_enabled', true), ('${siteId}', 'hospitality_management_enabled', true)`);
  const property =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
                        VALUES ('${siteId}', 'מתחם הלוגו', 'p-hj', 'active', 'zimmer_complex') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order)
       VALUES ('${siteId}', '${property}', 'unit', 'zimmer', 'צימר הלוגו', 'u-hj', 0)`);
  await expect
    .poll(async () => (await hostGet(request, hostOf(slug), "/manage/website")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("the logo is kept by itself: never a gallery photo, never the main image", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // ---- a logo while the site gallery is still empty ----
  await open(page, request, "/manage/website?tab=design");
  // a new business picks a style first (the draft is created)
  await page.getByRole("button", { name: /יוקרה/ }).click();
  await page.getByRole("tab", { name: "עיצוב" }).click();
  await page.locator("#logo-upload").setInputFiles(file("logo.png", "image/png", logoA));
  await expect(page.getByText("הלוגו הועלה")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("img", { name: "הלוגו הנוכחי" })).toBeVisible();
  expect(mediaRows()).toBe("brand");
  const first = sql(
    `SELECT id FROM hospitality.media WHERE tenant_id = '${siteId}' AND owner_kind = 'brand'`,
  );
  // the draft keeps the logo (autosave)
  await expect
    .poll(
      () =>
        sql(`SELECT document ->> 'logo' FROM hospitality.site_versions
              WHERE tenant_id = '${siteId}' AND kind = 'draft'`),
      { timeout: 15_000 },
    )
    .toBe(first);

  // ---- the photos screen: the site gallery is empty; its first photo is the main image ----
  await page.goto(url("/manage/photos"));
  const gallery = page.getByTestId("gallery-site");
  await expect(gallery.locator("li[data-media]")).toHaveCount(0);
  await gallery.getByTestId("media-file").setInputFiles(file("view.jpg", "image/jpeg", photo));
  await expect(page.getByText("הקובץ נוסף לגלריה")).toBeVisible({ timeout: 20_000 });
  await expect(gallery.locator("li[data-media]")).toHaveCount(1);
  await expect(gallery.locator('li[data-media="1"]')).toHaveAttribute("data-cover", "true");

  // ---- a new logo (replacing): the main image stays; the preview shows the new logo ----
  await page.goto(url("/manage/website?tab=design"));
  await page.getByRole("tab", { name: "עיצוב" }).click();
  await page.locator("#logo-upload").setInputFiles(file("logo-2.png", "image/png", logoB));
  await expect(page.getByText("הלוגו הועלה")).toBeVisible({ timeout: 20_000 });
  expect(mediaRows()).toBe("brand,brand,site*");
  const second =
    sql(`SELECT id FROM hospitality.media WHERE tenant_id = '${siteId}' AND owner_kind = 'brand'
                       AND id <> '${first}'`);
  const path = sql(`SELECT storage_path FROM hospitality.media WHERE id = '${second}'`);
  const preview = page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]');
  await expect(preview.locator(`header img[src*="${path}"]`)).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        sql(`SELECT document ->> 'logo' FROM hospitality.site_versions
              WHERE tenant_id = '${siteId}' AND kind = 'draft'`),
      { timeout: 15_000 },
    )
    .toBe(second);

  // ---- choosing: the logos uploaded and the site photos (3), and no logo at all ----
  await page.getByRole("button", { name: "בחירה מהלוגואים שהועלו או מהתמונות" }).click();
  const picker = page.getByRole("group", { name: "בחירת הלוגו" });
  await expect(picker.locator("li button")).toHaveCount(3);
  await picker.getByRole("button", { name: "בלי לוגו (שם העסק בטקסט)" }).click();
  await expect(page.getByText("בלי לוגו — שם העסק בטקסט")).toBeVisible();
  await expect
    .poll(
      () =>
        sql(`SELECT COALESCE(document ->> 'logo', 'none') FROM hospitality.site_versions
              WHERE tenant_id = '${siteId}' AND kind = 'draft'`),
      { timeout: 15_000 },
    )
    .toBe("none");
  // the photos screen is unchanged: one photo, the main image
  await page.goto(url("/manage/photos"));
  await expect(page.getByTestId("gallery-site").locator("li[data-media]")).toHaveCount(1);
  await expect(page.getByTestId("gallery-site").locator('li[data-media="1"]')).toHaveAttribute(
    "data-cover",
    "true",
  );
  expect(mediaRows()).toBe("brand,brand,site*");
});
