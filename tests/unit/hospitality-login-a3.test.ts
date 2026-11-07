// שלב א' 3 — אזור הניהול: איפוס סיסמה בקוד למייל (הקלט והכללים לסיסמה), והכניסה עם Google רק דרך השער.
import { describe, expect, it } from "vitest";
import { InputError } from "@/engines/hospitality/validation/input";
import { parseSetPlan } from "@/engines/hospitality/validation/platform-admin";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  parseManagerPasswordReset,
  passwordProblem,
} from "@/engines/hospitality/validation/manage-login";

describe("manager password reset", () => {
  it("a password of 8 to 72 bytes, not only spaces", () => {
    expect(passwordProblem("Abcdefg1")).toBeNull();
    expect(passwordProblem("short")).toMatch(String(PASSWORD_MIN));
    expect(passwordProblem("        ")).toBe("בחרו סיסמה");
    expect(passwordProblem("א".repeat(40))).toMatch(String(PASSWORD_MAX)); // 80 bytes in UTF-8
    expect(passwordProblem("a".repeat(72))).toBeNull();
  });

  it("the email is normalized, the code is 6 digits, a bad password is refused before anything is checked", () => {
    expect(
      parseManagerPasswordReset({
        email: " Dana@X.COM ",
        code: "12 34 56",
        password: "Long-Enough-1",
      }),
    ).toEqual({ email: "dana@x.com", code: "123456", password: "Long-Enough-1" });
    expect(() =>
      parseManagerPasswordReset({ email: "x", code: "123456", password: "Long-Enough-1" }),
    ).toThrow(InputError);
    expect(() =>
      parseManagerPasswordReset({ email: "a@b.co", code: "12345", password: "Long-Enough-1" }),
    ).toThrow(/6 ספרות/);
    expect(() =>
      parseManagerPasswordReset({ email: "a@b.co", code: "123456", password: "short" }),
    ).toThrow(/8 תווים/);
    expect(() =>
      parseManagerPasswordReset({ email: "a@b.co", code: "123456", password: 12345678 }),
    ).toThrow(InputError);
  });
});

// שלב א' 4 — מסך החבילה של אתר אירוח בפאנל: מצב המנוי ומקומות המנהלים הנוספים

describe("platform panel: a hospitality site's plan", () => {
  const SITE = "0f0e0d0c-0b0a-4908-8706-050403020100";
  it("a paid plan takes a status (active / past due / canceled); a trial is always 'trialing'", () => {
    expect(
      parseSetPlan({
        siteId: SITE,
        plan: "premium",
        until: "2027-06-30",
        status: "past_due",
        extraUnits: 0,
      }),
    ).toMatchObject({
      plan: "premium",
      status: "past_due",
      until: "2027-06-30",
      extraManagers: null,
    });
    expect(parseSetPlan({ siteId: SITE, plan: "basic", extraUnits: 0 }).status).toBe("active");
    expect(
      parseSetPlan({
        siteId: SITE,
        plan: "trial",
        until: "2026-12-01",
        status: "canceled",
        extraUnits: 0,
      }).status,
    ).toBe("trialing");
    expect(() =>
      parseSetPlan({ siteId: SITE, plan: "premium", status: "expired", extraUnits: 0 }),
    ).toThrow(/מצב המנוי/);
  });

  it("extra manager seats: 0-100, or not sent (unchanged)", () => {
    expect(
      parseSetPlan({ siteId: SITE, plan: "premium", extraUnits: 0, extraManagers: 2 })
        .extraManagers,
    ).toBe(2);
    expect(
      parseSetPlan({ siteId: SITE, plan: "premium", extraUnits: 0, extraManagers: null })
        .extraManagers,
    ).toBeNull();
    expect(() =>
      parseSetPlan({ siteId: SITE, plan: "premium", extraUnits: 0, extraManagers: 101 }),
    ).toThrow(/0 ל-100/);
    expect(() => parseSetPlan({ siteId: SITE, plan: "trial", extraUnits: 0 })).toThrow(
      /תאריך סיום/,
    );
  });
});
