import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { hostGet, hostOf, PORT, supabaseEnv } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
} from "./hospitality-helpers";

// סרטון הפתיח (H-1 → מיגרציה 62), על השרת הבנוי ועל Storage האמיתי:
//   • עיצוב האתר: תמונה ראשית; סרטון ארוך מ-15 שניות נדחה (בדפדפן, ובשרת — גם כשהכותרת של הקובץ
//     "מצהירה" על 3 שניות); סרטון קצר נמדד בשרת, האורך נרשם במסד, והוא נבחר לפתיח;
//   • השרת אוכף: סרטון ארוך שעלה לגלריה נמדד, ולא יכול להיות סרטון הפתיח — לא דרך שרת האפליקציה
//     ולא בקריאה ישירה למסד; פרסום של טיוטה ישנה עם סרטון ארוך נחסם, והאתר מציג רק את התמונה;
//   • האתר: הסרטון קודם (בלי קול) → בסופו התמונה הראשית 5 שניות → שוב הסרטון; כפתור עצירה;
//   • כשלים: הפעלה אוטומטית חסומה, קובץ שבור, טעינה איטית — תמיד התמונה, אף פעם לא מסך ריק;
//   • טלפון (מסך אייפון, מגע) ומעבר בין עמודים; לשונית ברקע; תנועה מופחתת — רק התמונה;
//   • קובץ ארוך שהוחלף באחסון מעל סרטון שכבר נמדד — הנגן עוצר כל סיבוב ב-15.5 שניות.
// סרטוני הבדיקה: tests/fixtures/video (WebM VP9 — Chromium של Playwright לא מנגן H.264).

test.describe.configure({ mode: "serial" });

const OWNER = { email: "hv.owner@e2e.test", password: "Hv-Owner-Pass-1!" };
const BASE_SLUG = "hv-hero";
let slug = BASE_SLUG;
let siteId = "";
let photo: Buffer;
let shortId = "";
let longId = "";

const url = (path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
const fixture = (name: string) =>
  readFileSync(new URL(`../../tests/fixtures/video/${name}`, import.meta.url));
const draftHero = (key: "image" | "video") =>
  sql(`SELECT s -> 'content' ->> '${key}' FROM hospitality.site_versions v,
              jsonb_array_elements(v.document -> 'sections') s
        WHERE v.tenant_id = '${siteId}' AND v.kind = 'draft' AND s ->> 'type' = 'hero'`);
const IPHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};

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

/** מפרסמים את הטיוטה (כמו "פרסום" בעורך — בלי לעבור בבדיקות; למסלול האמיתי יש בדיקה משלו) */
function publishDraft(document?: string) {
  sql(`INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision)
       SELECT tenant_id, 'published',
              COALESCE((SELECT max(version) FROM hospitality.site_versions
                         WHERE tenant_id = '${siteId}' AND kind = 'published'), 0) + 1,
              theme, ${document ?? "document"}, 1
         FROM hospitality.site_versions WHERE tenant_id = '${siteId}' AND kind = 'draft'`);
}

/** כל מעבר בין המצבים של הסרטון, עם הזמן (לבדיקת הסדר והמשך ההפסקה) */
async function recordPhases(page: Page) {
  await page.addInitScript(() => {
    const log: { phase: string; at: number }[] = [];
    (window as unknown as { __heroLog: typeof log }).__heroLog = log;
    new MutationObserver(() => {
      const v = document.querySelector("video[data-hero-video]");
      const phase = v?.getAttribute("data-hero-video") ?? "none";
      if (log[log.length - 1]?.phase !== phase) log.push({ phase, at: performance.now() });
    }).observe(document, { subtree: true, attributes: true, childList: true });
  });
}
const phases = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __heroLog: { phase: string; at: number }[] }).__heroLog,
  );
const heroImage = (page: Page) => page.locator("section").first().getByRole("img").first();
const opacity = (page: Page) =>
  page.locator("video[data-hero-video]").evaluate((v) => getComputedStyle(v).opacity);

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "desktop flow (the phone check opens its own context)",
  );
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

test("design: a main image; a video over 15 seconds refused (also when its header claims 3 s); a short one measured on the server and chosen", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/website?tab=design");
  await page.getByRole("button", { name: /יוקרה/ }).click();
  await page.getByRole("tab", { name: "עיצוב" }).click();
  const box = page.getByTestId("hero-media");
  await expect(box).toContainText("הסרטון מתנגן בלי קול, ובסופו התמונה הראשית 5 שניות");
  await expect(box).toContainText("עד 15 שניות ועד 20MB");
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

  // ---- 16 seconds: refused before uploading, with the reason ----
  await page.locator("#hero-video-upload").setInputFiles({
    name: "long.webm",
    mimeType: "video/webm",
    buffer: fixture("long-16s.webm"),
  });
  await expect(box.getByRole("alert")).toHaveText(
    "הסרטון ארוך מדי (16 שניות). עד 15 שניות — קצרו אותו ונסו שוב.",
  );
  // ---- a file whose header says 3 seconds (the browser believes it) but is really 16: the server measures ----
  await page.locator("#hero-video-upload").setInputFiles({
    name: "lying.webm",
    mimeType: "video/webm",
    buffer: fixture("lying-duration-16s.webm"),
  });
  await expect(box.getByRole("alert")).toHaveText(
    "הסרטון ארוך מדי (16 שניות). עד 15 שניות — קצרו אותו ונסו שוב.",
    { timeout: 30_000 },
  );
  expect(
    sql(`SELECT count(*) FROM hospitality.media WHERE tenant_id = '${siteId}' AND kind = 'video'`),
  ).toBe("0");

  // ---- a 2-second video: measured on the server (the length is in the database), chosen for the hero ----
  await page.locator("#hero-video-upload").setInputFiles({
    name: "hero.webm",
    mimeType: "video/webm",
    buffer: fixture("hero-2s.webm"),
  });
  await expect(page.getByText("הסרטון הועלה (2 שניות)")).toBeVisible({ timeout: 30_000 });
  await expect(box.getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("hero-video-preview")).toBeVisible();
  shortId = sql(`SELECT id FROM hospitality.media
                  WHERE tenant_id = '${siteId}' AND owner_kind = 'site' AND kind = 'video'`);
  expect(
    sql(`SELECT duration_seconds || '|' || video_codec || '|' || (duration_checked_at IS NOT NULL)
           FROM hospitality.media WHERE id = '${shortId}'`),
  ).toBe("2.00|vp9|true");
  await expect.poll(() => draftHero("video"), { timeout: 15_000 }).toBe(shortId);
  await expect(box.getByRole("button", { name: "הסרת הסרטון מהפתיח" })).toBeVisible();
  await expectAccessible(page, "website editor — main image and video");
});

test("the server enforces it: a long video uploaded to the gallery is measured, and cannot become the hero — not through the app server, not directly in the database", async ({
  page,
  request,
}) => {
  // the gallery accepts any length (up to 50MB) — but measures it
  await open(page, request, "/manage/photos");
  const gallery = page.getByTestId("gallery-site");
  await gallery.getByTestId("media-file").setInputFiles({
    name: "walk.webm",
    mimeType: "video/webm",
    buffer: fixture("long-16s.webm"),
  });
  await expect
    .poll(
      () =>
        sql(
          `SELECT count(*) FROM hospitality.media WHERE tenant_id = '${siteId}' AND kind = 'video'`,
        ),
      { timeout: 30_000 },
    )
    .toBe("2");
  longId = sql(`SELECT id FROM hospitality.media
                 WHERE tenant_id = '${siteId}' AND kind = 'video' AND id <> '${shortId}'`);
  expect(sql(`SELECT duration_seconds FROM hospitality.media WHERE id = '${longId}'`)).toBe(
    "16.00",
  );

  const document = (video: string) =>
    JSON.stringify({
      v: 1,
      theme: "luxury",
      sections: [{ id: "hero", type: "hero", hidden: false, content: { video } }],
    });
  const revision = Number(
    sql(
      `SELECT revision FROM hospitality.site_versions WHERE tenant_id = '${siteId}' AND kind = 'draft'`,
    ),
  );
  const token = await accessToken(request, OWNER);
  // through the app server (the editor's own server function, called directly)
  const viaApp = await callServerFn(request, {
    host: hostOf(slug),
    file: "src/engines/hospitality/api/site-editor.functions.ts",
    name: "hospitalitySiteDraftSave",
    data: { revision, document: document(longId) },
    token,
  });
  // (שגיאה של פונקציית שרת חוזרת כגוף התשובה עם ההודעה — כמו שהעורך מציג אותה)
  expect(await viaApp.text()).toContain("סרטון הפתיח ארוך מדי (16 שניות)");
  // straight to the database API with the owner's own token
  const { url: api, anonKey } = supabaseEnv();
  const direct = await request.post(`${api}/rest/v1/rpc/site_draft_save`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "x-tenant-id": siteId,
      "content-profile": "hospitality",
      "accept-profile": "hospitality",
    },
    data: { _revision: revision, _theme: "luxury", _document: JSON.parse(document(longId)) },
  });
  expect(direct.status()).toBe(400);
  expect(await direct.text()).toContain("סרטון הפתיח ארוך מדי (16 שניות)");
  // nor can the owner declare a length
  const declare = await request.post(`${api}/rest/v1/rpc/media_video_verified`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "x-tenant-id": siteId,
      "content-profile": "hospitality",
    },
    data: { _tenant: siteId, _id: longId, _seconds: 3, _codec: "vp9" },
  });
  expect(declare.ok()).toBe(false);
  expect(sql(`SELECT duration_seconds FROM hospitality.media WHERE id = '${longId}'`)).toBe(
    "16.00",
  );
  expect(draftHero("video")).toBe(shortId);
});

test("the site: the video first, then the main image for 5 seconds, then the video again — muted, with a stop button; not repeated in the gallery", async ({
  page,
  request,
}) => {
  publishDraft();
  await expect
    .poll(async () => (await hostGet(request, hostOf(slug), "/stay")).status(), { timeout: 30_000 })
    .toBe(200);
  await recordPhases(page);
  await page.goto(url("/stay"));
  const clip = page.locator("video[data-hero-video]");
  // the image is there from the first paint; the video starts right away (no 5-second wait first)
  await expect(heroImage(page)).toBeVisible();
  await expect(clip).toHaveAttribute("data-hero-video", "playing", { timeout: 8_000 });
  const state = await clip.evaluate((v: HTMLVideoElement) => ({
    muted: v.muted,
    loop: v.loop,
    playsInline: v.playsInline,
    paused: v.paused,
    hidden: v.getAttribute("aria-hidden"),
  }));
  expect(state).toEqual({
    muted: true,
    loop: false,
    playsInline: true,
    paused: false,
    hidden: "true",
  });
  await expect.poll(() => opacity(page)).toBe("1");

  // the video ends → the main image (the video fades out), 5 seconds → the video again, from the start
  await expect(clip).toHaveAttribute("data-hero-video", "resting", { timeout: 8_000 });
  await expect.poll(() => opacity(page)).toBe("0");
  await expect(heroImage(page)).toBeVisible();
  await expect(clip).toHaveAttribute("data-hero-cycles", "1");
  await expect(clip).toHaveAttribute("data-hero-video", "playing", { timeout: 9_000 });
  await expect.poll(() => opacity(page)).toBe("1");
  const log = await phases(page);
  const rest = log.findIndex((e) => e.phase === "resting");
  const back = log.findIndex((e, i) => i > rest && e.phase === "playing");
  expect(rest).toBeGreaterThan(0);
  expect(log.slice(0, rest).map((e) => e.phase)).toContain("playing");
  const restMs = log[back]!.at - log[rest]!.at;
  expect(restMs).toBeGreaterThanOrEqual(4_800);
  expect(restMs).toBeLessThan(7_500);
  // and again: a second full round (no stop after the first)
  await expect(clip).toHaveAttribute("data-hero-cycles", "2", { timeout: 9_000 });

  // the stop button (WCAG 2.2.2): stops on the image; play starts the video again
  const toggle = page.getByRole("button", { name: "עצירת הסרטון" });
  await expect(clip).toHaveAttribute("data-hero-video", /playing|resting/);
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(clip).toHaveAttribute("data-hero-video", "stopped");
  expect(await clip.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect.poll(() => opacity(page)).toBe("0");
  await page.waitForTimeout(6_000); // stopped means stopped — no new round
  await expect(clip).toHaveAttribute("data-hero-video", "stopped");
  await toggle.click();
  await expect(clip).toHaveAttribute("data-hero-video", "playing", { timeout: 8_000 });

  // the gallery does not show the hero video again
  await expect(page.locator(`[data-media-id="${shortId}"]`)).toHaveCount(0);
  await expectAccessible(page, "site — hero with video");
});

test("when the video cannot play: autoplay blocked → the image and a play button; a broken file → only the image; slow loading → the image until it runs", async ({
  browser,
}) => {
  // (1) the browser blocks autoplay (iPhone battery saving / a browser setting) until a tap
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => {
    const real = HTMLMediaElement.prototype.play;
    let tapped = false;
    document.addEventListener("click", () => (tapped = true), true);
    HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
      return tapped
        ? real.call(this)
        : Promise.reject(new DOMException("autoplay blocked", "NotAllowedError"));
    };
  });
  const p1 = await blocked.newPage();
  await p1.goto(url("/stay"));
  const clip1 = p1.locator("video[data-hero-video]");
  await expect(clip1).toHaveAttribute("data-hero-video", "blocked", { timeout: 8_000 });
  await expect(heroImage(p1)).toBeVisible();
  await expect.poll(() => opacity(p1)).toBe("0");
  const toggle = p1.getByRole("button", { name: "עצירת הסרטון" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(clip1).toHaveAttribute("data-hero-video", "playing", { timeout: 8_000 });
  await blocked.close();

  // (2) the file is broken / missing: only the image, no button
  const broken = await browser.newContext();
  await broken.route(/\.(webm|mp4|mov)(\?|$)/, (route) =>
    route.fulfill({ status: 404, contentType: "text/plain", body: "not found" }),
  );
  const p2 = await broken.newPage();
  await p2.goto(url("/stay"));
  await expect(heroImage(p2)).toBeVisible();
  await expect(p2.locator("video[data-hero-video]")).toHaveCount(0, { timeout: 8_000 });
  await expect(p2.getByRole("button", { name: "עצירת הסרטון" })).toHaveCount(0);
  await broken.close();

  // (3) slow loading: the image (the video invisible) until the video really runs
  const slow = await browser.newContext();
  await slow.route(/\.(webm|mp4|mov)(\?|$)/, async (route) => {
    await new Promise((r) => setTimeout(r, 4_000));
    await route.continue();
  });
  const p3 = await slow.newPage();
  await p3.goto(url("/stay"));
  const clip3 = p3.locator("video[data-hero-video]");
  await expect(clip3).toHaveAttribute("data-hero-video", "loading");
  await expect(heroImage(p3)).toBeVisible();
  await p3.waitForTimeout(2_500);
  await expect(clip3).toHaveAttribute("data-hero-video", "loading");
  expect(await opacity(p3)).toBe("0");
  await expect(clip3).toHaveAttribute("data-hero-video", "playing", { timeout: 15_000 });
  await slow.close();
});

test("phone (iPhone screen, touch) and moving between pages: plays inline; the tab in the background pauses; leaving and coming back starts again", async ({
  browser,
}) => {
  const ctx = await browser.newContext(IPHONE);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url("/stay"));
  const clip = page.locator("video[data-hero-video]");
  await expect(clip).toHaveAttribute("data-hero-video", "playing", { timeout: 8_000 });
  expect(await clip.evaluate((v: HTMLVideoElement) => v.playsInline && v.muted)).toBe(true);
  const toggle = page.getByRole("button", { name: "עצירת הסרטון" });
  const box = await toggle.boundingBox();
  expect(box && box.width >= 44 && box.height >= 44).toBe(true);

  // the tab goes to the background: paused (and not shown); back — continues
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => (h ? "hidden" : "visible"),
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  await setHidden(true);
  await expect.poll(() => clip.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await setHidden(false);
  await expect
    .poll(() => clip.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 8_000 })
    .toBe(false);

  // to another page of the site (in the app, no reload) — the video is gone and stops loading; back — again from the video
  await page.locator('a[href*="/stay/units/u-hv"]').first().click();
  await expect(page).toHaveURL(/\/stay\/units\/u-hv/);
  await expect(page.locator("video[data-hero-video]")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator("video[data-hero-video]")).toHaveAttribute(
    "data-hero-video",
    "playing",
    {
      timeout: 8_000,
    },
  );
  expect(errors).toEqual([]);
  await ctx.close();
});

test("an old draft with a long video (from before the fix): the editor explains, publishing is refused with the reason, the site shows only the image", async ({
  page,
  request,
}) => {
  // as if chosen before migration 62 (straight in the database, not through the checks)
  const withLong = `jsonb_set(document, '{sections}', (SELECT jsonb_agg(CASE WHEN s ->> 'type' = 'hero'
                      THEN jsonb_set(s, '{content,video}', to_jsonb('${longId}'::text)) ELSE s END)
                      FROM jsonb_array_elements(document -> 'sections') s))`;
  sql(`UPDATE hospitality.site_versions SET document = ${withLong}
        WHERE tenant_id = '${siteId}' AND kind = 'draft'`);
  publishDraft();
  await page.goto(url("/stay"));
  await expect(heroImage(page)).toBeVisible();
  await page.waitForTimeout(2_000);
  await expect(page.locator("video[data-hero-video]")).toHaveCount(0);

  await open(page, request, "/manage/website?tab=design");
  await page.getByRole("tab", { name: "עיצוב" }).click();
  await expect(page.getByTestId("hero-video-unusable")).toContainText("ארוך מדי (16 שניות)");
  await page.getByRole("tab", { name: "פרסום" }).click();
  await page.getByRole("button", { name: "פרסום האתר" }).click();
  await expect(page.getByText(/סרטון הפתיח ארוך מדי \(16 שניות\)/).first()).toBeVisible({
    timeout: 15_000,
  });
  // removing the video fixes it: the publish goes through
  await page.getByRole("tab", { name: "עיצוב" }).click();
  await page.getByRole("button", { name: "הסרת הסרטון מהפתיח" }).click();
  await expect.poll(() => draftHero("video"), { timeout: 15_000 }).toBe("");
  await page.getByRole("tab", { name: "פרסום" }).click();
  const before = Number(
    sql(
      `SELECT count(*) FROM hospitality.site_versions WHERE tenant_id = '${siteId}' AND kind = 'published'`,
    ),
  );
  await page.getByRole("button", { name: "פרסום האתר" }).click();
  await expect
    .poll(
      () =>
        Number(
          sql(
            `SELECT count(*) FROM hospitality.site_versions WHERE tenant_id = '${siteId}' AND kind = 'published'`,
          ),
        ),
      { timeout: 15_000 },
    )
    .toBe(before + 1);
});

test("reduced motion / 'stop animations': only the image — the video is not even loaded", async ({
  browser,
}) => {
  // the short video back in the hero
  const withShort = `jsonb_set(document, '{sections}', (SELECT jsonb_agg(CASE WHEN s ->> 'type' = 'hero'
                       THEN jsonb_set(s, '{content,video}', to_jsonb('${shortId}'::text)) ELSE s END)
                       FROM jsonb_array_elements(document -> 'sections') s))`;
  publishDraft(withShort);
  // the system setting
  const reduced = await browser.newContext({ reducedMotion: "reduce" });
  const p1 = await reduced.newPage();
  const requested: string[] = [];
  p1.on("request", (r) => {
    if (/\.(webm|mp4|mov)(\?|$)/.test(r.url())) requested.push(r.url());
  });
  await p1.goto(url("/stay"));
  await p1.waitForTimeout(6_500);
  await expect(heroImage(p1)).toBeVisible();
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

test("a longer file put over the measured one in storage still plays at most 15.5 seconds a round, then the image", async ({
  page,
  request,
}) => {
  // הדלי מאפשר לצוות של העסק לכתוב את הקבצים שלו (העלאה, החלפת תמונה) — כך שאפשר, בעקיפת המערכת,
  // לשים קובץ ארוך מעל סרטון שכבר נמדד. במסד נשאר האורך שנמדד; הנגן באתר עוצר כל סיבוב ב-15.5 שניות
  const path = sql(`SELECT storage_path FROM hospitality.media WHERE id = '${shortId}'`);
  const { url: api, anonKey } = supabaseEnv();
  const put = await request.put(`${api}/storage/v1/object/hosp-media/${path}`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${await accessToken(request, OWNER)}`,
      "content-type": "video/webm",
      "x-upsert": "true",
    },
    data: fixture("long-16s.webm"),
  });
  expect(put.ok(), await put.text()).toBe(true);

  await page.goto(url("/stay"));
  const clip = page.locator("video[data-hero-video]");
  await expect(clip).toHaveAttribute("data-hero-video", "playing", { timeout: 8_000 });
  // what plays is the long file (the database still says it was measured short)
  await expect.poll(() => clip.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(15.9);
  await expect(clip).toHaveAttribute("data-hero-video", "resting", { timeout: 20_000 });
  const stoppedAt = await clip.evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(stoppedAt).toBeGreaterThanOrEqual(15.5);
  expect(stoppedAt).toBeLessThan(15.95); // not the end of the file (16 s)
  await expect(clip).toHaveAttribute("data-hero-cycles", "1");
  await expect.poll(() => opacity(page)).toBe("0");
  await expect(heroImage(page)).toBeVisible();
  // after the image — the video again, from the start
  await expect(clip).toHaveAttribute("data-hero-video", "playing", { timeout: 9_000 });
  expect(await clip.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(5);
  // put the measured file back (nothing after this test should see the long one)
  const back = await request.put(`${api}/storage/v1/object/hosp-media/${path}`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${await accessToken(request, OWNER)}`,
      "content-type": "video/webm",
      "x-upsert": "true",
    },
    data: fixture("hero-2s.webm"),
  });
  expect(back.ok(), await back.text()).toBe(true);
});
