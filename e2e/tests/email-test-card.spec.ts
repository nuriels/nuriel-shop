import { expect, test } from "@playwright/test";
import { A, AUTH } from "./helpers";

// «התראות מייל» → «בדיקת שליחת מייל»: המסך שממנו מקבלים את השגיאה המדויקת של Resend.
// מול השירות המדומה: נמען רגיל → הצלחה (אל מי, מאת מי); נמען עם "+reject" → 422 מהספק, והמסך מציג
// את ההסבר בעברית ואת השגיאה הגולמית של Resend כמו שהיא (זה מה שמעתיקים לדוח).
test.describe("email test card", () => {
  test.skip(({ isMobile }) => isMobile, "desktop flow");
  test.use({ storageState: AUTH.ownerA });

  test("success shows recipient and sender; a provider rejection shows the exact Resend error", async ({
    page,
  }) => {
    await page.goto(A("/admin?tab=email"));
    const card = page.locator("div", { has: page.getByText("בדיקת שליחת מייל") }).last();
    const to = page.locator("#test-email-to");
    await to.fill("mail.check@e2e.test");
    await page.getByRole("button", { name: "שליחת מייל בדיקה" }).click();
    const ok = page.getByRole("status").filter({ hasText: "המייל נשלח אל" });
    await expect(ok).toContainText("mail.check@e2e.test");
    await expect(ok).toContainText("מאת:");

    await to.fill("mail.check+reject@e2e.test");
    await page.getByRole("button", { name: "שליחת מייל בדיקה" }).click();
    const err = page.getByRole("alert").filter({ hasText: "Invalid `to` field (e2e mock)" });
    await expect(err).toBeVisible();
    await expect(card).toBeVisible();
  });
});
