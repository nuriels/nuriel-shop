// Nuriel Websites — inquiries from customers (migration 196) and the accessibility statement: the pure parts
// (form validation with per-field messages, the notification e-mail, error scrubbing, the statement text)
import { describe, expect, it } from "vitest";
import {
  FIELD_ERRORS,
  firstInvalid,
  inquiryEmail,
  normalizePhone,
  scrubError,
  validateInquiry,
} from "@/engines/business-profile/inquiries/logic";
import { normalizeDocument } from "@/engines/business-profile/document/normalize";
import { normalizeBlockProps } from "@/engines/business-profile/document/blocks";
import { ENGINE_MEASURES, formatYmd } from "@/engines/business-profile/site/AccessibilityStatement";
import { statementGaps } from "@/engines/business-profile/studio/editor/AccessibilityPanel";
import { buildFaithfulDocument, loadSource } from "../../scripts/websites/efrat-faithful.mjs";

const valid = { name: "דנה כהן", phone: "050-123 4567", email: "", message: "שלום" };

describe("bp inquiries: the form", () => {
  it("accepts a name + phone, normalises the phone and the e-mail", () => {
    const r = validateInquiry({ ...valid, email: " Dana@Example.COM " });
    expect(r).toEqual({
      ok: true,
      value: { name: "דנה כהן", phone: "0501234567", email: "dana@example.com", message: "שלום" },
    });
    expect(normalizePhone("+972 (50) 123-4567")).toBe("+972501234567");
    expect(normalizePhone("  ")).toBe("");
  });

  it("explains every problem next to its field, and focus goes to the first one in the form's order", () => {
    const r = validateInquiry({ name: "א", phone: "", email: "", message: "x".repeat(4001) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual({
      name: FIELD_ERRORS.name,
      phone: FIELD_ERRORS.contact,
      message: FIELD_ERRORS.message,
    });
    expect(firstInvalid(r.errors)).toBe("name");
    const bad = validateInquiry({ ...valid, phone: "12", email: "no-at-sign" });
    expect(!bad.ok && bad.errors).toEqual({ phone: FIELD_ERRORS.phone, email: FIELD_ERRORS.email });
    expect(!bad.ok && firstInvalid(bad.errors)).toBe("email");
  });

  it("error messages are neutral Hebrew with an example of the right format", () => {
    expect(FIELD_ERRORS.phone).toContain("050-1234567");
    expect(FIELD_ERRORS.email).toContain("name@example.com");
    expect(FIELD_ERRORS.contact).toContain("לחזור אליכם");
  });

  it("the form block keeps its kind (contact by default, unknown → contact)", () => {
    expect((normalizeBlockProps("form", {}) as { kind: string }).kind).toBe("contact");
    expect((normalizeBlockProps("form", { kind: "consultation" }) as { kind: string }).kind).toBe(
      "consultation",
    );
    expect((normalizeBlockProps("form", { kind: "hack" }) as { kind: string }).kind).toBe(
      "contact",
    );
  });
});

describe("bp inquiries: the notification e-mail", () => {
  const base = {
    siteName: "אפרת אדיר",
    reference: "AB12CD34",
    kind: "consultation",
    formTitle: "השאירו פרטים",
    fullName: "דנה <script>alert(1)</script>",
    phone: "0501234567",
    email: "dana@example.com",
    message: "שורה 1\nשורה 2 & עוד",
    createdAt: "2026-11-16T10:30:00Z",
    isTest: false,
    link: "https://efrat.nuri1.fit/studio/inbox?id=11111111-1111-4111-8111-111111111111",
  };

  it("has the name, phone, e-mail, message, kind, time and the inbox link — all escaped", () => {
    const m = inquiryEmail(base);
    expect(m.subject).toBe("פנייה חדשה מהאתר — דנה <script>alert(1)</script>");
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("דנה &lt;script&gt;");
    expect(m.html).toContain('href="tel:0501234567"');
    expect(m.html).toContain('href="mailto:dana@example.com"');
    expect(m.html).toContain("שורה 2 &amp; עוד");
    expect(m.html).toContain("שיחת ייעוץ — השאירו פרטים");
    expect(m.html).toContain("16.11.2026");
    expect(m.html).toContain("12:30"); // Asia/Jerusalem
    expect(m.html).toContain(base.link);
    expect(m.html).toContain("הקישור עצמו לא נותן גישה");
    expect(m.html).toMatch(/<html lang="he" dir="rtl">/);
  });

  it("a test inquiry is marked in the subject and the body; no phone / e-mail → those rows are left out", () => {
    const m = inquiryEmail({ ...base, isTest: true, phone: null, email: null, message: null });
    expect(m.subject.startsWith("[בדיקה] ")).toBe(true);
    expect(m.html).toContain("פניית בדיקה");
    expect(m.html).not.toContain("tel:");
    expect(m.html).not.toContain("mailto:");
    expect(m.html).not.toContain("ההודעה</h2>");
  });

  it("errors stored on the inquiry never keep an e-mail address", () => {
    expect(scrubError("Invalid `to` field: owner+down@example.com (422)")).toBe(
      "Invalid `to` field: [כתובת] (422)",
    );
    expect(scrubError(null)).toBe("השליחה נכשלה");
    expect(scrubError("x".repeat(500))).toHaveLength(300);
  });
});

describe("bp accessibility statement", () => {
  it("the document always has a statement (defaults when missing); a page cannot take its address", () => {
    const doc = normalizeDocument({
      pages: [
        { id: "home", slug: "", blocks: [] },
        { id: "a11y", slug: "accessibility", blocks: [] },
      ],
    });
    expect(doc.accessibility.auditStatus).toBe("not_audited");
    expect(doc.accessibility.updatedOn).toBe("");
    expect(doc.pages.map((p) => p.slug)).toEqual([""]);
    const bad = normalizeDocument({
      accessibility: { updatedOn: "16/11/2026", contactEmail: "x" },
    });
    expect(bad.accessibility.updatedOn).toBe("");
    expect(bad.accessibility.contactEmail).toBe("");
  });

  it("the fixed list of measures never claims conformance; dates are shown as d.m.yyyy", () => {
    expect(ENGINE_MEASURES.length).toBeGreaterThanOrEqual(8);
    for (const m of ENGINE_MEASURES) expect(m).not.toMatch(/עומד בתקן|תואם לתקן|נגיש במלואו/);
    expect(formatYmd("2026-11-06")).toBe("6.11.2026");
    expect(formatYmd("")).toBe("");
  });

  it("the studio lists what is missing (date, contact, auditor details, coordinator)", () => {
    const doc = normalizeDocument({});
    expect(statementGaps(doc.accessibility, doc.business)).toEqual([
      "תאריך העדכון של ההצהרה",
      "שם איש/אשת הקשר לנגישות",
      "טלפון או אימייל לפניות בנושא נגישות",
    ]);
    const expert = normalizeDocument({
      accessibility: { auditStatus: "expert", coordinatorRequired: true, updatedOn: "2026-11-16" },
      business: { email: "a@b.co" },
    });
    expect(statementGaps(expert.accessibility, expert.business)).toEqual([
      "שם איש/אשת הקשר לנגישות",
      "מי בדק את האתר ומתי (מורשה נגישות)",
      "שם רכז/ת הנגישות",
    ]);
  });

  it("Efrat's statement: dated, her name as the contact, not audited by an expert, the known limitations listed", () => {
    const doc = normalizeDocument(buildFaithfulDocument(loadSource()));
    const a = doc.accessibility;
    expect(a.updatedOn).toBe("2026-11-16");
    expect(a.contactName.he).toBe("אפרת אדיר");
    expect(a.auditStatus).toBe("not_audited");
    expect(a.limitations.he).toContain("ניגודיות");
    expect(a.limitations.he.split("\n\n")).toHaveLength(3);
    // contact by WhatsApp (no phone / e-mail in the scan) — the statement shows the business's WhatsApp
    expect(statementGaps(a, doc.business)).toEqual(["טלפון או אימייל לפניות בנושא נגישות"]);
  });
});
