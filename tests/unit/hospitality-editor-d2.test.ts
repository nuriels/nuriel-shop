// D2 — השלמת העורך: לוגו, גופנים (זוגות מאושרים לכל ערכה), עריכה ישירה מהתצוגה המקדימה
// (טקסט פשוט בלבד, אותה בדיקה כמו בעורך), וערכה בפתיחת עסק.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Editable } from "@/engines/hospitality/website/components/Editable";
import { INLINE_FIELDS, isInlineField } from "@/engines/hospitality/website/design/preview";
import {
  FONT_PAIR_IDS,
  defaultDesign,
  normalizeDesign,
} from "@/engines/hospitality/website/design/schema";
import { SiteContext } from "@/engines/hospitality/website/lib/site-context";
import { heroImage, mediaById, siteGallery } from "@/engines/hospitality/website/lib/media";
import { siteHomeMeta } from "@/engines/hospitality/website/head";
import {
  FONT_PAIRS,
  FONT_PAIR_LIST,
  fontHref,
  fontVars,
} from "@/engines/hospitality/website/theme/fonts";
import { THEMES, themeStyle } from "@/engines/hospitality/website/theme/themes";
import { parseOpenSite } from "@/engines/hospitality/validation/platform-admin";
import type { PublicMedia, PublicSite } from "@/engines/hospitality/types/website";

const LOGO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHOTO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const media = (id: string): PublicMedia => ({
  id,
  kind: "image",
  alt: null,
  width: 1600,
  height: 1067,
  is_cover: false,
  is_demo: false,
  embed_provider: null,
  embed_id: null,
  url: `https://cdn.test/${id}.webp`,
  srcset: null,
  thumb_url: null,
});

const site = (extra: Partial<PublicSite> = {}): PublicSite =>
  ({
    business: {
      name: "צימרי הגליל",
      phone: null,
      whatsapp: null,
      email: null,
      address: null,
      check_in_time: "15:00",
      check_out_time: "11:00",
      currency: "ILS",
      timezone: "Asia/Jerusalem",
      booking_mode: "request",
      approval_hours: 12,
    },
    today: "2026-11-01",
    booking_open: true,
    gallery: [media(LOGO), media(PHOTO)],
    policy: null,
    properties: [],
    units: [],
    design: null,
    room_types: [],
    ...extra,
  }) as PublicSite;

describe("design document: logo and fonts", () => {
  it("keeps a valid logo id (lowercased) and the 'name next to the logo' switch", () => {
    const d = normalizeDesign({ theme: "nature", logo: LOGO.toUpperCase(), logoName: true });
    expect(d.logo).toBe(LOGO);
    expect(d.logoName).toBe(true);
  });

  it("drops anything that is not an image id — and the name switch without a logo", () => {
    expect(normalizeDesign({ logo: "javascript:alert(1)", logoName: true }).logo).toBeUndefined();
    expect(normalizeDesign({ logo: "../x.png" }).logo).toBeUndefined();
    expect(normalizeDesign({ logoName: true }).logoName).toBeUndefined();
    expect(normalizeDesign({ logo: LOGO, logoName: "yes" }).logoName).toBeUndefined();
  });

  it("fonts: one approved pair per theme; unknown pairs / themes are dropped", () => {
    const d = normalizeDesign({
      theme: "luxury",
      fonts: { luxury: "elegant", modern: "bold", nature: "comic-sans", neon: "soft" },
    });
    expect(d.fonts).toEqual({ luxury: "elegant", modern: "bold" });
    expect(normalizeDesign({ fonts: "elegant" }).fonts).toBeUndefined();
    expect(normalizeDesign({}).fonts).toBeUndefined();
  });

  it("an old document (before D2) is unchanged: no logo, no fonts", () => {
    const d = normalizeDesign(JSON.stringify(defaultDesign("romantic")));
    expect(d).toEqual(defaultDesign("romantic"));
  });
});

describe("font pairs", () => {
  it("every approved pair is defined, with Hebrew-capable families and a body fallback to Heebo", () => {
    expect(FONT_PAIR_LIST.map((f) => f.id)).toEqual([...FONT_PAIR_IDS]);
    for (const f of FONT_PAIR_LIST) {
      expect(f.label.length, f.id).toBeGreaterThan(1);
      expect(f.body, f.id).toContain("Heebo");
    }
  });

  it("the two pairs already loaded on every page need no extra stylesheet; the rest load our own self-hosted sheet (F2: no Google Fonts)", () => {
    expect(fontHref("classic")).toBeNull();
    expect(fontHref("modern")).toBeNull();
    expect(fontHref(undefined)).toBeNull();
    for (const id of ["elegant", "soft", "bold", "literary"] as const) {
      const href = fontHref(id)!;
      expect(href, id).toBe(`/fonts/hosp/pair-${id}.css`);
      // the sheet exists, uses swap, and every file it names is in public/fonts/hosp
      const css = readFileSync(join(process.cwd(), "public", href), "utf8");
      expect(css, id).toContain("font-display:swap");
      expect(css, id).not.toMatch(/googleapis|gstatic/);
      const files = [...css.matchAll(/url\(\.\/([^)]+)\)/g)].map((m) => m[1]!);
      expect(files.length, id).toBeGreaterThanOrEqual(4);
      for (const f of files)
        expect(existsSync(join(process.cwd(), "public/fonts/hosp", f)), f).toBe(true);
    }
    expect(
      readFileSync(join(process.cwd(), "public/fonts/hosp/pair-elegant.css"), "utf8"),
    ).toContain('font-family:"Bellefair"');
  });

  it("the base fonts of every hospitality page (Heebo + Frank Ruhl Libre) are self-hosted, Hebrew and Latin", () => {
    const css = readFileSync(join(process.cwd(), "public/fonts/hosp/base.css"), "utf8");
    for (const family of ["Heebo", "Frank Ruhl Libre"])
      expect(css).toContain(`font-family:"${family}"`);
    expect(css).toContain("U+0590-05FF");
    expect(css).not.toMatch(/googleapis|gstatic/);
    for (const m of css.matchAll(/url\(\.\/([^)]+)\)/g))
      expect(existsSync(join(process.cwd(), "public/fonts/hosp", m[1]!)), m[1]).toBe(true);
  });

  it("no choice = the theme's own fonts, exactly as before; a choice overrides display and body fonts", () => {
    const luxury = THEMES.luxury;
    const plain = themeStyle(luxury) as Record<string, string>;
    expect(plain["--site-display-font"]).toBe(luxury.vars["--site-display-font"]);
    expect(plain["--font-sans"]).toBeUndefined();
    expect(fontVars(undefined)).toEqual({});
    const chosen = themeStyle(luxury, undefined, "bold") as Record<string, string>;
    expect(chosen["--site-display-font"]).toBe(FONT_PAIRS.bold.display);
    expect(chosen["--font-display"]).toBe(FONT_PAIRS.bold.display);
    expect(chosen["--font-sans"]).toBe(FONT_PAIRS.bold.body);
    expect(chosen["--site-display-weight"]).toBe("400");
    // the colours are untouched by a font choice
    expect(chosen["--primary"]).toBe(plain["--primary"]);
  });
});

describe("logo on the site", () => {
  it("the logo is found by id, but never shown as a gallery photo or as the hero / share image", () => {
    const s = site();
    expect(mediaById(s, LOGO)?.id).toBe(LOGO);
    expect(siteGallery(s, LOGO).map((m) => m.id)).toEqual([PHOTO]);
    expect(heroImage(s, LOGO)?.id).toBe(PHOTO);
    // without a logo: as before
    expect(siteGallery(s).map((m) => m.id)).toEqual([LOGO, PHOTO]);
  });

  it("structured data: the logo is the business logo, the share image is a photo", () => {
    const s = site({
      design: {
        kind: "published",
        version: 1,
        revision: 1,
        theme: "luxury",
        document: JSON.stringify({ ...defaultDesign(), logo: LOGO }),
        updated_at: "2026-11-01T10:00:00Z",
      },
    });
    const meta = siteHomeMeta(s) as Record<string, unknown>[];
    const ld = meta.find((m) => "script:ld+json" in m)?.["script:ld+json"] as Record<
      string,
      string
    >;
    expect(ld["logo"]).toBe(`https://cdn.test/${LOGO}.webp`);
    expect(ld["image"]).toBe(`https://cdn.test/${PHOTO}.webp`);
  });
});

describe("inline editing from the preview", () => {
  const render = (preview: boolean) =>
    renderToStaticMarkup(
      createElement(
        SiteContext.Provider,
        {
          value: {
            site: site(),
            theme: THEMES.luxury,
            design: defaultDesign(),
            preview,
            heroPage: false,
          },
        },
        createElement(Editable, { section: "hero", field: "title", value: "חופשה <שקטה>" }),
      ),
    );

  it("on the public site: plain text, nothing editable", () => {
    const html = render(false);
    expect(html).toBe("חופשה &lt;שקטה&gt;");
  });

  it("in the editor's preview: an editable plain-text box (text escaped, labelled for screen readers)", () => {
    const html = render(true);
    // (HTML attributes are case-insensitive — React writes contentEditable)
    expect(html.toLowerCase()).toContain('contenteditable="plaintext-only"');
    expect(html).toContain('role="textbox"');
    expect(html).toContain('aria-label="עריכה: כותרת"');
    expect(html).toContain("data-inline-edit");
    expect(html).toContain("חופשה &lt;שקטה&gt;");
    expect(html).not.toContain("<שקטה>");
  });

  it("only the plain-text fields can be edited this way (images, lists, settings — in the side panel)", () => {
    expect([...INLINE_FIELDS]).toEqual(["eyebrow", "title", "subtitle", "body", "note"]);
    expect(isInlineField("title")).toBe(true);
    expect(isInlineField("image")).toBe(false);
    expect(isInlineField("faq")).toBe(false);
    expect(isInlineField("__proto__")).toBe(false);
  });

  it("an edit goes through the same normalisation as the side panel (length limits, control characters)", () => {
    const d = normalizeDesign({
      sections: [{ id: "hero", type: "hero", content: { title: `${"א".repeat(500)}\u0007` } }],
    });
    expect(d.sections[0]!.content.title).toHaveLength(120);
    expect(d.sections[0]!.content.title).not.toContain("\u0007");
  });
});

describe("theme when a business is opened (platform panel)", () => {
  const base = { name: "צימר", slug: "zimmer-d2", ownerEmail: "owner@example.com" };
  it("defaults to Luxury and accepts the four themes only", () => {
    expect(parseOpenSite(base).theme).toBe("luxury");
    expect(parseOpenSite({ ...base, theme: "romantic" }).theme).toBe("romantic");
    expect(() => parseOpenSite({ ...base, theme: "neon" })).toThrow("ערכת עיצוב לא מוכרת");
  });
});
