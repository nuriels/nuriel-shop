// Google SEO — ביטויי חיפוש בעברית לאתר האירוח: רשימה תקינה לכל עסק בטיוטת האתר, התאמה בעברית (אותיות
// שימוש, ניקוד, גרשיים, ריבוי), דוח "איפה מופיע" לפי הנתונים שהאתר מציג — ושום ביטוי לא מגיע לגולש:
// לא בתגיות, לא בנתוני העמוד. וגם: priceRange בלי "0", וכותרת יחידה בלי שם העסק פעמיים.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PublicSite, PublicUnit } from "@/engines/hospitality/types/website";
import { defaultDesign, normalizeDesign } from "@/engines/hospitality/website/design/schema";
import { siteHomeHead, siteUnitHead, unitDefaultTitle } from "@/engines/hospitality/website/head";
import { toPublicSite, withoutKeywords } from "@/engines/hospitality/website/lib/site-map";
import {
  KEYWORD_LIMITS,
  countPhrase,
  keywordError,
  matchPhrase,
  newKeywordId,
  normalizeHebrew,
  normalizeKeywords,
  stuffingWarnings,
  type SeoKeyword,
} from "@/engines/hospitality/website/seo-keywords";
import { draftKeywordReport } from "@/engines/hospitality/website/seo-keywords-report";

const kw = (id: string, text: string, group: SeoKeyword["group"] = "local"): SeoKeyword => ({
  id,
  text,
  group,
});

function unit(id: string, slug: string, extra: Partial<PublicUnit> = {}): PublicUnit {
  return {
    id,
    slug,
    name: slug,
    description: null,
    base_price: 1200,
    capacity: 5,
    min_nights: 1,
    media: [],
    seo_title: null,
    seo_description: null,
    ...extra,
  } as unknown as PublicUnit;
}

/** אתר בדוגמת נופי דורית — רק טקסטים שמופיעים היום באתר החי */
function site(document: unknown = defaultDesign()): PublicSite {
  return {
    business: {
      name: "נופי דורית חוויה בכפר",
      phone: "0503822300",
      email: null,
      address: "ישעי 22",
      currency: "ILS",
    },
    today: "2026-11-17",
    booking_open: true,
    gallery: [{ id: "g1", kind: "image", url: "https://cdn.test/a.webp", alt: "", sort_order: 0 }],
    policy: null,
    properties: [
      {
        id: "p1",
        name: "נופי דורית חוויה בכפר",
        property_type: "zimmer",
        description:
          'מזמינים אתכם להנות מנופש חלומי במתחם האירוח "נופי דורית חוויה בכפר" בישוב ישעי השוכן בשפלת דן בית שמש והסביבה.',
        address: "ישעי 22",
        guest_info: "איזור: ירושלים והסביבה. בית שמש והסביבה",
        media: [],
      },
    ],
    units: [
      unit("u1", "גן-עדן-vip", { name: "גן עדן VIP", base_price: 1400 }),
      unit("u2", "אירוע", {
        name: "אירוע באזור הבריכה עד 50 איש",
        base_price: 0,
        description: "מתחם אירועים פרטי עם בריכת שחייה גדולה ומדשאה.",
      }),
      unit("u3", "כל-המתחם", { name: "כל המתחם — נופי דורית חוויה בכפר", base_price: 4000 }),
    ],
    room_types: [],
    design: {
      kind: "published",
      version: 5,
      revision: 1,
      theme: "luxury",
      document: JSON.stringify(document),
      updated_at: "2026-11-15T10:00:00Z",
    },
    origin: "https://nofi-dorit.example",
  } as unknown as PublicSite;
}

describe("the keyword list in the site document: valid, per business, never HTML", () => {
  it("keeps valid phrases, drops empty / duplicate ones, strips tags, fixes ids and groups", () => {
    const list = normalizeKeywords([
      { id: "kw-1", text: "  צימר   ליד בית שמש ", group: "local", primary: true },
      { id: "kw-1", text: "צימר בישעי", group: "nope", primary: "yes" },
      { id: "bad id!", text: "צִימֵר לִיד בֵּית שֶׁמֶשׁ" }, // אותו ביטוי עם ניקוד — כפילות
      { text: '<script>alert("x")</script>' },
      { text: "   " },
      "not an object",
      null,
    ]);
    expect(list).toEqual([
      { id: "kw-1", text: "צימר ליד בית שמש", group: "local", primary: true },
      { id: "kw-2", text: "צימר בישעי", group: "general" },
      { id: "kw-3", text: 'script alert("x") /script', group: "general" },
    ]);
    expect(normalizeKeywords([])).toBeUndefined();
    expect(normalizeKeywords("צימר")).toBeUndefined();
  });

  it("limits the length of a phrase and the number of phrases", () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ text: `ביטוי ${i}` }));
    expect(normalizeKeywords(many)).toHaveLength(KEYWORD_LIMITS.count);
    expect(normalizeKeywords([{ text: "א".repeat(200) }])![0]!.text).toHaveLength(
      KEYWORD_LIMITS.text,
    );
  });

  it("normalizeDesign keeps the list under seo.keywords (a document with only keywords too)", () => {
    const d = normalizeDesign({
      ...defaultDesign(),
      seo: { keywords: [{ text: "צימר בישעי", group: "local" }] },
    });
    expect(d.seo).toEqual({ keywords: [{ id: "kw-1", text: "צימר בישעי", group: "local" }] });
  });

  it("validates a new / edited phrase: empty, too long, duplicate (also with niqqud), over the limit", () => {
    const list = [kw("kw-1", "צימר בישעי")];
    expect(keywordError("  ", list)).toBe("כתבו ביטוי חיפוש");
    expect(keywordError("א".repeat(81), list)).toMatch(/עד 80/);
    expect(keywordError("צִימֵר  בישעי", list)).toBe("הביטוי כבר ברשימה");
    expect(keywordError("צימר בישעי", list, "kw-1")).toBeNull(); // עריכה של אותו ביטוי
    expect(keywordError("צימרים בישעי", list)).toBeNull();
    const full = Array.from({ length: KEYWORD_LIMITS.count }, (_, i) =>
      kw(`kw-${i + 1}`, `ב ${i}`),
    );
    expect(keywordError("חדש", full)).toMatch(/עד 60/);
    expect(newKeywordId(list)).toBe("kw-2");
  });
});

describe("Hebrew matching", () => {
  it("ignores niqqud, geresh / quotes and punctuation", () => {
    expect(normalizeHebrew('ג׳קוזי — ג\'קוזי, "נוף"')).toBe("גקוזי גקוזי נוף");
    expect(matchPhrase("צִימֵר בְּיִשְׁעִי", "צימר בישעי")).toBe("exact");
  });

  it("prefix letters (ו, ה, ב, ל, מ, ש, כ) before a word still match", () => {
    expect(matchPhrase("נופש בישוב ישעי", "ישעי")).toBe("exact");
    expect(matchPhrase("מתחם צימרים · ישעי 22", "צימרים בישעי")).toBe("words");
    expect(matchPhrase("השוכן בשפלת דן בית שמש והסביבה", "בית שמש")).toBe("exact");
    // "ליד" לא מופיע בטקסט — לא נחשב
    expect(matchPhrase("השוכן בשפלת דן בית שמש והסביבה", "ליד בית שמש")).toBe("none");
    expect(matchPhrase("ממוקם ליד בית שמש", "צימר ליד בית שמש")).toBe("none");
  });

  it("exact = in a row; words = every word somewhere (plural ↔ singular)", () => {
    expect(matchPhrase("צימר נופי דורית חוויה בכפר", "נופי דורית חוויה בכפר")).toBe("exact");
    expect(matchPhrase("צימרים נעימים בישעי", "צימר בישעי")).toBe("words");
    expect(matchPhrase("חוויה כפרית", "אירוח כפרי")).toBe("none");
    expect(matchPhrase(null, "צימר")).toBe("none");
  });

  it("counts repeats and warns about crammed titles", () => {
    expect(countPhrase("צימר בישעי | צימר בישעי", "צימר בישעי")).toBe(2);
    const list = [
      kw("kw-1", "צימר בישעי"),
      kw("kw-2", "צימר ליד בית שמש"),
      kw("kw-3", "נופי דורית"),
      kw("kw-4", "נופי דורית חוויה בכפר"),
      kw("kw-5", "צימר לזוגות"),
    ];
    // "נופי דורית" בתוך "נופי דורית חוויה בכפר" נספר פעם אחת
    expect(stuffingWarnings("נופי דורית חוויה בכפר | צימר בישעי", "", list)).toEqual([]);
    const crammed = stuffingWarnings(
      "צימר בישעי, צימר ליד בית שמש, צימר לזוגות, נופי דורית, צימר בישעי",
      "",
      list,
    );
    expect(crammed.map((w) => w.message)).toEqual([
      '"צימר בישעי" מופיע יותר מפעם אחת',
      expect.stringMatching(/^4 ביטויים/),
    ]);
  });
});

describe("the report: where each phrase appears, from what the site really shows", () => {
  const design = normalizeDesign({
    ...defaultDesign(),
    sections: defaultDesign().sections.map((s) =>
      s.type === "hero" ? { ...s, content: { title: "צימר נופי דורית חוויה בכפר" } } : s,
    ),
    seo: {
      title: "צימר נופי דורית – חוויית אירוח קסומה ומפנקת ליד בית שמש",
      keywords: [
        { text: "נופי דורית חוויה בכפר", group: "general", primary: true },
        { text: "צימר בישעי", group: "local" },
        { text: "צימר ליד בית שמש", group: "local" },
        { text: "בריכת שחייה", group: "service" },
        { text: "צימר עם סאונה", group: "service" },
      ],
    },
  });
  const { rows, home } = draftKeywordReport(site(), design);
  const by = (t: string) => rows.find((r) => r.keyword.text === t)!;

  it("uses the draft's SEO title (what Google would get after publishing)", () => {
    expect(home.title).toBe("צימר נופי דורית – חוויית אירוח קסומה ומפנקת ליד בית שמש");
  });

  it("brand phrase: in the H1 and the title → strong", () => {
    const r = by("נופי דורית חוויה בכפר");
    expect(r.status).toBe("strong");
    expect(r.home.exact).toEqual(expect.arrayContaining(["h1", "content"]));
    expect(r.fit).toBe("home");
  });

  it("local phrases that are only partly on the site → partial (all words, not in a row)", () => {
    expect(by("צימר בישעי").status).toBe("partial");
    expect(by("צימר ליד בית שמש").status).toBe("partial");
    expect(by("צימר ליד בית שמש").home.words).toContain("title");
  });

  it("service phrase found on a unit page → fits the unit pages", () => {
    const r = by("בריכת שחייה");
    expect(r.status).toBe("present");
    expect(r.units.map((u) => u.label)).toEqual(["אירוע באזור הבריכה עד 50 איש"]);
    // התיאור לגוגל של היחידה (ברירת המחדל) הוא המשפט הראשון בתיאור שלה
    expect(r.units[0]!.exact).toEqual(["description", "content"]);
    expect(r.fit).toBe("units");
  });

  it("a phrase that is not true / not on the site → missing (nothing is added for it)", () => {
    expect(by("צימר עם סאונה").status).toBe("missing");
  });
});

describe("phrases never reach visitors", () => {
  const doc = {
    ...defaultDesign(),
    seo: { title: "כותרת", keywords: [{ id: "kw-1", text: "צימר עם ביטוי סודי", group: "local" }] },
  };

  it("withoutKeywords removes only seo.keywords", () => {
    expect(withoutKeywords(doc)).toEqual({ ...defaultDesign(), seo: { title: "כותרת" } });
    expect(withoutKeywords(null)).toBeNull();
    const plain = defaultDesign();
    expect(withoutKeywords(plain)).toBe(plain);
  });

  it("the public site data (sent to the browser) has no phrases", () => {
    const raw = { ...site(), design: { ...site().design!, document: doc } };
    const pub = toPublicSite(raw as never, () => null);
    expect(pub.design!.document).not.toContain("ביטוי סודי");
    expect(pub.design!.document).not.toContain("keywords");
    expect(JSON.parse(pub.design!.document).seo).toEqual({ title: "כותרת" });
  });

  it("no keywords meta tag and no phrase in the page head, even with phrases in the document", () => {
    const s = site(doc);
    const head = JSON.stringify([siteHomeHead(s), siteUnitHead(s, s.units[0]!, "/stay/units/x")]);
    expect(head).not.toContain("keywords");
    expect(head).not.toContain("ביטוי סודי");
  });
});

describe("structured data and unit titles: only real data, no repeats", () => {
  it("priceRange leaves out units without a base price (no '0–4000')", () => {
    const ld = siteHomeHead(site()).meta.find((m) => "script:ld+json" in m) as unknown as {
      "script:ld+json": { priceRange?: string };
    };
    expect(ld["script:ld+json"].priceRange).toBe("1400–4000 ILS");
  });

  it("unit title: 'unit | business', without the business name twice", () => {
    expect(unitDefaultTitle("גן עדן VIP", "נופי דורית חוויה בכפר")).toBe(
      "גן עדן VIP | נופי דורית חוויה בכפר",
    );
    expect(unitDefaultTitle("כל המתחם — נופי דורית חוויה בכפר", "נופי דורית חוויה בכפר")).toBe(
      "כל המתחם — נופי דורית חוויה בכפר",
    );
    const s = site();
    const title = siteUnitHead(s, s.units[2]!, "/stay/units/x").meta.find((m) => "title" in m);
    expect(title).toEqual({ title: "כל המתחם — נופי דורית חוויה בכפר" });
  });
});

describe("the nofi-dorit starter list (scripts/hospitality/seo-keywords-nofi-dorit.sql)", () => {
  const sql = readFileSync("scripts/hospitality/seo-keywords-nofi-dorit.sql", "utf8");
  const json = /-- BEGIN KEYWORDS[\s\S]*?\$k\$([\s\S]*?)\$k\$[\s\S]*?-- END KEYWORDS/.exec(
    sql,
  )![1]!;
  const list = JSON.parse(json) as unknown[];

  it("is exactly the 10 phrases asked for, all valid as they are, no pool / luxury claims", () => {
    expect(normalizeKeywords(list)).toEqual(list);
    expect((list as SeoKeyword[]).map((k) => k.text)).toEqual([
      "צימר ליד בית שמש",
      "צימרים ליד בית שמש",
      "נופי דורית",
      "נופי דורית חוויה בכפר",
      "צימר בישעי",
      "צימרים בישעי",
      "צימר לזוגות ליד בית שמש",
      "צימר למשפחות ליד בית שמש",
      "חופשה זוגית ליד בית שמש",
      "אירוח כפרי באזור בית שמש",
    ]);
    expect(json).not.toMatch(/בריכה|יוקרתי|ג.קוזי/);
  });

  it("writes the draft only — never publishes", () => {
    expect(sql).toContain("hospitality.site_draft_save(");
    expect(sql).not.toMatch(/site_publish\s*\(/);
    expect(sql).not.toMatch(
      /INSERT INTO hospitality\.site_versions|UPDATE hospitality\.site_versions/,
    );
  });
});
