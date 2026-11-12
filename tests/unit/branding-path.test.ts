// הלוגו של החנות מהדלי branding — הנתיב מהמסד (בעל החנות קובע אותו) מורד במפתח השירות, ולכן רק
// נתיב רגיל בתיקייה של החנות הזו עובר. "../" היה מוביל לבקשה במפתח השירות לדלי פרטי או ל-REST.
import { describe, expect, it } from "vitest";
import { safeBrandingPath } from "@/lib/branding-path";

const T = "7e2e0000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-000000000001";

describe("safeBrandingPath", () => {
  it("the paths the app writes pass unchanged", () => {
    expect(safeBrandingPath(`${T}/site/logo-1731400000000.png`, T)).toBe(
      `${T}/site/logo-1731400000000.png`,
    );
    expect(safeBrandingPath(`  ${T}/site/side-banner-1.webp `, T)).toBe(
      `${T}/site/side-banner-1.webp`,
    );
    // older paths without a tenant folder (the first store) still load
    expect(safeBrandingPath("site/logo.png", T)).toBe("site/logo.png");
  });

  it("traversal, absolute paths and URL tricks are refused", () => {
    for (const bad of [
      `../payment-receipts/${T}/o/receipt.png`,
      `${T}/../../../../rest/v1/user_roles`,
      `${T}/site/./logo.png`,
      `/${T}/site/logo.png`,
      `${T}/site/logo.png?x=1`,
      `${T}/site/logo.png#a`,
      `${T}/site/%2e%2e/logo.png`,
      `${T}\\site\\logo.png`,
      `${T}//site/logo.png`,
      "",
      null,
    ])
      expect(safeBrandingPath(bad, T), String(bad)).toBeNull();
  });

  it("another store's folder is refused", () => {
    expect(safeBrandingPath(`${OTHER}/site/logo.png`, T)).toBeNull();
    expect(safeBrandingPath(`${T}/site/logo.png`, null)).toBeNull();
  });
});
