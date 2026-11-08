/**
 * NURIEL AI ASSISTANT — שגיאה "בטוחה" שמותר להחזיר לדפדפן: רק הודעה בעברית שנכתבה מראש בקוד — בלי
 * stack trace, בלי שדות נוספים ובלי פרטים מהספרייה של Anthropic או מהמסד.
 *
 * למה צריך את זה (לקח מהעוזר של קובי): TanStack Start מעביר לדפדפן את אובייקט השגיאה שנזרק בפונקציית
 * שרת, כולל ה-stack (נתיבי קבצים בשרת) וכל שדה אחר שעליו (חלק מסביבות ההרצה מוסיפות שורה / עמודה /
 * נתיב קובץ). כאן ה-stack מתרוקן כבר ביצירה, וכל שדה אחר נמחק. בפרויקט אין שכבה גלובלית שמנקה שגיאות
 * של פונקציות שרת — לכן לכל פונקציית שרת של העוזר יש את השכבה safeErrors (ai-middleware.ts).
 */
export class SafeError extends Error {
  constructor(message: string) {
    super(message);
    for (const key of Object.getOwnPropertyNames(this)) {
      if (key !== "message" && key !== "stack") {
        try {
          delete (this as unknown as Record<string, unknown>)[key];
        } catch {
          // שדה שאי אפשר למחוק — נשאר (לא קורה ב-Node)
        }
      }
    }
    this.stack = "";
  }
}

export const GENERIC_ERROR_MESSAGE = "הפעולה לא הושלמה. נסו שוב בעוד כמה דקות.";

/**
 * כל שגיאה שאינה SafeError (מהספרייה, מהמסד, מבדיקת ההתחברות, באג בקוד) מוחלפת בהודעה כללית אחת —
 * כך שום פרט פנימי לא יוצא החוצה, גם לא דרך הודעת שגיאה.
 */
export function toSafeError(error: unknown): SafeError {
  if (error instanceof SafeError) return new SafeError(error.message);
  return new SafeError(GENERIC_ERROR_MESSAGE);
}
