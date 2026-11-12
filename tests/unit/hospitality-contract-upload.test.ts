// שמירת ה-PDF החתום בדלי הפרטי (contracts.server.ts → uploadPdf): "כבר קיים" (ניסיון קודם שלא נרשם)
// נחשב הצלחה — ושום דבר אחר. גופי התשובה כאן הם בדיוק מה ש-Supabase Storage המקומי החזיר (נבדק
// ב-curl): כפילות = 400 עם statusCode 409; סוג קובץ שנדחה = 400 עם statusCode 415. לפני התיקון כל 400
// נחשב "קיים", והחוזה נרשם כאילו הקובץ נשמר.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => ({
    inputValidator: () => ({ handler: (h: unknown) => h }),
    handler: (h: unknown) => h,
  }),
}));

const DUPLICATE =
  '{"statusCode":"409","error":"Duplicate","message":"The resource already exists","code":"KeyAlreadyExists"}';
const BAD_MIME =
  '{"statusCode":"415","error":"invalid_mime_type","message":"mime type text/html is not supported","code":"InvalidMimeType"}';
const TOO_BIG =
  '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}';

describe("isDuplicateUpload", () => {
  it("409, or 400 that says Duplicate → the file is already there", async () => {
    const { isDuplicateUpload } = await import("@/engines/hospitality/server/contracts.server");
    expect(isDuplicateUpload(409, "")).toBe(true);
    expect(isDuplicateUpload(400, DUPLICATE)).toBe(true);
  });

  it("a rejected upload is a failure, not 'already exists'", async () => {
    const { isDuplicateUpload } = await import("@/engines/hospitality/server/contracts.server");
    expect(isDuplicateUpload(400, BAD_MIME)).toBe(false);
    expect(isDuplicateUpload(400, TOO_BIG)).toBe(false);
    expect(isDuplicateUpload(400, "")).toBe(false);
    expect(isDuplicateUpload(500, DUPLICATE)).toBe(false);
    expect(isDuplicateUpload(413, "")).toBe(false);
  });
});
