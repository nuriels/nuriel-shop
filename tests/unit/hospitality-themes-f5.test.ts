// שלב F5: לכל ערכה חתימה משלה (לא רק צבעים) — שורת-על, קו כותרת, צורת כפתור, מסגרת תמונה;
// CSS קבוע בלבד (בלי קלט מהעסק ובלי טעינה חיצונית), והכותרות מסומנות כך שהחתימה תופסת אותן.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SIGNATURE_CSS } from "@/engines/hospitality/website/theme/signature";
import { THEMES } from "@/engines/hospitality/website/theme/themes";

const THEME_IDS = Object.keys(THEMES) as (keyof typeof THEMES)[];

describe("theme signatures (F5)", () => {
  it("every theme has its own button shape, heading rule and eyebrow", () => {
    expect(THEME_IDS.sort()).toEqual(["luxury", "modern", "nature", "romantic"]);
    const radius = new Set<string>();
    for (const id of THEME_IDS) {
      const scope = `[data-site-theme="${id}"]`;
      const r = SIGNATURE_CSS.match(
        new RegExp(`\\[data-site-theme="${id}"\\]\\{--site-button-radius:([^}]+)\\}`),
      );
      expect(r, id).not.toBeNull();
      radius.add(r![1]!);
      expect(SIGNATURE_CSS).toContain(`${scope} [data-heading-rule]`);
      expect(SIGNATURE_CSS).toContain(`${scope} [data-eyebrow]`);
    }
    // ארבע צורות כפתור שונות
    expect(radius.size).toBe(4);
  });

  it("modern numbers the sections (decorative — hidden from screen readers where supported)", () => {
    expect(SIGNATURE_CSS).toContain("counter-reset:site-sec");
    expect(SIGNATURE_CSS).toContain('counter(site-sec,decimal-leading-zero) / ""');
  });

  it("static CSS only: no external loads, no expressions, colors from the theme variables", () => {
    expect(SIGNATURE_CSS).not.toMatch(/url\(["']?https?:/i);
    expect(SIGNATURE_CSS).not.toMatch(/@import|expression\(|javascript:/i);
    expect(SIGNATURE_CSS).toContain("var(--site-gold)");
    expect(SIGNATURE_CSS).not.toMatch(/<\/?style/i);
  });

  it("section headings carry the hooks the signatures style", async () => {
    const { SectionHeading } =
      await import("@/engines/hospitality/website/components/SectionHeading");
    const { SiteContext } = await import("@/engines/hospitality/website/lib/site-context");
    const html = renderToStaticMarkup(
      createElement(SiteContext.Provider, {
        value: { theme: THEMES.modern, preview: false } as never,
        children: createElement(SectionHeading, { eyebrow: "המקום", title: "היחידות שלנו" }),
      }),
    );
    expect(html).toContain("data-section-heading");
    expect(html).toContain("data-eyebrow");
    expect(html).toContain("data-heading-rule");
  });
});
