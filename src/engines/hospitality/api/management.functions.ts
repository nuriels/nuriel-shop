// אזור הניהול (Stage 2a): ההקשר של המעטפת — מי המשתמש באתר הזה, מה מותר לו,
// מצב המנוי ורשימת ההקמה. נקרא מהדפדפן, ולכן מחוץ לתיקיית server/ (import protection). ההרשאה נבדקת במסד (management_context: בעלים / מנהל,
// דגלי המסד והניהול); כאן רק: אזור הניהול פעיל לאתר, זהות המשתמש, ותרגום התשובה.
import { createServerFn } from "@tanstack/react-start";
import type { ManagementAccess, ManagementContext } from "../types/management";
import { parseManagerPasswordReset } from "../validation/manage-login";

export const hospitalityManagementContext = createServerFn({ method: "GET" }).handler(
  async (): Promise<ManagementAccess> => {
    const [{ sessionFromRequest }, { callRpc, hospitalitySiteId, HospitalityError }, access] =
      await Promise.all([
        import("@/platform/auth/session.server"),
        import("../server/rpc.server"),
        import("../access.server"),
      ]);
    // אזור הניהול כבוי לאתר → כמו שאין אזור כזה (גם אם מישהו קורא לפונקציה ישירות)
    if (!(await access.managementEnabled(await hospitalitySiteId()))) {
      throw new HospitalityError("אזור הניהול אינו פעיל באתר הזה", "0A000");
    }
    let session;
    try {
      session = await sessionFromRequest();
    } catch (error) {
      // A3: לא בולעים בשקט — חיבור שלא נקרא הוא הסיבה לכניסה ש"מצליחה" וחוזרת למסך הכניסה
      console.warn(
        "[hospitality/manage] the session could not be read:",
        error instanceof Error ? error.message : "unknown error",
      );
      return { state: "signed_out" };
    }
    if (!session) return { state: "signed_out" };
    try {
      const context = await callRpc<ManagementContext>(
        "management_context",
        {},
        { accessToken: session.accessToken },
      );
      return { state: "ok", context };
    } catch (error) {
      // חשבון מחובר בלי הרשאת ניהול באתר הזה (אורח, חבר באתר אחר, חסום)
      if (error instanceof HospitalityError && error.code === "42501") {
        return { state: "forbidden", message: error.message };
      }
      throw error;
    }
  },
);

/**
 * שלב א' 3: הכניסה עם Google — דרך השער של Nuriel בלבד (חזרת ה-OAuth לכתובת של Nuriel, לא של האתר;
 * docs/security/oauth-pkce-analysis.md). מהשער חוזרים לאזור הניהול בקוד חד-פעמי (/admin-handoff).
 */
export const hospitalityCentralLogin = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ url: string | null }> => {
    const { portalLoginUrl } = await import("@/platform/tenancy/portal.server");
    return { url: portalLoginUrl() };
  },
);

/**
 * שלב א' 3: איפוס סיסמה בקוד חד-פעמי למייל — בבקשה אחת: הקוד נבדק (אותה פונקציה של הכניסה בקוד),
 * ההרשאה לניהול באתר הזה נבדקת במסד, ורק אז נשמרת הסיסמה החדשה. מחזיר את החיבור (נכנסים מיד).
 * כך כל דרכי הכניסה (קוד, סיסמה, Google דרך השער) מגיעות לאותו חשבון — בלי חשבון כפול.
 */
export const hospitalityResetPassword = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseManagerPasswordReset(input))
  .handler(async ({ data }): Promise<{ accessToken: string; refreshToken: string }> => {
    const [
      { verifyLoginCode, loginWithIdentifier },
      { callRpc, HospitalityError },
      { setPasswordForSession },
    ] = await Promise.all([
      import("@/platform/auth/login"),
      import("../server/rpc.server"),
      import("@/platform/auth/accounts.server"),
    ]);
    const tokens = await verifyLoginCode({ data: { email: data.email, code: data.code } });
    try {
      await callRpc<ManagementContext>(
        "management_context",
        {},
        { accessToken: tokens.accessToken },
      );
    } catch (error) {
      if (error instanceof HospitalityError && error.code === "42501")
        throw new HospitalityError("לחשבון הזה אין הרשאת ניהול באתר הזה", "42501");
      throw error;
    }
    await setPasswordForSession(tokens.accessToken, data.password);
    console.info("[hospitality/manage] password reset by email code");
    // שינוי סיסמה מנתק את החיבורים של החשבון (גם את זה שנפתח בקוד) — חיבור חדש עם הסיסמה החדשה,
    // שגם מוכיח שהיא עובדת
    return loginWithIdentifier({ data: { identifier: data.email, password: data.password } });
  });
