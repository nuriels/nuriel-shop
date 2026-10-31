import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { toJSONAsync } from "seroval";
import { AUTH, hostGet, hostOf, PORT, STORE_A, supabaseEnv, USERS } from "./helpers";

// Hospitality Stage 2a — אזור הניהול של בעל העסק (/manage) על השרת הבנוי:
//   • נפתח רק באתר אירוח עם הדגלים (מסד + ניהול), בלי לפתוח את האתר הציבורי;
//   • כניסה: ה-handoff הקיים מהשער, סיסמה, קוד במייל — בלי Google;
//   • בעלים / מנהל / חשבון בלי הרשאה — הרשאה בשרת ובמסד, לא רק בממשק;
//   • עברית RTL, מותאם לטלפון, בדיקות נגישות (axe);
//   • החנויות (Ecommerce) לא השתנו: /admin, דף הבית, ו-/manage אינו קיים בחנות.

test.describe.configure({ mode: "serial" });

// כתובת אחרת לכל פרויקט (מחשב / טלפון): השרת שומר את האתר של כל כתובת במטמון,
// ובין הפרויקטים האתר נמחק ונוצר מחדש
let SLUG = "h2a-manage";
let HOSP = hostOf(SLUG);
const HURL = (path = "/") => `http://${HOSP}:${PORT}${path}`;
const OWNER = { email: "h2a.owner@e2e.test", password: "H2a-Owner-Pass-1!" };
const MANAGER = { email: "h2a.manager@e2e.test", password: "H2a-Manager-Pass-1!" };
const FLAGS = ["hospitality_backend_enabled", "hospitality_management_enabled"] as const;
let siteId = "";

function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();
}
const asPlatform = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub',
      (SELECT id FROM auth.users WHERE email = '${USERS.platform.email}'), 'role', 'authenticated')::text, false);
    ${query}`);

/** חשבון עם סיסמה (GoTrue admin API של Supabase המקומי) */
async function ensureUser(request: APIRequestContext, user: { email: string; password: string }) {
  const existing = sql(`SELECT id FROM auth.users WHERE email = '${user.email}'`);
  if (existing) return existing;
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const res = await request.post(`${supabaseEnv().url}/auth/v1/admin/users`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    data: { email: user.email, password: user.password, email_confirm: true },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

async function accessToken(request: APIRequestContext, user: { email: string; password: string }) {
  const { url, anonKey } = supabaseEnv();
  const res = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: user.email, password: user.password },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return ((await res.json()) as { access_token: string }).access_token;
}

const fnId = (file: string, name: string) =>
  createHash("sha256").update(`${file}--${name}_createServerFn_handler`).digest("hex");
const CONTEXT_FN = fnId(
  "src/engines/hospitality/api/management.functions.ts",
  "hospitalityManagementContext",
);

/** קריאה לפונקציית ההקשר כמו מהדפדפן (same-origin), עם טוקן או בלי */
async function callContext(request: APIRequestContext, host: string, token?: string) {
  const payload = JSON.stringify(await toJSONAsync({ data: undefined }));
  return request.get(
    `http://127.0.0.1:${PORT}/_serverFn/${CONTEXT_FN}?payload=${encodeURIComponent(payload)}`,
    {
      headers: {
        host,
        "x-forwarded-host": host,
        "sec-fetch-site": "same-origin",
        "x-tsr-serverFn": "true",
        accept: "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  );
}

function setSiteFlags(on: boolean) {
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       SELECT '${siteId}', k, ${on} FROM unnest(ARRAY['${FLAGS.join("','")}']) k
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = EXCLUDED.enabled`);
}

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
}

/** כניסת הבעלים דרך ה-handoff הקיים (קוד חד-פעמי, כמו "כניסה לעסק" מהשער) */
async function enterViaHandoff(page: Page) {
  const code = randomBytes(32).toString("base64url");
  const ownerId = sql(`SELECT id FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`INSERT INTO public.platform_admin_handoffs (token_hash, user_id, tenant_id, expires_at, kind)
       VALUES ('${createHash("sha256").update(code).digest("hex")}', '${ownerId}', '${siteId}',
               now() + interval '2 minutes', 'store_owner')`);
  await page.goto(HURL(`/admin-handoff#code=${code}&from=portal`));
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
}

async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(summary, label).toEqual([]);
}

test.beforeAll(async ({ request }, testInfo) => {
  SLUG = testInfo.project.name === "mobile" ? "h2a-manage-m" : "h2a-manage";
  HOSP = hostOf(SLUG);
  cleanup();
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'צימרים בגליל')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  const ownerId = await ensureUser(request, OWNER);
  const managerId = await ensureUser(request, MANAGER);
  // הראשון = הבעלים המוגן; השני = מנהל
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'h2a_owner', 'admin', true)`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${managerId}', '${MANAGER.email}', 'h2a_manager', 'admin', true)`);
  // הדגלים בפלטפורמה; לאתר — המסד בלבד בינתיים (אזור הניהול סגור)
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN ('${FLAGS.join("','")}')`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       VALUES ('${siteId}', 'hospitality_backend_enabled', true)`);
});

test.afterAll(() => cleanup());

test("closed: without the management flag /manage and /admin are 404 and nothing leaks", async ({
  request,
}) => {
  for (const path of ["/manage", "/manage/login", "/admin", "/admin-handoff"]) {
    const res = await hostGet(request, HOSP, path);
    expect(res.status(), path).toBe(404);
    expect(res.headers()["x-robots-tag"], path).toBe("noindex");
  }
  // פונקציית ההקשר: אזור הניהול כבוי → אין הקשר (גם עם טוקן של הבעלים)
  const res = await callContext(request, HOSP, await accessToken(request, OWNER));
  expect(await res.text()).not.toContain('"ok"');
});

test("open: the management area opens while the public website stays closed", async ({
  request,
}) => {
  setSiteFlags(true);
  await expect
    .poll(async () => (await hostGet(request, HOSP, "/manage")).status(), { timeout: 20_000 })
    .toBe(200);
  expect((await hostGet(request, HOSP, "/manage/login")).status()).toBe(200);
  const admin = await hostGet(request, HOSP, "/admin");
  expect(admin.status()).toBe(302);
  expect(admin.headers()["location"]).toBe("/manage");
  // האתר הציבורי ועמודי החנויות עדיין סגורים
  for (const path of ["/", "/login", "/products/x", "/admin/orders", "/checkout"]) {
    expect((await hostGet(request, HOSP, path)).status(), path).toBe(404);
  }
  expect(await (await hostGet(request, HOSP, "/robots.txt")).text()).toBe(
    "User-agent: *\nDisallow: /\n",
  );
});

test("server: the context answers by account — owner, manager, other store, anonymous", async ({
  request,
}) => {
  const owner = await (await callContext(request, HOSP, await accessToken(request, OWNER))).text();
  expect(owner).toContain('"ok"');
  expect(owner).toContain("guests.privacy");
  expect(owner).toContain("max_managers");

  const manager = await (
    await callContext(request, HOSP, await accessToken(request, MANAGER))
  ).text();
  expect(manager).toContain('"ok"');
  expect(manager).toContain('"manager"');
  expect(manager).not.toContain("max_managers"); // בלי פרטי החבילה

  // בעלים של חנות Ecommerce — מחובר, בלי הרשאת ניהול כאן
  const ecommerce = await (
    await callContext(request, HOSP, await accessToken(request, USERS.ownerA))
  ).text();
  expect(ecommerce).toContain('"forbidden"');
  expect(ecommerce).not.toContain("checklist");

  const anonymous = await (await callContext(request, HOSP)).text();
  expect(anonymous).toContain('"signed_out"');

  // בחנות: פונקציית ניהול של Hospitality לא קיימת (המתג — 404)
  expect((await callContext(request, hostOf(STORE_A.slug))).status()).toBe(404);
});

test("login page: Hebrew RTL, email code and password, no Google, accessible", async ({ page }) => {
  await page.goto(HURL("/manage"));
  await expect(page).toHaveURL(/\/manage\/login$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "he");
  await expect(page.getByRole("heading", { name: "כניסה לניהול העסק" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "קוד למייל" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "סיסמה" })).toBeVisible();
  // אין כניסה עם Google (הגופנים של Google Fonts אינם כניסה)
  await expect(page.getByRole("button", { name: /google/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /google/i })).toHaveCount(0);
  await expect(page.getByText(/google/i)).toHaveCount(0);
  expect(await page.content()).not.toMatch(/provider=google|signInWithOAuth|accounts\.google/i);
  await expectAccessible(page, "login");
});

test("owner: password login → dashboard with the checklist, plan, team; accessible", async ({
  page,
}) => {
  await page.goto(HURL("/manage/login"));
  await page.getByRole("tab", { name: "סיסמה" }).click();
  await page.getByLabel("אימייל או שם משתמש").fill(OWNER.email);
  await page.locator("#manage-password").fill(OWNER.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/manage$/);
  await expect(page.getByRole("heading", { name: "שלום, צימרים בגליל" })).toBeVisible();
  await expect(page.getByText("0 מתוך 5 צעדים הושלמו")).toBeVisible();
  await expect(page.getByRole("heading", { name: "החבילה שלי" })).toBeVisible();
  await expect(page.getByText("2 מתוך 3")).toBeVisible(); // מנהלים: הבעלים + מנהל, ניסיון = 3
  const side = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(side.getByText("צוות ניהול")).toBeVisible();
  await expect(side.getByRole("link", { name: "לוח בקרה" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByText("האתר הציבורי עדיין סגור לאורחים")).toBeVisible();
  await expectAccessible(page, "dashboard (owner)");

  // הרשימה מתעדכנת לפי הנתונים
  sql(
    `UPDATE hospitality.settings SET contact_phone = '050-1234567' WHERE tenant_id = '${siteId}'`,
  );
  await page.reload();
  await expect(page.getByText("1 מתוך 5 צעדים הושלמו")).toBeVisible();

  await page.getByRole("button", { name: "התנתקות" }).click();
  await expect(page).toHaveURL(/\/manage\/login$/);
  await page.goto(HURL("/manage"));
  await expect(page).toHaveURL(/\/manage\/login$/);
});

test("manager: email-code login → no team, no plan details", async ({ page, request }) => {
  await page.goto(HURL("/manage/login"));
  await page.getByLabel("אימייל").fill(MANAGER.email);
  const since = Date.now();
  await page.getByRole("button", { name: "שליחת קוד" }).click();
  await expect(page.getByRole("status")).toContainText("שלחנו קוד");
  let code = "";
  await expect
    .poll(
      async () => {
        const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
          url: string;
          body: string;
          at: number;
        }[];
        const mail = calls
          .filter(
            (c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(MANAGER.email),
          )
          .pop();
        code = mail?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
        return code;
      },
      { timeout: 15_000 },
    )
    .toMatch(/^\d{6}$/);
  await page.getByLabel("הקוד מהמייל").fill(code);
  await page.getByRole("button", { name: "כניסה" }).click();
  await expect(page).toHaveURL(/\/manage$/);
  await expect(page.getByText("מנהל/ת")).toBeVisible();
  await expect(page.getByText("צוות ניהול")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "החבילה שלי" })).toHaveCount(0);
  await expectAccessible(page, "dashboard (manager)");
});

test("an account without management rights on this site cannot get in", async ({ page }) => {
  await page.goto(HURL("/manage/login"));
  await page.getByRole("tab", { name: "סיסמה" }).click();
  await page.getByLabel("אימייל או שם משתמש").fill(USERS.ownerA.email);
  await page.locator("#manage-password").fill(USERS.ownerA.password);
  await page.getByRole("button", { name: "כניסה" }).click();
  // השרת מסרב (חשבון של חנות אחרת); אם בכל זאת היה נכנס — המסך "אין גישה"
  await expect(page.getByRole("heading", { name: "שלום, צימרים בגליל" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/manage\/login$/);
});

test("the existing owner handoff (portal → /admin-handoff → /admin) lands in /manage", async ({
  page,
}) => {
  await enterViaHandoff(page);
  await expect(page.getByRole("heading", { name: "שלום, צימרים בגליל" })).toBeVisible();
});

test("@mobile phone: bottom navigation with 'more', RTL, accessible", async ({ page, request }) => {
  test.skip(test.info().project.name !== "mobile", "phone layout — runs in the mobile project");
  // הפרויקט של הטלפון מריץ רק את הבדיקה הזו — היא מכינה לעצמה את הדגלים
  setSiteFlags(true);
  await expect
    .poll(async () => (await hostGet(request, HOSP, "/manage")).status(), { timeout: 20_000 })
    .toBe(200);
  await enterViaHandoff(page);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const bar = page.getByRole("navigation", { name: "ניווט ראשי" });
  await expect(bar).toHaveCount(1); // רק השורה התחתונה מוצגת בטלפון
  await expect(bar.getByRole("link", { name: "לוח בקרה" })).toBeVisible();
  await expect(bar.getByText("הזמנות")).toBeVisible();
  await expect(bar.getByText("יחידות")).toBeVisible();
  const box = await bar.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 2);
  // אין גלילה לרוחב
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );
  await expectAccessible(page, "dashboard (phone)");
  await bar.getByRole("button", { name: "עוד מסכים" }).click();
  const sheet = page.getByRole("dialog", { name: "עוד מסכים" });
  await expect(sheet.getByText("צוות ניהול")).toBeVisible();
  await expect(sheet.getByText("הגדרות העסק")).toBeVisible();
  await expectAccessible(page, "more sheet (phone)");
});

test("a suspended site shows the suspended page in the management area", async ({ request }) => {
  sql(`UPDATE public.tenants SET status = 'suspended' WHERE id = '${siteId}'`);
  try {
    await expect
      .poll(async () => (await hostGet(request, HOSP, "/manage")).status(), { timeout: 30_000 })
      .toBe(403);
    expect(await (await hostGet(request, HOSP, "/manage")).text()).toContain("האתר מושעה");
  } finally {
    sql(`UPDATE public.tenants SET status = 'active' WHERE id = '${siteId}'`);
  }
});

test("Ecommerce unchanged: /manage does not exist on a store; store pages and /admin as before", async ({
  request,
  browser,
}) => {
  const STORE = hostOf(STORE_A.slug);
  const manage = await hostGet(request, STORE, "/manage");
  expect(manage.status()).toBe(404);
  expect(await manage.text()).not.toContain("כניסה לניהול העסק");
  expect((await hostGet(request, STORE, "/manage/login")).status()).toBe(404);
  expect((await hostGet(request, STORE, "/")).status()).toBe(200);
  expect((await hostGet(request, STORE, "/admin")).status()).toBe(200);
  expect(await (await hostGet(request, STORE, "/robots.txt")).text()).not.toBe(
    "User-agent: *\nDisallow: /\n",
  );
  // בעל החנות בפאנל הניהול של החנות — כמו קודם
  const ctx = await browser.newContext({ storageState: AUTH.ownerA });
  const page = await ctx.newPage();
  await page.goto(`http://${STORE}:${PORT}/admin`);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByText("כניסה לניהול העסק")).toHaveCount(0);
  await ctx.close();
});

test("closing the management flag closes the area again", async ({ request }) => {
  setSiteFlags(false);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled)
       VALUES ('${siteId}', 'hospitality_backend_enabled', true)
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  await expect
    .poll(async () => (await hostGet(request, HOSP, "/manage")).status(), { timeout: 20_000 })
    .toBe(404);
});
