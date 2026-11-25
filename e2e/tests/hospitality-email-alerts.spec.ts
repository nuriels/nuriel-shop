import { expect, test, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
  type SavedSession,
} from "./hospitality-helpers";

// "יש התראה על מייל שנכשל ואין אפשרות להסיר אותה" (migration 206). The owner can mark a failed-email alert as
// read (the number in the menu goes down), as handled (the alert leaves "נכשלו" and "דורש טיפול" and moves to
// "טופלו"), and bring it back. An email the system cancelled on purpose (guest anonymized / email corrected) is
// never an alert and is never re-sent. The emails themselves — status, attempts, error, the row — never change,
// and another business's emails are never touched.

test.describe.configure({ mode: "serial" });

const SITE = { slug: "email-alerts-h", name: "צימרי ההתראות" };
const OTHER = { slug: "email-alerts-other", name: "עסק אחר" };
const OWNER = { email: "email.alerts.owner@e2e.test", password: "Email-Alerts-Owner-1!" };
const FLAGS = ["hospitality_backend_enabled", "hospitality_management_enabled"] as const;
const siteUrl = (path = "") => `http://${hostOf(SITE.slug)}:${PORT}${path}`;

const ids = { site: "", other: "", a: "", b: "", c: "", cancelled: "", foreign: "" };
let session: SavedSession | null = null;

const desktopOnly = () => test.skip(test.info().project.name === "mobile", "desktop flow");
// the "מיילים" item of the side menu (its name ends with the badge, when there is one)
const emailsNav = (page: Page) => page.getByRole("link", { name: /^מיילים/ }).first();
const failedTab = (page: Page) => page.getByRole("tab", { name: /^נכשלו/ });
const handledTab = (page: Page) => page.getByRole("tab", { name: /^טופלו/ });

function cleanup() {
  for (const s of [SITE, OTHER]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${s.slug}'`);
    if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${s.slug}')`);
  }
}

/** מייל שנכשל סופית (dead) — תהליך הרקע לא נוגע בו. minutesAgo קובע את הסדר ברשימה (החדש למעלה) */
function deadEmail(
  tenant: string,
  key: string,
  event: string,
  opts: { error?: string; minutesAgo?: number } = {},
) {
  const error = opts.error ?? "smtp 550 mailbox unavailable";
  return sql(`INSERT INTO hospitality.notifications (tenant_id, event, recipient_kind, recipient_email, dedupe_key,
                status, attempts, last_error, created_at)
              VALUES ('${tenant}', '${event}', 'guest', '${key}@guest.e2e.test', 'e2e-email-alerts-${key}',
                'dead', 5, '${error}', now() - make_interval(mins => ${opts.minutesAgo ?? 10})) RETURNING id`);
}

/** מה שאסור שישתנה: הסטטוס, מספר הניסיונות והשגיאה של המייל עצמו */
const emailCore = (id: string) =>
  sql(
    `SELECT status || '|' || attempts || '|' || COALESCE(last_error, '') FROM hospitality.notifications WHERE id = '${id}'`,
  );

test.beforeAll(async ({ request }) => {
  cleanup();
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(
    `SELECT hospitality.admin_open_site('${SITE.slug}', '${SITE.name}', '${OWNER.email}')`,
  );
  asPlatform(
    `SELECT hospitality.admin_open_site('${OTHER.slug}', '${OTHER.name}', 'other.owner@e2e.test')`,
  );
  ids.site = sql(`SELECT id FROM public.tenants WHERE slug = '${SITE.slug}'`);
  ids.other = sql(`SELECT id FROM public.tenants WHERE slug = '${OTHER.slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
       ('${ids.site}', '${ownerId}', '${OWNER.email}', 'email_alerts_owner', 'admin', true, true)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${ids.site}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  ids.a = deadEmail(ids.site, "a", "booking_confirmed", { minutesAgo: 30 });
  ids.b = deadEmail(ids.site, "b", "request_received", { minutesAgo: 40 });
  ids.c = deadEmail(ids.site, "c", "booking_declined", { minutesAgo: 50 });
  // the system cancelled this one on purpose (the guest was anonymized) — not an alert, never re-sent
  ids.cancelled = deadEmail(ids.site, "d", "booking_cancelled", {
    error: "guest anonymized",
    minutesAgo: 60,
  });
  ids.foreign = deadEmail(ids.other, "e", "booking_confirmed", { minutesAgo: 30 });
  await expect
    .poll(async () => (await hostGet(request, hostOf(SITE.slug), "/manage")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  session = await passwordSession(request, siteUrl(), OWNER);
});

test.afterAll(() => {
  cleanup();
});

test("three failed emails: the menu says 3, the failed tab lists them, the cancelled one is under 'טופלו' only", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, session!, "/manage/emails?filter=failed");
  await expect(page.getByTestId("emails-list")).toBeVisible({ timeout: 20_000 });
  await expect(emailsNav(page)).toContainText("3");
  await expect(failedTab(page)).toContainText("3");
  await expect(handledTab(page)).toContainText("1");
  await expect(page.locator("li[data-email-alert]")).toHaveCount(3);
  await expect(page.locator('li[data-email-alert="new"]')).toHaveCount(3);
  await expect(page.getByTestId("email-alerts-bar")).toContainText("המייל עצמו נשמר בהיסטוריה");
  await expectAccessible(page, "emails — failed alerts");

  await handledTab(page).click();
  const cancelled = page.locator('li[data-email-alert="cancelled"]');
  await expect(cancelled).toHaveCount(1);
  await expect(cancelled).toContainText("בוטל בכוונה");
  await expect(cancelled).toContainText("לא יישלח שוב");
  // no resend, no marks on an email cancelled on purpose
  await expect(cancelled.getByRole("button")).toHaveCount(0);
});

test("mark one as read: the menu number drops, the email stays listed as read and unchanged", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, session!, "/manage/emails?filter=failed");
  const first = page.locator('li[data-email-alert="new"]').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.getByRole("button", { name: /^סימון כנקרא/ }).click();
  await expect(page.getByText("סומן כנקרא — המספר בפעמון ירד")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('li[data-email-alert="seen"]')).toHaveCount(1);
  await expect(emailsNav(page)).toContainText("2");
  // the alert state only — the email itself is untouched
  expect(
    sql(
      `SELECT count(*) FROM hospitality.notifications WHERE tenant_id = '${ids.site}' AND alert_seen_at IS NOT NULL`,
    ),
  ).toBe("1");
  for (const id of [ids.a, ids.b, ids.c])
    expect(emailCore(id)).toBe("dead|5|smtp 550 mailbox unavailable");
});

test("mark all as read: no number in the menu; the dashboard still lists the emails, quietly, until handled", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, session!, "/manage/emails?filter=failed");
  await expect(page.getByRole("button", { name: "סימון הכול כנקרא" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "סימון הכול כנקרא" }).click();
  await expect(page.getByText("2 התראות סומנו כנקראו")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('li[data-email-alert="seen"]')).toHaveCount(3);
  await expect(page.getByRole("button", { name: "סימון הכול כנקרא" })).toHaveCount(0);
  await expect(emailsNav(page)).toHaveText(/^מיילים$/);

  await page.goto(siteUrl("/manage"));
  const task = page.locator('[data-task="emails"]');
  await expect(task).toBeVisible({ timeout: 20_000 });
  await expect(task).toContainText("3 מיילים שלא נשלחו");
  await expect(task).toContainText("נקראו · אפשר לשלוח שוב או לסמן כטופל");
});

test("mark one as handled: it leaves 'נכשלו' for 'טופלו', and can be brought back", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, session!, "/manage/emails?filter=failed");
  await expect(page.locator("li[data-email-alert]")).toHaveCount(3, { timeout: 20_000 });
  await page
    .locator("li[data-email-alert]")
    .first()
    .getByRole("button", { name: /^סימון כטופל/ })
    .click();
  await expect(page.getByText(/סומן כטופל — ההתראה הוסרה/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("li[data-email-alert]")).toHaveCount(2);
  await expect(failedTab(page)).toContainText("2");
  await expect(handledTab(page)).toContainText("2");
  expect(
    sql(
      `SELECT count(*) FROM hospitality.notifications WHERE tenant_id = '${ids.site}' AND alert_handled_at IS NOT NULL`,
    ),
  ).toBe("1");

  await handledTab(page).click();
  const handled = page.locator('li[data-email-alert="handled"]');
  await expect(handled).toHaveCount(1);
  await expect(handled).toContainText("טופל ·");
  await handled.getByRole("button", { name: /^החזרה להתראות/ }).click();
  await expect(page.getByText('ההתראה חזרה ל"נכשלו"')).toBeVisible({ timeout: 15_000 });
  await failedTab(page).click();
  await expect(page.locator("li[data-email-alert]")).toHaveCount(3);
  // back as a NEW alert (not read) — the number is back in the menu
  await expect(emailsNav(page)).toContainText("1");
});

test("mark all as handled (after 'are you sure?'): no alert anywhere, nothing deleted, the other business untouched", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, session!, "/manage/emails?filter=failed");
  await expect(page.locator("li[data-email-alert]")).toHaveCount(3, { timeout: 20_000 });
  await page.getByRole("button", { name: "סימון הכול כטופל" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("לסמן את כל ההתראות כטופלו?");
  await expect(confirm).toContainText("המיילים לא יישלחו שוב ולא יימחקו");
  await confirm.getByRole("button", { name: "סימון הכול כטופל" }).click();
  await expect(page.getByText(/3 התראות סומנו כטופלו/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("אין התראות על מיילים שנכשלו — הכול טופל.")).toBeVisible();
  await expect(failedTab(page)).toContainText("0");
  await expect(handledTab(page)).toContainText("4");
  await expect(emailsNav(page)).toHaveText(/^מיילים$/);

  await page.goto(siteUrl("/manage"));
  await expect(page.getByTestId("dashboard-tasks").or(page.getByText("הכול מטופל"))).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-task="emails"]')).toHaveCount(0);

  // the history is intact: every email is still there, with its status, attempts and error
  expect(
    sql(`SELECT count(*) FROM hospitality.notifications WHERE tenant_id = '${ids.site}'`),
  ).toBe("4");
  for (const id of [ids.a, ids.b, ids.c])
    expect(emailCore(id)).toBe("dead|5|smtp 550 mailbox unavailable");
  expect(emailCore(ids.cancelled)).toBe("dead|5|guest anonymized");
  // the other business's failed email is still an open, unread alert
  expect(
    sql(`SELECT (alert_seen_at IS NULL) || '|' || (alert_handled_at IS NULL) FROM hospitality.notifications
          WHERE id = '${ids.foreign}'`),
  ).toBe("true|true");
  // and the actions are in the activity log (counts only — no addresses)
  expect(
    sql(`SELECT string_agg(action || ':' || COALESCE(changes ->> 'count', ''), ',' ORDER BY action)
           FROM (SELECT DISTINCT action, changes FROM hospitality.audit_log
                  WHERE tenant_id = '${ids.site}' AND action LIKE 'emails.alert_%') x`),
  ).toContain("emails.alert_handled:3");
});

test("on a phone: a new failed email is a new alert, and it can be marked handled @mobile", async ({
  page,
}) => {
  // the phone layout: the actions are reachable, big enough, and the page does not scroll sideways
  const fresh = deadEmail(ids.site, `m${Date.now()}`, "new_request", { minutesAgo: 0 });
  await loadSession(page, session!, "/manage/emails?filter=failed");
  const row = page.locator('li[data-email-alert="new"]').first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const handle = row.getByRole("button", { name: /^סימון כטופל/ });
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(scroll).toBeLessThanOrEqual(1);
  await handle.click();
  await expect(page.getByText(/סומן כטופל — ההתראה הוסרה/)).toBeVisible({ timeout: 15_000 });
  expect(
    sql(`SELECT alert_handled_at IS NOT NULL FROM hospitality.notifications WHERE id = '${fresh}'`),
  ).toBe("t");
  expect(emailCore(fresh)).toBe("dead|5|smtp 550 mailbox unavailable");
});
