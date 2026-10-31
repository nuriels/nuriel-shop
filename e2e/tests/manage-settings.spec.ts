import { expect, test, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT, STORE_A, supabaseEnv } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  saveSession,
  sql,
  loadSession,
  type SavedSession,
} from "./hospitality-helpers";

// Hospitality Stage 2b.2 — מסך הגדרות העסק (/manage/settings) על השרת הבנוי:
//   • בעלים: חמישה אזורים, כולל נמעני ההתראות ושמירת פרטי אורחים; מנהל: רק שלושה;
//   • ההרשאה נאכפת בשרת ובמסד — קריאות ישירות של מנהל (פונקציית שרת, PostgREST) נחסמות;
//   • הודעות שגיאה בעברית ליד השדה ומהשרת; שמירה רק כשאין שגיאות;
//   • "עודכן בינתיים": מיזוג בלי לדרוס שינוי של משתמש אחר;
//   • יציאה עם שינויים שלא נשמרו — שאלה; טלפון: פס שמירה מעל הניווט; נגישות (axe);
//   • חנויות: /manage/settings לא קיים, פונקציות ההגדרות לא רצות, נתוני החנויות לא השתנו.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h2b.owner@e2e.test", password: "H2b-Owner-Pass-1!" };
const MANAGER = { email: "h2b.manager@e2e.test", password: "H2b-Manager-Pass-1!" };
const FN_FILE = "src/engines/hospitality/api/settings.functions.ts";
const STORE = hostOf(STORE_A.slug);
let SLUG = "h2b-settings";
let HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
let siteId = "";
// כניסה אחת לכל תפקיד (מגבלת ה-handoff לכתובת IP), והחיבור נטען לכל בדיקה
const sessions: Record<"owner" | "manager", SavedSession | null> = { owner: null, manager: null };
let storeHash = "";

// נתוני החנויות בלבד (גם site_settings / email_settings — רק של אתרי Ecommerce: כל אתר
// חדש, גם אתר אירוח, מקבל שורות משותפות משלו — platform_seed_tenant_shared, שלב 1a)
const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(e::text, ',' ORDER BY e::text) FROM public.email_settings e
            JOIN public.tenants t ON t.id = e.tenant_id WHERE t.site_type = 'ecommerce')))`);

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

const settingsRow = (cols: string) =>
  sql(`SELECT ${cols} FROM hospitality.settings WHERE tenant_id = '${siteId}'`);

async function openSettings(page: Page, email: string) {
  await loadSession(
    page,
    email === OWNER.email ? sessions.owner! : sessions.manager!,
    "/manage/settings",
  );
  await expect(page.getByRole("heading", { name: "הגדרות העסק", level: 1 })).toBeVisible();
}

test.beforeAll(async ({ request, browser }, testInfo) => {
  SLUG = testInfo.project.name === "mobile" ? "h2b-settings-m" : "h2b-settings";
  HOST = hostOf(SLUG);
  cleanup();
  storeHash = storeDataHash();
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'צימרים בגולן')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  const ownerId = await ensureUser(request, OWNER);
  const managerId = await ensureUser(request, MANAGER);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
       ('${siteId}', '${ownerId}', '${OWNER.email}', 'h2b_owner_${SLUG.length}', 'admin', true)`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved) VALUES
       ('${siteId}', '${managerId}', '${MANAGER.email}', 'h2b_manager_${SLUG.length}', 'admin', true)`);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteId}', 'hospitality_backend_enabled', true), ('${siteId}', 'hospitality_management_enabled', true)`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/settings")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  sessions.owner = await saveSession(browser, URL_(""), siteId, OWNER.email);
  if (testInfo.project.name !== "mobile")
    sessions.manager = await saveSession(browser, URL_(""), siteId, MANAGER.email);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("owner: all five sections; every kind of field is saved, kept after reload and recorded", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openSettings(page, OWNER.email);
  for (const name of [
    "פרטי העסק",
    "שעות הגעה ועזיבה",
    "כללי הזמנה",
    "מי מקבל את המיילים על הזמנות",
    "שמירת פרטי אורחים",
  ])
    await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: "שמירה" })).toBeDisabled();
  await expectAccessible(page, "settings (owner)");

  await page.getByLabel("שם העסק").fill("צימרי הגולן");
  await page.getByLabel("טלפון העסק").fill("050-7654321");
  await page.getByLabel("מספר WhatsApp").fill("052-1112233");
  await page.getByLabel("כתובת העסק").fill("רחוב הגפן 3, קצרין");
  await page.getByLabel("שעת הגעה").fill("14:00");
  await page.getByLabel("זמן לאישור בקשה").selectOption({ label: "יממה" });
  await page.getByLabel("בקשות פתוחות לאורח").selectOption({ label: "3 בקשות" });
  await page.getByText("ליל שבת").click();
  await page.getByRole("button", { name: "הוספת כתובת" }).click();
  await page.getByLabel("נמעני ההתראות — כתובת 1").fill("Desk@Golan.Test");
  await page.getByLabel("שמירת פרטי אורחים").selectOption({ label: "שנתיים" });
  await expect(page.getByText("יש שינויים שלא נשמרו")).toBeVisible();
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("ההגדרות נשמרו")).toBeVisible();
  await expect(page.getByText("אין שינויים")).toBeVisible();

  expect(
    settingsRow(`business_name || '|' || contact_phone || '|' || whatsapp_phone || '|' || address || '|' ||
                 to_char(check_in_time, 'HH24:MI') || '|' || approval_window_minutes || '|' || max_open_requests || '|' ||
                 weekend_nights::text || '|' || notification_emails::text || '|' || guest_retention_months || '|' || revision`),
  ).toBe(
    "צימרי הגולן|050-7654321|052-1112233|רחוב הגפן 3, קצרין|14:00|1440|3|{4,5,6}|{desk@golan.test}|24|2",
  );
  expect(
    sql(`SELECT actor_role || '|' || (SELECT count(*) FROM jsonb_object_keys(changes)) || '|' || (changes::text LIKE '%desk@golan.test%')
           FROM hospitality.audit_log WHERE tenant_id = '${siteId}' ORDER BY id DESC LIMIT 1`),
  ).toBe("owner|10|false");

  await page.reload();
  await expect(page.getByLabel("שם העסק")).toHaveValue("צימרי הגולן");
  await expect(page.getByLabel("נמעני ההתראות — כתובת 1")).toHaveValue("desk@golan.test");
  await expect(page.getByLabel("שמירת פרטי אורחים")).toHaveText(/שנתיים/);

  // the dashboard checklist follows (business details done) and its link leads here
  await page.goto(URL_("/manage"));
  await expect(page.getByText("1 מתוך 5 צעדים הושלמו")).toBeVisible();
});

test("manager: only the three sections he may edit; owner-only fields are not in the page", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openSettings(page, MANAGER.email);
  await expect(page.getByRole("heading", { name: "פרטי העסק", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "כללי הזמנה", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "מי מקבל את המיילים על הזמנות" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "שמירת פרטי אורחים" })).toHaveCount(0);
  await expect(
    page.locator('[name="notification_emails"], [name="guest_retention_months"]'),
  ).toHaveCount(0);
  expect(await page.content()).not.toContain("desk@golan.test");
  await expectAccessible(page, "settings (manager)");

  await page.getByLabel("שעת עזיבה").fill("10:30");
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("ההגדרות נשמרו")).toBeVisible();
  expect(
    settingsRow("to_char(check_out_time, 'HH24:MI') || '|' || notification_emails::text"),
  ).toBe("10:30|{desk@golan.test}");
});

test("server and database enforce it: a manager's direct calls are refused", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const managerToken = await accessToken(request, MANAGER);
  const ownerToken = await accessToken(request, OWNER);
  const revision = Number(settingsRow("revision"));
  const update = (data: unknown, token?: string) =>
    callServerFn(request, {
      host: HOST,
      file: FN_FILE,
      name: "hospitalityUpdateSettings",
      data,
      token,
    });

  // the server function: owner-only and locked fields refused for the manager
  const owners = await update(
    { changes: { notification_emails: ["me@evil.test"] }, revision },
    managerToken,
  );
  expect(await owners.text()).toContain("רק בעל העסק יכול לשנות את נמעני ההתראות");
  const retention = await update(
    { changes: { guest_retention_months: 6 }, revision },
    managerToken,
  );
  expect(await retention.text()).toContain("רק בעל העסק יכול לשנות את שמירת פרטי אורחים");
  const locked = await update({ changes: { booking_mode: "instant" }, revision }, ownerToken);
  expect(await locked.text()).toContain("נעול");
  const anonymous = await update({ changes: { address: "x" }, revision });
  expect(await anonymous.text()).not.toContain('"saved"');

  // PostgREST directly: no write on the settings table for anyone on the staff
  const { url, anonKey } = supabaseEnv();
  for (const token of [managerToken, ownerToken]) {
    const res = await request.patch(`${url}/rest/v1/settings?tenant_id=eq.${siteId}`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        "x-tenant-id": siteId,
        "content-profile": "hospitality",
        "content-type": "application/json",
      },
      data: { notification_emails: ["me@evil.test"] },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(await res.text()).toContain("permission denied");
  }
  expect(settingsRow("notification_emails::text || '|' || revision")).toBe(
    `{desk@golan.test}|${revision}`,
  );

  // server-side validation with Hebrew messages (not only in the browser)
  const invalid = await update({ changes: { contact_email: "nope" }, revision }, ownerToken);
  expect(await invalid.text()).toContain("כתובת האימייל של העסק לא תקינה");
});

test("validation: Hebrew messages next to the field; save is disabled until fixed", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openSettings(page, OWNER.email);
  await page.getByLabel("טלפון העסק").fill("abc");
  await page.getByLabel("שם העסק").fill("");
  await expect(page.getByText("טלפון העסק — מספר הטלפון לא תקין")).toBeVisible();
  await expect(page.getByText("יש למלא את שם העסק")).toBeVisible();
  await expect(page.getByLabel("טלפון העסק")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("יש שדות לתיקון")).toBeVisible();
  await expect(page.getByRole("button", { name: "שמירה" })).toBeDisabled();
  await expectAccessible(page, "settings with errors");
  await page.getByRole("button", { name: "ביטול" }).click();
  await expect(page.getByLabel("שם העסק")).toHaveValue("צימרי הגולן");
});

test("conflict: another user saved in between — merged, nobody's change is overwritten", async ({
  browser,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const ownerCtx = await browser.newContext();
  const managerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const manager = await managerCtx.newPage();
  await openSettings(owner, OWNER.email);
  await openSettings(manager, MANAGER.email);

  // the manager saves first
  await manager.getByLabel("שם העסק").fill("שם של המנהל");
  await manager.getByRole("button", { name: "שמירה" }).click();
  await expect(manager.getByText("ההגדרות נשמרו")).toBeVisible();

  // the owner, on the old version, changed the same field and another one
  await owner.getByLabel("שם העסק").fill("שם של הבעלים");
  await owner.getByLabel("כתובת העסק").fill("כתובת של הבעלים");
  await owner.getByRole("button", { name: "שמירה" }).click();
  const notice = owner.getByRole("status").filter({ hasText: "עודכנו בינתיים" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("השינוי שלך בשם העסק לא נשמר");
  await expect(owner.getByLabel("שם העסק")).toHaveValue("שם של המנהל");
  await expect(owner.getByLabel("כתובת העסק")).toHaveValue("כתובת של הבעלים");
  expect(settingsRow("business_name || '|' || address")).toBe("שם של המנהל|רחוב הגפן 3, קצרין");

  // saving again stores only the owner's surviving change
  await owner.getByRole("button", { name: "שמירה" }).click();
  await expect(owner.getByText("ההגדרות נשמרו")).toBeVisible();
  expect(settingsRow("business_name || '|' || address")).toBe("שם של המנהל|כתובת של הבעלים");
  await ownerCtx.close();
  await managerCtx.close();
});

test("leaving with unsaved changes asks first", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openSettings(page, OWNER.email);
  await page.getByLabel("כתובת העסק").fill("כתובת שלא נשמרה");
  await page
    .getByRole("navigation", { name: "ניווט ראשי" })
    .getByRole("link", { name: "לוח בקרה" })
    .click();
  const dialog = page.getByRole("alertdialog", { name: "לצאת בלי לשמור?" });
  await expect(dialog).toBeVisible();
  await expectAccessible(page, "unsaved-changes dialog");
  await dialog.getByRole("button", { name: "להישאר ולשמור" }).click();
  await expect(page).toHaveURL(/\/manage\/settings$/);
  await expect(page.getByLabel("כתובת העסק")).toHaveValue("כתובת שלא נשמרה");
  await page
    .getByRole("navigation", { name: "ניווט ראשי" })
    .getByRole("link", { name: "לוח בקרה" })
    .click();
  await page.getByRole("alertdialog").getByRole("button", { name: "לצאת בלי לשמור" }).click();
  await expect(page).toHaveURL(/\/manage$/);
  expect(settingsRow("address")).toBe("כתובת של הבעלים");
});

test("@mobile phone: one column, save bar above the bottom navigation, saves, accessible", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone layout — runs in the mobile project");
  await openSettings(page, OWNER.email);
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectAccessible(page, "settings (phone)");

  await page.getByLabel("כתובת העסק").fill("רחוב הזית 1");
  const save = page.getByRole("button", { name: "שמירה" });
  await expect(save).toBeEnabled();
  const saveBox = (await save.boundingBox())!;
  const navBox = (await page.getByRole("navigation", { name: "ניווט ראשי" }).boundingBox())!;
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(navBox.y);
  expect(saveBox.height).toBeGreaterThanOrEqual(44);
  await save.click();
  await expect(page.getByText("ההגדרות נשמרו")).toBeVisible();
  expect(settingsRow("address")).toBe("רחוב הזית 1");
  // "more" on the phone leads to settings
  await page.goto(URL_("/manage"));
  await page.getByRole("button", { name: "עוד מסכים" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "הגדרות העסק" }).click();
  await expect(page).toHaveURL(/\/manage\/settings$/);
});

test("Ecommerce untouched: no settings page or functions on a store; store data unchanged", async ({
  request,
}) => {
  const page404 = await hostGet(request, STORE, "/manage/settings");
  expect(page404.status()).toBe(404);
  expect(await page404.text()).not.toContain("הגדרות העסק");
  const fn = await callServerFn(request, {
    host: STORE,
    file: FN_FILE,
    name: "hospitalitySettings",
    method: "GET",
  });
  expect(fn.status()).toBe(404);
  expect((await hostGet(request, STORE, "/")).status()).toBe(200);
  expect(storeDataHash()).toBe(storeHash);
});

test("closing the management flag closes the settings page and functions", async ({ request }) => {
  sql(`UPDATE public.tenant_feature_flags SET enabled = false
        WHERE tenant_id = '${siteId}' AND key = 'hospitality_management_enabled'`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/settings")).status(), {
      timeout: 20_000,
    })
    .toBe(404);
  const res = await callServerFn(request, {
    host: HOST,
    file: FN_FILE,
    name: "hospitalitySettings",
    method: "GET",
    token: await accessToken(request, OWNER),
  });
  expect(await res.text()).toContain("אזור הניהול אינו פעיל");
});
