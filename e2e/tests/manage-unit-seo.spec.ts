import { expect, test, type APIRequestContext } from "@playwright/test";
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

// Google SEO, שלב 2 — כותרת ותיאור לגוגל ליחידה (מיגרציה 20261110200000), מקצה לקצה:
//   • בעל העסק כותב כותרת ותיאור בכרטיס "גוגל ושיתוף" ושומר — נשמר במסד, הגרסה עולה ביחידה אחת,
//     ויש רישום ביומן; עמוד היחידה באתר (SSR) מציג את הכותרת והתיאור החדשים;
//   • אחרי השמירה הזו שמירה רגילה של פרטי היחידה עוברת — בלי "עודכן בינתיים" ובלי למחוק את ה-SEO;
//   • כותרת ארוכה מדי — הודעה ליד השדה ושום דבר לא נשמר; ריקון — חזרה לברירת המחדל של האתר;
//   • נגישות, ובלי שום שינוי בנתוני החנויות.

test.describe.configure({ mode: "serial" });

const OWNER = { email: "useo.owner@e2e.test", password: "Useo-Owner-Pass-1!" };
const SLUG = "useo-site";
const HOST = hostOf(SLUG);
const URL_ = (path = "/") => `http://${HOST}:${PORT}${path}`;
const UNIT_SLUG = "useo-gefen";
const UNIT_PATH = `/stay/units/${UNIT_SLUG}`;
const SEO_TITLE = "צימר הגפן בגליל — נוף לכנרת וארוחת בוקר";
const SEO_DESCRIPTION = "צימר זוגי עם בריכה פרטית ונוף לכנרת, ארוחת בוקר כלולה.";
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
] as const;

let siteId = "";
let unitId = "";
let owner: SavedSession | null = null;
let storeHash = "";
let defaultHead = { title: "", description: "" };

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SLUG}')`);
}

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);

const unitRow = () =>
  sql(`SELECT coalesce(seo_title, '∅') || '|' || coalesce(seo_description, '∅') || '|' || revision
         FROM hospitality.units WHERE id = '${unitId}'`);
const auditCount = () =>
  Number(
    sql(`SELECT count(*) FROM hospitality.audit_log
          WHERE tenant_id = '${siteId}' AND action = 'catalog.unit_updated'`),
  );

/** הכותרת והתיאור שהשרת מחזיר בעמוד היחידה (כמו שגוגל קורא אותו) */
async function publicHead(request: APIRequestContext) {
  const res = await hostGet(request, HOST, UNIT_PATH);
  expect(res.status(), UNIT_PATH).toBe(200);
  const html = await res.text();
  const tag = /<meta[^>]*name="description"[^>]*>/.exec(html)?.[0] ?? "";
  return {
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "",
    description: /content="([^"]*)"/.exec(tag)?.[1] ?? "",
  };
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(
    testInfo.project.name === "mobile",
    "the unit SEO card flow runs once, on the computer",
  );
  cleanup();
  storeHash = storeDataHash();
  const ownerId = await ensureUser(request, OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${SLUG}', 'נופי הגפן', '${OWNER.email}')`);
  siteId = sql(`SELECT id FROM public.tenants WHERE slug = '${SLUG}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved)
       VALUES ('${siteId}', '${ownerId}', '${OWNER.email}', 'useo_owner', 'admin', true) ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${siteId}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const propertyId = sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status)
       VALUES ('${siteId}', 'נופי הגפן', 'useo-p', 'active') RETURNING id`);
  unitId = sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity,
                                               base_occupancy, base_price, description)
       VALUES ('${siteId}', '${propertyId}', 'unit', 'צימר הגפן', '${UNIT_SLUG}', 2, 2, 600,
               'צימר זוגי בגליל. ג׳קוזי ונוף.') RETURNING id`);
  await expect
    .poll(async () => (await hostGet(request, HOST, UNIT_PATH)).status(), { timeout: 20_000 })
    .toBe(200);
  // ברירת המחדל של האתר לפני שיש כותרת לגוגל: שם היחידה | שם העסק, והמשפט הראשון של התיאור
  defaultHead = await publicHead(request);
  expect(defaultHead.title).toContain("צימר הגפן");
  expect(defaultHead.title).not.toBe(SEO_TITLE);
  owner = await passwordSession(request, URL_(""), OWNER);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("the owner saves a Google title and description — the unit page head uses them", async ({
  page,
  request,
}) => {
  const [, , rev0] = unitRow().split("|");
  const audit0 = auditCount();
  await loadSession(page, owner!, `/manage/units/${unitId}`);
  const card = page.locator('[data-section="unit-seo"]');
  await expect(card.getByRole("heading", { level: 2, name: "גוגל ושיתוף" })).toBeVisible();
  const title = card.getByLabel("כותרת לגוגל (Meta Title)", { exact: true });
  const description = card.getByLabel("תיאור לגוגל (Meta Description)", { exact: true });
  await expect(title).toHaveValue("");
  await expect(title).toHaveAttribute("placeholder", /^צימר הגפן \| /);
  const save = card.getByRole("button", { name: "שמירת הכותרת והתיאור" });
  await expect(save).toBeDisabled();

  await title.fill(SEO_TITLE);
  await description.fill(SEO_DESCRIPTION);
  await expect(card).toContainText(`${SEO_TITLE.length} תווים · מומלץ עד 60`);
  await save.click();
  await expect(page.getByText("הכותרת והתיאור לגוגל נשמרו")).toBeVisible({ timeout: 15_000 });
  await expect(save).toBeDisabled();
  expect(unitRow()).toBe(`${SEO_TITLE}|${SEO_DESCRIPTION}|${Number(rev0) + 1}`);
  expect(auditCount()).toBe(audit0 + 1);

  // העמוד באתר — הכותרת והתיאור החדשים (ה-SSR שגוגל קורא)
  await expect
    .poll(async () => publicHead(request), { timeout: 20_000 })
    .toEqual({ title: SEO_TITLE, description: SEO_DESCRIPTION });

  // אחרי רענון — הערכים השמורים בטופס
  await page.reload();
  await expect(title).toHaveValue(SEO_TITLE);
  await expect(description).toHaveValue(SEO_DESCRIPTION);
  await expectAccessible(page, "unit page with the Google card");
});

test("after the Google save, the unit details still save — no false conflict, SEO kept", async ({
  page,
}) => {
  await loadSession(page, owner!, `/manage/units/${unitId}`);
  const card = page.locator('[data-section="unit-seo"]');
  await expect(card.getByLabel("כותרת לגוגל (Meta Title)", { exact: true })).toHaveValue(SEO_TITLE);
  // שמירה בכרטיס (שינוי קטן בתיאור לגוגל) ומיד אחריה שמירה של פרטי היחידה באותו עמוד
  await card
    .getByLabel("תיאור לגוגל (Meta Description)", { exact: true })
    .fill(`${SEO_DESCRIPTION} חניה צמודה.`);
  await card.getByRole("button", { name: "שמירת הכותרת והתיאור" }).click();
  await expect(page.getByText("הכותרת והתיאור לגוגל נשמרו")).toBeVisible({ timeout: 15_000 });
  const [, , rev1] = unitRow().split("|");

  await page
    .getByLabel("תיאור היחידה", { exact: true })
    .fill("צימר זוגי בגליל. ג׳קוזי, נוף וחניה.");
  await page.getByRole("button", { name: "שמירה", exact: true }).click();
  await expect(page.getByText("היחידה נשמרה")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("page-notice")).toHaveCount(0);
  await expect(page.getByText("עודכנה בינתיים")).toHaveCount(0);
  expect(unitRow()).toBe(`${SEO_TITLE}|${SEO_DESCRIPTION} חניה צמודה.|${Number(rev1) + 1}`);
  expect(sql(`SELECT description FROM hospitality.units WHERE id = '${unitId}'`)).toBe(
    "צימר זוגי בגליל. ג׳קוזי, נוף וחניה.",
  );
});

test("too long — a message by the field and nothing saved; empty — back to the site default", async ({
  page,
  request,
}) => {
  await loadSession(page, owner!, `/manage/units/${unitId}`);
  const card = page.locator('[data-section="unit-seo"]');
  const title = card.getByLabel("כותרת לגוגל (Meta Title)", { exact: true });
  const description = card.getByLabel("תיאור לגוגל (Meta Description)", { exact: true });
  const save = card.getByRole("button", { name: "שמירת הכותרת והתיאור" });
  await expect(title).toHaveValue(SEO_TITLE);
  const before = unitRow();

  await title.fill("א".repeat(71));
  await expect(card).toContainText("כותרת לגוגל — עד 70 תווים");
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await save.click();
  await expect(page.getByText("הכותרת והתיאור לגוגל נשמרו")).toHaveCount(0);
  expect(unitRow()).toBe(before);

  // ריק — ברירת המחדל: שם היחידה | שם העסק, ותיאור מתוך תיאור היחידה
  await title.fill("");
  await description.fill("");
  await expect(card).toContainText("ריק — ברירת המחדל של האתר");
  await save.click();
  await expect(page.getByText("הכותרת והתיאור לגוגל נשמרו")).toBeVisible({ timeout: 15_000 });
  expect(unitRow().split("|").slice(0, 2)).toEqual(["∅", "∅"]);
  await expect
    .poll(async () => (await publicHead(request)).title, { timeout: 20_000 })
    .toBe(defaultHead.title);
  expect((await publicHead(request)).description).toBe("צימר זוגי בגליל.");
});

test("the stores are not touched", () => {
  expect(storeDataHash()).toBe(storeHash);
});
