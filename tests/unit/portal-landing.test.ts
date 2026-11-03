// דף הנחיתה של נוריאל מחשבים (שער הפלטפורמה): התוכן, שתי תקופות הניסיון הנפרדות, המחירים
// מהנתונים (לא מספרים קבועים), JSON-LD, llms.txt והמסלול בחלון הכניסה.
import { describe, expect, it } from "vitest";
import {
  COMPUTER_GROUPS,
  CONTACT_TOPICS,
  HOSPITALITY_PRODUCT,
  LANDING_TITLE,
  NURIEL_BUSINESS,
  STORE_DEMO_URL,
  ZIMMER_DEMO_URL,
  commonSetupFee,
  contactMessage,
  landingDescription,
  landingFaq,
  landingJsonLd,
  landingLlmsTxt,
  shekels,
  storeCategoryUrl,
  storePlanFit,
  trialCta,
  whatsappHref,
  zimmerPlanFit,
  type LandingData,
} from "@/lib/portal-landing";
import { stepAfterLogin } from "@/lib/portal";
import { PLAN_FEATURES, TRIAL_DAYS } from "@/lib/subscription";

/** נתונים כמו שהמסד מחזיר היום (המחירים — מכאן בלבד, כדי לבדוק שהדף לא ממציא מספרים) */
function data(over: Partial<LandingData> = {}): LandingData {
  return {
    origin: "https://nuriel-app2.nuri1.fit",
    store: {
      trialDays: TRIAL_DAYS,
      plans: [
        {
          code: "basic",
          title: "חבילה בסיסית",
          tagline: "כל מה שצריך כדי למכור באונליין",
          monthlyPrice: 451,
          features: ["עד 1,000 מוצרים"],
          badge: null,
          fit: storePlanFit("basic", 1000, false),
        },
        {
          code: "premium",
          title: "חבילת פרימיום",
          tagline: "לחנויות שגדלות",
          monthlyPrice: 701,
          features: ["מוצרים ללא הגבלה!"],
          badge: "הכי משתלם",
          fit: storePlanFit("premium", null, true),
        },
      ],
      paymentNote: "התשלום הינו מראש לשנה, או בפריסה ל-12 תשלומים חודשיים שווים.",
      vatNote: "* המחירים אינם כוללים מע״מ (עוסק פטור)",
    },
    hospitality: {
      trialDays: 30,
      plans: [
        {
          code: "basic",
          name: "בסיסית",
          tagline: "אתר הזמנות מלא לצימר",
          monthlyPrice: 201,
          setupFee: 2001,
          maxUnits: 3,
          highlights: ["עד 3 יחידות (חדרים / בקתות)"],
          fit: zimmerPlanFit(3),
        },
        {
          code: "premium",
          name: "פרימיום",
          tagline: "בלי הגבלות",
          monthlyPrice: 401,
          setupFee: 2001,
          maxUnits: null,
          highlights: ["יחידות ומתחמים ללא הגבלה"],
          fit: zimmerPlanFit(null),
        },
      ],
    },
    ...over,
  };
}

type Node = Record<string, unknown>;
const graph = (d: LandingData) => (landingJsonLd(d)["@graph"] as Node[]) ?? [];

describe("trials: 14 days for the online store only, 30 for Hospitality only", () => {
  it("the store trial matches the database trigger (14 days)", () => {
    expect(TRIAL_DAYS).toBe(14);
  });

  it("each call to action names its own trial", () => {
    expect(trialCta(14)).toBe("התחילו 14 ימי ניסיון בחינם");
    expect(trialCta(30)).toBe("התחילו 30 ימי ניסיון בחינם");
    // unknown (the database did not answer) — no invented number
    expect(trialCta(null)).toBe("התחילו תקופת ניסיון בחינם");
  });

  it("the FAQ keeps the two trials apart and says they are separate", () => {
    const answer = landingFaq(data()).find((f) => f.q.includes("תקופת הניסיון"))!.a;
    expect(answer).toContain("חנות אינטרנטית: 14 ימי ניסיון");
    expect(answer).toContain(`${HOSPITALITY_PRODUCT}: 30 ימי ניסיון`);
    expect(answer).toContain("שתי תקופות נפרדות");
  });

  it("without a Hospitality trial number nothing invents one", () => {
    const d = data({ hospitality: { ...data().hospitality, trialDays: null } });
    const answer = landingFaq(d).find((f) => f.q.includes("תקופת הניסיון"))!.a;
    expect(answer).toContain(`${HOSPITALITY_PRODUCT}: תקופת ניסיון`);
    expect(answer).not.toContain("30");
    expect(landingDescription(d)).not.toContain("30");
  });
});

describe("prices come from the data, never from constants", () => {
  it("the JSON-LD offers carry exactly the prices passed in", () => {
    const services = graph(data()).filter((n) => n["@type"] === "Service");
    const prices = services.flatMap((s) =>
      ((s["offers"] as Node[] | undefined) ?? []).map((o) => o["price"]),
    );
    expect(prices).toEqual(["451.00", "701.00", "201.00", "401.00"]);
  });

  it("the setup fee shows only when every Hospitality plan has the same one", () => {
    expect(commonSetupFee(data().hospitality.plans)).toBe(2001);
    const mixed = data().hospitality.plans.map((p, i) => ({ ...p, setupFee: 2000 + i }));
    expect(commonSetupFee(mixed)).toBeNull();
    const faq = landingFaq(data({ hospitality: { trialDays: 30, plans: mixed } }));
    expect(faq.some((f) => f.q.includes("דמי ההקמה"))).toBe(false);
  });

  it("formats shekels like the portal dialog", () => {
    expect(shekels(450)).toBe(`${(450).toLocaleString("he-IL")} ₪`);
    expect(shekels(2000)).toBe(`${(2000).toLocaleString("he-IL")} ₪`);
  });

  it("who each plan fits follows the real limits", () => {
    expect(storePlanFit("basic", PLAN_FEATURES.basic.maxProducts, false)).toContain(
      "עד 1,000 מוצרים",
    );
    expect(storePlanFit("premium", null, true)).toContain("ללא הגבלה");
    expect(zimmerPlanFit(3)).toContain("עד 3 יחידות");
    expect(zimmerPlanFit(null)).toContain("ללא הגבלה");
  });
});

describe("JSON-LD", () => {
  const nodes = graph(data());
  const business = nodes.find((n) => n["@type"] === "ComputerStore")!;

  it("describes the real business — and nothing unverified", () => {
    expect(business["name"]).toBe(NURIEL_BUSINESS.name);
    expect(business["telephone"]).toBe(NURIEL_BUSINESS.phoneIntl);
    expect(business["email"]).toBe(NURIEL_BUSINESS.email);
    expect((business["address"] as Node)["addressLocality"]).toBe("בית שמש");
    // the original logo (512px copy) — an absolute address on the landing page's own site
    expect((business["logo"] as Node)["url"]).toBe(
      "https://nuriel-app2.nuri1.fit/brand/nuriel-computers-logo-512.jpg",
    );
    const text = JSON.stringify(landingJsonLd(data()));
    for (const unverified of ["aggregateRating", "review", "openingHours", "geo"]) {
      expect(text).not.toContain(unverified);
    }
  });

  it("has the site, both services and an FAQ identical to the page", () => {
    expect(nodes.map((n) => n["@type"])).toEqual([
      "ComputerStore",
      "WebSite",
      "Service",
      "Service",
      "FAQPage",
    ]);
    const faq = nodes.find((n) => n["@type"] === "FAQPage")!;
    const questions = (faq["mainEntity"] as Node[]).map((q) => q["name"]);
    expect(questions).toEqual(landingFaq(data()).map((f) => f.q));
  });

  it("points at the landing page itself (canonical address)", () => {
    expect((nodes.find((n) => n["@type"] === "WebSite") as Node)["url"]).toBe(
      "https://nuriel-app2.nuri1.fit/",
    );
  });
});

describe("llms.txt", () => {
  const text = landingLlmsTxt(data());

  it("summarizes the three areas with the prices and the separate trials", () => {
    expect(text.startsWith(`# ${NURIEL_BUSINESS.name}`)).toBe(true);
    for (const price of [451, 701, 201, 401, 2001]) expect(text).toContain(shekels(price));
    expect(text).toContain("14 ימי ניסיון בחינם (לחנות אינטרנטית בלבד)");
    expect(text).toContain(`30 ימי ניסיון בחינם (ל-${HOSPITALITY_PRODUCT} בלבד)`);
    expect(text).toContain(STORE_DEMO_URL);
    expect(text).toContain(ZIMMER_DEMO_URL);
  });

  it("links only public content — no admin areas", () => {
    for (const privatePath of ["/admin", "/manage", "/platform", "/account", "/orders"]) {
      expect(text).not.toContain(privatePath);
    }
  });
});

describe("content and links", () => {
  it("the title and description stay within search-result length", () => {
    expect(LANDING_TITLE.length).toBeLessThanOrEqual(70);
    expect(landingDescription(data()).length).toBeLessThanOrEqual(180);
  });

  it("category links open the real store category", () => {
    expect(storeCategoryUrl("מחשבים ניידים")).toBe(
      `${STORE_DEMO_URL}?category=${encodeURIComponent("מחשבים ניידים")}`,
    );
    const all = COMPUTER_GROUPS.flatMap((g) => g.items.map((i) => i.category));
    expect(new Set(all).size).toBe(all.length);
  });

  it("WhatsApp goes to the business number with an opening message", () => {
    const href = whatsappHref();
    expect(href.startsWith(`https://wa.me/${NURIEL_BUSINESS.whatsapp}?text=`)).toBe(true);
    expect(NURIEL_BUSINESS.whatsapp).toMatch(/^972\d{9}$/);
  });

  it("the contact topic goes at the top of the saved message", () => {
    expect(CONTACT_TOPICS).toContain(HOSPITALITY_PRODUCT);
    expect(contactMessage("חנות אינטרנטית", "  שלום  ")).toBe("נושא: חנות אינטרנטית\n\nשלום");
  });
});

describe("stepAfterLogin — the trial buttons open their own path", () => {
  const fresh = { stores: [], canCreate: true };

  it("store trial → straight to opening a store", () => {
    expect(stepAfterLogin(fresh, "store", 2)).toBe("create");
  });

  it("zimmer trial → straight to the zimmer form (when plans are published)", () => {
    expect(stepAfterLogin(fresh, "zimmer", 2)).toBe("zimmer");
    expect(stepAfterLogin(fresh, "zimmer", 0)).toBe("product");
  });

  it("plain login → the usual choice; existing owners → their stores", () => {
    expect(stepAfterLogin(fresh, null, 2)).toBe("product");
    const owner = { stores: [{} as never], canCreate: true };
    expect(stepAfterLogin(owner, "zimmer", 2)).toBe("stores");
    expect(stepAfterLogin({ stores: [], canCreate: false }, "store", 2)).toBe("stores");
  });
});
