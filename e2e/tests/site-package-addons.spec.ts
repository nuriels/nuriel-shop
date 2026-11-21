import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// מיגרציה 202 — חדרים נוספים לחבילה (חבילת כלה), מקצה לקצה:
//   • בעל העסק מגדיר בחבילה חדר נוסף ("אדיר"), 1,200 ₪ ללילה, עד חדר אחד — בשורת החבילה ובעמוד החבילה באתר;
//   • באתר: בוחרים תאריך הגעה → החדר הנוסף מוצג (פנוי, 2,400 ₪ ל-2 לילות) → מסמנים → בסיכום: החבילה 4,000,
//     החדר 2,400 והסכום הכולל 6,400 מהמסד → בקשה → "הבקשה התקבלה" עם שני החדרים, מייל אחד לאורח;
//   • במסד: שתי הזמנות באותה קבוצה — ה-VIP ב-4,000 ואדיר ב-2,400 ("role": "addon");
//   • חדר שלא פתוח בתאריכים — לא מוצע ("אין חדר נוסף פנוי"), והחבילה עצמה עדיין אפשרית;
//   • בניהול: עמוד ההזמנה של החדר — "חדר נוסף לחבילה", ואישור של כל הבקשה בלחיצה אחת.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "pa.owner@e2e.test", password: "Pa-Owner-Pass-1!" };
const SLUG = "pa-site";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const GUEST = "pa.bride@e2e.test";
const NAME = "חבילת כלה – VIP";
let siteId = "";
let owner: SavedSession | null = null;
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

async function mailsWith(request: APIRequestContext, to: string, text: string, since: number) {
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
    url: string;
    body: string;
    at: number;
  }[];
  return calls.filter(
    (c) =>
      c.url.startsWith("/emails") && c.at >= since && c.body.includes(to) && c.body.includes(text),
  ).length;
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the add-on rooms flow runs once, on the computer");
  cleanup();
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'נופי הכלה', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'pa_owner', 'admin', true) ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'נופי הכלה', 'pa-p', 'active') RETURNING id`);
  // פתוחות להזמנה שנה קדימה; כל יחידה דורשת בדרך כלל 3 לילות — החבילה והחדר הנוסף קובעים 2
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price,
                                      min_nights, open_until)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'גן עדן VIP', 'pa-vip', 2, 2, 1400, 3, current_date + 365),
              ('${siteId}', '${propertyId}', 'unit', 'אדיר', 'pa-adir', 5, 2, 500, 3, current_date + 365)`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
  owner = await passwordSession(request, URL_(""), OWNER);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("the owner adds an extra room to the bride package — 1,200 a night, up to one; shown on the site", async ({
  page,
  browser,
}) => {
  await loadSession(page, owner!, "/manage/packages");
  await page.getByRole("button", { name: "חבילה חדשה" }).click();
  await page.getByLabel("שם החבילה").fill(NAME);
  await page.getByLabel("היחידה").selectOption({ label: "גן עדן VIP" });
  await page.getByLabel("לילות").fill("2");
  await page.getByLabel("מחיר החבילה (₪)").fill("4000");
  await page.getByLabel("עד כמה אורחים").fill("2");
  const addons = page.getByTestId("package-addons");
  // רק יחידות שאפשר להציע — לא היחידה של החבילה
  await expect(addons.getByRole("checkbox", { name: "חדר נוסף: גן עדן VIP" })).toHaveCount(0);
  await addons.getByRole("checkbox", { name: "חדר נוסף: אדיר" }).check();
  await page.getByLabel("מחיר ללילה לחדר נוסף (₪)").fill("1200");
  await expect(addons).toContainText("2,400");
  await page.getByLabel("כמה חדרים נוספים לכל היותר").fill("1");
  await page.getByRole("button", { name: "יצירת החבילה" }).click();
  const row = page.locator(`[data-package-row="${NAME}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByTestId("package-addons-line")).toContainText("אדיר");
  await expect(row.getByTestId("package-addons-line")).toContainText("1,200");
  await expectAccessible(page, "packages screen with add-on rooms");
  expect(
    sql(`SELECT cardinality(addon_unit_ids) || '|' || addon_nightly_price::int || '|' || addon_max
           FROM hospitality.packages WHERE tenant_id = '${siteId}'`),
  ).toBe("1|1200|1");

  await row.getByRole("switch", { name: "מוצגת באתר" }).click();
  await expect(row.getByRole("switch", { name: "מוצגת באתר" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const visitor = await browser.newPage();
  const slug = sql(`SELECT slug FROM hospitality.packages WHERE tenant_id = '${siteId}'`);
  await visitor.goto(URL_(`/stay/packages/${encodeURIComponent(slug)}`));
  await expect(visitor.getByTestId("package-addons-offer")).toContainText("1,200");
  await visitor.close();
});

test("a guest books the package with the extra room — 4,000 + 2,400 = 6,400 from the database; one request", async ({
  page,
  request,
}) => {
  const slug = sql(`SELECT slug FROM hospitality.packages WHERE tenant_id = '${siteId}'`);
  await page.goto(URL_(`/stay/book?package=${encodeURIComponent(slug)}`));
  await expect(page.getByTestId("package-booking")).toBeVisible();
  // לפני תאריך — אין עדיין רשימת חדרים
  await expect(page.getByText("בחרו תאריך הגעה כדי לראות אם יש חדר נוסף פנוי")).toBeVisible();
  await page.getByRole("button", { name: "החודש הבא" }).first().click();
  await page.getByRole("button", { name: "10 — פנוי" }).first().click();
  const picker = page.getByTestId("package-addons");
  const adir = picker.locator('[data-addon-room="אדיר"]');
  await expect(adir).toBeVisible({ timeout: 15_000 });
  await expect(adir).toContainText("2,400");
  await adir.getByRole("checkbox", { name: "הוספת אדיר כחדר נוסף" }).check();
  const summary = page.locator("aside").filter({ hasText: "סיכום" });
  await expect(summary.getByTestId("package-rooms-summary")).toContainText("אדיר");
  await expect(summary.getByTestId("package-grand-total")).toContainText("6,400", {
    timeout: 15_000,
  });
  await expect(summary).toContainText("4,000");
  await expectAccessible(page, "package booking with an extra room");

  await page.getByRole("button", { name: "המשך לפרטים" }).click();
  // הסיכום בצד (במחשב; בטלפון הסיכום בשורה שמעל הטופס) — הסכום הכולל נשאר גם בשלב הפרטים
  await expect(page.locator("aside").getByTestId("package-grand-total")).toContainText("6,400");
  await page.getByLabel("שם מלא").fill("נועה כלה");
  await page.getByLabel("טלפון נייד").fill("0521234571");
  await page.getByLabel("אימייל").first().fill(GUEST);
  await page.getByRole("checkbox", { name: /קראתי ואני מאשר/ }).check();
  const since = Date.now();
  await page.getByRole("button", { name: "שליחת בקשת הזמנה" }).click();
  await expect(page).toHaveURL(/\/stay\/booking-received/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "הבקשה התקבלה" })).toBeVisible();
  await expect(page.getByText("אדיר").first()).toBeVisible({ timeout: 15_000 });

  // במסד: שתי הזמנות, אותה קבוצה; החבילה במחיר החבילה והחדר במחיר הקבוע
  expect(
    sql(`SELECT string_agg(u.name || ':' || b.total::int || ':' || COALESCE(b.package_snapshot ->> 'role', 'package'), ','
                           ORDER BY b.number) || '|' || count(DISTINCT b.group_id)
           FROM hospitality.bookings b
           JOIN hospitality.guests g ON g.id = b.guest_id
           JOIN hospitality.units u ON u.id = b.unit_id
          WHERE b.tenant_id = '${siteId}' AND g.email_normalized = '${GUEST}'`),
  ).toBe("גן עדן VIP:4000:package,אדיר:2400:addon|1");
  // מייל אחד לאורח לכל הבקשה — עם שם החבילה ושני החדרים
  await expect
    .poll(() => mailsWith(request, GUEST, "אדיר", since), { timeout: 20_000 })
    .toBeGreaterThan(0);
});

test("a room closed for the chosen dates is not offered — the package alone is still bookable", async ({
  page,
}) => {
  sql(
    `UPDATE hospitality.units SET open_until = current_date + 1 WHERE tenant_id = '${siteId}' AND slug = 'pa-adir'`,
  );
  try {
    const slug = sql(`SELECT slug FROM hospitality.packages WHERE tenant_id = '${siteId}'`);
    await page.goto(URL_(`/stay/book?package=${encodeURIComponent(slug)}`));
    await page.getByRole("button", { name: "החודש הבא" }).first().click();
    await page.getByRole("button", { name: "20 — פנוי" }).first().click();
    await expect(page.getByTestId("package-addons-none")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "המשך לפרטים" })).toBeEnabled({
      timeout: 15_000,
    });
  } finally {
    sql(
      `UPDATE hospitality.units SET open_until = current_date + 365 WHERE tenant_id = '${siteId}' AND slug = 'pa-adir'`,
    );
  }
});

test("the owner: the room's booking page says 'extra room'; approving the whole request at once", async ({
  page,
}) => {
  const roomId = sql(`SELECT b.id FROM hospitality.bookings b
                       WHERE b.tenant_id = '${siteId}' AND b.package_snapshot ->> 'role' = 'addon'`);
  await loadSession(page, owner!, `/manage/bookings/${roomId}`);
  await expect(page.getByRole("heading", { name: `חדר נוסף לחבילה — ${NAME}` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("booking-package-addon")).toContainText("1,200");
  const group = page.locator('[data-section="booking-group"]');
  await expect(group).toContainText("בקשה אחת ל-2 חדרים");
  await group.getByRole("button", { name: "אישור כל החדרים (2)" }).click();
  await page.getByRole("button", { name: "אישור כל החדרים" }).last().click();
  await expect
    .poll(
      () =>
        sql(`SELECT string_agg(status, ',' ORDER BY number) FROM hospitality.bookings
              WHERE tenant_id = '${siteId}' AND package_id IS NOT NULL`),
      { timeout: 15_000 },
    )
    .toBe("confirmed,confirmed");
  await expectAccessible(page, "extra room booking page");
});
