import { createMiddleware } from "@tanstack/react-start";
import { toSafeError } from "./safe-error";

/**
 * NURIEL AI ASSISTANT — עוטף פונקציית שרת של העוזר מבחוץ: כל שגיאה (מבדיקת ההתחברות, מבדיקת הקלט, מהמסד
 * או מהפונקציה עצמה) יוצאת לדפדפן כ-SafeError: הודעה קבועה, בלי stack trace ובלי פרטים פנימיים. לא משנה
 * את בדיקת ההרשאות עצמה — רק את צורת השגיאה שחוזרת. (נטען גם בדפדפן כחלק מהגדרת הפונקציה — אין כאן
 * קוד שרת.)
 */
export const safeErrors = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    throw toSafeError(error);
  }
});
