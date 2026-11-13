import { createHash, randomBytes } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { hostGet, hostOf, PORT, STORE_A, USERS } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  loadSession,
  saveSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// מיגרציה 188 — הגבולות של מנהל/ת עסק, על השרת הבנוי:
//   • Super Admin נכנס/ת לעסק מהפלטפורמה, רואה את מתג «מנהל/ת עסק» וממנה;
//   • מנהל/ת עסק רואה את אותו תפריט כמו הבעלים, וכל מסך נפתח בלי חסימת הרשאה;
//   • מנהל/ת עסק מבצע/ת פעולות עסקיות בשרת (לוח בקרה, צוות, יומן, מסמכי לקוחות, הגדרה) — אבל
//     לא רואה חבילות / מנוי;
//   • בעסק אחר — כלום; פעולות פלטפורמה (Super Admin) — כלום; ניהול החנות (Ecommerce) — כלום.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "bas188.owner@e2e.test", password: "Bas188-Owner-Pass-1!" };
const BA = { email: "bas188.admin@e2e.test", password: "Bas188-Admin-Pass-1!" };
const OWNER_C = { email: "bas188.owner.c@e2e.test", password: "Bas188-OwnerC-Pass-1!" };
const TEAM = "src/engines/hospitality/api/team.functions.ts";
const SLUG_A = "bas188-a";
const SLUG_C = "bas188-c";
const PLATFORM_HOST = "platform.shop.localhost";
const URL_ = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
let siteA = "";
let siteC = "";
const sessions: Record<"owner" | "ba" | "platform", SavedSession | null> = {
  owner: null,
  ba: null,
  platform: null,
};
const uid = (email: string) => sql(`SELECT id FROM auth.users WHERE email = '${email}'`);
const fn = (
  request: Parameters<typeof callServerFn>[0],
  host: string,
  file: string,
  name: string,
  token: string,
  data?: unknown,
  method: "GET" | "POST" = "POST",
) => callServerFn(request, { host, file, name, data, token, method });

/** Super Admin enters the business the way the platform panel does it: a one-time platform_admin code */
async function platformSession(
  browser: Browser,
  slug: string,
  site: string,
): Promise<SavedSession> {
  const code = randomBytes(32).toString("base64url");
  sql(`INSERT INTO public.platform_admin_handoffs (token_hash, user_id, tenant_id, expires_at, kind)
       VALUES ('${createHash("sha256").update(code).digest("hex")}', '${uid(USERS.platform.email)}', '${site}',
               now() + interval '2 minutes', 'platform_admin')`);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${URL_(slug)}/admin-handoff#code=${code}`);
  await expect(page).not.toHaveURL(/admin-handoff/, { timeout: 20_000 });
  await page.goto(URL_(slug, "/manage"));
  await expect(page.getByRole("navigation", { name: "ניווט ראשי" })).toBeVisible({
    timeout: 20_000,
  });
  const state = await ctx.storageState();
  await ctx.close();
  const origin = new URL(URL_(slug)).origin;
  return { origin, items: state.origins.find((o) => o.origin === origin)?.localStorage ?? [] };
}

function cleanup() {
  for (const slug of [SLUG_A, SLUG_C]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}
function openSite(slug: string, name: string): string {
  asPlatform(`SELECT hospitality.admin_create_site('${slug}', '${name}')`);
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true),
       ('${id}', 'hospitality_contracts_enabled', true)`);
  return id;
}
function addRole(site: string, email: string, name: string) {
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name)
       SELECT '${site}', id, email, 'bas188_' || replace(split_part(email, '@', 1), '.', '_'), 'admin', true, '${name}'
         FROM auth.users WHERE email = '${email}'`);
}

test.beforeAll(async ({ request, browser }, testInfo) => {
  if (testInfo.project.name === "mobile") return;
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled', 'hospitality_contracts_enabled')`);
  for (const u of [OWNER, BA, OWNER_C]) await ensureUser(request, u);
  siteA = openSite(SLUG_A, "אחוזת הגפן");
  siteC = openSite(SLUG_C, "בקתות התבור");
  addRole(siteA, OWNER.email, "בעלת העסק"); // the first admin of a new site is the protected owner
  addRole(siteA, BA.email, "שירה");
  addRole(siteC, OWNER_C.email, "בעלים ג");
  await expect
    .poll(async () => (await hostGet(request, hostOf(SLUG_A), "/manage/team")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  sessions.owner = await saveSession(browser, URL_(SLUG_A), siteA, OWNER.email);
  sessions.ba = await saveSession(browser, URL_(SLUG_A), siteA, BA.email);
  sessions.platform = await platformSession(browser, SLUG_A, siteA);
});

test.afterAll(() => {
  if (test.info().project.name === "mobile") return;
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("Super Admin: enters the business from the platform, sees the switch and appoints the business admin", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.platform!, "/manage/team");
  const row = page.getByRole("list", { name: "חברי הצוות" }).locator(`[data-member="${BA.email}"]`);
  const sw = row.getByRole("switch", { name: /מנהל\/ת עסק/ });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(page.getByText("שירה מנהל/ת עסק מעכשיו")).toBeVisible();
  expect(
    sql(`SELECT count(*) FROM hospitality.staff_grants WHERE tenant_id = '${siteA}'
          AND user_id = '${uid(BA.email)}' AND permission = 'business.admin'`),
  ).toBe("1");
  // the platform admin's action is in the business log
  expect(
    sql(`SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '${siteA}'
          AND action = 'team.business_admin_granted' AND actor_role = 'platform'`),
  ).toBe("1");
});

test("the business admin has the owner's whole menu, and every screen opens without a permission block", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  test.setTimeout(180_000);
  const menu = async (session: SavedSession) => {
    await loadSession(page, session, "/manage");
    const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
    await expect(nav.getByRole("link").first()).toBeVisible();
    return nav
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
  };
  const ownerMenu = await menu(sessions.owner!);
  const baMenu = await menu(sessions.ba!);
  expect(baMenu).toEqual(ownerMenu);
  expect(baMenu).toContain("/manage/team");
  expect(baMenu).toContain("/manage/client-documents");
  expect(baMenu.length).toBeGreaterThanOrEqual(20);
  for (const path of baMenu) {
    await page.goto(URL_(SLUG_A, path));
    await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByText(/אין הרשאה|אין לך הרשאה|זמין לבעל העסק|זמין לבעלים בלבד/),
      path,
    ).toHaveCount(0);
  }
});

test("the business admin works the business on the server; no plans or subscription", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const host = hostOf(SLUG_A);
  const token = await accessToken(request, BA);
  const ownerToken = await accessToken(request, OWNER);
  const reads: [string, string, unknown?][] = [
    ["src/engines/hospitality/api/dashboard.functions.ts", "hospitalityDashboardToday"],
    ["src/engines/hospitality/api/dashboard.functions.ts", "hospitalityDashboardTasks"],
    ["src/engines/hospitality/api/contracts.functions.ts", "hospitalityContractsView"],
    [TEAM, "hospitalityTeam"],
    [TEAM, "hospitalityTeamActivity"],
  ];
  for (const [file, name] of reads) {
    const res = await fn(request, host, file, name, token, undefined, "GET");
    const text = await res.text();
    expect(res.status(), `${name}: ${text.slice(0, 200)}`).toBe(200);
    expect(text, name).not.toContain("אין הרשאה");
  }
  // a real change (settings), logged under the business admin
  const set = await fn(
    request,
    host,
    "src/engines/hospitality/api/settings.functions.ts",
    "hospitalitySetShabbat",
    token,
    { on: true },
  );
  expect(set.status(), await set.text()).toBe(200);
  expect(
    sql(`SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '${siteA}'
          AND actor_id = '${uid(BA.email)}' AND action = 'settings.shabbat_on'`),
  ).toBe("1");
  // plans / subscription: the owner gets the options, the business admin gets none
  const plans = (t: string) =>
    fn(
      request,
      host,
      "src/engines/hospitality/api/dashboard.functions.ts",
      "hospitalityPlans",
      t,
      undefined,
      "GET",
    );
  expect(await (await plans(ownerToken)).text()).toContain("basic");
  expect(await (await plans(token)).text()).not.toContain("basic");
});

test("the business admin gets nothing in another business, on the platform or in a store", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const token = await accessToken(request, BA);
  // business C (no role there): every management function is refused
  for (const [file, name] of [
    [TEAM, "hospitalityTeam"],
    [TEAM, "hospitalityTeamActivity"],
    ["src/engines/hospitality/api/dashboard.functions.ts", "hospitalityDashboardToday"],
    ["src/engines/hospitality/api/contracts.functions.ts", "hospitalityContractsView"],
  ] as const) {
    const res = await fn(request, hostOf(SLUG_C), file, name, token, undefined, "GET");
    const text = await res.text();
    // server functions return a refusal as a serialized error; no data of business C
    expect(text, `${name}: ${text.slice(0, 300)}`).toMatch(/הרשאה|אינו|לא מורשה/);
    expect(text, name).not.toContain(OWNER_C.email);
    expect(text, name).not.toContain("בקתות התבור");
  }
  const removeC = await fn(request, hostOf(SLUG_C), TEAM, "hospitalityRemoveManager", token, {
    userId: uid(OWNER_C.email),
  });
  expect(await removeC.text()).toMatch(/הרשאה|אינו|לא מורשה/);
  expect(
    sql(`SELECT count(*) FROM public.user_roles WHERE tenant_id = '${siteC}' AND role = 'admin'`),
  ).toBe("1");

  // the platform (Super Admin) functions: refused, nothing changes
  const PLATFORM = "src/engines/hospitality/api/platform-admin.functions.ts";
  const view = await fn(
    request,
    PLATFORM_HOST,
    PLATFORM,
    "hospitalityPlatformView",
    token,
    undefined,
    "GET",
  );
  const viewText = await view.text();
  expect(viewText, viewText.slice(0, 300)).toMatch(/מנהל הפלטפורמה|הרשאה|מנהל-על/);
  expect(viewText).not.toContain(SLUG_C);
  for (const [name, data] of [
    ["hospitalityPlatformSetFlag", { key: "booking", enabled: false, siteId: siteC }],
    ["hospitalityPlatformSetOwner", { siteId: siteC, email: BA.email }],
    ["hospitalityPlatformSiteRequests", undefined],
  ] as const) {
    const res = await fn(
      request,
      PLATFORM_HOST,
      PLATFORM,
      name,
      token,
      data,
      data === undefined ? "GET" : "POST",
    );
    const text = await res.text();
    expect(text, `${name}: ${text.slice(0, 300)}`).toMatch(/מנהל הפלטפורמה|הרשאה|מנהל-על/);
  }
  expect(
    sql(
      `SELECT count(*) FROM public.user_roles WHERE tenant_id = '${siteC}' AND user_id = '${uid(BA.email)}'`,
    ),
  ).toBe("0");
  expect(sql(`SELECT public.is_platform_admin('${uid(BA.email)}')`)).toBe("f");

  // the store (Ecommerce) admin: not staff there
  const store = await fn(
    request,
    hostOf(STORE_A.slug),
    "src/lib/admin.functions.ts",
    "createStaffUser",
    token,
    { email: "bas188.never@e2e.test", role: "warehouse", displayName: "לא", passwordMode: "link" },
  );
  // refused already by the sign-in middleware (the account is not of this store), or by the role check
  expect(await store.text()).toMatch(/אין הרשאה|Unauthorized: account belongs to another store/);
  expect(sql(`SELECT count(*) FROM auth.users WHERE email = 'bas188.never@e2e.test'`)).toBe("0");
});
