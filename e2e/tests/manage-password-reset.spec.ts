import { expect, test } from "@playwright/test";
import { hostGet, hostOf, PORT, supabaseEnv } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  readLoginCode,
  sql,
} from "./hospitality-helpers";

// שלב א' 3 — "שכחתי סיסמה" באזור הניהול: קוד חד-פעמי למייל וסיסמה חדשה, באותו חשבון. השרת בודק את הקוד
// ואת הרשאת הניהול באתר הזה באותה בקשה: חשבון בלי הרשאה לא מקבל סיסמה. הסיסמה הישנה כבר לא עובדת.

test.describe.configure({ mode: "serial" });

const SLUG = "pr-site";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const OWNER = { email: "pr.owner@e2e.test", password: "Pr-Owner-Pass-1!" };
const MANAGER = { email: "pr.manager@e2e.test", password: "Pr-Old-Pass-1!" };
const NEW_PASSWORD = "Pr-New-Pass-2!";
const STRANGER = "pr.stranger@e2e.test";
const FLAGS = ["hospitality_backend_enabled", "hospitality_management_enabled"] as const;

async function passwordWorks(email: string, password: string): Promise<boolean> {
  const { url, anonKey } = supabaseEnv();
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.ok;
}

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "runs once, on the computer");
  cleanup();
  const ownerId = await ensureUser(request, OWNER);
  // מנהל עם סיסמה ישנה (גם אם נשאר מהרצה קודמת — מחזירים לסיסמה הישנה)
  const managerId = await ensureUser(request, MANAGER);
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  await request.put(`${supabaseEnv().url}/auth/v1/admin/users/${managerId}`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    data: { password: MANAGER.password },
  });
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'צימרי האיפוס', '${OWNER.email}')`);
  const siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
         ('${siteId}', '${ownerId}', '${OWNER.email}', 'pr_owner', 'admin', true, true),
         ('${siteId}', '${managerId}', '${MANAGER.email}', 'pr_manager', 'admin', true, false)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/login")).status(), { timeout: 20_000 })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

async function startReset(page: import("@playwright/test").Page, email: string) {
  await page.goto(URL_("/manage/login"));
  await page.getByRole("tab", { name: "סיסמה" }).click();
  await page.getByRole("button", { name: "שכחתי סיסמה" }).click();
  await page.getByLabel("אימייל").fill(email);
  const since = Date.now();
  await page.getByRole("button", { name: "שליחת קוד לאיפוס" }).click();
  await expect(page.getByRole("status")).toContainText("שלחנו קוד");
  return since;
}

test("forgot password: a code by email, a new password — signed in to the same account; the old password stops working", async ({
  page,
  request,
}) => {
  const since = await startReset(page, MANAGER.email);
  await expectAccessible(page, "password reset");
  await page.getByLabel("הקוד מהמייל").fill(await readLoginCode(request, MANAGER.email, since));
  await page.getByLabel("סיסמה חדשה").fill("short");
  await expect(page.getByText("הסיסמה צריכה לפחות 8 תווים")).toBeVisible();
  await page.getByLabel("סיסמה חדשה").fill(NEW_PASSWORD);
  await page.getByLabel("שוב, לאימות").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "שמירת הסיסמה וכניסה" }).click();
  await expect(page).toHaveURL(/\/manage$/, { timeout: 20_000 });
  await expect(page.getByText("מנהל/ת").first()).toBeVisible();
  expect(await passwordWorks(MANAGER.email, NEW_PASSWORD)).toBe(true);
  expect(await passwordWorks(MANAGER.email, MANAGER.password)).toBe(false);
  // אותו חשבון — אין חשבון כפול לאותו אימייל
  expect(sql(`SELECT count(*) FROM auth.users WHERE lower(email) = '${MANAGER.email}'`)).toBe("1");
  // אף מייל (הקוד, או כל מייל אחר מאז) לא מכיל את הסיסמה — לא החדשה ולא הישנה
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
    url: string;
    body: string;
    at: number;
  }[];
  const mails = calls.filter((c) => c.url.startsWith("/emails") && c.at >= since);
  expect(mails.some((c) => c.body.includes(MANAGER.email))).toBe(true);
  expect(
    mails.filter((c) => c.body.includes(NEW_PASSWORD) || c.body.includes(MANAGER.password)),
  ).toEqual([]);
});

test("an account without management rights here does not get a password", async ({
  page,
  request,
}) => {
  const since = await startReset(page, STRANGER);
  await page.getByLabel("הקוד מהמייל").fill(await readLoginCode(request, STRANGER, since));
  await page.getByLabel("סיסמה חדשה").fill(NEW_PASSWORD);
  await page.getByLabel("שוב, לאימות").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "שמירת הסיסמה וכניסה" }).click();
  await expect(page.getByText("לחשבון הזה אין הרשאת ניהול באתר הזה")).toBeVisible();
  await expect(page).toHaveURL(/\/manage\/login$/);
  expect(await passwordWorks(STRANGER, NEW_PASSWORD)).toBe(false);
});
