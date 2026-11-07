import { expect, test, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import { asPlatform, ensureUser, expectAccessible, sql } from "./hospitality-helpers";

// נגישות באתר האירוח — כפתור הנגישות הצף:
//   • בכל עמוד; במקלדת (Tab, וגם Alt+A) — מגירה עם שם, הפוקוס בפנים, Esc סוגר והפוקוס חוזר לכפתור;
//   • ההעדפות = מחלקות על <html> (לא שינוי תוכן), נשמרות בדפדפן ומוחלות שוב בטעינה כבר מה-<head>;
//   • ניגודיות גבוהה, טקסט 150%, ריווח שורות ואותיות — axe נקי ובלי גלילה לצדדים; איפוס מחזיר הכול;
//   • בלי הצהרה שהאתר עומד בתקן; קישור להצהרת הנגישות;
//   • בטלפון: לא מסתיר את שורת הפעולות (הזמנה / חיוג / WhatsApp); תפריט הנייד נסגר בכפתור עם שם בעברית.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "a11y.owner@e2e.test", password: "A11y-Owner-Pass-1!" };
let SLUG = "a11y-site";
let HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

const htmlClass = (page: Page) => page.evaluate(() => document.documentElement.className);

/** גלילה לצדדים: 0 = בסדר; אחרת — הרכיבים שבולטים מרוחב העמוד (לא קבועים), כדי שהכישלון יסביר את עצמו */
async function expectNoSidewaysScroll(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const extra = document.documentElement.scrollWidth - W;
    const fixed = (el: Element) => {
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement)
        if (getComputedStyle(e).position === "fixed") return true;
      return false;
    };
    const wide = [...document.querySelectorAll("main *, footer *")]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && (b.left < -1 || b.right > W + 1) && !fixed(el);
      })
      .slice(0, 5)
      .map(
        (el) =>
          `${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 60)} «${(el.textContent ?? "").trim().slice(0, 30)}»`,
      );
    return { extra, wide };
  });
  expect(r.extra, `${label}: ${r.wide.join(" | ")}`).toBeLessThanOrEqual(1);
}

test.beforeAll(async ({ request }, testInfo) => {
  SLUG = testInfo.project.name === "mobile" ? "a11y-site-m" : "a11y-site";
  HOST = hostOf(SLUG);
  cleanup();
  await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'נופי הנגישות', '${OWNER.email}')`);
  const siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  sql(
    `UPDATE hospitality.settings SET contact_phone = '050-7654321' WHERE tenant_id = '${siteId}'`,
  );
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'נופי הנגישות', 'a11y-p', 'active') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price,
                                      min_nights, open_until)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'סוויטת הנוף', 'a11y-u1', 4, 2, 850, 1, current_date + 365),
              ('${siteId}', '${propertyId}', 'unit', 'צימר הבוסתן', 'a11y-u2', 2, 2, 600, 1, current_date + 365)`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("the saved preferences are applied from the <head>, before the page is drawn", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "checked once");
  const html = await (await hostGet(request, HOST, "/stay")).text();
  const head = html.slice(0, html.indexOf("</head>"));
  expect(head).toContain("hosp-a11y-prefs-v1");
  expect(head).toContain("document.documentElement.classList");
});

test("keyboard: the button, Alt+A, a named panel, Esc returns focus; the preferences change only classes, are kept and reset", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the keyboard flow runs on the computer");
  await page.goto(URL_("/stay"));
  const trigger = page.getByRole("button", { name: "תפריט נגישות" });
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-keyshortcuts", "Alt+A");
  // הכפתור הוא האחרון בסדר המקלדת — Shift+Tab מתחילת העמוד מגיע אליו
  await page.keyboard.press("Shift+Tab");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "התאמות נגישות" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "סגירת תפריט הנגישות" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();

  // Alt+A — מכל מקום בעמוד
  await page.locator("main h1").first().click();
  await page.keyboard.press("Alt+KeyA");
  await expect(panel).toBeVisible();
  // בלי הצהרה שהאתר עומד בתקן; קישור להצהרה
  await expect(panel).not.toContainText("עומד בתקן");
  await expect(panel).not.toContainText("5568");
  await expect(panel.getByRole("link", { name: /הצהרת הנגישות/ })).toHaveAttribute(
    "href",
    "/stay/accessibility",
  );
  await expectAccessible(page, "accessibility panel");

  // גודל טקסט: הגדלה ×3 = 150%, בקצה — נשאר
  const larger = panel.getByRole("button", { name: "הגדלת טקסט" });
  for (let i = 0; i < 3; i++) await larger.click();
  await expect(panel.getByTestId("a11y-text-value")).toHaveText("150%");
  await expect(larger).toHaveAttribute("aria-disabled", "true");
  // מתגים (aria-pressed): ניגודיות, קישורים, ריווח שורות ואותיות, אנימציות, סמן, מקלדת
  for (const name of [
    "ניגודיות גבוהה",
    "הדגשת קישורים",
    "ריווח שורות",
    "ריווח בין אותיות ומילים",
    "עצירת אנימציות",
    "סמן גדול וברור",
    "ניווט מקלדת — מסגרת פוקוס בולטת",
  ]) {
    const toggle = panel.getByRole("button", { name, exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  const all = [
    "hosp-a11y-text-150",
    "hosp-a11y-contrast",
    "hosp-a11y-links",
    "hosp-a11y-lines",
    "hosp-a11y-spacing",
    "hosp-a11y-motion",
    "hosp-a11y-cursor",
    "hosp-a11y-focus",
  ];
  for (const c of all) expect(await htmlClass(page)).toContain(c);
  await expectAccessible(page, "accessibility panel, everything on");
  await page.keyboard.press("Escape");

  // אחרי טעינה מחדש: הכול עדיין פעיל; הכותרת עוברת לתפריט המקוצר; בלי גלילה לצדדים; axe נקי
  await page.reload();
  for (const c of all) expect(await htmlClass(page)).toContain(c);
  await expect(page.getByRole("banner").getByRole("button", { name: "תפריט" })).toBeVisible();
  await expectNoSidewaysScroll(page, "home page, every preference on");
  await expectAccessible(page, "home page with every preference on");
  await page.goto(URL_("/stay/book"));
  await expectNoSidewaysScroll(page, "booking page, every preference on");
  await expectAccessible(page, "booking page with every preference on");

  // איפוס
  await page.getByRole("button", { name: "תפריט נגישות" }).click();
  await page.getByRole("button", { name: "איפוס כל ההגדרות" }).click();
  await expect(page.getByTestId("a11y-text-value")).toHaveText("100%");
  await expect(page.getByRole("button", { name: "ניגודיות גבוהה", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(await htmlClass(page)).not.toContain("hosp-a11y");
});

test("@mobile on the phone: the button stays clear of the action bar, text at 150% without sideways scroll, and the menu closes in Hebrew", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone layout");
  await page.goto(URL_("/stay"));
  const trigger = page.getByRole("button", { name: "תפריט נגישות" });
  await expect(trigger).toBeVisible();
  const t = (await trigger.boundingBox())!;
  for (const target of [
    page.getByRole("link", { name: "להזמנה" }).last(),
    page.getByRole("link", { name: /חיוג/ }).last(),
    page.getByRole("link", { name: "WhatsApp" }).last(),
  ]) {
    const b = (await target.boundingBox())!;
    const overlap =
      t.x < b.x + b.width && b.x < t.x + t.width && t.y < b.y + b.height && b.y < t.y + t.height;
    expect(overlap, "the accessibility button covers an action bar button").toBe(false);
  }
  expect(t.width).toBeGreaterThanOrEqual(44);

  await trigger.click();
  const panel = page.getByRole("dialog", { name: "התאמות נגישות" });
  for (let i = 0; i < 3; i++) await panel.getByRole("button", { name: "הגדלת טקסט" }).click();
  await panel.getByRole("button", { name: "ריווח שורות", exact: true }).click();
  await panel.getByRole("button", { name: "סגירת תפריט הנגישות" }).click();
  await expect(panel).toBeHidden();
  await expectNoSidewaysScroll(page, "phone, 150% text");
  await expectAccessible(page, "phone, 150% text");

  // תפריט הנייד: נפתח, ונסגר בכפתור עם שם בעברית
  await page.getByRole("banner").getByRole("button", { name: "תפריט" }).click();
  const menu = page.getByRole("dialog", { name: "נופי הנגישות" });
  await expect(menu).toBeVisible();
  await menu.getByRole("button", { name: "סגירת התפריט" }).click();
  await expect(menu).toBeHidden();

  // עמוד ההזמנה (בלי שורת הפעולות) — הכפתור בפינה, ובלי גלילה לצדדים
  await page.goto(URL_("/stay/book"));
  await expect(page.getByRole("button", { name: "תפריט נגישות" })).toBeVisible();
  await expectNoSidewaysScroll(page, "phone booking page, 150% text");
});
