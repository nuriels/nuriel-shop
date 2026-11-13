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

// Hospitality Stage 2d — פרטי היחידה והמתחם, על השרת הבנוי, דרך הממשק האמיתי ובקריאות
// ישירות לשרת:
//   • יחידה: מיטות לפי חדר (סדר, הסרה, "ישנים עד", אזהרה), שירותים נפרדים, מקסימום
//     מבוגרים / ילדים, מתקנים ביחידה (מהרשימה המוכנה ומשלכם, עם הערה) — שמירה אחת;
//   • מתחם: מתקנים משותפים, חניה, מיקום מקישור למפה (בלי בקשה לקישור), מידע לאורחים,
//     כללי המקום — שמירה אחת; מידע פרטי להגעה — כרטיס נפרד, מוסתר כברירת מחדל, ביומן
//     בלי הערכים, לא חוזר ב-catalog_view;
//   • "עודכן בינתיים" בשני דפדפנים: מיזוג בלי דריסה; מנהל מול בעלים; זרים נחסמים;
//   • טלפון, נגישות, ובלי שום שינוי בחנויות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h2d.owner@e2e.test", password: "H2d-Owner-Pass-1!" };
const MANAGER = { email: "h2d.manager@e2e.test", password: "H2d-Manager-Pass-1!" };
const OTHER = { email: "h2d.other@e2e.test", password: "H2d-Other-Pass-1!" };
const CATALOG_FN = "src/engines/hospitality/api/catalog.functions.ts";
const DETAILS_FN = "src/engines/hospitality/api/details.functions.ts";

const DESKTOP_SITES = { main: "h2d-main", foreign: "h2d-foreign" } as const;
const MOBILE_SITES = { phone: "h2d-m" } as const;
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
                          WHERE slug ~ '^h2d-' AND site_type = 'hospitality'`)
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

function seedProperty(site: string, name: string, units: string[]): string {
  const tag = Math.random().toString(36).slice(2, 8);
  const id = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
                  VALUES ('${site}', '${name}', 'p-${tag}', 'active', 'zimmer_complex') RETURNING id`);
  units.forEach((u, i) =>
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order, capacity)
         VALUES ('${site}', '${id}', 'unit', 'zimmer', '${u}', 'u-${tag}-${i}', ${i}, 4)`),
  );
  return id;
}

const unitIdOf = (site: string, name: string) =>
  sql(`SELECT id FROM hospitality.units WHERE tenant_id = '${site}' AND name = '${name}'`);
const propertyIdOf = (site: string, name: string) =>
  sql(`SELECT id FROM hospitality.properties WHERE tenant_id = '${site}' AND name = '${name}'`);
const unitRev = (id: string) =>
  Number(sql(`SELECT revision FROM hospitality.units WHERE id = '${id}'`));
const bedsOf = (unit: string) =>
  sql(`SELECT string_agg(bed_type || ':' || quantity || ':' || COALESCE(room_label, '-'), ',' ORDER BY sort_order)
         FROM hospitality.unit_beds WHERE unit_id = '${unit}'`);
const amenitiesOf = (where: string) =>
  sql(`SELECT string_agg(a.name || ':' || COALESCE(l.note, '-'), ',' ORDER BY a.name)
         FROM hospitality.unit_amenities l JOIN hospitality.amenities a ON a.id = l.amenity_id WHERE ${where}`);

const fn = (
  request: APIRequestContext,
  slug: string,
  file: string,
  name: string,
  token?: string,
  data?: unknown,
  method: "GET" | "POST" = "POST",
) => callServerFn(request, { host: hostOf(slug), file, name, data, token, method });

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

const notice = (page: Page) => page.getByTestId("page-notice");
const noSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const save = (page: Page) => page.getByRole("button", { name: "שמירה", exact: true }).click();
const bedRow = (page: Page, n: number) => page.locator(`[data-bed-row="${n}"]`);

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
    if (key === "foreign")
      addStaff(id, OTHER, `h2d_other_${project}${suffix.replace("-", "_")}`, true);
    else addStaff(id, OWNER, `h2d_owner_${key}_${project}${suffix.replace("-", "_")}`, true);
    if (key === "main")
      addStaff(id, MANAGER, `h2d_manager_${project}${suffix.replace("-", "_")}`, false);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
  }
  if (project === "mobile") seedProperty(ids.phone!, "חוות הזית", ["צימר הזית", "צימר האלון"]);
  else {
    seedProperty(ids.main!, "חוות הזית", ["צימר הזית", "צימר האלון", "צימר התמר"]);
    seedProperty(ids.foreign!, "מתחם זר", ["יחידה זרה"]);
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

test("unit page (2d): beds per room, toilets, max adults / children and private amenities — one save, shown after reload", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר הזית");
  await open(page, request, slug, `/manage/units/${unit}`);
  await expect(page.getByRole("heading", { level: 2, name: "חדרים ומיטות" })).toBeVisible();

  // beds: two rows, a third, reorder, remove — "sleeps" and the warning are live
  const beds = page.getByTestId("beds-editor");
  await beds.getByRole("button", { name: "הוספת מיטה" }).click();
  await bedRow(page, 1).getByLabel("חדר (לא חובה)").fill("חדר הורים");
  await bedRow(page, 1).getByLabel("סוג המיטה").selectOption({ label: "קינג" });
  await beds.getByRole("button", { name: "הוספת מיטה" }).click();
  await bedRow(page, 2).getByLabel("סוג המיטה").selectOption({ label: "עריסה" });
  await expect(page.getByTestId("beds-sleeps")).toHaveText("ישנים עד 2 אנשים (ועריסה לתינוק).");
  await expect(beds.getByRole("note")).toContainText(
    "מקומות השינה (2) פחות ממספר האורחים המרבי (4)",
  );
  await beds.getByRole("button", { name: "הוספת מיטה" }).click();
  await bedRow(page, 3).getByLabel("חדר (לא חובה)").fill("חדר ילדים");
  await bedRow(page, 3).getByLabel("סוג המיטה").selectOption({ label: "יחיד" });
  await bedRow(page, 3).getByLabel("כמה").fill("2");
  await beds.getByRole("button", { name: "הזזת שורת מיטות 3 למעלה" }).click();
  await expect(page.getByTestId("beds-sleeps")).toHaveText("ישנים עד 4 אנשים (ועריסה לתינוק).");
  await expect(beds.getByRole("note")).toHaveCount(0);

  // rooms and guests
  await page.getByRole("textbox", { name: "שירותים נפרדים" }).fill("1");
  await page.getByRole("textbox", { name: "מקסימום מבוגרים (לא חובה)" }).fill("5");
  await expect(
    page.getByText("מקסימום המבוגרים לא יכול להיות גדול ממספר האורחים המרבי"),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "מקסימום מבוגרים (לא חובה)" }).fill("2");
  await page.getByRole("textbox", { name: "מקסימום ילדים (לא חובה)" }).fill("2");

  // amenities: two from the ready list (one with a note), and one of our own
  const amen = page.getByTestId("amenities-unit");
  await amen.getByRole("button", { name: "הוספת ג׳קוזי ביחידה" }).click();
  await expect(amen.getByRole("checkbox", { name: "ג׳קוזי" })).toBeChecked();
  await amen.getByRole("textbox", { name: "הערה לג׳קוזי (לא חובה)" }).fill("ג׳קוזי מחומם");
  await amen.getByRole("button", { name: "הוספת Wi-Fi ביחידה" }).click();
  await expect(amen.getByRole("checkbox", { name: "Wi-Fi" })).toBeChecked();
  await amen.getByRole("button", { name: "מתקן משלכם" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: "שם המתקן" }).fill("סאונה");
  await sheet.getByLabel("קבוצה").selectOption({ label: "בריכה וספא" });
  // the icon radios are visually hidden inside big tap targets (labels) — tap the label
  await sheet.getByRole("radio", { name: "אייקון flame" }).locator("xpath=..").click();
  await expect(sheet.getByRole("radio", { name: "אייקון flame" })).toBeChecked();
  await sheet.getByRole("button", { name: "הוספה" }).click();
  await expect(sheet).toBeHidden();
  await expect(amen.getByRole("checkbox", { name: "סאונה" })).toBeChecked();
  // the catalogue changed, the unit not yet: nothing saved until "שמירה"
  expect(bedsOf(unit)).toBe("");
  await save(page);
  await expect(page.getByText("היחידה נשמרה")).toBeVisible();

  expect(bedsOf(unit)).toBe("king:1:חדר הורים,single:2:חדר ילדים,crib:1:-");
  expect(amenitiesOf(`l.unit_id = '${unit}'`)).toBe("Wi-Fi:-,ג׳קוזי:ג׳קוזי מחומם,סאונה:-");
  expect(
    sql(
      `SELECT separate_toilets || ',' || max_adults || ',' || max_children FROM hospitality.units WHERE id = '${unit}'`,
    ),
  ).toBe("1,2,2");
  await page.reload();
  await expect(bedRow(page, 2).getByLabel("חדר (לא חובה)")).toHaveValue("חדר ילדים");
  await expect(page.getByRole("textbox", { name: "מקסימום ילדים (לא חובה)" })).toHaveValue("2");
  await expect(
    page.getByTestId("amenities-unit").getByRole("textbox", { name: "הערה לג׳קוזי (לא חובה)" }),
  ).toHaveValue("ג׳קוזי מחומם");
  await expectAccessible(page, "unit page with beds and amenities");

  // the action log in plain Hebrew
  await page.goto(url(slug, "/manage/team"));
  await expect(page.getByText(/עדכן\/ה את היחידה צימר הזית: .*מיטות/)).toBeVisible();
});

test("property page (2d): the manager sets shared amenities, parking, a map link, guest info and house rules", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const property = propertyIdOf(ids.main!, "חוות הזית");
  await open(page, request, slug, `/manage/properties/${property}`, MANAGER);
  for (const name of [
    "מתקנים במתחם",
    "חניה",
    "מיקום במפה",
    "מידע לאורחים",
    "כללי המקום",
    "מידע פרטי להגעה",
  ])
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();

  const shared = page.getByTestId("amenities-property");
  // the catalogue is the business's: the amenities added on the unit page are here too
  await expect(shared.getByRole("checkbox", { name: "ג׳קוזי" })).not.toBeChecked();
  await shared.getByRole("button", { name: "הוספת בריכה במתחם" }).click();
  await shared.getByRole("textbox", { name: "הערה לבריכה (לא חובה)" }).fill("פתוחה מאי–ספטמבר");

  const parking = page.locator("#parking");
  await parking.getByRole("radio", { name: "חניה בתשלום" }).check();
  await expect(parking.getByText("סוג החניה — יש לבחור פרטית או משותפת")).toBeVisible();
  await parking.getByRole("radio", { name: "משותפת" }).check();
  await parking.getByRole("textbox", { name: "מספר מקומות החניה (לא חובה)" }).fill("6");
  await parking.getByRole("textbox", { name: "מחיר החניה" }).fill("30 ₪ ללילה");
  await parking.getByRole("textbox", { name: "הוראות החניה" }).fill("החניה מול השער הירוק");

  const location = page.getByRole("textbox", { name: "המיקום במפה" });
  await location.fill("https://maps.app.goo.gl/AbCdEf");
  await expect(page.getByText(/זה קישור מקוצר/)).toBeVisible();
  await location.fill(
    "https://www.google.com/maps/place/X/@32.1,35.1,17z/data=!3d32.9695!4d35.5428",
  );
  const preview = page.getByTestId("location-preview");
  await expect(preview).toContainText("32.9695, 35.5428");
  await expect(preview.getByRole("link", { name: "פתיחה ב-Waze" })).toHaveAttribute(
    "href",
    "https://waze.com/ul?ll=32.9695,35.5428&navigate=yes",
  );

  await page.getByRole("textbox", { name: "מידע שימושי לאורחים" }).fill("מכולת במרחק 5 דקות הליכה");
  const rules = page.locator("#house-rules");
  await rules.getByRole("radio", { name: "רק בחוץ" }).check();
  await rules
    .getByRole("group", { name: "בעלי חיים" })
    .getByRole("radio", { name: "בתיאום מראש" })
    .check();
  await rules.getByRole("textbox", { name: "התנאים לבעלי חיים" }).fill("כלבים קטנים בלבד");
  await rules
    .getByRole("group", { name: "מסיבות ואירועים" })
    .getByRole("radio", { name: "לא", exact: true })
    .check();
  await rules.getByLabel("שעות שקט — מ (לא חובה)").fill("22:00");
  await rules.getByLabel("שעות שקט — עד").fill("08:00");
  await expect(page.getByTestId("check-times")).toContainText("כניסה מ-15:00 · יציאה עד 11:00");
  await rules.getByRole("button", { name: "הוספת כלל" }).click();
  await rules.getByRole("textbox", { name: "כלל 1" }).fill("לכבות מזגן ביציאה");
  await save(page);
  await expect(page.getByText("המתחם נשמר")).toBeVisible();

  expect(
    sql(`SELECT concat_ws('|', parking, parking_type, parking_spaces, parking_fee_note, latitude, longitude,
                rules_smoking, rules_pets, rules_events, quiet_from, quiet_to, array_to_string(rules_custom, ';'))
           FROM hospitality.properties WHERE id = '${property}'`),
  ).toBe(
    "paid|shared|6|30 ₪ ללילה|32.969500|35.542800|outside|on_request|no|22:00:00|08:00:00|לכבות מזגן ביציאה",
  );
  expect(amenitiesOf(`l.property_id = '${property}'`)).toBe("בריכה:פתוחה מאי–ספטמבר");

  // "no parking" clears the type, spaces and price — one consistent state
  await page.reload();
  await page.locator("#parking").getByRole("radio", { name: "אין חניה" }).check();
  await save(page);
  await expect(page.getByText("המתחם נשמר")).toBeVisible();
  expect(
    sql(`SELECT concat_ws('|', parking, coalesce(parking_type, '-'), coalesce(parking_spaces::text, '-'), coalesce(parking_fee_note, '-'))
           FROM hospitality.properties WHERE id = '${property}'`),
  ).toBe("none|-|-|-");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "מידע שימושי לאורחים" })).toHaveValue(
    "מכולת במרחק 5 דקות הליכה",
  );
  await expect(page.getByTestId("location-preview")).toContainText("32.9695, 35.5428");
  await expectAccessible(page, "property page with the 2d sections");
});

test("private arrival info: separate save, hidden by default, logged without values, never in the catalog view", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const property = propertyIdOf(ids.main!, "חוות הזית");
  await open(page, request, slug, `/manage/properties/${property}`);
  const card = page.getByTestId("arrival-editor");
  await expect(card.getByLabel("קוד השער")).toHaveAttribute("type", "password");
  await card.getByLabel("קוד השער").fill("4321#");
  await card.getByLabel("שם רשת ה-Wi-Fi").fill("Zayit");
  await card.getByLabel("סיסמת ה-Wi-Fi").fill("olive-2026");
  // the page's own save bar does not see it — it has its own button
  await expect(page.getByRole("button", { name: "שמירה", exact: true })).toBeDisabled();
  await card.getByRole("button", { name: "שמירת המידע הפרטי" }).click();
  await expect(page.getByText("המידע הפרטי נשמר")).toBeVisible();
  // a door code for one zimmer
  await card.getByLabel("למי המידע").selectOption({ label: "צימר הזית" });
  await card.getByLabel("קוד הכניסה").fill("1111");
  await card.getByRole("button", { name: "שמירת המידע הפרטי" }).click();
  await expect
    .poll(() =>
      sql(`SELECT count(*) FROM hospitality.arrival_info WHERE property_id = '${property}'`),
    )
    .toBe("2");
  await card.getByRole("button", { name: "הצגת הקודים" }).click();
  await expect(card.getByLabel("קוד הכניסה")).toHaveAttribute("type", "text");

  expect(
    sql(`SELECT count(*) FROM hospitality.arrival_info WHERE property_id = '${property}'`),
  ).toBe("2");
  expect(
    sql(`SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '${ids.main}'
           AND (changes::text LIKE '%4321%' OR changes::text LIKE '%olive%' OR changes::text LIKE '%1111%')`),
  ).toBe("0");
  // the catalog view (what every staff screen loads) never carries the codes
  const token = await accessToken(request, MANAGER);
  const view = await fn(request, slug, CATALOG_FN, "hospitalityCatalog", token, undefined, "GET");
  expect(view.status()).toBe(200);
  const body = await view.text();
  expect(body).toContain("חוות הזית");
  expect(body).not.toMatch(/4321|olive-2026|Zayit|1111/);
  // the action log says which field changed
  await page.goto(url(slug, "/manage/team"));
  await expect(page.getByText(/מידע פרטי להגעה \(חוות הזית\): .*קוד השער/)).toBeVisible();
  await expect(page.getByText("4321#")).toHaveCount(0);
});

test("two browsers: beds saved in one, amenities in the other — merged, nothing overwritten", async ({
  browser,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר האלון");
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await open(pa, request, slug, `/manage/units/${unit}`);
  await open(pb, request, slug, `/manage/units/${unit}`, MANAGER);
  // both pages finish loading first: data that arrives late refreshes the form, and a change made
  // before that would be dropped (a race in the test, not the merge being tested)
  await Promise.all([pa.waitForLoadState("networkidle"), pb.waitForLoadState("networkidle")]);
  await expect(pb.getByText("אין שינויים")).toBeVisible();
  // A: one double bed
  await pa.getByTestId("beds-editor").getByRole("button", { name: "הוספת מיטה" }).click();
  await save(pa);
  await expect(pa.getByText("היחידה נשמרה")).toBeVisible();
  // B (loaded before): marks Wi-Fi — told about the beds change, keeps the Wi-Fi mark
  await pb.getByTestId("amenities-unit").getByRole("checkbox", { name: "Wi-Fi" }).check();
  await save(pb);
  await expect(notice(pb)).toContainText("היחידה עודכנה בינתיים על ידי משתמש אחר.");
  await expect(notice(pb)).toContainText("מיטות");
  await expect(
    pb.getByTestId("amenities-unit").getByRole("checkbox", { name: "Wi-Fi" }),
  ).toBeChecked();
  expect(amenitiesOf(`l.unit_id = '${unit}'`)).toBe("");
  await save(pb);
  await expect(pb.getByText("היחידה נשמרה")).toBeVisible();
  expect(bedsOf(unit)).toBe("double:1:-");
  expect(amenitiesOf(`l.unit_id = '${unit}'`)).toBe("Wi-Fi:-");
  await Promise.all([a.close(), b.close()]);
});

test("direct calls: outsiders refused; rules enforced on the server; no other site's data", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר התמר");
  const property = propertyIdOf(ids.main!, "חוות הזית");
  const owner = await accessToken(request, OWNER);
  const other = await accessToken(request, OTHER);

  // the server refuses what the screen prevents (Hebrew, next to nothing to hide)
  const tooMany = await fn(request, slug, CATALOG_FN, "hospitalityUpdateUnit", owner, {
    id: unit,
    revision: unitRev(unit),
    changes: { max_adults: 9 },
  });
  expect(await tooMany.text()).toMatch(/מקסימום המבוגרים לא יכול להיות גדול/);
  const badBed = await fn(request, slug, CATALOG_FN, "hospitalityUpdateUnit", owner, {
    id: unit,
    revision: unitRev(unit),
    changes: { beds: [{ bed_type: "waterbed", quantity: 1 }] },
  });
  expect(await badBed.text()).toMatch(/סוג המיטה/);
  const foreignAmenity = await fn(request, slug, CATALOG_FN, "hospitalityUpdateUnit", owner, {
    id: unit,
    revision: unitRev(unit),
    changes: { amenities: [{ amenity_id: "6a1e0000-0000-4000-8000-000000000001" }] },
  });
  expect(await foreignAmenity.text()).toMatch(/המתקן לא נמצא ברשימת המתקנים של העסק/);

  // anonymous / another site's owner: refused on every 2d function
  const calls: [string, unknown][] = [
    ["hospitalityAddPresetAmenity", { code: "pool" }],
    ["hospitalityCreateAmenity", { name: "x", category: "other", icon: "check" }],
    ["hospitalityArrivalInfo", { propertyId: property }],
    [
      "hospitalitySaveArrivalInfo",
      { propertyId: property, unitId: null, values: { gate_code: "0" }, revision: 1 },
    ],
  ];
  for (const [who, token] of [
    ["anonymous", undefined],
    ["other site's owner", other],
  ] as const)
    for (const [name, data] of calls) {
      const res = await fn(request, slug, DETAILS_FN, name, token, data);
      expect(await res.text(), `${who} ${name}`).toMatch(/נדרשת התחברות|אין הרשאה/);
    }
  // the other site's owner on its own site: A's property is not there (no existence leak)
  const leak = await fn(
    request,
    slugOf(DESKTOP_SITES.foreign),
    DETAILS_FN,
    "hospitalityArrivalInfo",
    other,
    {
      propertyId: property,
    },
  );
  expect(await leak.text()).toMatch(/המתחם לא נמצא/);
  expect(
    sql(`SELECT arrival_info_count FROM (SELECT count(*) AS arrival_info_count FROM hospitality.arrival_info
               WHERE tenant_id = '${ids.foreign}') x`),
  ).toBe("0");
});

test("@mobile phone: beds and amenities on the unit page, parking on the property page; accessible, no sideways scroll", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone flow");
  const slug = slugOf(MOBILE_SITES.phone);
  const unit = unitIdOf(ids.phone!, "צימר הזית");
  await open(page, request, slug, `/manage/units/${unit}`);
  await page.getByTestId("beds-editor").getByRole("button", { name: "הוספת מיטה" }).click();
  await bedRow(page, 1).getByLabel("סוג המיטה").selectOption({ label: "זוגית" });
  await page
    .getByTestId("amenities-unit")
    .getByRole("button", { name: "הוספת מיזוג ביחידה" })
    .click();
  await expect(
    page.getByTestId("amenities-unit").getByRole("checkbox", { name: "מיזוג" }),
  ).toBeChecked();
  expect(await noSideways(page)).toBe(true);
  await save(page);
  await expect(page.getByText("היחידה נשמרה")).toBeVisible();
  expect(bedsOf(unit)).toBe("double:1:-");
  await expectAccessible(page, "phone: unit page with beds");

  await page.goto(url(slug, `/manage/properties/${propertyIdOf(ids.phone!, "חוות הזית")}`));
  await page.locator("#parking").getByRole("radio", { name: "חניה בחינם" }).check();
  await page.locator("#parking").getByRole("radio", { name: "פרטית" }).check();
  expect(await noSideways(page)).toBe(true);
  await save(page);
  await expect(page.getByText("המתחם נשמר")).toBeVisible();
  await expectAccessible(page, "phone: property page with parking");
});

test("Ecommerce untouched: store data unchanged", ({ request: _request }) => {
  expect(storeDataHash()).toBe(storeHash);
});
