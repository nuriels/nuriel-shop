// שורת הפעולות הקבועה בטלפון (חיוג, WhatsApp, הזמנה): באיזה עמוד היא מוצגת, וכמה מקום הפוטר
// משאיר לה כדי שהקרדיט וקישורי הפרטיות והנגישות לא יוסתרו (F1).

/** עמודים עם פעולה משלהם — בלי שורת הפעולות הקבועה (גם עמוד החתימה: שם הפעולה היא החתימה) */
const NO_ACTION_BAR = /^\/stay\/(book|booking-received|my-booking|contract)(\/|$)/;

export function hasActionBar(pathname: string): boolean {
  return !NO_ACTION_BAR.test(pathname);
}

/** גובה השורה (12 + ריפוד + קו + safe-area) — ריפוד תחתון לפוטר מתחת ל-md בלבד */
export const FOOTER_BAR_SPACE = "pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:pb-0";
