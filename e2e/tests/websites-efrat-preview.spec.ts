import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { USERS } from "../fixtures/data.mjs";
import { hostGet, hostOf, PORT } from "./helpers";
import { asPlatform, enterViaHandoffTo, sql } from "./hospitality-helpers";

// Nuriel Websites — the pilot (אפרת אדיר) in the new system, on the LOCAL test database only:
//   • the site is opened as a DRAFT from the content map (scripts/websites/efrat-draft.mjs) — texts from her
//     public site, no pictures (they wait for her approval), 46 untitled works hidden;
//   • nothing is published: the address stays "under construction", no DNS, no live site;
//   • the platform admin looks at the draft preview on a computer and on a phone (screenshots for the report);
//   • the phone menu opens and closes; the page is accessible (axe) and has no sideways scroll.

test.describe.configure({ mode: "serial" });

let SLUG = "efrat";
const NAME = "אפרת אדיר";
let siteId = "";

const draftScript = fileURLToPath(
  new URL("../../scripts/websites/efrat-draft.mjs", import.meta.url),
);
const site = (path = "") => `http://${hostOf(SLUG)}:${PORT}${path}`;

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
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
  // the self-hosted fonts are in before the screenshot
  await page.evaluate(() => document.fonts.ready);
}

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeAll(({}, testInfo) => {
  if (testInfo.project.name === "mobile") SLUG = "efrat-m";
  cleanup();
  asPlatform(`SELECT public.platform_set_flag('business_profile_enabled', true)`);
  const doc = execFileSync("node", [draftScript], { encoding: "utf8" }).replace(/'/g, "''");
  // no owner yet (her account is created only after she approves); the platform admin works on the draft
  asPlatform(`SELECT public.platform_bp_open_site('${SLUG}', '${NAME}', NULL, '${doc}'::jsonb)`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
});

test.afterAll(() => cleanup());

test("Efrat's draft on a computer: her texts, services and titled works; nothing invented; nothing public", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the phone has its own test");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("סיפור");
  await expect(page.getByRole("heading", { level: 2, name: "המומחיות שלי" })).toBeVisible();
  // the works with a real title are shown (placeholders until her pictures arrive); untitled ones are hidden
  await expect(page.locator(".bps-work-title", { hasText: "חקוק בגנים" })).toBeVisible();
  // testimonials are hidden until she sends the texts and approves them (decision 7)
  await expect(page.locator("#testimonials")).toHaveCount(0);
  // WhatsApp is her real number from the old site
  await expect(page.locator(".bps-wa")).toHaveAttribute("href", /wa\.me\/972524653108/);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("efrat-desktop.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 82,
  });
  // the editor with the live preview (what she will use)
  await page.goto(site("/studio/editor"));
  await expect(page.getByRole("heading", { level: 1, name: "עריכת האתר" })).toBeVisible();
  await expect(
    page.frameLocator('iframe[title="תצוגה מקדימה של האתר"]').getByRole("heading", { level: 1 }),
  ).toContainText("סיפור");
  await page.screenshot({
    path: testInfo.outputPath("efrat-editor.jpg"),
    type: "jpeg",
    quality: 85,
  });
  // the same content in the second template (Portfolio) — only in the preview, nothing is saved
  await page.getByRole("tab", { name: "עיצוב" }).click();
  await page.getByRole("radio", { name: /תיק עבודות/ }).check();
  await expect(page.getByText("כל הצבעים עוברים את בדיקת הניגודיות (AA).")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("efrat-editor-portfolio.jpg"),
    type: "jpeg",
    quality: 85,
  });
  // still a draft: not published, the address is "under construction"
  expect(
    sql(
      `SELECT count(*) FROM business_profile.site_versions WHERE tenant_id = '${siteId}' AND state <> 'draft'`,
    ),
  ).toBe("0");
  expect((await hostGet(request, hostOf(SLUG), "/")).status()).toBe(404);
});

test("@mobile Efrat's draft on a phone: the menu opens and closes, no sideways scroll, accessible", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the menu exists only on a narrow screen");
  await openPreview(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("efrat-mobile.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 80,
  });
  const menu = page.locator(".bps-menu");
  await menu.getByText("תפריט").click();
  const contact = menu.getByRole("link", { name: "יצירת קשר" });
  await expect(contact).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("efrat-mobile-menu.jpg"),
    type: "jpeg",
    quality: 85,
  });
  await contact.click();
  await expect(contact).toBeHidden();
  await expect(page).toHaveURL(/#contact$/);
});
