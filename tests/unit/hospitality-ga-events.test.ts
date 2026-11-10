// Google SEO שלב 4: אירועי GA4 באתר האירוח — הכתובת הנקייה, הפריטים, ושליחה רק אחרי הסכמה
// (consent/events.ts טהור; consent/ga.ts — עם חלון ומסמך מדומים, בלי רשת ובלי הקוד של Google)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTACT_EVENT,
  checkoutParams,
  cleanPageLocation,
  contactMethodOf,
  siteItem,
} from "../../src/engines/hospitality/website/consent/events";

describe("GA4 events: the page address that is sent", () => {
  it("drops the # (the personal links live there) and every query parameter except utm_*", () => {
    expect(cleanPageLocation("https://site.example/stay/contract#t=secret-token")).toBe(
      "https://site.example/stay/contract",
    );
    expect(
      cleanPageLocation(
        "https://site.example/stay/units/x?from=2026-12-01&ref=private&utm_source=fb&utm_campaign=winter#t=1",
      ),
    ).toBe("https://site.example/stay/units/x?utm_source=fb&utm_campaign=winter");
  });

  it("caps a long campaign value and returns nothing for an address it cannot read", () => {
    const long = "a".repeat(300);
    expect(cleanPageLocation(`https://site.example/stay?utm_term=${long}`)).toBe(
      `https://site.example/stay?utm_term=${"a".repeat(100)}`,
    );
    expect(cleanPageLocation("not a url")).toBe("");
  });
});

describe("GA4 events: contact links and items", () => {
  it("knows phone, WhatsApp and email links — one event name for each, without the number itself", () => {
    expect(contactMethodOf("tel:+972501234567")).toBe("phone");
    expect(contactMethodOf(" MAILTO:a@b.example ")).toBe("email");
    expect(contactMethodOf("https://wa.me/972501234567?text=hi")).toBe("whatsapp");
    expect(contactMethodOf("https://api.whatsapp.com/send?phone=1")).toBe("whatsapp");
    expect(contactMethodOf("whatsapp://send?phone=1")).toBe("whatsapp");
    expect(contactMethodOf("https://wa.me.evil.example/x")).toBeNull();
    expect(contactMethodOf("https://site.example/stay")).toBeNull();
    expect(contactMethodOf(null)).toBeNull();
    expect(CONTACT_EVENT).toEqual({
      phone: "click_phone",
      whatsapp: "click_whatsapp",
      email: "click_email",
    });
  });

  it("an item is the public slug and name (capped), the kind, and a price only when there is one", () => {
    expect(siteItem({ slug: "tzimer-ha-ela", name: "צימר האלה" }, "unit", 600)).toEqual({
      item_id: "tzimer-ha-ela",
      item_name: "צימר האלה",
      item_category: "unit",
      price: 600,
    });
    const item = siteItem({ slug: "x".repeat(150), name: "ש".repeat(150) }, "package", null);
    expect(item.item_id).toHaveLength(100);
    expect(item.item_name).toHaveLength(100);
    expect("price" in item).toBe(false);
    expect("price" in siteItem({ slug: "a", name: "b" }, "room_type", Number.NaN)).toBe(false);
  });

  it("checkout / lead: items, total and currency only (ILS by default)", () => {
    const items = [siteItem({ slug: "a", name: "A" }, "unit", 500)];
    expect(checkoutParams(items, 1200, "usd")).toEqual({ currency: "USD", value: 1200, items });
    expect(checkoutParams(items, null, null)).toEqual({ currency: "ILS", items });
    expect(checkoutParams(items, Number.NaN, "")).toEqual({ currency: "ILS", items });
  });
});

// ---- consent/ga.ts: a fake browser window --------------------------------------------------------

type Layer = IArguments[];
interface FakeWindow {
  location: { href: string; pathname: string; protocol: string; hostname: string };
  dataLayer?: Layer;
  gtag?: (...args: unknown[]) => void;
}
let win: FakeWindow;
let written: string[];
let scripts: { src: string; async: boolean; dataset: Record<string, string> }[];

function go(href: string) {
  const u = new URL(href);
  win.location = { href, pathname: u.pathname, protocol: u.protocol, hostname: u.hostname };
}

function layer(): unknown[][] {
  return (win.dataLayer ?? []).map((a) => Array.from(a));
}
const events = () => layer().filter((a) => a[0] === "event");

async function freshGa() {
  vi.resetModules();
  return import("../../src/engines/hospitality/website/consent/ga");
}

beforeEach(() => {
  written = [];
  scripts = [];
  win = { location: { href: "", pathname: "", protocol: "https:", hostname: "" } };
  go("https://site.example/stay");
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    title: "נופי האלה",
    get cookie() {
      return "_ga=GA1.1.1.2; _ga_E2ETEST123=GS1; hosp_consent=x";
    },
    set cookie(v: string) {
      written.push(v);
    },
    createElement: () => {
      const s = { src: "", async: false, dataset: {} as Record<string, string> };
      scripts.push(s);
      return s;
    },
    head: { appendChild: () => undefined },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GA4 in the browser: nothing before consent", () => {
  it("before the consent manager decides — nothing is kept, nothing is created", async () => {
    const ga = await freshGa();
    ga.gaEvent("view_item", { items: [] });
    ga.gaPageView();
    expect(win.dataLayer).toBeUndefined();
    expect(scripts).toHaveLength(0);
  });

  it("no measurement on the site, or the visitor said no — events are dropped, Google is never loaded", async () => {
    const ga = await freshGa();
    ga.armAnalytics(true);
    ga.gaPageView();
    ga.gaEvent("click_phone", { link_location: "header" });
    ga.armAnalytics(false); // סירוב / אתר בלי מדידה — מה שנשמר נמחק
    ga.gaEvent("click_email", {});
    expect(win.dataLayer).toBeUndefined();
    expect(scripts).toHaveLength(0);
  });
});

describe("GA4 in the browser: after consent", () => {
  it("accept: Consent Mode with ads denied, then the page's own events — page view first, clean address", async () => {
    const ga = await freshGa();
    go("https://site.example/stay/units/ha-ela?ref=private&utm_source=fb#t=secret");
    ga.armAnalytics(true);
    // אירוע של העמוד שקדם לצפייה (סדר האפקטים) — נשמר, והצפייה נשלחת לפניו
    ga.gaEvent("view_item", { currency: "ILS", value: 600, items: [] });
    ga.gaPageView();
    expect(win.dataLayer).toBeUndefined();

    ga.grantAnalytics("G-E2ETEST123");
    const all = layer();
    expect(all[0]).toEqual([
      "consent",
      "default",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      },
    ]);
    expect(all[1]).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    const config = all.find((a) => a[0] === "config") as [string, string, Record<string, unknown>];
    expect(config[1]).toBe("G-E2ETEST123");
    expect(config[2]).toMatchObject({
      cookie_domain: "site.example",
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: "https://site.example/stay/units/ha-ela?utm_source=fb",
    });
    expect(scripts.map((s) => s.src)).toEqual([
      "https://www.googletagmanager.com/gtag/js?id=G-E2ETEST123",
    ]);
    const sent = events();
    expect(sent.map((e) => e[1])).toEqual(["page_view", "view_item"]);
    for (const e of sent)
      expect((e[2] as Record<string, unknown>)["page_location"]).toBe(
        "https://site.example/stay/units/ha-ela?utm_source=fb",
      );
    expect(JSON.stringify(all)).not.toMatch(/secret|private/);
  });

  it("moving to another page before the choice drops the previous page's events, keeps this page's", async () => {
    const ga = await freshGa();
    ga.armAnalytics(true);
    ga.gaPageView(); // /stay
    ga.gaEvent("click_whatsapp", { link_location: "page" });
    go("https://site.example/stay/units/ha-ela");
    ga.gaPageView();
    ga.gaEvent("view_item", { items: [] });
    ga.grantAnalytics("G-E2ETEST123");
    const sent = events();
    expect(sent.map((e) => e[1])).toEqual(["page_view", "view_item"]);
    expect((sent[0]![2] as Record<string, unknown>)["page_location"]).toBe(
      "https://site.example/stay/units/ha-ela",
    );
  });

  it("after consent: every event goes out at once with the address of the page it happened on", async () => {
    const ga = await freshGa();
    ga.armAnalytics(true);
    ga.grantAnalytics("G-E2ETEST123");
    go("https://site.example/stay/book?unit=x#t=abc");
    ga.gaPageView();
    ga.gaEvent("begin_checkout", { currency: "ILS", value: 1200, items: [] });
    const sent = events();
    expect(sent.map((e) => e[1])).toEqual(["page_view", "begin_checkout"]);
    for (const e of sent)
      expect((e[2] as Record<string, unknown>)["page_location"]).toBe(
        "https://site.example/stay/book",
      );
    // טעינה אחת של הקוד, גם באישור נוסף
    ga.grantAnalytics("G-E2ETEST123");
    expect(scripts).toHaveLength(1);
  });

  it("withdrawal: Consent Mode back to denied, the measurement cookies deleted, nothing more is sent", async () => {
    const ga = await freshGa();
    ga.armAnalytics(true);
    ga.grantAnalytics("G-E2ETEST123");
    ga.denyAnalytics();
    expect(layer().at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    expect(written).toEqual([
      "_ga=; Path=/; Max-Age=0",
      "_ga=; Path=/; Domain=site.example; Max-Age=0",
      "_ga_E2ETEST123=; Path=/; Max-Age=0",
      "_ga_E2ETEST123=; Path=/; Domain=site.example; Max-Age=0",
    ]);
    const before = layer().length;
    ga.gaEvent("click_phone", {});
    ga.gaPageView();
    expect(layer()).toHaveLength(before);
  });

  it("keeps at most 20 events for a page while waiting", async () => {
    const ga = await freshGa();
    ga.armAnalytics(true);
    for (let i = 0; i < 30; i++) ga.gaEvent("click_phone", { n: i });
    ga.gaPageView();
    ga.grantAnalytics("G-E2ETEST123");
    const sent = events();
    expect(sent).toHaveLength(20);
    expect(sent[0]![1]).toBe("page_view");
  });
});
