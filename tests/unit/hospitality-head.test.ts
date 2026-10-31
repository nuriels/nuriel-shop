import { describe, expect, it } from "vitest";
import { hospitalityHeadMeta, NEUTRAL_SITE_TITLE } from "@/engines/hospitality/management/head";

// R-1: תגיות ה-head של אתר אירוח — שם העסק בלבד, בלי ערכי חנות
const value = (meta: ReturnType<typeof hospitalityHeadMeta>, key: string) =>
  meta
    .filter((m) => ("name" in m && m.name === key) || ("property" in m && m.property === key))
    .map((m) => ("content" in m ? m.content : undefined));

describe("hospitality head meta", () => {
  it("uses the business name for description, og:title and og:site_name", () => {
    const meta = hospitalityHeadMeta({ name: "בקתות הים" });
    for (const key of ["description", "og:title", "og:site_name", "og:description"])
      expect(value(meta, key), key).toEqual(["בקתות הים"]);
    expect(meta).toContainEqual({ title: "בקתות הים" });
  });

  it("is never indexed and carries no store SEO, tracking or branding tags", () => {
    const meta = hospitalityHeadMeta({ name: "x" });
    expect(value(meta, "robots")).toEqual(["noindex, nofollow"]);
    for (const key of [
      "keywords",
      "google-site-verification",
      "theme-color",
      "og:image",
      "og:url",
      "twitter:card",
    ])
      expect(value(meta, key), key).toEqual([]);
    expect(JSON.stringify(meta)).not.toContain("החנות שלי");
  });

  it("without a name: a neutral title, not a store default", () => {
    const meta = hospitalityHeadMeta({ name: null });
    expect(value(meta, "og:site_name")).toEqual([NEUTRAL_SITE_TITLE]);
    expect(NEUTRAL_SITE_TITLE).not.toBe("החנות שלי");
  });
});
