// שלב א' 5 — העברה בנקאית: הקלט של פונקציות השרת (בחירת אמצעי, העלאת אישור, החלטת הצוות), בדיקת
// הקובץ בשרת לפי התוכן (לא לפי הסיומת או ה-MIME שהדפדפן שלח), שורת "תשלום" לאורח, והמשימה בלוח הבקרה.
import { describe, expect, it } from "vitest";
import { taskView } from "@/engines/hospitality/management/dashboard/model";
import { eventText } from "@/engines/hospitality/management/bookings/model";
import { prepareProofFile } from "@/engines/hospitality/server/proofs.server";
import type { GuestPaymentInfo } from "@/engines/hospitality/types/payment-instructions";
import { InputError } from "@/engines/hospitality/validation/input";
import {
  optionalPaymentMethod,
  parseProofReview,
  parseProofUploadForm,
  parseSetPaymentMethod,
} from "@/engines/hospitality/validation/proofs";
import { he } from "@/engines/hospitality/website/copy/he";
import { transferPaymentLabel } from "@/engines/hospitality/website/lib/transfer";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const TOKEN = "a".repeat(64);
const ascii = (s: string) => new TextEncoder().encode(s);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const file = (data: Uint8Array | string, name: string, type = "application/octet-stream") =>
  new File([typeof data === "string" ? ascii(data) : data], name, { type });

describe("the guest's payment method", () => {
  it("bank / bit / phone / other; empty is 'not chosen'; anything else is refused", () => {
    expect(optionalPaymentMethod("bank")).toBe("bank");
    expect(optionalPaymentMethod("")).toBeNull();
    expect(optionalPaymentMethod(undefined)).toBeNull();
    expect(() => optionalPaymentMethod("cash")).toThrow(InputError);
    expect(() => optionalPaymentMethod("card")).toThrow(InputError);
  });

  it("set: by the secret link or by the booking of a signed-in guest — the method is required", () => {
    expect(parseSetPaymentMethod({ token: TOKEN, method: "bank" })).toMatchObject({
      token: TOKEN,
      method: "bank",
    });
    expect(parseSetPaymentMethod({ bookingId: ID, method: "phone" })).toMatchObject({
      bookingId: ID,
      method: "phone",
    });
    expect(() => parseSetPaymentMethod({ token: TOKEN })).toThrow(InputError);
    expect(() => parseSetPaymentMethod({ token: "short", method: "bank" })).toThrow();
  });
});

describe("transfer proof: the upload form", () => {
  const form = (entries: Record<string, string | File>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  it("one file and the guest's link (or booking); not a plain object, not an empty file", () => {
    const parsed = parseProofUploadForm(form({ token: TOKEN, file: file(PNG, "a.png") }));
    expect(parsed.token).toBe(TOKEN);
    expect(parsed.file).toBeInstanceOf(File);
    expect(parseProofUploadForm(form({ bookingId: ID, file: file(PNG, "a.png") })).bookingId).toBe(
      ID,
    );
    expect(() => parseProofUploadForm({ token: TOKEN })).toThrow(InputError);
    expect(() => parseProofUploadForm(form({ token: TOKEN }))).toThrow(/בחרו קובץ/);
    expect(() => parseProofUploadForm(form({ token: TOKEN, file: file("", "a.png") }))).toThrow(
      /בחרו קובץ/,
    );
    expect(() => parseProofUploadForm(form({ file: file(PNG, "a.png") }))).toThrow();
  });
});

describe("transfer proof: the file is checked by its content on the server", () => {
  it("a screenshot is kept, with a clean name and the extension of its real type", async () => {
    const p = await prepareProofFile(file(PNG, "צילום\u0000 מסך.jpg", "image/jpeg"));
    expect(p.mime).toBe("image/png");
    expect(p.name).toMatch(/\.png$/);
    expect(p.name).not.toContain("\u0000");
    expect(p.size).toBe(PNG.byteLength);
  });

  it("a plain PDF is kept", async () => {
    const p = await prepareProofFile(
      file("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj", "x.pdf"),
    );
    expect(p.mime).toBe("application/pdf");
  });

  it("HTML / SVG / scripts / executables renamed to .png or .pdf are refused", async () => {
    await expect(
      prepareProofFile(file("<html><script>alert(1)</script></html>", "proof.png", "image/png")),
    ).rejects.toThrow(/לא נתמך/);
    await expect(
      prepareProofFile(file('<svg xmlns="http://www.w3.org/2000/svg"/>', "proof.pdf")),
    ).rejects.toThrow(/לא נתמך/);
    await expect(prepareProofFile(file("MZ\x90\x00", "proof.pdf"))).rejects.toThrow(/לא נתמך/);
  });

  it("a PDF with JavaScript, an embedded file or encryption is refused", async () => {
    await expect(
      prepareProofFile(file("%PDF-1.4 << /S /JavaScript /JS (app.alert(1)) >>", "x.pdf")),
    ).rejects.toThrow(/תוכן פעיל/);
    await expect(
      prepareProofFile(file("%PDF-1.4 << /Type /EmbeddedFile >>", "x.pdf")),
    ).rejects.toThrow(/תוכן פעיל/);
    await expect(
      prepareProofFile(file("%PDF-1.4 trailer << /Encrypt 5 0 R >>", "x.pdf")),
    ).rejects.toThrow(/תוכן פעיל/);
  });

  it("an empty file or one over 5MB is refused before anything is stored", async () => {
    await expect(prepareProofFile(file(new Uint8Array(0), "a.png"))).rejects.toThrow(/ריק/);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG);
    await expect(prepareProofFile(file(big, "a.png"))).rejects.toThrow(/גדול מדי/);
  });
});

describe("transfer proof: the staff decision", () => {
  it("approve needs the amount received; reject needs a reason for the guest", () => {
    expect(parseProofReview({ proofId: ID, decision: "approve", amount: "450" })).toMatchObject({
      decision: "approve",
      amount: 450,
    });
    expect(() => parseProofReview({ proofId: ID, decision: "approve" })).toThrow(/הסכום/);
    expect(() => parseProofReview({ proofId: ID, decision: "approve", amount: 0 })).toThrow(
      /הסכום/,
    );
    expect(parseProofReview({ proofId: ID, decision: "reject", note: "חסר סכום" })).toMatchObject({
      decision: "reject",
      amount: null,
      note: "חסר סכום",
    });
    expect(() => parseProofReview({ proofId: ID, decision: "reject", note: " " })).toThrow(
      /למה האישור נדחה/,
    );
    expect(() => parseProofReview({ proofId: ID, decision: "maybe" })).toThrow(InputError);
    expect(() => parseProofReview({ proofId: "x", decision: "reject", note: "סיבה" })).toThrow();
  });
});

describe("the guest's payment row", () => {
  const info = (over: Partial<GuestPaymentInfo>, transfer: Partial<GuestPaymentInfo["transfer"]>) =>
    ({
      available: true,
      methods: ["bank", "phone"],
      ...over,
      transfer: {
        allowed: true,
        min_days: 7,
        chosen: false,
        proofs: [],
        waiting_review: false,
        can_upload: true,
        ...transfer,
      },
    }) as GuestPaymentInfo;

  it('"waiting for the transfer" once bank transfer was chosen; "proof received" once uploaded', () => {
    expect(transferPaymentLabel(info({}, { chosen: true }), he)).toBe(he.my.transfer.waiting);
    expect(transferPaymentLabel(info({}, { chosen: true, waiting_review: true }), he)).toBe(
      he.my.transfer.received,
    );
  });

  it("the regular wording otherwise: not chosen, not allowed (under 7 days), paid or closed", () => {
    expect(transferPaymentLabel(info({}, {}), he)).toBeNull();
    expect(transferPaymentLabel(info({}, { allowed: false, chosen: true }), he)).toBeNull();
    expect(
      transferPaymentLabel(info({ available: false, reason: "paid" }, { chosen: true }), he),
    ).toBeNull();
    expect(
      transferPaymentLabel(info({ available: false, reason: "closed" }, { chosen: true }), he),
    ).toBeNull();
    expect(transferPaymentLabel(undefined, he)).toBeNull();
  });
});

describe("management: history and the dashboard", () => {
  it("the new history entries have Hebrew text", () => {
    expect(eventText({ kind: "payment_proof_submitted", from: null, to: null })).toBe(
      "האורח העלה אישור העברה",
    );
    expect(eventText({ kind: "payment_proof_rejected", from: null, to: null })).toBe(
      "אישור ההעברה נדחה",
    );
    expect(eventText({ kind: "payment_method_chosen", from: null, to: null })).toBe(
      "האורח בחר אמצעי תשלום",
    );
  });

  it('"proofs to review" links straight to the booking\'s transfer card', () => {
    const v = taskView({
      kind: "proofs",
      severity: "high",
      count: 2,
      booking_id: ID,
      booking_number: 1042,
    });
    expect(v.title).toContain("אישורי העברה");
    expect(v.detail).toContain("#1042");
    expect(v.link).toEqual({
      to: "/manage/bookings/$bookingId",
      params: { bookingId: ID },
      hash: "transfer-proofs",
    });
  });
});
