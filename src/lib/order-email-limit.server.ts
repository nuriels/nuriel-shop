import { allowAction } from "@/lib/rate-limit.server";

const WINDOW_MS = 10 * 60_000;

/**
 * הגבלת שליחה חוזרת של מיילי הזמנה (sendOrderEmails): לכל הזמנה 5 בחלון, ולכל משתמש 60. הרגיל — פעם בקופה
 * ועוד פעם אחרי אסמכתא — רחוק מהתקרה. נקרא רק אחרי בדיקת ההרשאה, כדי שזר לא יוכל לנצל מכסה של אחרים.
 */
export function orderEmailsAllowed(orderId: string, userId: string): boolean {
  return (
    allowAction(`order-emails:${orderId}`, 5, WINDOW_MS) &&
    allowAction(`order-emails-user:${userId}`, 60, WINDOW_MS)
  );
}
