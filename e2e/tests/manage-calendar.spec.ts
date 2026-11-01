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
  type Account,
} from "./hospitality-helpers";

// Hospitality Stage 3a — היומן, על השרת הבנוי:
//   • לוח חודש: הזמנות בצבע לפי מצב (ממתינה / מאושרת / שוהים), "כל המתחם" ויחידותיו, סינון, חיפוש,
//     סיכום הזמנה (בלי פרטי קשר);
//   • חסימה בלחיצה על שני לילות פנויים → היחידה לא פנויה בהצעת המחיר → שחרור → פנויה שוב;
//     חסימה על הזמנה נדחית; חסימת "כל המתחם" תופסת את יחידותיו;
//   • מנהל עם הרשאת הזמנות; זרים נחסמים בקריאה ישירה; טלפון (סדר יום); נגישות; בלי שינוי בחנויות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h3a.owner@e2e.test", password: "H3a-Owner-Pass-1!" };
const MANAGER = { email: "h3a.manager@e2e.test", password: "H3a-Manager-Pass-1!" };
const OTHER = { email: "h3a.other@e2e.test", password: "H3a-Other-Pass-1!" };
const FN = "src/engines/hospitality/api/calendar.functions.ts";

const DESKTOP_SITES = { main: "h3a-main", foreign: "h3a-foreign", scale: "h3a-scale" } as const;
const MOBILE_SITES = { phone: "h3a-m" } as const;
type SiteKey = keyof typeof DESKTOP_SITES | keyof typeof MOBILE_SITES;

const ids: Partial<Record<SiteKey, string>> = {};
let suffix = "";
const slugOf = (base: string) => `${base}${suffix}`;
const url = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;
let storeHash = "";

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);

function sitesFor(project: string): Record<string, string> {
  const base: Record<string, string> = project === "mobile" ? MOBILE_SITES : DESKTOP_SITES;
  return Object.fromEntries(Object.entries(base).map(([k, v]) => [k, slugOf(v)]));
}
function cleanup(project: string) {
  const prefixes = Object.values(project === "mobile" ? MOBILE_SITES : DESKTOP_SITES);
  for (const row of sql(
    `SELECT id || '|' || slug FROM public.tenants WHERE slug ~ '^h3a-' AND site_type = 'hospitality'`,
  )
    .split("\n")
    .filter(Boolean)) {
    const [id, slug] = row.split("|") as [string, string];
    if (prefixes.some((p) => slug === p || slug.startsWith(`${p}-r`)))
      asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}
function addStaff(site: string, account: Account, username: string, owner: boolean) {
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${site}', id, email, '${username}', 'admin', true, ${owner} FROM auth.users WHERE email = '${account.email}'`);
}
/** a call as the site's owner, through the real functions (permissions and checks included) */
const asOwner = (site: string, query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub',
         (SELECT id FROM auth.users WHERE email = '${OWNER.email}'), 'role', 'authenticated')::text, false),
       set_config('request.headers', json_build_object('x-tenant-id', '${site}')::text, false);
       ${query}`)
    .split("\n")
    .at(-1)!;
/** the engine's own availability (the staff price preview = the booking quote; works while public bookings are closed) */
const isFree = (site: string, unit: string, from: string, to: string) =>
  asOwner(
    site,
    `SELECT hospitality.price_preview('${unit}', '${from}', '${to}', 2, 0) ->> 'available'`,
  );
function seedProperty(site: string, name: string, units: string[]) {
  const p = JSON.parse(
    asOwner(
      site,
      `SELECT hospitality.property_create('{"name": "${name}", "property_type": "zimmer_complex", "status": "active"}')`,
    ),
  ) as { id: string };
  for (const u of units)
    asOwner(
      site,
      `SELECT hospitality.unit_create('${p.id}', '{"name": "${u}", "unit_type": "zimmer"}')`,
    );
  return p.id;
}
const unitIdOf = (site: string, name: string) =>
  sql(`SELECT id FROM hospitality.units WHERE tenant_id = '${site}' AND name = '${name}'`);
// each guest their own phone (the engine matches a returning guest by phone)
let phones = 10;
const manual = (
  site: string,
  unit: string,
  from: string,
  to: string,
  guest: string,
  status = "confirmed",
) =>
  asOwner(
    site,
    `SELECT hospitality.create_manual_booking(_unit_id => '${unit}', _check_in => '${from}', _check_out => '${to}',
       _full_name => '${guest}', _phone => '05412345${++phones}', _terms_explained => true, _status => '${status}') ->> 'booking_id'`,
  );
const numberOf = (booking: string) =>
  sql(`SELECT number FROM hospitality.bookings WHERE id = '${booking}'`);

/** a hotel: 10 buildings × 30 rooms (setup data), ~5 stays per room next month through the real engine */
function seedScale(site: string) {
  sql(`UPDATE hospitality.subscriptions SET plan_code = 'enterprise' WHERE tenant_id = '${site}';
       DO $$ DECLARE _p uuid; BEGIN
         FOR i IN 1..10 LOOP
           INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type, sort_order)
           VALUES ('${site}', 'בניין ' || i, 'b-' || i, 'active', 'boutique_hotel', i) RETURNING id INTO _p;
           FOR j IN 1..30 LOOP
             INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order, base_price, capacity)
             VALUES ('${site}', _p, 'room', 'room', 'חדר ' || i || lpad(j::text, 2, '0'), 'r-' || i || '-' || j, j, 500, 4);
           END LOOP;
         END LOOP;
       END $$`);
  asOwner(
    site,
    `DO $$ DECLARE u record; d integer; len integer; n integer := 0; BEGIN
       FOR u IN SELECT id, row_number() OVER (ORDER BY name) AS k FROM hospitality.units WHERE tenant_id = '${site}' LOOP
         d := (u.k % 3)::integer;
         WHILE d < 26 LOOP
           len := 2 + ((u.k + d) % 3)::integer;
           PERFORM hospitality.create_manual_booking(u.id, '${day(1)}'::date + d, '${day(1)}'::date + d + len,
                     'אורח ' || n, '058' || lpad(n::text, 7, '0'), true);
           n := n + 1;
           d := d + len + 1 + ((u.k + d) % 3)::integer;
         END LOOP;
       END LOOP;
     END $$; SELECT 1`,
  );
}

async function open(
  page: Page,
  request: APIRequestContext,
  slug: string,
  path: string,
  who = OWNER,
) {
  await loadSession(page, await passwordSession(request, url(slug), who), path);
}
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// the board shows next month (always fully in the future): day n of next month
const nextMonth = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
})();
const day = (n: number) =>
  new Date(nextMonth.getTime() + (n - 1) * 86400000).toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const bookings: Record<string, string> = {};

test.beforeAll(async ({ request }, testInfo) => {
  // the 300-room hotel is seeded through the real booking engine (~1,500 calls)
  testInfo.setTimeout(240_000);
  const project = testInfo.project.name;
  suffix = testInfo.retry > 0 ? `-r${testInfo.retry}` : "";
  cleanup(project);
  storeHash = storeDataHash();
  for (const u of [OWNER, MANAGER, OTHER]) await ensureUser(request, u);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`,
  );
  for (const [key, slug] of Object.entries(sitesFor(project))) {
    asPlatform(`SELECT hospitality.admin_create_site('${slug}', 'אתר בדיקה ${key}')`);
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    ids[key as SiteKey] = id;
    if (key === "foreign")
      addStaff(id, OTHER, `h3a_other_${project}${suffix.replace("-", "_")}`, true);
    else addStaff(id, OWNER, `h3a_owner_${key}_${project}${suffix.replace("-", "_")}`, true);
    if (key === "main")
      addStaff(id, MANAGER, `h3a_manager_${project}${suffix.replace("-", "_")}`, false);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
    if (key === "foreign") {
      sql(`UPDATE public.user_roles SET is_protected = true WHERE tenant_id = '${id}'`);
      continue;
    }
    if (key === "scale") {
      seedScale(id);
      continue;
    }
    // owner's calls below run as OWNER — on the foreign site OTHER is the owner (no seed there)
    const p = seedProperty(id, "חוות הזית", ["צימר הזית", "צימר האלון", "צימר התמר"]);
    if (key === "main") {
      seedProperty(id, "בית התאנה", ["הבית הגדול"]);
      asOwner(
        id,
        `SELECT hospitality.whole_property_set('${p}', true, ARRAY['${unitIdOf(id, "צימר הזית")}', '${unitIdOf(id, "צימר האלון")}']::uuid[]) ->> 'id'`,
      );
      bookings["confirmed"] = manual(id, unitIdOf(id, "צימר הזית"), day(5), day(7), "דנה כהן");
      bookings["pending"] = manual(
        id,
        unitIdOf(id, "צימר האלון"),
        day(6),
        day(8),
        "יוסי לוי",
        "pending_approval",
      );
      bookings["whole"] = manual(
        id,
        sql(
          `SELECT id FROM hospitality.units WHERE tenant_id = '${id}' AND kind = 'whole_property'`,
        ),
        day(20),
        day(22),
        "משפחת שמש",
      );
      bookings["house"] = manual(id, unitIdOf(id, "הבית הגדול"), day(9), day(11), "רון אבן");
    } else {
      bookings["phone"] = manual(
        id,
        unitIdOf(id, "צימר הזית"),
        plusDays(1),
        plusDays(3),
        "נועה בר",
      );
    }
  }
  for (const slug of Object.values(sitesFor(project)))
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), "/manage/calendar")).status(), {
        timeout: 20_000,
      })
      .toBe(200);
});

test.afterAll(({ request: _request }, testInfo) => {
  cleanup(testInfo.project.name);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

const row = (page: Page, unit: string) => page.locator(`[data-unit-row="${unit}"]`);

test("board: bookings coloured by status, the whole property and its units, filters, search, booking summary", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  await open(page, request, slug, "/manage");
  await page.getByRole("link", { name: "יומן" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "יומן" })).toBeVisible();
  await page.getByRole("button", { name: "הבא" }).click();
  const board = page.getByTestId("calendar-board");
  const n = {
    c: numberOf(bookings["confirmed"]!),
    p: numberOf(bookings["pending"]!),
    w: numberOf(bookings["whole"]!),
  };

  // colours by status + text (not by colour alone)
  const confirmed = row(page, "צימר הזית")
    .locator('[data-bar="booking"][data-status="confirmed"]')
    .first();
  await expect(confirmed).toHaveAccessibleName(new RegExp(`#${n.c} דנה כהן · מאושרת`));
  await expect(
    row(page, "צימר האלון").locator('[data-bar="booking"][data-status="pending_approval"]').first(),
  ).toHaveAccessibleName(new RegExp(`#${n.p} יוסי לוי · ממתינה לאישור`));
  // whole property: its booking on its own row, and on each of its units ("via")
  await expect(
    row(page, "כל המתחם — חוות הזית").getByRole("button", {
      name: new RegExp(`^#${n.w} משפחת שמש · מאושרת$`),
    }),
  ).toBeVisible();
  for (const u of ["צימר הזית", "צימר האלון"])
    await expect(
      row(page, u).getByRole("button", {
        name: new RegExp(`#${n.w} משפחת שמש.*\\(דרך כל המתחם\\)`),
      }),
    ).toBeVisible();
  await expect(row(page, "צימר התמר").locator("[data-bar]")).toHaveCount(0);
  await expect(board.getByText("בית התאנה")).toBeVisible();

  // filters: property; status
  await page.getByLabel("מתחם", { exact: true }).selectOption({ label: "בית התאנה" });
  await expect(row(page, "צימר הזית")).toHaveCount(0);
  await expect(row(page, "הבית הגדול").locator('[data-bar="booking"]')).toHaveCount(1);
  await page.getByLabel("מתחם", { exact: true }).selectOption({ label: "כל המתחמים" });
  await page.getByLabel("מצב", { exact: true }).selectOption({ label: "ממתינה לאישור" });
  await expect(row(page, "צימר הזית").locator('[data-bar="booking"]')).toHaveCount(0);
  await expect(row(page, "צימר האלון").locator('[data-status="pending_approval"]')).toHaveCount(1);
  await page.getByLabel("מצב", { exact: true }).selectOption({ label: "הכול" });

  // search by guest name → the booking's summary (no phone / email on the board)
  await page.getByLabel("חיפוש — מספר הזמנה או שם אורח").fill("שמש");
  await page
    .getByTestId("calendar-search")
    .getByRole("button", { name: new RegExp(`#${n.w}`) })
    .click();
  const panel = page.getByTestId("booking-panel");
  await expect(panel).toContainText("משפחת שמש");
  await expect(panel).toContainText("2 לילות");
  await expect(panel).not.toContainText("054");
  await page.keyboard.press("Escape");
  await page.getByLabel("חיפוש — מספר הזמנה או שם אורח").fill("");

  await expectAccessible(page, "calendar board");
});

test("blocks: two clicks block free nights → not bookable → release → bookable; a block over a booking is refused; the whole property", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const site = ids.main!;
  const tamar = unitIdOf(site, "צימר התמר");
  expect(isFree(site, tamar, day(12), day(14))).toBe("true");
  await open(page, request, slug, "/manage/calendar", MANAGER); // the manager has the bookings permission
  await page.getByRole("button", { name: "הבא" }).click();

  // first night, then last night on the same row → the form, dates filled in
  await row(page, "צימר התמר")
    .locator(`[data-cell="${day(12)}"]`)
    .click();
  await expect(page.getByTestId("board-help")).toContainText("נבחר לילה ראשון");
  await row(page, "צימר התמר")
    .locator(`[data-cell="${day(13)}"]`)
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByLabel("הלילה הראשון")).toHaveValue(day(12));
  await expect(sheet.getByLabel("היציאה (לא כולל)")).toHaveValue(day(14));
  await expect(sheet.getByLabel("יחידה")).toHaveValue(tamar);
  await sheet.getByLabel("סיבה (לא חובה)").fill("שיפוץ");
  await sheet.getByRole("button", { name: "חסימה" }).click();
  await expect(page.getByText("התאריכים נחסמו")).toBeVisible();
  await expect(row(page, "צימר התמר").getByRole("button", { name: "חסום — שיפוץ" })).toBeVisible();
  expect(isFree(site, tamar, day(12), day(14))).toBe("false");
  expect(isFree(site, tamar, day(13), day(15))).toBe("false");
  expect(isFree(site, tamar, day(14), day(15))).toBe("true");
  expect(
    sql(
      `SELECT action FROM hospitality.audit_log WHERE tenant_id = '${site}' ORDER BY id DESC LIMIT 1`,
    ),
  ).toBe("calendar.block_created");
  await expect(page.locator('[data-section="upcoming-blocks"]')).toContainText("צימר התמר");

  // a block over a booking → a clear refusal from the server
  await page.getByRole("button", { name: "חסימת תאריכים" }).click();
  await sheet.getByLabel("יחידה").selectOption({ label: "צימר הזית" });
  await sheet.getByLabel("הלילה הראשון").fill(day(6));
  await sheet.getByLabel("היציאה (לא כולל)").fill(day(7));
  await sheet.getByRole("button", { name: "חסימה" }).click();
  await expect(sheet.getByText("יש הזמנה או חסימה בתאריכים האלה")).toBeVisible();
  await page.keyboard.press("Escape");

  // the whole property: one block holds each of its units
  await page.getByRole("button", { name: "חסימת תאריכים" }).click();
  await sheet.getByLabel("יחידה").selectOption({ label: "כל המתחם — חוות הזית (כל המתחם)" });
  await sheet.getByLabel("הלילה הראשון").fill(day(25));
  await sheet.getByLabel("היציאה (לא כולל)").fill(day(27));
  await sheet.getByRole("button", { name: "חסימה" }).click();
  // (the first block's message may still be on the screen)
  await expect(page.getByText("התאריכים נחסמו").last()).toBeVisible();
  await expect(sheet).toBeHidden();
  for (const u of ["צימר הזית", "צימר האלון"]) {
    await expect(
      row(page, u).getByRole("button", { name: /חסום.*\(דרך כל המתחם\)/ }),
    ).toBeVisible();
    expect(isFree(site, unitIdOf(site, u), day(25), day(26))).toBe("false");
  }
  expect(isFree(site, tamar, day(25), day(26))).toBe("true");

  // release from the board → bookable again at once
  await row(page, "צימר התמר").getByRole("button", { name: "חסום — שיפוץ" }).click();
  await expect(page.getByTestId("block-panel")).toBeVisible();
  await page.getByRole("button", { name: "שחרור החסימה" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "שחרור" }).click();
  await expect(page.getByText("החסימה שוחררה — התאריכים פנויים")).toBeVisible();
  await expect(row(page, "צימר התמר").locator('[data-bar="block"]')).toHaveCount(0);
  expect(isFree(site, tamar, day(12), day(14))).toBe("true");
  expect(
    sql(
      `SELECT released_at IS NOT NULL FROM hospitality.blocks WHERE tenant_id = '${site}' AND reason = 'שיפוץ'`,
    ),
  ).toBe("t");
});

test("one unit's calendar: from the unit page, only that unit (and the whole property it belongs to)", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר הזית");
  await open(page, request, slug, `/manage/units/${unit}`);
  await page.getByRole("link", { name: "יומן היחידה" }).click();
  await expect(page).toHaveURL(new RegExp(`/manage/calendar\\?unit=${unit}`));
  await expect(page.getByLabel("יחידה", { exact: true })).toHaveValue(unit);
  await page.getByRole("button", { name: "הבא" }).click();
  await expect(row(page, "צימר הזית").locator('[data-status="confirmed"]').first()).toBeVisible();
  await expect(row(page, "כל המתחם — חוות הזית")).toHaveCount(1);
  await expect(row(page, "צימר האלון")).toHaveCount(0);
  await expect(row(page, "הבית הגדול")).toHaveCount(0);
});

test("scale: a hotel of 300 rooms and ~1,500 stays — quick to show, only visible rows drawn, scrolls to the last room", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.scale);
  const stays = Number(
    sql(`SELECT count(*) FROM hospitality.bookings WHERE tenant_id = '${ids.scale}'`),
  );
  expect(stays).toBeGreaterThan(1200);
  await open(page, request, slug, "/manage/calendar");
  await expect(page.getByTestId("calendar-board")).toBeVisible();
  const t0 = Date.now();
  await page.getByRole("button", { name: "הבא" }).click();
  await expect(row(page, "חדר 101").locator('[data-bar="booking"]').first()).toBeVisible();
  const ms = Date.now() - t0;
  test.info().annotations.push({ type: "next month, 300 rooms (ms)", description: String(ms) });
  expect(ms).toBeLessThan(3000);
  // virtual rows: only what is on the screen (plus a margin) is in the page
  expect(await page.locator("[data-unit-row]").count()).toBeLessThan(60);
  const board = page.getByTestId("calendar-board");
  await board.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(row(page, "חדר 1030")).toBeVisible();
  await expect(row(page, "חדר 101")).toHaveCount(0);
  expect(await page.locator("[data-unit-row]").count()).toBeLessThan(60);
});

test("auto refresh: a change made elsewhere appears without reloading", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const site = ids.main!;
  await open(page, request, slug, "/manage/calendar");
  await page.getByRole("button", { name: "הבא" }).click();
  await expect(row(page, "הבית הגדול").locator('[data-bar="block"]')).toHaveCount(0);
  asOwner(
    site,
    `SELECT hospitality.block_create('${unitIdOf(site, "הבית הגדול")}', '${day(15)}', '${day(16)}', 'ממקום אחר') ->> 'id'`,
  );
  // switching back to the tab checks for changes at once (and every 30 seconds while open)
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    row(page, "הבית הגדול").getByRole("button", { name: "חסום — ממקום אחר" }),
  ).toBeVisible({
    timeout: 10_000,
  });
});

test("direct calls: anonymous and another site's owner are refused; no data from another site", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר התמר");
  const other = await accessToken(request, OTHER);
  const calls: [string, unknown, "GET" | "POST"][] = [
    [
      "hospitalityCalendar",
      { from: day(1), to: day(28), unitIds: null, includeCancelled: false },
      "POST",
    ],
    [
      "hospitalityCalendarStamp",
      { from: day(1), to: day(28), unitIds: null, includeCancelled: false },
      "POST",
    ],
    ["hospitalityCreateBlock", { unitId: unit, from: day(2), to: day(3), reason: "x" }, "POST"],
    ["hospitalityUpcomingBlocks", undefined, "GET"],
  ];
  for (const [who, token] of [
    ["anonymous", undefined],
    ["other site's owner", other],
  ] as const)
    for (const [name, data, method] of calls) {
      const res = await callServerFn(request, {
        host: hostOf(slug),
        file: FN,
        name,
        data,
        token,
        method,
      });
      expect(await res.text(), `${who} ${name}`).toMatch(/נדרשת התחברות|אין הרשאה/);
    }
  // on their own site, the other owner sees only their own (empty) calendar and cannot block our unit
  const own = await callServerFn(request, {
    host: hostOf(slugOf(DESKTOP_SITES.foreign)),
    file: FN,
    name: "hospitalityCalendar",
    data: { from: day(1), to: day(28), unitIds: null, includeCancelled: false },
    token: other,
    method: "POST",
  });
  const text = await own.text();
  expect(text).not.toContain("דנה כהן");
  expect(text).not.toContain("צימר");
  const block = await callServerFn(request, {
    host: hostOf(slugOf(DESKTOP_SITES.foreign)),
    file: FN,
    name: "hospitalityCreateBlock",
    data: { unitId: unit, from: day(2), to: day(3), reason: "x" },
    token: other,
    method: "POST",
  });
  expect(await block.text()).toContain("היחידה לא נמצאה");
  expect(
    sql(
      `SELECT count(*) FROM hospitality.blocks WHERE unit_id = '${unit}' AND released_at IS NULL`,
    ),
  ).toBe("0");
  // blocks are written only through the functions (migration 14)
  expect(
    sql(
      `SELECT has_table_privilege('authenticated', 'hospitality.blocks', 'INSERT') OR has_table_privilege('authenticated', 'hospitality.blocks', 'UPDATE')`,
    ),
  ).toBe("f");
});

test("@mobile phone: the day-by-day agenda by default, the board scrolls inside its box, accessible", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone flow");
  const slug = slugOf(MOBILE_SITES.phone);
  await open(page, request, slug, "/manage/calendar");
  const agendaList = page.getByTestId("calendar-agenda");
  await expect(agendaList).toBeVisible();
  await expect(agendaList).toContainText("מגיעים");
  await expect(agendaList).toContainText("נועה בר");
  expect(await noSideways(page)).toBe(true);
  await expectAccessible(page, "phone: calendar agenda");
  await agendaList.getByRole("button", { name: /מגיעים.*נועה בר/ }).click();
  await expect(page.getByTestId("booking-panel")).toContainText("2 לילות");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "שבוע", exact: true }).click();
  await expect(page.getByTestId("calendar-board")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
});

test("Ecommerce untouched: store data unchanged", ({ request: _request }) => {
  expect(storeDataHash()).toBe(storeHash);
});
