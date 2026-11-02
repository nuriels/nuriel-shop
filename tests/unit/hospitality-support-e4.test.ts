// שלב E4: מערכת התמיכה — בדיקת הקבצים לפי התוכן (לא לפי הסיומת), הקלט של פונקציות השרת,
// העזרים של המסכים (סטטוס, זמנים, לשוניות), המיילים (לעסק בלי תוכן התשובה; לפלטפורמה עם escape),
// והניווט (פריט "תמיכה" למי שיש לו הרשאת הגדרות).
import { describe, expect, it } from "vitest";
import { EMAIL_EVENT } from "@/engines/hospitality/management/bookings/model";
import { NAV_ITEMS, isNavActive, visibleNav } from "@/engines/hospitality/management/lib/nav";
import {
  STATUS_LABEL,
  agoText,
  inTab,
  isOverdue,
  parseSupportSearch,
  waitingText,
  whatsappUrl,
} from "@/engines/hospitality/management/support/model";
import { supportAlertEmail } from "@/engines/hospitality/outbox/support-alert";
import { PLATFORM_SENDER, renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import {
  checkSupportFiles,
  parseAdminSupportFilter,
  parseAdminSupportReplyForm,
  parseAdminSupportStatus,
  parseSupportOpenForm,
  parseSupportReplyForm,
  parseSupportSetOpen,
  parseSupportSettingsInput,
  pdfHasActiveContent,
  sniffSupportFile,
} from "@/engines/hospitality/validation/support";

const bytes = (...v: number[]) => new Uint8Array(v);
const ascii = (s: string) => new TextEncoder().encode(s);
const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("attachments: the type comes from the content", () => {
  it("recognizes JPEG, PNG, WebP and PDF by their first bytes", () => {
    expect(sniffSupportFile(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffSupportFile(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      "image/png",
    );
    expect(sniffSupportFile(ascii("RIFF\x00\x00\x00\x00WEBPVP8 "))).toBe("image/webp");
    expect(sniffSupportFile(ascii("%PDF-1.7\n"))).toBe("application/pdf");
  });

  it("rejects everything else, whatever the name says (HTML, SVG, scripts, archives, empty)", () => {
    expect(sniffSupportFile(ascii("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffSupportFile(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffSupportFile(ascii("MZ\x90\x00"))).toBeNull();
    expect(sniffSupportFile(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(sniffSupportFile(ascii("RIFF\x00\x00\x00\x00WAVE"))).toBeNull();
    expect(sniffSupportFile(new Uint8Array(0))).toBeNull();
  });

  it("a PDF with JavaScript or a launch action is refused; a plain PDF is fine", () => {
    expect(pdfHasActiveContent(ascii("%PDF-1.4 1 0 obj << /OpenAction 2 0 R >> endobj"))).toBe(
      false,
    );
    expect(pdfHasActiveContent(ascii("%PDF-1.4 << /S /JavaScript /JS (app.alert(1)) >>"))).toBe(
      true,
    );
    expect(pdfHasActiveContent(ascii("%PDF-1.4 << /JS 5 0 R >>"))).toBe(true);
    expect(pdfHasActiveContent(ascii("%PDF-1.4 << /S /Launch /F (cmd.exe) >>"))).toBe(true);
    // not a prefix of a longer name
    expect(pdfHasActiveContent(ascii("%PDF-1.4 << /JSONData 1 >>"))).toBe(false);
  });

  it("checks count, size and extension before sending (the server checks again)", () => {
    const f = (name: string, size = 1000) => ({ name, size });
    expect(
      checkSupportFiles([f("a.png"), f("b.JPG"), f("c.webp"), f("d.pdf"), f("e.jpeg")]),
    ).toBeNull();
    expect(
      checkSupportFiles([f("1.png"), f("2.png"), f("3.png"), f("4.png"), f("5.png"), f("6.png")]),
    ).toMatch(/עד 5 קבצים/);
    expect(checkSupportFiles([f("x.svg")])).toMatch(/לא נתמך/);
    expect(checkSupportFiles([f("x.html")])).toMatch(/לא נתמך/);
    expect(checkSupportFiles([f("big.png", 5 * 1024 * 1024 + 1)])).toMatch(/גדול מדי/);
    expect(checkSupportFiles([f("empty.png", 0)])).toMatch(/ריק/);
  });
});

describe("server function input", () => {
  const form = (fields: Record<string, string>, files: File[] = []) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const file of files) fd.append("files", file, file.name);
    return fd;
  };

  it("a new ticket: subject 3–120, a known topic, priority (default normal), a body, files", () => {
    const ok = parseSupportOpenForm(
      form({ subject: "  הזמנה לא מופיעה  ", topic: "calendar", body: " פרטים " }, [
        new File([new Uint8Array([0xff, 0xd8, 0xff])], "shot.jpg"),
      ]),
    );
    expect(ok).toMatchObject({
      subject: "הזמנה לא מופיעה",
      topic: "calendar",
      priority: "normal",
      body: "פרטים",
    });
    expect(ok.files).toHaveLength(1);
    expect(() => parseSupportOpenForm(form({ subject: "אב", topic: "other", body: "x" }))).toThrow(
      /נושא/,
    );
    expect(() =>
      parseSupportOpenForm(form({ subject: "נושא", topic: "billing", body: "x" })),
    ).toThrow(/התחום/);
    expect(() =>
      parseSupportOpenForm(form({ subject: "נושא", topic: "other", priority: "asap", body: "x" })),
    ).toThrow(/הדחיפות/);
    expect(() =>
      parseSupportOpenForm(form({ subject: "נושא", topic: "other", body: "  " })),
    ).toThrow(/כתבו הודעה/);
    expect(() =>
      parseSupportOpenForm(form({ subject: "נושא", topic: "other", body: "א".repeat(5001) })),
    ).toThrow(/ארוכה מדי/);
    expect(() =>
      parseSupportOpenForm(
        form({ subject: "נושא", topic: "other", body: "x" }, [new File(["<svg/>"], "x.svg")]),
      ),
    ).toThrow(/לא נתמך/);
    expect(() => parseSupportOpenForm({ subject: "not a form" })).toThrow(/בקשה לא תקינה/);
  });

  it("a reply needs a ticket id; the platform reply: internal flag and an allowed status", () => {
    expect(parseSupportReplyForm(form({ ticketId: ID, body: "תודה" }))).toMatchObject({
      ticketId: ID,
    });
    expect(() => parseSupportReplyForm(form({ ticketId: "1; drop", body: "x" }))).toThrow(/הפנייה/);
    expect(
      parseAdminSupportReplyForm(form({ ticketId: ID, body: "x", internal: "true" })),
    ).toMatchObject({
      internal: true,
      status: null,
    });
    expect(
      parseAdminSupportReplyForm(form({ ticketId: ID, body: "x", status: "resolved" })),
    ).toMatchObject({ internal: false, status: "resolved" });
    expect(() =>
      parseAdminSupportReplyForm(form({ ticketId: ID, body: "x", status: "new" })),
    ).toThrow();
    expect(parseSupportSetOpen({ id: ID, open: false })).toEqual({ id: ID, open: false });
    expect(() => parseSupportSetOpen({ id: ID, open: "yes" })).toThrow();
    expect(parseAdminSupportStatus({ id: ID, status: "closed" })).toEqual({
      id: ID,
      status: "closed",
    });
    expect(() => parseAdminSupportStatus({ id: ID, status: "lost" })).toThrow();
  });

  it("the platform filter: optional fields, a valid date range, a bounded search", () => {
    expect(parseAdminSupportFilter({})).toEqual({
      status: null,
      priority: null,
      from: null,
      to: null,
      q: null,
      needsReply: false,
      page: 0,
    });
    expect(
      parseAdminSupportFilter({
        status: "open",
        priority: "urgent",
        from: "2026-11-01",
        to: "2026-11-30",
        q: " #1001 ",
        needsReply: true,
        page: 2,
      }),
    ).toMatchObject({ status: "open", priority: "urgent", q: "#1001", needsReply: true, page: 2 });
    expect(() => parseAdminSupportFilter({ from: "2026-11-30", to: "2026-11-01" })).toThrow(/טווח/);
    expect(() => parseAdminSupportFilter({ status: "lost" })).toThrow();
    expect(() => parseAdminSupportFilter({ from: "2026-02-30" })).toThrow();
    expect(parseAdminSupportFilter({ q: "א".repeat(200) }).q).toHaveLength(80);
  });

  it("the WhatsApp number: digits (and +) only, normalized; empty clears it", () => {
    expect(parseSupportSettingsInput({ whatsapp: "+972-50-123 4567" })).toEqual({
      whatsapp: "+972501234567",
    });
    expect(parseSupportSettingsInput({ whatsapp: "" })).toEqual({ whatsapp: null });
    expect(() => parseSupportSettingsInput({ whatsapp: "javascript:alert(1)" })).toThrow();
  });
});

describe("screens: statuses, times, tabs", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");
  const at = (h: number) => new Date(now - h * 3_600_000).toISOString();

  it("the five statuses in Hebrew", () => {
    expect(Object.values(STATUS_LABEL)).toEqual([
      "חדשה",
      "בטיפול",
      "ממתינה לתשובת הלקוח",
      "נפתרה",
      "נסגרה",
    ]);
  });

  it("tabs: open = new / in progress / waiting for the customer; done = resolved / closed", () => {
    expect(inTab({ status: "waiting_customer" }, "open")).toBe(true);
    expect(inTab({ status: "resolved" }, "open")).toBe(false);
    expect(inTab({ status: "closed" }, "done")).toBe(true);
    expect(inTab({ status: "new" }, "all")).toBe(true);
  });

  it("relative times and how long a ticket waits for the platform", () => {
    expect(agoText(new Date(now - 30_000).toISOString(), now)).toBe("עכשיו");
    expect(agoText(at(2), now)).toBe("לפני שעתיים");
    expect(agoText(at(48), now)).toBe("לפני יומיים");
    expect(waitingText({ needs_reply: true, last_message_at: at(5) }, now)).toBe("5 שעות");
    expect(waitingText({ needs_reply: false, last_message_at: at(5) }, now)).toBeNull();
  });

  it("overdue: premium after 4 hours, others after a day", () => {
    const t = { needs_reply: true, last_message_at: at(5) };
    expect(isOverdue(t, "premium", now)).toBe(true);
    expect(isOverdue(t, "basic", now)).toBe(false);
    expect(isOverdue({ ...t, last_message_at: at(25) }, "basic", now)).toBe(true);
    expect(isOverdue({ ...t, needs_reply: false }, "premium", now)).toBe(false);
  });

  it("deep link ?new=1 and the WhatsApp link", () => {
    expect(parseSupportSearch({ new: "1" })).toEqual({ new: "1" });
    expect(parseSupportSearch({ new: "yes" })).toEqual({});
    expect(whatsappUrl("+972-50-123-4567", "שלום")).toBe(
      "https://wa.me/972501234567?text=%D7%A9%D7%9C%D7%95%D7%9D",
    );
    expect(whatsappUrl("050-1234567")).toBe("https://wa.me/972501234567");
  });
});

describe("emails", () => {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const business = {
    name: "צימרי הגליל",
    phone: null,
    email: null,
    address: null,
    checkInTime: null,
    checkOutTime: null,
  };

  it("to the business when support replies: from Nuriel Hospitality, a link, never the reply itself", () => {
    const e = renderBookingEmail(
      "support_reply",
      "owner",
      { ticket_number: 1007, subject: "היומן לא מסתנכרן", ticket_id: ID },
      { business, bookingUrl: `https://galil.example/manage/support/${ID}`, escape },
    )!;
    expect(e.subject).toBe("תשובה חדשה מהתמיכה בפנייה #1007");
    expect(e.sender).toBe(PLATFORM_SENDER);
    expect(e.html).toContain(`href="https://galil.example/manage/support/${ID}"`);
    expect(e.html).toContain("לקריאת התשובה");
    expect(e.html).toContain("Nuriel Hospitality");
    expect(e.html).toContain("התשובה עצמה לא נשלחת במייל");
    expect(EMAIL_EVENT["support_reply"]).toBe("לעסק: תשובה מהתמיכה");
    // booking emails keep the business as the sender
    expect(
      renderBookingEmail(
        "new_booking",
        "owner",
        { booking_number: 5 },
        { business, bookingUrl: null, escape },
      )!.sender,
    ).toBeNull();
  });

  it("to the platform team: the business text is escaped and shortened; urgent tickets marked", () => {
    const a = {
      event: "opened" as const,
      ticketId: ID,
      number: 1001,
      subject: "<b>האתר נפל</b>",
      topic: "technical" as const,
      priority: "urgent" as const,
      business: "צימר <script>",
      messageId: ID,
      body: `<img src=x onerror=alert(1)>${"א".repeat(700)}`,
      files: 2,
    };
    const e = supportAlertEmail(
      a,
      `https://panel.example/platform/hospitality?ticket=${ID}#support`,
      escape,
    );
    expect(e.subject.startsWith("[דחופה] פנייה חדשה #1001")).toBe(true);
    expect(e.html).not.toContain("<img src=x");
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(e.html).toContain("…");
    expect(e.html).toContain("קבצים מצורפים");
    expect(e.html).toContain(
      `href="https://panel.example/platform/hospitality?ticket=${ID}#support"`,
    );
    expect(
      supportAlertEmail({ ...a, priority: "low", event: "replied" }, null, escape).subject,
    ).toMatch(/^תגובה בפנייה #1001/);
  });
});

describe("navigation", () => {
  it("'support' is in the account group, for staff with the settings permission, also on a ticket", () => {
    const item = NAV_ITEMS.find((i) => i.key === "support")!;
    expect(item).toMatchObject({
      label: "תמיכה",
      to: "/manage/support",
      group: "account",
      permission: "settings",
    });
    expect(isNavActive(item, `/manage/support/${ID}`)).toBe(true);
    expect(visibleNav({ settings: true }).map((i) => i.key)).toContain("support");
    expect(visibleNav({ bookings: true }).map((i) => i.key)).not.toContain("support");
  });
});
