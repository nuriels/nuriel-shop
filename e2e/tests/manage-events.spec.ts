import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT } from "./helpers";
import {
  accessToken,
  asPlatform,
  callServerFn,
  ensureUser,
  expectAccessible,
  loadSession,
  passwordSession,
  sql,
} from "./hospitality-helpers";

// אירועים במתחם הבריכה, בלי לינה (מיגרציה 63), מקצה לקצה:
//   • הרשימה: תנאי החוזה בראש העמוד (עד 50 משתתפים, פיקדון 2,000 ₪, איחור 200 ₪ לשעה, הבריכה 08:00–18:00);
//   • אירוע חדש: יותר מ-50 משתתפים — נחסם; אירוע חופף באותו מתחם — מוצג ונחסם (וגם השרת מסרב);
//   • אורחים בצימרים באותו זמן — אישור האירוע רק עם אישור מפורש; אחרי 18:00 — הערת שעות הבריכה (לא חסימה).

test.describe.configure({ mode: "serial" });

const OWNER = { email: "ev.owner@e2e.test", password: "Ev-Owner-Pass-1!" };
const SLUG = "ev-pool";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const FLAGS = ["hospitality_backend_enabled", "hospitality_management_enabled"] as const;
let siteId = "";
let ownerId = "";
let propertyId = "";

const day = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const asOwner = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub', '${ownerId}', 'role', 'authenticated')::text, false),
              set_config('request.jwt.claim.sub', '${ownerId}', false),
              set_config('request.headers', json_build_object('x-tenant-id', '${siteId}')::text, false);
       ${query}`)
    .split("\n")
    .pop()!;

async function open(page: Page, request: APIRequestContext, path: string) {
  await loadSession(page, await passwordSession(request, URL_(), OWNER), path);
}

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

async function fillEvent(
  page: Page,
  v: { date: string; from: string; to: string; participants: string },
) {
  await page.getByLabel("תאריך").fill(v.date);
  await page.getByLabel("משעה").fill(v.from);
  await page.getByLabel("עד שעה").fill(v.to);
  await page.getByLabel("מספר משתתפים").fill(v.participants);
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop flow");
  cleanup();
  ownerId = await ensureUser(request, OWNER);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  asPlatform(`SELECT hospitality.admin_create_site('${SLUG}', 'מתחם הבריכה')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${siteId}', id, email, 'ev_owner', 'admin', true, true FROM auth.users WHERE email = '${OWNER.email}'`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  propertyId =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
       VALUES ('${siteId}', 'מתחם הבריכה', 'p-ev', 'active', 'zimmer_complex') RETURNING id`);
  const unit =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, capacity, base_occupancy, base_price, is_active)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'zimmer', 'צימר הדקל', 'u-ev', 4, 2, 600, true) RETURNING id`);
  // אורחים בצימר בימים 20–22, ואירוע קיים ביום 30 בין 10:00 ל-14:00
  asOwner(`SELECT hospitality.create_manual_booking(_unit_id => '${unit}', _check_in => '${day(20)}', _check_out => '${day(22)}',
             _full_name => 'אורח לן', _phone => '0546500100', _email => 'ev.lodger@e2e.test', _terms_explained => true)`);
  asOwner(
    `SELECT hospitality.event_create('${JSON.stringify({
      property_id: propertyId,
      event_type: "birthday",
      event_date: day(30),
      start_time: "10:00",
      end_time: "14:00",
      participants: 20,
      price: 1500,
      status: "confirmed",
      customer: { full_name: "דנה קיימת", phone: "0546500101", email: "ev.dana@e2e.test" },
    })}'::jsonb)`,
  );
  await expect
    .poll(async () => (await hostGet(request, HOST, "/manage/events")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("the events list: the contract's terms on top; a new event over 50 participants or overlapping another — blocked (also on the server)", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/events");
  await expect(page.getByRole("heading", { level: 1, name: "אירועים" })).toBeVisible();
  const terms = page.getByTestId("event-terms");
  await expect(terms).toContainText("50");
  await expect(terms).toContainText("2,000");
  await expect(terms).toContainText("200");
  await expect(terms).toContainText("08:00–18:00");
  await expect(page.getByTestId("events-list")).toContainText("דנה קיימת");
  await expectAccessible(page, "events list");
  await page.getByRole("link", { name: "אירוע חדש" }).click();
  await expect(page).toHaveURL(/\/manage\/events\/new/);
  await page.getByRole("radio", { name: "לקוח חדש" }).click();
  await page.getByLabel("שם מלא").fill("שירה חוגגת");
  await page.getByLabel("טלפון").fill("0546500102");
  await page.getByLabel("אימייל (לשליחת החוזה)").fill("ev.shira@e2e.test");
  await fillEvent(page, { date: day(30), from: "12:00", to: "16:00", participants: "51" });
  await expect(page.getByText("עד 50 משתתפים באירוע — אי אפשר יותר")).toBeVisible();
  await expect(page.getByTestId("event-conflicts")).toContainText("יש כבר אירוע במתחם בזמן הזה");
  await expect(page.getByRole("button", { name: "שמירת האירוע" })).toBeDisabled();
  await expectAccessible(page, "new event — blocked");
  // the server refuses the overlap too (no two events at once in a compound)
  const res = await callServerFn(request, {
    host: HOST,
    file: "src/engines/hospitality/api/events.functions.ts",
    name: "hospitalityEventCreate",
    data: {
      data: {
        property_id: propertyId,
        event_type: "birthday",
        event_date: day(30),
        start_time: "12:00",
        end_time: "16:00",
        participants: 20,
        price: 1000,
        status: "pending",
        customer: { full_name: "שירה חוגגת", phone: "0546500102", email: null },
      },
    },
    token: await accessToken(request, OWNER),
  });
  expect(await res.text()).toContain("יש כבר אירוע");
  expect(sql(`SELECT count(*) FROM hospitality.events WHERE tenant_id = '${siteId}'`)).toBe("1");
});

test("guests in the zimmers at the same time: confirming the event needs an explicit acknowledgement; after 18:00 — the pool-hours note, not a block", async ({
  page,
  request,
}) => {
  await open(page, request, "/manage/events/new");
  await page.getByRole("radio", { name: "לקוח חדש" }).click();
  await page.getByLabel("שם מלא").fill("רוני מסיבה");
  await page.getByLabel("טלפון").fill("0546500103");
  // after 18:00 — a note, saving is allowed
  await fillEvent(page, { date: day(40), from: "17:00", to: "21:00", participants: "30" });
  await expect(page.getByTestId("event-pool-hours")).toContainText("08:00–18:00");
  await expect(page.getByRole("button", { name: "שמירת האירוע" })).toBeEnabled();
  // the zimmers are booked on day 21 — confirming needs the acknowledgement
  await fillEvent(page, { date: day(21), from: "10:00", to: "15:00", participants: "30" });
  await page.getByRole("radio", { name: "מאושר — לאשר עכשיו" }).click();
  await expect(page.getByTestId("event-lodging")).toContainText("יש אורחים בצימרים במתחם (1)");
  await expect(page.getByRole("button", { name: "שמירת האירוע" })).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "ידוע לי שיש אורחים בצימרים — לאשר את האירוע בכל זאת" })
    .check();
  await page.getByLabel("המחיר (₪)").fill("2500");
  await page.getByRole("button", { name: "שמירת האירוע" }).click();
  await expect(page).toHaveURL(/\/manage\/events\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(page.getByTestId("event-status")).toContainText("מאושר");
  await expect(page.getByTestId("event-lodging-list")).toContainText("צימר הדקל");
  await expect(page.getByTestId("event-log")).toContainText("האירוע נוצר");
  expect(
    sql(
      `SELECT status || '|' || lodging_ack FROM hospitality.events WHERE tenant_id = '${siteId}' AND event_date = '${day(21)}'`,
    ),
  ).toBe("confirmed|true");
  await expectAccessible(page, "event page");
});
