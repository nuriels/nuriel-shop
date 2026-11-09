// מסמכי לקוחות (מיגרציה 64) ותיקון פרטי לקוח (מיגרציה 65): נוסח החוזה לבלוקים, חתימה (קווים בלבד),
// ת"ז, בדיקת הקלט (סוג החוזה תמיד לפי ההזמנה / האירוע), פרמטרי הכתובת של המסך, המיילים, ה-PDF החתום,
// תיקון פרטי הלקוח — הקלט, ההיסטוריה הממוסכת והמייל "פרטי ההזמנה" עם קישור אישי חדש.
import { describe, expect, it } from "vitest";
import { BLANK, contractBlocks, hasBlank } from "@/engines/hospitality/contracts/blocks";
import {
  contractSignRequestEmail,
  contractSignedCopyEmail,
} from "@/engines/hospitality/contracts/emails";
import { buildSignedContractPdf } from "@/engines/hospitality/contracts/pdf.server";
import { poolNotice } from "@/engines/hospitality/contracts/pool-notice";
import {
  SIGNATURE_HEIGHT,
  SIGNATURE_WIDTH,
  clampPoint,
  pathPoints,
  validSignaturePaths,
} from "@/engines/hospitality/contracts/signature";
import { eventText, EMAIL_EVENT } from "@/engines/hospitality/management/bookings/model";
import {
  parseClientDocsSearch,
  serviceDateText,
} from "@/engines/hospitality/management/client-documents/model";
import { logText } from "@/engines/hospitality/management/events/model";
import { renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import {
  israeliIdOk,
  parseContractSign,
  parseContractTarget,
  parseContractToken,
  parseContractsQuery,
} from "@/engines/hospitality/validation/contracts";
import {
  parseBookingCustomerUpdate,
  parseCustomerPatch,
  parseEventCustomerUpdate,
} from "@/engines/hospitality/validation/customer";
import {
  EVENT_MAX_PARTICIPANTS,
  parseEventInput,
  parseEventUpdate,
  parseTermsSave,
} from "@/engines/hospitality/validation/events";

const B = "6a1e0000-0000-4000-8000-000000000001";
const E = "6a1e0000-0000-4000-8000-000000000002";
const TOKEN = "A".repeat(42) + "b";
const SIG = ["M10,20 L40,60 L80,30", "M100,50 L150,90"];

describe("the contract text → blocks (no HTML from the database)", () => {
  const body = [
    "# הסכם הזמנת אירוח",
    "^ שנערך ונחתם ביום: ________",
    "",
    "## 1. המושכר",
    "שורה ראשונה של פסקה",
    "שורה שנייה של אותה פסקה",
    "",
    "- נקודה אחת",
    "**שורה מודגשת**",
    "> תיבת הסבר",
    "[[signatures]]",
  ].join("\n");
  it("every kind of line becomes its block; paragraph lines are joined; the signatures place", () => {
    expect(contractBlocks(body)).toEqual([
      { kind: "title", text: "הסכם הזמנת אירוח" },
      { kind: "subtitle", text: "שנערך ונחתם ביום: ________" },
      { kind: "heading", text: "1. המושכר" },
      { kind: "paragraph", text: "שורה ראשונה של פסקה שורה שנייה של אותה פסקה" },
      { kind: "item", text: "נקודה אחת" },
      { kind: "strong", text: "שורה מודגשת" },
      { kind: "box", text: "תיבת הסבר" },
      { kind: "signatures" },
    ]);
  });
  it('a field still empty is marked ("________") — the preview highlights it', () => {
    expect(BLANK).toBe("________");
    expect(hasBlank("תעודת זהות: ________")).toBe(true);
    expect(hasBlank("תעודת זהות: 123456782")).toBe(false);
  });
  it("<script> in the text stays text (the renderer never sets HTML)", () => {
    expect(contractBlocks("<script>alert(1)</script>")).toEqual([
      { kind: "paragraph", text: "<script>alert(1)</script>" },
    ]);
  });
});

describe("the signature: strokes only, inside 600×200 — the same rule as the database", () => {
  it("valid strokes; too few points, outside the box, free SVG, too many strokes — refused", () => {
    expect(validSignaturePaths(SIG)).toBe(true);
    expect(validSignaturePaths(["M1,1 L2,2"])).toBe(false);
    expect(validSignaturePaths([`M10,10 L${SIGNATURE_WIDTH + 1},10 L20,20`])).toBe(false);
    expect(validSignaturePaths(["M10,10 C20,20 30,30 40,40"])).toBe(false);
    expect(validSignaturePaths(['<path d="M0,0"/>'])).toBe(false);
    expect(validSignaturePaths(Array.from({ length: 61 }, () => "M1,1 L2,2 L3,3"))).toBe(false);
    expect(validSignaturePaths("M1,1 L2,2 L3,3")).toBe(false);
    expect(validSignaturePaths([])).toBe(false);
  });
  it("points are rounded and kept inside the box", () => {
    expect(clampPoint(10.4, 20.6)).toBe("10,21");
    expect(clampPoint(-5, SIGNATURE_HEIGHT + 50)).toBe(`0,${SIGNATURE_HEIGHT}`);
    expect(pathPoints("M10,20 L40,60")).toEqual([
      [10, 20],
      [40, 60],
    ]);
  });
});

describe("Israeli ID / company number: up to 9 digits with the check digit", () => {
  it("valid and invalid numbers", () => {
    expect(israeliIdOk("123456782")).toBe(true);
    expect(israeliIdOk("000000018")).toBe(true);
    expect(israeliIdOk("18")).toBe(false); // fewer than 5 digits
    expect(israeliIdOk("123456789")).toBe(false);
    expect(israeliIdOk("12345678a")).toBe(false);
    expect(israeliIdOk("1234567890")).toBe(false);
  });
});

describe("the contract input — the right contract for the right booking, always", () => {
  it("hosting only with a booking; the pool compound only with an event", () => {
    expect(parseContractTarget({ kind: "hosting", bookingId: B }).bookingId).toBe(B);
    expect(parseContractTarget({ kind: "pool_event", eventId: E }).eventId).toBe(E);
    expect(() => parseContractTarget({ kind: "hosting", eventId: E })).toThrow(
      "חוזה אירוח — רק להזמנת לינה",
    );
    expect(() => parseContractTarget({ kind: "pool_event", bookingId: B })).toThrow(
      "חוזה מתחם הבריכה — רק לאירוע",
    );
    expect(() => parseContractTarget({ kind: "hosting", bookingId: B, eventId: E })).toThrow();
    expect(() => parseContractTarget({ kind: "rental", bookingId: B })).toThrow(
      "סוג החוזה לא מוכר",
    );
  });
  it("the signer: a valid email and phone; the event fee in agorot at most; the deposit method known", () => {
    expect(() =>
      parseContractTarget({ kind: "hosting", bookingId: B, signer: { email: "x@" } }),
    ).toThrow("כתובת האימייל לא תקינה");
    expect(() =>
      parseContractTarget({ kind: "hosting", bookingId: B, signer: { phone: "123" } }),
    ).toThrow("מספר הטלפון לא תקין");
    expect(
      parseContractTarget({
        kind: "hosting",
        bookingId: B,
        options: { event_fee: "350.5", deposit_method: "check" },
      }).options,
    ).toEqual({ event_fee: 350.5, deposit_method: "check" });
    expect(() =>
      parseContractTarget({ kind: "hosting", bookingId: B, options: { event_fee: 1.234 } }),
    ).toThrow();
    expect(() =>
      parseContractTarget({ kind: "hosting", bookingId: B, options: { deposit_method: "paypal" } }),
    ).toThrow("אמצעי הפיקדון לא מוכר");
    expect(parseContractTarget({ kind: "hosting", bookingId: B, signer: {} }).signer).toBeNull();
  });
  it("the archive query: known kind / status / event type only, limited pages", () => {
    expect(
      parseContractsQuery({ q: "  שירה  ", kind: "pool_event", status: "signed" }),
    ).toMatchObject({
      q: "שירה",
      kind: "pool_event",
      status: "signed",
      limit: 50,
      offset: 0,
    });
    expect(() => parseContractsQuery({ status: "deleted" })).toThrow("מצב לא מוכר");
    expect(() => parseContractsQuery({ eventType: "DROP TABLE" })).toThrow();
    expect(() => parseContractsQuery({ limit: 500 })).toThrow();
  });
});

describe('signing (the customer): the link, "read and agree", the ID, the address, a real signature', () => {
  const ok = {
    token: TOKEN,
    agreed: true,
    fields: { id_number: "12345678-2", address: "רחוב הגפן 3, ישעי" },
    signature: { kind: "drawn", paths: SIG },
  };
  it("a valid request; the ID keeps digits only", () => {
    expect(parseContractSign(ok).fields).toEqual({
      id_number: "123456782",
      address: "רחוב הגפן 3, ישעי",
    });
  });
  it("each missing / wrong part is refused with a clear message", () => {
    expect(() => parseContractToken({ token: "short" })).toThrow("הקישור לחתימה לא תקין");
    expect(() => parseContractSign({ ...ok, agreed: false })).toThrow("יש לאשר שקראתם");
    expect(() =>
      parseContractSign({ ...ok, fields: { ...ok.fields, id_number: "123456789" } }),
    ).toThrow("מספר תעודת הזהות / ח.פ לא תקין");
    expect(() => parseContractSign({ ...ok, fields: { ...ok.fields, address: "א" } })).toThrow(
      "כתובת מגורים מלאה",
    );
    expect(() =>
      parseContractSign({ ...ok, signature: { kind: "drawn", paths: ["M1,1 L2,2"] } }),
    ).toThrow("החתימה לא תקינה");
    expect(() => parseContractSign({ ...ok, signature: { kind: "typed", name: "א" } })).toThrow(
      "השם המלא",
    );
    expect(() => parseContractSign({ ...ok, signature: { kind: "svg" } })).toThrow("חסרה חתימה");
    expect(() =>
      parseContractSign({ ...ok, fields: { ...ok.fields, deposit_method: "bitcoin" } }),
    ).toThrow("אמצעי הפיקדון לא מוכר");
  });
  it("a typed name is a signature too (the accessible alternative)", () => {
    expect(
      parseContractSign({ ...ok, signature: { kind: "typed", name: " רונית לינה " } }).signature,
    ).toEqual({
      kind: "typed",
      name: "רונית לינה",
    });
  });
});

describe("the client-documents screen: the address (?tab= / ?booking= / ?event=)", () => {
  it("known tabs only; a booking / event only as a UUID (lower-cased)", () => {
    expect(parseClientDocsSearch({ tab: "archive" })).toEqual({ tab: "archive" });
    expect(parseClientDocsSearch({ tab: "send", booking: B.toUpperCase() })).toEqual({
      tab: "send",
      booking: B,
    });
    expect(parseClientDocsSearch({ tab: "admin", event: "x' OR 1=1" })).toEqual({});
  });
  it("the service date: one day or a range", () => {
    expect(serviceDateText("2026-11-18", null)).toBe("18.11.2026");
    expect(serviceDateText("2026-11-18", "2026-11-20")).toBe("18.11.2026 – 20.11.2026");
    expect(serviceDateText(null, null)).toBe("—");
  });
});

describe("the contract emails: the personal link only to the customer, everything escaped", () => {
  const ctx = {
    businessName: "נופי <דורית>",
    businessPhone: "050-0000000",
    businessEmail: null,
    escape: (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  };
  it("the request to sign: the link, until when, the number; the business name escaped", () => {
    const m = contractSignRequestEmail(ctx, {
      signerName: "רונית",
      title: "הסכם הזמנת אירוח",
      number: 1001,
      url: `https://nofi.example/stay/contract#t=${TOKEN}`,
      expiresOn: "22.11.2026",
      about: "הזמנה #12",
    });
    expect(m.subject).toBe("הסכם הזמנת אירוח — לחתימה");
    expect(m.html).toContain(`/stay/contract#t=${TOKEN}`);
    expect(m.html).toContain("22.11.2026");
    expect(m.html).toContain("נופי &lt;דורית&gt;");
    expect(m.html).not.toContain("<דורית>");
    expect(m.html).not.toContain("שעות הבריכה");
  });
  it("the request to sign carries the pool notice when there is one (escaped)", () => {
    const m = contractSignRequestEmail(ctx, {
      signerName: "נועה",
      title: "הסכם מתחם הבריכה",
      number: 1002,
      url: `https://nofi.example/stay/contract#t=${TOKEN}`,
      expiresOn: "22.11.2026",
      about: "אירוע — יום הולדת",
      poolNote: "השימוש בבריכה באירוע: 16:00–18:00 בלבד. <b>",
    });
    expect(m.html).toContain("שימו לב — שעות הבריכה");
    expect(m.html).toContain("16:00–18:00");
    expect(m.html).toContain("&lt;b&gt;");
  });
  it("the signed copy: no link at all (the PDF is attached)", () => {
    const m = contractSignedCopyEmail(ctx, {
      signerName: "רונית",
      title: "הסכם",
      number: 1001,
      signedOn: "18.11.2026",
    });
    expect(m.subject).toContain("העותק החתום");
    expect(m.html).not.toContain("#t=");
  });
});

describe("the pool notice for the customer (outside the contract text)", () => {
  const base = { open: "08:00", close: "18:00", event_start: "16:00", event_end: "22:00" };
  it("an event: its pool-use window, and that the event goes on after it", () => {
    expect(
      poolNotice("pool_event", { ...base, start: "16:00", end: "18:00", window_known: true }),
    ).toBe(
      "השימוש בבריכה באירוע: 16:00–18:00 בלבד. הבריכה פתוחה 08:00–18:00, ואסור להיכנס למים מחוץ לשעות אלו — גם כשהאירוע ממשיך אחריהן.",
    );
    expect(
      poolNotice("pool_event", {
        ...base,
        event_end: "14:00",
        event_start: "10:00",
        start: "11:00",
        end: "14:00",
        window_known: true,
      }),
    ).not.toContain("ממשיך");
    // across midnight (ends the next day) — it goes on after the pool closes
    expect(
      poolNotice("pool_event", {
        ...base,
        event_end: "01:00",
        start: "16:00",
        end: "18:00",
        window_known: true,
      }),
    ).toContain("ממשיך");
  });
  it("an event without pool use; a lodging contract; an old snapshot; nothing known", () => {
    expect(
      poolNotice("pool_event", { ...base, start: null, end: null, window_known: true }),
    ).toContain("באירוע הזה אין שימוש בבריכה");
    expect(poolNotice("hosting", { ...base, start: null, end: null, window_known: false })).toBe(
      "הבריכה פתוחה 08:00–18:00 בלבד, ואסור להיכנס למים מחוץ לשעות אלו.",
    );
    expect(
      poolNotice("pool_event", { ...base, start: null, end: null, window_known: false }),
    ).toContain("הבריכה פתוחה 08:00–18:00 בלבד");
    expect(poolNotice("hosting", null)).toBeNull();
    expect(
      poolNotice("hosting", { ...base, open: null, start: null, end: null, window_known: false }),
    ).toBeNull();
  });
});

describe("the signed PDF", () => {
  it("a real PDF: the Hebrew text, both signatures and the certificate page", async () => {
    const pdf = await buildSignedContractPdf({
      number: 1001,
      title: "הסכם הזמנת אירוח ושכירות לטווח קצר",
      body: "# הסכם\n## 1. המושכר\nסעיף ☒ מזומן / ☐ צ'ק\n[[signatures]]",
      bodySha256: "a".repeat(64),
      businessName: "נופי דורית",
      representativeName: "אמציה בשארי",
      representativeSignature: SIG,
      signerName: "רונית לינה",
      signerEmail: "ronit@example.com",
      signature: { kind: "typed", name: "רונית לינה" },
      signedAtLocal: "18.11.2026 10:15",
      signerIp: "198.51.100.1",
      signerUserAgent: "Mozilla/5.0",
      poolNote: "השימוש בבריכה באירוע: 16:00–18:00 בלבד.",
    });
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(new TextDecoder("latin1").decode(pdf)).toMatch(/\/Count 2/);
  });
});

describe("events (migration 63): the input before the database", () => {
  it(`up to ${EVENT_MAX_PARTICIPANTS} participants; a known type`, () => {
    expect(parseEventInput({ participants: 50, event_type: "bridal_shower" })).toMatchObject({
      participants: 50,
    });
    expect(() => parseEventInput({ participants: 51 })).toThrow();
    expect(() => parseEventInput({ event_type: "rave" })).toThrow();
  });
  it("the pool-use window: both times or neither, inside 08:00–18:00, after its start", () => {
    expect(parseEventInput({ pool_start_time: "16:00", pool_end_time: "18:00" })).toMatchObject({
      pool_start_time: "16:00",
      pool_end_time: "18:00",
    });
    expect(parseEventInput({ pool_start_time: null, pool_end_time: null })).toMatchObject({
      pool_start_time: null,
      pool_end_time: null,
    });
    expect(() => parseEventInput({ pool_start_time: "16:00" })).toThrow("יש למלא גם שעת התחלה");
    expect(() => parseEventInput({ pool_start_time: "17:00", pool_end_time: "19:00" })).toThrow(
      "רק בין 08:00 ל-18:00",
    );
    expect(() => parseEventInput({ pool_start_time: "07:30", pool_end_time: "09:00" })).toThrow(
      "רק בין 08:00 ל-18:00",
    );
    expect(() => parseEventInput({ pool_start_time: "12:00", pool_end_time: "11:00" })).toThrow(
      "אחרי ההתחלה",
    );
  });
  it("the refund amount; on update the lodging acknowledgement is allowed, the status is not", () => {
    expect(parseEventInput({ refund_amount: 1000 })).toMatchObject({ refund_amount: 1000 });
    expect(() => parseEventInput({ refund_amount: -1 })).toThrow();
    const id = "6a1e0000-0000-4000-8000-000000000003";
    expect(
      parseEventUpdate({ id, revision: 2, data: { event_date: "2027-01-02", lodging_ack: true } })
        .data,
    ).toMatchObject({ lodging_ack: true });
    expect(() => parseEventUpdate({ id, revision: 2, data: { status: "confirmed" } })).toThrow(
      "מצב האירוע והלקוח",
    );
  });
  it("the business terms: the pool hours only inside 08:00–18:00", () => {
    expect(
      parseTermsSave({ data: { pool_open_time: "09:00", pool_close_time: "17:00" }, revision: 1 })
        .data,
    ).toEqual({ pool_open_time: "09:00", pool_close_time: "17:00" });
    expect(() => parseTermsSave({ data: { pool_open_time: "07:00" }, revision: 1 })).toThrow(
      "בין 08:00 ל-18:00",
    );
    expect(() => parseTermsSave({ data: { pool_close_time: "19:00" }, revision: 1 })).toThrow(
      "בין 08:00 ל-18:00",
    );
  });
  it("the business terms: known fields, a real representative signature, the unit as a UUID", () => {
    expect(parseTermsSave({ data: { representative_signature: SIG }, revision: 1 }).data).toEqual({
      representative_signature: SIG,
    });
    expect(parseTermsSave({ data: { representative_signature: null }, revision: 1 }).data).toEqual({
      representative_signature: null,
    });
    expect(() =>
      parseTermsSave({ data: { representative_signature: ["<svg/>"] }, revision: 1 }),
    ).toThrow("החתימה של הנציג לא תקינה");
    expect(() =>
      parseTermsSave({
        data: { unit_lines: [{ unit_id: "x", name: "אלון", description: "זוג" }] },
        revision: 1,
      }),
    ).toThrow();
    expect(() => parseTermsSave({ data: { owner_password: "x" }, revision: 1 })).toThrow(
      "שדה לא מוכר",
    );
  });
});

describe("correcting the customer's details (migration 65)", () => {
  it("only the fields sent; a valid email / phone; an empty email removes it; something must be sent", () => {
    expect(parseCustomerPatch({ full_name: "  מיכל לוי ", email: "" })).toEqual({
      full_name: "מיכל לוי",
      email: null,
    });
    expect(() => parseCustomerPatch({})).toThrow("לא נשלח אף פרט לעדכון");
    expect(() => parseCustomerPatch({ email: "no" })).toThrow("כתובת האימייל לא תקינה");
    expect(() => parseCustomerPatch({ phone: "12" })).toThrow("מספר הטלפון לא תקין");
    expect(() => parseCustomerPatch({ full_name: "x" })).toThrow("נא למלא את שם הלקוח");
    expect(() => parseCustomerPatch({ notes: "x" })).toThrow("שדה לא מוכר");
  });
  it("the booking / event request: a UUID, the revision, the scope, notify only when asked", () => {
    expect(
      parseBookingCustomerUpdate({ id: B, revision: 3, data: { full_name: "מיכל לוי" } }),
    ).toEqual({
      id: B,
      revision: 3,
      data: { full_name: "מיכל לוי" },
      scope: "guest",
      notify: false,
    });
    expect(
      parseBookingCustomerUpdate({
        id: B,
        data: { full_name: "מיכל" },
        scope: "booking",
        notify: true,
      }),
    ).toMatchObject({
      scope: "booking",
      notify: true,
    });
    expect(() =>
      parseBookingCustomerUpdate({ id: B, data: { full_name: "מיכל" }, scope: "all" }),
    ).toThrow("היקף השינוי לא מוכר");
    expect(() => parseEventCustomerUpdate({ id: "1", data: { full_name: "מיכל" } })).toThrow();
  });
  it("the history shows which fields and the emails masked; the event log the same", () => {
    const changes = {
      fields: ["full_name", "email"],
      scope: "guest",
      guest_changed: false,
      email: { from: "o•••@example.com", to: "m•••@example.com" },
    };
    expect(eventText({ kind: "customer_updated", from: null, to: null, changes })).toBe(
      "פרטי הלקוח תוקנו: שם, אימייל (o•••@example.com ← m•••@example.com)",
    );
    expect(
      eventText({
        kind: "details_sent",
        from: null,
        to: null,
        changes: { email: "m•••@example.com" },
      }),
    ).toContain("קישור אישי חדש");
    expect(
      logText({
        id: 1,
        kind: "customer_updated",
        from_status: null,
        to_status: null,
        actor_kind: "staff",
        changes: { ...changes, guest_changed: true },
        note: null,
        at: "2026-11-08T10:00:00Z",
      }),
    ).toContain("רק באירוע הזה");
    expect(EMAIL_EVENT["booking_details"]).toContain("פרטי ההזמנה");
  });
  it('the "booking details" email: the details and the NEW personal link; a group — a link per room', () => {
    const ctx = {
      business: {
        name: "נופי דורית",
        phone: "050-0000000",
        email: null,
        address: null,
        checkInTime: "15:00",
        checkOutTime: "11:00",
      },
      bookingUrl: null,
      siteOrigin: "https://nofi.example",
      escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
    };
    const t = "c".repeat(64);
    const one = renderBookingEmail(
      "booking_details",
      "guest",
      { booking_number: 12, guest_name: "מיכל", manage_token: t },
      ctx,
    )!;
    expect(one.subject).toBe("פרטי ההזמנה שלך #12 — נופי דורית");
    expect(one.html).toContain(`/stay/my-booking#t=${t}`);
    expect(one.html).toContain("הוא כבר לא פעיל");
    const group = renderBookingEmail(
      "booking_details",
      "guest",
      {
        booking_number: 12,
        guest_name: "מיכל",
        rooms: [
          { number: 12, unit_name: "אלון", adults: 2, children: 0, total: 600, manage_token: t },
          {
            number: 13,
            unit_name: "ברוש",
            adults: 2,
            children: 0,
            total: 600,
            manage_token: "d".repeat(64),
          },
        ],
      },
      ctx,
    )!;
    expect(group.html).toContain(`#t=${t}`);
    expect(group.html).toContain(`#t=${"d".repeat(64)}`);
  });
});
