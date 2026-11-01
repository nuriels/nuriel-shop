// קריאה של אזור הניהול למסד: אזור הניהול פעיל לאתר, משתמש מחובר, וקריאה עם הטוקן
// שלו (ההרשאה לכל פעולה ולכל שדה — במסד).
import { HospitalityError, callRpc, hospitalitySiteId } from "./rpc.server";

export async function manageRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const [{ requireSession }, { managementEnabled }] = await Promise.all([
    import("@/platform/auth/session.server"),
    import("../access.server"),
  ]);
  if (!(await managementEnabled(await hospitalitySiteId()))) {
    throw new HospitalityError("אזור הניהול אינו פעיל באתר הזה", "0A000");
  }
  const session = await requireSession();
  return callRpc<T>(fn, args, { accessToken: session.accessToken });
}

/** האתר והטוקן של המשתמש (אחרי אותן בדיקות) — לכתיבה לדלי התמונות בשם המשתמש (2e) */
export async function manageSession(): Promise<{ siteId: string; accessToken: string }> {
  const [{ requireSession }, { managementEnabled }] = await Promise.all([
    import("@/platform/auth/session.server"),
    import("../access.server"),
  ]);
  const siteId = await hospitalitySiteId();
  if (!(await managementEnabled(siteId))) {
    throw new HospitalityError("אזור הניהול אינו פעיל באתר הזה", "0A000");
  }
  const session = await requireSession();
  return { siteId, accessToken: session.accessToken };
}
