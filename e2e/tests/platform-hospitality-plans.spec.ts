import { expect, test } from "@playwright/test";
import { AUTH, platformUrl } from "./helpers";
import { asPlatform, sql } from "./hospitality-helpers";

// שלב א' 4 — פאנל הפלטפורמה: חנויות אונליין ואתרי אירוח בנפרד.
//   • רשימת "חנויות אונליין" — בלי אתרי אירוח, עם הפניה למסך שלהם;
//   • באתרי האירוח: החבילה של אתר — מצב, תאריך סיום (מוצג ונשמר, לא נמחק בטעות), מקומות מנהלים נוספים;
//     "פרימיום לנופי דורית" — בפועל במסד, וההגבלות לפיו.

test.describe.configure({ mode: "serial" });

const SLUG = "pp-site";
let siteId = "";

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

// eslint-disable-next-line no-empty-pattern -- Playwright reads the fixtures from this pattern
test.beforeAll(({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the platform panel runs on the computer");
  cleanup();
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'נופי הבדיקה', 'pp.owner@e2e.test')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
});

test.afterAll(() => cleanup());

test("the online-stores list has no hospitality site and points to their own area", async ({
  browser,
}) => {
  const page = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await page.goto(platformUrl("/platform"));
  await expect(page.getByText(/^חנויות אונליין \(\d+\)$/)).toBeVisible();
  await expect(page.getByText(`${SLUG}.shop.localhost`)).toHaveCount(0);
  const pointer = page.getByTestId("hospitality-elsewhere");
  await expect(pointer).toContainText("אתרי האירוח (צימרים) לא מופיעים כאן");
  await pointer.getByRole("link", { name: "לאתרי האירוח" }).click();
  await expect(page).toHaveURL(/\/platform\/hospitality$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "אתרי אירוח (Hospitality)" }),
  ).toBeVisible();
});

test("a site's plan: premium until a date with 2 extra manager seats — saved; reopening shows the date (not wiped)", async ({
  browser,
}) => {
  const page = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
  await page.goto(platformUrl("/platform/hospitality"));
  await page.locator(`[data-site="${SLUG}"]`).getByRole("button", { name: "שינוי חבילה" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByTestId("plan-usage")).toContainText("יחידות פעילות");
  // חבילות שהוסרו מהפרסום (pro / enterprise) לא מוצעות
  await expect(sheet.locator("#pl-plan option")).not.toContainText(["מקצועית"]);
  await sheet.locator("#pl-plan").selectOption("premium");
  await sheet.locator("#pl-status").selectOption("active");
  await sheet.locator("#pl-until").fill("2027-06-30");
  await sheet.locator("#pl-extra-managers").fill("2");
  await sheet.getByRole("button", { name: "שמירה" }).click();
  await expect(sheet).toHaveCount(0);
  await expect
    .poll(() =>
      sql(`SELECT plan_code || '|' || status || '|' || to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                  || '|' || extra_managers FROM hospitality.subscriptions WHERE tenant_id = '${siteId}'`),
    )
    .toBe("premium|active|2027-06-30|2");
  expect(
    sql(`SELECT (hospitality.entitlements('${siteId}') ->> 'max_managers') || '|'
                || COALESCE(hospitality.entitlements('${siteId}') ->> 'max_units', 'none')`),
  ).toBe("8|none");

  // שמירה חוזרת בלי לגעת בתאריך — התאריך נשאר (קודם: נמחק)
  await page.reload();
  await page.locator(`[data-site="${SLUG}"]`).getByRole("button", { name: "שינוי חבילה" }).click();
  await expect(page.getByRole("dialog").locator("#pl-until")).toHaveValue("2027-06-30");
  await page.getByRole("dialog").locator("#pl-extra-units").fill("1");
  await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
  await expect
    .poll(() =>
      sql(`SELECT to_char(current_period_end AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '|' || extra_units
             FROM hospitality.subscriptions WHERE tenant_id = '${siteId}'`),
    )
    .toBe("2027-06-30|1");
});
