import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { initialDocument } from "../../src/engines/business-profile/document/defaults";
import { AUTH, hostGet, hostOf, platformUrl, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  enterViaHandoffTo,
  ensureUser,
  sql,
} from "./hospitality-helpers";

// Nuriel Websites (business_profile) — Stage 2, end to end on the real app and the local database:
//   • the editor: a change shows in the preview at once (before saving); saving keeps it in the draft only;
//     a save that would overwrite someone else's save is refused and explained;
//   • the media library: a real upload is re-encoded to WebP / AVIF, picked for the hero, shown in the preview;
//     another business never sees it; the platform reviewer sees exactly the snapshot's pictures;
//   • the colors are checked for contrast (IS 5568 / AA) while editing;
//   • the editor on a phone: one column, no sideways scroll.

test.describe.configure({ mode: "serial" });

let SLUG = "web-ed";
let SLUG2 = "web-ed-2";
const NAME = "סטודיו לבדיקת העורך";
const OWNER = { email: "web.editor1@e2e.test", password: "Web-Editor1-e2e-2026!" };
const OWNER2 = { email: "web.editor2@e2e.test", password: "Web-Editor2-e2e-2026!" };
const site = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
const MEDIA_FN = "src/engines/business-profile/api/media.functions.ts";
let siteId = "";
let site2Id = "";

function cleanup() {
  for (const slug of [SLUG, SLUG2]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (!id) continue;
    // (the storage tables refuse plain deletes; the test database allows it for the cleanup only)
    sql(`SET storage.allow_delete_query = 'true';
         DELETE FROM storage.objects WHERE bucket_id = 'bp-media' AND name LIKE '${id}/%'`);
    sql(`DELETE FROM business_profile.media WHERE tenant_id = '${id}'`);
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

const draftTitle = () =>
  sql(`SELECT b -> 'props' -> 'title' ->> 'he'
         FROM business_profile.site_versions v, jsonb_array_elements(v.document -> 'pages' -> 0 -> 'blocks') b
        WHERE v.tenant_id = '${siteId}' AND v.state = 'draft' AND b ->> 'type' = 'hero'`);

async function openEditor(page: Page) {
  await enterViaHandoffTo(page, site(SLUG), siteId, OWNER.email, /\/studio$/);
  await page.goto(site(SLUG, "/studio/editor"));
  await expect(page.getByRole("heading", { level: 1, name: "עריכת האתר" })).toBeVisible();
}

const preview = (page: Page) => page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]');

test.beforeAll(async ({ request }, testInfo) => {
  if (testInfo.project.name === "mobile") [SLUG, SLUG2] = ["web-ed-m", "web-ed-m2"];
  cleanup();
  await ensureUser(request, OWNER);
  await ensureUser(request, OWNER2);
  asPlatform(`SELECT public.platform_set_flag('business_profile_enabled', true),
                     public.platform_set_flag('business_profile_public', true)`);
  // the same starting document the platform panel uses
  const doc = (name: string) =>
    JSON.stringify(initialDocument("elegant", name)).replace(/'/g, "''");
  asPlatform(
    `SELECT public.platform_bp_open_site('${SLUG}', '${NAME}', '${OWNER.email}', '${doc(NAME)}'::jsonb)`,
  );
  asPlatform(
    `SELECT public.platform_bp_open_site('${SLUG2}', 'עסק שני', '${OWNER2.email}', '${doc("עסק שני")}'::jsonb)`,
  );
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  site2Id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG2}'`);
});

test.afterAll(() => cleanup());

test("the editor: a change shows in the preview before saving; saving keeps it in the draft (the public site stays closed)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  await openEditor(page);
  await expect(page.getByRole("status").filter({ hasText: "הכול נשמר" })).toBeVisible();
  const title = page.getByLabel("כותרת ראשית (H1)");
  await title.fill("כותרת חדשה מהעורך");
  // the preview updates at once — before the save
  await expect(preview(page).getByRole("heading", { level: 1 })).toHaveText("כותרת חדשה מהעורך");
  await expect(page.getByRole("status").filter({ hasText: "יש שינויים שלא נשמרו" })).toBeVisible();
  expect(draftTitle()).not.toBe("כותרת חדשה מהעורך");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("הטיוטה נשמרה")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "הכול נשמר" })).toBeVisible();
  expect(draftTitle()).toBe("כותרת חדשה מהעורך");
  // after a reload the editor and the preview both start from the saved draft
  await page.reload();
  await expect(page.getByLabel("כותרת ראשית (H1)")).toHaveValue("כותרת חדשה מהעורך");
  await expect(preview(page).getByRole("heading", { level: 1 })).toHaveText("כותרת חדשה מהעורך");
  // saving is not publishing: the address is still "under construction"
  const home = await hostGet(page.request, hostOf(SLUG), "/");
  expect(home.status()).toBe(404);
  // (the preview inside the frame is a page of its own — checked by axe in the pilot preview test)
  const axe = await new AxeBuilder({ page }).include("main").exclude("iframe").analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
});

test("a save that would overwrite another save is refused and explained; reloading brings the newer draft", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  await openEditor(page);
  // someone else saves meanwhile (another tab / another editor)
  sql(`UPDATE business_profile.site_versions SET revision = revision + 1
        WHERE tenant_id = '${siteId}' AND state = 'draft'`);
  await page.getByLabel("כותרת ראשית (H1)").fill("שינוי שלא נדרס");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "הטיוטה נשמרה בינתיים ממקום אחר" }),
  ).toBeVisible();
  expect(draftTitle()).toBe("כותרת חדשה מהעורך");
  await page.getByRole("button", { name: "טעינה מחדש (השינויים שלי יאבדו)" }).click();
  await expect(page.getByLabel("כותרת ראשית (H1)")).toHaveValue("כותרת חדשה מהעורך");
});

test("colors are checked for contrast while editing (AA); the built-in palette passes", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  await openEditor(page);
  await page.getByRole("tab", { name: "עיצוב" }).click();
  await expect(page.getByText("כל הצבעים עוברים את בדיקת הניגודיות (AA).")).toBeVisible();
  await page.getByLabel("טקסט משני").fill("#bbbbbb");
  await expect(
    page.getByText(/ניגודיות נמוכה — טקסט משני על הרקע: [\d.]+:1 \(נדרש 4\.5:1\)/),
  ).toBeVisible();
  // the template palette brings the colors back
  await page.getByRole("radio", { name: /Portfolio|תיק עבודות/ }).check();
  await expect(page.getByText("כל הצבעים עוברים את בדיקת הניגודיות (AA).")).toBeVisible();
});

test("the media library: an upload is re-encoded (WebP + AVIF, no metadata), picked for the hero, shown in the preview; another business never sees it", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  const jpeg = await sharp({
    create: { width: 1400, height: 900, channels: 3, background: { r: 104, g: 77, b: 75 } },
  })
    .jpeg({ quality: 80 })
    .withMetadata({ exif: { IFD0: { Copyright: "secret-camera-data" } } })
    .toBuffer();
  await openEditor(page);
  await page.getByRole("button", { name: "בחירת תמונה" }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: /בחירת תמונה — תמונת הפתיח/ })).toBeVisible();
  await sheet.locator('input[type="file"]').setInputFiles({
    name: "cover.jpg",
    mimeType: "image/jpeg",
    buffer: jpeg,
  });
  await expect(page.getByText("התמונות נשמרו בספרייה")).toBeVisible({ timeout: 20_000 });
  await sheet.getByRole("button", { name: "בחירת cover.jpg" }).click();
  // the preview shows the picture from the site's own folder in the bucket
  const img = preview(page).locator(".bps-hero img");
  await expect(img).toHaveAttribute("src", new RegExp(`/bp-media/${siteId}/[0-9a-f-]{36}\\.webp$`));
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("הטיוטה נשמרה")).toBeVisible();

  // stored: one record, the main file + sizes + AVIF, all under the site's folder; no EXIF left
  expect(sql(`SELECT count(*) FROM business_profile.media WHERE tenant_id = '${siteId}'`)).toBe(
    "1",
  );
  const files = sql(
    `SELECT string_agg(metadata ->> 'mimetype', ',' ORDER BY name) FROM storage.objects
      WHERE bucket_id = 'bp-media' AND name LIKE '${siteId}/%'`,
  );
  expect(files.split(",").sort()).toEqual(["image/avif", "image/webp", "image/webp", "image/webp"]);
  const url = await img.getAttribute("src");
  const stored = Buffer.from(await (await request.get(url!)).body());
  const meta = await sharp(stored).metadata();
  expect(meta.format).toBe("webp");
  expect(meta.exif).toBeUndefined();
  expect(stored.includes(Buffer.from("secret-camera-data"))).toBe(false);

  // separation: the second business sees an empty library; the first owner cannot read the second site
  const token2 = await accessToken(request, OWNER2);
  const lib2 = await callServerFn(request, {
    host: hostOf(SLUG2),
    file: MEDIA_FN,
    name: "studioMedia",
    method: "GET",
    token: token2,
  });
  expect(lib2.ok()).toBe(true);
  expect(await lib2.text()).not.toContain(siteId);
  const token1 = await accessToken(request, OWNER);
  const cross = await callServerFn(request, {
    host: hostOf(SLUG2),
    file: MEDIA_FN,
    name: "studioMedia",
    method: "GET",
    token: token1,
  });
  expect(await cross.text()).not.toContain(siteId);
  expect(await cross.text()).toMatch(/אין הרשאה|error/i);
  // a picture in the draft cannot be deleted from the library
  await page.getByRole("tab", { name: "תמונות" }).click();
  await page.getByRole("button", { name: "מחיקה מהספרייה" }).click();
  await expect(page.getByText("התמונה בשימוש באתר — הסירו אותה מהאתר קודם")).toBeVisible();
  expect(sql(`SELECT count(*) FROM business_profile.media WHERE tenant_id = '${siteId}'`)).toBe(
    "1",
  );
});

test("the platform reviewer sees exactly the snapshot, with its pictures; the guest still gets nothing", async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the platform panel runs on the computer");
  await enterViaHandoffTo(page, site(SLUG), siteId, OWNER.email, /\/studio$/);
  await page.getByRole("button", { name: "שליחה לאישור פרסום" }).click();
  await expect(page.getByTestId("bp-status")).toHaveText("ממתין לאישור פרסום");
  const admin = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await admin.goto(platformUrl("/platform/websites"));
  const row = admin.getByTestId("bp-platform-sites").locator("li", { hasText: NAME });
  await row.getByRole("button", { name: "בדיקת בקשת הפרסום" }).click();
  const sheet = admin.getByRole("dialog");
  await expect(sheet.getByRole("heading", { level: 1, name: "כותרת חדשה מהעורך" })).toBeVisible();
  await expect(sheet.locator(".bps-hero img")).toHaveAttribute(
    "src",
    new RegExp(`/bp-media/${siteId}/`),
  );
  // not approved → the public address and the public picture list stay closed
  expect((await hostGet(request, hostOf(SLUG), "/")).status()).toBe(404);
});

test("@mobile the editor on a phone: one column, the preview below, no sideways scroll", async ({
  page,
}) => {
  await openEditor(page);
  await expect(page.getByLabel("כותרת ראשית (H1)")).toBeVisible();
  await expect(page.locator('iframe[title="תצוגה מקדימה של האתר"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
