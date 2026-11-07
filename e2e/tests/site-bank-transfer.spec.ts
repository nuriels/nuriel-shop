import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PORT, supabaseEnv } from "./helpers";
import {
  asPlatform,
  callServerFn,
  ensureUser,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// שלב א' 5 — העברה בנקאית, מקצה לקצה:
//   • כלל 7 הימים ב-API: הגעה בעוד 6 ימים — אין העברה; 7 — יש (השרת מחליט, לא הדפדפן);
//   • אורח מזמין לחודש הבא ובוחר "העברה בנקאית" — נשמר בהזמנה;
//   • בעל העסק מאשר; האורח רואה "ממתין לאישור העברה" ואת פרטי החשבון, מעלה צילום מסך — קובץ HTML
//     שהתחפש לתמונה נדחה; האישור נשאר אחרי רענון (המצב בשרת); הקובץ בדלי פרטי — אין גישה ישירה;
//   • בלוח הבקרה "אישור העברה לבדיקה" מוביל להזמנה; בעל העסק צופה בקובץ (קישור חתום), דוחה עם סיבה —
//     האורח רואה את הסיבה ומעלה שוב — בעל העסק מאשר בסכום: תשלום "העברה" ביומן, והאורח רואה ששולם.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "bt.owner@e2e.test", password: "Bt-Owner-Pass-1!" };
const SLUG = "bt-site";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const GUEST = "bt.guest@e2e.test";
const FN_FILE = "src/engines/hospitality/api/website.functions.ts";
let siteId = "";
let owner: SavedSession | null = null;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;
// PNG תקין של פיקסל אחד — "צילום המסך" של אישור ההעברה
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
/** התאריך אצל העסק (אסיה/ירושלים) בעוד n ימים — כמו שהמסד סופר */
const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Jerusalem",
  });

async function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (!id) return;
  // הקבצים שהועלו — דרך ה-API של האחסון (מחיקה ישירה מהטבלאות חסומה), לפני מחיקת העסק
  const paths = sql(
    `SELECT name FROM storage.objects WHERE bucket_id = 'hosp-payment-proofs' AND name LIKE '${id}/%'`,
  )
    .split("\n")
    .filter(Boolean);
  if (paths.length) {
    const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
    const res = await fetch(`${supabaseEnv().url}/storage/v1/object/hosp-payment-proofs`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
    expect(res.ok, await res.text()).toBe(true);
  }
  asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

const bookingOf = (cols: string) =>
  sql(`SELECT ${cols} FROM hospitality.bookings b JOIN hospitality.guests g ON g.id = b.guest_id
        WHERE b.tenant_id = '${siteId}' AND g.email = '${GUEST}' ORDER BY b.created_at DESC LIMIT 1`);

/** הקישור האישי מהמייל הראשון לאורח (שירות המייל המדומה) — בלי הדומיין */
async function guestLink(request: import("@playwright/test").APIRequestContext): Promise<string> {
  let link = "";
  await expect
    .poll(
      async () => {
        const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
          url: string;
          body: string;
        }[];
        const mail = calls
          .filter(
            (c) =>
              c.url.startsWith("/emails") &&
              c.body.includes(GUEST) &&
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

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the transfer flow runs once, on the computer");
  await cleanup();
  sql(`DELETE FROM hospitality.rate_buckets`);
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'צימרי ההעברה', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'bt_owner', 'admin', true)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'צימרי ההעברה', 'bt-p', 'active') RETURNING id`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'צימר הזית', 'bt-u1', 4, 2, 750)`);
  // העסק מקבל העברות בנקאיות (וגם תשלום בטלפון — ברירת המחדל)
  sql(`INSERT INTO hospitality.payment_settings (tenant_id, bank_enabled, bank_name, bank_branch, bank_account, bank_holder)
       VALUES ('${siteId}', true, 'בנק לאומי', '800', '765432', 'דורית כהן')`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
  owner = await passwordSession(request, URL_(""), OWNER);
});

test.afterAll(async () => {
  await cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("the 7-day rule is decided by the server: 6 days ahead — no bank transfer; 7 days — offered", async ({
  request,
}) => {
  const methods = async (checkIn: string) => {
    const res = await callServerFn(request, {
      host: HOST,
      file: FN_FILE,
      name: "hospitalitySitePaymentMethods",
      data: { checkIn },
      method: "GET",
    });
    expect(res.ok(), await res.text()).toBe(true);
    return res.text();
  };
  expect(await methods(day(6))).not.toContain('"bank"');
  expect(await methods(day(7))).toContain('"bank"');
});

test("a guest books for next month and chooses bank transfer — saved with the booking", async ({
  page,
}) => {
  await page.goto(URL_("/stay/book"));
  await page.getByRole("button", { name: "החודש הבא" }).first().click();
  await page.getByRole("button", { name: "10 — פנוי" }).first().click();
  await page.getByRole("button", { name: "12 — פנוי" }).first().click();
  await page.getByRole("button", { name: "המשך לפרטים" }).click();
  await page.getByLabel("שם מלא").fill("דנה אורחת");
  await page.getByLabel("טלפון נייד").fill("0527654321");
  await page.getByLabel("אימייל").first().fill(GUEST);
  const how = page.getByRole("group", { name: "איך תרצו לשלם?" });
  await expect(how).toBeVisible();
  await how.getByRole("radio", { name: "העברה בנקאית" }).check();
  await expect(page.getByTestId("pay-bank-hint")).toBeVisible();
  await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
  await page.getByRole("button", { name: "שליחת בקשת הזמנה" }).click();
  await expect(page).toHaveURL(/\/stay\/booking-received/, { timeout: 20_000 });
  await expect
    .poll(() => bookingOf("b.status || '|' || b.payment_method"))
    .toBe("pending_approval|bank");
});

test("approved: the guest sees 'waiting for the transfer' and the account; a disguised file is refused; the proof stays after a refresh; the file is private", async ({
  page,
  request,
}) => {
  const id = bookingOf("b.id");
  await loadSession(page, owner!, `/manage/bookings/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: /הזמנה #\d+/ })).toBeVisible();
  await page.getByRole("button", { name: "אישור ההזמנה" }).click();
  await page
    .getByRole("alertdialog")
    .or(page.getByRole("dialog"))
    .getByRole("button", { name: "אישור", exact: true })
    .click();
  await expect.poll(() => bookingOf("b.status")).toBe("confirmed");
  await expect(page.getByTestId("staff-no-proofs")).toBeVisible();

  const guest = await page.context().browser()!.newPage();
  await guest.goto(URL_(await guestLink(request)));
  await expect(guest.getByRole("heading", { level: 1, name: /הזמנה #\d+/ })).toBeVisible();
  await expect(guest.locator("main")).toContainText("ממתין לאישור העברה");
  await expect(guest.locator("main")).toContainText("765432");
  const card = guest.getByTestId("guest-transfer");
  await expect(card.getByRole("heading", { name: "אישור העברה בנקאית" })).toBeVisible();

  // HTML שנקרא "proof.png" — נבדק לפי התוכן, נדחה, ולא נשמר
  await card.getByLabel("קובץ האישור").setInputFiles({
    name: "proof.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html><script>alert(1)</script></html>"),
  });
  await card.getByRole("button", { name: "העלאת האישור" }).click();
  await expect(card.getByRole("alert")).toContainText("הקובץ לא נתמך");
  expect(sql(`SELECT count(*) FROM hospitality.payment_proofs WHERE booking_id = '${id}'`)).toBe(
    "0",
  );

  await card.getByLabel("קובץ האישור").setInputFiles({
    name: "אישור העברה.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  await card.getByRole("button", { name: "העלאת האישור" }).click();
  await expect(card.getByTestId("transfer-uploaded")).toBeVisible({ timeout: 15_000 });
  await expect(card.getByTestId("transfer-proofs")).toContainText("התקבל — ממתין לבדיקת המתחם");
  await expect(guest.locator("main")).toContainText("אישור ההעברה התקבל");

  // רענון / חזרה מאוחרת — אותו מצב, מהשרת
  await guest.reload();
  await expect(guest.getByTestId("transfer-proofs")).toContainText("התקבל — ממתין לבדיקת המתחם");

  // הקובץ בדלי הפרטי: אין כתובת ציבורית, ומפתח האורחים (anon) לא קורא אותו
  const path = sql(
    `SELECT storage_path FROM hospitality.payment_proofs WHERE booking_id = '${id}' AND status = 'submitted'`,
  );
  expect(path).toMatch(new RegExp(`^${siteId}/${id}/[0-9a-f-]{36}$`));
  expect(
    sql(
      `SELECT count(*) FROM storage.objects WHERE bucket_id = 'hosp-payment-proofs' AND name = '${path}'`,
    ),
  ).toBe("1");
  const { url, anonKey } = supabaseEnv();
  const pub = await request.get(`${url}/storage/v1/object/public/hosp-payment-proofs/${path}`);
  expect(pub.ok()).toBe(false);
  const anon = await request.get(`${url}/storage/v1/object/hosp-payment-proofs/${path}`, {
    headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
  });
  expect(anon.ok()).toBe(false);
  await guest.close();
});

test("the owner: from the dashboard to the proof, views it, rejects with a reason; the guest uploads again; approved — a transfer payment in the ledger, the guest sees paid", async ({
  page,
  request,
}) => {
  const id = bookingOf("b.id");
  await loadSession(page, owner!, "/manage");
  const task = page.locator('[data-task="proofs"]');
  await expect(task).toContainText("אישור העברה לבדיקה");
  await task.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/manage/bookings/${id}#transfer-proofs$`));
  const proofs = page.getByTestId("staff-proofs");
  await expect(proofs.getByTestId("staff-proof-status")).toHaveText(["ממתין לבדיקה"]);

  // צפייה: קישור חתום וקצר לדלי הפרטי, בלשונית חדשה
  const popup = page.waitForEvent("popup");
  await proofs.getByRole("button", { name: "צפייה בקובץ" }).click();
  const view = await popup;
  await expect.poll(() => view.url()).toContain("/storage/v1/object/sign/hosp-payment-proofs/");
  const file = await request.get(view.url());
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("image/png");
  await view.close();

  await proofs.getByRole("button", { name: "דחייה" }).click();
  await page.getByLabel(/למה האישור נדחה/).fill("הסכום בצילום לא ברור");
  await page.getByRole("button", { name: "דחיית האישור" }).click();
  await expect(proofs.getByTestId("staff-proof-status")).toHaveText(["נדחה"]);

  const guest = await page.context().browser()!.newPage();
  await guest.goto(URL_(await guestLink(request)));
  const card = guest.getByTestId("guest-transfer");
  await expect(card.getByTestId("transfer-proofs")).toContainText("סיבה: הסכום בצילום לא ברור");
  await expect(card.getByTestId("transfer-proofs")).toContainText("אפשר להעלות אישור חדש");
  await card.getByLabel("קובץ האישור").setInputFiles({
    name: "אישור ברור.png",
    mimeType: "image/png",
    buffer: PIXEL,
  });
  await card.getByRole("button", { name: "העלאת האישור" }).click();
  await expect(card.getByTestId("transfer-uploaded")).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(proofs.getByTestId("staff-proof-status")).toHaveText(["ממתין לבדיקה", "נדחה"]);
  await proofs.getByRole("button", { name: "ההעברה התקבלה" }).click();
  // ברירת המחדל — מה שנשאר לתשלום (2 לילות × 750)
  await expect(page.getByLabel("הסכום שהתקבל (₪)")).toHaveValue("1500");
  await page.getByRole("button", { name: "אישור ורישום התשלום" }).click();
  await expect(proofs.getByTestId("staff-proof-status")).toHaveText(["אושר — נרשם תשלום", "נדחה"]);
  await expect
    .poll(() =>
      sql(
        `SELECT string_agg(kind || '|' || method || '|' || amount, ',') FROM hospitality.payments WHERE booking_id = '${id}'`,
      ),
    )
    .toBe("full|transfer|1500.00");
  expect(bookingOf("b.payment_status")).toBe("paid");

  await guest.reload();
  await expect(guest.getByTestId("transfer-proofs")).toContainText("אושר — התשלום התקבל");
  await expect(guest.locator("main")).toContainText(/תשלום\s*שולם/);
  await guest.close();
});
