// SEC-H4: SVG יכול להכיל סקריפט, והדליים הציבוריים (product-images / branding) מגישים אותו
// inline — הדפדפן מסרב לו לפני ההעלאה (והשרת חוסם גם הוא: allowed_mime_types).
import { describe, expect, it } from "vitest";
import {
  compressDesktopBannerImage,
  compressLogoImage,
  compressProductImage,
  compressSideBannerImage,
} from "@/lib/image";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>';

describe("image upload refuses SVG (SEC-H4)", () => {
  const compressors = {
    product: compressProductImage,
    logo: compressLogoImage,
    "desktop banner": compressDesktopBannerImage,
    "side banner": compressSideBannerImage,
  };

  for (const [name, compress] of Object.entries(compressors)) {
    it(`${name}: an image/svg+xml file is refused`, async () => {
      const file = new File([svg], "logo.svg", { type: "image/svg+xml" });
      await expect(compress(file)).rejects.toThrow(/SVG/);
    });
  }

  it("a .svg file sent with an image/png type is refused too (by name)", async () => {
    const file = new File([svg], "innocent.SVG", { type: "image/png" });
    await expect(compressProductImage(file)).rejects.toThrow(/SVG/);
  });

  it("a non-image file is still refused with the usual message", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    await expect(compressProductImage(file)).rejects.toThrow(/תמונה/);
  });
});
