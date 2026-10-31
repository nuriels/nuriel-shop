import { describe, expect, it } from "vitest";
import { assertLocalTargets, isLocalUrl } from "../../scripts/preview/local-guard.mjs";

// התצוגה המקומית של Hospitality (P0): נתוני ההדגמה נוצרים רק מול מסד ו-API מקומיים
describe("preview kit — local only", () => {
  it("accepts only addresses on this computer", () => {
    for (const url of [
      "http://127.0.0.1:54321",
      "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      "http://localhost:54321",
      "postgres://u:p@localhost/db",
      "http://[::1]:54321",
    ]) {
      expect(isLocalUrl(url), url).toBe(true);
    }
  });

  it("refuses any real or remote address, and empty / broken values", () => {
    for (const url of [
      "https://api-nuriel.nuri1.fit",
      "postgresql://postgres:secret@db.nuri1.fit:5432/postgres",
      "http://10.0.0.5:54321",
      "http://192.168.1.10:54321",
      "http://127.0.0.1.nip.io:54321",
      "http://localhost.evil.test",
      "",
      "not a url",
    ]) {
      expect(isLocalUrl(url), url).toBe(false);
    }
    expect(isLocalUrl(undefined)).toBe(false);
  });

  it("stops before doing anything when one target is not local", () => {
    expect(() =>
      assertLocalTargets({
        SUPABASE_URL: "http://127.0.0.1:54321",
        DB_URL: "postgresql://postgres:x@db.example.com:5432/postgres",
      }),
    ).toThrow(/DB_URL אינו מקומי \(db\.example\.com\)/);
    expect(() =>
      assertLocalTargets({ SUPABASE_URL: "http://127.0.0.1:54321", DB_URL: "" }),
    ).toThrow(/חסר או לא תקין/);
    expect(() =>
      assertLocalTargets({
        SUPABASE_URL: "http://127.0.0.1:54321",
        DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      }),
    ).not.toThrow();
  });
});
