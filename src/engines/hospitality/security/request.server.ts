// פרטי הבקשה הנוכחית שצריך לאבטחה: כתובת ה-IP של הגולש (client-ip.ts — רק ממקור שהשרת שלנו
// קובע) והדפדפן (לתיעוד אישור התנאים בבקשת הזמנה). בלי בקשה (קריאה פנימית) — "unknown".
import { clientIp, normalizeIp } from "./client-ip";

export interface RequestInfo {
  ip: string;
  userAgent: string;
}

export async function requestInfo(): Promise<RequestInfo> {
  try {
    const { getRequest, getRequestIP } = await import("@tanstack/react-start/server");
    const request = getRequest();
    let ip = clientIp(request.headers);
    // בלי פרוקסי לפני האפליקציה (אין X-Real-IP / X-Forwarded-For) — הכתובת של החיבור עצמו
    if (ip === "unknown") ip = normalizeIp(getRequestIP()) ?? "unknown";
    return { ip, userAgent: (request.headers.get("user-agent") ?? "").slice(0, 300) };
  } catch {
    return { ip: "unknown", userAgent: "" };
  }
}
