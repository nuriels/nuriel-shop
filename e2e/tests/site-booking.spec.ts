import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, hostOf, PORT, supabaseEnv } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// המסלול של אורח באתר הציבורי ושל בעל העסק אחריו (נמצא בבדיקת המסלול של עסק חדש):
//   • התמונה שבעל העסק העלה ליחידה מופיעה באתר (מיגרציה 38 — קודם: "התמונות יעלו בקרוב");
//   • אורח מזמין דרך הממשק — תאריכים, אורחים, פרטים — ושולח מהר (כמו מילוי אוטומטי): הטופס מחכה
//     לזמן המינימלי של האתגר נגד בוטים, בלי "לא הצלחנו לאמת";
//   • עמוד "הבקשה התקבלה" נפתח מלמעלה (הכותרת לא מתחת לכותרת הקבועה של האתר);
//   • בעל העסק מאשר ורושם תשלום — סוג התשלום לפי ההזמנה, והאמצעי נבחר במפורש (בלי ברירת מחדל שקטה);
//   • האורח רואה בעמוד ההזמנה שלו: מאושרת ושולמה.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "sb.owner@e2e.test", password: "Sb-Owner-Pass-1!" };
let SLUG = "sb-site";
let HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
let GUEST = "sb.guest@e2e.test";
let siteId = "";
let unitId = "";
let photoPath = "";
let owner: SavedSession | null = null;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;
// PNG תקין של פיקסל אחד — מספיק כדי שהדפדפן יטען תמונה אמיתית מהאחסון
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

async function uploadPhoto(path: string) {
  const { url } = supabaseEnv();
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const res = await fetch(`${url}/storage/v1/object/hosp-media/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: PIXEL,
  });
  expect(res.status, await res.text()).toBe(200);
}

/** הקישור האישי מהמייל האחרון לאורח (שירות המייל המדומה) — בלי הדומיין */
async function guestLink(request: APIRequestContext, email: string): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
          url: string;
          body: string;
        }[];
        // הקישור האישי — רק במייל הראשון לאורח (הטוקן לא נשמר במסד), לא במייל האישור
        const mail = calls
          .filter(
            (c) =>
              c.url.startsWith("/emails") &&
              c.body.includes(email) &&
              c.body.includes("/stay/my-booking"),
          )
          .pop();
        const html = mail ? ((JSON.parse(mail.body) as { html?: string }).html ?? "") : "";
        const href = /href="([^"]*\/stay\/my-booking[^"]*)"/
          .exec(html)?.[1]
          ?.replace(/&amp;/g, "&");
        link = href ? (({ pathname, hash }) => `${pathname}${hash}`)(new URL(href)) : "";
        return link;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^\/stay\/my-booking#t=[0-9a-f]{64}$/);
  return link;
}

const bookingOf = (email: string, cols: string) =>
  sql(`SELECT ${cols} FROM hospitality.bookings b JOIN hospitality.guests g ON g.id = b.guest_id
        WHERE b.tenant_id = '${siteId}' AND g.email = '${email}' ORDER BY b.created_at DESC LIMIT 1`);

test.beforeAll(async ({ request, browser }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  SLUG = mobile ? "sb-site-m" : "sb-site";
  HOST = hostOf(SLUG);
  GUEST = mobile ? "sb.guest.m@e2e.test" : "sb.guest@e2e.test";
  cleanup();
  // מוני הקצב במסד משותפים לכל הבקשות מהמכונה הזו (בלי כתובת IP אמינה מאחורי proxy — כולן אותה
  // "כתובת"), ובקשת הזמנה מוגבלת ל-3 בעשר דקות: מונים נקיים לקובץ הזה, גם בהרצה חוזרת על אותו מסד
  sql(`DELETE FROM hospitality.rate_buckets`);
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'צימרי המסלול', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'sb_owner_${SLUG.length}', 'admin', true)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  // מתחם ויחידה אחת במחיר 750 ללילה (כמו אחרי "הוספת יחידה ראשונה"), ותמונה ראשית ליחידה
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'צימרי המסלול', 'sb-p', 'active') RETURNING id`);
  unitId =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'צימר האלה', 'sb-u1', 4, 2, 750) RETURNING id`);
  photoPath = `${siteId}/units/sb-cover.png`;
  await uploadPhoto(photoPath);
  sql(`INSERT INTO hospitality.media (tenant_id, owner_kind, unit_id, kind, storage_path, is_cover, width, height, alt)
       VALUES ('${siteId}', 'unit', '${unitId}', 'image', '${photoPath}', true, 1, 1, 'הג׳קוזי בצימר')`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
  if (!mobile) owner = await passwordSession(request, URL_(""), OWNER);
  void browser;
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("@mobile the unit's own photo is on the site — not 'photos coming soon'", async ({ page }) => {
  await page.goto(URL_("/stay"));
  const photo = page.locator(`main img[src*="${photoPath}"]`).first();
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0))
    .toBe(true);
  await expect(page.getByText("התמונות יעלו בקרוב")).toHaveCount(0);
  // ובעמוד היחידה — עם התיאור שבעל העסק כתב לתמונה
  await page.goto(URL_("/stay/units/sb-u1"));
  await expect(page.locator(`main img[alt="הג׳קוזי בצימר"]`).first()).toBeVisible();
});

test("@mobile a guest books through the site — sent at once even when filled fast; the request page opens at the top", async ({
  page,
}) => {
  await page.goto(URL_("/stay"));
  await page.getByRole("link", { name: "בדיקת זמינות והזמנה" }).first().click();
  await expect(page).toHaveURL(/\/stay\/book/);
  // יחידה אחת — כבר בחורה
  await expect(
    page.getByRole("radiogroup", { name: "יחידה" }).getByRole("radio", { checked: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "החודש הבא" }).first().click();
  await page.getByRole("button", { name: "10 — פנוי" }).first().click();
  await page.getByRole("button", { name: "12 — פנוי" }).first().click();
  // הסיכום מוצג פעם אחת לכל פריסה (בצד במחשב, למטה בטלפון) — בודקים את זה שעל המסך
  await expect(page.locator('[data-testid="pay-by-phone"] >> visible=true').first()).toBeVisible();
  await expect(page.getByText("סה״כ לתשלום").locator("visible=true").first()).toBeVisible();
  await page.getByRole("button", { name: "המשך לפרטים" }).click();
  await page.getByLabel("שם מלא").fill("נועה אורחת");
  await page.getByLabel("טלפון נייד").fill("0521234567");
  await page.getByLabel("אימייל").first().fill(GUEST);
  await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
  // הכול מולא בפחות משתי שניות (כמו מילוי אוטומטי של הדפדפן) — השליחה מחכה, לא נדחית
  await page.getByRole("button", { name: "שליחת בקשת הזמנה" }).click();
  await expect(page).toHaveURL(/\/stay\/booking-received/, { timeout: 20_000 });
  await expect(page.getByText("לא הצלחנו לאמת")).toHaveCount(0);
  const title = page.getByRole("heading", { level: 1, name: "הבקשה התקבלה" });
  await expect(title).toBeVisible();
  // העמוד מתחיל מלמעלה: הכותרת מתחת לכותרת הקבועה של האתר, לא מוסתרת בה
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const header = await page.locator("header").first().boundingBox();
  const box = await title.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
  await expect(page.getByText(/מספר הבקשה שלכם: #\d+/)).toBeVisible();
  await expectAccessible(page, "booking received");
  expect(bookingOf(GUEST, "b.status")).toBe("pending_approval");
});

test("the owner approves and records the payment — kind from the booking, the method chosen on purpose; the guest sees approved and paid", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "the owner's flow runs on the computer");
  const id = bookingOf(GUEST, "b.id");
  await loadSession(page, owner!, `/manage/bookings/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: /הזמנה #\d+/ })).toBeVisible();
  await page.getByRole("button", { name: "אישור ההזמנה" }).click();
  await page
    .getByRole("alertdialog")
    .or(page.getByRole("dialog"))
    .getByRole("button", { name: "אישור", exact: true })
    .click();
  await expect.poll(() => bookingOf(GUEST, "b.status")).toBe("confirmed");

  await page.getByRole("button", { name: "רישום תשלום או החזר" }).click();
  // שום דבר לא שולם ואין מקדמה → "תשלום מלא" על כל הסכום (לא "מקדמה")
  await expect(page.getByRole("combobox", { name: /^מה נרשם/ })).toHaveValue("full");
  await expect(page.getByLabel("סכום (₪)")).toHaveValue("1500");
  // האמצעי — בלי ברירת מחדל: עד שבוחרים, אי אפשר לרשום
  const method = page.getByRole("combobox", { name: /^אמצעי/ });
  await expect(method).toHaveValue("");
  const record = page.getByRole("button", { name: "רישום", exact: true });
  await expect(record).toBeDisabled();
  await method.selectOption("card");
  await expect(record).toBeEnabled();
  await record.click();
  await expect
    .poll(() =>
      sql(
        `SELECT string_agg(kind || '|' || method || '|' || amount, ',') FROM hospitality.payments WHERE booking_id = '${id}'`,
      ),
    )
    .toBe("full|card|1500.00");
  await expect(page.getByText("יתרה לתשלום")).toBeVisible();

  // האורח, בקישור האישי מהמייל: מאושרת ושולמה
  const link = await guestLink(request, GUEST);
  const guest = await page.context().browser()!.newPage();
  await guest.goto(URL_(link));
  await expect(guest.getByRole("heading", { level: 1, name: /הזמנה #\d+/ })).toBeVisible();
  await expect(guest.getByText("מאושרת").first()).toBeVisible();
  await expect(guest.locator("main")).toContainText(/תשלום\s*שולם/);
  await guest.close();
});
