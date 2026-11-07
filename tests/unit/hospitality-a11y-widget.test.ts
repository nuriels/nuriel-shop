// כפתור הנגישות של אתר האירוח: ההעדפות שנקראות מהדפדפן, צעדי גודל הטקסט, המחלקות על <html>,
// הסקריפט המוקדם (אותן מחלקות בדיוק, ושקט כשהאחסון חסום), ה-CSS — ושאין בטקסטים הצהרת עמידה בתקן.
import { describe, expect, it } from "vitest";
import {
  A11Y_BOOTSTRAP,
  A11Y_CLASSES,
  A11Y_CSS,
  A11Y_STORAGE_KEY,
  A11Y_TOGGLES,
  DEFAULT_PREFS,
  TEXT_STEPS,
  applyPrefs,
  isAnyActive,
  normalizePrefs,
  stepText,
  type A11yPrefs,
} from "@/engines/hospitality/website/a11y/prefs";
import { he } from "@/engines/hospitality/website/copy/he";

/** אלמנט מדומה: רק classList.toggle / contains */
function fakeEl() {
  const set = new Set<string>();
  return {
    set,
    classList: {
      toggle: (c: string, on?: boolean) => {
        const v = on ?? !set.has(c);
        if (v) set.add(c);
        else set.delete(c);
        return v;
      },
      contains: (c: string) => set.has(c),
    },
  };
}

/** מריץ את הסקריפט המוקדם מול אחסון ומסמך מדומים */
function runBootstrap(stored: string | null | (() => never)) {
  const html = fakeEl();
  const localStorage = {
    getItem: (k: string) => {
      if (typeof stored === "function") stored();
      return k === A11Y_STORAGE_KEY ? (stored as string | null) : null;
    },
  };
  new Function("localStorage", "document", A11Y_BOOTSTRAP)(localStorage, {
    documentElement: html,
  });
  return html.set;
}

const prefs = (over: Partial<A11yPrefs> = {}): A11yPrefs => ({ ...DEFAULT_PREFS, ...over });

describe("the saved preferences", () => {
  it("anything unknown → the default (another version, a bad size, a non-boolean switch)", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs("x")).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ v: 2, text: 150, contrast: true })).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ v: 1, text: 999, contrast: "yes", links: 1 })).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ v: 1, text: 130, contrast: true, focus: true })).toEqual(
      prefs({ text: 130, contrast: true, focus: true }),
    );
  });
  it("text size: one step up / down, staying at the ends", () => {
    expect(TEXT_STEPS[0]).toBeLessThan(100);
    expect(stepText(100, 1)).toBe(115);
    expect(stepText(100, -1)).toBe(90);
    expect(stepText(90, -1)).toBe(90);
    expect(stepText(150, 1)).toBe(150);
    expect(isAnyActive(DEFAULT_PREFS)).toBe(false);
    expect(isAnyActive(prefs({ text: 90 }))).toBe(true);
    expect(isAnyActive(prefs({ motion: true }))).toBe(true);
  });
});

describe("the classes on <html>", () => {
  it("each preference → its own hosp-a11y-* class (not the stores' a11y-* classes)", () => {
    const el = fakeEl();
    applyPrefs(el as unknown as HTMLElement, prefs({ text: 130, contrast: true, cursor: true }));
    expect([...el.set].sort()).toEqual([
      "hosp-a11y-contrast",
      "hosp-a11y-cursor",
      "hosp-a11y-text-130",
    ]);
    applyPrefs(el as unknown as HTMLElement, DEFAULT_PREFS);
    expect(el.set.size).toBe(0);
    for (const c of A11Y_CLASSES) expect(c).toMatch(/^hosp-a11y-/);
  });
  it("the early script sets exactly the same classes as the widget — for every combination", () => {
    for (const text of TEXT_STEPS)
      for (let mask = 0; mask < 1 << A11Y_TOGGLES.length; mask++) {
        const p = prefs({ text });
        A11Y_TOGGLES.forEach((k, i) => (p[k] = (mask & (1 << i)) !== 0));
        const el = fakeEl();
        applyPrefs(el as unknown as HTMLElement, p);
        expect(runBootstrap(JSON.stringify(p))).toEqual(el.set);
      }
  });
  it("the early script: nothing saved / broken JSON / another version / storage blocked — no class, no error", () => {
    expect(runBootstrap(null).size).toBe(0);
    expect(runBootstrap("{oops").size).toBe(0);
    expect(runBootstrap(JSON.stringify({ v: 2, contrast: true })).size).toBe(0);
    expect(
      runBootstrap(() => {
        throw new Error("SecurityError");
      }).size,
    ).toBe(0);
  });
});

describe("the CSS", () => {
  it("every class has a rule; no filter on the page (it breaks fixed elements); print at normal size", () => {
    for (const c of A11Y_CLASSES) expect(A11Y_CSS).toContain(`html.${c}`);
    expect(A11Y_CSS).not.toMatch(/filter:\s*(invert|contrast|grayscale)/);
    expect(A11Y_CSS).toContain("@media print");
    // ניגודיות גבוהה: גם במגירות שמחוץ למעטפת האתר
    expect(A11Y_CSS).toContain("[data-site-vars]");
  });
});

describe("the texts", () => {
  it("a preferences tool — no claim that the site meets the standard", () => {
    const text = JSON.stringify(he.a11y);
    for (const claim of ["עומד בתקן", "עומד בדרישות", "תואם לתקן", "נגיש במלואו", "5568", "WCAG"])
      expect(text).not.toContain(claim);
    expect(he.a11y.intro).toContain("בדפדפן הזה");
    expect(he.a11y.keys.map(([k]) => k)).toContain("Alt+A");
  });
});
