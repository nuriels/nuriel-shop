import { describe, expect, it } from "vitest";
import { GscCsvError, parseCsv, parseGscCsv } from "@/platform/seo/gsc/csv";
import { findOpportunities, totals } from "@/platform/seo/gsc/opportunities";
import { matchProperty } from "@/platform/seo/gsc/api.server";
import {
  classifyIntent,
  mergeIdeas,
  normalizePhrase,
  ownKeywordKind,
  seedKeywords,
  stuffingCount,
} from "@/platform/seo/keywords";

describe("Search Console CSV import", () => {
  it("parses quoted CSV with BOM, CRLF and doubled quotes", () => {
    expect(parseCsv('﻿a,"b ""q"", c"\r\n1,2\r\n')).toEqual([
      ["a", 'b "q", c'],
      ["1", "2"],
    ]);
  });

  it("reads the Hebrew UI export (queries), percent CTR, thousands separators", () => {
    const csv =
      'שאילתות מובילות,קליקים,חשיפות,שיעור קליקים (CTR),מיקום\nנופי דורית,120,"1,500",8%,1.4\nצימר ליד בית שמש,3,410,0.73%,9.2\n';
    const r = parseGscCsv(csv);
    expect(r.dimension).toBe("query");
    expect(r.rows).toEqual([
      { key: "נופי דורית", clicks: 120, impressions: 1500, ctr: 0.08, position: 1.4 },
      { key: "צימר ליד בית שמש", clicks: 3, impressions: 410, ctr: 0.0073, position: 9.2 },
    ]);
  });

  it("reads the English pages export and skips impossible rows (clicks > impressions)", () => {
    const r = parseGscCsv(
      "Top pages,Clicks,Impressions,CTR,Position\nhttps://a/x,5,100,5%,3\nhttps://a/y,50,10,1%,2\n",
    );
    expect(r.dimension).toBe("page");
    expect(r.rows).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it("refuses a file that is not a Search Console export", () => {
    expect(() => parseGscCsv("name,price\nx,1\n")).toThrow(GscCsvError);
  });
});

describe("opportunities — real numbers only", () => {
  const rows = [
    { key: "צימר בישעי", clicks: 2, impressions: 400, ctr: 0.005, position: 4 },
    { key: "צימר לכלה ליד בית שמש", clicks: 1, impressions: 90, ctr: 0.011, position: 12 },
    { key: "נופי דורית", clicks: 80, impressions: 300, ctr: 0.27, position: 1.1 },
  ];
  it("finds low CTR on page one, striking distance, drops and queries missing from the keyword list", () => {
    const ops = findOpportunities(rows, {
      previous: [{ key: "נופי דורית", clicks: 150, impressions: 400, ctr: 0.37, position: 1 }],
      knownKeywords: ["נופי דורית"],
    });
    const kinds = ops.map((o) => `${o.kind}:${o.key}`);
    expect(kinds).toContain("low_ctr:צימר בישעי");
    expect(kinds).toContain("striking_distance:צימר לכלה ליד בית שמש");
    expect(kinds).toContain("drop:נופי דורית");
    expect(kinds).toContain("new_query:צימר בישעי");
    expect(kinds).not.toContain("new_query:נופי דורית");
  });
  it("totals weight the average position by impressions, like Search Console", () => {
    const t = totals(rows);
    expect(t.clicks).toBe(83);
    expect(t.impressions).toBe(790);
    expect(Number(t.position.toFixed(2))).toBe(
      Number(((4 * 400 + 12 * 90 + 1.1 * 300) / 790).toFixed(2)),
    );
  });
});

describe("Search Console property matching", () => {
  it("prefers the exact URL-prefix property, else a domain property that covers the host", () => {
    const sites = [
      { siteUrl: "sc-domain:nuri1.fit" },
      { siteUrl: "https://nofi-dorit.nuri1.fit/" },
    ];
    expect(matchProperty("https://nofi-dorit.nuri1.fit", sites)).toBe(
      "https://nofi-dorit.nuri1.fit/",
    );
    expect(matchProperty("https://other.nuri1.fit", sites)).toBe("sc-domain:nuri1.fit");
    expect(matchProperty("https://shop.example.com", sites)).toBeNull();
  });
});

describe("keyword ideas", () => {
  const facts = {
    engine: "hospitality" as const,
    name: "נופי דורית",
    places: ["ישעי", "בית שמש"],
    categories: ["צימר"],
    offerings: ["גן עדן VIP", "חבילת כלה"],
    audiences: ["כלה", "משפחות"],
  };
  it("seeds only from real facts, labelled as template ideas without numbers", () => {
    const ideas = seedKeywords(facts);
    const phrases = ideas.map((i) => i.phrase);
    expect(phrases).toContain("נופי דורית");
    expect(phrases).toContain("צימר נופי דורית");
    expect(phrases).toContain("צימר ליד בית שמש");
    expect(phrases).toContain("צימר לכלה");
    expect(ideas.every((i) => i.source === "template")).toBe(true);
    expect(ideas.some((i) => /הכי|זול|מקום ראשון/.test(i.phrase))).toBe(false);
    expect(ideas.every((i) => !("volume" in i))).toBe(true);
  });
  it("classifies intent: brand, question, transactional, local", () => {
    expect(classifyIntent("נופי דורית חוויה בכפר", facts)).toBe("navigational");
    expect(classifyIntent("איפה יש צימר עם בריכה")).toBe("informational");
    expect(classifyIntent("הזמנת צימר לסוף שבוע")).toBe("transactional");
    expect(classifyIntent("צימר ליד בית שמש", facts)).toBe("local");
  });
  it("merges sources (owner > gsc > ai > template) and detects stuffing", () => {
    const merged = mergeIdeas(
      [{ phrase: "צימר בישעי", kind: "local", intent: "local", source: "template", reason: "" }],
      [{ phrase: "צימר בישעי ", kind: "local", intent: "local", source: "owner", reason: "" }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe("owner");
    expect(normalizePhrase("  צימר, ")).toBe("צימר");
    expect(stuffingCount("צימר בישעי | צימר בישעי זוגי | צימר בישעי", "צימר בישעי")).toBe(3);
  });
});

describe("the owner's own phrases (the Nofi Dorit pilot list)", () => {
  const name = "נופי דורית";
  const kinds = (p: string) => [ownKeywordKind(p, name), classifyIntent(p, { name, places: [] })];
  it("a phrase with the business name is the brand (navigational)", () => {
    expect(kinds("נופי דורית")).toEqual(["brand", "navigational"]);
    expect(kinds("צימר נופי דורית")).toEqual(["brand", "navigational"]);
    expect(kinds("נופי דורית חוויה בכפר")).toEqual(["brand", "navigational"]);
  });
  it("local, long and plain phrases — from their own words, nothing invented", () => {
    expect(kinds("צימרים ליד בית שמש")).toEqual(["local", "local"]);
    expect(kinds("צימר לכלה ליד בית שמש")).toEqual(["local", "local"]);
    expect(kinds("מתחם אירוח למשפחות באזור בית שמש")).toEqual(["local", "local"]);
    expect(ownKeywordKind("מקום להתארגנות כלה", name)).toBe("primary");
    expect(ownKeywordKind("איך בוחרים צימר לכלה", name)).toBe("question");
    expect(ownKeywordKind("מחיר צימר לזוג", name)).toBe("transactional");
    expect(ownKeywordKind("צימר זוגי עם בריכה פרטית מחוממת", name)).toBe("long_tail");
    // without a business name nothing is called "brand"
    expect(ownKeywordKind("נופי דורית", null)).toBe("primary");
  });
});
