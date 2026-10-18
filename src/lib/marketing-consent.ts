/**
 * חלק 40: הסכמה לדיוור — חוק התקשורת (בזק ושידורים), סעיף 30א ("חוק הספאם").
 *
 * העקרונות שהקוד שומר עליהם:
 *  - הסכמה מפורשת מראש: תיבת סימון שהלקוח מסמן בעצמו (לא מסומנת מראש), עם
 *    נוסח שאומר במפורש שמדובר בדיוור ופרסומות.
 *  - תיעוד: מתי, מאיזה מסך ובאיזה נוסח (marketing_consents + יומן אירועים).
 *  - כל מייל שיווקי: המילה "פרסומת" בתחילת הנושא, שם העסק ודרכי יצירת קשר,
 *    והודעה על הזכות לסרב + קישור הסרה שעובד בלחיצה אחת.
 *  - הסרה מכובדת מיד (גם בקישור, גם ב"החשבון שלי").
 * כאן — רק טקסטים ולוגיקה טהורה (משותף לדפדפן ולשרת).
 */

/** מקור ההסכמה (תואם ל-CHECK במסד) */
export type ConsentSource = "register" | "checkout" | "account";

/** הנוסח שמוצג ליד תיבת הסימון — נשמר כמו שהוא כהוכחה להסכמה */
export function marketingConsentText(storeName: string, source: ConsentSource): string {
  const store = storeName.trim() || "החנות";
  const reminder =
    source === "checkout" ? ", כולל תזכורת במייל אם לא אשלים את ההזמנה" : ", הטבות וקופונים";
  return `אני מאשר/ת לקבל מ${store} דיוור ופרסומות במייל${reminder}. אפשר להסיר את עצמי בכל עת בקישור שבכל מייל.`;
}

/** המילה שחייבת לפתוח את נושא המייל השיווקי (סעיף 30א(ה)(1)(א)) */
export const AD_SUBJECT_PREFIX = "פרסומת";

export function adSubject(subject: string): string {
  const clean = subject.trim();
  return clean.startsWith(AD_SUBJECT_PREFIX) ? clean : `${AD_SUBJECT_PREFIX}: ${clean}`;
}

/** הנתיב של עמוד ההסרה (הטוקן — UUID אקראי לכל כתובת בכל חנות) */
export function unsubscribePath(token: string): string {
  return `/unsubscribe/${token}`;
}

export const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
