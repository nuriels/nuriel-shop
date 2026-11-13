import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { AUTH, A, STORE_A, USERS, supabaseEnv } from "./helpers";
import { accessToken, callServerFn, ensureUser, sql } from "./hospitality-helpers";

// איפוס סיסמה בלי סיסמה במייל (ההחלטה המאושרת):
//   • קישור חד-פעמי מוגבל בזמן; במסד רק ה-hash של הטוקן; המשתמש בוחר סיסמה בעצמו;
//   • מייל האישור אחרי השינוי — בלי הסיסמה; שימוש שני בקישור נדחה;
//   • הקמת משתמש עם סיסמה זמנית — הסיסמה מוצגת למנהל פעם אחת ולא יוצאת במייל, גם אם לקוח
//     ישן עוד שולח את האפשרות שהוסרה (emailTempPassword); בטופס אין יותר את האפשרות.

const STORE = `${STORE_A.slug}.shop.localhost`;
const RESET_USER = { email: "pw188.reset@e2e.test", password: "Pw188-Old-Pass-1!" };
const NEW_PASSWORD = "Pw188-New-Chosen-9!";

type Call = { url: string; body: string; at: number };
async function mailsTo(request: APIRequestContext, email: string, since: number): Promise<Call[]> {
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as Call[];
  return calls.filter(
    (c) => c.url.startsWith("/emails") && c.at >= since && c.body.includes(email),
  );
}

test.beforeAll(async ({ request }) => {
  await ensureUser(request, RESET_USER);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       SELECT '${STORE_A.id}', id, email, 'pw188_reset', 'customer', true FROM auth.users
        WHERE email = '${RESET_USER.email}'
       ON CONFLICT DO NOTHING`);
});

test.afterAll(() => {
  sql(`DELETE FROM public.user_roles WHERE email LIKE 'pw188.%'`);
  sql(`DELETE FROM auth.users WHERE email LIKE 'pw188.%'`);
});

test("reset: a one-time link (hash only in the DB), the user picks the password, the confirmation email has no password", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "server flow, once");
  sql(`DELETE FROM public.password_reset_tokens WHERE user_id = (SELECT id FROM auth.users
        WHERE email = '${RESET_USER.email}')`);
  const since = Date.now();
  const res = await callServerFn(request, {
    host: STORE,
    file: "src/lib/password.functions.ts",
    name: "requestPasswordReset",
    data: { identifier: RESET_USER.email },
  });
  expect(res.status()).toBe(200);
  let token = "";
  await expect
    .poll(
      async () => {
        const mail = (await mailsTo(request, RESET_USER.email, since)).pop();
        token = /\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(mail?.body ?? "")?.[1] ?? "";
        return token;
      },
      { timeout: 15_000 },
    )
    .not.toBe("");
  // the reset email itself: a link, never a password
  const resetMail = (await mailsTo(request, RESET_USER.email, since)).pop()!;
  expect(resetMail.body).not.toContain(RESET_USER.password);
  // the DB keeps only the sha256 of the token, with an expiry
  const hash = createHash("sha256").update(token).digest("hex");
  expect(
    sql(`SELECT count(*) || '|' || bool_and(expires_at <= now() + interval '3 hours 1 minute')
           FROM public.password_reset_tokens WHERE token_hash = '${hash}' AND used_at IS NULL`),
  ).toBe("1|true");
  expect(
    sql(`SELECT count(*) FROM public.password_reset_tokens t
          WHERE row_to_json(t)::text LIKE '%${token}%'`),
  ).toBe("0");

  const before = Date.now();
  const done = await callServerFn(request, {
    host: STORE,
    file: "src/lib/password.functions.ts",
    name: "completePasswordReset",
    data: { token, password: NEW_PASSWORD },
  });
  expect(done.status(), await done.text()).toBe(200);
  // the confirmation email: sent, and it carries no password
  let confirm: Call | undefined;
  await expect
    .poll(
      async () => {
        confirm = (await mailsTo(request, RESET_USER.email, before)).pop();
        return confirm?.body ?? "";
      },
      { timeout: 15_000 },
    )
    .toContain("הסיסמה עצמה לא נשלחת במייל");
  expect(confirm!.body).not.toContain(NEW_PASSWORD);
  expect(confirm!.body).not.toContain(RESET_USER.password);

  // the chosen password works; the link is spent
  const { url, anonKey } = supabaseEnv();
  const signIn = await request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anonKey },
    data: { email: RESET_USER.email, password: NEW_PASSWORD },
  });
  expect(signIn.status()).toBe(200);
  const again = await callServerFn(request, {
    host: STORE,
    file: "src/lib/password.functions.ts",
    name: "completePasswordReset",
    data: { token, password: "Pw188-Another-Pass-2!" },
  });
  expect(await again.text()).toContain("כבר נעשה שימוש בקישור הזה");
});

test("a new account with a temporary password: shown once to the manager, never emailed — even if an old client asks", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "server flow, once");
  const email = `pw188.staff.${Date.now()}@e2e.test`;
  const temp = "Pw188-Temp-7788";
  const since = Date.now();
  const res = await callServerFn(request, {
    host: STORE,
    file: "src/lib/admin.functions.ts",
    name: "createStaffUser",
    token: await accessToken(request, USERS.ownerA),
    data: {
      email,
      role: "warehouse",
      displayName: "בדיקת סיסמה",
      passwordMode: "temp",
      tempPassword: temp,
      emailTempPassword: true, // the removed option: ignored by the server
    },
  });
  const text = await res.text();
  expect(res.status(), text).toBe(200);
  expect(text).toContain(temp); // shown once, to the manager
  expect(sql(`SELECT must_change_password FROM public.user_roles WHERE email = '${email}'`)).toBe(
    "t",
  );
  // give any email a moment, then: nothing with the password went out
  await new Promise((r) => setTimeout(r, 1500));
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as Call[];
  expect(calls.filter((c) => c.at >= since && c.body.includes(temp))).toEqual([]);
  expect((await mailsTo(request, email, since)).length).toBe(0);
});

test("the create-account form has no 'email the temporary password' option", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop flow");
  const ctx = await browser.newContext({ storageState: AUTH.ownerA });
  const page = await ctx.newPage();
  await page.goto(A("/admin?tab=users"));
  await page.getByRole("button", { name: "לקוח חדש", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "יצירת חשבון לקוח חדש" });
  await dialog.getByText("סיסמה זמנית מיידית").click();
  await expect(dialog.locator("#pw-temp")).toBeVisible();
  await expect(dialog.getByText("מטעמי אבטחה הסיסמה הזמנית לא נשלחת במייל")).toBeVisible();
  await expect(dialog.getByText("שלח את הסיסמה הזמנית גם למייל")).toHaveCount(0);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await ctx.close();
});
