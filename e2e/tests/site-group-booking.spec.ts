import { expect, test, type APIRequestContext } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  asPlatform,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
} from "./hospitality-helpers";

// מיגרציה 44 — כמה חדרים בבקשה אחת, על השרת הבנוי:
//   • אורח בוחר חדר ותאריכים, ומוסיף עוד חדר פנוי באותם תאריכים (עם אורחים משלו); הסיכום מציג את
//     שני החדרים ואת הסכום; בקשה אחת — שתי הזמנות באותה קבוצה;
//   • מייל אחד לאורח (עם קישור אישי לכל חדר) ומייל אחד לעסק;
//   • עמוד "הבקשה התקבלה": בקשה אחת ל-2 חדרים, והחדרים;
//   • בעל העסק: בעמוד ההזמנה — "בקשה אחת ל-2 חדרים", ו"אישור כל החדרים" → שתיהן מאושרות, מייל אחד לאורח.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "hg.owner@e2e.test", password: "Hg-Owner-Pass-1!" };
// כתובת חדשה בכל הרצה — שירות המייל המדומה שומר את כל המיילים מההרצות הקודמות
const RUN = Date.now().toString(36);
const GUEST = `hg.guest.${RUN}@e2e.test`;
const GUEST_NAME = `דנה ${RUN}`;
const BASE = "hg-group";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
  "hospitality_booking_enabled",
] as const;
let slug = BASE;
let siteId = "";

const url = (path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
const day = (n: number) => sql(`SELECT (current_date + ${n})::text`);
const groupOf = (cols: string) =>
  sql(`SELECT ${cols} FROM hospitality.bookings b JOIN hospitality.guests g ON g.id = b.guest_id
        WHERE b.tenant_id = '${siteId}' AND g.email = '${GUEST}' ORDER BY b.number`);

/** המיילים שנשלחו אל הכתובת (הנמען — לא "השב אל") */
async function mails(request: APIRequestContext, to: string) {
  const calls = (await (await request.get("http://127.0.0.1:4010/__calls")).json()) as {
    url: string;
    body: string;
  }[];
  return calls
    .filter((c) => c.url.startsWith("/emails"))
    .map((c) => JSON.parse(c.body) as { to?: string[] | string; subject?: string; html?: string })
    .filter((m) => (Array.isArray(m.to) ? m.to : [m.to]).includes(to));
}

function cleanup() {
  for (const row of sql(`SELECT id || '|' || slug FROM public.tenants
                          WHERE slug ~ '^hg-group' AND site_type = 'hospitality'`)
    .split("\n")
    .filter(Boolean)) {
    const [id, s] = row.split("|") as [string, string];
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${s}')`);
  }
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop flow");
  slug = testInfo.retry > 0 ? `${BASE}-r${testInfo.retry}` : BASE;
  cleanup();
  sql(`DELETE FROM hospitality.rate_buckets`);
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${slug}', 'נופי הקבוצה', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'hg_owner_${slug.length}', 'admin', true, true)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const property = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'נופי הקבוצה', 'hg-p', 'active') RETURNING id`);
  // the seed trigger opens new units for two years
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price, sort_order)
       VALUES ('${siteId}', '${property}', 'unit', 'יחידת אדיר', 'hg-adir', 5, 2, 700, 0),
              ('${siteId}', '${property}', 'unit', 'יחידת מוריה', 'hg-moriya', 5, 2, 600, 1)`);
  await expect
    .poll(async () => (await hostGet(request, hostOf(slug), "/stay")).status(), { timeout: 20_000 })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("a guest asks for two rooms in one request; the owner approves both at once", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const from = day(20);
  const to = day(22);
  await page.goto(url(`/stay/book?unit=hg-adir&from=${from}&to=${to}&adults=2&children=0`));

  // the other room is offered for the same dates
  const extra = page.getByTestId("extra-rooms");
  await expect(extra.locator('[data-extra-room="יחידת מוריה"]')).toBeVisible({ timeout: 20_000 });
  await extra.getByRole("checkbox", { name: "להוסיף את יחידת מוריה" }).check();
  const summary = page.locator('[data-testid="extra-summary"] >> visible=true').first();
  await expect(summary).toContainText("יחידת מוריה");
  await expect(summary).toContainText("סה״כ ל-2 החדרים");
  await expect(summary).toContainText("2,600"); // 700 × 2 + 600 × 2

  await page.getByRole("button", { name: "המשך לפרטים" }).click();
  await page.getByLabel("שם מלא").fill(GUEST_NAME);
  await page.getByLabel("טלפון נייד").fill("0521234599");
  await page.getByLabel("אימייל").first().fill(GUEST);
  await page.getByRole("checkbox", { name: /קראתי ואני מסכים/ }).check();
  await page.getByRole("button", { name: "שליחת בקשת הזמנה" }).click();

  // the request page: one request for two rooms
  await expect(page).toHaveURL(/\/stay\/booking-received/, { timeout: 20_000 });
  await expect(page.getByTestId("group-lead")).toHaveText("בקשה אחת ל-2 חדרים");
  await expect(page.getByTestId("group-rooms")).toContainText("יחידת מוריה");
  await expectAccessible(page, "group request received");

  // the database: two bookings, one group, waiting for approval
  expect(groupOf("b.status").split("\n")).toEqual(["pending_approval", "pending_approval"]);
  expect(
    sql(`SELECT count(DISTINCT b.group_id) FROM hospitality.bookings b JOIN hospitality.guests g ON g.id = b.guest_id
          WHERE b.tenant_id = '${siteId}' AND g.email = '${GUEST}'`),
  ).toBe("1");
  const firstNumber = groupOf("b.number").split("\n")[0]!;
  // one email to the guest (a link for each room) and one to the business
  await expect.poll(async () => (await mails(request, GUEST)).length, { timeout: 20_000 }).toBe(1);
  const guestMail = (await mails(request, GUEST))[0]!;
  expect(guestMail.subject).toContain("2 חדרים");
  expect((guestMail.html ?? "").match(/\/stay\/my-booking#t=[0-9a-f]{64}/g)).toHaveLength(2);
  await expect
    .poll(
      async () =>
        (await mails(request, OWNER.email)).filter(
          (m) =>
            m.subject?.includes("2 חדרים") &&
            (m.html ?? "").includes(GUEST_NAME) &&
            (m.html ?? "").includes(`#${firstNumber} `),
        ).length,
      { timeout: 20_000 },
    )
    .toBe(1);

  // the owner: the group on the booking page — approve all
  const first = groupOf("b.id").split("\n")[0]!;
  const session = await passwordSession(request, url(), OWNER);
  await loadSession(page, session, `/manage/bookings/${first}`);
  const card = page.locator('[data-section="booking-group"]');
  await expect(card).toContainText("בקשה אחת ל-2 חדרים");
  await expect(card.locator("[data-group-booking]")).toHaveCount(2);
  await card.getByRole("button", { name: "אישור כל החדרים (2)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "אישור כל החדרים" }).click();
  await expect(page.getByText("2 החדרים אושרו — נשלח מייל אחד לאורח")).toBeVisible();
  await expect.poll(() => groupOf("b.status").split("\n")).toEqual(["confirmed", "confirmed"]);
  await expect.poll(async () => (await mails(request, GUEST)).length, { timeout: 20_000 }).toBe(2);
  const approved = (await mails(request, GUEST))[1]!;
  expect(approved.subject).toContain("אושרה");
  expect((approved.html ?? "").match(/\/stay\/my-booking#t=[0-9a-f]{64}/g)).toHaveLength(2);
});
