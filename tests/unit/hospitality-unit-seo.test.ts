// כותרת ותיאור לגוגל לכל יחידה (פרויקט Google SEO, שלב 2) — בדיקת הקלט לפני המסד:
// שורה אחת בלי סימני תגיות, ריק = ברירת המחדל, אותו גבול כמו בדף הבית, וגרסה תקינה.
import { describe, expect, it } from "vitest";
import {
  parseUnitSeoGet,
  parseUnitSeoSet,
  seoLine,
  unitSeoErrors,
} from "@/engines/hospitality/validation/unit-seo";
import { SEO_LIMITS } from "@/engines/hospitality/website/design/schema";

const UNIT = "11111111-2222-4333-8444-555555555555";

describe("one line for the search results", () => {
  it("line breaks and tabs become spaces, tag signs are removed, spaces collapse, edges trimmed", () => {
    expect(seoLine("  צימר הגפן\nבגליל\t<העליון>  ")).toBe("צימר הגפן בגליל העליון");
    expect(seoLine(null)).toBe("");
    expect(seoLine(undefined)).toBe("");
    expect(() => seoLine(5)).toThrow("הטקסט לא תקין");
  });
});

describe("saving the unit's Google title and description", () => {
  it("valid input: the id normalised, empty → null (the site default), the revision kept", () => {
    expect(
      parseUnitSeoSet({
        id: UNIT.toUpperCase(),
        title: " צימר הגפן ",
        description: "",
        revision: 3,
      }),
    ).toEqual({ id: UNIT, title: "צימר הגפן", description: null, revision: 3 });
  });

  it("the same limits as the home page; the first problem is the message", () => {
    const longTitle = "א".repeat(SEO_LIMITS.title + 1);
    const longDescription = "ב".repeat(SEO_LIMITS.description + 1);
    expect(unitSeoErrors({ title: longTitle, description: longDescription })).toEqual({
      title: `כותרת לגוגל — עד ${SEO_LIMITS.title} תווים`,
      description: `תיאור לגוגל — עד ${SEO_LIMITS.description} תווים`,
    });
    expect(() =>
      parseUnitSeoSet({ id: UNIT, title: longTitle, description: "", revision: 1 }),
    ).toThrow(`עד ${SEO_LIMITS.title}`);
    expect(unitSeoErrors({ title: "א".repeat(SEO_LIMITS.title), description: "" })).toEqual({});
  });

  it("refused: a bad id, a missing or broken revision, a non-text value", () => {
    expect(() => parseUnitSeoSet({ id: "x", title: "", description: "", revision: 1 })).toThrow(
      "היחידה לא תקין",
    );
    expect(() => parseUnitSeoSet({ id: UNIT, title: "", description: "" })).toThrow(
      "הגרסה לא תקינה",
    );
    expect(() => parseUnitSeoSet({ id: UNIT, title: "", description: "", revision: 0 })).toThrow(
      "הגרסה לא תקינה",
    );
    expect(() => parseUnitSeoSet({ id: UNIT, title: ["x"], description: "", revision: 1 })).toThrow(
      "הטקסט לא תקין",
    );
    expect(parseUnitSeoGet({ id: UNIT })).toEqual({ id: UNIT });
    expect(() => parseUnitSeoGet({})).toThrow("היחידה לא תקין");
  });
});
