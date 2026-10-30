import { expect, test } from "@playwright/test";
import { AUTH, hostGet, hostOf, platformUrl, STORE_A, STORE_B } from "./helpers";

test.describe("platform (super admin) dashboard", () => {
  test("platform admin sees all stores and the create-store form", async ({ browser }) => {
    const page = await (await browser.newContext({ storageState: AUTH.platform })).newPage();
    await page.goto(platformUrl("/platform"));
    await expect(page.getByText("ניהול הפלטפורמה").first()).toBeVisible();
    await expect(page.getByText("הקמת חנות חדשה")).toBeVisible();
    await expect(page.getByText(`${STORE_B.slug}.shop.localhost`).first()).toBeVisible();
    for (const item of ["חנויות", "תמיכה", "חבילות ומחירים", "בקשות שדרוג ותוספים"]) {
      await expect(page.getByText(item, { exact: true }).first()).toBeVisible();
    }
  });

  test("guests are asked to log in", async ({ page }) => {
    await page.goto(platformUrl("/platform"));
    await expect(page.getByText("יש להתחבר כמנהל הפלטפורמה")).toBeVisible();
  });

  test("a store owner is not a platform admin", async ({ browser }) => {
    const page = await (
      await browser.newContext({ storageState: AUTH.ownerAOnPlatform })
    ).newPage();
    await page.goto(platformUrl("/platform"));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("הקמת חנות חדשה")).toHaveCount(0);
  });

  test("/platform is not served on a store domain", async ({ request }) => {
    const res = await hostGet(request, hostOf(STORE_A.slug), "/platform");
    expect(res.status()).toBe(403);
  });
});
