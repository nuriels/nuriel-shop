import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, hostOf, PORT, supabaseEnv } from "./helpers";
import {
  asPlatform,
  emailsTo,
  ensureUser,
  expectAccessible,
  readLoginCode,
  sql,
} from "./hospitality-helpers";

// שלב א' 2 — "ההזמנות שלי", מקצה לקצה:
//   • קישור "ההזמנות שלי" בכותרת → כניסה בקוד חד-פעמי למייל (בלי סיסמה);
//   • הרשימה: ההזמנות של הכתובת באתר הזה בלבד — גם 3 חודשים קדימה — עם יחידה, תאריכים, אורחים, מחיר,
//     מצב תשלום ומצב הזמנה; הזמנה של אורח אחר לא מופיעה;
//   • פרטי הזמנה: הוראות התשלום והעלאת אישור העברה — המצב מופיע ברשימה ונשאר אחרי רענון;
//   • החיבור בעוגייה HttpOnly (לא נגישה לסקריפטים); יציאה מבטלת אותו במסד — גם עותק של העוגייה לא עובד;
//   • כתובת בלי הזמנות — אותה תשובה בדיוק, ושום מייל לא נשלח.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "ga.owner@e2e.test", password: "Ga-Owner-Pass-1!" };
const SLUG = "ga-site";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const GUEST = "ga.guest@e2e.test";
const OTHER = "ga.other@e2e.test";
let siteId = "";
let ownerId = "";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Jerusalem",
  });

/** כמו מסך "הזמנה ידנית" של בעל העסק (המסד בודק את ההרשאה לפי המשתמש והאתר) */
function manualBooking(unitId: string, from: string, to: string, email: string, name: string) {
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${ownerId}', 'role', 'authenticated')::text, false),
              set_config('request.jwt.claim.sub', '${ownerId}', false),
              set_config('request.headers', json_build_object('x-tenant-id', '${siteId}')::text, false);
       SELECT hospitality.create_manual_booking(_unit_id => '${unitId}', _check_in => '${from}', _check_out => '${to}',
         _full_name => '${name}', _phone => '0521112233', _email => '${email}', _terms_explained => true)`);
}

async function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (!id) return;
  const paths = sql(
    `SELECT name FROM storage.objects WHERE bucket_id = 'hosp-payment-proofs' AND name LIKE '${id}/%'`,
  )
    .split("\n")
    .filter(Boolean);
  if (paths.length) {
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
    await fetch(`${supabaseEnv().url}/storage/v1/object/hosp-payment-proofs`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
  }
  asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

async function signIn(page: import("@playwright/test").Page, request: APIRequestContext) {
  // בין בדיקה לבדיקה — כאילו עברה חצי דקה (המסד מגביל קוד אחד ל-30 שניות לכתובת)
  sql(`UPDATE hospitality.guest_codes SET created_at = created_at - interval '31 seconds'
        WHERE tenant_id = '${siteId}' AND email = '${GUEST}'`);
  await page.getByLabel("אימייל").fill(GUEST);
  const since = Date.now();
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await expect(page.getByRole("status")).toContainText("שלחנו אליה קוד כניסה");
  await page.getByLabel("קוד מהמייל (6 ספרות)").fill(await readLoginCode(request, GUEST, since));
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ההזמנות שלי" })).toBeVisible();
  await expect(page.getByText(`מחוברים כ-${GUEST}`)).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the guest-area flow runs once, on the computer");
  await cleanup();
  sql(`DELETE FROM hospitality.rate_buckets`);
  ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'צימרי האזור', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'ga_owner', 'admin', true) ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'צימרי האזור', 'ga-p', 'active') RETURNING id`);
  const unitId =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'סוויטת הרימון', 'ga-u1', 4, 2, 800) RETURNING id`);
  sql(`INSERT INTO hospitality.payment_settings (tenant_id, bank_enabled, bank_name, bank_branch, bank_account, bank_holder)
       VALUES ('${siteId}', true, 'בנק הפועלים', '612', '445566', 'צימרי האזור בע״מ')`);
  // שתי הזמנות של האורחת — חודש ו-3 חודשים קדימה — והזמנה של אורח אחר באמצע
  manualBooking(unitId, day(35), day(37), GUEST.toUpperCase(), "שירה אורחת");
  manualBooking(unitId, day(50), day(52), OTHER, "אורח אחר");
  manualBooking(unitId, day(95), day(98), GUEST, "שירה אורחת");
  await expect
    .poll(async () => (await hostGet(request, HOST, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
});

test.afterAll(async () => {
  await cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("an address without bookings gets the same answer — and no email is sent", async ({
  page,
  request,
}) => {
  await page.goto(URL_("/stay/account"));
  await expect(page.getByRole("heading", { level: 1, name: "ההזמנות שלי" })).toBeVisible();
  await expectAccessible(page, "guest area sign-in");
  const since = Date.now();
  await page.getByLabel("אימייל").fill("nobody.here@e2e.test");
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await expect(page.getByRole("status")).toContainText(
    "אם יש באתר הזמנות עם הכתובת no*****@e2e.test — שלחנו אליה קוד כניסה",
  );
  await page.waitForTimeout(1500);
  expect(await emailsTo(request, "nobody.here@e2e.test", since)).toBe(0);
});

test("the header link → a code by email → the guest's own bookings here, months ahead, without another guest's", async ({
  page,
  request,
}) => {
  await page.goto(URL_("/stay"));
  await page.getByRole("banner").getByRole("link", { name: "ההזמנות שלי" }).click();
  await expect(page).toHaveURL(/\/stay\/account$/);
  await signIn(page, request);
  const cards = page.getByTestId("guest-area-bookings").locator("li");
  await expect(cards).toHaveCount(2);
  // הקרובה קודם; לכל הזמנה — יחידה, תאריכים, אורחים, מחיר, מצב תשלום ומצב הזמנה
  await expect(cards.nth(0)).toContainText("סוויטת הרימון");
  await expect(cards.nth(0)).toContainText("מאושרת");
  await expect(cards.nth(0)).toContainText("2 מבוגרים");
  await expect(cards.nth(0)).toContainText("טרם שולם");
  await expect(cards.nth(0)).toContainText("1,600");
  await expect(cards.nth(1)).toContainText("2,400");
  await expect(page.locator("main")).not.toContainText("אורח אחר");
  await expectAccessible(page, "guest area list");

  // החיבור בעוגייה HttpOnly של האתר — לא נגיש לסקריפטים בעמוד
  const cookie = (await page.context().cookies(URL_("/"))).find((c) => c.name === "hosp_guest");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("hosp_guest");
});

test("a booking's payment: bank details and a transfer proof — shown in the list, kept after a refresh; signing out revokes the session", async ({
  page,
  request,
}) => {
  await page.goto(URL_("/stay/account"));
  await signIn(page, request);
  await page
    .getByTestId("guest-area-bookings")
    .locator("li")
    .first()
    .getByRole("link", { name: "פרטים ותשלום" })
    .click();
  await expect(page).toHaveURL(/\/stay\/account\?booking=[0-9a-f-]{36}$/);
  await expect(page.locator("main")).toContainText("445566");
  const card = page.getByTestId("guest-transfer");
  await card.getByLabel("קובץ האישור").setInputFiles({
    name: "העברה.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  await card.getByRole("button", { name: "העלאת האישור" }).click();
  await expect(card.getByTestId("transfer-uploaded")).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId("transfer-proofs")).toContainText("התקבל — ממתין לבדיקת המתחם");

  await page.getByRole("link", { name: "חזרה לכל ההזמנות" }).click();
  const first = page.getByTestId("guest-area-bookings").locator("li").first();
  await expect(first).toContainText("אישור ההעברה התקבל");
  await page.reload();
  await expect(page.getByTestId("guest-area-bookings").locator("li").first()).toContainText(
    "אישור ההעברה התקבל",
  );

  // יציאה: חוזרים למסך הכניסה, והחיבור מבוטל במסד — גם עותק של העוגייה כבר לא נכנס
  const saved = (await page.context().cookies(URL_("/"))).find((c) => c.name === "hosp_guest")!;
  await page.getByRole("button", { name: "יציאה" }).click();
  await expect(page.getByRole("button", { name: "שליחת קוד" })).toBeVisible();
  await page.context().addCookies([saved]);
  await page.reload();
  await expect(page.getByRole("button", { name: "שליחת קוד" })).toBeVisible();
  expect(
    sql(`SELECT count(*) FROM hospitality.guest_sessions WHERE tenant_id = '${siteId}' AND revoked_at IS NULL
          AND email = '${GUEST}'`),
  ).toBe("1");
});
