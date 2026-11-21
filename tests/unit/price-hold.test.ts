// מחיר של אורח מה-HTML שנבנה בשרת — לא מוצג למי שמחובר עד שהמחירון שלו נטען (src/lib/price-hold.ts):
// הסקריפט ב-<head> מזהה התחברות שמורה רק לפי שם המפתח של Supabase, ובלי לגעת בערכים; המחירים מסומנים
// data-price="hold" רק כל עוד העמוד לא טרי; כלל ה-CSS מסתיר רק אצל מי שמחובר.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PriceHoldProvider,
  SIGNED_IN_ATTR,
  SIGNED_IN_HINT_SCRIPT,
  usePriceAttr,
} from "@/lib/price-hold";

/** מריץ את הסקריפט מול localStorage ו-<html> מדומים */
function runHint(keys: string[], opts: { throws?: boolean } = {}) {
  const attrs = new Map<string, string>();
  const read: string[] = [];
  const storage = {
    get length() {
      if (opts.throws) throw new Error("SecurityError: storage is blocked");
      return keys.length;
    },
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => {
      read.push(k);
      return "secret";
    },
  };
  const document = {
    documentElement: { setAttribute: (name: string, value: string) => attrs.set(name, value) },
  };
  new Function("localStorage", "document", SIGNED_IN_HINT_SCRIPT)(storage, document);
  return { signedIn: attrs.has(SIGNED_IN_ATTR), read };
}

describe("the signed-in hint in <head> (before the first paint)", () => {
  it("marks <html> when a Supabase session is saved in the browser", () => {
    expect(runHint(["theme", "sb-127-auth-token"]).signedIn).toBe(true);
    expect(runHint(["sb-api-auth-token"]).signedIn).toBe(true);
  });

  it("no session saved → nothing marked (a guest — and Google — see the prices right away)", () => {
    expect(runHint([]).signedIn).toBe(false);
    expect(runHint(["cart", "sb-127-auth-token-code-verifier", "nuriel-consent"]).signedIn).toBe(
      false,
    );
  });

  it("reads key names only, never the values (the token)", () => {
    expect(runHint(["sb-127-auth-token"]).read).toEqual([]);
  });

  it("blocked storage (private mode / blocked site data) → no error, nothing marked", () => {
    expect(runHint(["sb-127-auth-token"], { throws: true }).signedIn).toBe(false);
  });
});

describe("price elements while the signed-in visitor's catalog is still loading", () => {
  function Price() {
    return createElement("span", { "data-price": usePriceAttr() }, "50.00");
  }
  it('data-price="hold" only inside a page that is not fresh yet', () => {
    expect(
      renderToStaticMarkup(createElement(PriceHoldProvider, { value: true }, createElement(Price))),
    ).toBe('<span data-price="hold">50.00</span>');
    expect(
      renderToStaticMarkup(
        createElement(PriceHoldProvider, { value: false }, createElement(Price)),
      ),
    ).toBe('<span data-price="">50.00</span>');
  });
  it("outside a store page (admin, POS, checkout) — never held", () => {
    expect(renderToStaticMarkup(createElement(Price))).toBe('<span data-price="">50.00</span>');
  });
});

describe("the CSS rule", () => {
  it("hides held prices only for a signed-in visitor, without changing the layout", () => {
    const css = readFileSync("src/styles.css", "utf8").replace(/\s+/g, " ");
    expect(css).toContain('html[data-signed-in] [data-price="hold"] { visibility: hidden; }');
  });
});
