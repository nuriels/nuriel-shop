import { expect, test } from "@playwright/test";
import { A, PRODUCTS, stableShot } from "./helpers";

test.describe("storefront (Ecommerce baseline)", () => {
  test("home page shows the catalog @mobile", async ({ page }) => {
    await page.goto(A());
    await expect(page.getByText(PRODUCTS.a1.name).first()).toBeVisible();
    await expect(page.getByText(PRODUCTS.a2.name).first()).toBeVisible();
    await expect(page.getByText("התחברות", { exact: true }).first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("home.png", { ...stableShot, fullPage: true });
  });

  test("product page shows details, price and add-to-cart @mobile", async ({ page }) => {
    await page.goto(A(`/product/${PRODUCTS.a1.id}`));
    await expect(page.getByRole("heading", { name: PRODUCTS.a1.name })).toBeVisible();
    await expect(page.getByText("50.00").first()).toBeVisible();
    await expect(page.getByText(PRODUCTS.a1.sku)).toBeVisible();
    await expect(page.getByRole("button", { name: "הוספה לסל" }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("product.png", { ...stableShot, fullPage: true });
  });

  test("unknown product does not crash the store", async ({ page }) => {
    const res = await page.goto(A("/product/00000000-0000-0000-0000-00000000dead"));
    expect(res?.status()).toBeLessThan(500);
  });
});
