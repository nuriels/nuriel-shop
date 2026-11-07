// שלב א' 3 — אזור הניהול: איפוס סיסמה בקוד למייל (הקלט והכללים לסיסמה), והכניסה עם Google רק דרך השער.
import { describe, expect, it } from "vitest";
import { InputError } from "@/engines/hospitality/validation/input";
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
