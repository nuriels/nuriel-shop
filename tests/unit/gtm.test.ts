// Google Tag Manager (מיגרציה 192): המזהה בלבד, כתובת עמוד נקייה, Consent Mode לפני הטעינה, Container
// אחד לכל דף, ואירוע צפייה אחד לכל עמוד (בלי כפילויות ב-SPA). חלון ומסמך מדומים — בלי רשת ובלי Google.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanPageLocation,
  GTM_PAGE_VIEW_EVENT,
  GtmInputError,
  gtmScriptSrc,
  isGtmId,
  normalizeGtmId,
} from "../../src/platform/analytics/gtm";

describe("GTM: only a container ID gets in", () => {
  it("accepts GTM- and 4–12 capital letters/digits; spaces and lower case are fixed; empty = remove", () => {
    expect(normalizeGtmId("GTM-AB12CD3")).toBe("GTM-AB12CD3");
    expect(normalizeGtmId("  gtm-ab12cd3 ")).toBe("GTM-AB12CD3");
    expect(normalizeGtmId("GTM-ABCD")).toBe("GTM-ABCD");
    expect(normalizeGtmId("GTM-ABCDEFGHIJKL")).toBe("GTM-ABCDEFGHIJKL");
    expect(normalizeGtmId("")).toBeNull();
    expect(normalizeGtmId("   ")).toBeNull();
    expect(normalizeGtmId(null)).toBeNull();
    expect(normalizeGtmId(undefined)).toBeNull();
  });

  it("refuses code, HTML, other Google IDs and anything outside the pattern", () => {
    const bad = [
      "<script>alert(1)</script>",
      "GTM-ABC<script>",
      '"><img src=x onerror=alert(1)>',
      "GTM-AB12CD3';alert(1);//",
      "javascript:alert(1)",
      "GTM-ABC",
      "GTM-ABCDEFGHIJKLM",
      "GTM-AB 12",
      "GTM-AB_12",
      "GTM-ÄB12",
      "G-ABCDEF1234",
      "UA-12345-1",
      "AW-123456789",
      "GT-ABCDEF",
      "GTMABCDEF",
      "https://www.googletagmanager.com/gtm.js?id=GTM-ABCDEF",
      "GTM-ABCDEF\nGTM-XYZ123",
    ];
    for (const value of bad) {
      expect(() => normalizeGtmId(value), value).toThrow(GtmInputError);
      expect(isGtmId(value), value).toBe(false);
    }
    expect(isGtmId(12345)).toBe(false);
  });

  it("the script address is only Google's fixed address, and only for a valid ID", () => {
    expect(gtmScriptSrc("GTM-AB12CD3")).toBe(
      "https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD3",
    );
    expect(gtmScriptSrc("GTM-AB12CD3&l=evil")).toBeNull();
    expect(gtmScriptSrc("gtm-ab12cd3")).toBeNull();
    expect(gtmScriptSrc("")).toBeNull();
  });
});

describe("GTM: the page address that is sent", () => {
  it("drops the # and every query parameter except utm_*", () => {
    expect(
      cleanPageLocation("https://shop.example/product/x?ref=private&utm_source=fb&email=a@b#t=1"),
    ).toBe("https://shop.example/product/x?utm_source=fb");
    expect(cleanPageLocation("https://site.example/stay/contract#t=secret-token")).toBe(
      "https://site.example/stay/contract",
    );
  });

  it("personal links are sent as a template, never with the token", () => {
    expect(cleanPageLocation("https://shop.example/checkout/grow/9f1c-order?x=1")).toBe(
      "https://shop.example/checkout/grow/:id",
    );
    expect(cleanPageLocation("https://shop.example/checkout/bit/abc")).toBe(
      "https://shop.example/checkout/bit/:id",
    );
    expect(cleanPageLocation("https://shop.example/cart/SHARE123")).toBe(
      "https://shop.example/cart/:code",
    );
    expect(cleanPageLocation("https://shop.example/order/123/receipt")).toBe(
      "https://shop.example/order/:id/receipt",
    );
    expect(cleanPageLocation("https://shop.example/license/tok_secret")).toBe(
      "https://shop.example/license/:token",
    );
    expect(cleanPageLocation("https://shop.example/sign/tok_secret")).toBe(
      "https://shop.example/sign/:token",
    );
  });

  it("caps a long campaign value; an address it cannot read gives nothing", () => {
    expect(cleanPageLocation(`https://shop.example/?utm_term=${"a".repeat(300)}`)).toBe(
      `https://shop.example/?utm_term=${"a".repeat(100)}`,
    );
    expect(cleanPageLocation("not a url")).toBe("");
  });
});

// ---------------------------------------------------------------- the browser part
type FakeScript = { src: string; async: boolean; dataset: Record<string, string> };
let win: { dataLayer?: unknown[] };
let scripts: FakeScript[];
let inPage: FakeScript[];

function entries(): unknown[][] {
  return (win.dataLayer ?? []).map((e) =>
    e && typeof e === "object" && "length" in (e as object)
      ? Array.from(e as ArrayLike<unknown>)
      : [e],
  );
}
const consentCommands = () => entries().filter((e) => e[0] === "consent");
const pageViews = () =>
  (win.dataLayer ?? []).filter(
    (e) => (e as { event?: string } | null)?.event === GTM_PAGE_VIEW_EVENT,
  ) as { page_location: string; page_title: string }[];

async function freshClient() {
  vi.resetModules();
  return import("../../src/platform/analytics/gtm-client");
}

beforeEach(() => {
  win = {};
  scripts = [];
  inPage = [];
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    createElement: () => {
      const s: FakeScript = { src: "", async: false, dataset: {} };
      scripts.push(s);
      return s;
    },
    head: { appendChild: (s: FakeScript) => inPage.push(s) },
    querySelector: (selector: string) =>
      inPage.find((s) => selector === `script[src="${s.src}"]`) ?? null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GTM in the browser: consent first, then one container", () => {
  it("nothing exists until startGtm is called (the consent manager calls it only after a yes)", async () => {
    const gtm = await freshClient();
    expect(gtm.gtmPageView("https://shop.example/", "x")).toBe(false);
    gtm.revokeGtm();
    expect(win.dataLayer).toBeUndefined();
    expect(scripts).toHaveLength(0);
    expect(gtm.gtmLoadedId()).toBeNull();
  });

  it("Consent Mode: default denied (with wait_for_update) BEFORE the update and before gtm.js", async () => {
    const gtm = await freshClient();
    expect(gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: false })).toBe(true);
    const layer = entries();
    expect(layer[0]).toEqual([
      "consent",
      "default",
      {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        wait_for_update: 500,
      },
    ]);
    expect(layer[1]).toEqual([
      "consent",
      "update",
      {
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
    expect((win.dataLayer?.[2] as { event: string }).event).toBe("gtm.js");
    expect(inPage).toHaveLength(1);
    expect(inPage[0]).toMatchObject({
      async: true,
      src: "https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD3",
      dataset: { gtm: "GTM-AB12CD3" },
    });
  });

  it("a store's single consent grants measurement and ads together", async () => {
    const gtm = await freshClient();
    gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: true });
    expect(consentCommands()[1]?.[2]).toEqual({
      analytics_storage: "granted",
      ad_storage: "granted",
      ad_user_data: "granted",
      ad_personalization: "granted",
    });
  });

  it("calling again with the same ID only updates consent — no second script, no second gtm.js", async () => {
    const gtm = await freshClient();
    gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: false });
    expect(gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: false })).toBe(true);
    expect(inPage).toHaveLength(1);
    expect(
      (win.dataLayer ?? []).filter((e) => (e as { event?: string })?.event === "gtm.js"),
    ).toHaveLength(1);
    expect(consentCommands().filter((c) => c[1] === "default")).toHaveLength(1);
  });

  it("a different container is never loaded into a page that already has one", async () => {
    const gtm = await freshClient();
    gtm.startGtm("GTM-AAAA111", { analytics: true, ads: true });
    expect(gtm.startGtm("GTM-BBBB222", { analytics: true, ads: true })).toBe(false);
    expect(inPage).toHaveLength(1);
    expect(inPage[0]?.src).toContain("GTM-AAAA111");
    expect(gtm.gtmLoadedId()).toBe("GTM-AAAA111");
  });

  it("an invalid ID loads nothing at all", async () => {
    const gtm = await freshClient();
    expect(gtm.startGtm("GTM-AB<script>", { analytics: true, ads: true })).toBe(false);
    expect(gtm.startGtm("G-ABCDEF1234", { analytics: true, ads: true })).toBe(false);
    expect(win.dataLayer).toBeUndefined();
    expect(scripts).toHaveLength(0);
  });

  it("a script already in the page (server-rendered or earlier) is not added twice", async () => {
    inPage.push({
      src: "https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD3",
      async: true,
      dataset: {},
    });
    const gtm = await freshClient();
    expect(gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: false })).toBe(true);
    expect(inPage).toHaveLength(1);
    expect(scripts).toHaveLength(0);
  });

  it("revoking sets every signal back to denied", async () => {
    const gtm = await freshClient();
    gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: true });
    gtm.revokeGtm();
    expect(consentCommands().at(-1)).toEqual([
      "consent",
      "update",
      {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
  });
});

describe("GTM in the browser: one page view per page (SPA)", () => {
  it("one nuriel_page_view per page; the same page again (re-render, non-utm param) is not sent", async () => {
    const gtm = await freshClient();
    gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: false });
    expect(gtm.gtmPageView("https://shop.example/", "בית")).toBe(true);
    expect(gtm.gtmPageView("https://shop.example/", "בית")).toBe(false);
    expect(gtm.gtmPageView("https://shop.example/?sort=price", "בית")).toBe(false);
    expect(gtm.gtmPageView("https://shop.example/#reviews", "בית")).toBe(false);
    expect(gtm.gtmPageView("https://shop.example/product/a", "מוצר")).toBe(true);
    expect(gtm.gtmPageView("https://shop.example/product/a?utm_source=fb", "מוצר")).toBe(true);
    expect(gtm.gtmPageView("https://shop.example/", "בית")).toBe(true);
    expect(pageViews().map((p) => p.page_location)).toEqual([
      "https://shop.example/",
      "https://shop.example/product/a",
      "https://shop.example/product/a?utm_source=fb",
      "https://shop.example/",
    ]);
  });

  it("the page view carries the clean address and a capped title — never a token", async () => {
    const gtm = await freshClient();
    gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: false });
    gtm.gtmPageView("https://shop.example/checkout/grow/secret-order?email=a@b#x", "ש".repeat(300));
    const [view] = pageViews();
    expect(view?.page_location).toBe("https://shop.example/checkout/grow/:id");
    expect(view?.page_title).toHaveLength(120);
    expect(JSON.stringify(win.dataLayer)).not.toContain("secret-order");
    expect(JSON.stringify(win.dataLayer)).not.toContain("a@b");
  });

  it("before the container is loaded, page views are dropped (not queued for later)", async () => {
    const gtm = await freshClient();
    expect(gtm.gtmPageView("https://shop.example/", "בית")).toBe(false);
    gtm.startGtm("GTM-AB12CD3", { analytics: true, ads: false });
    expect(pageViews()).toHaveLength(0);
  });
});
