// קרדיט נוריאל הקבוע (D6, שלב F1) — הטקסטים, הקישור וגרסת ה-HTML הסטטית (לעמודי השער בלי React).
// הרכיב עצמו: ./NurielCredit.tsx.
//   • הקרדיט מתייחס לפלטפורמה. הזכויות על התמונות והתוכן נשארות של העסק (השורה "© שנה, שם העסק"
//     שבפוטר).
//   • קישור אחד, בחלון חדש, עם rel="nofollow" (קישור שמופיע בפוטר של אתרים רבים).
// דף הנחיתה של הפלטפורמה (השער — nuriel-app2), שם פותחים חנות או אתר לצימר
export const NURIEL_CREDIT_URL = "https://nuriel-app2.nuri1.fit";
export const NURIEL_CREDIT_REL = "nofollow noopener";
export const NURIEL_PRODUCT = "Nuriel Hospitality";
/** שורה 1: "האתר נבנה באמצעות Nuriel Hospitality מבית נוריאל מחשבים" */
export const NURIEL_CREDIT_BUILT = `האתר נבנה באמצעות ${NURIEL_PRODUCT} מבית נוריאל מחשבים`;
/** שורה 2 */
export const NURIEL_CREDIT_RIGHTS = "© כל הזכויות שמורות לנוריאל מחשבים";
export const NURIEL_CREDIT_LINES = [NURIEL_CREDIT_BUILT, NURIEL_CREDIT_RIGHTS] as const;
/** השם הנגיש של הקישור (קורא מסך) — כולל את הטקסט הגלוי במלואו */
export const NURIEL_CREDIT_LABEL = `${NURIEL_CREDIT_BUILT}. ${NURIEL_CREDIT_RIGHTS}. נפתח בחלון חדש`;
/** שורה 1 מפוצלת סביב שם המוצר (שם המוצר בלטינית מבודד ב-<bdi>) */
export const NURIEL_CREDIT_BUILT_PARTS = NURIEL_CREDIT_BUILT.split(NURIEL_PRODUCT) as [
  string,
  string,
];

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** אותו קרדיט כ-HTML סטטי — לעמודים שהשער מחזיר בלי React ("לא פתוח", "מושעה", "לא נמצא") */
export function nurielCreditHtml(): string {
  const [before, after] = NURIEL_CREDIT_BUILT_PARTS;
  return (
    `<p data-nuriel-credit=""><a href="${NURIEL_CREDIT_URL}" target="_blank" rel="${NURIEL_CREDIT_REL}"` +
    ` aria-label="${escapeHtml(NURIEL_CREDIT_LABEL)}">` +
    `<span>${escapeHtml(before)}<bdi dir="ltr">${NURIEL_PRODUCT}</bdi>${escapeHtml(after)}</span>` +
    `<span>${escapeHtml(NURIEL_CREDIT_RIGHTS)}</span></a></p>`
  );
}
