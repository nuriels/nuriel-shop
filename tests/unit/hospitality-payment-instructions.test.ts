// הוראות תשלום לאורחים (מיגרציה 37): הנוסח באתר ובמיילים, הטופס של בעל העסק, בדיקת הקלט
import { describe, expect, it } from "vitest";
import {
  changesFrom,
  formFromView,
  guestPreview,
  valuesOf,
} from "@/engines/hospitality/management/settings/payment-model";
import { copyFor } from "@/engines/hospitality/outbox/templates";
import type { PaymentSettingsView } from "@/engines/hospitality/types/payment-instructions";
import {
  parsePaymentSettingsSave,
  paymentFormErrors,
} from "@/engines/hospitality/validation/payment-instructions";
import { he } from "@/engines/hospitality/website/copy/he";
import { hasInstructions, methodsText } from "@/engines/hospitality/website/lib/payment";

const view = (o: Partial<PaymentSettingsView> = {}): PaymentSettingsView => ({
  bank_enabled: false,
  bank_name: null,
  bank_branch: null,
  bank_account: null,
  bank_holder: null,
  bit_enabled: false,
  bit_phone: null,
  phone_enabled: true,
  phone_number: null,
  note: null,
  revision: 0,
  methods: ["phone"],
  business_phone: "04-6001234",
  updated_at: null,
  editable: true,
  ...o,
});

describe("payment instructions: wording on the site", () => {
  it("phone only (the default) keeps the D4 wording; anything else switches to instructions", () => {
    expect(hasInstructions(["phone"])).toBe(false);
    expect(hasInstructions(undefined)).toBe(false);
    expect(hasInstructions(["bank", "phone"])).toBe(true);
    expect(hasInstructions(["note"])).toBe(true);
  });
  it("names the methods in a fixed order; a note alone reads 'by the business's instructions'", () => {
    const names = he.my.methodNames;
    expect(methodsText(["bank", "bit", "phone", "note"], names)).toBe(
      "העברה בנקאית / Bit / תשלום בטלפון",
    );
    expect(methodsText(["note"], names)).toBe("לפי הוראות העסק");
    expect(methodsText([], names)).toBe("תשלום בטלפון");
    expect(he.book.payByInstructions("העברה בנקאית / Bit")).toContain("אחרי שהעסק יאשר");
  });
  it("the D4 phone texts are unchanged", () => {
    expect(he.book.payByPhone).toBe(
      "לא ניתן לשלם באתר: אחרי שליחת הבקשה, נציג העסק יתקשר אליכם להשלמת התשלום ואישור ההזמנה.",
    );
    expect(he.received.phone).toBe(
      "בקשת ההזמנה התקבלה. נציג העסק יצור איתך קשר טלפונית להשלמת התשלום ואישור ההזמנה",
    );
    expect(he.my.paymentStates.unpaid).toBe("טרם שולם — נציג העסק יצור איתך קשר טלפונית");
    // instructions are never a receipt
    expect(he.my.pay.notReceipt).toContain("רק אחרי שהעסק יאשר שהתשלום התקבל");
  });
});

describe("payment instructions: the emails", () => {
  const business = {
    name: "צימרי הגליל",
    phone: "04-6001234",
    email: null,
    address: null,
    checkInTime: "15:00",
    checkOutTime: "11:00",
  };
  const p = { guest_name: "נועה", booking_number: 1004 };
  it("phone only (or before migration 37) — the D4 sentences, word for word", () => {
    expect(copyFor("request_received", p, business)?.intro).toContain(
      "נציג העסק יצור איתך קשר טלפונית להשלמת התשלום ואישור ההזמנה",
    );
    expect(
      copyFor("booking_confirmed", p, { ...business, paymentMethods: ["phone"] })?.intro,
    ).toContain("נציג העסק יצור איתך קשר טלפונית (לא ניתן לשלם באתר)");
  });
  it("with bank / Bit — the details wait on the booking page; paid only after the business confirms", () => {
    const b = { ...business, paymentMethods: ["bank", "bit", "phone"] };
    const req = copyFor("request_received", p, b)!;
    expect(req.intro).toContain("אחרי האישור, פרטי התשלום (העברה בנקאית / Bit / תשלום בטלפון)");
    expect(req.intro).not.toContain("123");
    const ok = copyFor("booking_confirmed", p, b)!;
    expect(ok.intro).toContain("מחכים לך בעמוד ההזמנה");
    // המייל הזה בלי קישור (הטוקן רק במייל הראשון) — הנוסח מפנה לקישור האישי מהמייל הקודם
    expect(ok.intro).toContain("בקישור האישי שנשלח אליך במייל הקודם");
    expect(ok.intro).toContain("יסומן כשולם אחרי שהעסק יאשר שקיבל אותו");
  });
});

describe("payment instructions: the owner's form", () => {
  it("only what changed is sent; cleared text is sent as empty", () => {
    const v = view({
      bank_enabled: true,
      bank_name: "בנק הפועלים",
      bank_branch: "612",
      bank_account: "123456",
      bank_holder: "שירה",
      note: "מזומן בהגעה",
    });
    const f = formFromView(v);
    expect(changesFrom(v, f)).toEqual({});
    expect(changesFrom(v, { ...f, bank_account: " 654321 ", note: "" })).toEqual({
      bank_account: "654321",
      note: "",
    });
    expect(changesFrom(v, { ...f, phone_enabled: false })).toEqual({ phone_enabled: false });
  });
  it("the preview shows what the guest will see (business phone when none is set)", () => {
    const f = formFromView(view({ bit_enabled: true, bit_phone: "0521234567" }));
    expect(guestPreview(f, "04-6001234")).toEqual([
      "Bit: 0521234567",
      "תשלום בטלפון: נציג העסק יתקשר להשלמת התשלום (אפשר גם להתקשר: 04-6001234)",
    ]);
  });
  it("field rules match the database", () => {
    const base = valuesOf(formFromView(view()));
    expect(paymentFormErrors(base)).toEqual({});
    expect(Object.keys(paymentFormErrors({ ...base, bank_enabled: true })).sort()).toEqual([
      "bank_account",
      "bank_branch",
      "bank_holder",
      "bank_name",
    ]);
    expect(
      paymentFormErrors({ ...base, bit_enabled: true, bit_phone: "031234567" }).bit_phone,
    ).toBeTruthy();
    expect(paymentFormErrors({ ...base, bit_enabled: true, bit_phone: "052-1234567" })).toEqual({});
  });
  it("input before the database: known fields, right types, a revision", () => {
    expect(
      parsePaymentSettingsSave({ changes: { bank_enabled: true, note: "x" }, revision: 2 }),
    ).toEqual({
      changes: { bank_enabled: true, note: "x" },
      revision: 2,
    });
    expect(() => parsePaymentSettingsSave({ changes: { iban: "x" }, revision: 1 })).toThrow(
      "שדה לא מוכר",
    );
    expect(() =>
      parsePaymentSettingsSave({ changes: { bank_enabled: "yes" }, revision: 1 }),
    ).toThrow("ערך לא תקין");
    expect(() => parsePaymentSettingsSave({ changes: {}, revision: 1 })).toThrow("אין שינויים");
    expect(() => parsePaymentSettingsSave({ changes: { note: "x" } })).toThrow("גרסה");
  });
});
