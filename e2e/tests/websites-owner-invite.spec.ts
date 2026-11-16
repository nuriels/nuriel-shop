import { createHash } from "node:crypto";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fromJSON } from "seroval";
import { AUTH, hostOf, platformUrl, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  readLoginCode,
  sql,
} from "./hospitality-helpers";

// Nuriel Websites — הזמנת בעלת האתר בקישור חד-פעמי (מיגרציה 198), מקצה לקצה:
//   1. בתיק האתר בפאנל: "יצירת קישור להזמנת לקוחה" → הקישור מוצג פעם אחת עם העתקה; במסד רק ה-hash; 72 שעות;
//      קישור חדש מבטל את הקודם; ביטול
//   2. פתיחת הקישור (בלי חשבון): "ברוכה הבאה" עם שם האתר, הטוקן יוצא מהכתובת; בדיקות הטופס; פתיחת חשבון → כניסה
//      ישירה ל-/studio של האתר הזה; נגישות (axe)
//   3. אימות המייל: מוצג כלא-מאומת, קוד שנשלח (שירות המיילים המדומה) → מאומת; הפאנל מציג "המייל אומת"
//   4. שימוש חוזר / קישור מבוטל / שפג / של אתר אחר — נדחים ונרשמים ביומן; מייל שכבר רשום — נדחה בלי חשבון חדש
//   5. ההרשאות: בעלת האתר הזה בלבד — לא אתר אחר, לא פאנל הפלטפורמה; כניסה חוזרת בסיסמה במסך הכניסה של הניהול

const RUN = `${Date.now().toString(36).slice(-5)}`;
const SITE = `inv-site-${RUN}`;
const OTHER = `inv-other-${RUN}`;
const NEW_OWNER = { email: `owner.${RUN}@invite.e2e.test`, password: "Invite-Owner-2026!" };
const TAKEN = { email: `taken.${RUN}@invite.e2e.test`, password: "Taken-Account-2026!" };
const OTHER_OWNER = { email: `other.${RUN}@invite.e2e.test`, password: "Other-Owner-2026!" };
const STUDIO_FN = "src/engines/business-profile/api/studio.functions.ts";
const PLATFORM_FN = "src/engines/business-profile/api/platform-admin.functions.ts";
const ids: Record<string, string> = {};
const local = (url: string) =>
  url.replace(/^https:\/\/([a-z0-9.-]+\.shop\.localhost)\//, `http://$1:${PORT}/`);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const tokenOf = (url: string) => new URL(url).hash.replace(/^#t=/, "");
let ipCounter = 10;
const IP_RUN = 20 + Math.floor(Math.random() * 200);
const nextIp = () => `10.${IP_RUN}.7.${(ipCounter++ % 250) + 1}`;

async function outcome(res: APIResponse): Promise<{ ok: boolean; error: string }> {
  const text = await res.text();
  if (res.status() !== 200) return { ok: false, error: `${res.status()} ${text.slice(0, 200)}` };
  if (text.includes('"$TSR/Error"')) return { ok: false, error: text.slice(0, 300) };
  fromJSON({ t: JSON.parse(text), f: 127, m: [] } as unknown as Parameters<typeof fromJSON>[0]);
  return { ok: true, error: "" };
}

async function openSiteFile(page: Page, siteId: string) {
  await page.goto(platformUrl(`/platform/websites/${siteId}`));
  await expect(page.getByTestId("owner-invite-card")).toBeVisible({ timeout: 20_000 });
  return page.getByTestId("owner-invite-card");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  await ensureUser(request, TAKEN);
  await ensureUser(request, OTHER_OWNER);
  asPlatform(`SELECT public.platform_bp_open_site('${SITE}', 'אתר לבדיקת הזמנה')`);
  asPlatform(
    `SELECT public.platform_bp_open_site('${OTHER}', 'אתר של לקוחה אחרת', '${OTHER_OWNER.email}')`,
  );
  ids["site"] = sql(`SELECT id FROM public.tenants WHERE slug = '${SITE}'`);
  ids["other"] = sql(`SELECT id FROM public.tenants WHERE slug = '${OTHER}'`);
});

test.afterAll(() => {
  for (const [id, slug] of [
    [ids["site"], SITE],
    [ids["other"], OTHER],
  ]) {
    if (!id) continue;
    sql(
      `SET session_replication_role = replica; DELETE FROM business_profile.owner_invites WHERE tenant_id = '${id}'`,
    );
    if (sql(`SELECT slug FROM public.tenants WHERE id = '${id}'`))
      asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
  sql(
    `DELETE FROM auth.users WHERE email IN ('${NEW_OWNER.email}', '${TAKEN.email}', '${OTHER_OWNER.email}')`,
  );
});

test("the owner invite: link from the site file → account → her studio → email verified; reuse, revoke, expiry, other site, taken email; her rights stay on this site", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "covered on the computer (the invite page is checked on a phone below)",
  );
  test.setTimeout(240_000);

  // ---------- 1. the panel: create, replace, the link shown once ----------
  const admin = await browser.newContext({ storageState: AUTH.platform });
  const panel = await admin.newPage();
  let card = await openSiteFile(panel, ids["site"]!);
  await expect(card.getByText("אין קישור פעיל")).toBeVisible();
  await card.getByRole("button", { name: "יצירת קישור להזמנת לקוחה" }).click();
  const box = card.getByTestId("invite-link-box");
  await expect(box).toBeVisible();
  await expect(box.getByRole("button", { name: "העתקת הקישור" })).toBeVisible();
  const first = await box.getByRole("textbox").inputValue();
  expect(first).toMatch(
    new RegExp(`^https://${SITE}\\.shop\\.localhost/studio/invite#t=[A-Za-z0-9_-]{43}$`),
  );
  // only the hash is stored; 72 hours
  const firstToken = tokenOf(first);
  expect(
    sql(
      `SELECT count(*) FROM business_profile.owner_invites WHERE tenant_id = '${ids["site"]}' AND token_hash = '${sha256(firstToken)}'`,
    ),
  ).toBe("1");
  expect(
    sql(
      `SELECT count(*) FROM business_profile.owner_invites WHERE token_hash LIKE '%${firstToken.slice(0, 12)}%'`,
    ),
  ).toBe("0");
  expect(
    sql(
      `SELECT extract(epoch FROM expires_at - created_at)::int FROM business_profile.owner_invites WHERE token_hash = '${sha256(firstToken)}'`,
    ),
  ).toBe(String(72 * 3600));
  await expect(card.getByText("קישור פעיל")).toBeVisible();
  const axe = await new AxeBuilder({ page: panel })
    .include("[data-testid=owner-invite-card]")
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);

  // a new link replaces the open one
  await card.getByRole("button", { name: "יצירת קישור חדש (הקודם יבוטל)" }).click();
  await panel.getByRole("alertdialog").getByRole("button", { name: "יצירת קישור חדש" }).click();
  await expect
    .poll(async () => card.getByTestId("invite-link-box").getByRole("textbox").inputValue())
    .not.toBe(first);
  const second = await card.getByTestId("invite-link-box").getByRole("textbox").inputValue();
  expect(
    sql(
      `SELECT revoke_reason FROM business_profile.owner_invites WHERE token_hash = '${sha256(firstToken)}'`,
    ),
  ).toBe("replaced");

  // ---------- 2. the first (replaced) link is refused ----------
  const guest = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": nextIp() } });
  const page = await guest.newPage();
  await page.goto(local(first));
  await expect(page.getByRole("heading", { name: "אי אפשר להשתמש בקישור" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("alert")).toContainText("הקישור בוטל");
  // another site's address with this link: just "not valid" (nothing revealed)
  await page.goto(local(second).replace(`${SITE}.shop.localhost`, `${OTHER}.shop.localhost`));
  await expect(page.getByRole("alert")).toContainText("הקישור לא תקין");

  // ---------- 3. the real link: welcome, form checks, account, her studio ----------
  await page.goto(local(second));
  await expect(
    page.getByRole("heading", { level: 1, name: "ברוכה הבאה, האתר שלך מוכן לניהול" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("אתר לבדיקת הזמנה")).toBeVisible();
  expect(page.url()).not.toContain("#t="); // the token left the address bar
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(
    a11y.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  await page.getByLabel("אימייל").fill(NEW_OWNER.email);
  await page.getByLabel("סיסמה", { exact: true }).fill("short");
  await page.getByLabel("אימות סיסמה").fill("short");
  await page.getByRole("button", { name: "פתיחת החשבון וכניסה לניהול" }).click();
  await expect(page.getByRole("alert")).toContainText("לפחות 10 תווים");
  await page.getByLabel("סיסמה", { exact: true }).fill(NEW_OWNER.password);
  await page.getByLabel("אימות סיסמה").fill(`${NEW_OWNER.password}x`);
  await page.getByRole("button", { name: "פתיחת החשבון וכניסה לניהול" }).click();
  await expect(page.getByRole("alert")).toContainText("הסיסמאות אינן תואמות");
  // an email that already has an account: refused, nothing created, the invite stays open
  await page.getByLabel("אימייל").fill(TAKEN.email);
  await page.getByLabel("אימות סיסמה").fill(NEW_OWNER.password);
  await page.getByRole("button", { name: "פתיחת החשבון וכניסה לניהול" }).click();
  await expect(page.getByRole("alert")).toContainText("כבר רשומה");
  expect(sql(`SELECT count(*) FROM public.user_roles WHERE tenant_id = '${ids["site"]}'`)).toBe(
    "0",
  );
  // the real one
  const since = Date.now();
  await page.getByLabel("אימייל").fill(NEW_OWNER.email);
  await page.getByRole("button", { name: "פתיחת החשבון וכניסה לניהול" }).click();
  await expect(page).toHaveURL(new RegExp(`${SITE}\\.shop\\.localhost:${PORT}/studio$`), {
    timeout: 30_000,
  });
  await expect(page.getByText("אתר לבדיקת הזמנה").first()).toBeVisible();

  // ---------- 4. the email is not verified until the code comes back ----------
  const banner = page.getByTestId("owner-email-banner");
  await expect(banner).toContainText("כתובת המייל עוד לא אומתה");
  await expect(banner).toContainText(NEW_OWNER.email);
  expect(
    sql(
      `SELECT email_verified_at IS NULL FROM business_profile.owner_invites WHERE token_hash = '${sha256(tokenOf(second))}'`,
    ),
  ).toBe("t");
  const code = await readLoginCode(request, NEW_OWNER.email, since);
  await banner.getByLabel("קוד אימות").fill(code === "000000" ? "111111" : "000000");
  await banner.getByRole("button", { name: "אימות" }).click();
  await expect(banner.getByRole("alert")).toContainText("הקוד שגוי");
  await banner.getByLabel("קוד אימות").fill(code);
  await banner.getByRole("button", { name: "אימות" }).click();
  await expect(banner).toBeHidden({ timeout: 15_000 });
  expect(
    sql(
      `SELECT raw_app_meta_data ->> 'platform' FROM auth.users WHERE email = '${NEW_OWNER.email}'`,
    ),
  ).toBe("true");

  // ---------- 5. her rights: owner of THIS site only ----------
  expect(
    sql(`SELECT string_agg(tenant_id::text || ':' || role || ':' || is_protected, ',') FROM public.user_roles
               WHERE user_id = (SELECT id FROM auth.users WHERE email = '${NEW_OWNER.email}')`),
  ).toBe(`${ids["site"]}:admin:true`);
  expect(
    sql(
      `SELECT public.is_platform_admin((SELECT id FROM auth.users WHERE email = '${NEW_OWNER.email}'))`,
    ),
  ).toBe("f");
  const token = await accessToken(request, NEW_OWNER);
  const otherDraft = await outcome(
    await callServerFn(request, {
      host: hostOf(OTHER),
      file: STUDIO_FN,
      name: "studioDraft",
      method: "GET",
      token,
    }),
  );
  expect(otherDraft.ok).toBe(false);
  const panelFn = await outcome(
    await callServerFn(request, {
      host: "platform.shop.localhost",
      file: PLATFORM_FN,
      name: "websitesPlatformInviteState",
      method: "GET",
      token,
      data: { tenantId: ids["site"] },
    }),
  );
  expect(panelFn.ok).toBe(false);

  // ---------- 6. the same link again: used ----------
  const again = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": nextIp() } });
  const reuse = await again.newPage();
  await reuse.goto(local(second));
  await expect(reuse.getByRole("alert")).toContainText("הקישור כבר שימש");
  await again.close();

  // ---------- 7. signing in again with her password on the site's management login ----------
  const back = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": nextIp() } });
  const login = await back.newPage();
  await login.goto(`http://${hostOf(SITE)}:${PORT}/studio`);
  await expect(login.getByRole("heading", { name: "כניסה לניהול האתר" })).toBeVisible({
    timeout: 20_000,
  });
  await login.getByLabel("אימייל").fill(NEW_OWNER.email);
  await login.getByLabel("סיסמה").fill(NEW_OWNER.password);
  await login.getByRole("button", { name: "כניסה", exact: true }).click();
  await expect(login.getByRole("link", { name: "עריכת האתר" })).toBeVisible({ timeout: 20_000 });
  await expect(login.getByTestId("owner-email-banner")).toHaveCount(0);
  await back.close();

  // ---------- 8. the panel shows the owner, the verified email, the history and the log ----------
  card = await openSiteFile(panel, ids["site"]!);
  await expect(card).toContainText(NEW_OWNER.email);
  await expect(card.getByTestId("owner-email-verification")).toContainText("המייל אומת");
  await expect(card.getByRole("button", { name: /יצירת קישור/ })).toHaveCount(0);
  const actions =
    sql(`SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM public.platform_audit_log
                        WHERE tenant_id = '${ids["site"]}' AND action LIKE 'bp_owner%'`);
  for (const a of [
    "bp_owner_email_verified",
    "bp_owner_invite_created",
    "bp_owner_invite_failed",
    "bp_owner_invite_redeemed",
    "bp_owner_invite_revoked",
    "bp_owner_set",
  ])
    expect(actions).toContain(a);
  expect(
    sql(`SELECT string_agg(DISTINCT details ->> 'reason', ',' ORDER BY details ->> 'reason') FROM public.platform_audit_log
               WHERE tenant_id = '${ids["site"]}' AND action = 'bp_owner_invite_failed'`),
  ).toBe("email_exists,revoked,used,wrong_site");
  expect(
    sql(
      `SELECT count(*) FROM public.platform_audit_log WHERE tenant_id = '${ids["site"]}' AND action = 'bp_owner_invite_failed' AND details ->> 'reason' = 'wrong_site'`,
    ),
  ).toBe("1");
  await admin.close();
  await guest.close();
});

test("revoke and expiry: a revoked link and an expired link are refused; the panel can revoke", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered on the computer");
  // a second site without an owner
  const slug = `inv-third-${RUN}`;
  asPlatform(`SELECT public.platform_bp_open_site('${slug}', 'אתר שלישי')`);
  const siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  try {
    const admin = await browser.newContext({ storageState: AUTH.platform });
    const panel = await admin.newPage();
    const card = await openSiteFile(panel, siteId);
    await card.getByRole("button", { name: "יצירת קישור להזמנת לקוחה" }).click();
    const link = await card.getByTestId("invite-link-box").getByRole("textbox").inputValue();
    await card.getByRole("button", { name: "ביטול הקישור" }).click();
    await panel.getByRole("alertdialog").getByRole("button", { name: "ביטול הקישור" }).click();
    await expect(card.getByText("אין קישור פעיל")).toBeVisible();
    const guest = await browser.newContext({ extraHTTPHeaders: { "x-real-ip": nextIp() } });
    const page = await guest.newPage();
    await page.goto(local(link));
    await expect(page.getByRole("alert")).toContainText("הקישור בוטל");
    // a fresh link that has expired
    await panel.reload();
    await (
      await openSiteFile(panel, siteId)
    )
      .getByRole("button", { name: "יצירת קישור להזמנת לקוחה" })
      .click();
    const expiring = await panel.getByTestId("invite-link-box").getByRole("textbox").inputValue();
    sql(`UPDATE business_profile.owner_invites SET created_at = now() - interval '80 hours', expires_at = now() - interval '8 hours'
          WHERE token_hash = '${sha256(tokenOf(expiring))}'`);
    // a new page (the same path with another #fragment does not reload the page)
    const expired = await guest.newPage();
    await expired.goto(local(expiring));
    await expect(expired.getByRole("alert")).toContainText("תוקף הקישור פג");
    await guest.close();
    await admin.close();
  } finally {
    sql(
      `SET session_replication_role = replica; DELETE FROM business_profile.owner_invites WHERE tenant_id = '${siteId}'`,
    );
    asPlatform(`SELECT public.platform_delete_tenant('${siteId}', '${slug}')`);
  }
});

test("@mobile the invite page fits a phone (welcome, labels, no sideways scroll)", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone only");
  const slug = `inv-phone-${RUN}`;
  asPlatform(`SELECT public.platform_bp_open_site('${slug}', 'אתר לבדיקה בטלפון')`);
  const siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  try {
    const token = "a".repeat(43);
    asPlatform(`SELECT public.platform_bp_invite_create('${siteId}', '${sha256(token)}')`);
    await page.setExtraHTTPHeaders({ "x-real-ip": nextIp() });
    await page.goto(`http://${hostOf(slug)}:${PORT}/studio/invite#t=${token}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "ברוכה הבאה, האתר שלך מוכן לניהול" }),
    ).toBeVisible({ timeout: 20_000 });
    for (const label of ["אימייל", "אימות סיסמה"])
      await expect(page.getByLabel(label)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    sql(
      `SET session_replication_role = replica; DELETE FROM business_profile.owner_invites WHERE tenant_id = '${siteId}'`,
    );
    asPlatform(`SELECT public.platform_delete_tenant('${siteId}', '${slug}')`);
  }
});
