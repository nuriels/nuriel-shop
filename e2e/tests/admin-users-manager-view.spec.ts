import { expect, test } from "@playwright/test";
import { login, STORE_B, storeUrl, USERS } from "./helpers";
import { ensureUser, sql } from "./hospitality-helpers";

// לשונית "משתמשים" בניהול החנות (AdminUsersPanel): מנהל שאינו הבעלים לא רואה בשורה של מנהל אחר את
// הפעולות שרק הבעלים רשאי לעשות — שינוי תפקיד, חסימה / שחרור, מחיקה — ולא את האפשרות "מנהל" בשינוי
// תפקיד של עובד או לקוח. המסד אוכף בכל מקרה (מיגרציה 20261112100000 ושל חלק 33); כאן — שהממשק לא מציע
// כפתורים שתמיד נדחים. הבעלים ממשיך לראות את כולם.

test.describe.configure({ mode: "serial" });

const MANAGER = { email: "users-tab.manager@e2e.test", password: "Users-Tab-Manager-1!" };
const OTHER = { email: "users-tab.other@e2e.test", password: "Users-Tab-Other-1!" };
const CUSTOMER = { email: "users-tab.customer@e2e.test", password: "Users-Tab-Customer-1!" };
const STAMP = Date.now();

function cleanup() {
  sql(`DELETE FROM public.user_roles WHERE tenant_id = '${STORE_B.id}'
         AND user_id IN (SELECT id FROM auth.users WHERE email IN
           ('${MANAGER.email}', '${OTHER.email}', '${CUSTOMER.email}'))`);
}

test.beforeAll(async ({ request }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "desktop flow");
  cleanup();
  for (const u of [MANAGER, OTHER, CUSTOMER]) await ensureUser(request, u);
  const add = (email: string, role: string, name: string, n: number) =>
    sql(`INSERT INTO public.user_roles (tenant_id, user_id, email, username, role, is_approved, display_name)
         SELECT '${STORE_B.id}', id, email, 'ut_${n}_${STAMP}', '${role}', true, '${name}'
           FROM auth.users WHERE email = '${email}'`);
  add(MANAGER.email, "admin", "מנהלת בודקת", 1);
  add(OTHER.email, "admin", "מנהל נוסף", 2);
  add(CUSTOMER.email, "customer", "לקוח בדיקה", 3);
});

test.afterAll(() => {
  if (test.info().project.name !== "mobile") cleanup();
});

type Page = import("@playwright/test").Page;
const row = (page: Page, email: string) => page.locator(`[data-staff-row="${email}"]`);
const customerRow = (page: Page, email: string) => page.locator(`[data-customer-row="${email}"]`);
/** the users tab opens on "awaiting approval" — a group from the side list */
const openGroup = (page: Page, name: RegExp) => page.getByRole("button", { name }).first().click();
const roleLabels = (page: Page) =>
  page.getByRole("alertdialog").locator("button span.font-semibold");

test("a manager (not the owner): no role change, block or delete on another manager's row; 'מנהל' not offered for a customer", async ({
  page,
}) => {
  await login(page, storeUrl(STORE_B.slug), MANAGER);
  await page.goto(storeUrl(STORE_B.slug, "/admin?tab=users"));
  await openGroup(page, /^מנהלים/);
  const other = row(page, OTHER.email);
  await expect(other).toBeVisible({ timeout: 20_000 });
  await expect(other.getByRole("button", { name: "חסימה" })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "מחיקה" })).toHaveCount(0);
  await expect(other.getByRole("button", { name: /שינוי תפקיד/ })).toHaveCount(0);
  // a customer: the manager still manages customers, but "מנהל" is not offered
  await openGroup(page, /^לקוחות\s*\d/);
  const customer = customerRow(page, CUSTOMER.email);
  await expect(customer.getByRole("button", { name: "חסימה" })).toBeVisible({ timeout: 20_000 });
  await customer.getByRole("button", { name: /שינוי תפקיד/ }).click();
  await expect(roleLabels(page).filter({ hasText: /^סוכן$/ })).toHaveCount(1);
  await expect(roleLabels(page).filter({ hasText: /^מנהל$/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
});

test("the owner still sees every action on a manager's row, and 'מנהל' in the role change", async ({
  page,
}) => {
  await login(page, storeUrl(STORE_B.slug), USERS.ownerB);
  await page.goto(storeUrl(STORE_B.slug, "/admin?tab=users"));
  await openGroup(page, /^מנהלים/);
  const other = row(page, OTHER.email);
  await expect(other).toBeVisible({ timeout: 20_000 });
  await expect(other.getByRole("button", { name: "חסימה" })).toBeVisible();
  await expect(other.getByRole("button", { name: "מחיקה" })).toBeVisible();
  await expect(other.getByRole("button", { name: /שינוי תפקיד/ })).toBeVisible();
  await openGroup(page, /^לקוחות\s*\d/);
  await customerRow(page, CUSTOMER.email)
    .getByRole("button", { name: /שינוי תפקיד/ })
    .click();
  await expect(roleLabels(page).filter({ hasText: /^מנהל$/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
});
