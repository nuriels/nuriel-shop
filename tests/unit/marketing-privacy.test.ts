// PRV: קוד המעקב (Meta Pixel / Google Analytics) לא מדווח על אזורי החשבון והניהול, ולא על קישורים
// עם אסימון בכתובת. ה-Pixel לא סופר לבד מעברים בתוך האתר (disablePushState) — MarketingLayer שולח
// PageView רק בעמודים המותרים; מעבר לאזור חסום כשהמעקב נטען — טעינה מלאה (TrackingConsent).
import { describe, expect, it } from "vitest";
import { NO_MARKETING_PATHS, trackingHeadScripts } from "@/lib/marketing";

describe("NO_MARKETING_PATHS (PRV)", () => {
  it.each([
    "/account",
    "/account/orders",
    "/admin",
    "/admin/products/1",
    "/orders/123",
    "/login",
    "/reset-password",
    "/agreement",
    "/unsubscribe/abc",
    "/marketing/confirm/0123456789abcdef",
  ])("no tracking on %s", (path) => {
    expect(NO_MARKETING_PATHS.test(path)).toBe(true);
  });

  it.each(["/", "/products/abc", "/category/wine", "/checkout", "/cart", "/accounting-tips"])(
    "the store pages are tracked as before: %s",
    (path) => {
      expect(NO_MARKETING_PATHS.test(path)).toBe(false);
    },
  );
});

describe("trackingHeadScripts (PRV)", () => {
  it("the Pixel does not count in-site navigation by itself (disablePushState before init)", () => {
    const [pixel] = trackingHeadScripts({ pixelId: "123456789012345", gaId: null });
    const code = pixel?.children ?? "";
    expect(code).toContain("fbq.disablePushState=true;");
    expect(code.indexOf("fbq.disablePushState=true;")).toBeLessThan(code.indexOf("fbq('init'"));
  });

  it("invalid ids still load nothing", () => {
    expect(trackingHeadScripts({ pixelId: "abc", gaId: "nope" })).toEqual([]);
  });
});
