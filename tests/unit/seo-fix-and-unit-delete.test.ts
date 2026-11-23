// "תקנו לי" (מרכז ה-SEO) ומחיקת יחידה (מיגרציה 205) — החלקים הטהורים: איזה ממצא אפשר לתקן, לאיזה עמוד הוא
// שייך, מי מטפל בשאר הממצאים, ומה החלון "האם למחוק?" אומר שיימחק.
import { describe, expect, it } from "vitest";
import {
  hasSeoIssueAction,
  parseSeoFix,
  seoFixTargets,
  SEO_FIX_MAX_URLS,
} from "@/engines/hospitality/website/seo-fix";
import { issueHint, issueOwner, OWNER_NOTE } from "@/platform/seo/issue-help";
import { unitDeleteSummary } from "@/engines/hospitality/management/catalog/model";
import type { PublicSite } from "@/engines/hospitality/types/website";

const O = "https://nofi-dorit.nuri1.fit";
const site = {
  units: [
    { id: "u-moria", slug: "מוריה" },
    { id: "u-adir", slug: "אדיר" },
    { id: "u-6", slug: "צימר-6" },
  ],
  packages: [{ id: "pk-bride", slug: "חבילת-הכלה-vip" }],
} as unknown as Pick<PublicSite, "units" | "packages">;
const u = (slug: string) => `${O}/stay/units/${encodeURIComponent(slug)}`;

describe("which findings have a fix, and for which page", () => {
  it("only text findings for Google are fixable; at most 20 addresses; empty / foreign input refused", () => {
    expect(parseSeoFix({ code: "title.duplicate", urls: [u("אדיר")] })).toEqual({
      code: "title.duplicate",
      urls: [u("אדיר")],
    });
    expect(parseSeoFix({ code: "schema.breadcrumbs_missing", urls: [O] })).toBeNull();
    expect(parseSeoFix({ code: "title.duplicate", urls: [] })).toBeNull();
    expect(parseSeoFix({ code: "title.duplicate", urls: [42, null] })).toBeNull();
    expect(parseSeoFix(null)).toBeNull();
    expect(
      parseSeoFix({ code: "description.length_hint", urls: Array(50).fill(`${O}/stay`) })?.urls,
    ).toHaveLength(SEO_FIX_MAX_URLS);
  });

  it('"/" and "/stay" are the home page; units and packages by their (Hebrew, encoded) slug; other pages skipped; each page once', () => {
    expect(
      seoFixTargets(site, {
        code: "description.length_hint",
        urls: [
          `${O}/`,
          `${O}/stay`,
          u("צימר-6"),
          u("צימר-6"),
          `${O}/stay/packages/${encodeURIComponent("חבילת-הכלה-vip")}`,
          u("יחידה-שנמחקה"),
          `${O}/stay/gallery`,
          "not a url %%",
        ],
      }),
    ).toEqual([
      { target_kind: "site", target_id: null },
      { target_kind: "unit", target_id: "u-6" },
      { target_kind: "package", target_id: "pk-bride" },
    ]);
  });

  it("a duplicate shared by the home page and inner pages: the inner pages get their own text, the home page keeps its", () => {
    expect(
      seoFixTargets(site, { code: "title.duplicate", urls: [`${O}/stay`, u("מוריה"), u("אדיר")] }),
    ).toEqual([
      { target_kind: "unit", target_id: "u-moria" },
      { target_kind: "unit", target_id: "u-adir" },
    ]);
    // the home page alone (no other page in the group) is still fixable
    expect(seoFixTargets(site, { code: "title.duplicate", urls: [`${O}/stay`] })).toEqual([
      { target_kind: "site", target_id: null },
    ]);
  });

  it('an action is offered for text, content and image findings — "the system handles it" for the rest', () => {
    expect(
      ["title.duplicate", "description.length_hint", "content.thin", "images.alt_missing"].every(
        hasSeoIssueAction,
      ),
    ).toBe(true);
    expect(
      ["schema.breadcrumbs_missing", "lang.dir", "sitemap.missing_pages"].some(hasSeoIssueAction),
    ).toBe(false);
    expect(issueOwner("schema.breadcrumbs_missing")).toBe("system");
    expect(issueOwner("sitemap.missing_pages")).toBe("system");
    expect(issueOwner("page.error_in_sitemap")).toBe("support");
    expect(issueOwner("description.duplicate")).toBe("you");
    expect(OWNER_NOTE.system).toMatch(/לא צריך לעשות כלום/);
    expect(issueHint("description.duplicate")).toMatch(/תיאור משלו/);
    expect(issueHint("lang.dir")).toBeNull();
  });
});

describe('the "delete the unit?" window says what goes with it', () => {
  it("only what exists, in plain words", () => {
    expect(
      unitDeleteSummary({ photos: 0, prices: 0, beds: 0, amenities: 0, calendars: 0 }),
    ).toEqual([]);
    expect(
      unitDeleteSummary({ photos: 1, prices: 2, beds: 1, amenities: 0, calendars: 1 }),
    ).toEqual([
      "תמונה אחת",
      "2 כללי מחיר (סוף שבוע / עונה / מבצע)",
      "המיטות והמתקנים שהוגדרו לה",
      "קישור סנכרון יומן אחד",
    ]);
    expect(
      unitDeleteSummary({ photos: 5, prices: 1, beds: 0, amenities: 3, calendars: 0 }),
    ).toEqual(["5 תמונות", "כלל מחיר אחד (סוף שבוע / עונה / מבצע)", "המיטות והמתקנים שהוגדרו לה"]);
  });
});
