import { expect, test } from "@playwright/test";
import { A, AUTH, hostGet, hostOf, platformUrl, PORT, PRODUCTS, STORE_A, USERS } from "./helpers";
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

// NURIEL AI SEO ENGINE (migrations 20261122100000 + 20261122110000), end to end on the built server and the local
// Supabase. The background worker is off in E2E (SEO_WORKER=off in app-up.sh — its logic has unit + SQL tests);
// here is what an owner and the platform admin do:
//   • store owner (Ecommerce), "SEO וגוגל" tab: an honest center (a technical checklist, not a ranking promise), the
//     auto switches OFF; a phrase of their own is stored WITHOUT numbers; basic proposals → approve a product title
//     (saved), restore it from the history (the old value is back), "later" keeps a proposal open; another store's
//     owner gets nothing from this store's center; the store's SEO fields end exactly as they started;
//   • zimmer owner (Hospitality), /manage/seo: the same center with the proposals list — later / approve / restore;
//   • platform admin, /platform/seo: numbers per business only (no business texts); "check" queues ONE job;
//   • accessibility (axe) of both screens; on a phone: right-to-left, no sideways scrolling.

test.describe.configure({ mode: "serial" });

const H = { slug: "seo-engine-h", name: "צימר מנוע החיפוש" };
const H_OWNER = { email: "seo.engine.owner@e2e.test", password: "Seo-Engine-Pass-1!" };
const FLAGS = [
  "hospitality_backend_enabled",
  "hospitality_management_enabled",
  "hospitality_frontend_enabled",
] as const;
const OWN_PHRASE = "יין אדום לשבת";
const CENTER_FN = "src/platform/seo/center.functions.ts";
const hUrl = (path = "") => `http://${hostOf(H.slug)}:${PORT}${path}`;

const ids = { h: "", u1: "", u2: "" };
let hSession: SavedSession | null = null;
let storeHash = "";

const desktopOnly = () => test.skip(test.info().project.name === "mobile", "desktop flow");

/** the store's Google fields — they must end exactly as they started (approve → restore) */
const storeSeoHash = () =>
  sql(`SELECT md5(concat_ws('|',
         (SELECT string_agg(concat_ws(':', id, seo_title, seo_description, seo_keywords), ',' ORDER BY id)
            FROM public.global_products WHERE tenant_id = '${STORE_A.id}'),
         (SELECT string_agg(concat_ws(':', id, seo_title, seo_description), ',' ORDER BY id)
            FROM public.categories WHERE tenant_id = '${STORE_A.id}'),
         (SELECT concat_ws(':', seo_title, seo_description, seo_keywords) FROM public.site_settings
           WHERE tenant_id = '${STORE_A.id}' LIMIT 1)))`);

function cleanStoreSeo() {
  for (const t of ["store_seo_proposals", "seo_keyword_ideas", "seo_jobs", "seo_audits"])
    sql(`DELETE FROM public.${t} WHERE tenant_id = '${STORE_A.id}'`);
}

function cleanupZimmer() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${H.slug}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${H.slug}')`);
}

/** a zimmer site with a property, two units, and a draft + published site (the draft equals the published one) */
async function createZimmer(request: Parameters<typeof ensureUser>[0]) {
  const ownerId = await ensureUser(request, H_OWNER);
  asPlatform(`SELECT hospitality.admin_open_site('${H.slug}', '${H.name}', '${H_OWNER.email}')`);
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${H.slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected)
       VALUES ('${id}', '${ownerId}', '${H_OWNER.email}', 'seo_engine_owner', 'admin', true, true)
       ON CONFLICT DO NOTHING`);
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${id}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  sql(`UPDATE hospitality.settings SET address = 'מושב הבדיקה 9' WHERE tenant_id = '${id}'`);
  const propertyId =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type, description)
       VALUES ('${id}', '${H.name}', '${H.slug}-p', 'active', 'zimmer_complex', 'מתחם צימרים כפרי עם נוף פתוח.')
       RETURNING id`);
  const u1 =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${id}', '${propertyId}', 'unit', 'צימר הרימון', '${H.slug}-rimon', 2, 2, 900) RETURNING id`);
  const u2 =
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
       VALUES ('${id}', '${propertyId}', 'unit', 'צימר התאנה', '${H.slug}-teena', 4, 2, 1000) RETURNING id`);
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
  return { id, u1, u2 };
}

// runs in the phone project too (only the @mobile test there) — the setup cleans up first, so it repeats safely
test.beforeAll(async ({ request }) => {
  cleanupZimmer();
  cleanStoreSeo();
  storeHash = storeSeoHash();
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  const z = await createZimmer(request);
  ids.h = z.id;
  ids.u1 = z.u1;
  ids.u2 = z.u2;
  await expect
    .poll(async () => (await hostGet(request, hostOf(H.slug), "/manage")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  hSession = await passwordSession(request, hUrl(), H_OWNER);
});

test.afterAll(() => {
  cleanupZimmer();
  cleanStoreSeo();
  sql(`UPDATE public.platform_feature_flags SET enabled = false WHERE key LIKE 'hospitality%'`);
});

test.describe("store owner (Ecommerce) — the SEO tab", () => {
  test.use({ storageState: AUTH.ownerA });

  test("the SEO center: a technical check (no ranking promise), auto filling OFF, an own phrase stored WITHOUT numbers", async ({
    page,
  }) => {
    desktopOnly();
    await page.goto(A("/admin?tab=seo"));
    await expect(page.getByTestId("seo-center")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("seo-audit")).toContainText("לא תחזית למיקום בגוגל");
    const settings = page.getByTestId("seo-settings");
    await expect(settings).toContainText("שום דבר לא משתנה באתר בלי האישור שלכם");
    const autos = settings.getByRole("switch", { name: /אוטומטית/ });
    expect(await autos.count()).toBeGreaterThan(0);
    for (const sw of await autos.all()) await expect(sw).not.toBeChecked();

    const add = page.getByTestId("seo-keyword-add");
    await add.getByRole("textbox").fill(OWN_PHRASE);
    await add.getByRole("button", { name: "הוספה" }).click();
    await expect(page.getByText("הביטוי נוסף לביטויים שבחרתם")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("seo-keywords")).toContainText(OWN_PHRASE);
    expect(
      sql(`SELECT source || ':' || status || ':' || (metrics IS NULL) FROM public.seo_keyword_ideas
            WHERE tenant_id = '${STORE_A.id}' AND phrase = '${OWN_PHRASE}'`),
    ).toBe("owner:adopted:true");
  });

  test('basic proposals: approve a product title (saved), restore it (the old value is back), "later" keeps one open', async ({
    page,
  }) => {
    desktopOnly();
    await page.goto(A("/admin?tab=seo"));
    const list = page.getByTestId("store-seo-proposals");
    await expect(list).toBeVisible({ timeout: 20_000 });
    await list.getByTestId("store-seo-template").click();
    await expect(page.getByText(/נוספו \d+ הצעות/)).toBeVisible({ timeout: 20_000 });

    const t1 = page.locator(
      `[data-testid=store-seo-proposal][data-target="product:${PRODUCTS.a1.id}:seo_title"]`,
    );
    await expect(t1).toBeVisible({ timeout: 15_000 });
    const productTitle = () =>
      sql(
        `SELECT coalesce(seo_title, '(none)') FROM public.global_products WHERE id = '${PRODUCTS.a1.id}'`,
      );
    const before = productTitle();
    const proposed = sql(`SELECT proposed FROM public.store_seo_proposals
       WHERE tenant_id = '${STORE_A.id}' AND target_id = '${PRODUCTS.a1.id}' AND field = 'seo_title' AND status = 'pending'`);
    expect(proposed).toContain(PRODUCTS.a1.name);
    // the Google preview shows the proposal — and nothing is saved before the owner approves
    await expect(t1.getByTestId("google-snippet")).toContainText(proposed.slice(0, 30));
    expect(productTitle()).toBe(before);

    await t1.getByTestId("store-seo-approve").click();
    await expect(page.getByText("נשמר — יופיע בגוגל בסריקה הבאה של האתר")).toBeVisible({
      timeout: 15_000,
    });
    expect(productTitle()).toBe(proposed);

    // restore from the history — the value from before the approval is back
    await page.locator("summary", { hasText: "היסטוריה" }).click();
    await page
      .locator(
        `[data-testid=store-seo-history-item][data-target="product:${PRODUCTS.a1.id}:seo_title"][data-status=approved]`,
      )
      .getByTestId("store-seo-revert")
      .click();
    await expect(page.getByText("שוחזר לערך שהיה לפני האישור")).toBeVisible({ timeout: 15_000 });
    expect(productTitle()).toBe(before);

    // "later": the proposal stays in the list, marked
    const t2 = page.locator(
      `[data-testid=store-seo-proposal][data-target="product:${PRODUCTS.a2.id}:seo_title"]`,
    );
    await t2.getByTestId("store-seo-later").click();
    await expect(t2).toContainText("נשמר לאחר כך", { timeout: 15_000 });
    expect(
      sql(`SELECT string_agg(status, ',') FROM public.store_seo_proposals
            WHERE tenant_id = '${STORE_A.id}' AND target_id = '${PRODUCTS.a2.id}' AND field = 'seo_title'
              AND status IN ('pending', 'later')`),
    ).toBe("later");
  });

  test("isolation: another store's owner gets nothing from this store's SEO center; the store's fields are unchanged", async ({
    request,
  }) => {
    desktopOnly();
    const token = await accessToken(request, USERS.ownerB);
    const res = await callServerFn(request, {
      host: hostOf(STORE_A.slug),
      file: CENTER_FN,
      name: "getSeoCenter",
      token,
    });
    const text = await res.text();
    expect(text).not.toContain(OWN_PHRASE);
    expect(text).not.toContain("business_name");
    expect(storeSeoHash()).toBe(storeHash);
  });
});

test("zimmer owner: /manage/seo — the SEO center with the proposals; later keeps one open, approve saves, restore brings the old value back", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, hSession!, "/manage/seo");
  await expect(page.getByTestId("seo-center")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("seo-proposals")).toBeVisible({ timeout: 20_000 });
  const card = (target: string) =>
    page.locator(`[data-testid=seo-proposal][data-target="${target}"]`);
  await expect(card(`unit:${ids.u1}:seo_title`)).toBeVisible({ timeout: 20_000 });

  await card(`unit:${ids.u1}:seo_title`).getByTestId("seo-later").click();
  await expect(card(`unit:${ids.u1}:seo_title`)).toContainText("נשמר לאחר כך", {
    timeout: 15_000,
  });
  expect(
    sql(`SELECT string_agg(status, ',') FROM hospitality.seo_proposals
          WHERE target_id = '${ids.u1}' AND field = 'seo_title' AND status IN ('pending', 'later')`),
  ).toBe("later");
  expect(sql(`SELECT seo_title IS NULL FROM hospitality.units WHERE id = '${ids.u1}'`)).toBe("t");

  const proposed = sql(`SELECT proposed FROM hospitality.seo_proposals
     WHERE target_id = '${ids.u2}' AND field = 'seo_title' AND status = 'pending'`);
  expect(proposed).toContain("צימר התאנה");
  await card(`unit:${ids.u2}:seo_title`).getByTestId("seo-approve").click();
  await expect(page.getByText("ההצעה נשמרה").first()).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT seo_title FROM hospitality.units WHERE id = '${ids.u2}'`)).toBe(proposed);

  await page.locator("summary", { hasText: "החלטות אחרונות" }).click();
  await page
    .locator(
      `[data-testid=seo-history-item][data-target="unit:${ids.u2}:seo_title"][data-status=approved]`,
    )
    .getByTestId("seo-revert")
    .click();
  await expect(page.getByText("שוחזר לערך שהיה לפני האישור")).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT seo_title IS NULL FROM hospitality.units WHERE id = '${ids.u2}'`)).toBe("t");
  expect(
    sql(
      `SELECT count(*) FROM hospitality.audit_log WHERE tenant_id = '${ids.h}' AND action = 'seo.proposal_reverted'`,
    ),
  ).toBe("1");
});

test('platform admin: /platform/seo — numbers per business only, "check" queues ONE job', async ({
  browser,
}) => {
  desktopOnly();
  const ctx = await browser.newContext({ storageState: AUTH.platform });
  const page = await ctx.newPage();
  await page.goto(platformUrl("/platform/seo"));
  await expect(page.getByTestId("seo-platform")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("חיפוש עסק").fill(H.slug);
  const row = page.getByTestId("seo-platform-row").filter({ hasText: H.slug });
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await row.getByRole("button", { name: "בדיקה", exact: true }).click();
  await expect(page.getByText("נכנס לתור — ירוץ בדקות הקרובות")).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button", { name: "בדיקה", exact: true }).click();
  await expect(page.getByText("כבר היה בתור — ירוץ עכשיו")).toBeVisible({ timeout: 15_000 });
  expect(
    sql(
      `SELECT count(*) FROM public.seo_jobs WHERE tenant_id = '${ids.h}' AND kind = 'audit' AND status = 'queued'`,
    ),
  ).toBe("1");
  // the platform screen shows numbers, never a business's texts
  const text = sql(`SELECT proposed FROM hospitality.seo_proposals
     WHERE tenant_id = '${ids.h}' AND status IN ('pending', 'later') ORDER BY created_at LIMIT 1`);
  expect(text).not.toBe("");
  await expect(page.getByText(text)).toHaveCount(0);
  await ctx.close();
});

test("accessibility of both SEO screens (axe)", async ({ page, browser }) => {
  desktopOnly();
  await loadSession(page, hSession!, "/manage/seo");
  await expect(page.getByTestId("seo-center")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("seo-proposals")).toBeVisible({ timeout: 20_000 });
  await expectAccessible(page, "hospitality — SEO וגוגל");
  const ctx = await browser.newContext({ storageState: AUTH.ownerA });
  const store = await ctx.newPage();
  await store.goto(A("/admin?tab=seo"));
  await expect(store.getByTestId("seo-center")).toBeVisible({ timeout: 20_000 });
  await expect(store.getByTestId("store-seo-proposals")).toBeVisible({ timeout: 20_000 });
  await expectAccessible(store, "store admin — SEO וגוגל");
  await ctx.close();
});

test("@mobile /manage/seo on a phone: right-to-left, no sideways scrolling", async ({ page }) => {
  await loadSession(page, hSession!, "/manage/seo");
  await expect(page.getByTestId("seo-center")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
