import { describe, expect, it } from "vitest";
import { renderRobots, renderSitemap, xmlEscape } from "@/lib/feeds.server";
import { breadcrumbJsonLd, jsonLdText } from "@/lib/structured-data";

// צילום מדויק של הפלט — כל שינוי ב-SEO של החנויות יכשיל את הבדיקה
describe("robots.txt", () => {
  it("matches the baseline for an open store", () => {
    expect(renderRobots("https://kobi.example.com", true)).toMatchSnapshot();
  });
  it("blocks everything for a locked store", () => {
    expect(renderRobots("https://kobi.example.com", false)).toBe("User-agent: *\nDisallow: /\n");
  });
});

describe("sitemap.xml", () => {
  it("matches the baseline (with and without images)", () => {
    expect(
      renderSitemap([
        { loc: "https://kobi.example.com/", priority: "1.0" },
        {
          loc: "https://kobi.example.com/product/1?a=1&b=2",
          lastmod: "2026-01-02T10:00:00Z",
          priority: "0.8",
          images: ["https://cdn.example.com/p.webp"],
        },
      ]),
    ).toMatchSnapshot();
    expect(renderSitemap([{ loc: "https://kobi.example.com/" }])).toMatchSnapshot();
  });
  it("escapes XML", () => {
    expect(xmlEscape(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
  });
});

describe("JSON-LD", () => {
  it("cannot break out of the script tag", () => {
    expect(jsonLdText({ name: "</script><script>x" })).not.toContain("</script>");
  });
  it("matches the breadcrumb baseline", () => {
    expect(
      breadcrumbJsonLd([
        { name: "בית", url: "https://kobi.example.com/" },
        { name: "יינות", url: "https://kobi.example.com/?category=יינות" },
      ]),
    ).toMatchSnapshot();
  });
});
