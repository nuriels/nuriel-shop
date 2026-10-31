import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
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
  type SavedSession,
} from "./hospitality-helpers";

// Hospitality Stage 2c.2 — "יחידות ומתחמים" (/manage/units) על השרת הבנוי:
//   • מצב ריק שמסביר איך מתחילים, ובחירת סוג המקום — לכל סוג עסק דרך הממשק האמיתי;
//   • רשימה מקובצת לפי מתחם; הוספה ועריכה של מתחמים ויחידות (רק דרך פונקציות השרת);
//   • הודעות בעברית ליד השדה ומהשרת; "עודכן בינתיים" בשני דפדפנים — מיזוג בלי דריסה;
//   • מנהל יוצר ועורך; מגבלת החבילה בממשק ובשרת; זרים נחסמים בקריאה ישירה;
//   • טלפון, נגישות, ובלי שום שינוי בחנויות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h2c2.owner@e2e.test", password: "H2c2-Owner-Pass-1!" };
const MANAGER = { email: "h2c2.manager@e2e.test", password: "H2c2-Manager-Pass-1!" };
const OTHER = { email: "h2c2.other@e2e.test", password: "H2c2-Other-Pass-1!" };
const FN_FILE = "src/engines/hospitality/api/catalog.functions.ts";

// one site per scenario that needs an empty start (the first run shows only without properties)
const DESKTOP_SITES = {
  main: "h2c-units",
  villa: "h2c-units-villa",
  zimmer: "h2c-units-zimmer",
  apartments: "h2c-units-apts",
  hotel: "h2c-units-hotel",
  other: "h2c-units-other",
  limit: "h2c-units-limit",
  foreign: "h2c-units-foreign",
} as const;
const MOBILE_SITES = { phone: "h2c-units-m" } as const;
type SiteKey = keyof typeof DESKTOP_SITES | keyof typeof MOBILE_SITES;

const ids: Partial<Record<SiteKey, string>> = {};
// a retry re-creates the sites: new addresses, because the server remembers an address's site
// for 15 seconds (it would still point at the site deleted a moment ago)
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

/** כל האתרים של הקובץ הזה (גם של ניסיון קודם) */
function cleanup(project: string) {
  const prefixes = Object.values(project === "mobile" ? MOBILE_SITES : DESKTOP_SITES);
  for (const row of sql(`SELECT id || '|' || slug FROM public.tenants
                          WHERE slug ~ '^h2c-units' AND site_type = 'hospitality'`)
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

const catalogFn = (
  request: APIRequestContext,
  slug: string,
  name: string,
  token?: string,
  data?: unknown,
  method: "GET" | "POST" = "POST",
) => callServerFn(request, { host: hostOf(slug), file: FN_FILE, name, data, token, method });

async function openUnits(
  page: Page,
  request: APIRequestContext,
  slug: string,
  who: Account = OWNER,
) {
  const session: SavedSession = await passwordSession(request, url(slug), who);
  await loadSession(page, session, "/manage/units");
  await expect(page.getByRole("heading", { level: 1, name: "יחידות ומתחמים" })).toBeVisible();
}

const unitRow = (page: Page, name: string) => page.locator(`li[data-unit="${name}"]`);
const sheet = (page: Page) => page.getByRole("dialog");
const textbox = (page: Page, name: string) =>
  sheet(page).getByRole("textbox", { name, exact: true });

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
    if (key === "foreign") addStaff(id, OTHER, `h2c2_other_${slug.length}`, true);
    else addStaff(id, OWNER, `h2c2_owner_${key}_${project}`, true);
    if (key === "main") addStaff(id, MANAGER, `h2c2_manager_${project}`, false);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
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

test("empty state: explains how to start, six kinds of place, accessible", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openUnits(page, request, slugOf(DESKTOP_SITES.main));
  await expect(page.getByRole("heading", { name: "בואו נקים את מקום האירוח שלכם" })).toBeVisible();
  await expect(page.getByRole("list", { name: "שלבי ההקמה" }).getByRole("listitem")).toHaveCount(3);
  const choices = page.getByRole("group", { name: "מה אתם משכירים?" }).getByRole("radio");
  await expect(choices).toHaveCount(6);
  await expect(page.getByRole("button", { name: "המשך" })).toBeDisabled();
  await expectAccessible(page, "units empty state");
  // the navigation leads here, for owner and manager alike
  await expect(
    page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link", { name: "יחידות" }),
  ).toHaveAttribute("aria-current", "page");
});

test("first run — a zimmer complex: the place and its units in one go, then the grouped list", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openUnits(page, request, slugOf(DESKTOP_SITES.main));
  await page.locator('label[data-business-type="zimmer_complex"]').click();
  await page.getByRole("button", { name: "המשך" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "מתחם צימרים" })).toBeVisible();
  await page.getByRole("textbox", { name: "שם המתחם" }).fill("צימרי הגליל");
  await page.getByRole("textbox", { name: "שם הצימר (1)" }).fill("צימר הגפן");
  await page.getByRole("textbox", { name: "שם הצימר (2)" }).fill("צימר האלון");
  await page.getByRole("button", { name: "הוספת צימר" }).click();
  await page.getByRole("textbox", { name: "שם הצימר (3)" }).fill("סוויטת הנוף");
  await page.getByRole("button", { name: "יותר — אורחים לכל היותר" }).nth(2).click();
  await page.getByRole("button", { name: "יותר — אורחים לכל היותר" }).nth(2).click();
  await expectAccessible(page, "first run form");
  await page.getByRole("button", { name: "יצירת מקום האירוח" }).click();

  await expect(page.getByRole("heading", { level: 2, name: "צימרי הגליל" })).toBeVisible();
  const list = page.getByRole("list", { name: "היחידות בצימרי הגליל" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(unitRow(page, "סוויטת הנוף")).toContainText("עד 4 אורחים");
  await expect(page.getByTestId("units-limit")).toHaveText("3 מתוך 20 יחידות פעילות בחבילה");
  await expectAccessible(page, "units list");

  const site = ids.main!;
  expect(
    sql(
      `SELECT property_type || '|' || status || '|' || name FROM hospitality.properties WHERE tenant_id = '${site}'`,
    ),
  ).toBe("zimmer_complex|active|צימרי הגליל");
  expect(
    sql(`SELECT string_agg(name || ':' || unit_type || ':' || kind || ':' || capacity, ',' ORDER BY sort_order)
           FROM hospitality.units WHERE tenant_id = '${site}'`),
  ).toBe("צימר הגפן:zimmer:unit:2,צימר האלון:zimmer:unit:2,סוויטת הנוף:zimmer:unit:4");
  // logged, and visible to the owner in "recent activity"
  await page.goto(url(slugOf(DESKTOP_SITES.main), "/manage/team"));
  await expect(page.getByRole("list", { name: "פעילות אחרונה" })).toContainText(
    "הוסיף/ה את היחידה סוויטת הנוף",
  );
  await expect(page.getByRole("list", { name: "פעילות אחרונה" })).toContainText(
    "הוסיף/ה את המתחם צימרי הגליל",
  );
});

test("first run for every other kind of place (single zimmer, villa, apartments, hotel, something else)", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const cases = [
    {
      key: "zimmer",
      type: "zimmer",
      nameLabel: "שם הצימר",
      name: "צימר הדובדבן",
      unit: "zimmer:unit:5",
    },
    {
      key: "villa",
      type: "villa",
      nameLabel: "שם הווילה",
      name: "וילה בכרם",
      unit: "villa:unit:5",
    },
  ] as const;
  for (const c of cases) {
    await openUnits(page, request, slugOf(DESKTOP_SITES[c.key]));
    await page.locator(`label[data-business-type="${c.type}"]`).click();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("textbox", { name: c.nameLabel }).fill(c.name);
    await page.getByRole("textbox", { name: "כמה אורחים לכל היותר" }).fill("5");
    await page.getByRole("textbox", { name: "חדרי שינה" }).fill("3");
    await page.getByRole("button", { name: "יצירת מקום האירוח" }).click();
    await expect(page.getByRole("heading", { level: 2, name: c.name })).toBeVisible();
    // single-unit places: the place's name is also the unit's name
    expect(
      sql(`SELECT p.property_type || '|' || u.name || '|' || u.unit_type || ':' || u.kind || ':' || u.capacity || '|' || u.bedrooms
             FROM hospitality.units u JOIN hospitality.properties p ON p.id = u.property_id
            WHERE u.tenant_id = '${ids[c.key]}'`),
    ).toBe(`${c.type}|${c.name}|${c.unit}|3`);
  }

  const multi = [
    {
      key: "apartments",
      type: "vacation_apartments",
      nameLabel: "שם העסק או הבניין",
      word: "דירה",
      unitType: "apartment",
      kind: "unit",
      rows: 1,
    },
    {
      key: "hotel",
      type: "boutique_hotel",
      nameLabel: "שם המלון",
      word: "חדר",
      unitType: "room",
      kind: "room",
      rows: 3,
    },
    {
      key: "other",
      type: "other",
      nameLabel: "שם המקום",
      word: "יחידה",
      unitType: "other",
      kind: "unit",
      rows: 1,
    },
  ] as const;
  for (const c of multi) {
    await openUnits(page, request, slugOf(DESKTOP_SITES[c.key]));
    await page.locator(`label[data-business-type="${c.type}"]`).click();
    await page.getByRole("button", { name: "המשך" }).click();
    await page.getByRole("textbox", { name: c.nameLabel }).fill(`מקום ${c.key}`);
    await expect(
      page.getByRole("list", { name: "היחידות שיתווספו" }).getByRole("listitem"),
    ).toHaveCount(c.rows);
    await page.getByRole("button", { name: "יצירת מקום האירוח" }).click();
    await expect(page.getByRole("heading", { level: 2, name: `מקום ${c.key}` })).toBeVisible();
    const expected = Array.from(
      { length: c.rows },
      (_, i) => `${c.word} ${i + 1}:${c.unitType}:${c.kind}`,
    ).join(",");
    expect(
      sql(`SELECT string_agg(name || ':' || unit_type || ':' || kind, ',' ORDER BY sort_order)
             FROM hospitality.units WHERE tenant_id = '${ids[c.key]}'`),
    ).toBe(expected);
    expect(
      sql(`SELECT property_type FROM hospitality.properties WHERE tenant_id = '${ids[c.key]}'`),
    ).toBe(c.type);
  }
});

test("list: add a second property, add a unit to it, edit property and unit — saved and shown", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openUnits(page, request, slugOf(DESKTOP_SITES.main));
  // a second property
  await page.getByRole("button", { name: "הוספת מתחם" }).click();
  await expect(sheet(page)).toBeVisible();
  await expectAccessible(page, "new property sheet");
  await textbox(page, "שם המתחם").fill("דירות הים");
  await sheet(page)
    .getByRole("combobox", { name: "סוג המקום" })
    .selectOption({ label: "דירות נופש" });
  await textbox(page, "כתובת").fill("רחוב הים 5, נהריה");
  await sheet(page).getByText("טיוטה", { exact: true }).click();
  await sheet(page).getByRole("button", { name: "הוספת המתחם" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "דירות הים" })).toBeVisible();
  const second = page.locator('[data-property="דירות הים"]');
  await expect(second).toContainText("טיוטה — לא יוצג לאורחים");
  await expect(second).toContainText("רחוב הים 5, נהריה");
  await expect(second).toContainText("אין עדיין יחידות במתחם הזה.");

  // a unit inside it (suggested type and name follow the property)
  await second.getByRole("button", { name: /^הוספת יחידה ל/ }).click();
  await expect(textbox(page, "שם היחידה")).toHaveValue("דירה 1");
  await expect(sheet(page).getByRole("combobox", { name: "סוג היחידה" })).toHaveValue(
    String(
      ["zimmer", "suite", "room", "apartment", "villa", "cabin", "studio", "other"].indexOf(
        "apartment",
      ),
    ),
  );
  await textbox(page, "מספר האורחים המרבי").fill("6");
  await textbox(page, "חדרי שינה").fill("2");
  await sheet(page).getByRole("textbox", { name: "תיאור היחידה" }).fill("מרפסת מול הים");
  await sheet(page).getByRole("button", { name: "הוספת היחידה" }).click();
  await expect(unitRow(page, "דירה 1")).toContainText("עד 6 אורחים · 2 חדרי שינה");
  expect(
    sql(`SELECT p.name || '|' || u.unit_type || '|' || u.description FROM hospitality.units u
           JOIN hospitality.properties p ON p.id = u.property_id WHERE u.name = 'דירה 1' AND u.tenant_id = '${ids.main}'`),
  ).toBe("דירות הים|apartment|מרפסת מול הים");

  // edit the property: active again, other type
  await second.getByRole("button", { name: "עריכה של המתחם דירות הים" }).click();
  await sheet(page).getByText("פעיל", { exact: true }).click();
  await sheet(page).getByRole("button", { name: "שמירה" }).click();
  await expect(second).not.toContainText("טיוטה");
  expect(
    sql(
      `SELECT status || '|' || revision FROM hospitality.properties WHERE name = 'דירות הים' AND tenant_id = '${ids.main}'`,
    ),
  ).toBe("active|2");

  // edit a unit
  await unitRow(page, "צימר האלון")
    .getByRole("button", { name: /^עריכה של צימר האלון/ })
    .click();
  await expectAccessible(page, "edit unit sheet");
  await textbox(page, "שם היחידה").fill("צימר האלון הגדול");
  await sheet(page).getByRole("combobox", { name: "סוג היחידה" }).selectOption({ label: "סוויטה" });
  await textbox(page, "מספר האורחים המרבי").fill("5");
  await textbox(page, "כמה אורחים כלולים במחיר").fill("4");
  await sheet(page).getByRole("button", { name: "שמירה" }).click();
  await expect(unitRow(page, "צימר האלון הגדול")).toContainText("סוויטה · עד 5 אורחים");
  expect(
    sql(`SELECT unit_type || '|' || capacity || '|' || base_occupancy || '|' || kind || '|' || revision FROM hospitality.units
          WHERE name = 'צימר האלון הגדול' AND tenant_id = '${ids.main}'`),
  ).toBe("suite|5|4|unit|2");
});

test("validation: Hebrew messages next to the field, nothing saved; the server refuses the same", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openUnits(page, request, slugOf(DESKTOP_SITES.main));
  const before = sql(`SELECT count(*) FROM hospitality.units WHERE tenant_id = '${ids.main}'`);
  await page.getByRole("button", { name: "הוספת יחידה", exact: true }).click();
  await textbox(page, "שם היחידה").fill("");
  await textbox(page, "מספר האורחים המרבי").fill("2");
  await textbox(page, "כמה אורחים כלולים במחיר").fill("3");
  await textbox(page, "גיל ילד עד").fill("19");
  await sheet(page).getByRole("button", { name: "הוספת היחידה" }).click();
  await expect(sheet(page)).toContainText("יש למלא את שם היחידה");
  await expect(sheet(page)).toContainText(
    "מספר האורחים הכלולים במחיר לא יכול להיות גדול ממספר האורחים המרבי",
  );
  await expect(sheet(page)).toContainText("גיל ילד עד חייב להיות מספר שלם בין 0 ל-17");
  await expect(textbox(page, "שם היחידה")).toHaveAttribute("aria-invalid", "true");
  await expectAccessible(page, "unit sheet with errors");
  // closing with changes asks first
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "לצאת בלי לשמור?" })).toBeVisible();
  await page.getByRole("button", { name: "לצאת בלי לשמור" }).click();
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE tenant_id = '${ids.main}'`)).toBe(
    before,
  );

  // the server function checks the same rules (and the database once more)
  const token = await accessToken(request, OWNER);
  const propertyId = sql(
    `SELECT id FROM hospitality.properties WHERE name = 'צימרי הגליל' AND tenant_id = '${ids.main}'`,
  );
  const bad = await catalogFn(request, slugOf(DESKTOP_SITES.main), "hospitalityCreateUnit", token, {
    propertyId,
    data: { name: "x", unit_type: "zimmer", capacity: 2, base_occupancy: 3 },
  });
  expect(await bad.text()).toContain("מספר האורחים הכלולים במחיר לא יכול להיות גדול");
  const price = await catalogFn(
    request,
    slugOf(DESKTOP_SITES.main),
    "hospitalityCreateUnit",
    token,
    {
      propertyId,
      data: { name: "x", unit_type: "zimmer", base_price: 1 },
    },
  );
  expect(await price.text()).toContain("שדה לא מוכר: base_price");
  const archived = await catalogFn(
    request,
    slugOf(DESKTOP_SITES.main),
    "hospitalityUpdateProperty",
    token,
    {
      id: propertyId,
      changes: { status: "archived" },
      revision: 1,
    },
  );
  expect(await archived.text()).toContain("מצב המתחם — יש לבחור מהרשימה");
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE tenant_id = '${ids.main}'`)).toBe(
    before,
  );
});

test("updated in the meantime: two browsers on the same unit — merged, nothing overwritten", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await openUnits(pa, request, slugOf(DESKTOP_SITES.main));
  await openUnits(pb, request, slugOf(DESKTOP_SITES.main));
  for (const p of [pa, pb])
    await unitRow(p, "צימר הגפן")
      .getByRole("button", { name: /^עריכה של צימר הגפן/ })
      .click();

  await textbox(pa, "שם היחידה").fill("צימר הגפן (חדש)");
  await sheet(pa).getByRole("button", { name: "שמירה" }).click();
  await expect(unitRow(pa, "צימר הגפן (חדש)")).toBeVisible();

  await textbox(pb, "שם היחידה").fill("שם אחר");
  await textbox(pb, "מספר האורחים המרבי").fill("3");
  await sheet(pb).getByRole("button", { name: "שמירה" }).click();
  const notice = sheet(pb).getByRole("status").first();
  await expect(notice).toContainText("היחידה עודכנה בינתיים על ידי משתמש אחר");
  await expect(notice).toContainText("השינוי שלך בשם היחידה לא נשמר");
  await expect(textbox(pb, "שם היחידה")).toHaveValue("צימר הגפן (חדש)");
  await expect(textbox(pb, "מספר האורחים המרבי")).toHaveValue("3");
  await sheet(pb).getByRole("button", { name: "שמירה" }).click();
  await expect(unitRow(pb, "צימר הגפן (חדש)")).toContainText("עד 3 אורחים");
  expect(
    sql(
      `SELECT name || '|' || capacity || '|' || revision FROM hospitality.units WHERE tenant_id = '${ids.main}' AND slug = 'צימר-הגפן'`,
    ),
  ).toBe("צימר הגפן (חדש)|3|3");
  await a.close();
  await b.close();
});

test("a manager: sees the list, adds and edits — no owner-only actions here", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await openUnits(page, request, slugOf(DESKTOP_SITES.main), MANAGER);
  await expect(page.getByText("מנהל/ת", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "צימרי הגליל" })).toBeVisible();
  await page
    .locator('[data-property="צימרי הגליל"]')
    .getByRole("button", { name: /^הוספת יחידה ל/ })
    .click();
  await textbox(page, "שם היחידה").fill("צימר המנהלת");
  await sheet(page).getByRole("button", { name: "הוספת היחידה" }).click();
  await expect(unitRow(page, "צימר המנהלת")).toBeVisible();
  await expect(page.getByRole("button", { name: /מחיקה|ארכיון/ })).toHaveCount(0);
  expect(
    sql(`SELECT actor_role FROM hospitality.audit_log WHERE tenant_id = '${ids.main}'
           AND action = 'catalog.unit_created' AND target_label = 'צימר המנהלת'`),
  ).toBe("manager");
});

test("plan limit: at the limit the add button is disabled with the reason; the server refuses too", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const site = ids.limit!;
  sql(`INSERT INTO hospitality.properties (id, tenant_id, name, slug, status, property_type)
       VALUES (gen_random_uuid(), '${site}', 'מלון מלא', 'full', 'active', 'boutique_hotel')`);
  const propertyId = sql(`SELECT id FROM hospitality.properties WHERE tenant_id = '${site}'`);
  sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug)
       SELECT '${site}', '${propertyId}', 'room', 'room', 'חדר ' || g, 'r' || g FROM generate_series(1, 20) g`);
  await openUnits(page, request, slugOf(DESKTOP_SITES.limit));
  await expect(page.getByTestId("units-limit")).toHaveText("20 מתוך 20 יחידות פעילות בחבילה");
  await expect(page.getByRole("button", { name: "הוספת יחידה", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "הגעתם למגבלת היחידות בחבילה" }),
  ).toBeVisible();
  const res = await catalogFn(
    request,
    slugOf(DESKTOP_SITES.limit),
    "hospitalityCreateUnit",
    await accessToken(request, OWNER),
    {
      propertyId,
      data: { name: "חדר 21", unit_type: "room" },
    },
  );
  expect(await res.text()).toContain("מגבלת היחידות בחבילה (20)");
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE tenant_id = '${site}'`)).toBe("20");
});

test("direct calls: outsiders are refused; a site's owner reaches only its own site", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const slug = slugOf(DESKTOP_SITES.main);
  const propertyId = sql(
    `SELECT id FROM hospitality.properties WHERE name = 'צימרי הגליל' AND tenant_id = '${ids.main}'`,
  );
  const callers: Record<string, string | undefined> = {
    anonymous: undefined,
    storeCustomer: await accessToken(request, USERS.customerA),
    storeOwner: await accessToken(request, USERS.ownerA),
    otherSiteOwner: await accessToken(request, OTHER),
  };
  for (const [who, token] of Object.entries(callers)) {
    const view = await catalogFn(request, slug, "hospitalityCatalog", token, undefined, "GET");
    expect(await view.text(), who).toMatch(/נדרשת התחברות|אין הרשאה/);
    const create = await catalogFn(request, slug, "hospitalityCreateUnit", token, {
      propertyId,
      data: { name: `פריצה ${who}`, unit_type: "zimmer" },
    });
    expect(await create.text(), who).toMatch(/נדרשת התחברות|אין הרשאה/);
  }
  // the other site's owner on its own site: this site's property does not exist there
  const foreign = await catalogFn(
    request,
    slugOf(DESKTOP_SITES.foreign),
    "hospitalityCreateUnit",
    callers["otherSiteOwner"],
    {
      propertyId,
      data: { name: "פריצה", unit_type: "zimmer" },
    },
  );
  expect(await foreign.text()).toContain("המתחם לא נמצא");
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE name LIKE 'פריצה%'`)).toBe("0");
});

test("@mobile phone: empty state, first run, list and the edit sheet from the bottom; accessible, no sideways scroll", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone only");
  const noSideways = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await openUnits(page, request, slugOf(MOBILE_SITES.phone));
  await expect(page.getByRole("heading", { name: "בואו נקים את מקום האירוח שלכם" })).toBeVisible();
  expect(await noSideways()).toBe(true);
  await expectAccessible(page, "phone empty state");
  await page.locator('label[data-business-type="villa"]').click();
  await page.getByRole("button", { name: "המשך" }).click();
  await page.getByRole("textbox", { name: "שם הווילה" }).fill("וילה בגולן");
  await page.getByRole("button", { name: "יותר — כמה אורחים לכל היותר" }).click();
  expect(await noSideways()).toBe(true);
  await page.getByRole("button", { name: "יצירת מקום האירוח" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "וילה בגולן" })).toBeVisible();
  await expect(unitRow(page, "וילה בגולן")).toContainText("עד 3 אורחים");
  expect(await noSideways()).toBe(true);
  await expectAccessible(page, "phone list");

  await unitRow(page, "וילה בגולן")
    .getByRole("button", { name: /^עריכה של וילה בגולן/ })
    .click();
  const box = await sheet(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 2); // anchored to the bottom
  await textbox(page, "חדרי שינה").fill("4");
  await sheet(page).getByRole("button", { name: "שמירה" }).click();
  await expect(unitRow(page, "וילה בגולן")).toContainText("4 חדרי שינה");
  expect(await noSideways()).toBe(true);
});

test("Ecommerce untouched: no units page or functions on a store; store data unchanged", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  const store = hostOf(STORE_A.slug);
  expect((await hostGet(request, store, "/manage/units")).status()).toBe(404);
  for (const [name, method] of [
    ["hospitalityCatalog", "GET"],
    ["hospitalityCreateProperty", "POST"],
    ["hospitalityCreateUnit", "POST"],
    ["hospitalityUpdateUnit", "POST"],
    ["hospitalitySetupPlace", "POST"],
  ] as const) {
    const res = await callServerFn(request, {
      host: store,
      file: FN_FILE,
      name,
      method,
      token: await accessToken(request, USERS.ownerA),
    });
    expect(res.status(), name).toBe(404);
  }
  expect((await hostGet(request, store, "/")).status()).toBe(200);
  expect(storeDataHash()).toBe(storeHash);
});

test("closing the management flag closes the units page and functions", async ({ request }) => {
  test.skip(test.info().project.name === "mobile", "API checks once");
  sql(`UPDATE public.tenant_feature_flags SET enabled = false
        WHERE tenant_id = '${ids.foreign}' AND key = 'hospitality_management_enabled'`);
  await expect
    .poll(
      async () =>
        (await hostGet(request, hostOf(slugOf(DESKTOP_SITES.foreign)), "/manage/units")).status(),
      {
        timeout: 20_000,
      },
    )
    .toBe(404);
  const res = await catalogFn(
    request,
    slugOf(DESKTOP_SITES.foreign),
    "hospitalityCatalog",
    await accessToken(request, OTHER),
    undefined,
    "GET",
  );
  expect(await res.text()).toContain("אזור הניהול אינו פעיל");
});
