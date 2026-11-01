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

// Hospitality Stage 2f — מחירים, כללי מחיר ומדיניות ביטול, על השרת הבנוי:
//   • מחיר בסיס ליחידה; כלל סוף שבוע ועונה; תצוגת מחיר מהשרת (לילה לילה, סה"כ, מינימום לילות);
//   • מדיניות: תבנית, דוגמה חיה מהשרת, שמירה (גרסה), ברירת מחדל, גרסאות קודמות;
//   • הצ'קליסט מוביל למסכים; זרים נחסמים; טלפון; נגישות; בלי שינוי בחנויות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "h2f.owner@e2e.test", password: "H2f-Owner-Pass-1!" };
const MANAGER = { email: "h2f.manager@e2e.test", password: "H2f-Manager-Pass-1!" };
const OTHER = { email: "h2f.other@e2e.test", password: "H2f-Other-Pass-1!" };
const FN = "src/engines/hospitality/api/pricing.functions.ts";

const DESKTOP_SITES = { main: "h2f-main", foreign: "h2f-foreign" } as const;
const MOBILE_SITES = { phone: "h2f-m" } as const;
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
    `SELECT id || '|' || slug FROM public.tenants WHERE slug ~ '^h2f-' AND site_type = 'hospitality'`,
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
function seedProperty(site: string, units: string[]) {
  const tag = Math.random().toString(36).slice(2, 8);
  const id = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
                  VALUES ('${site}', 'חוות הזית', 'p-${tag}', 'active', 'zimmer_complex') RETURNING id`);
  units.forEach((u, i) =>
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, unit_type, name, slug, sort_order, capacity)
         VALUES ('${site}', '${id}', 'unit', 'zimmer', '${u}', 'u-${tag}-${i}', ${i}, 4)`),
  );
}
const unitIdOf = (site: string, name: string) =>
  sql(`SELECT id FROM hospitality.units WHERE tenant_id = '${site}' AND name = '${name}'`);
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
/** the next date (≥ today + n) with the weekday (0 = Sunday) */
const nextDow = (n: number, dow: number) => {
  const d = new Date(Date.now() + n * 86400000);
  d.setUTCDate(d.getUTCDate() + ((dow - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
};

test.beforeAll(async ({ request }, testInfo) => {
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
    if (key === "foreign") addStaff(id, OTHER, `h2f_other_${project}${suffix}`, true);
    else addStaff(id, OWNER, `h2f_owner_${key}_${project}${suffix}`, true);
    if (key === "main") addStaff(id, MANAGER, `h2f_manager_${project}${suffix}`, false);
    sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
         ('${id}', 'hospitality_backend_enabled', true), ('${id}', 'hospitality_management_enabled', true)`);
    seedProperty(id, key === "foreign" ? ["יחידה זרה"] : ["צימר הזית", "צימר האלון"]);
  }
  for (const slug of Object.values(sitesFor(project)))
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), "/manage/pricing")).status(), {
        timeout: 20_000,
      })
      .toBe(200);
});

test.afterAll(({ request: _request }, testInfo) => {
  cleanup(testInfo.project.name);
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("prices: base price per unit, a weekend rule and a season — the server's price summary shows them", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר הזית");
  // the setup steps "מחירים" / "מדיניות ביטול" link to the new screens
  await open(page, request, slug, "/manage", MANAGER);
  await expect(
    page.locator('li[data-step="prices"]').getByRole("link", { name: /^להשלמה/ }),
  ).toHaveAttribute("href", /\/manage\/pricing$/);
  await page
    .locator('li[data-step="prices"]')
    .getByRole("link", { name: /^להשלמה/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "מחירים" })).toBeVisible();

  const row = page.locator('[data-unit-price="צימר הזית"]');
  await expect(row).toContainText("אין עדיין מחיר");
  await row.getByLabel("מחיר ללילה").fill("650");
  await row.getByLabel("תוספת למבוגר").fill("120");
  await row.getByLabel("מינימום לילות").fill("2");
  await row.getByRole("button", { name: "שמירת המחירים" }).click();
  await expect(page.getByText("המחירים של צימר הזית נשמרו")).toBeVisible();
  expect(
    sql(
      `SELECT base_price || '|' || extra_adult_price || '|' || min_nights FROM hospitality.units WHERE id = '${unit}'`,
    ),
  ).toBe("650.00|120.00|2");

  // a weekend rule for every unit
  await page.getByRole("button", { name: "הוספת כלל מחיר" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("שם הכלל").fill("סוף שבוע");
  await sheet.getByLabel("סוג").selectOption("weekend");
  await sheet.getByLabel("סכום").fill("900");
  await sheet.getByRole("button", { name: "הוספה" }).click();
  await expect(page.locator('[data-rule="סוף שבוע"]')).toContainText("900");

  // a season with a percent and a minimum
  const sunday = nextDow(30, 0);
  const plus7 = new Date(Date.parse(sunday) + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByRole("button", { name: "הוספת כלל מחיר" }).click();
  await sheet.getByLabel("שם הכלל").fill("קיץ");
  await sheet.getByLabel("סוג").selectOption("season");
  await sheet.getByLabel("על מה הכלל חל").selectOption({ label: "צימר האלון" });
  await sheet.getByLabel("מתאריך (הלילה הראשון)").fill(sunday);
  await sheet.getByLabel("עד תאריך (היציאה)").fill(plus7);
  await sheet.getByLabel("אופן המחיר").selectOption("percent");
  await sheet.getByLabel(/אחוז/).fill("20");
  await sheet.getByLabel("מינימום לילות (לא חובה)").fill("3");
  await sheet.getByRole("button", { name: "הוספה" }).click();
  await expect(page.locator('[data-rule="קיץ"]')).toContainText("+20% ממחיר הבסיס");
  await expect(page.locator('[data-rule="קיץ"]')).toContainText("לפחות 3 לילות");
  expect(sql(`SELECT count(*) FROM hospitality.rate_rules WHERE tenant_id = '${ids.main}'`)).toBe(
    "2",
  );

  // the price summary from the server: Sunday (base) + Thursday is a weekend night; 3 adults → extras
  const thursday = nextDow(40, 4);
  const preview = page.locator('[data-section="preview"]');
  await preview.getByLabel("יחידה").selectOption({ label: "צימר הזית" });
  await preview.getByLabel("כניסה").fill(thursday);
  await preview
    .getByLabel("יציאה")
    .fill(new Date(Date.parse(thursday) + 86400000).toISOString().slice(0, 10));
  await preview.getByLabel("מבוגרים").fill("3");
  await preview.getByRole("button", { name: "חישוב מחיר" }).click();
  const summary = page.getByTestId("price-summary");
  await expect(summary).toContainText("סוף שבוע");
  await expect(page.getByTestId("price-total")).toContainText("1,020");
  await expect(summary).toContainText("לפחות 2 לילות");
  await expectAccessible(page, "pricing screen");
});

test("policies: a template, the live example from the server, a new version, default and history", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  await open(page, request, slug, "/manage/policies");
  await expect(page.locator('[data-policy="גמישה"]')).toContainText("ברירת המחדל");
  await page.getByRole("button", { name: "מדיניות חדשה" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("שם המדיניות").fill("רגילה לקיץ");
  await sheet.getByRole("button", { name: "תבנית: רגיל" }).click();
  await sheet.getByLabel("אם האורח מבטל").fill("5");
  await expect(sheet.getByTestId("policy-example-result")).toContainText("משלם");
  await expect(sheet.getByTestId("policy-example-result")).toContainText("500");
  await sheet.getByLabel("אם האורח מבטל").fill("10");
  await expect(sheet.getByTestId("policy-example-result")).toContainText("ביטול חינם");
  await sheet.getByRole("button", { name: "הוספה" }).click();
  await expect(page.getByText("המדיניות נוספה")).toBeVisible();
  const card = page.locator('[data-policy="רגילה לקיץ"]');
  await expect(card.getByTestId("policy-summary")).toContainText("ביטול חינם עד 7 ימים לפני ההגעה");

  // edit → version 2; history shows both
  await card.getByRole("button", { name: "עריכה" }).click();
  await sheet.getByLabel("ביטול חינם עד כמה ימים לפני ההגעה").fill("10");
  await sheet.getByLabel("מ-X ימים לפני").first().fill("10");
  await sheet.getByRole("button", { name: "שמירת גרסה חדשה" }).click();
  await expect(page.getByText("נשמרה גרסה 2")).toBeVisible();
  await card.getByRole("button", { name: "גרסאות קודמות" }).click();
  await expect(page.getByTestId("policy-history").locator("li")).toHaveCount(2);
  await page.getByRole("dialog").getByRole("button", { name: "סגירה" }).click();

  await card.getByRole("button", { name: "ברירת מחדל" }).click();
  await expect(card).toContainText("ברירת המחדל");
  expect(
    sql(`SELECT name FROM hospitality.policies WHERE tenant_id = '${ids.main}' AND is_default`),
  ).toBe("רגילה לקיץ");
  // a settled page (no button mid colour-transition after the switch)
  await page.reload();
  await expect(page.locator('[data-policy="רגילה לקיץ"]')).toContainText("ברירת המחדל");
  await expectAccessible(page, "policies screen");
});

test("direct calls: anonymous and another site's owner are refused", async ({ request }) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const slug = slugOf(DESKTOP_SITES.main);
  const unit = unitIdOf(ids.main!, "צימר הזית");
  const other = await accessToken(request, OTHER);
  const calls: [string, unknown, "GET" | "POST"][] = [
    ["hospitalityPricing", undefined, "GET"],
    ["hospitalitySetUnitPrices", { id: unit, changes: { base_price: 1 }, revision: 1 }, "POST"],
    ["hospitalitySaveRule", { id: null, data: { name: "x", kind: "weekend", value: 1 } }, "POST"],
    [
      "hospitalityPriceQuote",
      { unitId: unit, checkIn: "2030-01-01", checkOut: "2030-01-02", adults: 2, children: 0 },
      "POST",
    ],
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
  expect(sql(`SELECT base_price FROM hospitality.units WHERE id = '${unit}'`)).toBe("650.00");
});

test("@mobile phone: prices on the phone — one column, no sideways scroll, accessible", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name !== "mobile", "phone flow");
  const slug = slugOf(MOBILE_SITES.phone);
  await open(page, request, slug, "/manage/pricing");
  const row = page.locator('[data-unit-price="צימר הזית"]');
  await row.getByLabel("מחיר ללילה").fill("480");
  await row.getByRole("button", { name: "שמירת המחירים" }).click();
  await expect(page.getByText("המחירים של צימר הזית נשמרו")).toBeVisible();
  expect(await noSideways(page)).toBe(true);
  await expectAccessible(page, "phone: pricing");
  await page.goto(url(slug, "/manage/policies"));
  await expect(page.getByRole("heading", { level: 1, name: "מדיניות ביטול" })).toBeVisible();
  expect(await noSideways(page)).toBe(true);
});

test("Ecommerce untouched: store data unchanged", ({ request: _request }) => {
  expect(storeDataHash()).toBe(storeHash);
});
