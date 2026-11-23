import { expect, test } from "@playwright/test";
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

// "צימר 6 נפתח בטעות": the owner deletes a unit from the units list itself (the card), after an "are you sure?"
// window that says what goes with it (migration 205: unit_delete_preview). A unit that cannot be deleted is
// explained, with what CAN be done (deactivate instead / the package / "the whole property"). The quick-edit window
// leads to the full unit page. A manager sees no delete at all (owner only — also refused by the database).

test.describe.configure({ mode: "serial" });

const SITE = { slug: "unit-delete-h", name: "צימרי המחיקה" };
const OWNER = { email: "unit.delete.owner@e2e.test", password: "Unit-Delete-Owner-1!" };
const MANAGER = { email: "unit.delete.manager@e2e.test", password: "Unit-Delete-Manager-1!" };
const FLAGS = ["hospitality_backend_enabled", "hospitality_management_enabled"] as const;
const siteUrl = (path = "") => `http://${hostOf(SITE.slug)}:${PORT}${path}`;

const ids = { site: "", mistake: "", blocked: "", packaged: "", addon: "", other: "" };
let ownerSession: SavedSession | null = null;
let managerSession: SavedSession | null = null;

const desktopOnly = () => test.skip(test.info().project.name === "mobile", "desktop flow");
const card = (page: import("@playwright/test").Page, name: string) =>
  page.locator(`li[data-unit="${name}"]`);
const dialog = (page: import("@playwright/test").Page) => page.getByTestId("unit-delete-dialog");

function cleanup() {
  const id = sql(`SELECT id FROM public.tenants WHERE slug = '${SITE.slug}'`);
  if (id) asPlatform(`SELECT public.platform_delete_tenant('${id}', '${SITE.slug}')`);
}

test.beforeAll(async ({ request }) => {
  cleanup();
  const ownerId = await ensureUser(request, OWNER);
  const managerId = await ensureUser(request, MANAGER);
  asPlatform(
    `SELECT hospitality.admin_open_site('${SITE.slug}', '${SITE.name}', '${OWNER.email}')`,
  );
  ids.site = sql(`SELECT id FROM public.tenants WHERE slug = '${SITE.slug}'`);
  sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, is_protected) VALUES
       ('${ids.site}', '${ownerId}', '${OWNER.email}', 'unit_delete_owner', 'admin', true, true),
       ('${ids.site}', '${managerId}', '${MANAGER.email}', 'unit_delete_manager', 'admin', true, false)
       ON CONFLICT DO NOTHING`);
  sql(
    `UPDATE public.platform_feature_flags SET enabled = true WHERE key IN (${FLAGS.map((f) => `'${f}'`).join(", ")})`,
  );
  sql(`INSERT INTO public.tenant_feature_flags (tenant_id, key, enabled) VALUES
       ${FLAGS.map((f) => `('${ids.site}', '${f}', true)`).join(", ")}
       ON CONFLICT (tenant_id, key) DO UPDATE SET enabled = true`);
  const property =
    sql(`INSERT INTO hospitality.properties (tenant_id, name, slug, status, property_type)
       VALUES ('${ids.site}', '${SITE.name}', '${SITE.slug}-p', 'active', 'zimmer_complex') RETURNING id`);
  const unit = (name: string, slug: string) =>
    sql(`INSERT INTO hospitality.units (tenant_id, property_id, kind, name, slug, capacity, base_occupancy, base_price)
         VALUES ('${ids.site}', '${property}', 'unit', '${name}', '${SITE.slug}-${slug}', 2, 2, 700) RETURNING id`);
  ids.mistake = unit("צימר 6", "six");
  ids.blocked = unit("צימר עם חסימה", "blocked");
  ids.packaged = unit("סוויטת החבילה", "packaged");
  ids.addon = unit("חדר נוסף", "addon");
  ids.other = unit("צימר אחר", "other");
  // a block in the past: history — never deleted, deactivate instead
  sql(`INSERT INTO hospitality.blocks (tenant_id, unit_id, start_date, end_date, reason)
       VALUES ('${ids.site}', '${ids.blocked}', current_date - 20, current_date - 18, 'שיפוץ')`);
  // a package on "סוויטת החבילה" with "צימר 6" as an add-on room
  sql(`INSERT INTO hospitality.packages (tenant_id, unit_id, kind, name, slug, nights, price, max_guests,
         addon_unit_ids, addon_nightly_price, addon_max)
       VALUES ('${ids.site}', '${ids.packaged}', 'special', 'חבילת כלה', '${SITE.slug}-bride', 2, 3000, 2,
               ARRAY['${ids.mistake}']::uuid[], 500, 1)`);
  await expect
    .poll(async () => (await hostGet(request, hostOf(SITE.slug), "/manage")).status(), {
      timeout: 20_000,
    })
    .toBe(200);
  ownerSession = await passwordSession(request, siteUrl(), OWNER);
  managerSession = await passwordSession(request, siteUrl(), MANAGER);
});

test.afterAll(() => {
  cleanup();
});

test("the owner deletes a unit opened by mistake from its card: the window says what goes with it, then it is gone", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, ownerSession!, "/manage/units");
  await expect(card(page, "צימר 6")).toBeVisible({ timeout: 20_000 });
  await card(page, "צימר 6").getByTestId("unit-card-delete").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page)).toContainText('למחוק את "צימר 6" לצמיתות?');
  await expect(dialog(page)).toContainText("אי אפשר לבטל את זה");
  // the package keeps going — the unit only leaves its add-on rooms
  await expect(dialog(page)).toContainText("החדרים הנוספים של: חבילת כלה");
  await expectAccessible(page, "units — delete window");

  // cancel: nothing happens
  await dialog(page).getByRole("button", { name: "ביטול" }).click();
  await expect(dialog(page)).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE id = '${ids.mistake}'`)).toBe("1");

  await card(page, "צימר 6").getByTestId("unit-card-delete").click();
  await dialog(page).getByRole("button", { name: "מחיקה לצמיתות" }).click();
  await expect(page.getByText('היחידה "צימר 6" נמחקה')).toBeVisible({ timeout: 15_000 });
  await expect(card(page, "צימר 6")).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE id = '${ids.mistake}'`)).toBe("0");
  // the package is still there, without the deleted room
  expect(
    sql(`SELECT cardinality(addon_unit_ids) || ':' || addon_max || ':' || (addon_nightly_price IS NULL)
           FROM hospitality.packages WHERE tenant_id = '${ids.site}'`),
  ).toBe("0:0:true");
});

test("a unit with history cannot be deleted: the window explains and offers to deactivate it instead", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, ownerSession!, "/manage/units");
  await card(page, "צימר עם חסימה").getByTestId("unit-card-delete").click();
  await expect(dialog(page)).toContainText('אי אפשר למחוק את "צימר עם חסימה"');
  await expect(dialog(page)).toContainText("ליחידה יש הזמנות או חסימות");
  await expect(dialog(page).getByRole("button", { name: "מחיקה לצמיתות" })).toHaveCount(0);
  await dialog(page).getByRole("button", { name: "להשבית במקום" }).click();
  await expect(page.getByText("הושבתה — היא לא מוצגת באתר")).toBeVisible({ timeout: 15_000 });
  expect(sql(`SELECT is_active FROM hospitality.units WHERE id = '${ids.blocked}'`)).toBe("f");
  expect(sql(`SELECT count(*) FROM hospitality.units WHERE id = '${ids.blocked}'`)).toBe("1");
});

test("the unit of a package cannot be deleted — the window names the package and leads to it (the package is safe)", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, ownerSession!, "/manage/units");
  await card(page, "סוויטת החבילה").getByTestId("unit-card-delete").click();
  await expect(dialog(page)).toContainText('החבילה "חבילת כלה" שייכת ליחידה הזו');
  await expect(dialog(page).getByRole("link", { name: "לחבילות" })).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "מחיקה לצמיתות" })).toHaveCount(0);
  expect(sql(`SELECT count(*) FROM hospitality.packages WHERE tenant_id = '${ids.site}'`)).toBe(
    "1",
  );
});

test("the quick-edit window leads to the full unit page (price, photos and delete live there)", async ({
  page,
}) => {
  desktopOnly();
  await loadSession(page, ownerSession!, "/manage/units");
  await card(page, "צימר אחר").getByRole("button", { name: /עריכה/ }).click();
  const link = page.getByRole("link", { name: "בעמוד היחידה המלא" });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/manage/units/${ids.other}$`));
  await expect(page.getByRole("heading", { level: 2, name: "מחיקת היחידה" })).toBeVisible();
});

test("a manager: no delete on the cards (owner only)", async ({ page }) => {
  desktopOnly();
  await loadSession(page, managerSession!, "/manage/units");
  await expect(card(page, "צימר אחר")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("unit-card-delete")).toHaveCount(0);
});
