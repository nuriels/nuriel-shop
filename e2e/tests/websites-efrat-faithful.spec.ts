import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { USERS } from "../fixtures/data.mjs";
import { buildFaithfulDocument, loadSource } from "../../scripts/websites/efrat-faithful.mjs";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  enterViaHandoffTo,
  sql,
} from "./hospitality-helpers";

// Nuriel Websites — the faithful rebuild of Efrat Adir's old site (efratadir.com) in the "Classic" template,
// on the LOCAL test database only, as a DRAFT (nothing is published, no DNS):
//   • her original pictures and the site's own font files (Heebo, Assistant, Roboto — SIL OFL) go into the site's
//     media library through the regular upload functions (re-encoded / checked like any upload);
//   • the draft is built from docs/websites/faithful/efrat-source.json (scripts/websites/efrat-faithful.mjs);
//   • screenshots for the acceptance report: computer 1440 and phone 390 (full length), the portfolio tabs,
//     and the same content in the Elegant and Portfolio templates (preview only, not saved).
// The original files are not in Git: `node scripts/websites/fetch-efrat-assets.mjs` downloads them to
// .cache/efrat-faithful (from efratadir.com only). Without them the test is skipped.

test.describe.configure({ mode: "serial" });

const SLUG = "efrat-classic";
const NAME = "אפרת אדיר";
const ASSETS = fileURLToPath(new URL("../../.cache/efrat-faithful/", import.meta.url));
const READY =
  existsSync(`${ASSETS}READY`) && readFileSync(`${ASSETS}READY`, "utf8").trim() === "ok";
const MEDIA_FN = "src/engines/business-profile/api/media.functions.ts";
const STUDIO_FN = "src/engines/business-profile/api/studio.functions.ts";
const site = (path = "") => `http://${hostOf(SLUG)}:${PORT}${path}`;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the source file is plain JSON
const source: any = READY ? loadSource() : null;
let siteId = "";

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (!id) return;
  sql(`SET storage.allow_delete_query = 'true';
       DELETE FROM storage.objects WHERE bucket_id = 'bp-media' AND name LIKE '${id}/%'`);
  sql(`DELETE FROM business_profile.media WHERE tenant_id = '${id}'`);
  asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  woff2: "font/woff2",
};

/** an upload like the editor's (multipart, same-origin), with the platform admin's token */
async function upload(
  request: APIRequestContext,
  token: string,
  fn: "studioUploadMedia" | "studioUploadFont",
  file: string,
  fields: Record<string, string> = {},
) {
  const id = createHash("sha256").update(`${MEDIA_FN}--${fn}_createServerFn_handler`).digest("hex");
  const host = hostOf(SLUG);
  const res = await request.post(`http://127.0.0.1:${PORT}/_serverFn/${id}`, {
    headers: {
      host,
      "x-forwarded-host": host,
      "sec-fetch-site": "same-origin",
      "x-tsr-serverFn": "true",
      authorization: `Bearer ${token}`,
    },
    multipart: {
      ...fields,
      file: {
        name: stamped(file),
        mimeType: MIME[file.split(".").pop()!] ?? "application/octet-stream",
        buffer: readFileSync(`${ASSETS}${file}`),
      },
    },
    timeout: 120_000,
  });
  const body = await res.text();
  expect(res.ok(), `${file}: ${body.slice(0, 300)}`).toBe(true);
  expect(body, file).not.toMatch(/"(?:message|error)":"[^"]*(?:לא|נכשל|שגיאה)/);
}

/** the file name as stored in the library: name#content-hash (an earlier run is reused only if nothing changed) */
const stamped = (file: string) =>
  `${file}#${createHash("sha256")
    .update(readFileSync(`${ASSETS}${file}`))
    .digest("hex")
    .slice(0, 10)}`;

/** a few at a time (the server re-encodes every picture) */
async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
    }),
  );
}

async function openPreview(page: Page) {
  await enterViaHandoffTo(
    page,
    site(),
    siteId,
    USERS.platform.email,
    /\/studio$/,
    "platform_admin",
  );
  await page.goto(site("/studio/preview"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/** scroll the whole page once (lazy pictures), then wait for every picture and the site fonts */
async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  // the testimonials strip runs sideways, so its lazy pictures load only as they come near — load them now.
  // (pictures in a closed tab or for the other screen size are not shown, and lazy ones never load: skipped)
  await page.evaluate(() => {
    for (const img of document.images) if (img.getClientRects().length > 0) img.loading = "eager";
  });
  await page.waitForFunction(() =>
    [...document.images]
      .filter((img) => img.getClientRects().length > 0)
      .every((img) => img.complete && img.naturalWidth > 0),
  );
  await page.evaluate(() => document.fonts.ready);
}

test.beforeAll(async ({ request }, testInfo) => {
  if (!READY || testInfo.project.name !== "desktop") return;
  test.setTimeout(600_000);
  asPlatform(`SELECT public.platform_set_flag('business_profile_enabled', true)`);
  const token = await accessToken(request, USERS.platform);
  const images = new Set<string>([
    ...Object.keys(source.images),
    source.pen.file,
    ...source.services.items.map((s: { icon: string }) => s.icon),
    ...source.testimonials.items.map((t: { file: string }) => t.file),
    ...source.portfolio.items.map((w: { file: string }) => w.file),
  ]);
  const expected = images.size + source.fonts.length;
  // a complete earlier run (local test database) is reused — only the draft is built again
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  const want = [...images, ...source.fonts.map((f: { file: string }) => f.file)]
    .map(stamped)
    .sort();
  const have = siteId
    ? sql(`SELECT string_agg(original_name, '|' ORDER BY original_name) FROM business_profile.media
            WHERE tenant_id = '${siteId}'`).split("|")
    : [];
  if (!siteId || [...have].sort().join("|") !== want.join("|")) {
    cleanup();
    // the site opens empty (same structure, no pictures yet); the platform admin works on the draft
    const empty = JSON.stringify(buildFaithfulDocument(source, {})).replace(/'/g, "''");
    asPlatform(
      `SELECT public.platform_bp_open_site('${SLUG}', '${NAME}', NULL, '${empty}'::jsonb)`,
    );
    siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
    await pool([...images], 3, (file) => upload(request, token, "studioUploadMedia", file));
    for (const f of source.fonts) {
      await upload(request, token, "studioUploadFont", f.file, {
        family: f.family,
        weight: f.weight,
        style: f.style,
        unicodeRange: f.unicodeRange,
        license: f.license,
      });
    }
  }
  const ids = Object.fromEntries(
    sql(`SELECT string_agg(original_name || '=' || id, ' ') FROM business_profile.media
          WHERE tenant_id = '${siteId}'`)
      .split(" ")
      .map((pair) => {
        const [name, id] = pair.split("=") as [string, string];
        return [name.split("#")[0]!, id] as [string, string];
      }),
  );
  expect(Object.keys(ids)).toHaveLength(expected);
  const revision = Number(
    sql(
      `SELECT revision FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state = 'draft'`,
    ),
  );
  const saved = await callServerFn(request, {
    host: hostOf(SLUG),
    file: STUDIO_FN,
    name: "studioSaveDraft",
    data: { document: buildFaithfulDocument(source, ids), revision },
    token,
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  expect(
    sql(`SELECT document -> 'theme' -> 'fonts' -> 0 -> 'file' ->> 'media' IS NOT NULL
           FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state = 'draft'`),
  ).toBe("t");
});

test("Efrat's old site, rebuilt: same sections, texts, fonts, colors and pictures; a draft only", async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.skip(
    !READY,
    "the old site's files are not here — node scripts/websites/fetch-efrat-assets.mjs",
  );
  test.skip(
    testInfo.project.name !== "desktop",
    "the phone screenshots are taken here too (390px)",
  );
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  const view = page.locator('[data-template="classic"]');
  await expect(view).toBeVisible();

  // the order of the old page: hero, lead form, about, pen, testimonials, services, projects, dark form
  const order = await page.locator("main > section").evaluateAll((els) => els.map((e) => e.id));
  expect(order).toEqual([
    "hero",
    "form",
    "about",
    "pen",
    "testimonials",
    "services",
    "portfolio",
    "contact",
  ]);
  // no header, no menu, no floating WhatsApp — like the old page; the footer is the one-line strip
  await expect(page.locator(".bps-top")).toHaveCount(0);
  await expect(page.locator(".bps-wa")).toHaveCount(0);
  await expect(page.locator(".bps-footer-strip")).toContainText("Nuriel");

  // the hero: her logo, the two-line H1 (one heading), the services line, the WhatsApp button
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText(/אפשר לקרוא סיפור,\s*ואפשר להרגיש אותו/);
  await expect(page.locator(".bps-hero img.bps-hero-logo")).toBeVisible();
  await expect(page.locator(".bps-hero a.bps-btn")).toHaveAttribute("href", /wa\.me\/972524653108/);

  // her own font files, from the site's media library (no other font service)
  await settle(page);
  await page.evaluate(() =>
    Promise.all([
      document.fonts.load('900 45px "Heebo"', "א"),
      document.fonts.load('800 49px "Assistant"', "א"),
    ]),
  );
  const fonts = await page.evaluate(() => ({
    h1: getComputedStyle(document.querySelector(".bps-h1-main")!).fontFamily,
    h2: getComputedStyle(document.querySelector("#services .bps-h2")!).fontFamily,
    body: getComputedStyle(document.querySelector(".bps-about p")!).fontFamily,
    footer: getComputedStyle(document.querySelector(".bps-footer-strip p")!).fontFamily,
    files: performance
      .getEntriesByType("resource")
      .map((r) => r.name)
      .filter((u) => u.includes("/bp-media/") && u.endsWith(".woff2")),
  }));
  expect(fonts.h1).toMatch(/^"?Heebo/);
  expect(fonts.h2).toMatch(/^"?Assistant/);
  expect(fonts.body).toMatch(/^"?Assistant/);
  expect(fonts.footer).toMatch(/^"?Roboto/);
  // the Hebrew faces the browser downloaded are her site's own files (same names as the app's built-in fonts,
  // but the site's @font-face comes later in the page, so it is the one used)
  const hebrew = source.fonts
    .filter((f: { unicodeRange: string }) => f.unicodeRange.includes("U+590-5FF"))
    .map((f: { file: string }) => f.file);
  const hebrewIds = sql(`SELECT string_agg(id::text, ' ') FROM business_profile.media
                          WHERE tenant_id = '${siteId}' AND split_part(original_name, '#', 1) IN ('${hebrew.join("','")}')`).split(
    " ",
  );
  expect(hebrewIds).toHaveLength(2);
  for (const id of hebrewIds)
    expect(fonts.files.some((u) => u.endsWith(`/${siteId}/${id}.woff2`))).toBe(true);
  for (const u of fonts.files)
    expect(u).toMatch(new RegExp(`/bp-media/${siteId}/[0-9a-f-]{36}\\.woff2$`));

  // every picture is hers, from the site's folder — no placeholders
  await expect(page.locator(".bps-cover-placeholder, .bps-quote-pending")).toHaveCount(0);
  const srcs = await page
    .locator("main img")
    .evaluateAll((imgs) =>
      imgs.map((i) => (i as HTMLImageElement).currentSrc || (i as HTMLImageElement).src),
    );
  for (const s of srcs) expect(s).toMatch(new RegExp(`/bp-media/${siteId}/`));
  // the about carousel (2 photos, own buttons), 13 testimonials, 5 services with their icons
  await expect(page.locator(".bps-about .bps-carousel-slide")).toHaveCount(2);
  await expect(
    page.locator(".bps-testimonials .bps-marquee-track > li:not([aria-hidden])"),
  ).toHaveCount(13);
  await expect(page.locator(".bps-service")).toHaveCount(5);
  await expect(page.locator(".bps-service .bps-service-icon img")).toHaveCount(5);
  await expect(page.getByRole("heading", { level: 2, name: "המומחיות שלי" })).toBeVisible();

  // the projects: 5 tabs like the old page (no "all"), the first one open, 4-column masonry
  const tabs = page.locator(".bps-portfolio .bps-filter button");
  await expect(tabs).toHaveText([
    /^פרוזה/,
    /^ספרי ילדים/,
    /^שירה/,
    /^הגהה/,
    /^ספרים, קלפים, חוברות וחומרי למידה/,
  ]);
  await expect(tabs.first()).toHaveAttribute("aria-pressed", "true");
  const visibleWorks = () => page.locator(".bps-portfolio .bps-work:visible");
  await expect(visibleWorks()).toHaveCount(13);
  await tabs.nth(2).click();
  await expect(visibleWorks()).toHaveCount(2);
  await tabs.first().click();

  // the forms are shown; in the preview, sending only explains that forms connect later (nothing is sent)
  await expect(page.locator(".bps-form")).toHaveCount(2);

  // accessibility: everything but the original colors (kept on purpose — see the report)
  const axe = await new AxeBuilder({ page }).disableRules(["color-contrast"]).analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  writeFileSync(
    testInfo.outputPath("contrast.json"),
    JSON.stringify(
      contrast.violations.flatMap((v) =>
        v.nodes.map((n) => ({ target: n.target.join(" "), summary: n.failureSummary })),
      ),
      null,
      1,
    ),
  );

  await firstSlide(page);
  await page.screenshot({
    path: testInfo.outputPath("faithful-desktop-1440.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 82,
    animations: "disabled",
  });
  await page.locator("#portfolio").screenshot({
    path: testInfo.outputPath("faithful-portfolio-desktop.jpg"),
    type: "jpeg",
    quality: 85,
    animations: "disabled",
  });
  writeFileSync(
    testInfo.outputPath("faithful-metrics-desktop.json"),
    JSON.stringify(await metrics(page), null, 1),
  );

  // the phone (390px): no sideways scroll, the narrow layout (text filters + justified rows), screenshots
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "he-IL",
  });
  const mobile = await phone.newPage();
  await openPreview(mobile);
  await settle(mobile);
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  const phoneAxe = await new AxeBuilder({ page: mobile })
    .disableRules(["color-contrast"])
    .analyze();
  expect(
    phoneAxe.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
    ),
  ).toEqual([]);
  await firstSlide(mobile);
  await mobile.screenshot({
    path: testInfo.outputPath("faithful-mobile-390.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 80,
    animations: "disabled",
  });
  await mobile.locator("#portfolio").screenshot({
    path: testInfo.outputPath("faithful-portfolio-mobile.jpg"),
    type: "jpeg",
    quality: 82,
    animations: "disabled",
  });
  writeFileSync(
    testInfo.outputPath("faithful-metrics-mobile.json"),
    JSON.stringify(await metrics(mobile), null, 1),
  );
  await phone.close();

  // the same content in the other two templates — in the editor's preview only, nothing is saved
  await page.goto(site("/studio/editor"));
  await expect(page.getByRole("heading", { level: 1, name: "עריכת האתר" })).toBeVisible();
  const frame = page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]');
  await expect(frame.locator('[data-template="classic"]')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("faithful-editor.jpg"),
    type: "jpeg",
    quality: 85,
  });
  await page.getByRole("tab", { name: "עיצוב" }).click();
  for (const [name, key] of [
    [/^אלגנטית/, "elegant"],
    [/^תיק עבודות/, "portfolio"],
  ] as const) {
    await page.getByRole("radio", { name }).check();
    await expect(frame.locator(`[data-template="${key}"]`)).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: testInfo.outputPath(`faithful-editor-${key}.jpg`),
      type: "jpeg",
      quality: 85,
      animations: "disabled",
    });
    await frame.locator("#portfolio").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.screenshot({
      path: testInfo.outputPath(`faithful-editor-${key}-portfolio.jpg`),
      type: "jpeg",
      quality: 85,
      animations: "disabled",
    });
    // the whole page in this template: the preview frame (and the editor panel around it) is stretched to its
    // content for this screenshot only, then put back as it was
    const preview = page.locator('iframe[title="תצוגה מקדימה של האתר"]');
    const fullHeight = await preview.evaluate((f: HTMLIFrameElement) => {
      const d = f.contentDocument!;
      for (const img of d.images) img.loading = "eager";
      for (let el: HTMLElement | null = f; el && el !== document.body; el = el.parentElement) {
        el.dataset["shotStyle"] = el.getAttribute("style") ?? "";
        if (el !== f) {
          el.style.setProperty("height", "auto", "important");
          el.style.setProperty("max-height", "none", "important");
          el.style.setProperty("overflow", "visible", "important");
        }
      }
      f.style.setProperty("height", `${d.documentElement.scrollHeight}px`, "important");
      return d.documentElement.scrollHeight;
    });
    // (the window grows too, so the whole stretched frame is painted)
    await page.setViewportSize({ width: 1440, height: Math.min(fullHeight + 400, 12000) });
    await frame
      .locator("body")
      .evaluate(() =>
        Promise.race([
          Promise.all(
            [...document.images]
              .filter((img) => img.getClientRects().length > 0 && !img.complete)
              .map((img) => new Promise((r) => img.addEventListener("load", r, { once: true }))),
          ),
          new Promise((r) => setTimeout(r, 8000)),
        ]),
      );
    await preview.screenshot({
      path: testInfo.outputPath(`faithful-template-${key}-full.jpg`),
      type: "jpeg",
      quality: 72,
      animations: "disabled",
    });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("[data-shot-style]")) {
        el.setAttribute("style", el.dataset["shotStyle"] ?? "");
        delete el.dataset["shotStyle"];
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  // still a draft: not published, the address is "under construction"; the draft was not changed by the preview
  expect(
    sql(
      `SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state <> 'draft'`,
    ),
  ).toBe("0");
  expect(
    sql(
      `SELECT template FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state = 'draft'`,
    ),
  ).toBe("classic");
  expect((await hostGet(request, hostOf(SLUG), "/")).status()).toBe(404);
});

/** the about carousel on its first photo, paused (the pointer rests on it) — the same frame as the old page */
async function firstSlide(page: Page) {
  const carousel = page.locator(".bps-carousel");
  await carousel.hover();
  for (let i = 0; i < 3; i++) {
    if (
      await carousel
        .locator(".bps-carousel-slide")
        .first()
        .evaluate((e) => e.classList.contains("is-active"))
    )
      break;
    await carousel.locator(".bps-carousel-next").click();
  }
  await expect(carousel.locator(".bps-carousel-slide").first()).toHaveClass(/is-active/);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** what the acceptance report compares with the old page: per element — font, size, weight, colors, box */
async function metrics(page: Page) {
  return page.evaluate(() => {
    const pick = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        font: s.fontFamily.split(",")[0]!.replace(/"/g, "").trim(),
        size: s.fontSize,
        weight: s.fontWeight,
        lineHeight: s.lineHeight,
        color: s.color,
        background: s.backgroundColor,
        border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        radius: s.borderTopLeftRadius,
        padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
        align: s.textAlign,
        x: Math.round(r.left),
        y: Math.round(r.top + window.scrollY),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const sections = Object.fromEntries(
      [...document.querySelectorAll("main > section, footer")].map((el) => {
        const r = el.getBoundingClientRect();
        return [
          el.id || el.tagName.toLowerCase(),
          { y: Math.round(r.top + window.scrollY), h: Math.round(r.height) },
        ];
      }),
    );
    const sel: Record<string, string> = {
      "hero.logo": "img.bps-hero-logo",
      "hero.h1Lead": ".bps-h1-lead",
      "hero.h1Main": ".bps-h1-main",
      "hero.subtitle": ".bps-hero-sub",
      "hero.tagline": ".bps-hero-tagline",
      "hero.button": ".bps-hero a.bps-btn",
      "form.title": "#form h2",
      "form.input": "#form input",
      "form.submit": "#form button[type=submit]",
      "about.text": ".bps-about p",
      "about.titleImage": ".bps-title-image",
      "about.slide": ".bps-carousel-slide img",
      "about.button": ".bps-carousel-action a.bps-btn",
      "pen.image": "#pen img",
      "testimonials.title": "#testimonials h2",
      "testimonials.card": ".bps-marquee-track > li img",
      "testimonials.button": "#testimonials .bps-section-action a",
      "services.title": "#services h2",
      "services.card": ".bps-service",
      "services.icon": ".bps-service-icon",
      "services.cardTitle": ".bps-service h3",
      "services.cardText": ".bps-service p",
      "portfolio.title": "#portfolio h2",
      "portfolio.tab": ".bps-filter button[aria-pressed=false]",
      "portfolio.tabActive": ".bps-filter button[aria-pressed=true]",
      "portfolio.work": ".bps-portfolio .bps-work",
      "contact.title": "#contact h2",
      "contact.submit": "#contact button[type=submit]",
      footer: ".bps-footer-strip p",
      body: "body",
    };
    return {
      viewport: window.innerWidth,
      height: document.documentElement.scrollHeight,
      sections,
      elements: Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, pick(v)])),
    };
  });
}
