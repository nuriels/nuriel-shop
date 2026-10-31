import { expect, test } from "@playwright/test";
import { A, AUTH, USERS } from "./helpers";

test.describe("authentication", () => {
  test("login page renders both login modes", async ({ page }) => {
    await page.goto(A("/login"));
    await expect(page.getByRole("tab", { name: "סיסמה" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "קוד למייל" })).toBeVisible();
  });

  // ההתחברות עצמה (מסך הסיסמה) נבדקת ב-auth.setup.ts; כאן — שהחיבור נשמר
  test.describe("logged in customer", () => {
    test.use({ storageState: AUTH.customerA });
    test("keeps the session and sees the account menu", async ({ page }) => {
      await page.goto(A());
      await expect(page.getByText(USERS.customerA.email).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "התחברות" })).toHaveCount(0);
    });
  });

  test("a wrong password is rejected", async ({ page }) => {
    await page.goto(A("/login"));
    await page.getByLabel("אימייל או שם משתמש").fill(USERS.customerA.email);
    await page.locator("#password").fill("wrong-password-123");
    await page.getByRole("button", { name: "התחבר", exact: true }).click();
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/\/login/);
  });

  test("guests cannot open the admin panel", async ({ page }) => {
    await page.goto(A("/admin"));
    await expect(page.getByText("לוח בקרה")).toHaveCount(0);
  });
});
