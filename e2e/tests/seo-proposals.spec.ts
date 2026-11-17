import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { encryptApiKey } from "../../src/platform/ai/secrets.server";
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
  type SavedSession,
} from "./hospitality-helpers";

// הצעות SEO באתר אירוח (מיגרציה 20261118200000), מקצה לקצה — על השרת הבנוי, Supabase המקומי ו"דגם" מדומה
// (mock-services: בלי מפתח אמיתי ובלי קריאה החוצה):
//   • עסק בלי NURIEL AI: בפעם הראשונה ב"גוגל ושיתוף" — הצעות בסיסיות בחינם; אין קריאה לדגם, אין יומן שימוש;
//   • אישור הצעה ליחידה — נשמר דרך השדה הקיים; לדף הבית — לטיוטה בלבד (הגרסה המפורסמת לא משתנה);
//     עריכה לפני אישור; ביטול; שדה שהשתנה מאז ההצעה — לא מוחלף;
//   • עסק עם NURIEL AI: הפקת AI ראשונית אחת (אותו דגם ומפתח של הפלטפורמה, יומן "seo-writer"), פעם אחת בלבד;
//     "ניסוח אחר"; העוזר מפנה ל"גוגל ושיתוף"; עסק אחר לא רואה את ההצעות; נגישות, טלפון ו-RTL;
//   • נתוני החנויות לא משתנים.

test.describe.configure({ mode: "serial" });

const FREE = { slug: "seo-free", name: "צימר בלי AI" };
const PAID = { slug: "seo-ai", name: "צימר עם AI" };
const OWNER_FREE = { email: "seo.free.owner@e2e.test", password: "Seo-Free-Pass-1!" };
const OWNER_PAID = { email: "seo.ai.owner@e2e.test", password: "Seo-Ai-Pass-1!" };
const FAKE_KEY = `sk-ant-api03-E2E${"SEOFAKEKEYX".repeat(3)}Sx4_`;
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
] as const;
const url = (slug: string, path = "") => `http://${hostOf(slug)}:${PORT}${path}`;

const ids = { free: "", paid: "", freeUnit: "", freeUnit2: "", paidUnit: "", paidMedia: "" };
const sessions: { free: SavedSession | null; paid: SavedSession | null } = {
  free: null,
  paid: null,
};
let storeHash = "";

const storeDataHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(ur::text, ',' ORDER BY ur.tenant_id, ur.user_id) FROM public.user_roles ur
            JOIN public.tenants t ON t.id = ur.tenant_id WHERE t.site_type = 'ecommerce'),
         (SELECT string_agg(s::text, ',' ORDER BY s::text) FROM public.site_settings s
            JOIN public.tenants t ON t.id = s.tenant_id WHERE t.site_type = 'ecommerce')))`);

function cleanup() {
  for (const s of [FREE, PAID]) {
    const id = sql(`SELECT id FROM public.tenants WHERE slug = '${s.slug}'`);
    if (!id) continue;
    for (const t of [
      "ai_notifications",
      "ai_subscription_events",
      "ai_subscription_periods",
      "ai_subscriptions",
    ])
      sql(`DELETE FROM public.${t} WHERE tenant_id = '${id}'`);
    sql(`DELETE FROM public.ai_usage_log WHERE tenant_id = '${id}'`);
    asPlatform(`SELECT public.platform_delete_tenant('${id}', '${s.slug}')`);
  }
  sql(`UPDATE public.ai_settings SET mode = 'off', model = 'claude-haiku-5-5', api_key_encrypted = NULL, api_key_last4 = NULL,
         last_error = NULL, last_error_at = NULL`);
}

/** אתר אירוח עם מתחם, יחידות, טיוטה וגרסה מפורסמת (הטיוטה זהה לפרסום) */
async function createSite(
  request: APIRequestContext,
  s: { slug: string; name: string },
  owner: typeof OWNER_FREE,
) {
  const ownerId = await ensureUser(request, owner);
  asPlatform(`SELECT hospitality.admin_open_site('${s.slug}', '${s.name}', '${owner.email}')`);
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${s.slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       VALUES ('${id}', '${ownerId}', '${owner.email}', '${s.slug.replace("-", "_")}_owner', 'admin', true, true)
       ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${id}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  sql(`UPDATE hospitality.settings SET address = 'מושב הבדיקה 7' WHERE tenant_id = '${id}'`);
  const propertyId =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type, description)
       VALUES ('${id}', '${s.name}', '${s.slug}-p', 'active', 'zimmer_complex', 'מתחם צימרים כפרי עם נוף פתוח.') RETURNING id`);
  const u1 =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${id}', '${propertyId}', 'unit', 'צימר האלון', '${s.slug}-alon', 2, 2, 900) RETURNING id`);
  const u2 =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${id}', '${propertyId}', 'unit', 'צימר הזית', '${s.slug}-zayit', 5, 2, 1100) RETURNING id`);
  const doc = JSON.stringify({
    v: 1,
    theme: "luxury",
    sections: [{ id: "hero", type: "hero", hidden: false, content: {} }],
  });
  sql(`INSERT INTO hospitality.site_versions (tenant_id, kind, version, theme, document, revision) VALUES
       ('${id}', 'published', 1, 'luxury', '${doc}'::jsonb, 1),
       ('${id}', 'draft', 0, 'luxury', '${doc}'::jsonb, 1)`);
  sql(
    `UPDATE hospitality.site_versions SET based_on = 1 WHERE tenant_id = '${id}' AND kind = 'draft'`,
  );
  return { id, u1, u2, propertyId };
}

async function seoTab(page: Page, session: SavedSession) {
  await loadSession(page, session, "/manage/website?tab=seo");
  const panel = page.getByTestId("seo-proposals");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  return panel;
}
const card = (page: Page, target: string) =>
  page.locator(`[data-testid=seo-proposal][data-target="${target}"]`);

// רץ גם בפרויקט הטלפון (שם רק הבדיקה המסומנת @mobile) — ההכנה חוזרת על עצמה בבטחה (cleanup)
test.beforeAll(async ({ request }) => {
  cleanup();
  storeHash = storeDataHash();
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  const free = await createSite(request, FREE, OWNER_FREE);
  const paid = await createSite(request, PAID, OWNER_PAID);
  ids.free = free.id;
  ids.freeUnit = free.u1;
  ids.freeUnit2 = free.u2;
  ids.paid = paid.id;
  ids.paidUnit = paid.u1;
  ids.paidMedia =
    sql(`INSERT INTO hospitality.media (tenant_id, owner_kind, property_id, unit_id, kind, storage_path, variants,
                         width, height, size_bytes, sort_order)
       VALUES ('${paid.id}', 'unit', '${paid.propertyId}', '${paid.u1}', 'image', '${paid.id}/e2e-alt.webp', '{}'::jsonb,
               1600, 1067, 1000, 0) RETURNING id`);
  // NURIEL AI: הפלטפורמה פעילה עם מפתח (מוצפן, כמו שמסך מנהל העל שומר) — וחבילה רק לעסק PAID
  sql(`UPDATE public.ai_settings SET mode = 'on', model = 'claude-haiku-5-5', api_key_encrypted = '${encryptApiKey(FAKE_KEY)}',
         api_key_last4 = 'Sx4_', monthly_budget_usd = 25`);
  asPlatform(`SELECT public.ai_admin_activate((SELECT user_id FROM public.platform_admins LIMIT 1), '${paid.id}',
                 'hospitality', public.ai_today(), 'E2E — שולם', true)`);
  for (const slug of [FREE.slug, PAID.slug])
    await expect
      .poll(async () => (await hostGet(request, hostOf(slug), "/manage")).status(), {
        timeout: 20_000,
      })
      .toBe(200);
  sessions.free = await passwordSession(request, url(FREE.slug), OWNER_FREE);
  sessions.paid = await passwordSession(request, url(PAID.slug), OWNER_PAID);
});

test.afterAll(() => {
  cleanup();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test("a business without NURIEL AI: basic proposals on the first open — no model call, no usage, no AI run", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const panel = await seoTab(page, sessions.free!);
  await expect(card(page, `unit:${ids.freeUnit}:seo_title`)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByTestId("seo-ai-unavailable")).toContainText("NURIEL AI");
  await expect(panel.getByTestId("seo-generate-ai-text")).toBeDisabled();
  await expect(page.locator("[data-testid=seo-proposal][data-source=ai]")).toHaveCount(0);
  expect(
    sql(
      `SELECT string_agg(kind || ':' || scope || ':' || status, ',') FROM hospitality.seo_runs WHERE tenant_id = '${ids.free}'`,
    ),
  ).toBe("template:initial:done");
  expect(sql(`SELECT count(*) FROM public.ai_usage_log WHERE tenant_id = '${ids.free}'`)).toBe("0");
  // בפעם השנייה — לא מפיקים שוב
  await page.reload();
  await expect(card(page, `unit:${ids.freeUnit}:seo_title`)).toBeVisible({ timeout: 20_000 });
  expect(sql(`SELECT count(*) FROM hospitality.seo_runs WHERE tenant_id = '${ids.free}'`)).toBe(
    "1",
  );
});

test("approve a unit title (saved through the unit), edit before approving, reject; nothing else changes", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await seoTab(page, sessions.free!);
  const proposed = sql(
    `SELECT proposed FROM hospitality.seo_proposals WHERE target_id = '${ids.freeUnit}' AND field = 'seo_title' AND status = 'pending'`,
  );
  expect(proposed).toContain("צימר האלון");
  await card(page, `unit:${ids.freeUnit}:seo_title`).getByTestId("seo-approve").click();
  await expect(page.getByText("ההצעה נשמרה").first()).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT seo_title FROM hospitality.units WHERE id = '${ids.freeUnit}'`)).toBe(
    proposed,
  );
  expect(
    sql(
      `SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '${ids.free}' AND action = 'seo.proposal_approved'`,
    ),
  ).toBe("1");

  const edited = "צימר הזית – לעד חמישה אורחים, מושב הבדיקה";
  const zayit = card(page, `unit:${ids.freeUnit2}:seo_title`);
  await zayit.getByTestId("seo-proposal-text").fill(edited);
  await zayit.getByRole("button", { name: "שמירה עם העריכה" }).click();
  await expect(zayit).toHaveCount(0, { timeout: 15_000 });
  expect(sql(`SELECT seo_title FROM hospitality.units WHERE id = '${ids.freeUnit2}'`)).toBe(edited);

  await card(page, `unit:${ids.freeUnit2}:seo_description`).getByTestId("seo-reject").click();
  await expect(card(page, `unit:${ids.freeUnit2}:seo_description`)).toHaveCount(0, {
    timeout: 15_000,
  });
  expect(
    sql(`SELECT seo_description IS NULL FROM hospitality.units WHERE id = '${ids.freeUnit2}'`),
  ).toBe("t");
});

test("a home-page proposal goes to the DRAFT only — the published site is unchanged until publishing", async ({
  page,
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const published = sql(
    `SELECT md5(document::text) FROM hospitality.site_versions WHERE tenant_id = '${ids.free}' AND kind = 'published'`,
  );
  const before = await (await hostGet(request, hostOf(FREE.slug), "/stay")).text();
  await seoTab(page, sessions.free!);
  const proposed = sql(
    `SELECT proposed FROM hospitality.seo_proposals WHERE tenant_id = '${ids.free}' AND target_kind = 'site' AND field = 'seo_title' AND status = 'pending'`,
  );
  await card(page, "site::seo_title").getByTestId("seo-approve").click();
  await expect(page.getByText("ההצעה נשמרה").first()).toBeVisible({ timeout: 15_000 });
  // העורך נטען מחדש ונשאר בלשונית
  await expect(page).toHaveURL(/tab=seo/);
  await expect(page.getByTestId("seo-proposals")).toBeVisible({ timeout: 20_000 });
  expect(
    sql(
      `SELECT document #>> '{seo,title}' FROM hospitality.site_versions WHERE tenant_id = '${ids.free}' AND kind = 'draft'`,
    ),
  ).toBe(proposed);
  expect(
    sql(
      `SELECT md5(document::text) FROM hospitality.site_versions WHERE tenant_id = '${ids.free}' AND kind = 'published'`,
    ),
  ).toBe(published);
  expect(
    sql(
      `SELECT count(*) FROM hospitality.site_versions WHERE tenant_id = '${ids.free}' AND kind = 'published'`,
    ),
  ).toBe("1");
  const after = await (await hostGet(request, hostOf(FREE.slug), "/stay")).text();
  expect(/<title>([^<]*)<\/title>/.exec(after)?.[1]).toBe(
    /<title>([^<]*)<\/title>/.exec(before)?.[1],
  );
  expect(after).not.toContain(proposed);
});

test("no overwrite: a field changed after the proposal is kept, the proposal is marked as changed", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  // הבעלים כתב תיאור לגוגל ליחידה בדרך הרגילה אחרי שההצעה הוכנה
  sql(
    `UPDATE hospitality.units SET seo_description = 'תיאור שהבעלים כתב', revision = revision + 1 WHERE id = '${ids.freeUnit}'`,
  );
  await seoTab(page, sessions.free!);
  const c = card(page, `unit:${ids.freeUnit}:seo_description`);
  await expect(c).toContainText("השדה השתנה מאז שההצעה הוכנה");
  await expect(c.getByTestId("seo-approve")).toHaveCount(0);
  const token = await accessToken(page.request, OWNER_FREE);
  const pid = sql(
    `SELECT id FROM hospitality.seo_proposals WHERE target_id = '${ids.freeUnit}' AND field = 'seo_description' AND status = 'pending'`,
  );
  // גם קריאה ישירה לא דורסת
  const res = await callServerFn(page.request, {
    host: hostOf(FREE.slug),
    file: "src/engines/hospitality/api/seo-proposals.functions.ts",
    name: "hospitalitySeoDecide",
    data: { ids: [pid], action: "approve" },
    token,
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("stale");
  expect(sql(`SELECT seo_description FROM hospitality.units WHERE id = '${ids.freeUnit}'`)).toBe(
    "תיאור שהבעלים כתב",
  );
});

test("a business with NURIEL AI: one initial AI run with the platform model, logged as seo-writer; never twice", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await seoTab(page, sessions.paid!);
  await expect(page.locator("[data-testid=seo-proposal][data-source=ai]").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(card(page, `unit:${ids.paidUnit}:seo_title`)).toContainText("NURIEL AI");
  await expect(card(page, `media:${ids.paidMedia}:alt`)).toBeVisible();
  expect(
    sql(
      `SELECT string_agg(kind || ':' || status, ',' ORDER BY kind) FROM hospitality.seo_runs WHERE tenant_id = '${ids.paid}' AND scope = 'initial'`,
    ),
  ).toBe("ai:done,template:done");
  // אותו יומן, אותו דגם, עלות נרשמת, בלי טקסט השאלה
  expect(
    sql(
      `SELECT string_agg(DISTINCT model || '|' || array_to_string(guides, ','), ';') FROM public.ai_usage_log WHERE tenant_id = '${ids.paid}'`,
    ),
  ).toBe("claude-haiku-5-5|seo-writer");
  expect(
    sql(
      `SELECT bool_and(cost_usd > 0 AND question IS NULL AND product = 'hospitality') FROM public.ai_usage_log WHERE tenant_id = '${ids.paid}'`,
    ),
  ).toBe("t");
  const calls = sql(`SELECT count(*) FROM public.ai_usage_log WHERE tenant_id = '${ids.paid}'`);
  await page.reload();
  await expect(page.getByTestId("seo-proposals")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);
  expect(
    sql(
      `SELECT count(*) FROM hospitality.seo_runs WHERE tenant_id = '${ids.paid}' AND kind = 'ai' AND scope = 'initial'`,
    ),
  ).toBe("1");
  expect(sql(`SELECT count(*) FROM public.ai_usage_log WHERE tenant_id = '${ids.paid}'`)).toBe(
    calls,
  );
});

test("ask for a different wording: the new AI proposal replaces the pending one", async ({
  page,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await seoTab(page, sessions.paid!);
  const c = card(page, `unit:${ids.paidUnit}:seo_description`);
  await c.getByTestId("seo-reword").click();
  await expect(c.getByTestId("seo-proposal-text")).toHaveValue(/ניסוח אחר:/, { timeout: 20_000 });
  // התבנית → הצעת ה-AI הראשונית → הניסוח החדש: שתי הצעות הוחלפו, ואחת ממתינה
  expect(
    sql(`SELECT count(*) FILTER (WHERE status = 'superseded') || '|' || count(*) FILTER (WHERE status = 'pending')
                FROM hospitality.seo_proposals WHERE target_id = '${ids.paidUnit}' AND field = 'seo_description'`),
  ).toBe("2|1");
});

test("approve several at once, including an image description", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await seoTab(page, sessions.paid!);
  await card(page, `media:${ids.paidMedia}:alt`).getByRole("checkbox").check();
  await card(page, `unit:${ids.paidUnit}:seo_title`).getByRole("checkbox").check();
  await page.getByTestId("seo-approve-selected").click();
  await expect(page.getByText("2 הצעות נשמרו")).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT alt FROM hospitality.media WHERE id = '${ids.paidMedia}'`)).toContain(
    "מרפסת מרוצפת",
  );
  expect(sql(`SELECT seo_title FROM hospitality.units WHERE id = '${ids.paidUnit}'`)).toContain(
    "(AI)",
  );
});

test("the existing assistant points to the SEO screen", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await loadSession(page, sessions.paid!, "/manage");
  await page.getByTestId("ai-open").click();
  const panel = page.getByTestId("ai-panel");
  await panel.getByTestId("ai-question").fill("איך לשפר את הקידום בגוגל?");
  await panel.getByRole("button", { name: "שליחת השאלה" }).click();
  const chip = panel.locator('[data-guide-id="hosp-seo-improve"]').last();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  await expect(panel.getByTestId("ai-guide")).toContainText("גוגל ושיתוף");
});

test("isolation: another business's owner cannot read or decide these proposals", async ({
  request,
}) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  const token = await accessToken(request, OWNER_PAID);
  const list = await callServerFn(request, {
    host: hostOf(FREE.slug),
    file: "src/engines/hospitality/api/seo-proposals.functions.ts",
    name: "hospitalitySeoProposals",
    token,
  });
  expect(await list.text()).not.toContain(ids.freeUnit2);
  const pid = sql(
    `SELECT id FROM hospitality.seo_proposals WHERE tenant_id = '${ids.free}' AND status = 'pending' LIMIT 1`,
  );
  if (pid) {
    const decide = await callServerFn(request, {
      host: hostOf(PAID.slug),
      file: "src/engines/hospitality/api/seo-proposals.functions.ts",
      name: "hospitalitySeoDecide",
      data: { ids: [pid], action: "reject" },
      token,
    });
    expect(await decide.text()).toContain("error");
    expect(sql(`SELECT status FROM hospitality.seo_proposals WHERE id = '${pid}'`)).toBe("pending");
  }
});

test("accessibility of the SEO tab, and the stores are unchanged", async ({ page }) => {
  test.skip(test.info().project.name === "mobile", "desktop flow");
  await seoTab(page, sessions.paid!);
  await page.getByText("מה חסר לי בגוגל?").click();
  await expectAccessible(page, "website editor — SEO proposals");
  expect(storeDataHash()).toBe(storeHash);
});

test("@mobile the SEO proposals on a phone: right-to-left, no sideways scrolling", async ({
  page,
}) => {
  await seoTab(page, sessions.paid!);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
