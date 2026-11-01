import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { hostGet, hostOf, PORT, STORE_A, USERS } from "./helpers";
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

// Hospitality Stage 2c.3 — עמוד היחידה, עמוד המתחם, "השכרת המתחם כולו", סדר היחידות,
// הפעלה / השבתה, ארכיון / החזרה / מחיקה (בעלים בלבד) — על השרת הבנוי, דרך הממשק
// האמיתי ובקריאות ישירות לשרת:
//   • שמירה עם הגרסה שנטענה; "עודכן בינתיים" (שני דפדפנים, או שינוי ישיר בשרת) — הודעה
//     ברורה, ושום שינוי של משתמש אחר לא נדרס (גם בפעולות: השבתה, "כל המתחם", סדר);
//   • כללי המסד נשמרים: מגבלת החבילה, יחידה בתוך "כל המתחם", הזמנות / חסימות עתידיות,
//     מחיקה רק בלי היסטוריה;
//   • מנהל: הכול חוץ מארכיון ומחיקה (גם בממשק וגם בקריאה ישירה); זרים — נחסמים;
//   • טלפון, נגישות, ובלי שום שינוי בחנויות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h2c3.owner@e2e.test", password: "H2c3-Owner-Pass-1!" };
const MANAGER = { email: "h2c3.manager@e2e.test", password: "H2c3-Manager-Pass-1!" };
const OTHER = { email: "h2c3.other@e2e.test", password: "H2c3-Other-Pass-1!" };
const FN_FILE = "src/engines/hospitality/api/catalog.functions.ts";

const DESKTOP_SITES = {
  main: "h2c3-main",
  hotel: "h2c3-hotel",
  limit: "h2c3-limit",
  foreign: "h2c3-foreign",
  empty: "h2c3-empty",
  single: "h2c3-single",
} as const;
const MOBILE_SITES = { phone: "h2c3-m" } as const;
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
  for (const row of sql(`SELECT id || '|' || slug FROM public.tenants
                          WHERE slug ~ '^h2c3-' AND site_type = 'hospitality'`)
    .split("\n")
    .filter(Boolean)) {
    const [id, slug] = row.split("|") as [string, string];
    if (prefixes.some((p) => slug === p || slug.startsWith(`${p}-r`)))
      asPlatform(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
}

function addStaff(site: string, account: Account, username: string, owner: boolean) {
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${site}', id, email, '${username}', 'admin', true, ${owner}
         FROM auth.users WHERE email = '${account.email}'`);
}

/** מתחם ויחידות ישירות במסד (נתוני הבדיקה; הכתיבה של הצוות — רק דרך הפונקציות) */
function seedProperty(
  site: string,
  name: string,
  type: string,
  units: { name: string; active?: boolean; kind?: "unit" | "room"; type?: string }[],
  status = "active",
): { id: string; units: Record<string, string> } {
  const tag = Math.random().toString(36).slice(2, 8);
  const id = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
                  VALUES ('${site}', '${name}', 'p-${tag}', '${status}', '${type}') RETURNING id`);
  const out: Record<string, string> = {};
  units.forEach((u, i) => {
    out[u.name] = sql(`INSERT INTO hospitality.units
        (tenant_id, property_id, kind, unit_type, name, slug, sort_order, is_active)
      VALUES ('${site}', '${id}', '${u.kind ?? "unit"}', '${u.type ?? "zimmer"}', '${u.name}',
              'u-${tag}-${i}', ${i}, ${u.active ?? true}) RETURNING id`);
  });
  return { id, units: out };
}

const unitIdOf = (site: string, name: string) =>
  sql(`SELECT id FROM hospitality.units WHERE tenant_id = '${site}' AND name = '${name}'`);
const propertyIdOf = (site: string, name: string) =>
  sql(`SELECT id FROM hospitality.properties WHERE tenant_id = '${site}' AND name = '${name}'`);
const unitRev = (id: string) =>
  Number(sql(`SELECT revision FROM hospitality.units WHERE id = '${id}'`));
const propertyRev = (id: string) =>
  Number(sql(`SELECT revision FROM hospitality.properties WHERE id = '${id}'`));
const wholeOf = (property: string) =>
  sql(
    `SELECT id FROM hospitality.units WHERE property_id = '${property}' AND kind = 'whole_property'`,
  );
const membersOf = (whole: string) =>
  sql(`SELECT string_agg(u.name, ',' ORDER BY u.name) FROM hospitality.unit_members m
         JOIN hospitality.units u ON u.id = m.member_unit_id WHERE m.parent_unit_id = '${whole}'`);
const activeOrder = (property: string) =>
  sql(`SELECT string_agg(name, ',' ORDER BY sort_order, created_at) FROM hospitality.units
        WHERE property_id = '${property}' AND kind <> 'whole_property' AND is_active`);
const activeIds = (property: string) =>
  sql(`SELECT string_agg(id::text, ',' ORDER BY sort_order, created_at) FROM hospitality.units
        WHERE property_id = '${property}' AND kind <> 'whole_property' AND is_active`).split(",");

const catalogFn = (
  request: APIRequestContext,
  slug: string,
  name: string,
  token?: string,
  data?: unknown,
  method: "GET" | "POST" = "POST",
) => callServerFn(request, { host: hostOf(slug), file: FN_FILE, name, data, token, method });

async function open(
  page: Page,
  request: APIRequestContext,
  slug: string,
  path: string,
  who = OWNER,
) {
  const session = await passwordSession(request, url(slug), who);
  await loadSession(page, session, path);
}

const textbox = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });
const notice = (page: Page) => page.getByTestId("page-notice");
const dialog = (page: Page) => page.getByRole("alertdialog");
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const usedUnits = async (page: Page) =>
  Number(/^(\d+)/.exec((await page.getByTestId("units-limit").textContent()) ?? "")?.[1]);

async function twoBrowsers(
  browser: Browser,
  request: APIRequestContext,
  slug: string,
  path: string,
) {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await open(pa, request, slug, path);
  await open(pb, request, slug, path);
  return { pa, pb, close: () => Promise.all([a.close(), b.close()]) };
}

test.beforeAll(async ({ request }, testInfo) => {
  const project = testInfo.project.name;
  suffix = testInfo.retry > 0 ? `-r${testInfo.retry}` : "";
  cleanup(project);
  storeHash = storeDataHash();
  for (const u of [OWNER, MANAGER, OTHER]) await ensureUser(request, u);
  sql(`UPDATE public.platform_feature_flags SET enabled = true
        WHERE key IN ('hospitality_backend_enabled', 'hospitality_management_enabled')`);
  for (const [key, slug] of Object.entries(sitesFor(project))) {
    asPlatform(`SELECT hospitality.admin_create_site('${slug}', 'אתר בדיקה ${key}')`);
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
    ids[key as SiteKey] = id;
    if (key === "foreign") addStaff(id, OTHER, `h2c3_other_${project}${suffix}`, true);
    else addStaff(id, OWNER, `h2c3_owner_${key}_${project}${suffix}`, true);
    if (key === "main") addStaff(id, MANAGER, `h2c3_manager_${project}${suffix}`, false);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
  }
  if (project === "mobile") {
    seedProperty(ids.phone!, "וילות בכרם", "vacation_apartments", [
      { name: "וילה אדומה", type: "villa" },
      { name: "וילה ירוקה", type: "villa" },
      { name: "וילה כחולה", type: "villa" },
    ]);
  } else {
    seedProperty(ids.main!, "צימרי הגליל", "zimmer_complex", [
      { name: "צימר הגפן" },
      { name: "צימר האלון" },
      { name: "צימר התאנה" },
      { name: "סוויטת הנוף", type: "suite" },
    ]);
    const archive = seedProperty(ids.main!, "מתחם לארכיון", "zimmer_complex", [
      { name: "בקתה א", type: "cabin" },
      { name: "בקתה ב", type: "cabin" },
    ]);
    seedProperty(ids.main!, "מתחם למחיקה", "other", [{ name: "בקתה ג", type: "cabin" }]);
    seedProperty(
      ids.main!,
      "מתחם ישן",
      "other",
      [{ name: "בקתה ישנה", active: false }],
      "archived",
    );
    // בקתה א הוזמנה / נחסמה בעבר — אסור למחוק אותה (ואת המתחם שלה)
    sql(`INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason)
         VALUES ('${ids.main}', '${archive.units["בקתה א"]}', current_date - 30, current_date - 28, 'שיפוץ')`);
    seedProperty(ids.hotel!, "מלון הנמל", "boutique_hotel", [
      { name: "חדר 1", kind: "room", type: "room" },
      { name: "חדר 2", kind: "room", type: "room" },
      { name: "חדר 3", kind: "room", type: "room" },
      { name: "חדר 4", kind: "room", type: "room" },
      { name: "חדר 5", kind: "room", type: "room", active: false },
    ]);
    seedProperty(
      ids.limit!,
      "מלון מלא",
      "boutique_hotel",
      Array.from({ length: 21 }, (_, i) => ({
        name: `חדר ${i + 1}`,
        kind: "room" as const,
        type: "room",
        active: i < 20,
      })),
    );
    seedProperty(ids.foreign!, "מתחם זר", "other", [{ name: "יחידה זרה" }]);
    seedProperty(ids.single!, "בקתת האורן", "zimmer", [{ name: "בקתת האורן", type: "cabin" }]);
  }
  for (const slug of Object.values(sitesFor(project))) {
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), "/manage/units")).status(), {
        timeout: 20_000,
      })
      .toBe(200);
  }
});

test.afterAll(({ request: _request }, testInfo) => {
  cleanup(testInfo.project.name);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("unit page: from the list, every section, unsaved changes ask before leaving, saved and shown after reload", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  await open(page, request, slug, "/manage/units");
  await page.locator('li[data-unit="צימר הגפן"]').getByRole("link", { name: "צימר הגפן" }).click();
  await expect(page).toHaveURL(new RegExp(`/manage/units/${unitIdOf(ids.main!, "צימר הגפן")}$`));
  await expect(page.getByRole("heading", { level: 1, name: "צימר הגפן" })).toBeVisible();
  // "יחידות" stays marked in the navigation on the unit page
  await expect(
    page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "יחידות" }),
  ).toHaveAttribute("aria-current", "page");
  for (const section of ["פרטים", "אורחים", "חדרים", "מצב היחידה", "מחיקת היחידה"])
    await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
  await expectAccessible(page, "unit page");

  await textbox(page, "שם היחידה").fill("צימר הגפן הזוגי");
  await textbox(page, "תיאור היחידה").fill("צימר זוגי עם ג׳קוזי ונוף לגליל.");
  await textbox(page, "מספר האורחים המרבי").fill("3");
  await textbox(page, "חדרי רחצה").fill("2");
  await expect(page.getByText("יש שינויים שלא נשמרו")).toBeVisible();

  // leaving with unsaved changes asks first — stay
  await page.getByRole("link", { name: "חזרה ליחידות ומתחמים" }).click();
  await expect(dialog(page)).toContainText("לצאת בלי לשמור?");
  await dialog(page).getByRole("button", { name: "להישאר ולשמור" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "צימר הגפן" })).toBeVisible();

  // the server refuses what the database refuses — the message next to the field first
  await textbox(page, "כמה אורחים כלולים במחיר").fill("4");
  await expect(
    page.getByText("מספר האורחים הכלולים במחיר לא יכול להיות גדול ממספר האורחים המרבי"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "שמירה" })).toBeDisabled();
  await textbox(page, "כמה אורחים כלולים במחיר").fill("2");

  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("היחידה נשמרה")).toBeVisible();
  await expect(page.getByText("אין שינויים")).toBeVisible();
  await page.reload();
  await expect(textbox(page, "שם היחידה")).toHaveValue("צימר הגפן הזוגי");
  await expect(textbox(page, "מספר האורחים המרבי")).toHaveValue("3");
  expect(
    sql(`SELECT name || '|' || capacity || '|' || bathrooms || '|' || revision
           FROM hospitality.units WHERE id = '${unitIdOf(ids.main!, "צימר הגפן הזוגי")}'`),
  ).toBe("צימר הגפן הזוגי|3|2|2");
  // back to the list: the new name is there, and leaving without changes does not ask
  await page.getByRole("link", { name: "חזרה ליחידות ומתחמים" }).click();
  await expect(page.locator('li[data-unit="צימר הגפן הזוגי"]')).toContainText("עד 3 אורחים");
  // an unknown unit id: a plain "not found", nothing about other sites
  await page.goto(url(slug, "/manage/units/6a1e0000-0000-4000-8000-000000000999"));
  await expect(page.getByRole("heading", { level: 1, name: "היחידה לא נמצאה" })).toBeVisible();
});

test("unit page — updated in the meantime: two browsers, merged, nothing overwritten", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const unit = unitIdOf(ids.main!, "צימר האלון");
  const before = unitRev(unit);
  const { pa, pb, close } = await twoBrowsers(
    browser,
    request,
    slugOf(DESKTOP_SITES.main),
    `/manage/units/${unit}`,
  );
  await textbox(pa, "שם היחידה").fill("צימר האלון הגדול");
  await pa.getByRole("button", { name: "שמירה" }).click();
  await expect(pa.getByText("היחידה נשמרה")).toBeVisible();

  await textbox(pb, "שם היחידה").fill("שם אחר");
  await textbox(pb, "חדרי שינה").fill("3");
  await pb.getByRole("button", { name: "שמירה" }).click();
  await expect(notice(pb)).toContainText("היחידה עודכנה בינתיים על ידי משתמש אחר");
  await expect(notice(pb)).toContainText("השינוי שלך בשם היחידה לא נשמר");
  await expect(textbox(pb, "שם היחידה")).toHaveValue("צימר האלון הגדול");
  await expect(textbox(pb, "חדרי שינה")).toHaveValue("3");
  await pb.getByRole("button", { name: "שמירה" }).click();
  await expect(pb.getByText("היחידה נשמרה")).toBeVisible();
  expect(
    sql(
      `SELECT name || '|' || bedrooms || '|' || revision FROM hospitality.units WHERE id = '${unit}'`,
    ),
  ).toBe(`צימר האלון הגדול|3|${before + 2}`);
  await close();
});

test("deactivate and activate: confirmation, the inactive group, plan places; a change made meanwhile is not overwritten", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "סוויטת הנוף");
  await open(page, request, slug, "/manage/units");
  const usedBefore = await usedUnits(page);

  await page.goto(url(slug, `/manage/units/${unit}`));
  await page.getByRole("button", { name: "השבתת היחידה" }).click();
  await expect(dialog(page)).toContainText("להשבית את סוויטת הנוף?");
  await expect(dialog(page)).toContainText("הזמנות קיימות נשמרות");
  await dialog(page).getByRole("button", { name: "השבתה" }).click();
  await expect(page.getByText("היחידה הושבתה")).toBeVisible();
  await expect(page.getByRole("button", { name: "הפעלת היחידה" })).toBeVisible();
  expect(sql(`SELECT is_active FROM hospitality.units WHERE id = '${unit}'`)).toBe("f");

  // the list: not among the active units; in the inactive group; one plan place freed
  await page.getByRole("link", { name: "חזרה ליחידות ומתחמים" }).click();
  const card = page.locator('[data-property="צימרי הגליל"]');
  await expect(card.getByRole("list", { name: "היחידות בצימרי הגליל" })).not.toContainText(
    "סוויטת הנוף",
  );
  await card.getByRole("button", { name: "יחידות לא פעילות (1)" }).click();
  await expect(
    card
      .getByRole("list", { name: "יחידות לא פעילות בצימרי הגליל" })
      .locator('li[data-unit="סוויטת הנוף"]'),
  ).toContainText("לא פעילה");
  expect(await usedUnits(page)).toBe(usedBefore - 1);

  // someone changes the unit while this page is open → "activate" is not done, the page refreshes
  await page.goto(url(slug, `/manage/units/${unit}`));
  const update = await catalogFn(
    request,
    slug,
    "hospitalityUpdateUnit",
    await accessToken(request, OWNER),
    {
      id: unit,
      changes: { description: "סוויטה עם מרפסת" },
      revision: unitRev(unit),
    },
  );
  expect(await update.text()).toContain('"saved"');
  await page.getByRole("button", { name: "הפעלת היחידה" }).click();
  await expect(notice(page)).toContainText("היחידה עודכנה בינתיים על ידי משתמש אחר");
  await expect(notice(page)).toContainText("הפעולה לא בוצעה");
  await expect(textbox(page, "תיאור היחידה")).toHaveValue("סוויטה עם מרפסת");
  expect(sql(`SELECT is_active FROM hospitality.units WHERE id = '${unit}'`)).toBe("f");
  // now with the fresh data
  await page.getByRole("button", { name: "הפעלת היחידה" }).click();
  await expect(page.getByText("היחידה הופעלה")).toBeVisible();
  expect(sql(`SELECT is_active FROM hospitality.units WHERE id = '${unit}'`)).toBe("t");
  expect(
    sql(`SELECT string_agg(action, ',' ORDER BY id) FROM hospitality.audit_log
          WHERE tenant_id = '${ids.main}' AND target_label = 'סוויטת הנוף'
            AND action IN ('catalog.unit_deactivated', 'catalog.unit_activated')`),
  ).toBe("catalog.unit_deactivated,catalog.unit_activated");
});

test("plan limit: activation is not offered at the limit, and the server refuses it too", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.limit);
  const unit = unitIdOf(ids.limit!, "חדר 21");
  await open(page, request, slug, `/manage/units/${unit}`);
  await expect(page.getByText("הגעתם למגבלת היחידות בחבילה")).toBeVisible();
  await expect(page.getByRole("button", { name: "הפעלת היחידה" })).toBeDisabled();
  const res = await catalogFn(
    request,
    slug,
    "hospitalitySetUnitActive",
    await accessToken(request, OWNER),
    {
      id: unit,
      active: true,
      revision: unitRev(unit),
    },
  );
  expect(await res.text()).toContain("הגעתם למגבלת היחידות בחבילה (20)");
  expect(sql(`SELECT is_active FROM hospitality.units WHERE id = '${unit}'`)).toBe("f");
});

test("rent the whole property: on with chosen units, at least two, members guarded, another user's choice kept, future bookings respected, off", async ({
  browser,
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const property = propertyIdOf(ids.main!, "צימרי הגליל");
  await open(page, request, slug, `/manage/properties/${property}`);
  await expect(page.getByRole("heading", { level: 1, name: "צימרי הגליל" })).toBeVisible();
  await expectAccessible(page, "property page");
  const sw = page.getByRole("switch", { name: "השכרת המתחם כולו" });
  await expect(sw).not.toBeChecked();
  await sw.click();
  for (const name of ["צימר הגפן הזוגי", "צימר האלון הגדול", "צימר התאנה", "סוויטת הנוף"])
    await expect(page.getByRole("checkbox", { name })).toBeChecked();
  for (const name of ["צימר האלון הגדול", "צימר התאנה", "סוויטת הנוף"])
    await page.getByRole("checkbox", { name }).click();
  await expect(page.getByText("יש לבחור לפחות שתי יחידות פעילות מהמתחם")).toBeVisible();
  await expect(page.getByRole("button", { name: "שמירת ההשכרה" })).toBeDisabled();
  // the server refuses one unit as well
  const one = await catalogFn(
    request,
    slug,
    "hospitalitySetWholeProperty",
    await accessToken(request, OWNER),
    {
      propertyId: property,
      enabled: true,
      memberIds: [unitIdOf(ids.main!, "צימר התאנה")],
      revision: null,
    },
  );
  expect(await one.text()).toContain("יש לבחור לפחות שתי יחידות פעילות מהמתחם");
  await page.getByRole("checkbox", { name: "צימר האלון הגדול" }).click();
  await page.getByRole("checkbox", { name: "צימר התאנה" }).click();
  await page.getByRole("button", { name: "שמירת ההשכרה" }).click();
  await expect(page.getByText("השכרת המתחם כולו הופעלה")).toBeVisible();
  const whole = wholeOf(property);
  expect(membersOf(whole)).toBe("צימר האלון הגדול,צימר הגפן הזוגי,צימר התאנה");

  // a member of the active whole property: deactivation explained, and refused by the server
  const member = unitIdOf(ids.main!, "צימר התאנה");
  await page.goto(url(slug, `/manage/units/${member}`));
  await expect(page.getByText('היחידה כלולה ב"כל המתחם" הפעיל')).toBeVisible();
  await expect(page.getByRole("button", { name: "השבתת היחידה" })).toBeDisabled();
  const off = await catalogFn(
    request,
    slug,
    "hospitalitySetUnitActive",
    await accessToken(request, OWNER),
    {
      id: member,
      active: false,
      revision: unitRev(member),
    },
  );
  // (the answer is serialized: the quotes around "כל המתחם" arrive escaped)
  expect(await off.text()).toMatch(/היחידה כלולה ב.{1,8}כל המתחם.{1,8} הפעיל/);
  // and the list shows the whole property with its three units
  await page.goto(url(slug, "/manage/units"));
  await expect(page.locator(`li[data-unit="כל המתחם — צימרי הגליל"]`)).toContainText(
    "הזמנה אחת ל-3 יחידות",
  );

  // two browsers: A adds a unit and saves; B (stale) removes another → not saved, B refreshed
  const { pa, pb, close } = await twoBrowsers(
    browser,
    request,
    slug,
    `/manage/properties/${property}`,
  );
  await pa.getByRole("checkbox", { name: "סוויטת הנוף" }).click();
  await pa.getByRole("button", { name: "שמירת ההשכרה" }).click();
  await expect(pa.getByText('היחידות של "כל המתחם" עודכנו')).toBeVisible();
  await pb.getByRole("checkbox", { name: "צימר התאנה" }).click();
  await pb.getByRole("button", { name: "שמירת ההשכרה" }).click();
  await expect(
    pb.getByRole("status").filter({ hasText: "עודכנה בינתיים על ידי משתמש אחר" }),
  ).toBeVisible();
  await expect(pb.getByRole("checkbox", { name: "צימר התאנה" })).toBeChecked();
  await expect(pb.getByRole("checkbox", { name: "סוויטת הנוף" })).toBeChecked();
  expect(membersOf(whole)).toBe("סוויטת הנוף,צימר האלון הגדול,צימר הגפן הזוגי,צימר התאנה");

  // a future block on the whole property: its units cannot change (database rule, Hebrew message)
  const block =
    sql(`INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason)
       VALUES ('${ids.main}', '${whole}', current_date + 20, current_date + 22, 'אירוע') RETURNING id`);
  await pa.reload();
  await pa.getByRole("checkbox", { name: "סוויטת הנוף" }).click();
  await pa.getByRole("button", { name: "שמירת ההשכרה" }).click();
  await expect(
    pa.getByRole("alert").filter({
      hasText: 'יש הזמנות או חסימות עתידיות ל"כל המתחם" — אי אפשר לשנות את היחידות שבו',
    }),
  ).toBeVisible();
  expect(membersOf(whole)).toBe("סוויטת הנוף,צימר האלון הגדול,צימר הגפן הזוגי,צימר התאנה");
  sql(`DELETE FROM hospitality.blocks WHERE id = '${block}'`);
  await close();

  // off: the whole property stays in the database (bookings kept), inactive
  await page.goto(url(slug, `/manage/properties/${property}`));
  await page.getByRole("switch", { name: "השכרת המתחם כולו" }).click();
  await page.getByRole("button", { name: "שמירת ההשכרה" }).click();
  await expect(page.getByText("השכרת המתחם כולו כובתה")).toBeVisible();
  expect(sql(`SELECT is_active FROM hospitality.units WHERE id = '${whole}'`)).toBe("f");
});

test("unit order: arrows from the keyboard and drag, saved at once; an order changed meanwhile is not overwritten", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.hotel);
  const property = propertyIdOf(ids.hotel!, "מלון הנמל");
  await open(page, request, slug, "/manage/units");
  const card = page.locator('[data-property="מלון הנמל"]');
  await card.getByRole("button", { name: /^סידור היחידות/ }).click();
  const order = page.getByTestId("unit-order");
  await expect(order.locator("li")).toHaveCount(4); // the inactive room is not ordered
  await expectAccessible(page, "unit order");

  const up4 = order.getByRole("button", { name: "הזזת חדר 4 למעלה" });
  await up4.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => activeOrder(property)).toBe("חדר 1,חדר 2,חדר 4,חדר 3");
  await expect(up4).toBeEnabled();
  await up4.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => activeOrder(property)).toBe("חדר 1,חדר 4,חדר 2,חדר 3");
  await expect(page.getByText("חדר 4 — מקום 2 מתוך 4. הסדר נשמר.")).toBeAttached();

  await order.locator('li[data-unit="חדר 1"]').dragTo(order.locator('li[data-unit="חדר 3"]'));
  await expect.poll(() => activeOrder(property)).toBe("חדר 4,חדר 2,חדר 3,חדר 1");

  // someone else orders the rooms meanwhile → this move is not saved, the list refreshes
  const current = activeIds(property);
  const theirs = [current[3]!, current[2]!, current[1]!, current[0]!];
  const res = await catalogFn(
    request,
    slug,
    "hospitalityReorderUnits",
    await accessToken(request, OWNER),
    {
      propertyId: property,
      expected: current,
      ids: theirs,
    },
  );
  expect(await res.text()).toContain('"done"');
  await order.getByRole("button", { name: "הזזת חדר 2 למטה" }).click();
  await expect(order.getByRole("status")).toContainText(
    "סדר היחידות שונה בינתיים על ידי משתמש אחר",
  );
  await expect(order.locator("li").first()).toHaveAttribute("data-unit", "חדר 1");
  expect(activeOrder(property)).toBe("חדר 1,חדר 3,חדר 2,חדר 4");

  await order.getByRole("button", { name: "סיום הסידור" }).click();
  await page.reload();
  await expect(
    card.getByRole("list", { name: "היחידות במלון הנמל" }).locator("li").first(),
  ).toHaveAttribute("data-unit", "חדר 1");
  await expect(card.getByRole("button", { name: "יחידות לא פעילות (1)" })).toBeVisible();
});

test("property page: details and draft saved; updated in the meantime merged", async ({
  browser,
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const property = propertyIdOf(ids.main!, "צימרי הגליל");
  await open(page, request, slug, "/manage/units");
  await page
    .locator('[data-property="צימרי הגליל"]')
    .getByRole("link", { name: /^ניהול המתחם/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/manage/properties/${property}$`));
  await textbox(page, "כתובת").fill("מושב דלתון, הגליל העליון");
  await page.getByRole("radio", { name: /טיוטה/ }).check();
  await page.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByText("המתחם נשמר")).toBeVisible();
  await page.getByRole("link", { name: "חזרה ליחידות ומתחמים" }).click();
  await expect(page.locator('[data-property="צימרי הגליל"]')).toContainText(
    "טיוטה — לא יוצג לאורחים",
  );

  const { pa, pb, close } = await twoBrowsers(
    browser,
    request,
    slug,
    `/manage/properties/${property}`,
  );
  await textbox(pa, "תיאור המתחם").fill("ארבעה צימרים בין כרמים.");
  await pa.getByRole("button", { name: "שמירה" }).click();
  await expect(pa.getByText("המתחם נשמר")).toBeVisible();
  await textbox(pb, "תיאור המתחם").fill("תיאור אחר");
  await pb.getByRole("radio", { name: /^פעיל/ }).check();
  await pb.getByRole("button", { name: "שמירה" }).click();
  await expect(notice(pb)).toContainText("המתחם עודכן בינתיים על ידי משתמש אחר");
  await expect(notice(pb)).toContainText("השינוי שלך בתיאור המתחם לא נשמר");
  await expect(textbox(pb, "תיאור המתחם")).toHaveValue("ארבעה צימרים בין כרמים.");
  await pb.getByRole("button", { name: "שמירה" }).click();
  await expect(pb.getByText("המתחם נשמר")).toBeVisible();
  expect(
    sql(`SELECT description || '|' || status FROM hospitality.properties WHERE id = '${property}'`),
  ).toBe("ארבעה צימרים בין כרמים.|active");
  await close();
});

test("owner: archive (refused with future bookings), the archive list, restore; delete only without history", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const owner = await accessToken(request, OWNER);
  const property = propertyIdOf(ids.main!, "מתחם לארכיון");
  const cabinB = unitIdOf(ids.main!, "בקתה ב");

  // a future block → archive refused (database rule), nothing changed
  const block = sql(`INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date)
       VALUES ('${ids.main}', '${cabinB}', current_date + 5, current_date + 7) RETURNING id`);
  await open(page, request, slug, `/manage/properties/${property}`);
  await page.getByRole("button", { name: "העברה לארכיון" }).click();
  await dialog(page).getByRole("button", { name: "העברה לארכיון" }).click();
  await expect(notice(page)).toContainText("יש במתחם הזמנות או חסימות עתידיות");
  expect(sql(`SELECT status FROM hospitality.properties WHERE id = '${property}'`)).toBe("active");
  sql(`DELETE FROM hospitality.blocks WHERE id = '${block}'`);

  await page.reload();
  await page.getByRole("button", { name: "העברה לארכיון" }).click();
  await expect(dialog(page)).toContainText("כל היחידות שבו יושבתו");
  await dialog(page).getByRole("button", { name: "העברה לארכיון" }).click();
  await expect(page.getByText("המתחם הועבר לארכיון")).toBeVisible();
  await expect(page.getByRole("button", { name: "החזרה מהארכיון" })).toBeVisible();
  expect(
    sql(`SELECT p.status || '|' || bool_or(u.is_active) FROM hospitality.properties p
           JOIN hospitality.units u ON u.property_id = p.id WHERE p.id = '${property}' GROUP BY p.status`),
  ).toBe("archived|false");

  // delete: "בקתה א" was blocked in the past → explained, and refused by the server
  await expect(page.getByText("במתחם יש יחידות עם הזמנות או חסימות")).toBeVisible();
  await expect(page.getByRole("button", { name: "מחיקה לצמיתות" })).toBeDisabled();
  const refused = await catalogFn(request, slug, "hospitalityDeleteProperty", owner, {
    id: property,
    revision: propertyRev(property),
  });
  expect(await refused.text()).toContain("במתחם יש יחידות עם הזמנות או חסימות");

  // the list hides it; the owner finds it under "בארכיון"
  await page.getByRole("link", { name: "חזרה ליחידות ומתחמים" }).click();
  await expect(page.locator('[data-property="מתחם לארכיון"]')).toHaveCount(0);
  await page.getByRole("button", { name: "2 מתחמים בארכיון" }).click();
  await page.locator('li[data-archived="מתחם לארכיון"]').getByRole("link").click();
  await page.getByRole("button", { name: "החזרה מהארכיון" }).click();
  await expect(page.getByText("המתחם הוחזר מהארכיון")).toBeVisible();
  expect(sql(`SELECT status FROM hospitality.properties WHERE id = '${property}'`)).toBe("active");
  expect(sql(`SELECT is_active FROM hospitality.units WHERE id = '${cabinB}'`)).toBe("f");

  // delete a unit never booked → gone; one with history → explained and refused
  await page.goto(url(slug, `/manage/units/${cabinB}`));
  await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
  await expect(dialog(page)).toContainText("אי אפשר לבטל את זה");
  await dialog(page).getByRole("button", { name: "מחיקה לצמיתות" }).click();
  await expect(page).toHaveURL(/\/manage\/units$/);
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE id = '${cabinB}'`)).toBe("0");
  const cabinA = unitIdOf(ids.main!, "בקתה א");
  await page.goto(url(slug, `/manage/units/${cabinA}`));
  await expect(page.getByText("ליחידה יש הזמנות או חסימות")).toBeVisible();
  await expect(page.getByRole("button", { name: "מחיקה לצמיתות" })).toBeDisabled();
  const kept = await catalogFn(request, slug, "hospitalityDeleteUnit", owner, {
    id: cabinA,
    revision: unitRev(cabinA),
  });
  expect(await kept.text()).toContain("ליחידה יש הזמנות או חסימות");

  // delete a property never booked → gone with its unit
  const doomed = propertyIdOf(ids.main!, "מתחם למחיקה");
  await page.goto(url(slug, `/manage/properties/${doomed}`));
  await page.getByRole("button", { name: "מחיקה לצמיתות" }).click();
  await dialog(page).getByRole("button", { name: "מחיקה לצמיתות" }).click();
  await expect(page).toHaveURL(/\/manage\/units$/);
  expect(
    sql(`SELECT count(*) FROM hospitality.units u JOIN hospitality.properties p ON p.id = u.property_id
          WHERE p.id = '${doomed}'`),
  ).toBe("0");
  expect(sql(`SELECT count(*) FROM hospitality.properties WHERE id = '${doomed}'`)).toBe("0");
});

test("a manager: pages, order and activation — yes; archive and delete — not on the screen and refused by the server", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const manager = await accessToken(request, MANAGER);
  const property = propertyIdOf(ids.main!, "צימרי הגליל");
  const unit = unitIdOf(ids.main!, "צימר התאנה");
  await open(page, request, slug, `/manage/properties/${property}`, MANAGER);
  await expect(page.getByRole("heading", { level: 2, name: "השכרת המתחם כולו" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "ארכיון ומחיקה" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ארכיון|מחיקה/ })).toHaveCount(0);

  await page.goto(url(slug, `/manage/units/${unit}`));
  await expect(page.getByRole("heading", { level: 2, name: "מחיקת היחידה" })).toHaveCount(0);
  await page.getByRole("button", { name: "השבתת היחידה" }).click();
  await dialog(page).getByRole("button", { name: "השבתה" }).click();
  await expect(page.getByText("היחידה הושבתה")).toBeVisible();
  await page.getByRole("button", { name: "הפעלת היחידה" }).click();
  await expect(page.getByText("היחידה הופעלה")).toBeVisible();
  expect(
    sql(`SELECT string_agg(DISTINCT actor_role, ',') FROM hospitality.audit_log
          WHERE tenant_id = '${ids.main}' AND target_label = 'צימר התאנה'
            AND action IN ('catalog.unit_deactivated', 'catalog.unit_activated')`),
  ).toBe("manager");

  // owner-only actions by a direct call: refused, nothing changed
  for (const [name, data, message] of [
    [
      "hospitalityArchiveProperty",
      { id: property, revision: propertyRev(property) },
      "רק בעל העסק יכול להעביר מתחם לארכיון",
    ],
    [
      "hospitalityDeleteProperty",
      { id: property, revision: propertyRev(property) },
      "רק בעל העסק יכול למחוק מתחם",
    ],
    [
      "hospitalityDeleteUnit",
      { id: unit, revision: unitRev(unit) },
      "רק בעל העסק יכול למחוק יחידה",
    ],
  ] as const) {
    const res = await catalogFn(request, slug, name, manager, data);
    expect(await res.text(), name).toContain(message);
  }
  expect(sql(`SELECT status FROM hospitality.properties WHERE id = '${property}'`)).toBe("active");
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE id = '${unit}'`)).toBe("1");

  // an archived property: read only for a manager
  const old = propertyIdOf(ids.main!, "מתחם ישן");
  await page.goto(url(slug, `/manage/properties/${old}`));
  await expect(page.getByText("המתחם בארכיון — רק בעל העסק יכול לשנות אותו")).toBeVisible();
  await expect(textbox(page, "שם המתחם")).toBeDisabled();
  await expect(page.getByRole("button", { name: "שמירה" })).toHaveCount(0);
});

test("direct calls: outsiders are refused for every new action; another site's owner reaches nothing here", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const slug = slugOf(DESKTOP_SITES.main);
  const property = propertyIdOf(ids.main!, "צימרי הגליל");
  const unit = unitIdOf(ids.main!, "צימר התאנה");
  const order = activeIds(property);
  const before = sql(`SELECT md5(string_agg(u::text, ',' ORDER BY u.id)) FROM hospitality.units u
                       WHERE tenant_id = '${ids.main}'`);
  const actions: [string, Record<string, unknown>][] = [
    ["hospitalitySetUnitActive", { id: unit, active: false, revision: unitRev(unit) }],
    ["hospitalityDeleteUnit", { id: unit, revision: unitRev(unit) }],
    ["hospitalityArchiveProperty", { id: property, revision: propertyRev(property) }],
    ["hospitalityDeleteProperty", { id: property, revision: propertyRev(property) }],
    [
      "hospitalitySetWholeProperty",
      { propertyId: property, enabled: false, memberIds: [], revision: null },
    ],
    [
      "hospitalityReorderUnits",
      { propertyId: property, expected: order, ids: [...order].reverse() },
    ],
  ];
  const callers: Record<string, string | undefined> = {
    anonymous: undefined,
    storeCustomer: await accessToken(request, USERS.customerA),
    storeOwner: await accessToken(request, USERS.ownerA),
    otherSiteOwner: await accessToken(request, OTHER),
  };
  for (const [who, token] of Object.entries(callers))
    for (const [name, data] of actions) {
      const res = await catalogFn(request, slug, name, token, data);
      expect(await res.text(), `${who} ${name}`).toMatch(/נדרשת התחברות|אין הרשאה/);
    }
  // the other site's owner on its own site: these ids are not there (no existence leak)
  for (const [name, data] of actions) {
    const res = await catalogFn(
      request,
      slugOf(DESKTOP_SITES.foreign),
      name,
      callers["otherSiteOwner"],
      data,
    );
    expect(await res.text(), name).toMatch(/נמחקה בינתיים|נמחק בינתיים|לא נמצא/);
  }
  expect(
    sql(`SELECT md5(string_agg(u::text, ',' ORDER BY u.id)) FROM hospitality.units u
          WHERE tenant_id = '${ids.main}'`),
  ).toBe(before);
});

test("@mobile phone: unit page, property page, the whole property and the order with arrows; accessible, no sideways scroll", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone only");
  const slug = slugOf(MOBILE_SITES.phone);
  const property = propertyIdOf(ids.phone!, "וילות בכרם");
  await open(page, request, slug, "/manage/units");
  await page
    .locator('li[data-unit="וילה ירוקה"]')
    .getByRole("link", { name: "וילה ירוקה" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "וילה ירוקה" })).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  await expectAccessible(page, "phone unit page");
  await textbox(page, "חדרי שינה").fill("4");
  const save = page.getByRole("button", { name: "שמירה" });
  await expect(save).toBeInViewport(); // the save bar stays above the bottom navigation
  await save.click();
  await expect(page.getByText("היחידה נשמרה")).toBeVisible();
  expect(
    sql(
      `SELECT bedrooms FROM hospitality.units WHERE id = '${unitIdOf(ids.phone!, "וילה ירוקה")}'`,
    ),
  ).toBe("4");

  await page.goto(url(slug, `/manage/properties/${property}`));
  await expect(page.getByRole("heading", { level: 1, name: "וילות בכרם" })).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  await expectAccessible(page, "phone property page");
  await page.getByRole("switch", { name: "השכרת המתחם כולו" }).click();
  await page.getByRole("button", { name: "שמירת ההשכרה" }).click();
  await expect(page.getByText("השכרת המתחם כולו הופעלה")).toBeVisible();
  expect(membersOf(wholeOf(property))).toBe("וילה אדומה,וילה ירוקה,וילה כחולה");

  await page.getByRole("button", { name: "סידור היחידות" }).click();
  await page.getByRole("button", { name: "הזזת וילה כחולה למעלה" }).click();
  await expect.poll(() => activeOrder(property)).toBe("וילה אדומה,וילה כחולה,וילה ירוקה");
  expect(await noSideways(page)).toBe(true);
});

test("dashboard (2c.4): the units card and the setup step lead to the units screen — empty, one unit, many", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // an empty site: an invitation to start, and the setup step links to the first run
  await open(page, request, slugOf(DESKTOP_SITES.empty), "/manage");
  const card = page.getByTestId("units-card");
  await expect(card).toContainText("עוד לא הוספתם מקום אירוח");
  const step = page.locator('li[data-step="units"]');
  await step.getByRole("link", { name: /^להשלמה/ }).click();
  await expect(page).toHaveURL(/\/manage\/units$/);
  await expect(page.getByRole("heading", { name: "בואו נקים את מקום האירוח שלכם" })).toBeVisible();

  // one unit: the unit itself, one click to its page
  await open(page, request, slugOf(DESKTOP_SITES.single), "/manage");
  await expect(page.getByTestId("units-card")).toContainText("1 מתוך 20 יחידות פעילות בחבילה");
  await page.getByTestId("units-card").getByRole("link", { name: "בקתת האורן" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "בקתת האורן" })).toBeVisible();
  // the units step is done now (an active unit exists): no link
  await page.goto(url(slugOf(DESKTOP_SITES.single), "/manage"));
  await expect(page.locator('li[data-step="units"]')).toContainText("הושלם");
  await expect(page.locator('li[data-step="units"]').getByRole("link")).toHaveCount(0);

  // many units: counts, and the way to the list
  await open(page, request, slugOf(DESKTOP_SITES.hotel), "/manage");
  const hotel = page.getByTestId("units-card");
  await expect(hotel).toContainText("מתחמים");
  await expect(hotel).toContainText("לא פעילות");
  await expectAccessible(page, "dashboard with the units card");
  await hotel.getByRole("link", { name: "לניהול היחידות" }).click();
  await expect(page).toHaveURL(/\/manage\/units$/);
});

test("Ecommerce untouched: no unit or property pages or actions on a store; store data unchanged", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const store = hostOf(STORE_A.slug);
  const any = "6a1e0000-0000-4000-8000-000000000001";
  for (const path of [`/manage/units/${any}`, `/manage/properties/${any}`])
    expect((await hostGet(request, store, path)).status(), path).toBe(404);
  for (const name of [
    "hospitalitySetUnitActive",
    "hospitalityDeleteUnit",
    "hospitalityArchiveProperty",
    "hospitalityDeleteProperty",
    "hospitalitySetWholeProperty",
    "hospitalityReorderUnits",
  ]) {
    const res = await callServerFn(request, {
      host: store,
      file: FN_FILE,
      name,
      token: await accessToken(request, USERS.ownerA),
    });
    expect(res.status(), name).toBe(404);
  }
  expect((await hostGet(request, store, "/")).status()).toBe(200);
  expect(storeDataHash()).toBe(storeHash);
});

test("closing the management flag closes the unit and property pages", async ({ request }) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const slug = slugOf(DESKTOP_SITES.foreign);
  const unit = unitIdOf(ids.foreign!, "יחידה זרה");
  const property = propertyIdOf(ids.foreign!, "מתחם זר");
  sql(`UPDATE public.tenant_feature_flags SET enabled = false
        WHERE tenant_id = '${ids.foreign}' AND key = 'hospitality_management_enabled'`);
  for (const path of [`/manage/units/${unit}`, `/manage/properties/${property}`])
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), path)).status(), { timeout: 20_000 })
      .toBe(404);
  const res = await catalogFn(
    request,
    slug,
    "hospitalitySetUnitActive",
    await accessToken(request, OTHER),
    {
      id: unit,
      active: false,
      revision: unitRev(unit),
    },
  );
  expect(await res.text()).toContain("אזור הניהול אינו פעיל");
});
