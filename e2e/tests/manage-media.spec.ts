import http from "node:http";
import sharp from "sharp";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type Account,
} from "./hospitality-helpers";

// Hospitality Stage 2e — תמונות וגלריות, על השרת הבנוי ועל Storage האמיתי:
//   • העלאה מהמחשב / מהטלפון (בדיקת התוכן וקידוד מחדש בשרת), תמונה ראשית, סדר, ALT,
//     החלפה ומחיקה — הקבצים נעלמים מהדלי; נפח האחסון;
//   • ייבוא מקישור: עותק משלנו; כתובות פנימיות, הפניה לכתובת פנימית, SVG ו-HTML — נדחים;
//   • סרטון מ-YouTube; מסך "תמונות" וגלריית האתר; צ'קליסט;
//   • זרים נחסמים; טלפון; נגישות; בלי שום שינוי בחנויות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h2e.owner@e2e.test", password: "H2e-Owner-Pass-1!" };
const MANAGER = { email: "h2e.manager@e2e.test", password: "H2e-Manager-Pass-1!" };
const OTHER = { email: "h2e.other@e2e.test", password: "H2e-Other-Pass-1!" };
const MEDIA_FN = "src/engines/hospitality/api/media.functions.ts";
const IMG_PORT = 4011;

const DESKTOP_SITES = { main: "h2e-main", foreign: "h2e-foreign" } as const;
const MOBILE_SITES = { phone: "h2e-m" } as const;
type SiteKey = keyof typeof DESKTOP_SITES | keyof typeof MOBILE_SITES;

const ids: Partial<Record<SiteKey, string>> = {};
let suffix = "";
const slugOf = (base: string) => `${base}${suffix}`;
const url = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
let storeHash = "";
let images: http.Server | null = null;
let jpegA: Buffer;
let jpegB: Buffer;
let jpegC: Buffer;

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);

function sitesFor(project: string): Record<string, string> {
  const base: Record<string, string> = project === "mobile" ? MOBILE_SITES : DESKTOP_SITES;
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, slugOf(v)]));
}

function cleanup(project: string) {
  const prefixes = Object.values(project === "mobile" ? MOBILE_SITES : DESKTOP_SITES);
  for (const row of sql(`SELECT id || '|' || slug FROM public.tenants
                          WHERE slug ~ '^h2e-' AND site_type = 'hospitality'`)
    .split("\n")
    .filter(Boolean)) {
    const [id, slug] = row.split("|") as [string, string];
    if (prefixes.some((p) => slug === p || slug.startsWith(`${p}-r`)))
      asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

function addStaff(site: string, account: Account, username: string, owner: boolean) {
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${site}', id, email, '${username}', 'admin', true, ${owner}
         FROM auth.users WHERE email = '${account.email}'`);
}

function seedProperty(site: string, name: string, units: string[]): string {
  const tag = Math.random().toString(36).slice(2, 8);
  const id = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
                  VALUES ('${site}', '${name}', 'p-${tag}', 'active', 'zimmer_complex') RETURNING id`);
  units.forEach((u, i) =>
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order)
         VALUES ('${site}', '${id}', 'unit', 'zimmer', '${u}', 'u-${tag}-${i}', ${i})`),
  );
  return id;
}

const unitIdOf = (site: string, name: string) =>
  sql(`SELECT id FROM hospitality.units WHERE tenant_id = '${site}' AND name = '${name}'`);
const objects = (site: string) =>
  Number(
    sql(
      `SELECT count(*) FROM storage.objects WHERE bucket_id = 'hosp-media' AND name LIKE '${site}/%'`,
    ),
  );
const galleryOf = (unit: string) =>
  sql(`SELECT string_agg(kind || CASE WHEN is_cover THEN '*' ELSE '' END || ':' || COALESCE(alt, '-'), ',' ORDER BY sort_order)
         FROM hospitality.media WHERE unit_id = '${unit}'`);

async function open(
  page: Page,
  request: APIRequestContext,
  slug: string,
  path: string,
  who = OWNER,
) {
  const session = await passwordSession(request, url(slug), who);
  await loadSession(page, session, path);
}
const fn = (
  request: APIRequestContext,
  slug: string,
  name: string,
  token?: string,
  data?: unknown,
) =>
  callServerFn(request, {
    host: hostOf(slug),
    file: MEDIA_FN,
    name,
    data,
    token,
    method: name === "hospitalityGalleries" ? "GET" : "POST",
  });
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const file = (name: string, mimeType: string, buffer: Buffer) => ({ name, mimeType, buffer });

test.beforeAll(async ({ request }, testInfo) => {
  const project = testInfo.project.name;
  suffix = testInfo.retry > 0 ? `-r${testInfo.retry}` : "";
  cleanup(project);
  storeHash = storeDataHash();
  const solid = (r: number, g: number, b: number) =>
    sharp({ create: { width: 1200, height: 800, channels: 3, background: { r, g, b } } })
      .jpeg()
      .toBuffer();
  [jpegA, jpegB, jpegC] = await Promise.all([
    solid(200, 60, 60),
    solid(60, 160, 90),
    solid(40, 90, 200),
  ]);
  // a local "website" with images — reachable only by the allow-listed name localhost
  images = http
    .createServer((req, res) => {
      const send = (type: string, body: Buffer | string) => {
        res.writeHead(200, { "content-type": type });
        res.end(body);
      };
      if (req.url === "/room.jpg") return send("image/jpeg", jpegC);
      if (req.url === "/logo.svg")
        return send(
          "image/svg+xml",
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        );
      if (req.url === "/fake.jpg")
        return send("image/jpeg", "<!doctype html><title>not an image</title>");
      if (req.url === "/redirect.jpg") {
        res.writeHead(302, { location: `http://127.0.0.1:${IMG_PORT}/room.jpg` });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    })
    .listen(IMG_PORT, "127.0.0.1");
  for (const u of [OWNER, MANAGER, OTHER]) await ensureUser(request, u);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  for (const [key, slug] of Object.entries(sitesFor(project))) {
    asPlatform(`SELECT hospitality.admin_create_site('${slug}', 'אתר בדיקה ${key}')`);
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    ids[key as SiteKey] = id;
    if (key === "foreign")
      addStaff(id, OTHER, `h2e_other_${project}${suffix.replace("-", "_")}`, true);
    else addStaff(id, OWNER, `h2e_owner_${key}_${project}${suffix.replace("-", "_")}`, true);
    if (key === "main")
      addStaff(id, MANAGER, `h2e_manager_${project}${suffix.replace("-", "_")}`, false);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
  }
  if (project === "mobile") seedProperty(ids.phone!, "חוות הזית", ["צימר הזית"]);
  else {
    seedProperty(ids.main!, "חוות הזית", ["צימר הזית", "צימר האלון"]);
    seedProperty(ids.foreign!, "מתחם זר", ["יחידה זרה"]);
  }
  for (const slug of Object.values(sitesFor(project)))
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), "/manage/photos")).status(), {
        timeout: 20_000,
      })
      .toBe(200);
});

test.afterAll(({ request: _request }, testInfo) => {
  images?.close();
  cleanup(testInfo.project.name);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("unit gallery: upload, cover, ALT, order, replace and delete — files really leave the bucket", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const site = ids.main!;
  const unit = unitIdOf(site, "צימר הזית");
  // before any photo: the setup step "תמונות" links to the photos screen
  await open(page, request, slug, "/manage", MANAGER);
  await expect(
    page.locator('li[data-step="photos"]').getByRole("link", { name: /^להשלמה/ }),
  ).toHaveAttribute("href", /\/manage\/photos$/);
  await page.goto(url(slug, `/manage/units/${unit}`));
  const g = page.getByTestId("gallery-unit");
  await expect(g).toContainText("עוד אין תמונות");

  // two photos at once; the first becomes the cover; 4 files each (1600 / 960 / 480 / thumb)
  await g
    .getByTestId("media-file")
    .setInputFiles([file("a.jpg", "image/jpeg", jpegA), file("b.jpg", "image/jpeg", jpegB)]);
  await expect(page.getByText("2 קבצים נוספו לגלריה")).toBeVisible();
  await expect(g.locator("li[data-media]")).toHaveCount(2);
  await expect(g.locator('li[data-media="1"]')).toHaveAttribute("data-cover", "true");
  expect(objects(site)).toBe(8);
  expect(galleryOf(unit)).toBe("image*:-,image:-");
  await expect(g.locator('li[data-media="1"] img')).toHaveAttribute(
    "src",
    /\/storage\/v1\/object\/public\/hosp-media\/.+-thumb\.webp$/,
  );

  // a fake image is refused by content (not by name)
  await g
    .getByTestId("media-file")
    .setInputFiles(file("photo.jpg", "image/jpeg", Buffer.from("<html>not an image</html>")));
  await expect(g.getByRole("alert")).toContainText("הקובץ אינו תמונה או סרטון נתמך");
  await g
    .getByTestId("media-file")
    .setInputFiles(
      file("logo.svg", "image/svg+xml", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    );
  await expect(g.getByRole("alert")).toContainText("SVG");
  expect(objects(site)).toBe(8);

  // ALT, cover, order
  await g
    .getByLabel(/טקסט חלופי/)
    .first()
    .fill("חדר שינה מול הנוף");
  await g.locator('li[data-media="1"]').getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("הטקסט החלופי נשמר")).toBeVisible();
  await g.locator('li[data-media="2"]').getByRole("button", { name: "תמונה ראשית" }).click();
  await expect(g.locator('li[data-media="2"]')).toHaveAttribute("data-cover", "true");
  expect(galleryOf(unit)).toBe("image:חדר שינה מול הנוף,image*:-");
  await g.getByRole("button", { name: "הזזת תמונה 2 קדימה" }).click();
  await expect.poll(() => galleryOf(unit)).toBe("image*:-,image:חדר שינה מול הנוף");

  // replace the cover: same place, still the cover; the old 4 files are gone, 4 new ones exist
  const before = sql(
    `SELECT storage_path FROM hospitality.media WHERE unit_id = '${unit}' AND is_cover`,
  );
  await g.locator('li[data-media="1"]').getByRole("button", { name: "החלפה — תמונה 1" }).click();
  await g.getByTestId("media-replace-file").setInputFiles(file("c.jpg", "image/jpeg", jpegC));
  await expect(page.getByText("הקובץ הוחלף")).toBeVisible();
  expect(galleryOf(unit)).toBe("image*:-,image:חדר שינה מול הנוף");
  expect(
    sql(`SELECT storage_path FROM hospitality.media WHERE unit_id = '${unit}' AND is_cover`),
  ).not.toBe(before);
  expect(
    Number(
      sql(
        `SELECT count(*) FROM storage.objects WHERE bucket_id = 'hosp-media' AND name = '${before}'`,
      ),
    ),
  ).toBe(0);
  expect(objects(site)).toBe(8);

  // delete the cover: the other photo becomes the cover; its 4 files leave the bucket
  await g.locator('li[data-media="1"]').getByRole("button", { name: "מחיקה" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "מחיקה" }).click();
  await expect(page.getByText("נמחק מהגלריה")).toBeVisible();
  await expect(g.locator("li[data-media]")).toHaveCount(1);
  expect(galleryOf(unit)).toBe("image*:חדר שינה מול הנוף");
  expect(objects(site)).toBe(4);
  await expect(g.getByTestId("media-usage")).toContainText("1 מתוך 60 בגלריה");

  // a YouTube video at the end; never the cover
  await g
    .getByLabel("סרטון מ-YouTube או Vimeo")
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await g.getByRole("button", { name: "הוספת סרטון" }).click();
  await expect(page.getByText("הסרטון נוסף")).toBeVisible();
  expect(galleryOf(unit)).toBe("image*:חדר שינה מול הנוף,embed:-");
  await expectAccessible(page, "unit page with the gallery");
});

test("link import: our own copy; internal addresses, a redirect to one, SVG and HTML are refused", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const site = ids.main!;
  const unit = unitIdOf(site, "צימר האלון");
  await open(page, request, slug, `/manage/units/${unit}`);
  const g = page.getByTestId("gallery-unit");
  const tryImport = async (link: string) => {
    await g.getByLabel("ייבוא תמונה מקישור").fill(link);
    await g.getByRole("button", { name: "ייבוא" }).click();
  };
  for (const [link, message] of [
    [`http://127.0.0.1:${IMG_PORT}/room.jpg`, "כתובת פנימית"],
    ["http://169.254.169.254/latest/meta-data/", "כתובת פנימית"],
    ["http://10.0.0.7/room.jpg", "כתובת פנימית"],
    [`http://localhost:${IMG_PORT}/redirect.jpg`, "כתובת פנימית"],
    [`http://localhost:${IMG_PORT}/logo.svg`, "SVG"],
    [`http://localhost:${IMG_PORT}/fake.jpg`, "תמונה"],
  ] as const) {
    await tryImport(link);
    await expect(g.getByRole("alert"), link).toContainText(message);
  }
  expect(galleryOf(unit)).toBe("");
  await tryImport(`http://localhost:${IMG_PORT}/room.jpg`);
  await expect(page.getByText("התמונה יובאה ונשמרה אצלנו")).toBeVisible();
  await expect(g.locator('li[data-media="1"]')).toContainText("יובאה מ-localhost");
  // the page shows only our stored copy — never the outside address
  await expect(g.locator('li[data-media="1"] img')).toHaveAttribute("src", /hosp-media\//);
  expect(
    sql(
      `SELECT source_url || '|' || (storage_path LIKE '${site}/%')::text FROM hospitality.media WHERE unit_id = '${unit}'`,
    ),
  ).toBe(`http://localhost:${IMG_PORT}/room.jpg|true`);
});

test("photos screen: site gallery, every gallery with its count, the setup checklist", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  await open(page, request, slug, "/manage");
  // photos exist now (previous tests): the step is done; the way in is the navigation
  await expect(page.locator('li[data-step="photos"]')).toContainText("הושלם");
  await page
    .getByRole("navigation", { name: "ניווט ראשי" })
    .getByRole("link", { name: "תמונות" })
    .click();
  await expect(page).toHaveURL(/\/manage\/photos$/);
  await expect(page.getByRole("heading", { level: 1, name: "תמונות" })).toBeVisible();
  // the files are public — a clear notice (no personal documents, entry codes; only images you may use)
  await expect(page.getByTestId("media-notice")).toContainText("גלויים לכל מי שמגיע לאתר");
  await expect(page.getByTestId("media-notice")).toContainText("שיש לכם זכות להשתמש בהן");
  await expect(page.locator('[data-gallery-unit="צימר הזית"]')).toContainText("2 פריטים");
  await expect(page.locator('[data-gallery-unit="צימר האלון"]')).toContainText("פריט אחד");
  const site = page.getByTestId("gallery-site");
  await site.getByTestId("media-file").setInputFiles(file("view.jpg", "image/jpeg", jpegB));
  await expect(page.getByText("הקובץ נוסף לגלריה")).toBeVisible();
  await expect(site.locator('li[data-media="1"]')).toHaveAttribute("data-cover", "true");
  await expectAccessible(page, "photos screen");
});

test("direct calls: anonymous and another site's owner are refused; no existence leak", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר הזית");
  const media = sql(
    `SELECT id FROM hospitality.media WHERE unit_id = '${unit}' AND kind = 'image' LIMIT 1`,
  );
  const other = await accessToken(request, OTHER);
  const calls: [string, unknown][] = [
    ["hospitalityGallery", { ownerKind: "unit", ownerId: unit }],
    [
      "hospitalityImportMedia",
      { ownerKind: "unit", ownerId: unit, url: `http://localhost:${IMG_PORT}/room.jpg` },
    ],
    [
      "hospitalityAddVideoLink",
      { ownerKind: "unit", ownerId: unit, url: "https://youtu.be/dQw4w9WgXcQ" },
    ],
    ["hospitalitySetMediaCover", { id: media, ownerKind: "unit", ownerId: unit }],
    ["hospitalityDeleteMedia", { id: media, ownerKind: "unit", ownerId: unit }],
  ];
  for (const [who, token] of [
    ["anonymous", undefined],
    ["other site's owner", other],
  ] as const)
    for (const [name, data] of calls) {
      const res = await fn(request, slug, name, token, data);
      expect(await res.text(), `${who} ${name}`).toMatch(/נדרשת התחברות|אין הרשאה/);
    }
  const leak = await fn(request, slugOf(DESKTOP_SITES.foreign), "hospitalityDeleteMedia", other, {
    id: media,
    ownerKind: "unit",
    ownerId: unit,
  });
  expect(await leak.text()).toMatch(/התמונה לא נמצאה/);
  expect(sql(`SELECT count(*) FROM hospitality.media WHERE id = '${media}'`)).toBe("1");
});

test("@mobile phone: upload from the phone, the gallery fits the screen, accessible", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone flow");
  const slug = slugOf(MOBILE_SITES.phone);
  const unit = unitIdOf(ids.phone!, "צימר הזית");
  await open(page, request, slug, `/manage/units/${unit}`);
  const g = page.getByTestId("gallery-unit");
  await g.getByTestId("media-file").setInputFiles(file("phone.jpg", "image/jpeg", jpegA));
  await expect(page.getByText("הקובץ נוסף לגלריה")).toBeVisible();
  await expect(g.locator('li[data-media="1"]')).toHaveAttribute("data-cover", "true");
  expect(await noSideways(page)).toBe(true);
  await expectAccessible(page, "phone: unit gallery");
});

test("Ecommerce untouched: store data unchanged", ({ request: _request }) => {
  expect(storeDataHash()).toBe(storeHash);
});
