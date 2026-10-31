import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PORT, STORE_A, STORE_B, supabaseEnv, USERS } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  emailsTo,
  ensureUser,
  expectAccessible,
  loadSession,
  saveSession,
  signInWithEmailCode,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// Hospitality Stage 2b.3 — צוות הניהול (/manage/team) על השרת הבנוי:
//   • הוספת מנהל — חשבון חדש (נפתח בלי סיסמה) וחשבון קיים (גם בעלים של חנות);
//   • כניסה אמיתית של המנהל החדש בקוד למייל; אין מייל הזמנה;
//   • הסרה — הגישה נחסמת בבקשה הבאה; הגישה לחנות נשארת;
//   • מגבלת המקומות — בממשק, בשרת ובמקביל;
//   • מנהל: אין מסך צוות, ופעולות צוות / שינוי משתמש אחר נחסמות גם בקריאות ישירות;
//   • פעילות אחרונה — לבעלים בלבד; טלפון; נגישות; הפרדה מ-Ecommerce.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h2b3.owner@e2e.test", password: "H2b3-Owner-Pass-1!" };
const MANAGER = { email: "h2b3.manager@e2e.test", password: "H2b3-Manager-Pass-1!" };
const EXTRA1 = { email: "h2b3.extra1@e2e.test", password: "H2b3-Extra1-Pass-1!" };
const EXTRA2 = { email: "h2b3.extra2@e2e.test", password: "H2b3-Extra2-Pass-1!" };
const PHONE_ADD = { email: "h2b3.phone@e2e.test", password: "H2b3-Phone-Pass-1!" };
// חשבון חדש לגמרי בכל הרצה (נפתח ע"י המערכת, בלי סיסמה)
const NEW_EMAIL = `h2b3.new.${Date.now()}@e2e.test`;
const FN_FILE = "src/engines/hospitality/api/team.functions.ts";
const STORE = hostOf(STORE_A.slug);
let SLUG = "h2b-team";
let HOST = hostOf(SLUG);
const URL_ = (path = "") => `http://${HOST}:${PORT}${path}`;
let siteId = "";
let storeHash = "";
const sessions: Record<"owner" | "manager", SavedSession | null> = { owner: null, manager: null };
// the session the NEW manager opened with the real email code (kept open for the removal test —
// a second code request within 30 seconds is refused by the existing resend cooldown)
let newManagerSession: SavedSession | null = null;

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);
const adminsHere = () =>
  Number(
    sql(`SELECT count(*) FROM public.user_roles WHERE tenant_id = '${siteId}' AND role = 'admin'`),
  );

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

/** פונקציית צוות כמו מהדפדפן */
const teamFn = (
  request: Parameters<typeof callServerFn>[0],
  name: string,
  token?: string,
  data?: unknown,
  method: "GET" | "POST" = "POST",
) => callServerFn(request, { host: HOST, file: FN_FILE, name, data, token, method });

/** Ecommerce: פונקציה של מנהל חנות (store_admin_seats) בשם המשתמש, באתר החנות */
async function storeAdminAccess(
  request: Parameters<typeof callServerFn>[0],
  token: string,
  storeId: string,
) {
  const { url, anonKey } = supabaseEnv();
  const res = await request.post(`${url}/rest/v1/rpc/store_admin_seats`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, "x-tenant-id": storeId },
    data: {},
  });
  return res.status();
}

test.beforeAll(async ({ request, browser }, testInfo) => {
  SLUG = testInfo.project.name === "mobile" ? "h2b-team-m" : "h2b-team";
  HOST = hostOf(SLUG);
  cleanup();
  storeHash = storeDataHash();
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'בקתות בכנרת')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  for (const u of [OWNER, MANAGER, EXTRA1, EXTRA2, PHONE_ADD]) await ensureUser(request, u);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       SELECT '${siteId}', id, email, 'h2b3_' || split_part(email, '@', 1) || '_' || ${SLUG.length}, 'admin', true
         FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name)
       SELECT '${siteId}', id, email, 'h2b3_mgr_' || ${SLUG.length}, 'admin', true, 'מנהלת קיימת'
         FROM auth.users WHERE email = '${MANAGER.email}'`);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteId}', 'hospitality_backend_enabled', true), ('${siteId}', 'hospitality_management_enabled', true)`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/team")).status(), { timeout: 20_000 })
    .toBe(200);
  sessions.owner = await saveSession(browser, URL_(), siteId, OWNER.email);
  if (testInfo.project.name !== "mobile")
    sessions.manager = await saveSession(browser, URL_(), siteId, MANAGER.email);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("owner: the team, seats and the add button; accessible", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.owner!, "/manage/team");
  await expect(page.getByRole("heading", { name: "צוות ניהול", level: 1 })).toBeVisible();
  await expect(page.getByText("2 מתוך 3 מקומות בשימוש")).toBeVisible();
  const list = page.getByRole("list", { name: "חברי הצוות" });
  await expect(list.locator(`[data-member="${OWNER.email}"]`)).toContainText("בעלים");
  await expect(list.locator(`[data-member="${MANAGER.email}"]`)).toContainText("מנהלת קיימת");
  // the owner has no remove button
  await expect(list.locator(`[data-member="${OWNER.email}"]`).getByRole("button")).toHaveCount(0);
  await expectAccessible(page, "team (owner)");
});

test("add a NEW account: created without a password, no invitation email, and it really signs in with an email code", async ({
  page,
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const since = Date.now();
  await loadSession(page, sessions.owner!, "/manage/team");
  await page.getByRole("button", { name: "הוספת מנהל" }).click();
  const sheet = page.getByRole("dialog", { name: "הוספת מנהל" });
  await expectAccessible(page, "add-manager sheet");
  await sheet.getByLabel("אימייל של המנהל").fill(NEW_EMAIL.toUpperCase());
  await sheet.getByLabel("שם (לא חובה)").fill("יואב החדש");
  await sheet.getByRole("button", { name: "הוספה לצוות" }).click();
  const done = page.getByRole("dialog", { name: "המנהל נוסף" });
  await expect(done.getByRole("status")).toContainText("יואב החדש נוסף/ה לצוות הניהול");
  await expect(done).toContainText(`${URL_()}/manage`);
  await expect(done.getByRole("link", { name: "שליחה ב-WhatsApp" })).toHaveAttribute(
    "href",
    /^https:\/\/wa\.me\/\?text=/,
  );
  await expectAccessible(page, "manager-added panel");
  await done.getByRole("button", { name: "סיום" }).click();
  await expect(page.getByText("3 מתוך 3 מקומות בשימוש")).toBeVisible();

  // the account: confirmed email, a manager row here and nothing else
  expect(
    sql(`SELECT (email_confirmed_at IS NOT NULL) || '|' ||
                (SELECT string_agg(ur.role || '@' || t.slug, ',') FROM public.user_roles ur JOIN public.tenants t ON t.id = ur.tenant_id
                  WHERE ur.user_id = u.id)
           FROM auth.users u WHERE email = '${NEW_EMAIL}'`),
  ).toBe(`true|admin@${SLUG}`);
  // no password was set by anyone (GoTrue keeps a random one nobody knows): password sign-in fails
  const { url, anonKey } = supabaseEnv();
  for (const password of ["", "123456", NEW_EMAIL]) {
    const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
      headers: { apikey: anonKey },
      data: { email: NEW_EMAIL, password },
    });
    expect(res.status(), `password "${password}"`).toBeGreaterThanOrEqual(400);
  }
  // no invitation email was sent (2k)
  expect(await emailsTo(request, NEW_EMAIL, since)).toBe(0);

  // real sign-in of the new manager: email code, no password
  const ctx = await browser.newContext();
  const newPage = await ctx.newPage();
  await signInWithEmailCode(newPage, request, URL_(), NEW_EMAIL);
  await expect(newPage.getByText("מנהל/ת", { exact: true })).toBeVisible();
  await expect(
    newPage.getByRole("navigation", { name: "ניווט ראשי" }).getByText("צוות ניהול"),
  ).toHaveCount(0);
  expect(await emailsTo(request, NEW_EMAIL, since)).toBe(1); // only the code they asked for
  const origin = new URL(URL_()).origin;
  const state = await ctx.storageState();
  newManagerSession = {
    origin,
    items: state.origins.find((o) => o.origin === origin)?.localStorage ?? [],
  };
  await ctx.close();
});

test("seat limit: the button is disabled at the limit, and the server refuses too", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.owner!, "/manage/team");
  await expect(page.getByRole("button", { name: "הוספת מנהל" })).toBeDisabled();
  await expect(page.getByText("הגעתם למגבלת המנהלים בחבילה")).toBeVisible();
  const res = await teamFn(request, "hospitalityAddManager", await accessToken(request, OWNER), {
    email: EXTRA1.email,
  });
  expect(await res.text()).toContain("מגבלת המנהלים בחבילה (3)");
  expect(adminsHere()).toBe(3);
});

test("add an EXISTING account that owns an Ecommerce store: signs in here with a code, keeps the store", async ({
  page,
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  asPlatform(`SELECT hospitality.admin_set_extra_managers('${siteId}', 1)`);
  const storeB = STORE_B.id;
  const ownerBToken = await accessToken(request, USERS.ownerB);
  expect(await storeAdminAccess(request, ownerBToken, storeB)).toBe(200);
  const storeRowBefore = sql(
    `SELECT ur::text FROM public.user_roles ur WHERE tenant_id = '${storeB}' AND user_id = '${USERS.ownerB.id}'`,
  );

  await loadSession(page, sessions.owner!, "/manage/team");
  await page.getByRole("button", { name: "הוספת מנהל" }).click();
  const sheet = page.getByRole("dialog", { name: "הוספת מנהל" });
  await sheet.getByLabel("אימייל של המנהל").fill(USERS.ownerB.email);
  await sheet.getByRole("button", { name: "הוספה לצוות" }).click();
  await expect(page.getByRole("dialog", { name: "המנהל נוסף" }).getByRole("status")).toContainText(
    "נוסף/ה לצוות",
  );
  // no new account was created for an existing one
  expect(sql(`SELECT count(*) FROM auth.users WHERE lower(email) = '${USERS.ownerB.email}'`)).toBe(
    "1",
  );

  // real email-code sign-in on the Hospitality site
  const ctx = await browser.newContext();
  const dual = await ctx.newPage();
  await signInWithEmailCode(dual, request, URL_(), USERS.ownerB.email);
  await expect(dual.getByText("מנהל/ת", { exact: true })).toBeVisible();

  // the store: same row, same admin access
  expect(
    sql(
      `SELECT ur::text FROM public.user_roles ur WHERE tenant_id = '${storeB}' AND user_id = '${USERS.ownerB.id}'`,
    ),
  ).toBe(storeRowBefore);
  expect(await storeAdminAccess(request, ownerBToken, storeB)).toBe(200);

  // remove: the next request on the Hospitality site is refused; the store is untouched
  await page.getByRole("button", { name: "סיום" }).click();
  await page
    .getByRole("list", { name: "חברי הצוות" })
    .locator(`[data-member="${USERS.ownerB.email}"]`)
    .getByRole("button", { name: /^הסרה של/ })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expectAccessible(page, "remove dialog");
  await confirm.getByRole("button", { name: "הסרה מהצוות" }).click();
  await expect(page.getByText("הוסר/ה מהצוות")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "חברי הצוות" }).locator(`[data-member="${USERS.ownerB.email}"]`),
  ).toHaveCount(0);

  await dual.reload();
  await expect(dual.getByRole("heading", { name: "אין גישה לניהול העסק הזה" })).toBeVisible();
  const ctxRes = await callServerFn(request, {
    host: HOST,
    file: "src/engines/hospitality/api/management.functions.ts",
    name: "hospitalityManagementContext",
    method: "GET",
    token: await accessToken(request, USERS.ownerB),
  });
  expect(await ctxRes.text()).toContain('"forbidden"');
  expect(
    sql(
      `SELECT ur::text FROM public.user_roles ur WHERE tenant_id = '${storeB}' AND user_id = '${USERS.ownerB.id}'`,
    ),
  ).toBe(storeRowBefore);
  expect(await storeAdminAccess(request, ownerBToken, storeB)).toBe(200);
  await ctx.close();
});

test("removing a manager ends an open session at the next request", async ({
  page,
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // the session the new manager opened with the email code is still open
  const ctx = await browser.newContext();
  const newPage = await ctx.newPage();
  await loadSession(newPage, newManagerSession!, "/manage");
  await expect(newPage.getByText("מנהל/ת", { exact: true })).toBeVisible();
  const userId = sql(`SELECT id FROM auth.users WHERE email = '${NEW_EMAIL}'`);
  const res = await teamFn(request, "hospitalityRemoveManager", await accessToken(request, OWNER), {
    userId,
  });
  expect(res.status()).toBe(200);
  await newPage.reload();
  await expect(newPage.getByRole("heading", { name: "אין גישה לניהול העסק הזה" })).toBeVisible();
  expect(sql(`SELECT count(*) FROM public.user_roles WHERE user_id = '${userId}'`)).toBe("0");
  await ctx.close();
  await loadSession(page, sessions.owner!, "/manage/team");
  await expect(page.getByRole("list", { name: "פעילות אחרונה" })).toContainText(
    "הסיר/ה את יואב החדש",
  );
});

test("seats in parallel: two additions for the last seat → one; the same person twice → one row", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  // now: owner + manager = 2, limit 3 + 1 extra = 4 → two seats left; take one so one is left
  asPlatform(`SELECT hospitality.admin_set_extra_managers('${siteId}', 1)`);
  const token = await accessToken(request, OWNER);
  expect(
    (await teamFn(request, "hospitalityAddManager", token, { email: PHONE_ADD.email })).status(),
  ).toBe(200);
  expect(adminsHere()).toBe(3);
  const [a, b] = await Promise.all([
    teamFn(request, "hospitalityAddManager", token, { email: EXTRA1.email }),
    teamFn(request, "hospitalityAddManager", token, { email: EXTRA2.email }),
  ]);
  const bodies = [await a.text(), await b.text()];
  expect(bodies.filter((t) => t.includes('"added"')).length).toBe(1);
  expect(bodies.filter((t) => t.includes("מגבלת המנהלים")).length).toBe(1);
  expect(adminsHere()).toBe(4);
  // the same person twice in parallel (a seat is free again after removing one)
  const extraIn =
    sql(`SELECT u.email FROM public.user_roles ur JOIN auth.users u ON u.id = ur.user_id
                        WHERE ur.tenant_id = '${siteId}' AND u.email IN ('${EXTRA1.email}', '${EXTRA2.email}')`);
  const userId = sql(`SELECT id FROM auth.users WHERE email = '${extraIn}'`);
  await teamFn(request, "hospitalityRemoveManager", token, { userId });
  const [c, d] = await Promise.all([
    teamFn(request, "hospitalityAddManager", token, { email: extraIn }),
    teamFn(request, "hospitalityAddManager", token, { email: extraIn }),
  ]);
  const both = [await c.text(), await d.text()];
  expect(
    both.every((t) => t.includes('"added"') || t.includes('"already_member"')),
    both.join(" || "),
  ).toBe(true);
  expect(
    sql(
      `SELECT count(*) FROM public.user_roles WHERE tenant_id = '${siteId}' AND user_id = '${userId}'`,
    ),
  ).toBe("1");
});

test("a manager: no team screen, and every team action or change to another user is refused — also directly", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.manager!, "/manage");
  await expect(
    page.getByRole("navigation", { name: "ניווט ראשי" }).getByText("צוות ניהול"),
  ).toHaveCount(0);
  await page.goto(URL_("/manage/team"));
  await expect(page.getByRole("status")).toContainText("המסך הזה זמין לבעל העסק בלבד");
  await expect(page.getByText("2 מתוך")).toHaveCount(0);
  await expectAccessible(page, "team (manager)");

  const token = await accessToken(request, MANAGER);
  for (const [name, data, method] of [
    ["hospitalityTeam", undefined, "GET"],
    ["hospitalityTeamActivity", undefined, "GET"],
    ["hospitalityAddManager", { email: "someone@e2e.test" }, "POST"],
    [
      "hospitalityRemoveManager",
      { userId: sql(`SELECT id FROM auth.users WHERE email = '${PHONE_ADD.email}'`) },
      "POST",
    ],
  ] as const) {
    const res = await teamFn(request, name, token, data, method);
    expect(await res.text(), name).toContain("אין הרשאה");
  }
  expect(sql(`SELECT count(*) FROM auth.users WHERE email = 'someone@e2e.test'`)).toBe("0");

  // PostgREST directly on user_roles (the existing store policies apply to this site too)
  const { url, anonKey } = supabaseEnv();
  const headers = {
    apikey: anonKey,
    authorization: `Bearer ${token}`,
    "x-tenant-id": siteId,
    "content-type": "application/json",
    prefer: "return=representation",
  };
  const otherId = sql(`SELECT id FROM auth.users WHERE email = '${PHONE_ADD.email}'`);
  const myId = sql(`SELECT id FROM auth.users WHERE email = '${MANAGER.email}'`);
  sql(
    `UPDATE public.user_roles SET is_blocked = true WHERE tenant_id = '${siteId}' AND user_id = '${otherId}'`,
  );
  const patch = (userId: string, body: object) =>
    request.patch(`${url}/rest/v1/user_roles?tenant_id=eq.${siteId}&user_id=eq.${userId}`, {
      headers,
      data: body,
    });
  for (const body of [{ is_blocked: false }, { display_name: "שונה" }, { email: "x@evil.test" }]) {
    const res = await patch(otherId, body);
    expect(res.status(), JSON.stringify(body)).toBeGreaterThanOrEqual(400);
    expect(await res.text()).toContain("רק בעל העסק");
  }
  const ownEmail = await patch(myId, { email: "me2@e2e.test" });
  expect(await ownEmail.text()).toContain("אפשר לשנות רק את שם המשתמש ואת שם התצוגה שלך");
  const ownName = await patch(myId, { display_name: "מנהלת מעודכנת" });
  expect(ownName.status()).toBe(200);
  const insert = await request.post(`${url}/rest/v1/user_roles`, {
    headers,
    data: {
      tenant_id: siteId,
      user_id: sql(`SELECT id FROM auth.users WHERE email = '${EXTRA2.email}'`),
      email: EXTRA2.email,
      role: "admin",
    },
  });
  expect(insert.status()).toBeGreaterThanOrEqual(400);
  const del = await request.delete(
    `${url}/rest/v1/user_roles?tenant_id=eq.${siteId}&user_id=eq.${otherId}`,
    { headers },
  );
  expect(await del.text()).toContain("רק בעל החנות יכול להסיר מנהל");
  expect(
    sql(`SELECT is_blocked || '|' || coalesce(display_name, '-') || '|' || email FROM public.user_roles
          WHERE tenant_id = '${siteId}' AND user_id = '${otherId}'`),
  ).toBe(`true|-|${PHONE_ADD.email}`);
});

test("activity: the owner sees team and settings changes; nobody else", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.owner!, "/manage/team");
  const list = page.getByRole("list", { name: "פעילות אחרונה" });
  await expect(list).toContainText("הוסיף/ה את יואב החדש לצוות הניהול");
  await expect(list).toContainText("הסיר/ה את");
  expect(await list.textContent()).not.toContain(NEW_EMAIL); // masked emails only
  const res = await teamFn(
    request,
    "hospitalityTeamActivity",
    await accessToken(request, USERS.ownerA),
    undefined,
    "GET",
  );
  expect(await res.text()).not.toContain("team.manager_added");
});

test("@mobile phone: list, add sheet from the bottom, accessible, no sideways scroll", async ({
  page,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone layout — runs in the mobile project");
  await loadSession(page, sessions.owner!, "/manage/team");
  const viewport = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expectAccessible(page, "team (phone)");
  await page.getByRole("button", { name: "הוספת מנהל" }).click();
  const sheet = page.getByRole("dialog", { name: "הוספת מנהל" });
  const box = (await sheet.boundingBox())!;
  expect(box.y + box.height).toBeGreaterThanOrEqual(viewport.height - 2); // opens from the bottom
  await sheet.getByLabel("אימייל של המנהל").fill(PHONE_ADD.email);
  await sheet.getByRole("button", { name: "הוספה לצוות" }).click();
  await expect(page.getByRole("dialog", { name: "המנהל נוסף" }).getByRole("status")).toContainText(
    "נוסף/ה לצוות",
  );
  await expectAccessible(page, "manager-added (phone)");
});

test("Ecommerce untouched: no team page or functions on a store; store data unchanged", async ({
  request,
}) => {
  const page404 = await hostGet(request, STORE, "/manage/team");
  expect(page404.status()).toBe(404);
  const fn = await callServerFn(request, {
    host: STORE,
    file: FN_FILE,
    name: "hospitalityTeam",
    method: "GET",
  });
  expect(fn.status()).toBe(404);
  expect(storeDataHash()).toBe(storeHash);
});

test("closing the management flag closes the team page and functions", async ({ request }) => {
  sql(`UPDATE public.tenant_feature_flags SET enabled = false
        WHERE tenant_id = '${siteId}' AND key = 'hospitality_management_enabled'`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/team")).status(), { timeout: 20_000 })
    .toBe(404);
  const res = await teamFn(
    request,
    "hospitalityTeam",
    await accessToken(request, OWNER),
    undefined,
    "GET",
  );
  expect(await res.text()).toContain("אזור הניהול אינו פעיל");
});
