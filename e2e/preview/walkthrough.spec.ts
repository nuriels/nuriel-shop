import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { ACCOUNTS, DEMO_PASSWORD, SITES } from "../../scripts/preview/demo-data.mjs";
import { loadSession, passwordSession } from "../tests/hospitality-helpers";

// סיור מוקלט בתצוגה המקומית של Hospitality (P0): התהליכים האמיתיים בממשק — מחשב
// וטלפון — עם צילומי מסך וסרטונים. רץ מול Supabase המקומי ונתוני ההדגמה בלבד.
// כל צעד גם נבדק (כותרות, רשימות, שמירה), כך שהסיור הוא גם בדיקה של ערכת התצוגה.

const OUT = fileURLToPath(new URL("./out/", import.meta.url));
const SCREENS = `${OUT}screens`;
const VIDEOS = `${OUT}videos`;
mkdirSync(SCREENS, { recursive: true });
mkdirSync(VIDEOS, { recursive: true });

const PORT = 3100;
const site = (slug: string) => `http://${slug}.shop.localhost:${PORT}`;
const PLATFORM = `http://platform.shop.localhost:${PORT}`;

function sql(query: string): string {
  const url = process.env["DB_URL"];
  if (!url) throw new Error("e2e/.env.e2e is not loaded (DB_URL)");
  return execFileSync("psql", [url, "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();
}
/** כמו בפאנל: הפעולה רצה כמנהל הפלטפורמה של ההדגמה */
const asDemoAdmin = (query: string) =>
  sql(`SELECT set_config('request.jwt.claims', json_build_object('sub',
         (SELECT id FROM auth.users WHERE email = '${ACCOUNTS.admin}'), 'role', 'authenticated')::text, false);
       ${query}`);

const pause = (page: Page, ms = 700) => page.waitForTimeout(ms);
async function quiet(page: Page) {
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10_000 });
  await pause(page, 300);
}
/** במחשב — כל העמוד; בטלפון — מה שרואים על המסך (השורה התחתונה הקבועה לא נחתכת באמצע) */
async function shot(page: Page, project: string, name: string, fullPage = project !== "phone") {
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0));
  await pause(page, 300);
  await page.screenshot({ path: `${SCREENS}/${project}-${name}.png`, fullPage });
}
/** סוגרים את הלשוניות ושומרים לכל אחת סרטון בשם התהליך */
async function finish(context: BrowserContext, project: string, flow: string, pages: Page[]) {
  await context.close();
  let n = 0;
  for (const page of pages) {
    const video = page.video();
    if (!video) continue;
    n += 1;
    await video.saveAs(`${VIDEOS}/${project}-${flow}${n > 1 ? `-${n}` : ""}.webm`);
  }
}

async function manageLogin(page: Page, slug: string, email: string) {
  await page.goto(`${site(slug)}/manage/login`);
  await page.getByRole("tab", { name: "סיסמה" }).click();
  await page.getByLabel("אימייל או שם משתמש").fill(email);
  await page.locator("#manage-password").fill(DEMO_PASSWORD);
  await pause(page, 400);
  await page.getByRole("button", { name: "כניסה" }).click();
  await page.waitForURL((url) => url.pathname === "/manage");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await quiet(page);
}

/**
 * כניסה בלי מסך הכניסה (פרקים 08 ואילך): הסשן מהשירות של Supabase המקומי, כמו בבדיקות
 * ה-E2E. מסך הכניסה עצמו מוצג בפרקים 02–06; כניסה דרך המסך מוגבלת ל-15 ב-15 דקות לכל IP,
 * וכל הסיור רץ מאותה כתובת.
 */
async function signedIn(
  page: Page,
  request: APIRequestContext,
  slug: string,
  email: string,
  path: string,
) {
  const session = await passwordSession(request, site(slug), { email, password: DEMO_PASSWORD });
  await loadSession(page, session, path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await quiet(page);
}

/** ניווט: בצד (מחשב) או בשורה התחתונה + "עוד" (טלפון) */
async function go(page: Page, phone: boolean, label: string, path: string) {
  const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
  if (!phone || label === "לוח בקרה" || label === "יחידות") {
    await nav.getByRole("link", { name: label }).click();
  } else {
    await nav.getByRole("button", { name: "עוד מסכים" }).click();
    await pause(page, 500);
    await page
      .getByRole("dialog", { name: "עוד מסכים" })
      .getByRole("link", { name: label })
      .click();
  }
  await page.waitForURL((url) => url.pathname === path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await pause(page);
}

const unitRow = (page: Page, name: string) => page.locator(`li[data-unit="${name}"]`);
const sheet = (page: Page) => page.getByRole("dialog");

// כל מכשיר מתחיל מנתוני הדגמה טריים (מה שהמחשב שינה לא מופיע בטלפון). האתרים נוצרים
// מחדש עם אותן כתובות — ממתינים שהזיכרון של השרת לכתובות (15 שניות) יתרענן.
test.beforeAll(async () => {
  execFileSync(
    "node",
    [fileURLToPath(new URL("../../scripts/preview/hospitality-demo.mjs", import.meta.url))],
    {
      stdio: "ignore",
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 16_000));
});

test("01 platform admin: the stores list, then into a Hospitality site's management", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === "phone", "the platform panel is a desktop screen");
  const p = info.project.name;
  await page.goto(`${PLATFORM}/login`);
  await page.getByLabel("אימייל או שם משתמש").fill(ACCOUNTS.admin);
  await page.locator("#password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "התחבר", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await page.goto(`${PLATFORM}/platform`);
  const row = page.getByRole("row", { name: /צימרי הגליל/ });
  await expect(row).toBeVisible();
  await pause(page, 900);
  await shot(page, p, "01-platform-stores");
  // הכפתור פותח את כתובת האתר כמו בשרת אמיתי (https://<site>.shop.localhost, בלי פורט);
  // מקומית האפליקציה על http ופורט 3100 — ההקלטה מפנה לשם (האפליקציה עצמה לא משתנה)
  await context.route(/^https:\/\/[a-z0-9-]+\.shop\.localhost\//, (route) => {
    const target = new URL(route.request().url());
    return route.fulfill({
      status: 302,
      headers: { location: `http://${target.hostname}:${PORT}${target.pathname}${target.search}` },
    });
  });
  const [manage] = await Promise.all([
    context.waitForEvent("page"),
    row.getByRole("button", { name: "היכנס לניהול" }).click(),
  ]);
  await manage.waitForURL(/demo-zimmer\.shop\.localhost.*\/manage/, { timeout: 30_000 });
  await expect(manage.getByRole("heading", { level: 1 })).toBeVisible();
  await pause(manage, 1200);
  await shot(manage, p, "02-platform-into-site-dashboard");
  await finish(context, p, "01-platform-into-site", [page, manage]);
});

test("02 zimmer complex owner: dashboard, units, edit a zimmer, settings, team", async ({
  page,
  context,
}, info) => {
  const p = info.project.name;
  const phone = p === "phone";
  await manageLogin(page, "demo-zimmer", ACCOUNTS.zimmerOwner);
  await pause(page, 900);
  await shot(page, p, "03-zimmer-dashboard");

  await go(page, phone, "יחידות", "/manage/units");
  for (const name of ["צימר הגפן", "צימר האלון", "צימר התאנה", "סוויטת הנוף"]) {
    await expect(unitRow(page, name)).toBeVisible();
  }
  await shot(page, p, "04-zimmer-units");

  await unitRow(page, "צימר הגפן")
    .getByRole("button", { name: /^עריכה של צימר הגפן/ })
    .click();
  await sheet(page)
    .getByRole("textbox", { name: "תיאור היחידה" })
    .fill("צימר זוגי עם ג׳קוזי, אח מבוערת ונוף לגליל.");
  await pause(page);
  await shot(page, p, "05-zimmer-edit-unit", false);
  await sheet(page).getByRole("button", { name: "שמירה" }).click();
  await expect(sheet(page)).toBeHidden();
  await quiet(page);

  await go(page, phone, "הגדרות העסק", "/manage/settings");
  await expect(page.getByLabel("שם העסק")).toHaveValue("צימרי הגליל");
  await shot(page, p, "06-zimmer-settings");
  await go(page, phone, "צוות ניהול", "/manage/team");
  await shot(page, p, "07-zimmer-team");
  await finish(context, p, "02-zimmer-owner", [page]);
});

test("03 villa owner: one villa, edit its details", async ({ page, context }, info) => {
  const p = info.project.name;
  const phone = p === "phone";
  await manageLogin(page, "demo-villa", ACCOUNTS.villaOwner);
  await pause(page, 900);
  await shot(page, p, "08-villa-dashboard");
  await go(page, phone, "יחידות", "/manage/units");
  await expect(unitRow(page, "וילה בכרם")).toBeVisible();
  await shot(page, p, "09-villa-units");
  await unitRow(page, "וילה בכרם")
    .getByRole("button", { name: /^עריכה של וילה בכרם/ })
    .click();
  await sheet(page).getByRole("textbox", { name: "חדרי רחצה", exact: true }).fill("4");
  await pause(page);
  await shot(page, p, "10-villa-edit", false);
  await sheet(page).getByRole("button", { name: "שמירה" }).click();
  await expect(sheet(page)).toBeHidden();
  await quiet(page);
  await finish(context, p, "03-villa-owner", [page]);
});

test("04 boutique hotel manager: rooms list, add a room (no team / plan screens)", async ({
  page,
  context,
}, info) => {
  const p = info.project.name;
  const phone = p === "phone";
  const room = phone ? "חדר 205 — זוגי" : "חדר 204 — זוגי";
  await manageLogin(page, "demo-hotel", ACCOUNTS.hotelManager);
  await pause(page, 900);
  await shot(page, p, "11-hotel-manager-dashboard");
  // מנהל/ת: בלי צוות ניהול (הרשאת בעלים)
  await expect(page.getByRole("link", { name: "צוות ניהול" })).toHaveCount(0);

  await go(page, phone, "יחידות", "/manage/units");
  const hotel = SITES.find((s) => s.slug === "demo-hotel")!;
  for (const unit of hotel.units) await expect(unitRow(page, unit.name)).toBeVisible();
  await shot(page, p, "12-hotel-rooms");
  await page
    .locator('[data-property="מלון הנמל"]')
    .getByRole("button", { name: /^הוספת יחידה ל/ })
    .click();
  await sheet(page).getByRole("textbox", { name: "שם היחידה", exact: true }).fill(room);
  await sheet(page).getByRole("combobox", { name: "סוג היחידה" }).selectOption({ label: "חדר" });
  await sheet(page).getByRole("textbox", { name: "מספר האורחים המרבי", exact: true }).fill("2");
  await pause(page);
  await shot(page, p, "13-hotel-add-room", false);
  await sheet(page).getByRole("button", { name: "הוספת היחידה" }).click();
  await expect(unitRow(page, room)).toBeVisible();
  await quiet(page);
  await shot(page, p, "14-hotel-rooms-after-add");
  await finish(context, p, "04-hotel-manager", [page]);
});

test("05 boutique hotel owner: the team with the reception manager", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === "phone", "one view is enough");
  const p = info.project.name;
  await manageLogin(page, "demo-hotel", ACCOUNTS.hotelOwner);
  await go(page, false, "צוות ניהול", "/manage/team");
  await expect(page.getByText("רוני — קבלה").first()).toBeVisible();
  await shot(page, p, "15-hotel-owner-team");
  await finish(context, p, "05-hotel-owner-team", [page]);
});

test("06 first run on a new empty site: 'what do you rent?' → ready list", async ({
  page,
  context,
}, info) => {
  const p = info.project.name;
  const phone = p === "phone";
  const slug = `demo-first-run-${p}`;
  const old = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  if (old) asDemoAdmin(`SELECT public.platform_delete_tenant('${old}', '${slug}')`);
  asDemoAdmin(`SELECT hospitality.admin_create_site('${slug}', 'אתר חדש להדגמה')`);
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       SELECT '${id}', id, email, 'demo_first_run_${p}', 'admin', true, true
         FROM auth.users WHERE email = '${ACCOUNTS.villaOwner}'`);
  asDemoAdmin(`SELECT public.platform_set_flag('hospitality_backend_enabled', true, '${id}');
               SELECT public.platform_set_flag('hospitality_management_enabled', true, '${id}')`);
  try {
    await manageLogin(page, slug, ACCOUNTS.villaOwner);
    await go(page, phone, "יחידות", "/manage/units");
    await expect(page.getByText("מה אתם משכירים?")).toBeVisible();
    await shot(page, p, "16-first-run-choose");
    if (phone) {
      await page.locator('label[data-business-type="villa"]').click();
      await page.getByRole("button", { name: "המשך" }).click();
      await page.getByRole("textbox", { name: "שם הווילה" }).fill("וילה על הים");
      await page.getByRole("textbox", { name: "כמה אורחים לכל היותר" }).fill("8");
      await page.getByRole("textbox", { name: "חדרי שינה" }).fill("3");
    } else {
      await page.locator('label[data-business-type="zimmer_complex"]').click();
      await page.getByRole("button", { name: "המשך" }).click();
      await page.getByRole("textbox", { name: "שם המתחם" }).fill("צימרי הכרמל");
      await page.getByRole("textbox", { name: "שם הצימר (1)" }).fill("צימר הזית");
      await page.getByRole("textbox", { name: "שם הצימר (2)" }).fill("צימר הרימון");
    }
    await pause(page);
    await shot(page, p, "17-first-run-form", false);
    await page.getByRole("button", { name: "יצירת מקום האירוח" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: phone ? "וילה על הים" : "צימרי הכרמל" }),
    ).toBeVisible();
    await quiet(page);
    await shot(page, p, "18-first-run-ready");
  } finally {
    await finish(context, p, "06-first-run", [page]);
    asDemoAdmin(`SELECT public.platform_delete_tenant('${id}', '${slug}')`);
  }
});

test("07 the store (Ecommerce) is unchanged", async ({ page, context }, info) => {
  const p = info.project.name;
  await page.goto(site("kobi"));
  await expect(page.getByRole("banner")).toBeVisible();
  await pause(page, 1200);
  await shot(page, p, "19-store-home", false);
  await finish(context, p, "07-store-unchanged", [page]);
});

// ---------------------------------------------------------------- Stage 2c.3

test("08 zimmer complex owner: the property page — 'rent the whole property' with chosen units; a unit page; switching a unit off", async ({
  page,
  context,
  request,
}, info) => {
  const p = info.project.name;
  await signedIn(page, request, "demo-zimmer", ACCOUNTS.zimmerOwner, "/manage/units");
  await page
    .locator('[data-property="צימרי הגליל"]')
    .getByRole("link", { name: /^ניהול המתחם/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "צימרי הגליל" })).toBeVisible();
  await pause(page);
  await shot(page, p, "20-zimmer-property");

  // "כל המתחם" כולל עכשיו ארבע יחידות — מוציאים את סוויטת הנוף
  const whole = page.locator('[data-section="whole"]');
  await whole.scrollIntoViewIfNeeded();
  await expect(page.getByRole("switch", { name: "השכרת המתחם כולו" })).toBeChecked();
  await page.getByRole("checkbox", { name: "סוויטת הנוף" }).click();
  await pause(page);
  await page.getByRole("button", { name: "שמירת ההשכרה" }).click();
  await expect(page.getByText('היחידות של "כל המתחם" עודכנו')).toBeVisible();
  await quiet(page);
  await whole.scrollIntoViewIfNeeded();
  await shot(page, p, "21-zimmer-whole-property", false);

  // עמוד הסוויטה — והשבתה (למשל לשיפוץ)
  await page.locator('[data-section="units"]').getByRole("link", { name: "סוויטת הנוף" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "סוויטת הנוף" })).toBeVisible();
  await pause(page);
  await shot(page, p, "22-zimmer-unit-page");
  await page.getByRole("button", { name: "השבתת היחידה" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("להשבית את סוויטת הנוף?");
  await pause(page);
  await shot(page, p, "23-zimmer-deactivate-confirm", false);
  await page.getByRole("alertdialog").getByRole("button", { name: "השבתה" }).click();
  await expect(page.getByText("היחידה הושבתה")).toBeVisible();
  await quiet(page);

  // ברשימה: הסוויטה תחת "יחידות לא פעילות", ו"כל המתחם" עם שלוש יחידות
  await page.getByRole("link", { name: "חזרה ליחידות ומתחמים" }).click();
  const card = page.locator('[data-property="צימרי הגליל"]');
  await card.getByRole("button", { name: "יחידות לא פעילות (1)" }).click();
  await expect(unitRow(page, "סוויטת הנוף")).toContainText("לא פעילה");
  await expect(unitRow(page, "כל המתחם — צימרי הגליל")).toContainText("הזמנה אחת ל-3 יחידות");
  await expect(page.getByTestId("units-limit")).toHaveText("3 מתוך 5 יחידות פעילות בחבילה");
  await pause(page);
  await shot(page, p, "24-zimmer-list-inactive");
  await finish(context, p, "08-zimmer-property-whole-inactive", [page]);
});

test("09 boutique hotel owner: ordering the rooms — arrows, and drag on the computer; saved at once", async ({
  page,
  context,
  request,
}, info) => {
  const p = info.project.name;
  const phone = p === "phone";
  const suite = "סוויטה 302 — ג׳קוזי";
  const hotelOrder = () =>
    sql(`SELECT string_agg(u.name, ',' ORDER BY u.sort_order, u.created_at) FROM hospitality.units u
           JOIN public.tenants t ON t.id = u.tenant_id
          WHERE t.slug = 'demo-hotel' AND u.kind <> 'whole_property' AND u.is_active`);
  await signedIn(page, request, "demo-hotel", ACCOUNTS.hotelOwner, "/manage/units");
  await page
    .locator('[data-property="מלון הנמל"]')
    .getByRole("button", { name: /^סידור היחידות/ })
    .click();
  const order = page.getByTestId("unit-order");
  const hotel = SITES.find((s) => s.slug === "demo-hotel")!;
  // שמונת החדרים מההדגמה + החדר שנוסף בתהליך 04
  await expect(order.locator("li")).toHaveCount(hotel.units.length + 1);
  await order.scrollIntoViewIfNeeded();
  await pause(page);
  await shot(page, p, "25-hotel-order", false);

  // סוויטת הג'קוזי למעלה: בחצים (ובמחשב — את השאר בגרירה)
  const up = order.getByRole("button", { name: `הזזת ${suite} למעלה` });
  for (let i = 0; i < (phone ? 7 : 2); i++) {
    await expect(up).toBeEnabled();
    await up.click();
    await pause(page, 400);
  }
  if (!phone) {
    await expect(up).toBeEnabled();
    await order.locator(`li[data-unit="${suite}"]`).dragTo(order.locator("li").first());
  }
  await expect.poll(hotelOrder).toMatch(new RegExp(`^${suite},`));
  await expect(order.locator("li").first()).toHaveAttribute("data-unit", suite);
  await pause(page);
  await shot(page, p, "26-hotel-order-moved", false);
  await order.getByRole("button", { name: "סיום הסידור" }).click();
  await expect(
    page.getByRole("list", { name: "היחידות במלון הנמל" }).locator("li").first(),
  ).toHaveAttribute("data-unit", suite);
  await quiet(page);
  await shot(page, p, "27-hotel-rooms-ordered");
  await finish(context, p, "09-hotel-room-order", [page]);
});
