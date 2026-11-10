// מסמכים עצמאיים לחתימה (20261111140000): הקלט לפני המסד (סוג, דרך מילוי, הלקוח, פרטי כל סוג), החתימה
// (מה חובה — במסד; כאן הצורה), פסקה כלשונה ("\ ") בנוסח, המיילים (מסמך מדיניות, בלי שם, האזור האישי),
// וואטסאפ, ההתראה לעסק על חתימה, ה-PDF של מסמך מדיניות (חתימת הלקוח בלבד) והלשוניות של המסך.
import { describe, expect, it } from "vitest";
import { contractBlocks } from "@/engines/hospitality/contracts/blocks";
import {
  contractSignRequestEmail,
  contractSignedCopyEmail,
} from "@/engines/hospitality/contracts/emails";
import { buildSignedContractPdf } from "@/engines/hospitality/contracts/pdf.server";
import { poolNotice } from "@/engines/hospitality/contracts/pool-notice";
import {
  linkText,
  parseClientDocsSearch,
  serviceText,
  signerText,
  whatsappHref,
  whatsappNumber,
} from "@/engines/hospitality/management/client-documents/model";
import { renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import type { ContractRow } from "@/engines/hospitality/types/contracts";
import {
  POLICY_DOC_KINDS,
  parseContractSign,
  parseContractsQuery,
  parseSeenIds,
  parseSignedQuery,
  parseStandaloneCreate,
  parseStandaloneTarget,
} from "@/engines/hospitality/validation/contracts";

const G = "6a1e0000-0000-4000-8000-000000000003";
const TOKEN = "A".repeat(42) + "b";
const SIG = ["M10,20 L40,60 L80,30", "M100,50 L150,90"];
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ctx = {
  businessName: "נופי <דורית>",
  businessPhone: "050-1",
  businessEmail: null,
  escape: esc,
};

describe("a standalone document: the kind, the way, the customer", () => {
  const policy = { kind: "policy", input: { document_kind: "house_rules" } };
  it("way A needs a chosen customer, or a new one with a name and an email", () => {
    expect(() => parseStandaloneTarget({ ...policy, fillMode: "business" })).toThrow(
      "נא למלא את שם הלקוח",
    );
    expect(() =>
      parseStandaloneTarget({ ...policy, fillMode: "business", signer: { full_name: "נועה" } }),
    ).toThrow("לשליחת המסמך צריך אימייל תקין");
    expect(
      parseStandaloneTarget({
        ...policy,
        fillMode: "business",
        signer: { full_name: " נועה כהן ", email: "noa@example.com", phone: "" },
      }),
    ).toEqual({
      kind: "policy",
      fillMode: "business",
      guestId: null,
      signer: { full_name: "נועה כהן", email: "noa@example.com" },
      input: { document_kind: "house_rules" },
    });
    expect(parseStandaloneTarget({ ...policy, fillMode: "business", guestId: G }).guestId).toBe(G);
  });
  it("way B needs nothing about the customer (the customer writes it); what is written is checked", () => {
    expect(parseStandaloneTarget({ ...policy, fillMode: "customer" }).signer).toBeNull();
    expect(() =>
      parseStandaloneTarget({ ...policy, fillMode: "customer", signer: { email: "no" } }),
    ).toThrow("כתובת האימייל לא תקינה");
    expect(() =>
      parseStandaloneTarget({ ...policy, fillMode: "customer", signer: { phone: "123" } }),
    ).toThrow("מספר הטלפון לא תקין");
  });
  it("unknown kind / way; the accessibility statement is not a document to sign", () => {
    expect(() => parseStandaloneTarget({ kind: "lease", input: {} })).toThrow("סוג המסמך לא מוכר");
    expect(() => parseStandaloneTarget({ ...policy, fillMode: "robot" })).toThrow(
      "דרך המילוי לא מוכרת",
    );
    expect(() =>
      parseStandaloneTarget({
        kind: "policy",
        fillMode: "customer",
        input: { document_kind: "accessibility" },
      }),
    ).toThrow("המסמך — יש לבחור מהרשימה");
    expect(POLICY_DOC_KINDS).not.toContain("accessibility");
    expect(POLICY_DOC_KINDS).toHaveLength(7);
  });
  it("delivery: way A by email only; way B — a link, or by email when an address was written", () => {
    expect(() =>
      parseStandaloneCreate({
        ...policy,
        fillMode: "business",
        signer: { full_name: "נועה", email: "noa@example.com" },
        deliver: "link",
      }),
    ).toThrow("מסמך שהעסק ממלא נשלח ללקוח במייל");
    expect(parseStandaloneCreate({ ...policy, fillMode: "customer" }).deliver).toBe("link");
    expect(() =>
      parseStandaloneCreate({ ...policy, fillMode: "customer", deliver: "email" }),
    ).toThrow("לשליחה במייל צריך אימייל תקין");
    expect(
      parseStandaloneCreate({
        ...policy,
        fillMode: "customer",
        signer: { email: "noa@example.com" },
        deliver: "email",
      }).deliver,
    ).toBe("email");
  });
});

describe("a standalone contract: what the business fills", () => {
  const hosting = (input: Record<string, unknown>) =>
    parseStandaloneTarget({ kind: "hosting", fillMode: "customer", input });
  it("hosting: dates in order, units or the whole compound, a price, a known deposit method", () => {
    expect(() => hosting({ whole: true, price: 100 })).toThrow("יש למלא תאריך כניסה ותאריך יציאה");
    expect(() =>
      hosting({ check_in: "2026-12-03", check_out: "2026-12-01", whole: true, price: 100 }),
    ).toThrow("תאריך היציאה צריך להיות אחרי תאריך הכניסה");
    expect(() => hosting({ check_in: "2026-12-01", check_out: "2026-12-03", price: 100 })).toThrow(
      "בחרו את היחידות שבחוזה",
    );
    expect(() => hosting({ check_in: "2026-12-01", check_out: "2026-12-03", whole: true })).toThrow(
      "יש למלא את המחיר",
    );
    expect(() =>
      hosting({ check_in: "2026-12-01", check_out: "2026-12-03", whole: true, price: 10.005 }),
    ).toThrow("המחיר — סכום לא תקין");
    expect(() =>
      hosting({
        check_in: "2026-12-01",
        check_out: "2026-12-03",
        whole: true,
        price: 100,
        deposit_method: "bitcoin",
      }),
    ).toThrow("אמצעי הפיקדון לא מוכר");
    expect(
      hosting({
        check_in: "2026-12-01",
        check_out: "2026-12-03",
        units: [" אלון ", "אורן", "אלון"],
        price: "2400",
        event_fee: "",
      }).input,
    ).toEqual({
      check_in: "2026-12-01",
      check_out: "2026-12-03",
      units: ["אלון", "אורן"],
      price: 2400,
      event_fee: null,
      deposit_method: null,
    });
  });
  it("event: a known type (other — named), times, participants; the pool window — both times or none", () => {
    const base = {
      event_date: "2026-12-10",
      start_time: "10:00",
      end_time: "17:00",
      event_type: "birthday",
      participants: 30,
      price: 3500,
    };
    const ev = (extra: Record<string, unknown>) =>
      parseStandaloneTarget({
        kind: "pool_event",
        fillMode: "customer",
        input: { ...base, ...extra },
      });
    expect(() => ev({ event_type: "rave" })).toThrow("סוג האירוע — יש לבחור מהרשימה");
    expect(() => ev({ event_type: "other" })).toThrow("יש למלא את סוג האירוע (אחר)");
    expect(() => ev({ start_time: "9am" })).toThrow("שעת ההתחלה — יש לכתוב שעה בצורה 22:00");
    expect(() => ev({ participants: 2.5 })).toThrow("מספר המשתתפים");
    expect(() => ev({ pool_start_time: "11:00" })).toThrow("השימוש בבריכה — יש למלא גם");
    // לא נשלח — כל החלון המותר (במסד); null + null — בלי שימוש בבריכה
    expect(ev({}).input).not.toHaveProperty("pool_start_time");
    expect(ev({ pool_start_time: null, pool_end_time: null }).input).toMatchObject({
      pool_start_time: null,
      pool_end_time: null,
    });
    expect(ev({ event_type: "other", event_type_other: "  ערב גיבוש " }).input).toMatchObject({
      event_type: "other",
      event_type_other: "ערב גיבוש",
      deposit_amount: null,
      late_fee: null,
    });
  });
});

describe("signing: the shape here, what is required — in the database (it knows the document and the way)", () => {
  const ok = { token: TOKEN, agreed: true, signature: { kind: "drawn", paths: SIG } };
  it("a policy document (nothing to fill) and way B (name, email, phone) pass; nothing extra is invented", () => {
    expect(parseContractSign({ ...ok, fields: {} }).fields).toEqual({});
    expect(
      parseContractSign({
        ...ok,
        fields: { full_name: " יעל לקוחה ", email: "yael@example.com", phone: "054-6800002" },
      }).fields,
    ).toEqual({ full_name: "יעל לקוחה", email: "yael@example.com", phone: "054-6800002" });
  });
  it("what is written must be valid: name, email, phone, ID, address", () => {
    expect(() => parseContractSign({ ...ok, fields: { full_name: "א" } })).toThrow(
      "נא למלא שם מלא",
    );
    expect(() => parseContractSign({ ...ok, fields: { email: "yael" } })).toThrow(
      "כתובת האימייל לא תקינה",
    );
    expect(() => parseContractSign({ ...ok, fields: { phone: "12" } })).toThrow(
      "מספר הטלפון לא תקין",
    );
    expect(() => parseContractSign({ ...ok, fields: { id_number: "123456789" } })).toThrow(
      "מספר תעודת הזהות / ח.פ לא תקין",
    );
    expect(() => parseContractSign({ ...ok, fields: { address: "א" } })).toThrow(
      "כתובת מגורים מלאה",
    );
  });
});

describe("the signed documents area: the query and the seen marks", () => {
  it("known kind / origin only; a date range in order; limited pages", () => {
    expect(parseSignedQuery({ q: " יעל ", kind: "policy", origin: "standalone" })).toMatchObject({
      q: "יעל",
      kind: "policy",
      origin: "standalone",
      limit: 50,
    });
    expect(() => parseSignedQuery({ kind: "lease" })).toThrow("סוג המסמך לא מוכר");
    expect(() => parseSignedQuery({ origin: "space" })).toThrow("מקור לא מוכר");
    expect(() => parseSignedQuery({ from: "2026-12-10", to: "2026-12-01" })).toThrow(
      "טווח התאריכים לא תקין",
    );
    expect(() => parseSignedQuery({ limit: 500 })).toThrow("עמוד לא תקין");
    // הארכיון מכיר עכשיו גם מסמכי מדיניות
    expect(parseContractsQuery({ kind: "policy" }).kind).toBe("policy");
  });
  it("seen: all (null) or up to 200 ids, each a UUID", () => {
    expect(parseSeenIds({})).toEqual({ ids: null });
    expect(parseSeenIds({ ids: [G] })).toEqual({ ids: [G] });
    expect(() => parseSeenIds({ ids: ["x"] })).toThrow();
    expect(() => parseSeenIds({ ids: Array(201).fill(G) })).toThrow("יותר מדי מסמכים");
  });
  it("the screen's tabs: new / send / signed / archive / terms", () => {
    expect(parseClientDocsSearch({ tab: "new" })).toEqual({ tab: "new" });
    expect(parseClientDocsSearch({ tab: "signed" })).toEqual({ tab: "signed" });
    expect(parseClientDocsSearch({ tab: "other" })).toEqual({});
  });
});

describe('the text of a policy document: a line of the site document stays a paragraph ("\\ ")', () => {
  it("an escaped line is a plain paragraph, word for word — not a title, a box or bold", () => {
    const blocks = contractBlocks(
      "# כללי המקום\n\n## שעות שקט\n\n- בין 22:00 ל-08:00\n\n\\ # לא כותרת\n\n\\ **לא מודגש**\n\n\\ > לא תיבה\n\n[[signatures]]",
    );
    expect(blocks).toEqual([
      { kind: "title", text: "כללי המקום" },
      { kind: "heading", text: "שעות שקט" },
      { kind: "item", text: "בין 22:00 ל-08:00" },
      { kind: "paragraph", text: "# לא כותרת" },
      { kind: "paragraph", text: "**לא מודגש**" },
      { kind: "paragraph", text: "> לא תיבה" },
      { kind: "signatures" },
    ]);
  });
  it("a policy document has no pool notice", () => {
    expect(
      poolNotice("policy", {
        open: null,
        close: null,
        event_start: null,
        event_end: null,
        start: null,
        end: null,
        window_known: false,
      }),
    ).toBeNull();
  });
});

describe("the emails of a standalone document", () => {
  it('the request: "the document" for a policy, no name — a plain hello; everything escaped', () => {
    const { subject, html } = contractSignRequestEmail(ctx, {
      signerName: null,
      title: "כללי <המקום>",
      number: 1001,
      url: `https://site.example/stay/contract#t=${TOKEN}`,
      expiresOn: "24.11.2026",
      about: null,
      kind: "policy",
    });
    expect(subject).toBe("כללי <המקום> — לחתימה");
    expect(html).toContain("שלום,");
    expect(html).not.toContain("שלום null");
    expect(html).toContain("לקריאה ולחתימה על המסמך");
    expect(html).toContain("כללי &lt;המקום&gt;");
    expect(html).not.toContain("<המקום>");
    expect(html).toContain(TOKEN);
  });
  it("the request in way B: the customer fills in own details", () => {
    const { html } = contractSignRequestEmail(ctx, {
      signerName: "יעל",
      title: "הסכם הזמנת אירוח ושכירות לטווח קצר",
      number: 1002,
      url: "https://site.example/stay/contract#t=x",
      expiresOn: "24.11.2026",
      about: null,
      kind: "hosting",
      customerFills: true,
    });
    expect(html).toContain("למלא את הפרטים שלכם");
    expect(html).toContain("לקריאה ולחתימה על ההסכם");
  });
  it("the signed copy: no signing link; the personal area link (code login, no password)", () => {
    const { html } = contractSignedCopyEmail(ctx, {
      signerName: "יעל",
      title: "כללי המקום",
      number: 1001,
      signedOn: "10.11.2026 10:15",
      kind: "policy",
      areaUrl: "https://site.example/stay/account",
    });
    expect(html).toContain("המסמך נחתם");
    expect(html).toContain("https://site.example/stay/account");
    expect(html).toContain("בלי סיסמה");
    expect(html).not.toContain("/stay/contract");
  });
});

describe("handing the link over (way B): WhatsApp", () => {
  it("an Israeli mobile → 972…; anything else — no recipient (chosen in WhatsApp)", () => {
    expect(whatsappNumber("054-680-0002")).toBe("972546800002");
    expect(whatsappNumber("+972 54 680 0002")).toBe("972546800002");
    expect(whatsappNumber("12")).toBeNull();
    expect(whatsappNumber(null)).toBeNull();
  });
  it("the message: the document's name and the link, encoded", () => {
    const href = whatsappHref(
      "https://site.example/stay/contract#t=abc",
      "כללי המקום",
      "0546800002",
    );
    expect(href.startsWith("https://wa.me/972546800002?text=")).toBe(true);
    const text = decodeURIComponent(href.split("?text=")[1]!);
    expect(text).toContain("כללי המקום");
    expect(text).toContain("https://site.example/stay/contract#t=abc");
  });
});

describe("the owner is notified on every signing (document_signed)", () => {
  const business = {
    name: "נופי דורית",
    phone: null,
    email: null,
    address: null,
    checkInTime: null,
    checkOutTime: null,
  };
  it("who signed what, and a button to the signed documents — no ID or address in the email", () => {
    const email = renderBookingEmail(
      "document_signed",
      "owner",
      {
        contract_number: 1003,
        title: "כללי המקום",
        signer_name: "יעל <לקוחה>",
        origin: "standalone",
        kind: "policy",
      },
      {
        business,
        bookingUrl: "https://site.example/manage/client-documents?tab=signed",
        escape: esc,
      },
    );
    expect(email).not.toBeNull();
    expect(email!.subject).toBe("נחתם: כללי המקום #1003");
    expect(email!.html).toContain("יעל &lt;לקוחה&gt;");
    expect(email!.html).toContain("(מסמך עצמאי)");
    expect(email!.html).toContain("manage/client-documents?tab=signed");
    expect(email!.html).toContain("למסמכים החתומים");
  });
  it("a booking contract: the booking number", () => {
    const email = renderBookingEmail(
      "document_signed",
      "owner",
      {
        contract_number: 1001,
        title: "הסכם",
        signer_name: "דנה",
        link_number: "1042",
        kind: "hosting",
      },
      { business, bookingUrl: null, escape: esc },
    );
    expect(email!.html).toContain("(הזמנה #1042)");
  });
});

describe("the rows of the signed documents area", () => {
  const row = (r: Partial<ContractRow>) => r as ContractRow;
  it("a standalone document; a policy shows its version; way B before signing — the customer will fill", () => {
    expect(linkText(row({ origin: "standalone" }))).toBe("מסמך עצמאי");
    expect(linkText(row({ origin: "linked", booking_type: "hosting", link_number: "1042" }))).toBe(
      "אירוח #1042",
    );
    expect(serviceText(row({ kind: "policy", document_version: "3" }))).toBe("גרסה 3");
    expect(signerText(row({ signer_name: null }))).toBe("הלקוח ימלא בחתימה");
    expect(signerText(row({ signer_name: "יעל" }))).toBe("יעל");
  });
});

describe("the signed PDF of a policy document", () => {
  it("a real PDF for a policy document (the customer's signature only, the published version on the record page)", async () => {
    const pdf = await buildSignedContractPdf({
      number: 1001,
      title: "כללי המקום",
      kind: "policy",
      fillMode: "customer",
      documentVersion: "2",
      documentHash: "c".repeat(64),
      body: "# כללי המקום\n\n## שעות שקט\n\n- בין 22:00 ל-08:00\n\n\\ # לא כותרת\n\n[[signatures]]",
      bodySha256: "b".repeat(64),
      businessName: "נופי דורית",
      representativeName: null,
      representativeSignature: null,
      signerName: "יעל לקוחה",
      signerEmail: "yael@example.com",
      signature: { kind: "drawn", paths: SIG },
      signedAtLocal: "10.11.2026 10:15",
      signerIp: "198.51.100.1",
      signerUserAgent: "Mozilla/5.0",
    });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    // הנוסח + עמוד "תיעוד החתימה האלקטרונית" (הטקסט עצמו מקודד בגופן — לא נקרא כאן)
    expect(new TextDecoder("latin1").decode(pdf)).toMatch(/\/Count 2/);
    expect(pdf.length).toBeGreaterThan(5_000);
  });
});
