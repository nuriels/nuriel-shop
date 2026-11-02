import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import { asPlatform, ensureUser, loadSession, passwordSession, sql } from "./hospitality-helpers";

// מיגרציה 43 — פתיחת תאריכים להזמנה, על השרת הבנוי:
//   • עסק שהיחידות שלו עוד לא נפתחו: בלוח הבקרה — משימה, וממנה ישר ל"פתיחת תאריכים" ביומן;
//   • ביומן — פס התראה; "חודש קדימה" לשתי היחידות → נשמר במסד, והפס נעלם; הלילות שאחרי הלילה
//     האחרון שנפתח מסומנים "לא פתוח להזמנה";
//   • גודל הלוח נשמר בין כניסות (K3);
//   • באתר: לוח השנה מציג "עוד לא נפתח" אחרי הלילה האחרון שנפתח — והיום הזה לא נבחר.
// בזמן הבדיקה כבוי המנגנון של ה-seed שפותח יחידות חדשות של בדיקות אחרות (e2e_open_new_units).

test.describe.configure({ mode: "serial" });

const OWNER = { email: "hk.owner@e2e.test", password: "Hk-Owner-Pass-1!" };
const BASE = "hk-open";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;
let slug = BASE;
let siteId = "";

const url = (path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
const openUntil = () =>
  sql(`SELECT string_agg(COALESCE(open_until::text, 'closed'), ',' ORDER BY sort_order)
         FROM hospitality.units WHERE tenant_id = '${siteId}'`);

function cleanup() {
  for (const row of sql(`SELECT id || '|' || slug FROM public.tenants
                          WHERE slug ~ '^hk-open' AND site_type = 'hospitality'`)
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
  slug = testInfo.retry > 0 ? `${BASE}-r${testInfo.retry}` : BASE;
  cleanup();
  sql(`ALTER TABLE hospitality.units DISABLE TRIGGER e2e_open_new_units`);
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${slug}', 'נופי הבדיקה', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'hk_owner_${slug.length}', 'admin', true, true)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const property = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'נופי הבדיקה', 'hk-p', 'active') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price, sort_order)
       VALUES ('${siteId}', '${property}', 'unit', 'יחידת אדיר', 'hk-adir', 4, 2, 500, 0),
              ('${siteId}', '${property}', 'unit', 'יחידת מוריה', 'hk-moriya', 4, 2, 500, 1)`);
  expect(openUntil()).toBe("closed,closed");
  for (const path of ["/manage/calendar", "/stay"])
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), path)).status(), { timeout: 20_000 })
      .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`ALTER TABLE hospitality.units ENABLE TRIGGER e2e_open_new_units`);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("closed until opened: the dashboard task → open for a month → the calendar and the board", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await open(page, request, "/manage");
  const task = page.locator('li[data-task="open_dates"]');
  await expect(task).toContainText("2 יחידות לא פתוחות להזמנה באתר");
  await task.getByRole("link").click();

  // the calendar: the form opens by itself (and the address is cleaned)
  await expect(page).toHaveURL(/\/manage\/calendar$/);
  const sheet = page.getByRole("dialog", { name: "פתיחת תאריכים להזמנה" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('[data-open-unit="יחידת אדיר"] [data-open-state="closed"]')).toBeVisible();
  await expect(sheet.locator('[data-open-unit="יחידת מוריה"] input')).toBeChecked();
  await sheet.getByRole("button", { name: "חודש קדימה" }).click();
  await expect(sheet.getByTestId("open-dates-summary")).toContainText("2 יחידות יהיו פתוחות");
  await sheet.getByRole("button", { name: /^פתיחה עד / }).click();
  await expect(page.getByText(/2 יחידות פתוחות להזמנה עד/)).toBeVisible();
  await expect
    .poll(() =>
      sql(`SELECT bool_and(open_until BETWEEN current_date + 26 AND current_date + 31)::text
             FROM hospitality.units WHERE tenant_id = '${siteId}'`),
    )
    .toBe("true");
  await expect(page.getByTestId("open-dates-alert")).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '${siteId}'
                AND action = 'calendar.dates_opened'`)).toBe("1");

  // the board: two months ahead — every night after the last open one is "not open"
  await page.getByRole("button", { name: "חודש" }).click();
  await page.getByRole("button", { name: "הבא" }).click();
  await page.getByRole("button", { name: "הבא" }).click();
  const cells = page.locator('[data-unit-row="יחידת אדיר"] [data-cell]');
  await expect(cells.first()).toHaveAttribute("data-closed", "true");
  await expect(cells.last()).toHaveAttribute("data-closed", "true");
  await page.getByRole("button", { name: "היום" }).click();
  await expect(page.locator('[data-unit-row="יחידת אדיר"] [data-cell]').first()).not.toHaveAttribute(
    "data-closed",
    "true",
  );
});

test("the size of the board is remembered", async ({ page, request }) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await open(page, request, "/manage/calendar");
  await page.getByRole("button", { name: "חודש" }).click();
  await page.getByTestId("board-size").selectOption("large");
  const row = page.locator('[data-unit-row="יחידת אדיר"]');
  await expect.poll(async () => Math.round((await row.boundingBox())?.height ?? 0)).toBe(66);
  await page.reload();
  await expect(page.getByTestId("board-size")).toHaveValue("large");
  await expect.poll(async () => Math.round((await row.boundingBox())?.height ?? 0)).toBe(66);
  await page.getByTestId("board-size").selectOption("regular");
  await expect.poll(async () => Math.round((await row.boundingBox())?.height ?? 0)).toBe(54);
});

test("the site: after the last open night — not open yet, and it cannot be picked", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await page.goto(url("/stay/units/hk-adir"));
  const calendar = page.locator("[data-calendar-style]");
  await expect(calendar).toHaveAttribute("data-calendar-style", "classic");
  // this month: open nights; two months ahead — all of them "not open yet"
  await expect(calendar.locator('[data-night="free"]').first()).toBeVisible();
  await calendar.getByRole("button", { name: "החודש הבא" }).click();
  await calendar.getByRole("button", { name: "החודש הבא" }).click();
  const closed = calendar.locator('[data-night="closed"]');
  await expect(closed.first()).toBeVisible();
  await expect(calendar.locator('[data-night="free"]')).toHaveCount(0);
  await expect(closed.first()).toBeDisabled();
  await expect(closed.first()).toHaveAccessibleName(/עוד לא נפתח/);
  await expect(page.getByTestId("calendar-closed-note")).toContainText("התאריכים שאחריו עוד לא נפתחו");
});
