// GA4 בהגדרות העסק (מיגרציה 199): רק מזהה מדידה נכנס (אותה תבנית בשרת, במסך, בעורך ובמסד), ו-gtag.js של
// אותו מזהה נטען פעם אחת בדף — גם כשמוגדר גם Google Tag Manager. חלון ומסמך מדומים — בלי רשת ובלי Google.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GA4_ID_FORMAT,
  GtmInputError,
  isGa4Id,
  normalizeGa4Id,
} from "../../src/platform/analytics/gtm";
import { GA4_ID } from "../../src/engines/hospitality/website/design/schema";

describe("GA4 ID: only a measurement ID gets in", () => {
  it("accepts G-XXXXXXXXXX — trimmed and uppercased; empty clears", () => {
    expect(normalizeGa4Id("G-AB12CD34EF")).toBe("G-AB12CD34EF");
    expect(normalizeGa4Id("  g-ab12cd34ef ")).toBe("G-AB12CD34EF");
    expect(normalizeGa4Id("G-ABCD")).toBe("G-ABCD");
    expect(normalizeGa4Id("G-ABCDEFGHIJKLMNOP")).toBe("G-ABCDEFGHIJKLMNOP");
    expect(normalizeGa4Id("")).toBeNull();
    expect(normalizeGa4Id("   ")).toBeNull();
    expect(normalizeGa4Id(null)).toBeNull();
    expect(normalizeGa4Id(undefined)).toBeNull();
  });

  it("refuses scripts, HTML, Tag Manager / Universal Analytics / Ads IDs and bad lengths — with a clear message", () => {
    for (const value of [
      "<script>alert(1)</script>",
      'G-ABC123"><script>',
      "G-AB1",
      "G-ABCDEFGHIJKLMNOPQ",
      "GTM-ABC1234",
      "UA-12345-1",
      "AW-123456789",
      "G_ABC12345",
      "G-ABC 12345",
      "javascript:alert(1)",
      "G-ÄBC12345",
    ]) {
      expect(() => normalizeGa4Id(value), value).toThrow(GtmInputError);
      expect(() => normalizeGa4Id(value), value).toThrow(/G-XXXXXXXXXX/);
      expect(isGa4Id(value), value).toBe(false);
    }
  });

  it("one format everywhere: the zimmer website schema uses the platform's", () => {
    expect(GA4_ID).toBe(GA4_ID_FORMAT);
    expect(GA4_ID_FORMAT.source).toBe("^G-[A-Z0-9]{4,16}$");
  });
});

// ---------------------------------------------------------------- the browser part (consent/ga.ts)
type FakeScript = { src: string; async: boolean; dataset: Record<string, string> };
let win: { dataLayer?: unknown[]; gtag?: unknown; location: Partial<Location> };
let inPage: FakeScript[];

const entries = () =>
  (win.dataLayer ?? []).map((e) => Array.from(e as ArrayLike<unknown>)) as unknown[][];
const gtagScripts = (id: string) =>
  inPage.filter((s) => s.src === `https://www.googletagmanager.com/gtag/js?id=${id}`);

async function freshGa() {
  vi.resetModules();
  return import("../../src/engines/hospitality/website/consent/ga");
}

beforeEach(() => {
  inPage = [];
  win = {
    location: {
      href: "https://nofi.example/stay?x=1#t=secret",
      hostname: "nofi.example",
      protocol: "https:",
      pathname: "/stay",
    },
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    title: "צימר",
    cookie: "",
    createElement: () => ({ src: "", async: false, dataset: {} }) as FakeScript,
    head: { appendChild: (s: FakeScript) => inPage.push(s) },
    querySelectorAll: () => inPage,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GA4 in the page: once, after consent, ads always denied", () => {
  it("consent default (all denied) comes before the update, which grants measurement only", async () => {
    const ga = await freshGa();
    ga.grantAnalytics("G-AB12CD34EF");
    const consent = entries().filter((e) => e[0] === "consent");
    expect(consent[0]).toEqual([
      "consent",
      "default",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      },
    ]);
    expect(consent[1]).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(gtagScripts("G-AB12CD34EF")).toHaveLength(1);
  });

  it("granting again (another page, or the banner twice) never adds a second gtag.js", async () => {
    const ga = await freshGa();
    ga.grantAnalytics("G-AB12CD34EF");
    ga.grantAnalytics("G-AB12CD34EF");
    expect(gtagScripts("G-AB12CD34EF")).toHaveLength(1);
    expect(entries().filter((e) => e[0] === "config")).toHaveLength(1);
  });

  it("GA4 + Tag Manager: when gtag.js of the same ID is already in the page (loaded by the container), it is not loaded again", async () => {
    inPage.push({
      src: "https://www.googletagmanager.com/gtag/js?id=G-AB12CD34EF&l=dataLayer&cx=c",
      async: true,
      dataset: {},
    });
    const ga = await freshGa();
    expect(ga.gtagScriptInPage("G-AB12CD34EF")).toBe(true);
    expect(ga.gtagScriptInPage("G-OTHER1234")).toBe(false);
    ga.grantAnalytics("G-AB12CD34EF");
    expect(inPage).toHaveLength(1);
    // the configuration still goes into the shared dataLayer, so the tag in the page reads it
    expect(entries().some((e) => e[0] === "config" && e[1] === "G-AB12CD34EF")).toBe(true);
  });

  it("the page address sent to Google has no # (personal links) and no non-campaign query", async () => {
    const ga = await freshGa();
    ga.grantAnalytics("G-AB12CD34EF");
    const config = entries().find((e) => e[0] === "config");
    expect((config?.[2] as { page_location: string }).page_location).toBe(
      "https://nofi.example/stay",
    );
  });
});
