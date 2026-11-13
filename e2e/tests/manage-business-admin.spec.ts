import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PORT, supabaseEnv } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  saveSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// מיגרציה 188 — מנהל/ת עסק (Business Admin) בצימר, על השרת הבנוי:
//   • רק בעל העסק ממנה / מבטל (מתג «מנהל/ת עסק» — רק אצלו), ביומן;
//   • מנהל/ת עסק: רואה את הצוות (אימייל, כניסה אחרונה) ואת יומן הפעילות, מוסיף/ה ומסיר/ה מנהלים
//     רגילים, קובע/ת להם נתונים כספיים ומסמכים; בלי מתג מינוי, בלי כרטיס החבילה (מנוי / תשלום);
//   • לא מסיר/ה את הבעלים או מנהל/ת עסק אחר/ת — גם לא בקריאה ישירה לשרת או ל-user_roles;
//   • אותו אדם בעסק אחר — מנהל/ת רגיל/ה שם; חשבון שני שלו — הרשאות רגילות; הביטול חל מיד.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "ba188.owner@e2e.test", password: "Ba188-Owner-Pass-1!" };
const BA = { email: "ba188.admin@e2e.test", password: "Ba188-Admin-Pass-1!" };
const BA2 = { email: "ba188.admin2@e2e.test", password: "Ba188-Admin2-Pass-1!" };
const M2 = { email: "ba188.manager@e2e.test", password: "Ba188-Manager-Pass-1!" };
// אותו אדם, חשבון שני (מייל אחר) — מנהל/ת רגיל/ה באותו עסק
const BA_ALT = { email: "ba188.admin.alt@e2e.test", password: "Ba188-Alt-Pass-1!" };
const NEW_EMAIL = `ba188.new.${Date.now()}@e2e.test`;
const FN_FILE = "src/engines/hospitality/api/team.functions.ts";
let SLUG = "ba188-a";
let SLUG_B = "ba188-b";
let siteId = "";
let siteB = "";
const host = (slug: string) => hostOf(slug);
const URL_ = (slug: string, path = "") => `http://${host(slug)}:${PORT}${path}`;
const sessions: Record<"owner" | "ba" | "baInB", SavedSession | null> = {
  owner: null,
  ba: null,
  baInB: null,
};
const uid = (email: string) => sql(`SELECT id FROM auth.users WHERE email = '${email}'`);
const grants = (tenant: string, email: string) =>
  sql(`SELECT coalesce(string_agg(permission, ',' ORDER BY permission), '') FROM hospitality.staff_grants
        WHERE tenant_id = '${tenant}' AND user_id = '${uid(email)}'`);

function cleanup() {
  for (const slug of [SLUG, SLUG_B]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

const teamFn = (
  request: Parameters<typeof callServerFn>[0],
  slug: string,
  name: string,
  token?: string,
  data?: unknown,
  method: "GET" | "POST" = "POST",
) => callServerFn(request, { host: host(slug), file: FN_FILE, name, data, token, method });

function addRole(site: string, email: string, label: string) {
  // username: Latin letters only (user_roles_username_check) — from the email
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name)
       SELECT '${site}', id, email, 'ba188_' || replace(split_part(email, '@', 1), '.', '_') || '_' || substr(md5('${site}'), 1, 6), 'admin', true, '${label}'
         FROM auth.users WHERE email = '${email}'`);
}

function openSite(slug: string, name: string): string {
  asPlatform(`SELECT hospitality.admin_create_site('${slug}', '${name}')`);
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
  asPlatform(`SELECT hospitality.admin_set_extra_managers('${id}', 4)`);
  return id;
}

test.beforeAll(async ({ request, browser }, testInfo) => {
  const m = testInfo.project.name === "mobile" ? "-m" : "";
  SLUG = `ba188-a${m}`;
  SLUG_B = `ba188-b${m}`;
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  for (const u of [OWNER, BA, BA2, M2, BA_ALT]) await ensureUser(request, u);
  siteId = openSite(SLUG, "חוות הגליל");
  siteB = openSite(SLUG_B, "בקתות הכרמל");
  // the owner row is the protected one (the first admin of a new site)
  addRole(siteId, OWNER.email, "בעלת העסק");
  sql(`UPDATE public.user_roles SET is_protected = true
        WHERE tenant_id = '${siteId}' AND user_id = '${uid(OWNER.email)}'`);
  addRole(siteId, BA.email, "דנה");
  addRole(siteId, BA2.email, "רון");
  addRole(siteId, M2.email, "מיכל");
  addRole(siteId, BA_ALT.email, "דנה חשבון שני");
  // business B: another owner; the same person (BA) is a regular manager there
  addRole(siteB, M2.email, "בעלים ב");
  sql(`UPDATE public.user_roles SET is_protected = true
        WHERE tenant_id = '${siteB}' AND user_id = '${uid(M2.email)}'`);
  addRole(siteB, BA.email, "דנה");
  await expect
    .poll(async () => (await hostGet(request, host(SLUG), "/manage/team")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  if (testInfo.project.name === "mobile") return;
  sessions.owner = await saveSession(browser, URL_(SLUG), siteId, OWNER.email);
  sessions.ba = await saveSession(browser, URL_(SLUG), siteId, BA.email);
  sessions.baInB = await saveSession(browser, URL_(SLUG_B), siteB, BA.email);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("before the appointment: a regular manager has no team screen, and only the owner sees the switch", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.ba!, "/manage/team");
  await expect(page.getByRole("status")).toContainText("המסך הזה זמין לבעל העסק ולמנהלי עסק בלבד");
  const res = await teamFn(
    request,
    SLUG,
    "hospitalityTeamSetBusinessAdmin",
    await accessToken(request, BA),
    { userId: uid(BA.email), enabled: true },
  );
  expect(await res.text()).toContain("אין הרשאה");
  expect(grants(siteId, BA.email)).toBe("");
});

test("the owner appoints a business admin: badge, all-access chips, the activity entry", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.owner!, "/manage/team");
  const list = page.getByRole("list", { name: "חברי הצוות" });
  const row = list.locator(`[data-member="${BA.email}"]`);
  // the owner row has no switch; each manager row has one, off
  await expect(list.locator(`[data-member="${OWNER.email}"] [data-business-admin]`)).toHaveCount(0);
  const sw = row.getByRole("switch", { name: /מנהל\/ת עסק/ });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(page.getByText("דנה מנהל/ת עסק מעכשיו")).toBeVisible();
  await expect(sw).toBeChecked();
  await expect(row).toContainText("מנהל/ת עסק");
  await expect(row).toContainText("נתונים כספיים — תמיד");
  await expect(row).toContainText("מסמכי לקוחות — תמיד");
  // BA2 too (for the "another business admin" checks)
  await list
    .locator(`[data-member="${BA2.email}"]`)
    .getByRole("switch", { name: /מנהל\/ת עסק/ })
    .click();
  await expect(page.getByText("רון מנהל/ת עסק מעכשיו")).toBeVisible();
  expect(grants(siteId, BA.email)).toBe("business.admin");
  expect(grants(siteId, BA2.email)).toBe("business.admin");
  // the grant is only in business A
  expect(grants(siteB, BA.email)).toBe("");
  await page.reload();
  await expect(page.getByRole("list", { name: "פעילות אחרונה" })).toContainText("למנהל/ת עסק");
  await expectAccessible(page, "team (owner, business admin switch)");
});

test("the business admin: team with emails and last sign-in, activity, no appointment switch, no plan card", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.ba!, "/manage");
  await expect(page.getByText("מנהל/ת עסק", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("החבילה שלי")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "ניווט ראשי" }).getByText("צוות ניהול"),
  ).toBeVisible();
  await page.goto(URL_(SLUG, "/manage/team"));
  const list = page.getByRole("list", { name: "חברי הצוות" });
  for (const u of [OWNER, BA, BA2, M2]) {
    await expect(list.locator(`[data-member="${u.email}"]`)).toContainText(u.email);
  }
  await expect(list.locator(`[data-member="${BA.email}"]`)).toContainText("כניסה אחרונה");
  await expect(list.locator("[data-business-admin]")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "פעילות אחרונה" })).toContainText("למנהל/ת עסק");
  // remove: only on regular managers — not on the owner, not on another business admin
  await expect(list.locator(`[data-member="${OWNER.email}"]`).getByRole("button")).toHaveCount(0);
  await expect(
    list.locator(`[data-member="${BA2.email}"]`).getByRole("button", { name: /הסרה/ }),
  ).toHaveCount(0);
  await expect(
    list.locator(`[data-member="${M2.email}"]`).getByRole("button", { name: /הסרה/ }),
  ).toBeVisible();
  await expectAccessible(page, "team (business admin)");
});

test("the business admin manages regular managers: finance switch, add a manager, remove one", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.ba!, "/manage/team");
  const list = page.getByRole("list", { name: "חברי הצוות" });
  await list.locator(`[data-finance="${M2.email}"]`).getByRole("switch").click();
  await expect.poll(() => grants(siteId, M2.email)).toBe("reports.finance");

  await page.getByRole("button", { name: "הוספת מנהל" }).click();
  const sheet = page.getByRole("dialog", { name: "הוספת מנהל" });
  await sheet.getByLabel("אימייל של המנהל").fill(NEW_EMAIL);
  await sheet.getByLabel("שם (לא חובה)").fill("נועה החדשה");
  await sheet.getByRole("button", { name: "הוספה לצוות" }).click();
  const done = page.getByRole("dialog", { name: "המנהל נוסף" });
  await expect(done.getByRole("status")).toContainText("נועה החדשה נוסף/ה לצוות הניהול");
  await done.getByRole("button", { name: "סיום" }).click();
  // a regular manager: no grants of their own
  expect(grants(siteId, NEW_EMAIL)).toBe("");
  expect(
    sql(`SELECT action FROM hospitality.audit_log WHERE tenant_id = '${siteId}'
          AND action = 'team.manager_added' AND actor_id = '${uid(BA.email)}'`),
  ).toBe("team.manager_added");

  await list.locator(`[data-member="${NEW_EMAIL}"]`).getByRole("button", { name: /הסרה/ }).click();
  await page.getByRole("button", { name: "הסרה מהצוות" }).click();
  await expect(list.locator(`[data-member="${NEW_EMAIL}"]`)).toHaveCount(0);
  expect(
    sql(`SELECT count(*) FROM public.user_roles WHERE tenant_id = '${siteId}'
          AND user_id = '${uid(NEW_EMAIL)}'`),
  ).toBe("0");
});

test("the business admin is refused directly: appoint, remove the owner or another business admin, user_roles writes", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const token = await accessToken(request, BA);
  for (const [name, data, expected] of [
    ["hospitalityTeamSetBusinessAdmin", { userId: uid(M2.email), enabled: true }, "אין הרשאה"],
    ["hospitalityTeamSetBusinessAdmin", { userId: uid(BA2.email), enabled: false }, "אין הרשאה"],
    ["hospitalityRemoveManager", { userId: uid(OWNER.email) }, "אי אפשר להסיר את בעל העסק"],
    ["hospitalityRemoveManager", { userId: uid(BA2.email) }, "רק בעל העסק יכול להסיר מנהל/ת עסק"],
    ["hospitalityTeamSetFinance", { userId: uid(BA2.email), enabled: false }, "כבר את כל ההרשאות"],
  ] as const) {
    const res = await teamFn(request, SLUG, name, token, data);
    expect(await res.text(), `${name} ${JSON.stringify(data)}`).toContain(expected);
  }
  expect(grants(siteId, M2.email)).toBe("reports.finance");
  expect(grants(siteId, BA2.email)).toBe("business.admin");

  // PostgREST directly on user_roles: the guards in the DB refuse a business admin too
  const { url, anonKey } = supabaseEnv();
  const headers = {
    apikey: anonKey,
    authorization: `Bearer ${token}`,
    "x-tenant-id": siteId,
    "content-type": "application/json",
    prefer: "return=representation",
  };
  const del = await request.delete(
    `${url}/rest/v1/user_roles?tenant_id=eq.${siteId}&user_id=eq.${uid(M2.email)}`,
    { headers },
  );
  expect(await del.text()).toContain("רק בעל החנות יכול להסיר מנהל");
  const ins = await request.post(`${url}/rest/v1/user_roles`, {
    headers,
    data: { tenant_id: siteId, user_id: uid(NEW_EMAIL), email: NEW_EMAIL, role: "admin" },
  });
  expect(ins.status()).toBeGreaterThanOrEqual(400);
  const patch = await request.patch(
    `${url}/rest/v1/user_roles?tenant_id=eq.${siteId}&user_id=eq.${uid(OWNER.email)}`,
    { headers, data: { display_name: "שונה" } },
  );
  expect(await patch.text()).toContain("רק בעל העסק");
  expect(
    sql(`SELECT count(*) FROM public.user_roles WHERE tenant_id = '${siteId}' AND role = 'admin'`),
  ).toBe("5");
});

test("the same person in business B is a regular manager there; their second account has regular permissions", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const token = await accessToken(request, BA);
  // business B, by host: regular manager
  for (const [name, method] of [
    ["hospitalityTeam", "GET"],
    ["hospitalityTeamActivity", "GET"],
  ] as const) {
    const res = await teamFn(request, SLUG_B, name, token, undefined, method);
    expect(await res.text(), name).toContain("אין הרשאה");
  }
  const add = await teamFn(request, SLUG_B, "hospitalityAddManager", token, {
    email: "ba188.never@e2e.test",
  });
  expect(await add.text()).toContain("אין הרשאה");
  expect(sql(`SELECT count(*) FROM auth.users WHERE email = 'ba188.never@e2e.test'`)).toBe("0");
  await loadSession(page, sessions.baInB!, "/manage");
  await expect(
    page.getByRole("navigation", { name: "ניווט ראשי" }).getByText("צוות ניהול"),
  ).toHaveCount(0);
  await expect(page.getByText("מנהל/ת", { exact: true }).first()).toBeVisible();

  // the second account of the same person, in business A: no team access
  const alt = await accessToken(request, BA_ALT);
  const res = await teamFn(request, SLUG, "hospitalityTeam", alt, undefined, "GET");
  expect(await res.text()).toContain("אין הרשאה");
});

test("revoking takes effect at the next request; the owner can remove a business admin, the grant goes with them", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.owner!, "/manage/team");
  const list = page.getByRole("list", { name: "חברי הצוות" });
  await list
    .locator(`[data-member="${BA.email}"]`)
    .getByRole("switch", { name: /מנהל\/ת עסק/ })
    .click();
  await expect(page.getByText("דנה חזר/ה להיות מנהל/ת רגיל/ה")).toBeVisible();
  expect(grants(siteId, BA.email)).toBe("");
  const res = await teamFn(
    request,
    SLUG,
    "hospitalityTeam",
    await accessToken(request, BA),
    undefined,
    "GET",
  );
  expect(await res.text()).toContain("אין הרשאה");

  // the owner removes BA2 (a business admin): the row and the grant are gone
  await list.locator(`[data-member="${BA2.email}"]`).getByRole("button", { name: /הסרה/ }).click();
  await page.getByRole("button", { name: "הסרה מהצוות" }).click();
  await expect(list.locator(`[data-member="${BA2.email}"]`)).toHaveCount(0);
  expect(grants(siteId, BA2.email)).toBe("");
  expect(
    sql(`SELECT string_agg(action, ',' ORDER BY id) FROM hospitality.audit_log
          WHERE tenant_id = '${siteId}' AND action LIKE 'team.business_admin_%'`),
  ).toBe("team.business_admin_granted,team.business_admin_granted,team.business_admin_revoked");
});
