import { expect, test } from "@playwright/test";
import { A, AUTH, PRODUCTS } from "./helpers";

// תשלום: אמצעי ברירת המחדל (offline) — אין סליקה אמיתית. Grow מופנה לשרת מדומה.
test.describe("cart and checkout", () => {
  test("customer adds a product and reaches checkout with the right total", async ({ browser }) => {
    const context = await browser.newContext({ storageState: AUTH.customerA });
    const page = await context.newPage();
    await page.goto(A(`/product/${PRODUCTS.a2.id}`));
    await page.getByRole("button", { name: "הוספה לסל" }).first().click();
    await page.goto(A("/checkout"));
    await expect(page.getByText(PRODUCTS.a2.name).first()).toBeVisible();
    await expect(page.getByText("20.00").first()).toBeVisible();
    await expect(page.getByText("הסל ריק")).toHaveCount(0);
    await context.close();
  });

  test("empty cart shows the empty state", async ({ page }) => {
    await page.goto(A("/checkout"));
    await expect(page.getByText(/הסל ריק|התחברות/).first()).toBeVisible();
  });
});
