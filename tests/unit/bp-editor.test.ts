// Nuriel Websites (business_profile) — Stage 2: פעולות העורך על המסמך, ניגודיות צבעים, ותבניות הצבעים
import { describe, expect, it } from "vitest";
import { initialDocument } from "@/engines/business-profile/document/defaults";
import { normalizeDocument } from "@/engines/business-profile/document/normalize";
import { MAX_BLOCKS_PER_PAGE, type SiteDocument } from "@/engines/business-profile/document/schema";
import {
  addBlock,
  homePage,
  moveBlock,
  moveItem,
  newId,
  removeBlock,
  setBlockHidden,
  setBlockProp,
  setHe,
} from "@/engines/business-profile/studio/editor/doc-ops";
import {
  AA,
  contrastRatio,
  paletteProblems,
} from "@/engines/business-profile/studio/editor/contrast";
import { TEMPLATE_PALETTES } from "@/engines/business-profile/templates/palettes";

const doc = (): SiteDocument => initialDocument("elegant", "סטודיו לבדיקה");
const ids = (d: SiteDocument) => homePage(d).blocks.map((b) => b.id);

describe("editor document operations (pure — the original is never changed)", () => {
  it("moves a block up and down, and ignores a move past either end", () => {
    const d = doc();
    const before = ids(d);
    const second = before[1]!;
    const up = moveBlock(d, second, -1);
    expect(ids(up).slice(0, 2)).toEqual([second, before[0]]);
    expect(ids(d)).toEqual(before);
    expect(ids(moveBlock(d, before[0]!, -1))).toEqual(before);
    expect(ids(moveBlock(d, before.at(-1)!, 1))).toEqual(before);
    expect(ids(moveBlock(d, "missing", 1))).toEqual(before);
  });

  it("hides, shows and removes a block", () => {
    const d = doc();
    const id = ids(d)[1]!;
    const hidden = setBlockHidden(d, id, true);
    expect(homePage(hidden).blocks.find((b) => b.id === id)!.hidden).toBe(true);
    expect(homePage(d).blocks.find((b) => b.id === id)!.hidden).toBe(false);
    expect(
      homePage(setBlockHidden(hidden, id, false)).blocks.find((b) => b.id === id)!.hidden,
    ).toBe(false);
    expect(ids(removeBlock(d, id))).not.toContain(id);
  });

  it("sets one prop without touching the others", () => {
    const d = doc();
    const hero = homePage(d).blocks.find((b) => b.type === "hero")!;
    const next = setBlockProp(d, hero.id, "title", { he: "כותרת חדשה" });
    const after = homePage(next).blocks.find((b) => b.id === hero.id)!;
    expect(after.props["title"]).toEqual({ he: "כותרת חדשה" });
    expect(Object.keys(after.props).sort()).toEqual(Object.keys(hero.props).sort());
  });

  it("adds a block with a unique id and the block's defaults; stops at the page limit", () => {
    const d = doc();
    const one = addBlock(d, "text");
    const two = addBlock(one, "text");
    const added = ids(two).filter((x) => x.startsWith("text"));
    expect(new Set(added).size).toBe(added.length);
    expect(homePage(two).blocks.at(-1)!.type).toBe("text");
    // the result is still a valid document (normalize keeps every block)
    expect(ids(normalizeDocument(two))).toEqual(ids(two));
    let full = d;
    for (let i = 0; i < MAX_BLOCKS_PER_PAGE + 5; i++) full = addBlock(full, "text");
    expect(homePage(full).blocks.length).toBe(MAX_BLOCKS_PER_PAGE);
  });

  it("new list ids are unique; moving an item keeps every item", () => {
    expect(newId("service", [{ id: "service-1" }, { id: "service-3" }])).toBe("service-4");
    const taken = [{ id: "work-1" }, { id: "work-2" }, { id: "work-3" }];
    const id = newId("work", taken);
    expect(taken.map((t) => t.id)).not.toContain(id);
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  });

  it("editing the Hebrew keeps an English text that was entered", () => {
    expect(setHe({ he: "שלום", en: "Hello" }, "היי")).toEqual({ he: "היי", en: "Hello" });
    expect(setHe(undefined, "חדש")).toEqual({ he: "חדש" });
  });
});

describe("color contrast (IS 5568 / WCAG AA 4.5:1)", () => {
  it("computes the WCAG ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBe(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });

  it("the built-in palettes of both templates pass every pair", () => {
    expect(paletteProblems(TEMPLATE_PALETTES.elegant)).toEqual([]);
    expect(paletteProblems(TEMPLATE_PALETTES.portfolio)).toEqual([]);
  });

  it("a weak pair is reported by name (the editor shows it before saving)", () => {
    const weak = { ...TEMPLATE_PALETTES.elegant, muted: "#bbbbbb" };
    const problems = paletteProblems(weak);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.ratio < AA)).toBe(true);
    expect(problems.map((p) => p.pair)).toContain("טקסט משני על הרקע");
  });
});
