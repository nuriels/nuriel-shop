import { expect, test } from "@playwright/test";
import { A, AUTH, PRODUCTS, stableShot } from "./helpers";

test.describe("store admin dashboard", () => {
  test.use({ storageState: AUTH.ownerA });
  test("owner opens the dashboard with all Ecommerce sections", async ({ page }) => {
    await page.goto(A("/admin?tab=dashboard"));
    for (const section of [
      "לוח בקרה",
      "הזמנות",
      "מוצרים וקטגוריות",
      "קופונים",
      "משלוחים",
      "הגדרות אתר",
      "המנוי שלי",
    ]) {
      await expect(page.getByText(section, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText(/hospitality|צימר|אירוח/i)).toHaveCount(0);
  });

  test("owner sees the store products", async ({ page }) => {
    await page.goto(A("/admin?tab=products"));
    await expect(page.getByText(PRODUCTS.a1.name).first()).toBeVisible();
    await expect(page.getByText(PRODUCTS.b1.name)).toHaveCount(0);
  });

  test("admin navigation baseline", async ({ page }) => {
    await page.goto(A("/admin?tab=dashboard"));
    await page.waitForLoadState("networkidle");
    const nav = page.getByRole("navigation").filter({ hasText: "מוצרים וקטגוריות" }).first();
    await expect(nav).toHaveScreenshot("admin-nav.png", stableShot);
  });

  test("a customer cannot use the admin panel", async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH.customerA });
    const page = await context.newPage();
    await page.goto(A("/admin?tab=dashboard"));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("מוצרים וקטגוריות")).toHaveCount(0);
    await context.close();
  });
});
