// קרדיט נוריאל הקבוע (D6, שלב F1) — בכל עמוד של כל אתר אירוח: בכל ארבע הערכות, בעמודי ההזמנה,
// בעמודים המשפטיים, בעמודי השגיאה / "לא נמצא" ובעמודים הסטטיים של השער ("לא פתוח" / "מושעה").
// רכיב פלטפורמה: האתר ממקם אותו מחוץ למסמך העיצוב — אין לו שדה, מתג או מקטע בעורך, ו-
// normalizeDesign מוחק כל מפתח לא מוכר, כך שבעל העסק לא יכול להסיר או להסתיר אותו.
// הטקסטים והגרסה הסטטית: ./credit.ts.
import {
  NURIEL_CREDIT_BUILT_PARTS,
  NURIEL_CREDIT_LABEL,
  NURIEL_CREDIT_REL,
  NURIEL_CREDIT_RIGHTS,
  NURIEL_CREDIT_URL,
  NURIEL_PRODUCT,
} from "./credit";

/**
 * הקרדיט. `className` — יישור / מרווח בלבד (הצבע יורש מהפוטר, שצבעיו קבועים לכל ערכה).
 * `locked` — בתצוגה המקדימה של העורך: סימון "קבוע, לא ניתן להסרה".
 */
export function NurielCredit({
  className,
  locked = false,
}: {
  className?: string;
  locked?: boolean;
}) {
  const [before, after] = NURIEL_CREDIT_BUILT_PARTS;
  return (
    <p
      className={className}
      data-nuriel-credit=""
      title={locked ? "קרדיט הפלטפורמה — חובה, לא ניתן להסרה" : undefined}
    >
      <a
        href={NURIEL_CREDIT_URL}
        target="_blank"
        rel={NURIEL_CREDIT_REL}
        aria-label={NURIEL_CREDIT_LABEL}
        className="inline-flex flex-col items-center gap-0.5 text-center leading-relaxed underline-offset-4 hover:underline"
      >
        <span>
          {before}
          <bdi dir="ltr" className="font-semibold">
            {NURIEL_PRODUCT}
          </bdi>
          {after}
        </span>
        <span className="opacity-85">{NURIEL_CREDIT_RIGHTS}</span>
      </a>
      {locked && <span className="sr-only">(קבוע — לא ניתן להסרה)</span>}
    </p>
  );
}
