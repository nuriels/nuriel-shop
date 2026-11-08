import { readFileSync } from "node:fs";
import sharp from "sharp";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
} from "./hospitality-helpers";

// H-1 — תמונה ראשית וסרטון לפתיח, על השרת הבנוי ועל Storage האמיתי:
//   • עיצוב האתר: העלאת תמונה ראשית (נשמרת בגלריית האתר ונבחרת), סרטון ארוך מ-12 שניות נדחה
//     בהודעה ברורה, סרטון קצר עולה, נבדק בשרת ונבחר לפתיח;
//   • האתר: 5 שניות של התמונה, ואז הסרטון (בלי קול, בלולאה); כפתור עצירה; הסרטון לא נכפל בגלריה;
//   • תנועה מופחתת במערכת / "עצירת אנימציות" בכפתור הנגישות — רק התמונה, והסרטון לא נטען בכלל.
// סרטוני הבדיקה: tests/fixtures/video (WebM VP9 — Chromium של Playwright לא מנגן H.264).

test.describe.configure({ mode: "serial" });

const OWNER = { email: "hv.owner@e2e.test", password: "Hv-Owner-Pass-1!" };
const BASE_SLUG = "hv-hero";
let slug = BASE_SLUG;
let siteId = "";
let photo: Buffer;

const url = (path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/video/${name}`, import.meta.url));
const draftHero = (key: "image" | "video") =>
  sql(`SELECT s -> 'content' ->> '${key}' FROM hospitality.site_versions v,
              jsonb_array_elements(v.document -> 'sections') s
        WHERE v.tenant_id = '${siteId}' AND v.kind = 'draft' AND s ->> 'type' = 'hero'`);

function cleanup() {
  for (const row of sql(`SELECT id || '|' || slug FROM public.tenants
                          WHERE slug ~ '^hv-hero' AND site_type = 'hospitality'`)
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
  photo = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 40, g: 110, b: 150 } },
  })
    .jpeg()
    .toBuffer();
  await ensureUser(request, OWNER);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled', 'hospitality_frontend_enabled')`);
  asPlatform(`SELECT hospitality.admin_create_site('${slug}', 'צימר הסרטון')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${siteId}', id, email, 'hv_owner${slug === BASE_SLUG ? "" : "_r"}', 'admin', true, true
         FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteId}', 'hospitality_backend_enabled', true), ('${siteId}', 'hospitality_management_enabled', true),
       ('${siteId}', 'hospitality_frontend_enabled', true)`);
  const property =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
                        VALUES ('${siteId}', 'מתחם הסרטון', 'p-hv', 'active', 'zimmer_complex') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order)
       VALUES ('${siteId}', '${property}', 'unit', 'zimmer', 'צימר הסרטון', 'u-hv', 0)`);
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

test("design: a main image uploaded and chosen; a video over 12 seconds refused; a short one checked and chosen", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await open(page, request, "/manage/website?tab=design");
  await page.getByRole("button", { name: /יוקרה/ }).click();
  await page.getByRole("tab", { name: "עיצוב" }).click();
  const box = page.getByTestId("hero-media");
  await expect(box).toContainText("התמונה מוצגת 5 שניות");
  await expect(box).toContainText("אוטומטית — התמונה הראשונה מהגלריה");

  // ---- the main image: uploaded into the site gallery and chosen at once ----
  await page.locator("#hero-image-upload").setInputFiles({
    name: "main.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(page.getByText("התמונה הראשית הוחלפה")).toBeVisible({ timeout: 20_000 });
  await expect(box).toContainText("נבחרה תמונה ראשית");
  const image = sql(`SELECT id FROM hospitality.media
                      WHERE tenant_id = '${siteId}' AND owner_kind = 'site' AND kind = 'image'`);
  expect(image).toMatch(/^[0-9a-f-]{36}$/);
  await expect.poll(() => draftHero("image"), { timeout: 15_000 }).toBe(image);

  // ---- a video over 12 seconds: refused before uploading, with the reason ----
  await page.locator("#hero-video-upload").setInputFiles({
    name: "long.webm",
    mimeType: "video/webm",
    buffer: fixture("long-13s.webm"),
  });
  await expect(box.getByRole("alert")).toHaveText(
    "הסרטון ארוך מדי (13 שניות). עד 12 שניות — קצרו אותו ונסו שוב.",
  );
  expect(
    sql(`SELECT count(*) FROM hospitality.media WHERE tenant_id = '${siteId}' AND kind = 'video'`),
  ).toBe("0");

  // ---- a 3-second video: checked on the server, kept in the site gallery, chosen for the hero ----
  await page.locator("#hero-video-upload").setInputFiles({
    name: "hero.webm",
    mimeType: "video/webm",
    buffer: fixture("hero-3s.webm"),
  });
  await expect(page.getByText("הסרטון הועלה (3 שניות)")).toBeVisible({ timeout: 30_000 });
  await expect(box.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("hero-video-preview")).toBeVisible();
  const video = sql(`SELECT id FROM hospitality.media
                      WHERE tenant_id = '${siteId}' AND owner_kind = 'site' AND kind = 'video'`);
  await expect.poll(() => draftHero("video"), { timeout: 15_000 }).toBe(video);
  await expect(box.getByRole("button", { name: "הסרת הסרטון מהפתיח" })).toBeVisible();
  await expectAccessible(page, "website editor — main image and video");
});

/** מפרסמים את הטיוטה (כמו "פרסום" בעורך) */
function publishDraft() {
  sql(`INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision)
       SELECT tenant_id, 'published',
              COALESCE((SELECT max(version) FROM hospitality.site_versions
                         WHERE tenant_id = '${siteId}' AND kind = 'published'), 0) + 1,
              theme, document, 1
         FROM hospitality.site_versions WHERE tenant_id = '${siteId}' AND kind = 'draft'`);
}

test("the site: the image for 5 seconds, then the video — muted, looping, with a stop button; not repeated in the gallery", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  publishDraft();
  await expect
    .poll(async () => (await hostGet(request, hostOf(slug), "/stay")).status(), { timeout: 30_000 })
    .toBe(200);
  const started = Date.now();
  await page.goto(url("/stay"));
  const clip = page.locator("video[data-hero-video]");
  // first the image: the video waits (loading in the background)
  await expect(clip).toHaveAttribute("data-hero-video", "waiting");
  await expect(page.locator("section").first().getByRole("img")).toBeVisible();
  await expect(clip).toHaveAttribute("data-hero-video", "playing", { timeout: 15_000 });
  expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
  const state = await clip.evaluate((v: HTMLVideoElement) => ({
    muted: v.muted,
    loop: v.loop,
    playsInline: v.playsInline,
    paused: v.paused,
    opacity: getComputedStyle(v).opacity,
    hidden: v.getAttribute("aria-hidden"),
  }));
  expect(state).toMatchObject({
    muted: true,
    loop: true,
    playsInline: true,
    paused: false,
    hidden: "true",
  });
  await expect.poll(() => clip.evaluate((v) => getComputedStyle(v).opacity)).toBe("1");

  // the stop button (WCAG 2.2.2): pauses, and plays again
  const toggle = page.getByRole("button", { name: "עצירת הסרטון" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(clip).toHaveAttribute("data-hero-video", "stopped");
  expect(await clip.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await toggle.click();
  await expect.poll(() => clip.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);

  // the gallery does not show the hero video again
  const videoId = draftHero("video");
  await expect(page.locator(`[data-media-id="${videoId}"]`)).toHaveCount(0);
  await expectAccessible(page, "site — hero with video");
});

test("reduced motion / 'stop animations': only the image — the video is not even loaded", async ({
  browser,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // the system setting
  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  const p1 = await reduced.newPage();
  const requested: string[] = [];
  p1.on("request", (r) => {
    if (/\.(webm|mp4|mov)(\?|$)/.test(r.url())) requested.push(r.url());
  });
  await p1.goto(url("/stay"));
  await p1.waitForTimeout(6_500);
  await expect(p1.locator("video[data-hero-video]")).toHaveCount(0);
  await expect(p1.getByRole("button", { name: "עצירת הסרטון" })).toHaveCount(0);
  expect(requested).toEqual([]);
  await reduced.close();

  // the site's accessibility button: "stop animations" saved in this browser
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await p2.goto(url("/robots.txt"));
  await p2.evaluate(() =>
    localStorage.setItem("hosp-a11y-prefs-v1", JSON.stringify({ v: 1, text: 100, motion: true })),
  );
  await p2.goto(url("/stay"));
  await p2.waitForTimeout(6_500);
  await expect(p2.locator("video[data-hero-video]")).toHaveCount(0);
  await ctx.close();
});
