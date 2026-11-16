// Nuriel Websites — שחזור נאמן של אתר קיים (תבנית "קלאסית"): גופני אתר, צבעי תבנית, חלקי האתר, מקטעים חדשים,
// הצגה לפי מכשיר, שורות מוצדקות — וכל ערך שנכנס ל-CSS נבדק
import { describe, expect, it } from "vitest";
import { normalizeBlockProps } from "@/engines/business-profile/document/blocks";
import { initialDocument } from "@/engines/business-profile/document/defaults";
import { normalizeDocument } from "@/engines/business-profile/document/normalize";
import { fontFaceCss, FONT_URL } from "@/engines/business-profile/site/fonts";
import { justifyRows } from "@/engines/business-profile/site/layout";
import { TEMPLATE_PALETTES } from "@/engines/business-profile/templates/palettes";
import { TEMPLATES, templateTokens } from "@/engines/business-profile/templates/registry";
import { paletteProblems } from "@/engines/business-profile/studio/editor/contrast";
// @ts-expect-error -- a plain ESM script, no type declarations
import { buildFaithfulDocument, loadSource } from "../../scripts/websites/efrat-faithful.mjs";

const MEDIA = "6f1f1f1f-1f1f-4f1f-8f1f-1f1f1f1f1f1f";
const font = (over: Record<string, unknown> = {}) => ({
  family: "Heebo",
  weight: "100 900",
  style: "normal",
  unicodeRange: "U+0590-05FF, U+200C-2010",
  file: { media: MEDIA },
  ...over,
});
const withTheme = (theme: Record<string, unknown>) =>
  normalizeDocument({
    ...initialDocument("classic", "בדיקה"),
    theme: { ...initialDocument("classic", "בדיקה").theme, ...theme },
  });

describe("site fonts in the document", () => {
  it("keeps a valid font (family, variable weight range, style, Unicode range, media id)", () => {
    const d = withTheme({ fonts: [font()] });
    expect(d.theme.fonts).toEqual([font()]);
  });

  it("drops a font whose details could break out of the CSS rule; a bad range or weight falls back", () => {
    const d = withTheme({
      fonts: [
        font({ family: 'Heebo"; } body { display:none' }),
        font({ family: "Heebo</style><script>" }),
        font({ file: { media: "../../etc/passwd" } }),
        font({ weight: "450" }),
        font({ unicodeRange: "U+0590-05FF; } body {" }),
        font({ style: "oblique" }),
      ],
    });
    // the first three are dropped entirely; the others keep the safe default for the bad field
    expect(d.theme.fonts.map((f) => [f.family, f.weight, f.unicodeRange, f.style])).toEqual([
      ["Heebo", "400", "U+0590-05FF, U+200C-2010", "normal"],
      ["Heebo", "100 900", "", "normal"],
      ["Heebo", "100 900", "U+0590-05FF, U+200C-2010", "normal"],
    ]);
  });

  it("builds @font-face only from checked values and library URLs", () => {
    const url = `http://127.0.0.1:54321/storage/v1/object/public/bp-media/site/${MEDIA}.woff2`;
    const css = fontFaceCss([font()] as never, () => url);
    expect(css).toBe(
      `@font-face{font-family:"Heebo";src:url("${url}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;unicode-range:U+0590-05FF, U+200C-2010;}`,
    );
    // a URL that could close url("…") or the <style> tag is never used
    for (const bad of [
      'https://x/a.woff2") ; }',
      "https://x/a b.woff2",
      "javascript:alert(1)",
      "https://x/</style>",
    ]) {
      expect(FONT_URL.test(bad)).toBe(false);
      expect(fontFaceCss([font()] as never, () => bad)).toBe("");
    }
    expect(fontFaceCss([font()] as never, () => undefined)).toBe("");
  });

  it("a real 128-range subset (Google symbols file) is accepted", () => {
    const range = Array.from(
      { length: 128 },
      (_, i) => `U+${(4096 + i * 16).toString(16)}-${(4103 + i * 16).toString(16)}`,
    ).join(", ");
    expect(withTheme({ fonts: [font({ unicodeRange: range })] }).theme.fonts[0]!.unicodeRange).toBe(
      range,
    );
  });
});

describe("Classic template: tokens, typography, site parts", () => {
  it("is a template with its own palette (AA-safe by default) and token defaults", () => {
    expect(TEMPLATES.classic.status).toBe("available");
    expect(paletteProblems(TEMPLATE_PALETTES.classic)).toEqual([]);
    const tokens = templateTokens(TEMPLATES.classic, { title: "#542510", bogus: "#000000" });
    expect(tokens.title).toBe("#542510");
    expect(tokens.tabBg).toBe("#AED1C1");
    expect("bogus" in tokens).toBe(false);
  });

  it("tokens keep only #rrggbb values with safe names; typography roles keep only safe family names", () => {
    const d = withTheme({
      tokens: { title: "#542510", cardTitle: "red;}", "bad-name": "#000000", tabBg: "#AED1C1" },
      typography: { display: "Heebo", heading: "Assistant", body: 'x"}', ui: "Roboto" },
    });
    expect(d.theme.tokens).toEqual({ title: "#542510", tabBg: "#AED1C1" });
    expect(d.theme.typography).toEqual({
      display: "Heebo",
      heading: "Assistant",
      body: "",
      ui: "Roboto",
    });
  });

  it("site parts: no header, a strip footer, no floating WhatsApp — and safe defaults for anything else", () => {
    expect(
      withTheme({ chrome: { header: "none", footer: "strip", floatingWhatsapp: false } }).theme
        .chrome,
    ).toEqual({
      header: "none",
      footer: "strip",
      floatingWhatsapp: false,
    });
    expect(withTheme({ chrome: { header: "javascript", footer: 7 } }).theme.chrome).toEqual({
      header: "bar",
      footer: "full",
      floatingWhatsapp: true,
    });
  });

  it("a new Classic site starts with the Classic order and site parts", () => {
    const d = initialDocument("classic", "בדיקה");
    expect(d.pages[0]!.blocks.map((b) => b.type)).toEqual([
      "hero",
      "form",
      "about",
      "testimonials",
      "services",
      "portfolio",
      "form",
    ]);
    expect(new Set(d.pages[0]!.blocks.map((b) => b.id)).size).toBe(d.pages[0]!.blocks.length);
    expect(d.theme.chrome).toEqual({ header: "none", footer: "strip", floatingWhatsapp: false });
  });
});

describe("new block options and blocks", () => {
  it("hero: lead line, tagline, logo, WhatsApp icon, overlay 0–90", () => {
    const p = normalizeBlockProps("hero", {
      titleLead: { he: "אפשר" },
      showLogo: true,
      primaryIcon: "whatsapp",
      overlay: 75,
      layout: "cover",
    });
    expect([p.titleLead.he, p.showLogo, p.primaryIcon, p.overlay, p.layout]).toEqual([
      "אפשר",
      true,
      "whatsapp",
      75,
      "cover",
    ]);
    expect(normalizeBlockProps("hero", { overlay: 300, primaryIcon: "<svg>" })).toMatchObject({
      overlay: null,
      primaryIcon: "none",
    });
  });

  it("form and media blocks: known values only, sizes within bounds", () => {
    const f = normalizeBlockProps("form", {
      layout: "stacked",
      tone: "dark",
      submit: { he: "לשיחת היכרות" },
    });
    expect([f.layout, f.tone, f.submit.he]).toEqual(["stacked", "dark", "לשיחת היכרות"]);
    expect(normalizeBlockProps("form", { tone: "neon" }).tone).toBe("light");
    const m = normalizeBlockProps("media", {
      width: 213,
      align: "end",
      alignNarrow: "start",
      widthNarrow: 107,
    });
    expect([m.width, m.align, m.alignNarrow, m.widthNarrow]).toEqual([213, "end", "start", 107]);
    expect(normalizeBlockProps("media", { width: 99999, alignNarrow: "left" })).toMatchObject({
      width: 320,
      alignNarrow: "same",
    });
  });

  it("portfolio items show on every screen, only wide or only narrow; anything else = every screen", () => {
    const d = normalizeDocument({
      ...initialDocument("classic", "בדיקה"),
      collections: {
        services: [],
        testimonials: [],
        portfolio: {
          categories: [{ id: "cat-1", label: { he: "פרוזה" } }],
          items: ["desktop", "mobile", "all", "tv"].map((devices, i) => ({
            id: `w-${i}`,
            title: { he: "" },
            devices,
          })),
        },
      },
    });
    expect(d.collections.portfolio.items.map((i) => i.devices)).toEqual([
      "desktop",
      "mobile",
      "all",
      "all",
    ]);
  });
});

describe("justified rows (narrow-screen gallery)", () => {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  it("every full row fills the width exactly (minus gaps) at one height; no picture is cropped", () => {
    const ratios = [0.66, 0.7, 0.66, 1.5, 0.66, 0.75, 0.66, 0.7, 0.66, 0.66, 0.8];
    const boxes = justifyRows(ratios, 350, 150, 10);
    // the browser's line wrapping (flex-wrap, gap 10): a new line when the next box no longer fits
    const rows: number[][] = [[]];
    let used = 0;
    boxes.forEach((b, i) => {
      const need = (rows.at(-1)!.length ? 10 : 0) + b.width;
      if (used + need > 350 + 0.001) {
        rows.push([]);
        used = 0;
      }
      used += rows.at(-1)!.length ? 10 + b.width : b.width;
      rows.at(-1)!.push(i);
    });
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows.slice(0, -1)) {
      const width = sum(row.map((i) => boxes[i]!.width)) + (row.length - 1) * 10;
      expect(width).toBeGreaterThan(349);
      expect(width).toBeLessThanOrEqual(350);
      const heights = row.map((i) => boxes[i]!.height);
      // (the ideal widths are rounded to whole pixels, as in the original gallery → under 1.5px apart)
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1.5);
    }
    boxes.forEach((b, i) => expect(b.width / b.height).toBeCloseTo(ratios[i]!, 1));
  });

  it("closes a row at the closest fit (with or without the next picture)", () => {
    // 150px high: 99 + 99 + 99 = 297 of 300 → the 4th would overflow by far more than the 3px left → new row
    const boxes = justifyRows([0.66, 0.66, 0.66, 0.66], 300, 150, 0);
    expect(boxes[0]!.height).toBe(boxes[2]!.height);
    expect(boxes[3]!.height).not.toBe(boxes[2]!.height);
  });

  it("a short last row is not stretched; a nearly full one is", () => {
    const short = justifyRows([0.66, 0.66, 0.66, 0.66, 0.66], 300, 150, 0);
    expect(short[4]!.height).toBe(150);
    const nearly = justifyRows([0.66, 0.66, 0.66, 0.66, 0.66, 0.66], 300, 150, 0);
    expect(nearly[5]!.height).toBeGreaterThan(149);
  });

  it("handles empty input, zero width and bad ratios without throwing", () => {
    expect(justifyRows([], 300, 150, 10)).toEqual([]);
    expect(justifyRows([1], 0, 150, 10)).toEqual([{ width: 0, height: 0 }]);
    const b = justifyRows([Number.NaN, -1, 1], 300, 150, 10);
    expect(b.every((x) => Number.isFinite(x.width) && Number.isFinite(x.height))).toBe(true);
  });
});

describe("Efrat's faithful draft (built from the scanned source)", () => {
  const src = loadSource();
  const doc = normalizeDocument(buildFaithfulDocument(src, {}));

  it("is a Classic draft with the old page's order, texts and site parts", () => {
    expect(doc.template).toBe("classic");
    expect(doc.pages[0]!.blocks.map((b) => `${b.id}:${b.type}`)).toEqual([
      "hero:hero",
      "form:form",
      "about:about",
      "pen:media",
      "testimonials:testimonials",
      "services:services",
      "portfolio:portfolio",
      "contact:form",
    ]);
    expect(doc.theme.chrome).toEqual({ header: "none", footer: "strip", floatingWhatsapp: false });
    expect(doc.theme.typography).toEqual({
      display: "Heebo",
      heading: "Assistant",
      body: "Assistant",
      ui: "Roboto",
    });
    const hero = doc.pages[0]!.blocks[0]!.props as {
      titleLead: { he: string };
      title: { he: string };
      primary: { href: string };
    };
    expect([hero.titleLead.he, hero.title.he]).toEqual(["אפשר לקרוא סיפור,", "ואפשר להרגיש אותו"]);
    expect(hero.primary.href).toMatch(/^https:\/\/wa\.me\/972524653108\?text=/);
  });

  it("the same two galleries as the old page: 5 tabs, desktop 13/37/2/6/4, phone 13/36/2/6/4 — 64 different pictures", () => {
    const { categories, items } = doc.collections.portfolio;
    expect(categories.map((c) => c.label.he)).toEqual([
      "פרוזה",
      "ספרי ילדים",
      "שירה",
      "הגהה",
      "ספרים, קלפים, חוברות וחומרי למידה",
    ]);
    const count = (devices: string) =>
      categories.map(
        (c) => items.filter((i) => i.devices === devices && i.categories.includes(c.id)).length,
      );
    expect(count("desktop")).toEqual([13, 37, 2, 6, 4]);
    expect(count("mobile")).toEqual([13, 36, 2, 6, 4]);
    expect(new Set(src.portfolio.items.map((i: { file: string }) => i.file)).size).toBe(64);
  });

  it("nothing is invented: works without a known title stay untitled; 13 testimonials as the original screenshots", () => {
    const titled = doc.collections.portfolio.items.filter((i) => i.title.he);
    for (const w of titled) expect(w.title.he).not.toMatch(/WhatsApp|width_|^\d+$|IMG|DSC/);
    expect(new Set(titled.map((w) => w.title.he)).size).toBe(18);
    expect(doc.collections.testimonials).toHaveLength(13);
    expect(doc.collections.testimonials.every((t) => t.quote.he === "")).toBe(true);
  });
});
