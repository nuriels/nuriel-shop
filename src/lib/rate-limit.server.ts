/**
 * הגבלת קצב בסיסית בזיכרון התהליך, לנקודות קצה ציבוריות (התחברות,
 * הרשמה, בקשת איפוס סיסמה).
 *
 * מכוון נגד ניחוש סיסמאות והצפת הרשמות מכתובת אחת. זה לא תחליף למגננה
 * ברמת ה-Nginx/WAF, וגם לא שורד הפעלה מחדש של הקונטיינר — אבל הוא חוסם
 * את התרחיש הנפוץ (סקריפט שמנסה מאות פעמים) בעלות אפס.
 */

type Hit = { count: number; resetAt: number };

const buckets = new Map<string, Hit>();

/** ניקוי תקופתי כדי שהמפה לא תגדל בלי גבול */
function sweep(now: number): void {
  if (buckets.size < 5000) return;
  for (const [key, hit] of buckets) if (hit.resetAt <= now) buckets.delete(key);
}

/**
 * מחזיר true אם הפעולה מותרת, false אם חרגה מהמותר.
 * @param key מזהה ייחודי לפעולה (למשל `login:1.2.3.4`)
 * @param limit מספר פעולות מותרות בחלון
 * @param windowMs אורך החלון במילישניות
 */
export function allowAction(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) return false;
  existing.count += 1;
  return true;
}

/** כתובת ה-IP של הפונה, לפי הכותרת ש-Nginx מוסיף */
export async function requestIp(): Promise<string> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const request = getRequest();
    const forwarded = request?.headers.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    if (ip) return ip;
    return request?.headers.get("x-real-ip")?.trim() || "unknown";
  } catch {
    return "unknown";
  }
}
