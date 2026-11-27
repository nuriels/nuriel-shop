import { describe, expect, it } from "vitest";
import { normalizedPathRedirect, normalizedPathResponse } from "@/lib/url-normalize";

// נרמול כתובות בקצה (src/server.ts): "/" בסוף ו-"//" כפול → 308 לכתובת הנקייה, בכל אתר בפלטפורמה.
// קודם: הנתב החזיר 307 (זמני) על "/" בסוף — לא אות קנוני חזק בגוגל.
const at = (path: string, method = "GET") =>
  normalizedPathRedirect(method, new URL(`https://shop.example.com${path}`));

describe("URL normalization at the edge (308)", () => {
  it("removes a trailing slash and keeps the query string", () => {
    expect(at("/about/")).toBe("/about");
    expect(at("/product/0b6f/")).toBe("/product/0b6f");
    expect(at("/stay/")).toBe("/stay");
    expect(at("/stay/units/?from=2026-12-01&n=2")).toBe("/stay/units?from=2026-12-01&n=2");
    expect(at("/robots.txt/")).toBe("/robots.txt");
  });

  it("collapses double slashes", () => {
    expect(at("/pages//shipping")).toBe("/pages/shipping");
    expect(at("/a///b//")).toBe("/a/b");
  });

  it("leaves clean URLs, the home page and the query-only home alone", () => {
    expect(at("/")).toBeNull();
    expect(at("/about")).toBeNull();
    expect(at("/?category=%D7%9E%D7%97%D7%A9%D7%91%D7%99%D7%9D")).toBeNull();
    expect(at("/product/0b6f")).toBeNull();
  });

  it("never touches server functions, API, assets or .well-known", () => {
    expect(at("/_serverFn/abc/")).toBeNull();
    expect(at("/api/seo/gsc/callback/")).toBeNull();
    expect(at("/assets/index-x.js/")).toBeNull();
    expect(at("/.well-known/security.txt/")).toBeNull();
  });

  it("only GET and HEAD (a form POST is never redirected)", () => {
    expect(at("/about/", "HEAD")).toBe("/about");
    expect(at("/about/", "POST")).toBeNull();
    expect(at("/about/", "PUT")).toBeNull();
  });

  it("is never an open redirect: the target is always a path with exactly one leading slash", () => {
    for (const path of [
      "//evil.com/",
      "///evil.com//x/",
      "/\\evil.com/",
      "/%2F%2Fevil.com/",
      "//",
    ]) {
      const target = at(path);
      if (target === null) continue;
      expect(target.startsWith("/")).toBe(true);
      expect(target.startsWith("//")).toBe(false);
      expect(target.startsWith("/\\")).toBe(false);
      // resolved against the site, it stays on the site
      expect(new URL(target, "https://shop.example.com").host).toBe("shop.example.com");
    }
    expect(at("//evil.com/")).toBe("/evil.com");
    expect(at("//")).toBe("/"); // "//" → the home page of the same site
  });

  it("answers 308 with a relative Location and a day of cache", () => {
    const res = normalizedPathResponse("/about?x=1");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/about?x=1");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
  });
});
