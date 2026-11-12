import { expect, test } from "@playwright/test";
import { hostOf, supabaseEnv, USERS } from "./helpers";
import { accessToken, asPlatform, callServerFn, readLoginCode, sql } from "./hospitality-helpers";

// הוספת מנהל / שיוך בעלים לכתובת שכבר יש לה חשבון שלא אומת (SEC-H1: לא נוצר בידי המערכת, לא Google
// ולא נכנס פעם בקוד למייל). המסד בכוונה לא מקשר תפקיד לחשבון כזה. לפני התיקון הבעלים קיבל
// "פתיחת החשבון נכשלה. נסו שוב." בכל ניסיון, בלי דרך להתקדם. עכשיו: הודעה שאומרת מה לעשות,
// ואחרי כניסה אחת של בעל הכתובת בקוד למייל — ההוספה מצליחה. האבטחה לא נחלשת: עד הכניסה בקוד אין קישור.

test.describe.configure({ mode: "serial" });

const SLUG = "h2b-unverified";
// a second site without an owner — for the platform "set owner" path
const SLUG2 = "h2b-unverified-2";
const HOST = hostOf(SLUG);
const OWNER = { email: "h2bu.owner@e2e.test", password: "H2bu-Owner-Pass-1!" };
const STAMP = Date.now();
const UNVERIFIED = { email: `h2bu.self.${STAMP}@e2e.test`, password: "H2bu-Self-Pass-1!" };
const UNVERIFIED_OWNER = { email: `h2bu.owner2.${STAMP}@e2e.test`, password: "H2bu-Own2-Pass-1!" };
const TEAM = "src/engines/hospitality/api/team.functions.ts";
const PLATFORM = "src/engines/hospitality/api/platform-admin.functions.ts";
const CODE = "src/lib/login-code.functions.ts";
const MESSAGE = "כבר יש חשבון במערכת שעדיין לא אומת";
let siteId = "";
let site2Id = "";

/** חשבון עם סיסמה, בלי סימון המערכת — כמו הרשמה עצמאית (GoTrue admin API, בלי app_metadata.platform) */
async function unverifiedAccount(
  request: Parameters<typeof callServerFn>[0],
  user: { email: string; password: string },
) {
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  const res = await request.post(`${supabaseEnv().url}/auth/v1/admin/users`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
    data: { email: user.email, password: user.password, email_confirm: true },
  });
  expect(res.ok(), await res.text()).toBe(true);
  expect(
    sql(`SELECT coalesce(raw_app_meta_data ->> 'platform', 'none') FROM auth.users
          WHERE email = '${user.email}'`),
  ).toBe("none");
}

/** כניסה אמיתית בקוד למייל (שליחה + קוד מהמייל המדומה + אימות) — מאמתת את הבעלות על הכתובת */
async function signInWithCode(request: Parameters<typeof callServerFn>[0], email: string) {
  const since = Date.now();
  const sent = await callServerFn(request, {
    host: HOST,
    file: CODE,
    name: "requestLoginCode",
    data: { email },
  });
  expect(await sent.text()).toContain("maskedEmail");
  const code = await readLoginCode(request, email, since);
  const verified = await callServerFn(request, {
    host: HOST,
    file: CODE,
    name: "verifyLoginCode",
    data: { email, code },
  });
  expect(verified.status()).toBe(200);
}

const isVerified = (email: string) =>
  sql(`SELECT raw_app_meta_data ->> 'platform' FROM auth.users WHERE email = '${email}'`);
const rolesOf = (email: string, tenant = siteId) =>
  sql(`SELECT coalesce(string_agg(r.role::text, ','), '') FROM public.user_roles r
         JOIN auth.users u ON u.id = r.user_id
        WHERE u.email = '${email}' AND r.tenant_id = '${tenant}'`);

function cleanup() {
  for (const slug of [SLUG, SLUG2]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "server flow, once");
  cleanup();
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'בקתות האימות')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG2}', 'בקתות בלי בעלים')`);
  site2Id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG2}'`);
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  if (!sql(`SELECT id FROM auth.users WHERE email = '${OWNER.email}'`)) {
    const res = await request.post(`${supabaseEnv().url}/auth/v1/admin/users`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      data: { ...OWNER, email_confirm: true, app_metadata: { platform: true } },
    });
    expect(res.ok(), await res.text()).toBe(true);
  }
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       SELECT '${siteId}', id, email, 'h2bu_owner_${STAMP}', 'admin', true
         FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ('${siteId}', 'hospitality_backend_enabled', true), ('${siteId}', 'hospitality_management_enabled', true)`);
  // the team functions answer once the flags reached the app (15 s cache)
  const token = await accessToken(request, OWNER);
  await expect
    .poll(
      async () =>
        (
          await callServerFn(request, {
            host: HOST,
            file: TEAM,
            name: "hospitalityTeam",
            token,
            method: "GET",
          })
        ).text(),
      { timeout: 25_000 },
    )
    .toContain(OWNER.email);
});

test.afterAll(() => {
  if (test.info().project.name === "mobile") return;
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("add manager: an existing unverified account gets a clear next step, not a dead end; after one code sign-in it is added", async ({
  request,
}) => {
  await unverifiedAccount(request, UNVERIFIED);
  const owner = await accessToken(request, OWNER);
  const add = () =>
    callServerFn(request, {
      host: HOST,
      file: TEAM,
      name: "hospitalityAddManager",
      token: owner,
      data: { email: UNVERIFIED.email, displayName: "מנהל שנרשם לבד" },
    });

  // 1. refused, with the reason and what to do — and nothing was linked (SEC-H1 holds)
  const first = await (await add()).text();
  expect(first).toContain(MESSAGE);
  expect(first).not.toContain("פתיחת החשבון נכשלה");
  expect(rolesOf(UNVERIFIED.email)).toBe("");
  expect(isVerified(UNVERIFIED.email)).toBe("");

  // 2. the address owner signs in once with an email code → the account is verified
  await signInWithCode(request, UNVERIFIED.email);
  expect(isVerified(UNVERIFIED.email)).toBe("true");

  // 3. the owner tries again → added as a manager
  const second = await (await add()).text();
  expect(second).toContain("added");
  expect(rolesOf(UNVERIFIED.email)).toBe("admin");
});

test("platform: setting an unverified existing account as owner explains the step too; then it works", async ({
  request,
}) => {
  await unverifiedAccount(request, UNVERIFIED_OWNER);
  const platform = await accessToken(request, USERS.platform);
  const setOwner = () =>
    callServerFn(request, {
      host: "platform.shop.localhost",
      file: PLATFORM,
      name: "hospitalityPlatformSetOwner",
      token: platform,
      data: { siteId: site2Id, email: UNVERIFIED_OWNER.email, name: "בעלים שנרשם לבד" },
    });
  const first = await (await setOwner()).text();
  expect(first).toContain(MESSAGE);
  expect(rolesOf(UNVERIFIED_OWNER.email, site2Id)).toBe("");

  await signInWithCode(request, UNVERIFIED_OWNER.email);
  const second = await (await setOwner()).text();
  expect(second).not.toContain(MESSAGE);
  expect(rolesOf(UNVERIFIED_OWNER.email, site2Id)).toBe("admin");
});
