// Hospitality Stage 2b.2 — הגדרות העסק: בדיקת השדות (אותם כללים כמו המסד), קלט
// פונקציית השמירה, אזורים לפי הרשאה, מה השתנה, ומיזוג אחרי "עודכן בינתיים".
// ההרשאות עצמן נאכפות במסד (hospitality-settings-team.test.sql); המסך — e2e.
import { describe, expect, it } from "vitest";
import { parseSettingsUpdate, settingsFieldError } from "@/engines/hospitality/validation/settings";
import {
  buildChanges,
  changedFields,
  formErrors,
  formFromValues,
  hoursText,
  mergeAfterConflict,
  retentionText,
  visibleSections,
  type FormValues,
} from "@/engines/hospitality/management/settings/model";
import {
  SETTINGS_KEYS,
  type SettingsKey,
  type SettingsValues,
} from "@/engines/hospitality/types/settings";

const VALUES: SettingsValues = {
  business_name: "צימרי הגליל",
  contact_phone: null,
  contact_email: "info@biz.test",
  whatsapp_phone: null,
  address: null,
  check_in_time: "15:00",
  check_out_time: "11:00",
  approval_window_minutes: 720,
  approval_reminder_pct: 50,
  max_open_requests: 2,
  weekend_nights: [4, 5],
  notification_emails: [],
  guest_retention_months: null,
  booking_mode: "request",
  currency: "ILS",
  timezone: "Asia/Jerusalem",
  payment_hold_minutes: 30,
};
const OWNER: SettingsKey[] = [...SETTINGS_KEYS];
const MANAGER = OWNER.filter((k) => k !== "notification_emails" && k !== "guest_retention_months");
const base = (): FormValues => formFromValues(VALUES);

describe("settings validation (mirrors update_settings)", () => {
  it("accepts valid values", () => {
    expect(settingsFieldError("business_name", "צימר")).toBeNull();
    expect(settingsFieldError("contact_phone", "050-1234567")).toBeNull();
    expect(settingsFieldError("contact_phone", null)).toBeNull();
    expect(settingsFieldError("contact_email", "a@b.co")).toBeNull();
    expect(settingsFieldError("check_in_time", "14:30")).toBeNull();
    expect(settingsFieldError("approval_window_minutes", 60)).toBeNull();
    expect(settingsFieldError("weekend_nights", [])).toBeNull();
    expect(settingsFieldError("notification_emails", ["a@b.co"])).toBeNull();
    expect(settingsFieldError("guest_retention_months", null)).toBeNull();
    expect(settingsFieldError("guest_retention_months", 24)).toBeNull();
  });

  it("refuses invalid values with the same Hebrew messages as the database", () => {
    expect(settingsFieldError("business_name", "  ")).toBe("יש למלא את שם העסק");
    expect(settingsFieldError("business_name", "x".repeat(121))).toBe(
      "שם העסק ארוך מדי (עד 120 תווים)",
    );
    expect(settingsFieldError("whatsapp_phone", "abc")).toBe("מספר WhatsApp — מספר הטלפון לא תקין");
    expect(settingsFieldError("contact_email", "nope")).toBe("כתובת האימייל של העסק לא תקינה");
    expect(settingsFieldError("check_out_time", "25:00")).toBe(
      "שעת עזיבה — שעה לא תקינה (למשל 15:00)",
    );
    expect(settingsFieldError("approval_window_minutes", 30)).toBe(
      "זמן לאישור בקשה חייב להיות מספר שלם בין 60 ל-2880",
    );
    expect(settingsFieldError("max_open_requests", 2.5)).toContain("מספר שלם");
    expect(settingsFieldError("weekend_nights", [7])).toBe(
      "לילות סוף שבוע — יש לבחור ימים מהרשימה",
    );
    expect(settingsFieldError("notification_emails", Array(6).fill("a@b.co"))).toBe(
      "נמעני ההתראות — עד 5 כתובות אימייל",
    );
    expect(settingsFieldError("notification_emails", ["bad"])).toBe(
      "נמעני ההתראות — אחת הכתובות לא תקינה",
    );
    expect(settingsFieldError("guest_retention_months", 3)).toContain("בין 6 ל-120");
  });
});

describe("save input (server function)", () => {
  it("accepts known fields with a revision", () => {
    expect(parseSettingsUpdate({ changes: { address: "רחוב 1" }, revision: 3 })).toEqual({
      changes: { address: "רחוב 1" },
      revision: 3,
    });
  });
  it("refuses locked, unknown, empty, invalid and revision-less saves", () => {
    expect(() => parseSettingsUpdate({ changes: { currency: "USD" }, revision: 1 })).toThrow(
      "נעול",
    );
    expect(() =>
      parseSettingsUpdate({ changes: { booking_mode: "instant" }, revision: 1 }),
    ).toThrow("נעול");
    expect(() => parseSettingsUpdate({ changes: { last_booking_number: 1 }, revision: 1 })).toThrow(
      "שדה לא מוכר",
    );
    expect(() => parseSettingsUpdate({ changes: {}, revision: 1 })).toThrow("אין שינויים");
    expect(() => parseSettingsUpdate({ changes: { business_name: "" }, revision: 1 })).toThrow(
      "יש למלא את שם העסק",
    );
    expect(() => parseSettingsUpdate({ changes: { address: "x" } })).toThrow("גרסת ההגדרות");
    expect(() => parseSettingsUpdate({ changes: { address: "x" }, revision: 0 })).toThrow(
      "גרסת ההגדרות",
    );
  });
});

describe("form model", () => {
  it("shows the owner all five sections; a manager only the three he may edit", () => {
    expect(visibleSections(OWNER).map((s) => s.key)).toEqual([
      "business",
      "times",
      "rules",
      "notifications",
      "privacy",
    ]);
    const manager = visibleSections(MANAGER);
    expect(manager.map((s) => s.key)).toEqual(["business", "times", "rules"]);
    expect(manager.flatMap((s) => s.fields)).not.toContain("notification_emails");
    expect(manager.flatMap((s) => s.fields)).not.toContain("guest_retention_months");
    expect(visibleSections([])).toEqual([]);
  });

  it("sends only changed, normalised fields", () => {
    const form = {
      ...base(),
      contact_phone: " 050-1234567 ",
      contact_email: "",
      weekend_nights: [5, 4, 5],
      notification_emails: [" B@x.co ", "a@x.co", "", "b@x.co"],
    };
    expect(buildChanges(base(), form, OWNER)).toEqual({
      contact_phone: "050-1234567",
      contact_email: null,
      notification_emails: ["a@x.co", "b@x.co"],
    });
    expect(changedFields(base(), base(), OWNER)).toEqual([]);
  });

  it("a manager never sends an owner-only field, even if the form holds one", () => {
    const form = { ...base(), notification_emails: ["me@evil.test"], address: "רחוב" };
    expect(buildChanges(base(), form, MANAGER)).toEqual({ address: "רחוב" });
  });

  it("marks errors only on changed fields", () => {
    expect(formErrors(base(), { ...base(), business_name: " " }, OWNER)).toEqual({
      business_name: "יש למלא את שם העסק",
    });
    expect(formErrors(base(), base(), OWNER)).toEqual({});
  });

  it("after a conflict: keeps my edits the other user did not touch, drops (and reports) the ones we both changed", () => {
    const mine = { ...base(), business_name: "השם שלי", address: "הכתובת שלי" };
    const latest = { ...base(), business_name: "השם של המנהל", check_in_time: "14:00" };
    const merged = mergeAfterConflict(base(), mine, latest, OWNER);
    expect(merged.remoteChanged.sort()).toEqual(["business_name", "check_in_time"]);
    expect(merged.dropped).toEqual(["business_name"]);
    expect(merged.kept).toEqual(["address"]);
    expect(merged.form.business_name).toBe("השם של המנהל");
    expect(merged.form.check_in_time).toBe("14:00");
    expect(merged.form.address).toBe("הכתובת שלי");
    // saving again sends only my surviving change, against the new values
    expect(buildChanges(latest, merged.form, OWNER)).toEqual({ address: "הכתובת שלי" });
  });

  it("plain Hebrew texts for the choices", () => {
    expect(hoursText(60)).toBe("שעה אחת");
    expect(hoursText(720)).toBe("12 שעות");
    expect(hoursText(1440)).toBe("יממה");
    expect(hoursText(90)).toBe("90 דקות");
    expect(retentionText(null)).toBe("לא למחוק אוטומטית");
    expect(retentionText(24)).toBe("שנתיים");
    expect(retentionText(18)).toBe("18 חודשים");
  });
});
