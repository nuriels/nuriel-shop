// אזור הניהול (Stage 2a): ההקשר של המעטפת — מי המשתמש באתר הזה, מה מותר לו,
// מצב המנוי ורשימת ההקמה. נקרא מהדפדפן, ולכן מחוץ לתיקיית server/ (import protection). ההרשאה נבדקת במסד (management_context: בעלים / מנהל,
// דגלי המסד והניהול); כאן רק: אזור הניהול פעיל לאתר, זהות המשתמש, ותרגום התשובה.
import { createServerFn } from "@tanstack/react-start";
import type { ManagementAccess, ManagementContext } from "../types/management";

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
    } catch {
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
