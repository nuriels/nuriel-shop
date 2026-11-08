// מסמכי האתר (מיגרציה 60): מילוי התבניות מפרטי העסק בלבד, מה שחסר (חוסם פרסום), הסדרי הנגישות —
// רק מה שבעל המתחם מסר (בלי "נגיש" כברירת מחדל), התבניות בלי הצהרת עמידה בתקן ובלי לגרוע מזכויות
// צרכן, הכתובות באתר, ובדיקת הקלט.
import { describe, expect, it } from "vitest";
import {
  BOOKING_DOC_KINDS,
  DOC_KINDS,
  DOC_SLUGS,
  docPath,
  kindFromSlug,
} from "@/engines/hospitality/documents/kinds";
import {
  VARIABLES,
  buildVars,
  renderDocument,
  toBlocks,
} from "@/engines/hospitality/documents/render";
import { TEMPLATES } from "@/engines/hospitality/documents/templates";
import type { DocumentsView } from "@/engines/hospitality/types/documents";
import { InputError } from "@/engines/hospitality/validation/input";
import {
  parseAcceptedDocuments,
  parseDocumentSave,
  parsePropertyAccessibility,
} from "@/engines/hospitality/validation/documents";

const PROP = "0f0e0d0c-0b0a-4908-8706-050403020100";
const ctx = { siteUrl: "https://nofi.example", today: "8 בנובמבר 2026" };

function view(over: Partial<DocumentsView> = {}): DocumentsView {
  return {
    business: {
      name: "נופי דורית",
      phone: "050-1234567",
      email: "info@nofi.example",
      whatsapp: null,
      address: "מושב דוגמה",
      check_in_time: "15:00",
      check_out_time: "11:00",
      currency: "ILS",
      slug: "nofi",
    },
    profile: null,
    payments: { bank: true, bit: false, phone: true },
    policy: {
      name: "רגילה",
      free_cancel_days: 7,
      fee_tiers: [],
      no_show_fee: null,
      no_show_value: null,
      deposit_kind: null,
      deposit_value: null,
      guest_text: null,
    },
    properties: [
      {
        id: PROP,
        name: "נופי דורית",
        address: null,
        rules: {
          smoking: "forbidden",
          pets: "no",
          pets_note: null,
          events: null,
          quiet_from: "23:00",
          quiet_to: "07:00",
          custom: ["בלי מנגל אחרי 22:00"],
        },
        accessibility: null,
      },
    ],
    documents: [],
    versions: [],
    ...over,
  };
}

describe("filling a template from the business details", () => {
  it("every variable of every template is known; the business's own details only", () => {
    const known = new Set(VARIABLES.map((v) => v.key));
    for (const k of DOC_KINDS)
      for (const m of TEMPLATES[k].body.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g))
        expect(known.has(m[1]!), `${k}: ${m[1]}`).toBe(true);
    const r = renderDocument(TEMPLATES.booking_terms.body, buildVars(view(), ctx));
    expect(r.text).toContain("נופי דורית");
    expect(r.text).toContain("מ-15:00");
    expect(r.text).not.toMatch(/\{\{/);
    expect(r.missing).toEqual([]);
  });
  it("a missing detail is listed in Hebrew and stays marked (publishing is blocked)", () => {
    const v = view({ business: { ...view().business!, check_in_time: null } });
    const r = renderDocument(TEMPLATES.booking_terms.body, buildVars(v, ctx));
    expect(r.missing).toEqual(["שעת כניסה"]);
    expect(r.text).toContain("{{check_in_time}}");
    expect(renderDocument("{{nope}}", {}).missing).toEqual(["משתנה לא מוכר: nope"]);
  });
  it("details only the owner knows ([[…]]) are found", () => {
    const r = renderDocument(TEMPLATES.payments.body, buildVars(view(), ctx));
    expect(r.placeholders.length).toBe(1);
    expect(r.text).toContain("העברה בנקאית, תשלום בטלפון");
  });
  it("the accessibility coordinator: left out unless the business must appoint one — then required", () => {
    const base = buildVars(view(), ctx);
    expect(renderDocument("א\n{{a11y_coordinator}}\nב", base).text).toBe("א\n\nב");
    const must = view({
      profile: {
        legal_name: null,
        registration_id: null,
        legal_address: null,
        a11y_contact_name: null,
        a11y_contact_phone: null,
        a11y_contact_email: null,
        coordinator_required: true,
        coordinator_name: null,
        coordinator_phone: null,
        coordinator_email: null,
        revision: 1,
      },
    });
    expect(renderDocument("{{a11y_coordinator}}", buildVars(must, ctx), true).missing).toEqual([
      "רכז הנגישות (רק כשחובה)",
    ]);
  });
  it("house rules come from the property's rules", () => {
    const rules = buildVars(view(), ctx)["house_rules"];
    expect(rules).toContain("העישון אסור במתחם");
    expect(rules).toContain("בלי בעלי חיים");
    expect(rules).toContain("שעות שקט: 23:00–07:00");
    expect(rules).toContain("- בלי מנגל אחרי 22:00");
  });
});

describe("physical accessibility — only what the owner gave and confirmed", () => {
  it('nothing confirmed → "not provided yet", never "accessible"', () => {
    const text = buildVars(view(), ctx)["physical_accessibility"];
    expect(text).toContain("טרם נמסר");
    expect(text).not.toMatch(/נגיש(?!ות)/);
  });
  it("confirmed: only the answered items, with the owner's details", () => {
    const v = view();
    v.properties[0]!.accessibility = {
      items: { parking: { answer: "yes", details: "ליד הכניסה" }, unit: { answer: "no" } },
      additional: "כלבי נחייה מתקבלים בברכה",
      contact_name: "דנה",
      contact_phone: null,
      contact_email: null,
      confirmed_at: "2026-11-08T10:00:00Z",
    };
    const text = buildVars(v, ctx)["physical_accessibility"];
    expect(text).toContain("- חניית נכים מסומנת: יש — ליד הכניסה");
    expect(text).toContain("- יחידת אירוח נגישה: אין");
    expect(text).not.toContain("שירותים ומקלחת");
    expect(text).toContain("כלבי נחייה");
  });
  it("the contact for accessibility: the one given, otherwise the business contacts", () => {
    expect(buildVars(view(), ctx)["a11y_contact"]).toContain("050-1234567");
  });
});

describe("the templates", () => {
  it("no claim that the site meets the standard; no draft text on the site; every document has its update date", () => {
    for (const k of DOC_KINDS) {
      const t = TEMPLATES[k];
      for (const claim of ["עומד בתקן", "עומד בדרישות התקן", "נגיש במלואו", "WCAG 2.1"])
        expect(t.body, k).not.toContain(claim);
      expect(t.body, k).toContain("{{today}}");
    }
    expect(TEMPLATES.accessibility.body).toContain("{{physical_accessibility}}");
    expect(TEMPLATES.accessibility.body).toContain("{{a11y_contact}}");
    expect(TEMPLATES.accessibility.body).toContain("מורשה נגישות");
  });
  it("cancellations: a site booking is a distance sale; the business's policy never takes away the legal right", () => {
    const c = TEMPLATES.cancellation.body;
    expect(c).toContain("עסקת מכר מרחוק");
    expect(c).toContain('חוק הגנת הצרכן, התשמ"א-1981');
    expect(c).toContain("אינה גורעת");
    expect(c).toContain("נשמרת עם ההזמנה");
    // שום מספר ימים / אחוז שלא אומת מול נוסח החוק העדכני — רק ברשימת הבדיקה לבעל העסק
    expect(c).not.toMatch(/\d+%|14 ימים|7 ימים/);
    expect(TEMPLATES.cancellation.note).toContain("עורך דין");
  });
  it("blocks: headings, paragraphs and lists — text only", () => {
    expect(toBlocks("## כותרת\nפסקה\n- א\n- ב\n\n<b>x</b>")).toEqual([
      { kind: "h", text: "כותרת" },
      { kind: "p", text: "פסקה" },
      { kind: "ul", items: ["א", "ב"] },
      { kind: "p", text: "<b>x</b>" },
    ]);
  });
});

describe("addresses and the booking set", () => {
  it("privacy and accessibility keep their addresses; the rest under /stay/docs", () => {
    expect(docPath("privacy")).toBe("/stay/privacy");
    expect(docPath("accessibility")).toBe("/stay/accessibility");
    expect(docPath("cancellation")).toBe("/stay/docs/cancellation");
    for (const k of DOC_KINDS) expect(kindFromSlug(DOC_SLUGS[k])).toBe(k);
    expect(kindFromSlug("../etc")).toBeUndefined();
    expect(BOOKING_DOC_KINDS).not.toContain("event_terms");
    expect(BOOKING_DOC_KINDS).not.toContain("accessibility");
  });
});

describe("input", () => {
  it("arrangements: the owner's confirmation is required; unknown items refused; unanswered dropped", () => {
    expect(() => parsePropertyAccessibility({ propertyId: PROP, items: {} })).toThrow(
      "יש לאשר שהמידע נמסר על ידי המתחם ושהוא נכון",
    );
    expect(() =>
      parsePropertyAccessibility({
        propertyId: PROP,
        items: { lift: { answer: "yes" } },
        confirmed: true,
      }),
    ).toThrow(InputError);
    const r = parsePropertyAccessibility({
      propertyId: PROP,
      confirmed: true,
      items: { parking: { answer: "partial", details: " ליד " }, entrance: { answer: "" } },
      contactEmail: "Dana@Example.com",
    });
    expect(r.items).toEqual({ parking: { answer: "partial", details: "ליד" } });
    expect(r.contactEmail).toBe("dana@example.com");
  });
  it("accepted documents in a booking request: known kinds, each once, a version", () => {
    expect(parseAcceptedDocuments(undefined)).toEqual([]);
    expect(parseAcceptedDocuments([{ kind: "privacy", version: 2 }])).toEqual([
      { kind: "privacy", version: 2 },
    ]);
    expect(() => parseAcceptedDocuments([{ kind: "vip", version: 1 }])).toThrow(InputError);
    expect(() =>
      parseAcceptedDocuments([
        { kind: "privacy", version: 1 },
        { kind: "privacy", version: 2 },
      ]),
    ).toThrow(InputError);
  });
  it("a draft: up to 60,000 characters, a title", () => {
    expect(() =>
      parseDocumentSave({ kind: "privacy", title: "פרטיות", body: "x".repeat(60_001) }),
    ).toThrow("המסמך ארוך מדי");
    expect(parseDocumentSave({ kind: "privacy", title: " פרטיות ", body: "טקסט" }).title).toBe(
      "פרטיות",
    );
  });
});
